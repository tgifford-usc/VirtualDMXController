// One light. You set what you want (colour, brightness, where it points) and
// the fixture works out the DMX channel values from its profile.
//
// Units:
//   colour      0–255 per component, like CSS rgb(255, 0, 0), or "#ff0000"
//   dimmer      0–1, like CSS opacity (0 = off, 1 = full)
//   pan / tilt  degrees; 0 / 0 points straight down for a hanging light
//   zoom        beam angle in degrees
//   strobe      flashes per second (0 = no strobe)
//
// Every setter returns the fixture, so calls can be chained:
//   rig.get('Par 1').setColor(255, 0, 0).setDimmer(0.5)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toDegrees = rad => (rad * 180) / Math.PI;

export function parseColor(r, g, b) {
  if (Array.isArray(r)) return parseColor(...r);
  if (typeof r === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(r.trim());
    if (!m) throw new Error(`Colour "${r}" should look like "#ff8800"`);
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  return [r, g, b].map(v => clamp(Number(v) || 0, 0, 255));
}

export class Fixture {
  constructor(def, profile) {
    this.name = def.name;
    this.profile = def.profile; // profile name, e.g. "moving-head"
    this.universe = def.universe ?? 0;
    this.address = def.address ?? 1; // first DMX channel, 1–512
    this.channels = profile.channels; // what each channel does, in order
    this.position = def.position || [0, 0, 0]; // metres: [x across, y up, z upstage]
    this.mount = def.mount || 'hanging';
    this.panOffset = def.panOffset || 0;
    this.panRange = profile.panRange || 540;
    this.tiltRange = profile.tiltRange || 270;
    this.zoomRange = profile.zoomRange || null;

    this.values = new Uint8Array(this.channels.length); // the DMX values we send
    this.index = {}; // channel name -> offsets within this fixture
    this.channels.forEach((name, i) => (this.index[name] ||= []).push(i));

    this.canMove = this.has('pan') || this.has('tilt');
    this.hasColor = this.has('red') || this.has('green') || this.has('blue');

    // Lights start dark. Colour lights start at full dimmer so setColor() alone
    // turns them on; lights without colour wait for setDimmer().
    this.state = { color: [0, 0, 0], white: 0, dimmer: this.hasColor ? 1 : 0, pan: 0, tilt: 0, zoom: null, strobe: 0, aim: null };
    this.warned = new Set();
    this.updateLight();
    if (this.canMove) this.setPanTilt(0, 0);
  }

  has(channel) {
    return channel in this.index;
  }

  // ---------- Low level: raw channel values ----------

  // Set a channel by name to a raw DMX value (0–255), e.g. fixture.set('red', 255).
  set(channel, value) {
    if (!this.has(channel)) return this.warn(`set-${channel}`, `has no "${channel}" channel (it has: ${this.channels.join(', ')})`);
    for (const i of this.index[channel]) this.values[i] = clamp(Math.round(value), 0, 255);
    return this;
  }

  get(channel) {
    return this.has(channel) ? this.values[this.index[channel][0]] : undefined;
  }

  // ---------- Colour and brightness ----------

  setColor(r, g, b) {
    if (!this.hasColor) return this.warn('color', 'has no colour channels — use setDimmer() instead');
    this.state.color = parseColor(r, g, b);
    return this.updateLight();
  }

  setWhite(value) {
    if (!this.has('white')) return this.warn('white', 'has no white channel');
    this.state.white = clamp(value, 0, 255);
    return this.updateLight();
  }

  setDimmer(level) {
    this.state.dimmer = clamp(level, 0, 1);
    return this.updateLight();
  }

  off() {
    return this.setDimmer(0);
  }

  // Fixtures without a dimmer channel get their brightness by scaling the colour.
  updateLight() {
    const { color, white, dimmer } = this.state;
    let scale = dimmer;
    if (this.has('dimmer')) {
      this.set('dimmer', dimmer * 255);
      scale = 1;
    }
    if (this.has('red')) this.set('red', color[0] * scale);
    if (this.has('green')) this.set('green', color[1] * scale);
    if (this.has('blue')) this.set('blue', color[2] * scale);
    if (this.has('white')) this.set('white', white * scale);
    return this;
  }

  // ---------- Movement ----------

  setPan(degrees) {
    return this.setPanTilt(degrees, this.state.tilt);
  }

  setTilt(degrees) {
    return this.setPanTilt(this.state.pan, degrees);
  }

  // Pan and tilt are 16-bit: a coarse channel and a fine channel, so
  // moving heads can move smoothly. The middle of the range (32768) is 0°.
  setPanTilt(pan, tilt) {
    if (!this.canMove) return this.warn('move', 'cannot pan or tilt');
    this.state.pan = clamp(pan, -this.panRange / 2, this.panRange / 2);
    this.state.tilt = clamp(tilt, -this.tiltRange / 2, this.tiltRange / 2);
    this.state.aim = null;
    this.write16('pan', 'panFine', this.state.pan / this.panRange + 0.5);
    this.write16('tilt', 'tiltFine', this.state.tilt / this.tiltRange + 0.5);
    return this;
  }

  write16(coarse, fine, fraction) {
    const value = Math.round(clamp(fraction, 0, 1) * 65535);
    if (this.has(coarse)) this.set(coarse, value >> 8);
    if (this.has(fine)) this.set(fine, value & 255);
  }

  // Point the light at a spot on stage, in metres (same coordinates as rig.json).
  // Works out pan and tilt from where the light hangs. y = 0 is the floor,
  // y = 1.7 is about head height.
  aimAt(x, y, z) {
    if (Array.isArray(x)) [x, y, z] = x;
    else if (typeof x === 'object') ({ x, y, z } = x);
    if (!this.canMove) return this.warn('move', 'cannot pan or tilt, so it cannot aim');

    let [dx, dy, dz] = [x - this.position[0], y - this.position[1], z - this.position[2]];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return this;
    [dx, dy, dz] = [dx / length, dy / length, dz / length];

    // A floor-standing light is a hanging one turned upside down.
    if (this.mount === 'floor') [dx, dy] = [-dx, -dy];

    // For a hanging light, tilt 0 points straight down and pan 0 tilts it
    // towards the audience. Its beam direction is:
    //   (sin(tilt)·sin(pan),  −cos(tilt),  −sin(tilt)·cos(pan))
    // Solve that for pan and tilt:
    const tilt = toDegrees(Math.acos(clamp(-dy, -1, 1)));
    const pan = Math.hypot(dx, dz) < 1e-4 ? this.state.pan : toDegrees(Math.atan2(dx, -dz)) - this.panOffset;

    // Several pan/tilt pairs point the same way (pan + 180° with the tilt
    // flipped, or pan ± 360°). Like a real desk, choose the reachable one
    // closest to where the light is now, so it moves as little as possible.
    const options = [];
    for (const turn of [-720, -360, 0, 360, 720]) {
      options.push([pan + turn, tilt], [pan + 180 + turn, -tilt]);
    }
    const reachable = options.filter(([p, t]) => Math.abs(p) <= this.panRange / 2 && Math.abs(t) <= this.tiltRange / 2);
    if (!reachable.length) return this.warn('reach', `cannot point at [${x}, ${y}, ${z}] (out of its pan/tilt range)`);
    const distance = ([p, t]) => Math.abs(p - this.state.pan) + Math.abs(t - this.state.tilt);
    const [bestPan, bestTilt] = reachable.sort((a, b) => distance(a) - distance(b))[0];

    this.setPanTilt(bestPan, bestTilt);
    this.state.aim = [x, y, z];
    return this;
  }

  // ---------- Beam ----------

  setZoom(degrees) {
    if (!this.has('zoom') || !this.zoomRange) return this.warn('zoom', 'has no zoom');
    const [narrow, wide] = this.zoomRange;
    this.state.zoom = clamp(degrees, narrow, wide);
    return this.set('zoom', ((this.state.zoom - narrow) / (wide - narrow)) * 255);
  }

  // The Virtual DMX profiles use 0–9 = no strobe, 10–255 = 1 to 20 flashes per second.
  setStrobe(hz) {
    if (!this.has('strobe')) return this.warn('strobe', 'has no strobe');
    this.state.strobe = hz > 0 ? clamp(hz, 1, 20) : 0;
    return this.set('strobe', hz > 0 ? 10 + ((this.state.strobe - 1) / 19) * 245 : 0);
  }

  // ---------- Helpers ----------

  warn(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      console.warn(`${this.name} ${message}`);
    }
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      profile: this.profile,
      universe: this.universe,
      address: this.address,
      channels: this.channels,
      position: this.position,
      mount: this.mount,
      panOffset: this.panOffset,
      canMove: this.canMove,
      hasColor: this.hasColor,
      hasWhite: this.has('white'),
      zoomRange: this.has('zoom') ? this.zoomRange : null,
      state: this.state,
      dmx: [...this.values],
    };
  }
}
