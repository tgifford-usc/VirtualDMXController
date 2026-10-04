// The rig: every fixture, plus the Art-Net output that keeps sending their
// DMX values about 40 times a second (DMX is always streamed continuously,
// not sent once).

import fs from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtNetSender } from './artnet.js';
import { WebSocketSender } from './websocket.js';
import { Fixture } from './fixture.js';

// A list of fixtures you can control together:
//   rig.movers.setColor(0, 0, 255).aimAt(0, 0, 4)
// It's a normal array too, so rig.pars[0], forEach and filter all work.
export class FixtureGroup extends Array {
  static get [Symbol.species]() {
    return FixtureGroup;
  }
}
for (const method of ['setColor', 'setWhite', 'setDimmer', 'off', 'setPan', 'setTilt', 'setPanTilt', 'aimAt', 'setZoom', 'setStrobe', 'set']) {
  FixtureGroup.prototype[method] = function (...args) {
    this.forEach(fixture => fixture[method](...args));
    return this;
  };
}

export class Rig {
  constructor(data, { output, fps = 40 }) {
    this.stage = { width: 12, depth: 8, height: 7, ...data.stage };
    this.trusses = data.trusses || [];
    this.fixtures = FixtureGroup.from(
      (data.fixtures || [])
        .filter(def => data.profiles?.[def.profile])
        .map(def => new Fixture(def, data.profiles[def.profile]))
    );

    this.loops = [];
    this.output = output; // an ArtNetSender (UDP) or WebSocketSender (online), see connect()
    this.universes = new Map();
    for (const f of this.fixtures) {
      if (!this.universes.has(f.universe)) this.universes.set(f.universe, new Uint8Array(512));
    }

    this.startTime = performance.now();
    this.lastFrame = this.startTime;
    this.timer = setInterval(() => this.frame(), 1000 / fps);
  }

  // ---------- Finding fixtures ----------

  get(name) {
    const fixture = this.fixtures.find(f => f.name === name);
    if (!fixture) throw new Error(`No fixture called "${name}". The rig has: ${this.fixtures.map(f => f.name).join(', ')}`);
    return fixture;
  }

  get all() {
    return this.fixtures;
  }

  // Lights with pan and tilt
  get movers() {
    return this.fixtures.filter(f => f.canMove);
  }

  // Lights with RGB colour mixing
  get colorLights() {
    return this.fixtures.filter(f => f.hasColor);
  }

  byProfile(profile) {
    return this.fixtures.filter(f => f.profile === profile);
  }

  where(test) {
    return this.fixtures.filter(test);
  }

  // ---------- Output ----------

  // Run fn(time, dt) before every frame is sent. time and dt are in seconds.
  // This is the place for anything animated.
  loop(fn) {
    this.loops.push(fn);
    return this;
  }

  blackout() {
    this.fixtures.off();
    return this;
  }

  // Write a raw value straight into the output (universe, channel 1–512).
  // Fixtures overwrite their own channels every frame, so use this for
  // channels that no fixture in the rig uses.
  setChannel(universe, channel, value) {
    if (!this.universes.has(universe)) this.universes.set(universe, new Uint8Array(512));
    this.universes.get(universe)[channel - 1] = value;
    return this;
  }

  frame() {
    const now = performance.now();
    const time = (now - this.startTime) / 1000;
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    for (const fn of this.loops) {
      try {
        fn(time, dt);
      } catch (err) {
        console.error(err);
      }
    }
    for (const f of this.fixtures) this.universes.get(f.universe).set(f.values, f.address - 1);
    for (const [universe, data] of this.universes) this.output.send(universe, data);
    this.output.nextFrame();
  }

  close() {
    clearInterval(this.timer);
    this.output.close();
  }

  toJSON() {
    return { stage: this.stage, trusses: this.trusses, fixtures: this.fixtures };
  }
}

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let settingsFile; // which settings file was used, once loaded

