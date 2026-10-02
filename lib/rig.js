// The rig: every fixture, plus the Art-Net output that keeps sending their
// DMX values about 40 times a second (DMX is always streamed continuously,
// not sent once).

import fs from 'node:fs/promises';
import { ArtNetSender } from './artnet.js';
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
  constructor(data, { host = '127.0.0.1', fps = 40 } = {}) {
    this.stage = { width: 12, depth: 8, height: 7, ...data.stage };
    this.trusses = data.trusses || [];
    this.fixtures = FixtureGroup.from(
      (data.fixtures || [])
        .filter(def => data.profiles?.[def.profile])
        .map(def => new Fixture(def, data.profiles[def.profile]))
    );

    this.loops = [];
    this.output = new ArtNetSender(host);
    this.host = host;
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

// The online Virtual DMX rig. For a rig on this computer, set SERVER=localhost
// (or set RIG and ARTNET_HOST separately).
const SERVER = process.env.SERVER || 'dmx.offig.com';
const DEFAULT_RIG = SERVER === 'localhost' || SERVER === '127.0.0.1' ? `http://${SERVER}:8080/rig.json` : `https://${SERVER}/rig.json`;

// Load the rig description and start sending.
//   rig:  URL or file path of rig.json (default: the Virtual DMX server at SERVER)
//   host: where to send Art-Net (default: SERVER)
export async function connect({
  rig = process.env.RIG || DEFAULT_RIG,
  host = process.env.ARTNET_HOST || SERVER,
  fps = 40,
} = {}) {
  let data;
  try {
    data = /^https?:/.test(rig) ? await (await fetch(rig)).json() : JSON.parse(await fs.readFile(rig, 'utf8'));
  } catch (err) {
    throw new Error(
      `Couldn't load the rig from ${rig} (${err.message}).\n` +
      'Is the VirtualDMX server running? Or set RIG to another URL or a rig.json file.'
    );
  }
  const result = new Rig(data, { host, fps });
  console.log(`Loaded ${result.fixtures.length} fixtures from ${rig}; sending Art-Net to ${host}`);
  return result;
}
