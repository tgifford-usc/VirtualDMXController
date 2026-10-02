// 03: Moving heads, with pan and tilt in degrees.
//
// With pan = 0 and tilt = 0 a hanging light points straight down.
// Tilt swings it towards the audience; pan turns it around. This works
// without knowing where the light is, but you have to find the right angles
// by trial and error, like focusing real lights by hand.

import { connect } from '../lib/index.js';

const rig = await connect();
const movers = rig.movers;

movers.setColor(255, 255, 255).setZoom(12);

rig.loop(time => {
  movers.forEach((mover, i) => {
    const pan = 40 * Math.sin(time * 0.7 + i);
    const tilt = 30 + 15 * Math.sin(time * 1.1 + i * 0.5);
    mover.setPanTilt(pan, tilt);
  });
});
