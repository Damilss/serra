# Base station dashboard mockup

A clickable design mockup of the Serra base station dashboard. It shows how the screens should look and behave before the real app is built. **Everything in it is mock data.** No BLE, no database, no backend.

It is one self-contained HTML file: the Serra logos are inlined as SVG, and the map and animations are drawn on a canvas in plain JavaScript. No build step and no dependencies.

## Open it

Open `index.html` in a browser (double-click it, or drag it into Chrome, Firefox or Safari). Or, from `app/`, run `npm run serve` and visit http://127.0.0.1:4173.

- `index.html` opens the welcome screen. **Open base station** plays the loading screen and then shows the dashboard.
- `index.html#dashboard` jumps straight to the dashboard.
- At phone width (under 640 px) the dashboard opens in rescuer mode.

Fonts (Instrument Sans, JetBrains Mono) load from Google Fonts. Offline, the page still works but falls back to system fonts. The real app should bundle the fonts locally.

## What to try

- **Simulate** (or press `W`) at the selected Serranode, as a whistle, scream or "help". The calling node lights up, the sound reaches nearby nodes later and quieter, they confirm it in lighter orange, the alert floods across the Serranet to the base, and the search area narrows onto the loudness-weighted fix.
- **Alert card**: Acknowledge, Resolve, Locate, Replay.
- **Replay** scrubber under the map steps through any alert.
- **Alert feed** and **Serranet packets** (the decoded bytes of each heartbeat and alert).
- **Viewing** dropdown, arrow buttons, `←` / `→`, or click a node on the map.
- **Rescuer mode** in the top bar: the phone view with bearing and distance from the ranger station.

## What is made up

- Node names, positions, battery, IDs, signal and all stats (latency, inference, energy) are placeholders.
- Hollow Pine Wilderness and its terrain are fictional and generated in code.
- The packet view follows the firmware's `firmware/mesh/packet.h` (magic `0x5E`, class IDs 1 whistle, 2 scream, 3 help). The magic byte is still marked as a placeholder there. The heartbeat payload (battery, millivolts) is a proposal: firmware hasn't defined it yet. The README's [Mesh protocol](../../README.md) is the source of truth.
- Timings are slowed down so the alert can be followed by eye.

## Loudness

Loudness uses the wire format's units: `peak_level` is a calibrated level in **tenths of a dB** (`898` = 89.8 dB), on a scale where the calibration tone reads 80 dB on every node. The dashboard shows `peak_level / 10`, the same as the decoder's `peak_db`.

The simulated levels come from a simple sound model (the "Alerts" section of the script):

|                            |                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Level 20 m from the caller | whistle 90 dB, scream 86 dB, "help" 82 dB                                          |
| Falloff                    | inverse square (−6 dB per doubling of distance) plus 0.01 dB/m for terrain and air |
| Wake trigger               | 50 dB: quieter than that and a node never reports the call                         |
| Location fix               | weighted by sound pressure, 10^(dB/20), across every node that heard it            |

So a whistle reads about 90 dB at the calling node and 55–61 dB at neighbors about 400 m away. A "help" is confirmed by fewer nodes because it starts quieter.

## Brand

Colors, type and logos follow the Serra brand kit (`serra_brand/`): Night ground, Pine surfaces, Moss for quiet text, Fog for text, and Flare orange only for a distress call and the nodes confirming it.

## Next

The real dashboard will be Next.js + shadcn/ui + Tailwind in `app/`, built from this mockup against a typed data contract with a mock feed, then switched to the live base-station feed.
