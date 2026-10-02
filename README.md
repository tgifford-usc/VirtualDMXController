# Virtual DMX Controller

A starting point for controlling stage lights from your own code. It sends **Art-Net**, so it drives the [VirtualDMX](../VirtualDMX) rig, and real lights too through an Art-Net node.

It has three parts:

| | What | Use it to |
| --- | --- | --- |
| `lib/` | A small JavaScript library: `setColor`, `setDimmer`, `setPanTilt`, `aimAt`… | Write show scripts in Node |
| `examples/` | Short numbered scripts, from "turn a light on" to "follow spot" | Learn the library |
| `app/` | A web controller: a Node server with a JSON API, and a page with a stage plan | Build your own interface |

You need Node 18 or newer. There are no packages to install.

## Quick start

1. Open the rig at <https://dmx.offig.com> to watch the lights.
2. In this folder, run an example:

```bash
npm run hello      # examples/01-hello-light.js
npm run rainbow    # 02: animate with rig.loop()
npm run pantilt    # 03: moving heads with pan/tilt in degrees
npm run follow     # 04: aim every moving head at one moving point
npm run raw        # 05: the raw DMX numbers underneath
npm run app        # the web controller, at http://localhost:3000
```

Run **one sender at a time**. If two programs send the same universe, the rig shows whichever packet arrived last and the lights flicker between them. The online rig is shared by everyone, so agree who's driving.

