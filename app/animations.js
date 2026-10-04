// Animations the control page can start and stop: the shows from examples/02–04,
// ready to run on any rig. Add your own here and it gets a button on the page.
//
// Each one has:
//   title   the button's label
//   lights  which lights it drives. Starting an animation stops any other one
//           using the same lights, so a colour chase and a moving-head show can
//           run together, but two moving-head shows can't.
//   start   called with the rig; sets things up and returns a function that
//           runs about 40 times a second, like rig.loop(). time is in seconds.

// Hue (0–1) to RGB (0–255)
function hue(h) {
  const f = n => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

export const animations = {
  // examples/02-rainbow-chase.js
  rainbow: {
    title: 'Rainbow chase',
    lights: 'colour',
    start(rig) {
      const pars = rig.byProfile('par-rgbw');
      const cycs = rig.byProfile('cyc-rgb');
      return time => {
        pars.forEach((par, i) => {
          par.setColor(hue((time * 0.2 + i / pars.length) % 1));
          // A wave of brightness running along the row
          par.setDimmer(0.5 + 0.5 * Math.sin(time * 3 - i * 0.8));
        });
        cycs.setColor(hue((time * 0.05) % 1)).setDimmer(0.6);
      };
    },
  },

  // examples/03-pan-tilt.js
  sweep: {
    title: 'Moving head sweep',
    lights: 'movers',
    start(rig) {
      const movers = rig.movers;
      movers.setColor(255, 255, 255).setDimmer(1).setZoom(12);
      return time => {
        movers.forEach((mover, i) => {
          const pan = 40 * Math.sin(time * 0.7 + i);
          const tilt = 30 + 15 * Math.sin(time * 1.1 + i * 0.5);
          mover.setPanTilt(pan, tilt);
        });
      };
    },
  },

  // examples/04-follow-spot.js
  follow: {
    title: 'Follow spot',
    lights: 'movers',
    start(rig) {
      const movers = rig.movers;
      movers.setColor(255, 200, 120).setDimmer(1).setZoom(8);
      return time => {
        // A figure of eight around the stage, at chest height
        const x = 3.5 * Math.sin(time * 0.5);
        const z = 3.5 + 1.5 * Math.sin(time);
        movers.aimAt(x, 1.4, z);
      };
    },
  },
};

// ---------- Running them ----------

const running = new WeakMap(); // rig -> Map(lights -> { name, step })

function runningOn(rig) {
  if (!running.has(rig)) {
    const now = new Map();
    running.set(rig, now);
    rig.loop((time, dt) => {
      for (const { step } of now.values()) step(time, dt);
    });
  }
  return running.get(rig);
}

export function startAnimation(rig, name) {
  const animation = animations[name];
  if (!animation) throw new Error(`No animation called "${name}". There are: ${Object.keys(animations).join(', ')}`);
  runningOn(rig).set(animation.lights, { name, step: animation.start(rig) });
}

export function stopAnimation(rig, name) {
  const now = runningOn(rig);
  for (const [lights, anim] of now) if (anim.name === name) now.delete(lights);
}

export function stopAnimations(rig) {
  runningOn(rig).clear();
}

// For the page: every animation, and whether it's running on this rig
export function listAnimations(rig) {
  const names = new Set([...runningOn(rig).values()].map(a => a.name));
  return Object.entries(animations).map(([name, { title }]) => ({ name, title, running: names.has(name) }));
}
