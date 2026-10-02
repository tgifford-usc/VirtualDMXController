// Sends DMX over Art-Net. An ArtDmx packet is an 18-byte header followed by
// up to 512 channel values (0–255). Spec: https://art-net.org.uk

import dgram from 'node:dgram';
import dns from 'node:dns';

export const ARTNET_PORT = 6454;
const ID = Buffer.from('Art-Net\0', 'ascii');

export function artDmxPacket(universe, data, sequence = 0) {
  let length = Math.min(data.length, 512);
  if (length % 2) length++; // the spec wants an even length
  const packet = Buffer.alloc(18 + length);
  ID.copy(packet, 0); //                     "Art-Net" + zero byte
  packet.writeUInt16LE(0x5000, 8); //        OpCode: ArtDmx
  packet.writeUInt16BE(14, 10); //           protocol version
  packet[12] = sequence; //                  lets receivers spot out-of-order packets
  packet[13] = 0; //                         physical input port (informational)
  packet[14] = universe & 0xff; //           Sub-Net + Universe
  packet[15] = (universe >> 8) & 0x7f; //    Net
  packet.writeUInt16BE(length, 16); //       number of channels
  Buffer.from(data.buffer, data.byteOffset, Math.min(data.length, length)).copy(packet, 18);
  return packet;
}

export class ArtNetSender {
  constructor(host = '127.0.0.1', port = ARTNET_PORT) {
    this.host = host;
    this.port = port;
    this.sequence = 1;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', err => console.error('Art-Net send error:', err.message));
    this.socket.bind(() => this.socket.setBroadcast(true)); // allows sending to x.x.x.255
    // Look up a name like dmx.offig.com once, not on every packet
    this.address = null;
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err) console.error(`Art-Net: couldn't find ${host} (${err.message})`);
      else this.address = address;
    });
  }

  send(universe, data) {
    if (!this.address) return; // still looking up the host
    this.socket.send(artDmxPacket(universe, data, this.sequence), this.port, this.address);
  }

  nextFrame() {
    this.sequence = this.sequence === 255 ? 1 : this.sequence + 1; // 0 means "not used"
  }

  close() {
    this.socket.close();
  }
}
