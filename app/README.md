# Serra base station dashboard

The web app rescuers use at the base station. It runs on the demo laptop, with no internet, and shows where Serranodes heard distress calls: a live map of the Serranet, the alert, which nodes confirmed it and how loud, and the search area it narrows down to.

Built with **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4** and **Zustand**.

> **Status:** the dashboard runs on a **mock feed**. Alerts, heartbeats and packets are simulated in the browser to match the real wire format. Connecting it to the local Supabase database (fed by the base-station decoder) is the next step; see [Connecting live data](#connecting-live-data).

---

## Contents

1. [Quick start](#quick-start)
2. [What to try](#what-to-try)
3. [Project structure](#project-structure)
4. [How it works](#how-it-works)
5. [Loudness and the sound model](#loudness-and-the-sound-model)
6. [Styling and the brand](#styling-and-the-brand)
7. [Common tasks](#common-tasks)
8. [Connecting live data](#connecting-live-data)
9. [What's mock data](#whats-mock-data)
10. [Testing and checks](#testing-and-checks)
11. [Git hooks](#git-hooks-whole-repository)
12. [Troubleshooting](#troubleshooting)

---

## Quick start

Needs **Node.js 26** (Active LTS), pinned in [`.nvmrc`](.nvmrc): with nvm or fnm, run `nvm install` / `fnm use` here. Some dev tools refuse anything older than 22.22. Run everything from this folder (`app/`).

```bash
npm install                        # dependencies, and turns on the repo's git hooks
npm run dev                        # http://localhost:3000
```

On **Windows PowerShell**, `npm` and `npx` may be blocked by the script execution policy. Use `npm.cmd` / `npx.cmd`, or run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

For the tests and the pre-push hook, also install once:

```bash
npx playwright install chromium                 # browser for the E2E tests
winget install -e --id Gitleaks.Gitleaks        # secret scanner (macOS: brew install gitleaks)
```

### On the demo laptop

```bash
npm run build
npm run start -- -H 0.0.0.0                     # serve on the local network, port 3000
```

Phones on the same network can then open `http://<laptop-ip>:3000`. Do the `npm install` and the first build **before the event, with internet**; after that nothing needs a connection (fonts are bundled, there are no CDN requests).

## What to try

| Route        | What it is                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`          | Welcome screen. **Open base station** plays the loading screen, then opens the dashboard.                                                    |
| `/dashboard` | **Field** view: the production vision, a ranger's view of a wilderness Serranet. At phone width (under 640 px) it opens in **rescuer mode**. |
| `/demo`      | **Venue demo**: three Serranodes on a taped triangle, calls located by loudness trilateration. See [Venue demo](#venue-demo).                |

The **Field / Venue demo** tabs in the top bar switch between the two.

On the field dashboard:

- **Simulate** (or press `W`) a whistle, scream or "help" at the selected Serranode. The calling node lights up, the sound reaches nearby nodes later and quieter, they confirm it in lighter orange, the alert hops across the Serranet to the base, and the search area narrows onto the loudness-weighted fix.
- **Alert card:** Locate, Replay, Acknowledge, Resolve.
- **Replay:** the scrubber under the map steps through any alert, second by second.
- **Alert feed** and **Serranet packets**: the decoded bytes of every heartbeat and alert. Click a packet to pin it.
- **Switch nodes** with the Viewing dropdown, the arrow buttons, `←` / `→`, or by clicking a node on the map.
- **Rescuer mode** (top bar): the phone view, with bearing and distance from the ranger station.

## Venue demo

`/demo` is the view for the live hackathon demo: three Serranodes (A, B, C) on an equilateral triangle taped on the floor, 20 ft a side, and the base station off to the side.

**How a call is located (loudness trilateration, [`lib/venue.ts`](src/lib/venue.ts)).** Every node reports how loud it heard the call (`peak_level`). For each spot on a 5 cm grid over the floor, the solver assumes the call came from there:

1. It finds the call level that best explains all three readings, with sound falling off 6 dB per doubling of distance.
2. It scores how far the readings still are from that model.

The spot with the lowest score is the estimate. The spots that score nearly as well become the search circle. It needs no clock sync, only the peak levels the firmware already sends.

**Two possible spots.** Three loudness readings usually fit two places: the real one, and a "mirror" spot farther from every node, which would need a louder caller. The solver picks the spot that needs the quieter caller. If the mirror spot fits about as well, it says so ("Two possible spots") and marks it "or here?" on the map. That happens near an edge or outside the triangle. A fourth node would settle it.

**Expected accuracy (simulated, 20 ft triangle):**

| Measurement noise                        | Inside the triangle (median error) |
| ---------------------------------------- | ---------------------------------- |
| None                                     | under 0.2 ft                       |
| ±1 dB, a calibrated node in a quiet room | about 1 ft                         |
| ±2 dB                                    | about 2–3 ft                       |

Outside the triangle, expect several feet of error.

**Using it**

- **Rehearse:** click the floor, or a **Taped mark** button (X1 centre, X2 near A, X3 edge B–C, X4 outside), to simulate a call there.
- **"Show where the caller really was":** draws the true spot next to the estimate, for rehearsal. Turn it off on stage.
- **Measurement noise:** sets how much the simulated readings wobble.
- **Triangle side:** change it if the venue forces a different size.

**For the live demo:**

- Replace the placeholder node IDs in `makeLayout()` (`lib/venue.ts`) with the real ones each Pico prints at boot.
- Feed real readings to `useVenue.getState().addCall(readings)`. Each reading is `{ node: 0 | 1 | 2, peak: peak_level }`.

## Project structure

```
app/
├── src/
│   ├── app/                      Next.js App Router
│   │   ├── layout.tsx            <html>, fonts, global CSS, the loading screen
│   │   ├── page.tsx              /            → <Welcome />
│   │   ├── demo/                 /demo        venue demo (same pattern as dashboard/)
│   │   ├── dashboard/
│   │   │   ├── page.tsx          /dashboard   (server component: metadata only)
│   │   │   └── DashboardClient.tsx  loads the dashboard client-side only
│   │   ├── globals.css           Tailwind, brand tokens, shadcn/ui tokens
│   │   └── serra.css             the dashboard's styles (class names used by the components)
│   ├── components/
│   │   ├── Loader.tsx            loading screen between welcome and dashboard
│   │   ├── brand/                logos (Logos.tsx) and their SVG path data (paths.ts)
│   │   ├── SiteNav.tsx           Field / Venue demo tabs
│   │   ├── welcome/              Welcome, WelcomeCanvas (animated topo), BootLog
│   │   ├── demo/                 VenueDemo (page shell), VenueMap (floor plan), VenuePanel (result, setup, log)
│   │   └── dashboard/            Dashboard (shell + loops) and one file per panel:
│   │                             TopBar, Stats, AlertCard, Picker, MapView, ReplayBar,
│   │                             Feed, PacketView, NodePanel, PicoBoard, Waveform, Rescuer
│   └── lib/
│       ├── types.ts              the data contract: nodes, alerts, readings, packets
│       ├── store.ts              field dashboard state and actions (Zustand)
│       ├── venue.ts              venue triangle layout, call simulator, loudness trilateration
│       ├── venueStore.ts         venue demo state (layout, located calls)
│       ├── geo.ts                node layout, mesh links, routing, coordinates, bearings
│       ├── sound.ts              sound model: dB at distance, wake trigger
│       ├── alerts.ts             alert classes, the mock alert generator, summary text
│       ├── packets.ts            Serranet packets byte by byte (firmware wire format)
│       ├── terrain.ts            fictional terrain and contour drawing
│       ├── draw/map.ts           the field map renderer (canvas)
│       ├── draw/venue.ts         the venue floor-plan renderer (canvas)
│       ├── brand.ts              brand colors and canvas helpers
│       ├── format.ts             time, hex and dB formatting, seeded random
│       ├── audio.ts              the alert chime (Web Audio)
│       └── utils.ts              cn() for Tailwind class names (shadcn/ui)
├── tests/e2e/                    Playwright tests
├── supabase/                     local database: schema, seed data (see supabase/README.md)
├── scripts/                      git hook helpers, gitleaks wrapper
├── .husky/                       repo-wide git hooks
├── components.json               shadcn/ui config
├── next.config.ts, tsconfig.json, postcss.config.mjs, eslint.config.js, playwright.config.js
└── package.json
```

Imports use the `@/` alias for `src/` (`import { useDashboard } from '@/lib/store'`).

## How it works

```
 mock feed (lib/alerts.ts)  ──┐
                              ├──▶  store (lib/store.ts)  ──▶  React components (panels)
 live feed (Supabase, next) ──┘             │
                                            └── getState() every frame ──▶  canvases (map, waveform)
```

**Rendering.** The welcome page is a normal React page. The dashboard is loaded with `dynamic(..., { ssr: false })` and runs entirely in the browser: it is all canvases, clocks, audio and live data, so rendering it on the server would only produce a stale snapshot.

**State.** [`lib/store.ts`](src/lib/store.ts) is one Zustand store. It holds:

- the alerts, the packet log and which packet is pinned
- the selected node, the replay position and the mode (ops / rescuer)
- per-node "last heard" times

Every change goes through an action (`simulate`, `setStatus`, `startReplay`, `logPacket`, `heartbeat`, …). Components subscribe only to the slice they render, for example `useDashboard((s) => s.sel)`, so a heartbeat doesn't re-render the alert card. State is replaced, never mutated, so React sees every change.

**Animation.** The map and the waveform are `<canvas>` elements. Their loops read the store with `useDashboard.getState()` every frame and draw. They never call `setState`, so 60 fps animation doesn't re-render React. [`lib/draw/map.ts`](src/lib/draw/map.ts) has all the map drawing; [`MapView`](src/components/dashboard/MapView.tsx) only hosts the canvas and its overlays.

**Loops.** [`Dashboard.tsx`](src/components/dashboard/Dashboard.tsx) owns three app-wide loops:

- **Every frame:** lands alerts whose relay has reached the base (`promoteArrivals`) and advances a playing replay.
- **Every second:** updates the "last heard" counters.
- **Keyboard:** `←`, `→` and `W`.

**Timing.** Alerts run on `now()` (seconds since page load). The delays are slowed down so a demo audience can follow them: 2.2 s to classify on the node, 0.75 s per mesh hop.

**The data contract.** [`lib/types.ts`](src/lib/types.ts) defines what the UI consumes:

| Type                        | Meaning                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `Serranode` / `BaseStation` | Nodes, with mesh ID, flash serial, position, battery, signal.                             |
| `Alert`                     | One distress event: class, confidence, readings, hops, the fix and search radius, status. |
| `Reading`                   | One node's reading of a call: distance, delay and `peak` (`peak_level`, tenths of a dB).  |
| `Packet`                    | One advertisement, field by field (bytes + decoded value).                                |

The fields line up with the firmware's `mesh/packet.h` and with the Supabase tables in [`supabase/migrations`](supabase/migrations).

## Loudness and the sound model

Loudness uses the wire format's units: `peak_level` is a calibrated level in **tenths of a dB** (`898` = 89.8 dB), on a scale where the calibration tone reads 80 dB on every node. The dashboard shows `peak_level / 10`, the same as the decoder's `peak_db`.

Simulated levels come from [`lib/sound.ts`](src/lib/sound.ts):

|                            |                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Level 20 m from the caller | whistle 90 dB, scream 86 dB, "help" 82 dB                                          |
| Falloff                    | inverse square (−6 dB per doubling of distance) plus 0.01 dB/m for terrain and air |
| Wake trigger               | 50 dB: quieter than that and a node never reports the call                         |
| Location fix               | weighted by sound pressure, 10^(dB/20), across every node that heard it            |

So a whistle reads about 90 dB at the calling node and 55–61 dB at neighbors about 400 m away. A "help" starts quieter, so fewer nodes confirm it. On the map, a confirming node's orange is lighter the quieter it heard the call.

## Styling and the brand

Colors, type and logos follow the Serra brand kit (`serra_brand/`):

- **Grounds and text:** Night ground, Pine surfaces, Moss for quiet text, Fog for text.
- **Flare orange:** used only for a distress call and the nodes confirming it.

There are three layers:

- **[`serra.css`](src/app/serra.css):** the dashboard's hand-written styles. Components use its class names (`.alert-card`, `.chip`, `.btn`, …). The brand tokens are CSS variables on `:root` (`var(--flare)`, `var(--pine)`, …).
- **Tailwind:** the same colors as utilities (`bg-night`, `bg-pine`, `text-moss`, `text-fog`, `border-flare`, …) plus `font-sans` / `font-mono`. Prefer these for new UI.
- **shadcn/ui:** set up in [`components.json`](components.json), with its tokens mapped onto the brand in `globals.css`. Flare is shadcn's `destructive` color, not `primary`, so it stays reserved for distress.

**Fonts** are Instrument Sans and JetBrains Mono, bundled from npm (`@fontsource-variable/*`) and imported in `layout.tsx`. Canvas text uses them by name (`lib/brand.ts`).

**Reduced motion:** with `prefers-reduced-motion`, animations jump to their end state and the loading screen is skipped.

## Common tasks

**Add a shadcn/ui component**

```bash
npx shadcn@latest add button
```

It lands in `src/components/ui/` and picks up the brand tokens.

**Add a panel to the dashboard.** Create `src/components/dashboard/MyPanel.tsx` with `'use client'` at the top. Read state with a selector, `const sel = useDashboard((s) => s.sel)`, and add it to the layout in `Dashboard.tsx`.

**Add state or an action.** Add the field and the action to the `DashboardState` interface and to `create(...)` in `lib/store.ts`. Update immutably (`set({ alerts: [...] })`), never by mutating an object.

**Change the nodes.** Edit `NODES` and `LINKS` in `lib/geo.ts`. Positions are fractions (0–1) of a 2000 × 1250 m map. Keep `supabase/seed.sql` in sync.

**Change the wire format.** Update `lib/packets.ts` together with the firmware's `mesh/packet.h`, the decoder, the Supabase migration and `tests/e2e/packets.spec.js`. The packet test checks the bytes against the firmware layout.

## Connecting live data

The plan, so the UI doesn't change:

1. **Run Supabase locally** ([supabase/README.md](supabase/README.md)). Put the API URL and the **publishable/anon** key in `app/.env.local` (untracked) as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never put the service role key in the dashboard.
2. **Generate types** from the schema: `npx supabase gen types typescript --local > src/lib/database.types.ts`.
3. **Add `src/lib/live.ts`.** It should:
   - load the nodes, the recent alerts with their readings, and the recent packets;
   - map the rows onto `lib/types.ts`;
   - subscribe to Supabase Realtime and, on each change, call the same store actions the mock feed uses.
4. **Send Acknowledge / Resolve to the database.** These become updates of `alerts.status` and `note`, the only columns the dashboard is allowed to change.
5. **Keep the mock feed behind a switch** (for example `NEXT_PUBLIC_DATA=mock`), so the demo still works without the Pi.

## What's mock data

Mock today:

- **Nodes:** names, positions, battery, IDs and signal.
- **Stats:** latency, inference time, energy and battery life.
- **Terrain:** Hollow Pine Wilderness is fictional and generated in code.
- **Packets:** they follow the firmware's `packet.h` (magic `0x5E`, class IDs 1 whistle, 2 scream, 3 help). The magic byte is still marked as a placeholder in firmware. The HEARTBEAT payload (battery, millivolts) is a proposal: firmware hasn't defined it yet.

## Testing and checks

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run dev`          | Dev server with hot reload, http://localhost:3000                  |
| `npm run build`        | Production build (also typechecks)                                 |
| `npm run start`        | Serves the production build                                        |
| `npm run typecheck`    | TypeScript only                                                    |
| `npm run lint`         | ESLint (Next.js, React hooks, TypeScript rules)                    |
| `npm run lint:fix`     | ESLint with automatic fixes                                        |
| `npm run format`       | Prettier: formats everything                                       |
| `npm run format:check` | Prettier, check only                                               |
| `npm run test:e2e`     | Playwright E2E tests, headless (desktop + phone)                   |
| `npm run test:e2e:ui`  | Playwright's interactive runner                                    |
| `npm run secrets`      | gitleaks over the whole repository's history                       |
| `npm run check`        | lint + typecheck + format check + E2E: what the pre-push hook runs |

**E2E tests** ([`tests/e2e/`](tests/e2e)) cover:

- the welcome and loading screens;
- the venue demo: the Field / Venue demo tabs, the triangle's size, and the accuracy at each taped mark;
- that a call outside the triangle gets flagged as two possible spots;
- the node picker, simulating, acknowledging and resolving alerts, and replay;
- the packet view's bytes against the firmware's wire format;
- the sound model (dB levels, falloff, the wake trigger);
- rescuer mode at phone width.

Playwright builds the app and serves it on port **3100** (or reuses a server already running there). Tests read mock state through `window.serraMock`, a read-only handle the dashboard exposes for testing and the browser console.

## Git hooks (whole repository)

`npm install` points git's `core.hooksPath` at `app/.husky`, so the hooks check **every** commit and push in the repo, not just `app/`. They only run for people who have run `npm install` here.

| Hook         | Checks                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | gitleaks on the staged changes; no `.env` or key files, no files over 5 MB, no merge-conflict markers; ESLint + Prettier on staged `app/` files (auto-fixed) |
| `pre-push`   | gitleaks on every commit being pushed; if any touch `app/`: lint, typecheck, format check, E2E                                                               |

Skip them once, in an emergency, with `--no-verify`. Turn them off for a shell with `HUSKY=0`.

**gitleaks** uses `app/.gitleaks.toml`: gitleaks' default rules, with lockfiles, datasheets and logos skipped.

- **False positive:** add a `gitleaks:allow` comment on that line rather than widening the config.
- **Real secret:** remove it, move it to an untracked `.env` file and rotate it.

## Troubleshooting

| Problem                                                            | Fix                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `npm`/`npx` "cannot be loaded because running scripts is disabled" | Use `npm.cmd` / `npx.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.                          |
| Push fails in VS Code with "Try running Pull first"                | It's usually the pre-push hook. Click **Show Command Output**: the hook says which check failed and how to fix it. |
| Tests fail with "Executable doesn't exist … chrome-headless-shell" | Run `npx playwright install chromium` **from `app/`** in your own terminal.                                        |
| `Port 3100 is in use` when testing                                 | Another `next start` / `next dev` is running on it. Stop it, or let the tests reuse it.                            |
| Fonts look wrong on the map                                        | Hard-refresh. Canvas text redraws once the bundled fonts have loaded.                                              |

Next.js collects anonymous usage telemetry by default. To turn it off on a machine, run `npx next telemetry disable`.
