// World registry. Adding a world = one file in /worlds/ + one entry here.
import { createTunnel } from './tunnel.js';

export const WORLDS = {
  tunnel: { label: 'TUNNEL', create: createTunnel },
};