To use a rig running on your own computer instead (in the `VirtualDMX` folder, `npm start`, then open <http://localhost:8080>), put `SERVER=localhost` in front of the command:

```bash
SERVER=localhost npm run hello
```

## How lighting control works

- **DMX universe:** 512 channels, each a number from 0 to 255. Art-Net carries universes over a network as UDP packets, about 40 times a second. The values are sent continuously, not once, so the library keeps sending until you stop it.
- **Fixture profile:** what each channel of a light does. A `par-rgbw` uses 6 channels: dimmer, red, green, blue, white, strobe.
- **Patch:** which light starts at which channel (its **address**). Par 1 is at channel 1, so its red is channel 2.
- **Attributes:** real lighting desks hide the channel numbers. You set intensity, colour and position, and the desk works out the channel values from the profile. This library does the same.

The library loads the rig description (`rig.json`) from the VirtualDMX server. It therefore knows every light's profile and address, and also **where each light hangs**.

### Pointing moving heads: pan/tilt vs. aimAt

There are two ways to point a moving head, the same two that real desks use:

1. **Pan and tilt in degrees** (`setPanTilt(40, 30)`). This works without knowing where the light is, but you find the angles by trial and error. In a real theatre, operators save these as presets ("downstage centre").
2. **A point on stage** (`aimAt(x, y, z)`). The library knows the light's position and how it's mounted, and solves for pan and tilt. Four lights in different places all hit the same spot. High-end desks (grandMA, ETC Eos) offer this as their 3D or "focus point" feature.

The maths, for a hanging light: tilt 0 points straight down, and pan 0 tilts it towards the audience. The beam direction is:

```
(sin(tilt)·sin(pan),  −cos(tilt),  −sin(tilt)·cos(pan))
```

`aimAt` turns the direction to the target into pan and tilt using `acos` and `atan2`. More than one pan/tilt pair points the same way (for example pan + 180° with the tilt flipped), so it picks the reachable one closest to the light's current position, as a real desk does. See `aimAt` in `lib/fixture.js`.

### Coordinates

Metres, seen from the audience, the same as in VirtualDMX's `rig.json`:

- **x:** across the stage, 0 is centre, + is to the audience's right (which theatre people call stage left)
- **y:** up from the stage floor; about 1.7 is head height
- **z:** 0 is the front edge of the stage, + goes upstage toward the cyc

## The library

```js
import { connect } from '../lib/index.js';

const rig = await connect(); // loads rig.json from VirtualDMX and starts sending

const par = rig.get('Par 1'); // find a light by name
par.setColor(255, 0, 0); // red, green, blue: 0–255, or '#ff0000'
par.setDimmer(0.5); // 0–1
par.setColor('#00ffaa').setDimmer(1); // calls chain

const mover = rig.get('Mover 1');
mover.setPanTilt(45, 30); // degrees
mover.aimAt(0, 1.7, 3.5); // point at a spot on stage (metres)
mover.setZoom(10); // beam angle in degrees
mover.setStrobe(8); // flashes per second, 0 = off

rig.loop((time, dt) => {
  // runs about 40 times a second, just before DMX is sent
  rig.movers.aimAt(3 * Math.sin(time), 0, 4);
});

rig.blackout();
```

| Fixture method | Notes |
| --- | --- |
| `setColor(r, g, b)` / `setColor('#rrggbb')` / `setColor([r, g, b])` | 0–255 each |
| `setWhite(v)` | 0–255, for lights with a white LED |
| `setDimmer(level)` / `off()` | 0–1. Lights without a dimmer channel scale their colour instead |
| `setPan(deg)`, `setTilt(deg)`, `setPanTilt(pan, tilt)` | Within the profile's range (±270° pan, ±135° tilt) |
| `aimAt(x, y, z)` | Also takes `[x, y, z]` or `{ x, y, z }` |
| `setZoom(deg)`, `setStrobe(hz)` | |
| `set('red', 255)`, `get('red')` | Raw channel values by name |
| `state`, `channels`, `position`, `address`, `canMove`, `hasColor` | What the fixture is and what it's doing |

**Picking lights:** `rig.get(name)`, `rig.all`, `rig.movers`, `rig.colorLights`, `rig.byProfile('par-rgbw')`, `rig.where(f => f.position[0] < 0)`.
Each of these is an array, so `forEach`, `[0]` and `filter` work, and it also takes every fixture method: `rig.movers.setColor(0, 0, 255)`.

**Options:** `connect({ rig, host })`, or the environment variables `SERVER`, `RIG` and `ARTNET_HOST`. By default the library loads `https://dmx.offig.com/rig.json` and sends Art-Net to `dmx.offig.com` (UDP port 6454).

```bash
SERVER=localhost npm run follow                                                  # the rig on this computer
ARTNET_HOST=192.168.1.20 RIG=http://192.168.1.20:8080/rig.json npm run follow   # a rig on another computer
RIG=./my-rig.json ARTNET_HOST=2.0.0.10 npm run app                             # real lights via an Art-Net node
```

## The web controller and its API

`npm run app` serves a control page at <http://localhost:3000>:
- Click lights on the stage plan to select them; shift-click to select more.
- Change colour, dimmer, pan/tilt, zoom and strobe in the side panel.
- With moving heads selected, click or drag on the stage to aim them.

Open **Last API request** to see what the page sends.

The page only talks to the server through a small JSON API, so anything that can make HTTP requests can use it: another web page, p5.js, Python, TouchDesigner, Max, or `curl`:

| Request | Does |
| --- | --- |
| `GET /api/rig` | Stage size and every fixture, with its state |
| `GET /api/fixtures/Par%201` | One fixture |
| `POST /api/fixtures/Par%201` | Change a fixture (body below) |
| `POST /api/fixtures/all` (or `movers`, `color`) | Change a group |
| `POST /api/blackout` | Everything off |

```json
{ "color": [255, 0, 0], "dimmer": 1, "pan": 30, "tilt": 45, "aim": [0, 1.7, 3.5], "zoom": 12, "strobe": 0, "white": 0, "channels": { "red": 255 } }
```

Every key is optional; send only what you want to change.

```bash
curl -X POST localhost:3000/api/fixtures/movers -H 'Content-Type: application/json' -d '{"color":"#ff0000","aim":[0,1.7,3.5]}'
```

```js
// From any web page (the server allows cross-origin requests):
fetch('http://localhost:3000/api/fixtures/Par%201', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ color: '#00ff88', dimmer: 0.8 }),
});
```

## Project layout

```
lib/
  artnet.js     building and sending Art-Net packets
  fixture.js    one light: colour, dimmer, pan/tilt, aimAt
  rig.js        loading the rig, groups, the send loop
  index.js      what to import
examples/       numbered example scripts
app/
  server.js     HTTP server + JSON API
  public/       the control page (index.html, app.js, style.css)
```

## Ideas to build on

- **Fades:** move smoothly from one look to another over a few seconds inside `rig.loop`.
- **Cues:** a list of saved looks with a GO button, like a theatre desk.
- **Sound to light:** the browser microphone (Web Audio API) drives colour or intensity through the API.
- **Phone as a remote:** open the controller page on your phone (use your computer's IP address) and use the tilt sensors to aim a moving head.
- **Tracking:** a webcam or Kinect finds a person and `aimAt` follows them.
- **Other software:** TouchDesigner, Max or Python can call the HTTP API, or send Art-Net themselves.
