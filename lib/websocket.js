// Sends Art-Net to an online rig: the same ArtDmx packets as over UDP, carried
// inside a secure WebSocket (wss://) with your key. Online rigs use this so
// they know who is sending; on a local network or with real lights, plain UDP
// (artnet.js) is used instead.

import { artDmxPacket } from './artnet.js';

export class WebSocketSender {
  constructor(url, key) {
    if (typeof WebSocket === 'undefined') {
      throw new Error(`Sending to an online rig needs Node 22 or newer (you have ${process.version}).`);
    }
    this.url = new URL(url);
    this.url.searchParams.set('key', key);
    this.sequence = 1;
    this.retryDelay = 1000;
    this.stopped = false;
    this.open();
  }

  open() {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retryDelay = 1000; };

    // The rig explains what's happening, e.g. "Waiting for the teacher to give you control".
    ws.onmessage = event => {
      if (typeof event.data !== 'string') return;
      const { type, message } = JSON.parse(event.data);
      (type === 'error' ? console.error : console.log)(`Rig: ${message}`);
    };

    ws.onclose = event => {
      this.ws = null;
      if (this.stopped) return;
      if (event.code === 4003) return; // refused (wrong key etc.): the reason was already printed; retrying won't help
      console.log(`Lost the connection to the rig; trying again in ${this.retryDelay / 1000}s`);
      setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 15000);
    };
    ws.onerror = () => {}; // onclose follows with the details
    this.ws = ws;
  }

  // Skip frames while connecting, or if the network can't keep up.
  sendPacket(packet) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 64 * 1024) this.ws.send(packet);
  }

  send(universe, data) {
    this.sendPacket(artDmxPacket(universe, data, this.sequence));
  }

  nextFrame() {
    this.sequence = this.sequence === 255 ? 1 : this.sequence + 1;
  }

  close() {
    this.stopped = true;
    this.ws?.close();
  }
}
