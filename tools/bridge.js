// Bridge: lets software that only speaks Art-Net over UDP (TouchDesigner,
// QLC+, Max...) control an online rig. Point that software at this computer
// (127.0.0.1, port 6454) as if the rig were here; the bridge forwards each
// Art-Net packet, unchanged, over a secure connection with your key.
//
//   RIG_URL=https://dmx.offig.com/stage/ana/ KEY=your-key npm run bridge
//
// BRIDGE_PORT changes the UDP port it listens on (default 6454).

import dgram from 'node:dgram';
import { settings, WebSocketSender, ARTNET_PORT } from '../lib/index.js';

const s = settings();
if (!s.input) {
  console.error('The bridge is for online rigs. Set RIG_URL to the stage address and KEY to your key, e.g.\n' +
    '  RIG_URL=https://dmx.offig.com/stage/ana/ KEY=your-key npm run bridge');
  process.exit(1);
}

const port = Number(process.env.BRIDGE_PORT) || ARTNET_PORT;
const output = new WebSocketSender(s.input, s.key);
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const seen = new Set();

udp.on('message', (packet, from) => {
  // Only forward ArtDmx: "Art-Net\0" followed by OpCode 0x5000
  if (packet.length < 18 || packet.toString('latin1', 0, 8) !== 'Art-Net\0' || packet.readUInt16LE(8) !== 0x5000) return;
  if (!seen.has(from.address)) {
    seen.add(from.address);
    console.log(`Forwarding Art-Net from ${from.address} to ${s.base}`);
  }
  output.sendPacket(packet);
});

udp.on('error', err => {
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${port} is already in use (is VirtualDMX or other Art-Net software listening here?). Close it, or set BRIDGE_PORT.`
    : err.message);
  process.exit(1);
});

udp.bind(port, () => console.log(`Bridge listening for Art-Net on port ${port}. Send to 127.0.0.1 from your lighting software.`));
