# Virtual DMX Controller

A starting point for controlling stage lights from your own code. It sends **Art-Net**, so it drives the [VirtualDMX](../VirtualDMX) rig, and real lights too through an Art-Net node.

It has three parts:

| | What | Use it to |
| --- | --- | --- |
| `lib/` | A small JavaScript library: `setColor`, `setDimmer`, `setPanTilt`, `aimAt`… | Write show scripts in Node |
| `examples/` | Short numbered scripts, from "turn a light on" to "follow spot" | Learn the library |
| `app/` | A web controller: a Node server with a JSON API, and a page with a stage plan | Build your own interface |

You need Node 22 or newer (Node 18 works for local rigs only). There are no packages to install.

## Quick start

1. **Get your own stage:** go to <https://dmx.offig.com/join/> and type your name and the class code your teacher gives you. (Or your teacher adds you.)
2. **Download your settings file:** on the page that appears, press **Download my settings file**. You get `dmx-settings.txt`, which holds your stage's address and your key.
3. **Move `dmx-settings.txt` into this folder** (the VirtualDMXController folder, next to `package.json`).
4. **Run the controller:** in this folder, run `npm run app` and open <http://localhost:3000>. Open your stage's address in another tab to watch the lights.

When it starts, the controller prints `Using settings from dmx-settings.txt` and `Rig: Connected to …'s stage`.

The settings file holds your key, which works like a password. Don't share it, and don't commit it: `.gitignore` already keeps it out of git. If you download it again (`dmx-settings (1).txt`), the newest one is used.

Things to run:

```bash
npm run app        # the web controller for your stage, at http://localhost:3000
npm run app:main   # the same, for the shared main stage (when it's your turn)
npm run hello      # examples/01-hello-light.js
npm run rainbow    # 02: animate with rig.loop()
npm run pantilt    # 03: moving heads with pan/tilt in degrees
npm run follow     # 04: aim every moving head at one moving point
npm run raw        # 05: the raw DMX numbers underneath
npm run bridge     # use TouchDesigner or QLC+ (see below)
```

Add `--main` to any script to send to the main stage, e.g. `npm run follow -- --main`.

Run **one sender at a time**. If two programs send to the same stage, it shows whichever packet arrived last and the lights flicker between them.

**The main stage** (`https://dmx.offig.com/`) is shared. Use `npm run app:main` when your teacher gives you control. Until then, the controller prints "Waiting for the teacher to give you control", and the lights start following you the moment you're handed control. No restart needed.

**Without a settings file,** put the details in front of the command instead:

```bash
RIG_URL=https://dmx.offig.com/stage/ana/ KEY=your-key npm run app
```

On Windows (PowerShell), set them first: `$env:RIG_URL="https://dmx.offig.com/stage/ana/"; $env:KEY="your-key"; npm run app`. Anything typed like this overrides the settings file.

