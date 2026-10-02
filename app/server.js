// Web controller: serves the control page and turns simple HTTP requests into
// Art-Net. Browsers can't send Art-Net (UDP) themselves, so the page talks to
// this server and this server talks to the lights.
//
// API (JSON):
//   GET  /api/rig                  the stage and every fixture with its current state
//   GET  /api/fixtures/:name       one fixture
//   POST /api/fixtures/:target     change a fixture, or a group: "all", "movers", "color"
//        body: { "color": [255, 0, 0] | "#ff0000", "white": 0–255, "dimmer": 0–1,
//                "pan": degrees, "tilt": degrees, "aim": [x, y, z],
//                "zoom": degrees, "strobe": flashes/sec, "channels": { "red": 255 } }
//   POST /api/blackout
//
// Example: curl -X POST localhost:3000/api/fixtures/Par%201 -H 'Content-Type: application/json' -d '{"color":"#ff0000"}'

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '../lib/index.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const rig = await connect();

function targets(name) {
  if (name === 'all') return rig.all;
  if (name === 'movers') return rig.movers;
  if (name === 'color') return rig.colorLights;
  return [rig.get(name)];
}

// Apply a command to one fixture, skipping anything it can't do.
function apply(fixture, command) {
  const c = command;
  if (c.color !== undefined && fixture.hasColor) fixture.setColor(c.color);
  if (c.white !== undefined && fixture.has('white')) fixture.setWhite(c.white);
  if (c.dimmer !== undefined) fixture.setDimmer(c.dimmer);
  if (fixture.canMove) {
    if (c.pan !== undefined || c.tilt !== undefined) fixture.setPanTilt(c.pan ?? fixture.state.pan, c.tilt ?? fixture.state.tilt);
    if (c.aim) fixture.aimAt(c.aim);
  }
  if (c.zoom !== undefined && fixture.has('zoom')) fixture.setZoom(c.zoom);
  if (c.strobe !== undefined && fixture.has('strobe')) fixture.setStrobe(c.strobe);
  if (c.channels) for (const [name, value] of Object.entries(c.channels)) fixture.set(name, value);
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function handleApi(req, res, pathname) {
  const fixtureMatch = /^\/api\/fixtures\/(.+)$/.exec(pathname);

  if (req.method === 'GET' && pathname === '/api/rig') return sendJSON(res, 200, rig);
  if (req.method === 'GET' && fixtureMatch) return sendJSON(res, 200, rig.get(decodeURIComponent(fixtureMatch[1])));
  if (req.method === 'POST' && fixtureMatch) {
    const list = targets(decodeURIComponent(fixtureMatch[1]));
    const command = await readJSON(req);
    list.forEach(f => apply(f, command));
    return sendJSON(res, 200, { fixtures: list });
  }
  if (req.method === 'POST' && pathname === '/api/blackout') {
    rig.blackout();
    return sendJSON(res, 200, { ok: true });
  }
  sendJSON(res, 404, { error: `No API route for ${req.method} ${pathname}` });
}

const server = http.createServer(async (req, res) => {
  // Allow pages from anywhere (p5.js editor, your own site...) to use the API.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);

    const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return res.writeHead(403).end();
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') return res.writeHead(404).end('Not found');
    sendJSON(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Controller running at http://localhost:${PORT}`));
