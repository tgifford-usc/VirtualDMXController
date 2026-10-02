// 04: Point every moving head at the same spot with aimAt(x, y, z).
//
// aimAt uses each light's position from rig.json to work out its pan and
// tilt, so all four beams meet even though they hang in different places.
// Coordinates are metres: x across the stage (0 = centre), y up (0 = floor),
// z upstage (0 = front edge of the stage).

import { connect } from '../lib/index.js';

const rig = await connect();
const movers = rig.movers;

movers.setColor(255, 200, 120).setZoom(8);

rig.loop(time => {
  // A figure of eight around the stage, at chest height
  const x = 3.5 * Math.sin(time * 0.5);
  const z = 3.5 + 1.5 * Math.sin(time);
  movers.aimAt(x, 1.4, z);
});
