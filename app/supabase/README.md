# Serra base station database (Supabase, local)

Supabase runs on the base station machine in Docker, so it works with no internet. The BLE listener writes alerts and packets into it, and the dashboard reads them and gets live updates through Supabase Realtime.

```
Serranodes ─BLE─▶ BLE listener (Python, service_role key) ─▶ Supabase (Postgres) ─Realtime─▶ dashboard (anon key)
```

## What's here

| File                                         | What it is                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.toml`                                | Local Supabase settings. Project id `serra`. Email testing, file storage, edge functions and log analytics are off: Serra doesn't use them, and fewer containers means a lighter, more reliable demo. |
| `migrations/20261113000000_serra_schema.sql` | Tables, access rules and Realtime.                                                                                                                                                                    |
| `seed.sql`                                   | Demo data matching the dashboard mockup: the base, five Serranodes, and one resolved alert.                                                                                                           |

## Tables

| Table            | One row per                                                                                                                                  | Written by                   | Dashboard can                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- |
| `nodes`          | Serranode or the base: mesh ID, name, position, battery, signal, last heard                                                                  | BLE listener, node placement | read                                    |
| `alerts`         | distress event: source node, class (whistle / scream / help), confidence, loudness, hops, estimated position, search radius, summary, status | BLE listener                 | read, and change `status` / `note` only |
| `alert_readings` | node that heard an alert: the first and loudest one, plus every node confirming it more quietly                                              | BLE listener                 | read                                    |
| `packets`        | decoded Serranet packet (raw bytes + field-by-field decode)                                                                                  | BLE listener                 | read                                    |

Alert status goes `active` → `ack` → `resolved`; `acknowledged_at` and `resolved_at` are stamped automatically.

Column names follow the packet structs in the README's [Mesh protocol (Serranet)](../../README.md) section. If the wire format changes, update the migration in the same PR.

**Loudness:** `peak_level` is stored exactly as sent: an `int16` in tenths of a dB on the calibrated scale (`853` = 85.3 dB). `peak_db` is a generated column (`peak_level / 10`), so the ingest writes `peak_level` only, and writing `peak_db` is an error.

## Setup (once)

1. **Install Docker Desktop** and start it (it needs WSL 2 on Windows):
   ```bash
   winget install -e --id Docker.DockerDesktop
   ```
   Open Docker Desktop and wait until it says the engine is running.
2. **Start Supabase** from `app/`. The first run downloads the Docker images (about 2 GB), so do it **before the event, with internet**. After that it starts offline.
   ```bash
   npx supabase@3.1.0 start
   ```
   This applies the migration and seed, then prints the URLs and keys.

## Everyday commands (from `app/`)

On Windows PowerShell, use `npx.cmd` if `npx` is blocked by the script execution policy.

```bash
npx supabase@3.1.0 status    # URLs and keys
npx supabase@3.1.0 db reset  # wipe and rebuild from migrations + seed
npx supabase@3.1.0 stop      # stop the containers
```

- Studio (table editor in the browser): http://127.0.0.1:54323
- API for the dashboard and listener: http://127.0.0.1:54321
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Keys

`supabase status` prints two keys:

- **anon / publishable**: goes in the dashboard. Read-only except alert status.
- **service_role / secret**: goes in the BLE listener only. It bypasses all access rules, so never put it in the dashboard or commit it.

Put them in an untracked `.env.local`, never in git.

## Schema changes

```bash
npx supabase@3.1.0 migration new <what_changed>   # new file in migrations/
npx supabase@3.1.0 db reset                        # apply locally
```

Once the Next.js dashboard exists, generate its TypeScript types from the schema:

```bash
npx supabase@3.1.0 gen types typescript --local > lib/database.types.ts
```
