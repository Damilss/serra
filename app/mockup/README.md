# Base station dashboard mockup

A clickable design mockup of the Serra base station dashboard. It shows how the screens should look and behave before the real app is built. **Everything in it is mock data.** No BLE, no database, no backend.

It is one self-contained HTML file: the Serra logos are inlined as SVG, and the map and animations are drawn on a canvas in plain JavaScript. No build step and no dependencies.

## Open it

Open `index.html` in a browser (double-click it, or drag it into Chrome, Firefox or Safari).

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
- In the packet view, the magic byte `0x9E`, the class IDs for scream and "help", and the heartbeat payload are placeholders. The README's [Mesh protocol](../../README.md) is the source of truth.
- Timings are slowed down so the alert can be followed by eye.

## Brand

Colors, type and logos follow the Serra brand kit (`serra_brand/`): Night ground, Pine surfaces, Moss for quiet text, Fog for text, and Flare orange only for a distress call and the nodes confirming it.

## Next

The real dashboard will be Next.js + shadcn/ui + Tailwind in `base-station/`, built from this mockup against a typed data contract with a mock feed, then switched to the live base-station feed.