// Settings can live in a file in this project's folder instead of being typed
// each time: dmx-settings.txt (downloaded from the rig's join page), or .env.
// Lines look like  KEY=abc123 ; lines starting with # are ignored. If there are
// several (dmx-settings (1).txt...), the newest is used. Anything set on the
// command line wins over the file.
export function loadSettingsFile(dir = PROJECT_DIR) {
  if (settingsFile !== undefined) return settingsFile;
  const files = readdirSync(dir)
    .filter(name => /^dmx-settings.*\.txt$/i.test(name) || name === '.env')
    .map(name => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  settingsFile = files[0] || null;
  if (settingsFile) {
    for (const line of readFileSync(settingsFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return settingsFile;
}

// Work out where the rig is and how to send to it, from options, environment
// variables or the settings file:
//   RIG_URL      your stage's web address, e.g. https://dmx.offig.com/stage/ana/ (default: the main
//                stage at SERVER). Can also be a rig.json URL, or a rig.json file for real lights.
//   KEY          your key for an online rig. With a key, Art-Net goes over a secure WebSocket;
//                without one, it goes over plain UDP, as on a local network or to real lights.
//   ARTNET_HOST  where to send UDP Art-Net (default: the rig's host)
//   SERVER       shortcut: localhost for a rig on this computer (default dmx.offig.com)
// Run with --main (npm run app:main) to send to the main stage instead of your own.
export function settings({ rig, key, host, main = process.argv.includes('--main') } = {}) {
  loadSettingsFile();
  const server = process.env.SERVER || 'dmx.offig.com';
  const defaultRig = server === 'localhost' || server === '127.0.0.1' ? `http://${server}:8080/` : `https://${server}/`;
  rig = rig || process.env.RIG_URL || process.env.RIG || defaultRig;
  key = key ?? process.env.KEY ?? '';
  // The main stage lives at the top of the same site: .../stage/ana/ -> .../
  if (main && /^https?:/.test(rig)) rig = new URL(rig).href.replace(/stage\/[^/]+\/?$/, '');
  let json = rig;
  let base = null; // the stage's address, if the rig is on a web server
  if (/^https?:/.test(rig)) {
    const url = new URL(rig);
    if (url.pathname.endsWith('.json')) {
      base = new URL('./', url).href;
    } else {
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      base = url.href;
      json = new URL('rig.json', url).href;
    }
  }
  if (key && !base) throw new Error('KEY needs RIG_URL to be the rig\'s web address, e.g. https://dmx.offig.com/');
  let input = null;
  if (key) {
    input = new URL('input', base);
    input.protocol = input.protocol === 'https:' ? 'wss:' : 'ws:';
  }
  host = host || process.env.ARTNET_HOST || (base ? new URL(base).hostname : '127.0.0.1');
  return { rig, json, base, key, host, input, file: settingsFile };
}

// Load the rig description and start sending.
export async function connect({ fps = 40, ...options } = {}) {
  const s = settings(options);
  let data;
  try {
    if (s.base) {
      const res = await fetch(s.json);
      // Show the server's own explanation (e.g. "There's no stage called…", or the
      // country-block page with your address) rather than a JSON error.
      if (!res.ok) throw new Error((await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || `error ${res.status}`);
      data = await res.json();
    } else {
      data = JSON.parse(await fs.readFile(s.json, 'utf8'));
    }
  } catch (err) {
    throw new Error(
      `Couldn't load the rig from ${s.json} (${err.message}).\n` +
      'Is the VirtualDMX server running? Or set RIG_URL to another address or a rig.json file.'
    );
  }
  if (s.file) console.log(`Using settings from ${path.basename(s.file)}`);
  const output = s.input ? new WebSocketSender(s.input, s.key) : new ArtNetSender(s.host);
  const result = new Rig(data, { output, fps });
  if (s.input) {
    console.log(`Loaded ${result.fixtures.length} fixtures from ${s.json}; sending Art-Net securely to ${s.base}`);
  } else {
    console.log(`Loaded ${result.fixtures.length} fixtures from ${s.json}; sending Art-Net (UDP) to ${s.host}`);
    if (s.base?.startsWith('https:')) console.log('Online rigs usually need your key: set KEY=... as in your teacher\'s instructions.');
  }
  return result;
}
