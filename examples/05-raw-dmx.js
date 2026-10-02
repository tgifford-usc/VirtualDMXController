// 05: Under the hood. Every fixture is just a few numbers (0–255) in a
// universe of 512 channels. This prints the patch, then drives a light by
// raw channel values instead of the friendly methods.

import { connect } from '../lib/index.js';

const rig = await connect();

console.log('\nUniverse  Channels  Fixture     Channel layout');
for (const f of rig.fixtures) {
  const range = `${f.address}–${f.address + f.channels.length - 1}`;
  console.log(`${String(f.universe).padEnd(9)} ${range.padEnd(9)} ${f.name.padEnd(11)} ${f.channels.join(', ')}`);
}

const par = rig.get('Par 1');
par.set('dimmer', 255).set('red', 255).set('blue', 80);
console.log(`\nPar 1 values: ${[...par.values].join(' ')}  (channels ${par.address}–${par.address + par.channels.length - 1})`);

// What setPanTilt() really sends: 16-bit values split over two channels.
const mover = rig.get('Mover 1');
mover.setColor(255, 255, 255).setPanTilt(90, 45);
for (const name of ['pan', 'panFine', 'tilt', 'tiltFine']) console.log(`Mover 1 ${name.padEnd(8)} = ${mover.get(name)}`);
