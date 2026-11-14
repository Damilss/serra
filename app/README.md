# Serra app (laptop side)

Everything that runs on the demo laptop after the Pi has decoded the Serranet packets: the local Supabase database and the dashboard. Today the dashboard is a clickable mockup; the real Next.js app comes next.

| Folder       | What                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| `mockup/`    | Dashboard mockup: one self-contained HTML file ([README](mockup/README.md)) |
| `supabase/`  | Local Supabase: schema, seed data, setup ([README](supabase/README.md))     |
| `tests/e2e/` | Playwright end-to-end tests                                                 |
| `scripts/`   | Static server, git hook helpers, gitleaks wrapper                           |
| `.husky/`    | Repo-wide git hooks                                                         |

## Setup (once)

Needs Node.js 20 or newer. On Windows PowerShell, use `npm.cmd` / `npx.cmd` if `npm` is blocked by the script execution policy.

```bash
npm install                         # dev tools, and turns on the git hooks
npx playwright install chromium     # browser for the E2E tests
winget install -e --id Gitleaks.Gitleaks   # secret scanner (macOS: brew install gitleaks)
```

## Commands

| Command                | What it does                                           |
| ---------------------- | ------------------------------------------------------ |
| `npm run serve`        | Serves the mockup at http://127.0.0.1:4173             |
| `npm run lint`         | ESLint: the mockup's script, tests and Node scripts    |
| `npm run lint:fix`     | ESLint with automatic fixes                            |
| `npm run format`       | Prettier: formats HTML, CSS, JS, JSON and Markdown     |
| `npm run format:check` | Prettier, check only                                   |
| `npm run test:e2e`     | Playwright E2E tests, headless (desktop + phone)       |
| `npm run test:e2e:ui`  | Playwright's interactive test runner                   |
| `npm run secrets`      | gitleaks over the whole repository's history           |
| `npm run check`        | lint + format check + E2E, what the pre-push hook runs |

## E2E tests

`tests/e2e/` covers the welcome and loading screens, the node picker, simulating and acknowledging alerts, replay, the packet view's bytes against the firmware's wire format, the sound model (dB levels), and rescuer mode at phone width. Playwright starts the static server itself. Tests read mock state through `window.serraMock`, a read-only handle the mockup exposes for testing.

## Git hooks (whole repository)

`npm install` points git's `core.hooksPath` at `app/.husky`, so the hooks check **every** commit and push in the repo, not just `app/`. They only run for people who have run `npm install` here.

| Hook         | Checks                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | gitleaks on the staged changes; no `.env` or key files, no files over 5 MB, no merge-conflict markers; ESLint + Prettier on staged `app/` files (auto-fixed) |
| `pre-push`   | gitleaks on every commit being pushed; if any touch `app/`, `npm run check` (lint, format check, E2E)                                                        |

Skip them once, in an emergency, with `--no-verify`. Turn them off for a shell with `HUSKY=0`.

**gitleaks** uses `app/.gitleaks.toml` (gitleaks' default rules, with lockfiles, datasheets and logos skipped). If it flags something that isn't a secret, add a `gitleaks:allow` comment on that line rather than widening the config. If it flags a real secret, remove it, move it to an untracked `.env` file and rotate it.
