# Make your own lighting app

You want lights that react to something: a sensor on a microcontroller, your body on a webcam, sound, a game. This page shows where to start. You don't need to understand most of this project to do it.

## The big idea

```
your input ──────────▶ your web page ──── fetch() ────▶ the controller ──────▶ the lights
(sensor over WebSerial,  (reads the input,                (npm run app)         (the online rig,
 webcam + MediaPipe…)     decides the look)                                      or real lights)
```

Your page never deals with Art-Net, DMX channels or keys. It only says things like *"Par 3: red, 70% bright"*. The controller turns that into Art-Net and gets it to the lights:

- to **the online rig**, when you've set your key, or
- to **real lights**, over plain UDP Art-Net on a local network, exactly as a real lighting install works.

Your page doesn't change between the two.

## What you can ignore

| Folder or file | What it is | Do you need it? |
| --- | --- | --- |
| `lib/` | Builds Art-Net packets and sends them; the maths for each light | No: it works underneath |
| `app/server.js` | Turns your page's requests into DMX | Only the list of requests at the top |
| `app/sessions.js` | Lets many people share one controller online | No |
| `app/public/index.html`, `app.js` | The full control page | Later, as a model for bigger apps |
| **`app/public/example.html`** | **One light, a few buttons** | **Start here** |

## Start here

1. **Run the controller** as in the README's Quick start (`npm run app`), and open <http://localhost:3000> to check the lights respond.
2. **Open <http://localhost:3000/example.html>.** It has three buttons and a slider for one light. Read the file: it's short, and everything that talks to the lights is one function, `setLight()`.
3. **Copy it** to `app/public/my-app.html` (any name) and open <http://localhost:3000/my-app.html>. Any file you put in `app/public/` is served automatically: no server code to change.
4. **Add your input** (below), and call `setLight()` with values worked out from it.

On the shared controller at <https://dmx-controller.offig.com>, `example.html` works too: connect on the main page first, and it uses the same stage and key.

## Telling a light what to do

```js
setLight('Par 3', { color: '#ff8800', dimmer: 0.7 });
setLight('movers', { aim: [0, 1.5, 4] });    // every moving head points at one spot
setLight('all', { dimmer: 0 });               // everything off
```

The first value is a light's name, or a group: `all`, `movers` (moving heads) or `color` (lights with colour). Then the look, with only the things you want to change:

| | Range | Notes |
| --- | --- | --- |
| `dimmer` | 0 to 1 | brightness |
| `color` | `'#ff0000'` or `[255, 0, 0]` | lights with colour only |
| `white` | 0 to 255 | the pars' extra white |
| `pan`, `tilt` | degrees | moving heads; 0, 0 points straight down |
| `aim` | `[x, y, z]` in metres | moving heads: point at a spot (easier than pan/tilt) |
| `zoom` | degrees | beam width |
| `strobe` | flashes per second | 0 = off |

**Stage coordinates** for `aim`: `x` across the stage (0 is the centre, the stage is 12 m wide, so −6 to 6), `y` up from the floor, `z` from the front edge (0) to the back (8).

**The lights:** `Par 1` to `Par 6` (colour, in a row), `Mover 1` to `Mover 4` (moving heads), `Cyc 1` to `Cyc 4` (colour, lighting the back wall), `FOH L` and `FOH R` (front lights, brightness only). <http://localhost:3000/api/rig> lists them all with where they hang.

**Not sure what to send?** On the main control page, open **Last API request** at the bottom of the side panel. Every time you move a slider or click the stage, it shows the exact request it sent. Copy it.

The examples in `examples/` (`npm run hello`, `rainbow`, `pantilt`, `follow`) show what the different looks do.

## Adding your input

Write your input code as you would in any web page. The only connection to the lights is: *when you have a new value, call `setLight()`*.

**A sensor on a microcontroller (WebSerial).** Have your microcontroller print one reading per line (e.g. `Serial.println(value)` on an Arduino). In your page, a button asks for the serial port, then a loop reads lines; for each line, turn the number into a look:

```js
// inside your read loop, for each line of text from the microcontroller:
const reading = Number(line);                    // e.g. 0–1023 from a potentiometer
sendSoon('Par 3', { dimmer: reading / 1023 });   // sendSoon: see "Don't send too often" below
```

How to open the port and read lines: [MDN: Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

**Body tracking on a webcam (MediaPipe).** MediaPipe's hand or pose landmarker gives you points on your body, with `x` and `y` from 0 to 1 across the camera image. Turn them into stage positions:

```js
// for each video frame, after MediaPipe finds a hand:
const tip = hand[8];                                       // index fingertip
const x = (0.5 - tip.x) * 12;                              // 0–1 across the camera → −6 to 6 m across the stage (mirrored)
const z = (1 - tip.y) * 8;                                 // bottom to top of the camera → front to back of the stage
sendSoon('movers', { aim: [x, 1, z] });                    // the moving heads follow your finger
```

How to set it up in a web page: [MediaPipe solutions guide](https://ai.google.dev/edge/mediapipe/solutions/guide) (look for the *Web* guides for the hand or pose landmarker).

## Things that will trip you up

**Don't send too often.** Sensors and webcams give you 30 to 100 values a second. Sending a request for every one floods the controller and makes the lights lag. Send at most about 25 times a second:

```js
// Like setLight(), but sends at most 25 times a second, always with the latest look.
let waiting = null;
function sendSoon(name, look) {
  if (!waiting) setTimeout(() => { setLight(waiting.name, waiting.look); waiting = null; }, 40);
  waiting = { name, look };
}
```

(This works for one light or group at a time. `app/public/app.js` has a version for several lights: its `send()` and `flush()` functions.)

**Scale your numbers.** Your input and the lights use different ranges. This turns a value from one range into another, like `map()` in p5.js and Arduino:

```js
const scale = (value, inMin, inMax, outMin, outMax) => outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
scale(512, 0, 1023, 0, 1);   // 0.5
```

**Use Chrome or Edge.** WebSerial only works there. The webcam and WebSerial also only work on secure pages, which includes `http://localhost`: open your page at `localhost:3000`, not by double-clicking the file.

**Stop the animations first.** If an animation from the main page is running, it keeps changing its lights and fights your app. Press **Stop** or **Blackout** on the main page.

**One app at a time.** If two programs send to the same stage, the lights flicker between them.

## Real lights

Because your page only talks to the controller, it runs a real lighting rig unchanged. Run the controller without a key, with a `rig.json` describing the real lights, and point it at the rig's Art-Net node:

```bash
RIG_URL=./my-rig.json KEY= ARTNET_HOST=2.0.0.10 npm run app
```

The controller then sends plain UDP Art-Net, like a lighting desk. See "Online with a key, or plain Art-Net" in the README.

## Without running the controller yourself

A page anywhere (the p5.js editor, your own website) can use the shared controller's API directly, with your stage and key in two extra headers. The README section "The shared controller" shows the `fetch()`. It's handy for quick experiments, but it only drives the online rig, never real lights, so for your project, use your own copy.
