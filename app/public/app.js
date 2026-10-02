// Browser side of the controller. Everything here goes through the small
// HTTP API in app/server.js, so this page is a good model for building your
// own interface: one fetch() call per change.

// ---------- Talking to the server ----------

const api = {
  getRig: () => fetch('/api/rig').then(r => r.json()),
  blackout: () => fetch('/api/blackout', { method: 'POST' }),
  async update(target, command) {
    const body = JSON.stringify(command);
    document.getElementById('last-request').textContent = `POST /api/fixtures/${encodeURIComponent(target)}\n${body}`;
    const res = await fetch(`/api/fixtures/${encodeURIComponent(target)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.json();
  },
};

// Sliders fire many events a second. Collect changes and send them at most
// 25 times a second, merged per fixture.
const pending = new Map();
let flushTimer = null;

function send(names, command) {
  for (const name of names) pending.set(name, { ...pending.get(name), ...command });
  flushTimer ??= setTimeout(flush, 40);
}

async function flush() {
  flushTimer = null;
  const batch = [...pending];
  pending.clear();
  const results = await Promise.all(batch.map(([name, command]) => api.update(name, command)));
  for (const { fixtures: updated = [] } of results) {
    for (const f of updated) fixtures.set(f.name, f);
  }
  drawPlan();
  showSelection(false);
}

// ---------- State ----------

let rig;
const fixtures = new Map(); // name -> fixture JSON from the server
const selected = new Set();

const $ = id => document.getElementById(id);
const svg = $('plan');
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = svg) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

// ---------- Stage plan (seen from above, audience at the bottom) ----------
// Plan coordinates are metres: across = x, down the page = -z (towards the audience).

function lightColor(f) {
  const d = f.state.dimmer;
  const [r, g, b] = f.hasColor ? f.state.color : [255, 213, 154];
  const lit = f.hasColor ? Math.max(r, g, b) * d : 255 * d;
  if (lit < 8) return '#26262b';
  return `rgb(${r * d}, ${g * d}, ${b * d})`;
}

// Where a moving head's beam hits the floor, from its pan and tilt.
function floorHit(f) {
  if (f.state.aim) return f.state.aim;
  const p = ((f.state.pan + (f.panOffset || 0)) * Math.PI) / 180;
  const t = (f.state.tilt * Math.PI) / 180;
  let d = [Math.sin(t) * Math.sin(p), -Math.cos(t), -Math.sin(t) * Math.cos(p)];
  if (f.mount === 'floor') d = [-d[0], -d[1], d[2]];
  if (d[1] > -0.05) return null; // pointing up or sideways: never reaches the floor
  const k = -f.position[1] / d[1];
  return [f.position[0] + d[0] * k, 0, f.position[2] + d[2] * k];
}

function drawPlan() {
  const { width, depth } = rig.stage;
  const hw = width / 2;
  const xs = [-hw, hw, ...rig.fixtures.map(f => f.position[0])];
  const zs = [0, depth, ...rig.fixtures.map(f => f.position[2])];
  const minX = Math.min(...xs) - 1.2;
  const maxX = Math.max(...xs) + 1.2;
  const minY = -Math.max(...zs) - 1;
  const maxY = -Math.min(...zs) + 1.6;
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  svg.replaceChildren();

  el('rect', { x: -hw, y: -depth, width, height: depth, class: 'stage' });
  for (let x = Math.ceil(-hw); x <= hw; x++) el('line', { x1: x, y1: -depth, x2: x, y2: 0, class: x === 0 ? 'centre' : 'grid' });
  for (let z = 1; z < depth; z++) el('line', { x1: -hw, y1: -z, x2: hw, y2: -z, class: 'grid' });
  el('line', { x1: -hw, y1: -depth, x2: hw, y2: -depth, class: 'cyc' });
  el('text', { x: 0, y: -depth - 0.25, class: 'caption' }).textContent = 'CYC';
  el('text', { x: 0, y: maxY - 0.35, class: 'caption' }).textContent = 'AUDIENCE';
  el('text', { x: -hw + 0.1, y: 0.4, class: 'tick', 'text-anchor': 'start' }).textContent = 'z = 0';
  el('text', { x: hw - 0.1, y: -depth + 0.4, class: 'tick', 'text-anchor': 'end' }).textContent = `z = ${depth}`;

  for (const t of rig.trusses) el('line', { x1: t.from[0], y1: -t.from[2], x2: t.to[0], y2: -t.to[2], class: 'truss' });

  // Beams first, so lights draw on top
  for (const f of fixtures.values()) {
    if (!f.canMove || f.state.dimmer === 0) continue;
    const hit = floorHit(f);
    if (!hit) continue;
    el('line', { x1: f.position[0], y1: -f.position[2], x2: hit[0], y2: -hit[2], class: 'beam', stroke: lightColor(f) });
    el('circle', { cx: hit[0], cy: -hit[2], r: 0.18, class: 'target', stroke: lightColor(f) });
  }

  for (const f of fixtures.values()) {
    const g = el('g', { transform: `translate(${f.position[0]} ${-f.position[2]})`, class: `fixture${selected.has(f.name) ? ' selected' : ''}` });
    g.dataset.name = f.name;
    const fill = lightColor(f);
    if (f.canMove) el('rect', { x: -0.26, y: -0.26, width: 0.52, height: 0.52, rx: 0.12, fill }, g);
    else if (f.profile.includes('cyc')) el('rect', { x: -0.35, y: -0.17, width: 0.7, height: 0.34, rx: 0.05, fill }, g);
    else el('circle', { r: 0.26, fill }, g);
    el('text', { y: 0.62, class: 'name' }, g).textContent = f.name;
  }
}

function toPlan(event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, z: -p.y };
}

let aiming = false;

svg.addEventListener('pointerdown', event => {
  const node = event.target.closest('.fixture');
  if (node) {
    const name = node.dataset.name;
    if (!event.shiftKey) selected.clear();
    if (event.shiftKey && selected.has(name)) selected.delete(name);
    else selected.add(name);
    drawPlan();
    showSelection(true);
    return;
  }
  aiming = selectedFixtures().some(f => f.canMove);
  if (aiming) {
    svg.setPointerCapture(event.pointerId);
    aimAtPointer(event);
  }
});

svg.addEventListener('pointermove', event => {
  const { x, z } = toPlan(event);
  $('cursor').textContent = `x ${x.toFixed(1)}  z ${z.toFixed(1)}`;
  if (aiming) aimAtPointer(event);
});

svg.addEventListener('pointerup', () => { aiming = false; });

function aimAtPointer(event) {
  const { x, z } = toPlan(event);
  const y = Number($('aim-height').value);
  const movers = selectedFixtures().filter(f => f.canMove).map(f => f.name);
  send(movers, { aim: [round(x), y, round(z)] });
}

const round = v => Math.round(v * 100) / 100;

// ---------- Control panel ----------

function selectedFixtures() {
  return [...selected].map(name => fixtures.get(name)).filter(Boolean);
}

// Show the controls that make sense for the selection. When reload is true,
// move the sliders to the state of the first selected light.
function showSelection(reload) {
  const list = selectedFixtures();
  $('selection-title').textContent = list.length ? list.map(f => f.name).join(', ') : 'Nothing selected';
  const can = {
    color: list.some(f => f.hasColor),
    white: list.some(f => f.hasWhite),
    move: list.some(f => f.canMove),
    zoom: list.some(f => f.zoomRange),
    strobe: list.some(f => f.channels.includes('strobe')),
  };
  document.querySelectorAll('[data-needs]').forEach(c => { c.hidden = !can[c.dataset.needs]; });
  $('controls').classList.toggle('empty', !list.length);

  const first = list[0];
  if (first) {
    const s = first.state;
    if (reload) {
      $('color').value = '#' + s.color.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
      $('dimmer').value = s.dimmer;
      $('white').value = s.white;
      $('strobe').value = s.strobe;
      const zoomFixture = list.find(f => f.zoomRange);
      if (zoomFixture) {
        [$('zoom').min, $('zoom').max] = zoomFixture.zoomRange;
        $('zoom').value = zoomFixture.state.zoom ?? zoomFixture.zoomRange[1];
      }
    }
    const mover = list.find(f => f.canMove);
    if (mover) {
      $('pan').value = mover.state.pan;
      $('tilt').value = mover.state.tilt;
    }
  }
  updateOutputs();
}

function updateOutputs() {
  const show = { dimmer: v => `${Math.round(v * 100)}%`, white: v => v, pan: v => `${v}°`, tilt: v => `${v}°`, zoom: v => `${v}°`, strobe: v => (Number(v) ? `${v} Hz` : 'off') };
  for (const [id, format] of Object.entries(show)) document.querySelector(`output[for=${id}]`).textContent = format($(id).value);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const controls = {
  color: v => ({ color: hexToRgb(v) }),
  dimmer: v => ({ dimmer: Number(v) }),
  white: v => ({ white: Number(v) }),
  pan: v => ({ pan: Number(v) }),
  tilt: v => ({ tilt: Number(v) }),
  zoom: v => ({ zoom: Number(v) }),
  strobe: v => ({ strobe: Number(v) }),
};

for (const [id, toCommand] of Object.entries(controls)) {
  $(id).addEventListener('input', () => {
    updateOutputs();
    send([...selected], toCommand($(id).value));
  });
}

document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
  const group = button.dataset.select;
  selected.clear();
  for (const f of fixtures.values()) {
    if (group === 'all' || (group === 'color' && f.hasColor) || (group === 'movers' && f.canMove)) selected.add(f.name);
  }
  drawPlan();
  showSelection(true);
}));

$('blackout').addEventListener('click', async () => {
  await api.blackout();
  await load();
});

// ---------- Start ----------

async function load() {
  rig = await api.getRig();
  fixtures.clear();
  for (const f of rig.fixtures) fixtures.set(f.name, f);
  drawPlan();
  showSelection(true);
}

load();
