// A controller server shared by many people (MULTI_USER=on), such as the one
// your teacher runs online. Each person's browser sends their stage and key with
// every request, and this keeps a connection to the rig for each of them.
//
// When you run the controller yourself, none of this is used: there's one rig,
// from your settings file, and it sends Art-Net over UDP when there's no key,
// exactly as a real lighting install does.

import { connect } from '../lib/index.js';

const IDLE = 2 * 60 * 1000; //    close a connection after this long without requests (open pages check in every few seconds)
const CONNECT_TIMEOUT = 8000; //  how long to wait for the rig to accept a key
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 300;

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// "main", a stage name, or a stage address like https://dmx.example.com/stage/ana/ -> "main" or "ana"
export function stageName(text) {
  text = String(text || '').trim().toLowerCase();
  if (text === 'main') return 'main';
  const match = /(?:^|\/stage\/)([a-z0-9-]+)\/?$/.exec(text);
  return match ? match[1] : null;
}

export class Sessions {
  // rigUrl: the rig's address as this server reaches it, e.g. http://virtualdmx:8080/
  // publicUrl: the same rig as people's browsers reach it, for "watch your stage" links
  constructor(rigUrl, publicUrl = rigUrl) {
    this.root = new URL(rigUrl.endsWith('/') ? rigUrl : `${rigUrl}/`);
    this.publicRoot = new URL(publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`);
    this.sessions = new Map(); // "stage key" -> { rig: Promise<Rig>, lastUsed }
    setInterval(() => this.closeIdle(), 30 * 1000).unref();
  }

  stageUrl(stage, root = this.root) {
    return new URL(stage === 'main' ? './' : `stage/${stage}/`, root).href;
  }

  // The rig for this request, connecting first if this person hasn't been here lately.
  async rigFor(req) {
    const key = String(req.headers['x-dmx-key'] || '');
    const stage = stageName(req.headers['x-dmx-stage']);
    if (!key || !stage) throw httpError(401, 'Enter your stage and key to connect.');

    const id = `${stage} ${key}`;
    let session = this.sessions.get(id);
    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) throw httpError(503, 'Too many people are connected right now. Try again in a few minutes.');
      session = { rig: this.open(stage, key) };
      this.sessions.set(id, session);
    }
    session.lastUsed = Date.now();

    try {
      const rig = await session.rig;
      // The rig can refuse later too, e.g. when the teacher removes someone
      if (rig.output.status.refused) throw httpError(403, rig.output.status.message);
      return rig;
    } catch (err) {
      if (this.sessions.get(id) === session) this.close(id);
      throw err;
    }
  }

  async open(stage, key) {
    let rig;
    try {
      rig = await connect({ rig: this.stageUrl(stage), key, main: false, quiet: true });
    } catch (err) {
      throw httpError(404, stage === 'main' ? "Couldn't reach the rig. Try again in a moment." : `Couldn't find the stage "${stage}". Check your stage address.`);
    }
    const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error("The rig didn't answer. Try again in a moment.")), CONNECT_TIMEOUT));
    try {
      await Promise.race([rig.output.ready, timeout]);
    } catch (err) {
      rig.close();
      throw httpError(403, err.message);
    }
    rig.watchUrl = this.stageUrl(stage, this.publicRoot); // where the person can watch their lights
    return rig;
  }

  close(id) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    session?.rig.then(rig => rig.close(), () => {});
  }

  closeIdle() {
    for (const [id, session] of this.sessions) {
      if (Date.now() - session.lastUsed > IDLE) this.close(id);
    }
  }
}