**A rig on your own computer** (in the `VirtualDMX` folder, `npm start`, then open <http://localhost:8080>) needs no key. Move your settings file out of the way, or override it:

```bash
SERVER=localhost RIG_URL= KEY= npm run hello
```

### Online with a key, or plain Art-Net

The controller always builds standard Art-Net packets. What changes is how they travel:

| | How Art-Net travels | When |
| --- | --- | --- |
| **With a `KEY`** | Inside a secure WebSocket (`wss://`) to the stage at `RIG_URL`, labelled with your key | The online VirtualDMX rig |
| **Without a key** | Plain UDP to port 6454, as every lighting desk does | VirtualDMX on your own computer or local network, or **real lights** through an Art-Net node |

So code you write for the online rig also runs a real DMX rig: just leave out the key and point `ARTNET_HOST` at the Art-Net node.

### TouchDesigner, QLC+ and other software: the bridge

Software like TouchDesigner and QLC+ can only send plain UDP Art-Net, which the online rig doesn't accept. Run the bridge in this folder:

```bash
npm run bridge          # your stage (uses your settings file)
npm run bridge:main     # the main stage, when it's your turn
```

Then set your software's Art-Net output to **127.0.0.1**, universe 0, as if the rig were on your computer. The bridge forwards every packet, unchanged, to your stage. If VirtualDMX is also running on your computer, it uses the same port, so stop it first, or use `BRIDGE_PORT=16454` and send to that port instead.

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

**Options:** `connect({ rig, key, host })`, or these environment variables:

| Variable | Does |
| --- | --- |
| `RIG_URL` | The stage's web address, e.g. `https://dmx.offig.com/stage/ana/`. Default: the main stage at `SERVER`. Can also be a `rig.json` URL or file (`RIG` works too). |
| `KEY` | Your key. With it, Art-Net goes securely to the online rig; without it, plain UDP. |
| `ARTNET_HOST` | Where plain UDP Art-Net goes. Default: the rig's host. |
| `SERVER` | Shortcut: `localhost` for a rig on this computer. Default: `dmx.offig.com`. |

All of these can go in `dmx-settings.txt` (or `.env`) in this folder, one per line like `KEY=abc123`. Anything set on the command line wins over the file. `--main` switches any script to the main stage.

```bash
RIG_URL=https://dmx.offig.com/stage/ana/ KEY=your-key npm run follow      # your stage online
SERVER=localhost npm run follow                                           # the rig on this computer
RIG_URL=http://192.168.1.20:8080/ npm run follow                          # a rig elsewhere on the local network
RIG_URL=./my-rig.json ARTNET_HOST=2.0.0.10 npm run app                    # real lights via an Art-Net node
```

## The web controller and its API

`npm run app` serves a control page at <http://localhost:3000>:
- Click lights on the stage plan to select them; shift-click to select more.
- Change colour, dimmer, pan/tilt, zoom and strobe in the side panel.
- With moving heads selected, click or drag on the stage to aim them.
- **Animate:** start the rainbow chase, moving head sweep or follow spot (the shows from `examples/02`–`04`). A colour show and a moving-head show can run together. **Blackout** stops them.

Open **Last API request** to see what the page sends.

The page only talks to the server through a small JSON API, so anything that can make HTTP requests can use it: another web page, p5.js, Python, TouchDesigner, Max, or `curl`:

| Request | Does |
| --- | --- |
| `GET /api/rig` | Stage size and every fixture, with its state |
| `GET /api/fixtures/Par%201` | One fixture |
| `POST /api/fixtures/Par%201` | Change a fixture (body below) |
| `POST /api/fixtures/all` (or `movers`, `color`) | Change a group |
| `POST /api/blackout` | Everything off, and stop any animations |
| `GET /api/animations` | The animations, and which are running |
| `POST /api/animations/rainbow` | Start one (`rainbow`, `sweep`, `follow`) |
| `POST /api/animations/rainbow/stop` | Stop one (`/api/animations/stop` stops them all) |
| `GET /api/status` | How the connection to the rig is going, e.g. "Waiting for the teacher to give you control" |

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

### The shared controller (dmx-controller.offig.com)

Your teacher runs one copy of this controller online for everyone, at <https://dmx-controller.offig.com>. The page asks for your stage address and key, remembers them in your browser, and has a **My stage / Main stage** switch. Nothing to install.

It's the same code, started with `MULTI_USER=on` (see `app/sessions.js`). Instead of using one settings file, it keeps a connection to the rig for each person, and each API request says whose stage it's for with two extra headers:

```js
fetch('https://dmx-controller.offig.com/api/fixtures/Par%201', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-DMX-Stage': 'https://dmx.offig.com/stage/ana/', // or just "ana", or "main" for the main stage
    'X-DMX-Key': 'your-key',
  },
  body: JSON.stringify({ color: '#00ff88' }),
});
```

When you run the controller yourself, you don't need these headers: it sends wherever your settings say, and with no key that's plain UDP Art-Net, ready for a real rig.

To run a shared controller: `MULTI_USER=on RIG_URL=<the rig's address> npm run app`. Optional: `PUBLIC_RIG_URL`, the rig's address as browsers see it, when the server reaches it by another address (e.g. inside Docker); `MAX_SESSIONS` (default 300).

## Project layout

```
lib/
  artnet.js     building Art-Net packets and sending them over UDP
  websocket.js  sending the same packets to an online rig, with a key
  fixture.js    one light: colour, dimmer, pan/tilt, aimAt
  rig.js        loading the rig, groups, the send loop
  index.js      what to import
examples/       numbered example scripts
tools/bridge.js forwards Art-Net from TouchDesigner, QLC+ etc. to an online rig
app/
  server.js     HTTP server + JSON API
  animations.js the animations the page can start: add your own and they get a button
  sessions.js   one rig connection per person, for a shared controller (MULTI_USER)
  public/       the control page (index.html, app.js, style.css)
```

## Ideas to build on

- **Fades:** move smoothly from one look to another over a few seconds inside `rig.loop`.
- **Cues:** a list of saved looks with a GO button, like a theatre desk.
- **Sound to light:** the browser microphone (Web Audio API) drives colour or intensity through the API.
- **Phone as a remote:** open the controller page on your phone (use your computer's IP address) and use the tilt sensors to aim a moving head.
- **Tracking:** a webcam or Kinect finds a person and `aimAt` follows them.
- **Other software:** TouchDesigner, Max or Python can call the HTTP API, or send Art-Net themselves.
