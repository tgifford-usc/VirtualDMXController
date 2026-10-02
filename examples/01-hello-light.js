// 01: Turn one light on.
// Run the VirtualDMX server first, then: node examples/01-hello-light.js

import { connect } from '../lib/index.js';

const rig = await connect();

// Find a light by its name in rig.json and give it a colour (0–255 each).
rig.get('Par 3').setColor(255, 0, 0);

// Brightness goes from 0 to 1.
rig.get('Par 4').setColor('#00aaff').setDimmer(0.5);

// Lights without colour mixing (like the front-of-house lights) only have a dimmer.
rig.get('FOH L').setDimmer(0.8);

// A group of lights takes the same commands.
rig.byProfile('cyc-rgb').setColor(40, 0, 120);

console.log('Lights are on. DMX keeps streaming until you press Ctrl+C.');
