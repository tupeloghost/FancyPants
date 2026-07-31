// AudioEngine — Web Audio analysis exposed as one normalized object per frame.
// Worlds read engine.data; they never touch Web Audio directly.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.el = new Audio();
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
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5; // extra smoothing is ours, tunable
    this.gain = this.ctx.createGain();
    this.sourceNode = this.ctx.createMediaElementSource(this.el);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    this._wave = new Uint8Array(this.analyser.fftSize);
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

  play() { this.ensureContext(); return this.el.play(); }
  pause() { this.el.pause(); }
  get playing() { return !this.el.paused && !this.el.ended; }
  setVolume(v) { this.el.volume = v; }
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
