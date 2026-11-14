# Serra app (laptop side)

Everything that runs on the demo laptop after the Pi has decoded the Serranet packets: the local Supabase database and the dashboard, a Next.js app. The dashboard runs on mock data for now; the live feed from Supabase is next.

| Folder            | What                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `src/app/`        | Next.js routes: `/` welcome screen, `/dashboard` the base station dashboard; global CSS |
| `src/components/` | React components: `welcome/`, `dashboard/`, `brand/` (logos), the loading screen        |
| `src/lib/`        | Data contract (`types.ts`), store, sound model, alerts, packets, map maths and drawing  |
| `mockup/`         | The original design mockup, one HTML file ([README](mockup/README.md))                  |
| `supabase/`       | Local Supabase: schema, seed data, setup ([README](supabase/README.md))                 |
| `tests/e2e/`      | Playwright end-to-end tests                                                             |
| `scripts/`        | Mockup server, git hook helpers, gitleaks wrapper                                       |
| `.husky/`         | Repo-wide git hooks                                                                     |

## How the dashboard is built

Next.js 16 (App Router, Turbopack) + React 19 + TypeScript, Tailwind CSS 4, Zustand for state.

- **Works offline.** Fonts come from npm (`@fontsource-variable/*`), not Google Fonts, and nothing loads from a CDN, so the base station needs no internet.
- **Styles.** `src/app/serra.css` holds the styles ported from the mockup (same class names). The brand colors are also Tailwind tokens (`bg-night`, `text-flare`, `border-moss`, …) in `globals.css`, for new UI. shadcn/ui is configured (`components.json`) with the brand mapped onto its tokens: `npx shadcn@latest add button` and so on.
- **State.** `src/lib/store.ts` holds alerts, packets, the selected node, replay and mode. Components subscribe to what they show. The map and waveform are canvases that redraw every frame from the store without re-rendering React.
- **Data.** `src/lib/types.ts` is the contract. The mock feed (`lib/alerts.ts`) produces it today; the live feed will map Supabase rows onto the same types and call the same store actions.
- **The dashboard renders client-side only** (`dynamic(..., { ssr: false })`): it's all canvases, clocks and live data, so a server render would only be a stale snapshot.

## Setup (once)

Needs Node.js 20 or newer. On Windows PowerShell, use `npm.cmd` / `npx.cmd` if `npm` is blocked by the script execution policy.

```bash
npm install                         # dev tools, and turns on the git hooks
npx playwright install chromium     # browser for the E2E tests
winget install -e --id Gitleaks.Gitleaks   # secret scanner (macOS: brew install gitleaks)
```

## Commands

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`          | Dashboard with hot reload at http://localhost:3000                                   |
| `npm run build`        | Production build                                                                     |
| `npm run start`        | Serves the production build (add `-- -H 0.0.0.0` to reach it from phones on the LAN) |
| `npm run typecheck`    | TypeScript, no output                                                                |
| `npm run mockup`       | Serves the old HTML mockup at http://127.0.0.1:4173                                  |
| `npm run lint`         | ESLint: the app, tests, scripts and the mockup                                       |
| `npm run lint:fix`     | ESLint with automatic fixes                                                          |
| `npm run format`       | Prettier: formats HTML, CSS, JS, JSON and Markdown                                   |
| `npm run format:check` | Prettier, check only                                                                 |
| `npm run test:e2e`     | Playwright E2E tests, headless (desktop + phone)                                     |
| `npm run test:e2e:ui`  | Playwright's interactive test runner                                                 |
| `npm run secrets`      | gitleaks over the whole repository's history                                         |
| `npm run check`        | lint + typecheck + format check + E2E, what the pre-push hook runs                   |

## E2E tests

`tests/e2e/` covers the welcome and loading screens, the node picker, simulating and acknowledging alerts, replay, the packet view's bytes against the firmware's wire format, the sound model (dB levels), and rescuer mode at phone width. Playwright builds the app and serves it on port 3100 itself (or reuses a server already on 3100). Tests read mock state through `window.serraMock`, a read-only handle the dashboard exposes for testing.

## Git hooks (whole repository)

`npm install` points git's `core.hooksPath` at `app/.husky`, so the hooks check **every** commit and push in the repo, not just `app/`. They only run for people who have run `npm install` here.

| Hook         | Checks                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | gitleaks on the staged changes; no `.env` or key files, no files over 5 MB, no merge-conflict markers; ESLint + Prettier on staged `app/` files (auto-fixed) |
| `pre-push`   | gitleaks on every commit being pushed; if any touch `app/`: lint, typecheck, format check, E2E                                                               |

Skip them once, in an emergency, with `--no-verify`. Turn them off for a shell with `HUSKY=0`.

**gitleaks** uses `app/.gitleaks.toml` (gitleaks' default rules, with lockfiles, datasheets and logos skipped). If it flags something that isn't a secret, add a `gitleaks:allow` comment on that line rather than widening the config. If it flags a real secret, remove it, move it to an untracked `.env` file and rotate it.
