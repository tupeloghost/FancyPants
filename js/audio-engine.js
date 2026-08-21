// AudioEngine — Web Audio analysis exposed as one normalized object per frame.
// Worlds read engine.data; they never touch Web Audio directly.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.fadeNode = null;   // song fades ride their own node, AFTER the level
    this._fadedOut = false;
    this.el = new Audio();
    // every song breathes in — and out near its end — so back-to-back tracks
    // flow instead of jump-cutting. The analyser sits upstream: visuals
    // never dim with the fade.
    this.el.addEventListener('play', () => this._fadeIn());
    this.el.crossOrigin = 'anonymous';
    this.sourceNode = null;

    // Live-tunable
    this.params = {
      beatThreshold: 1.4,   // fire when bass > rolling avg * threshold
      smoothing: 0.7,       // 0 = raw, 0.95 = very smooth
      beatCooldown: 0.18,   // seconds between beats
    };

    // Per-frame output object. Same reference every frame — worlds can hold it.
    this.data = {
      bass: 0, lowMid: 0, mid: 0, high: 0, treble: 0,
      volume: 0,
      beat: false,
      beatIntensity: 0,
      energy: 0,
      spectrum: new Float32Array(64), // downsampled, smoothed, 0-1 per bin
    };

    this._freq = null;
    this._wave = null;
    this._bassHistory = new Float32Array(43); // ~0.7s at 60fps
    this._bassIdx = 0;
    this._bassFilled = 0;
    this._lastBeatTime = -10;
    this._raw = { bass: 0, lowMid: 0, mid: 0, high: 0, treble: 0, volume: 0 };
  }

  // Must be called from a user gesture.
  ensureContext() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.graphError = String(e && e.message || e);
      return;                       // no graph: level falls back to the element
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5; // extra smoothing is ours, tunable
    this.gain = this.ctx.createGain();
    this.fadeNode = this.ctx.createGain();
    this.sourceNode = this.ctx.createMediaElementSource(this.el);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.fadeNode);
    this.fadeNode.connect(this.ctx.destination);
    this.el.volume = 1;           // the graph carries the level from here on
    this._applyGain();
    // iOS can hand back a context that's still asleep even inside a gesture
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    this._wave = new Uint8Array(this.analyser.fftSize);
  }

  // what the audio graph is actually doing — so a phone can be diagnosed
  // instead of guessed at
  get status() {
    if (this.graphError) return 'no graph (' + this.graphError.slice(0, 24) + ')';
    if (!this.ctx) return 'no graph yet';
    return this.ctx.state + (this.gain ? ' · graph ok' : ' · no gain');
  }

  loadURL(url) {
    this.ensureContext();
    this.el.src = url;
    this.el.load();
  }

  loadFile(file) {
    this.ensureContext();
    if (this._objURL) URL.revokeObjectURL(this._objURL);
    this._objURL = URL.createObjectURL(file);
    this.el.src = this._objURL;
    this.el.load();
  }

  // join-moment chime: quick two-note bell, mixed straight to output
  joinChime() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [freq, dt, dur] of [[659, 0, 0.22], [988, 0.09, 0.3]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.14, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + dur + 0.05);
    }
  }

  _fadeIn() {
    if (!this.fadeNode) return;
    const g = this.fadeNode.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(1, t + 1.4);
    this._fadedOut = false;
  }

  play() { this.ensureContext(); return this.el.play(); }
  pause() { this.el.pause(); }
  get playing() { return !this.el.paused && !this.el.ended; }
  // Volume and mute act on the gain node, which sits AFTER the analyser —
  // so silencing your own speakers leaves the visuals at full strength.
  setVolume(v) { this._vol = v; this._applyGain(); }
  setMuted(m) { this._muted = !!m; this._applyGain(); }
  get muted() { return !!this._muted; }
  _applyGain() {
    const v = this._muted ? 0 : (this._vol == null ? 0.8 : this._vol);
    if (this.gain) { this.gain.gain.value = v; this.el.volume = 1; }
    else this.el.volume = v;      // before the graph exists there's nowhere else
  }
  get duration() { return this.el.duration || 0; }
  get currentTime() { return this.el.currentTime || 0; }
  seek(t) { if (this.duration) this.el.currentTime = t; }

  // Average of bins [lo, hi) normalized to 0-1
  _band(lo, hi) {
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += this._freq[i];
    return sum / ((hi - lo) * 255);
  }

  update(dt) {
    // the exhale: start easing the level down just before the song runs out
    if (this.fadeNode && this.playing && this.el.duration) {
      const left = this.el.duration - this.el.currentTime;
      if (left < 2.2 && !this._fadedOut) {
        this._fadedOut = true;
        const g = this.fadeNode.gain, t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.exponentialRampToValueAtTime(0.0001, t + Math.max(0.3, left - 0.15));
      } else if (left >= 3 && this._fadedOut) {
        this._fadeIn();               // scrubbed back mid-fade: breathe in again
      }
    }
    const d = this.data;
    d.beat = false;
    if (!this.analyser) return d;

    this.analyser.getByteFrequencyData(this._freq);
    this.analyser.getByteTimeDomainData(this._wave);

    // Bin bands. 2048 fft @ 44.1k → ~21.5 Hz/bin, 1024 bins.
    const raw = this._raw;
    raw.bass   = this._band(1, 8);      // ~20-170 Hz
    raw.lowMid = this._band(8, 24);     // ~170-520 Hz
    raw.mid    = this._band(24, 90);    // ~520 Hz-2 kHz
    raw.high   = this._band(90, 280);   // ~2-6 kHz
    raw.treble = this._band(280, 750);  // ~6-16 kHz

    // RMS volume from waveform
    let rms = 0;
    for (let i = 0; i < this._wave.length; i++) {
      const v = (this._wave[i] - 128) / 128;
      rms += v * v;
    }
    raw.volume = Math.min(1, Math.sqrt(rms / this._wave.length) * 2.2);

    // Framerate-independent smoothing toward raw values
    const s = Math.pow(1 - this.params.smoothing, dt * 60 / 8);
    const k = Math.min(1, Math.max(0.02, s));
    for (const key of ['bass', 'lowMid', 'mid', 'high', 'treble', 'volume']) {
      d[key] += (raw[key] - d[key]) * k;
    }

    // 64-bin spectrum (log-ish downsample of the useful range) for terrain-style worlds
    const spec = d.spectrum;
    for (let i = 0; i < 64; i++) {
      const t0 = i / 64, t1 = (i + 1) / 64;
      const lo = Math.floor(Math.pow(t0, 1.6) * 750) + 1;
      const hi = Math.max(lo + 1, Math.floor(Math.pow(t1, 1.6) * 750) + 1);
      let sum = 0;
      for (let b = lo; b < hi; b++) sum += this._freq[b];
      const v = sum / ((hi - lo) * 255);
      spec[i] += (v - spec[i]) * k;
    }

    // Energy: slow-moving average of volume for section-change detection
    d.energy += (raw.volume - d.energy) * Math.min(1, dt * 0.5);

    // Beat detection on raw (unsmoothed) bass vs rolling average
    this._bassHistory[this._bassIdx] = raw.bass;
    this._bassIdx = (this._bassIdx + 1) % this._bassHistory.length;
    this._bassFilled = Math.min(this._bassFilled + 1, this._bassHistory.length);
    let avg = 0;
    for (let i = 0; i < this._bassFilled; i++) avg += this._bassHistory[i];
    avg /= this._bassFilled;

    const now = this.el.currentTime;
    if (
      this._bassFilled > 20 &&
      avg > 0.01 &&
      raw.bass > avg * this.params.beatThreshold &&
      raw.bass > 0.15 &&
      now - this._lastBeatTime > this.params.beatCooldown
    ) {
      d.beat = true;
      d.beatIntensity = Math.min(1, (raw.bass / avg - 1) / (this.params.beatThreshold - 1) * 0.5);
      this._lastBeatTime = now;
    } else {
      // decay intensity so worlds can also lerp off it
      d.beatIntensity *= Math.pow(0.001, dt);
    }

    return d;
  }
}
