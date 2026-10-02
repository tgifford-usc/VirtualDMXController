// 02: Animate with rig.loop(). Your function runs about 40 times a second,
// just before each DMX frame is sent; time is in seconds.

import { connect } from '../lib/index.js';

const rig = await connect();
const pars = rig.byProfile('par-rgbw');

// Hue (0–1) to RGB (0–255)
function hue(h) {
  const f = n => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

rig.loop(time => {
  pars.forEach((par, i) => {
    par.setColor(hue((time * 0.2 + i / pars.length) % 1));
    // A wave of brightness running along the row
    par.setDimmer(0.5 + 0.5 * Math.sin(time * 3 - i * 0.8));
  });

  rig.byProfile('cyc-rgb').setColor(hue((time * 0.05) % 1)).setDimmer(0.6);
});
