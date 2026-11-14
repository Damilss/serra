# Contributing to Serra

Thanks for helping. Serra is an off-grid search and rescue mesh: Pico 2 W nodes detect distress whistles, screams and shouts of "help" on-device and relay alerts over BLE to a Pi 5 base station. The [README](README.md) covers the what and the why (design decisions, mesh protocol, runtime, classifier). This file covers the how: getting set up, where things go, code style, and getting changes merged.

---

## Table of contents

1. [Project status](#project-status)
2. [Repository layout](#repository-layout)
3. [Getting set up](#getting-set-up)
4. [Code style](#code-style)
5. [Project ground rules](#project-ground-rules)
6. [Commits](#commits)
7. [Branches and pull requests](#branches-and-pull-requests)
8. [Reporting bugs and proposing ideas](#reporting-bugs-and-proposing-ideas)
9. [License](#license)

---

## Project status

**Early firmware.** The node firmware builds on the Pico SDK 2.3.1. `scripts/install-firmware-tooling.sh` installs the toolchain and the SDK, and the SDK's Wi-Fi blink and BLE examples build for the Pico 2 W. Our own `firmware/` CMake build isn't written yet, and `runtime/`, `audio/`, `classifier/` and `mesh/` are empty placeholders. The model and base station have no code yet. See [`firmware/README.md`](firmware/README.md#status) for the detailed status.

- **Looking for something to do?** [Known limitations and open questions](README.md#known-limitations-and-open-questions) and [Future work](README.md#future-work) list what's still open.

---

## Repository layout

The README's repository layout is the plan. Folders marked *planned* don't exist yet.

| Path | What goes there |
|---|---|
| `firmware/` | Pico 2 W node: C on the Pico SDK 2.3.1, split into `runtime/`, `audio/`, `classifier/` and `mesh/`. Build docs in [`firmware/README.md`](firmware/README.md). |
| `model/` *(planned)* | Classifier training pipeline (Python, uv) |
| `base-station/` *(planned)* | Pi 5 BLE listener and map dashboard (Python) |
| `docs/` | Longer write-ups: wiring, measurements, protocol notes, diagrams |
| `docs/refs/` | Reference material: datasheets, papers, specs, grouped by area (`docs/refs/firmware/`). Prefer a link plus notes; only commit a third-party PDF if its license allows redistribution. |
| `docs/reports/` | Hardware test reports, grouped by area (`docs/reports/firmware/`). One file per session, named `YYYY-MM-DD-<topic>.md`: setup (board, commit, toolchain), commands, raw output, and what it does and doesn't prove. Leave out device-unique IDs such as `chipid`. |
| `scripts/` | Helper scripts for setup, building, flashing and data collection |

Adding a new top-level folder? Update the README layout in the same PR.

**Don't commit:**
- Audio recordings and datasets (see [Data and recordings](#data-and-recordings)).
- Build output (`build/`, `*.uf2`, `*.elf`, `*.bin`), virtual environments (`.venv/`) and caches.
- Wi-Fi credentials (such as the base station's hotspot password) or any other secret.

---

## Getting set up

You only need the toolchain for the part you're working on.

### Everyone

- An editor with [EditorConfig](https://editorconfig.org) support. VS Code suggests the extensions from `.vscode/extensions.json`.
- `clang-format` if you'll touch C (`brew install clang-format` or `sudo apt install clang-format`).

### Firmware (Pico 2 W)

The firmware builds on the [Pico SDK](https://github.com/raspberrypi/pico-sdk), pinned to **2.3.1** ([design decision 6](README.md#6-keep-the-pico-sdks-radio-driver)).

- **Install:** run `scripts/install-firmware-tooling.sh` (Homebrew on macOS, apt on Linux; `DRY_RUN=1` previews it). It installs the Arm GNU toolchain, CMake, Ninja, [`picotool`](https://github.com/raspberrypi/picotool) 2.x and clang-format. It also clones the SDK with its submodules to `~/pico/pico-sdk`, or to `$PICO_SDK_PATH` if you've set it. Then add `export PICO_SDK_PATH="$HOME/pico/pico-sdk"` to your shell profile.
- **Board:** configure with `-DPICO_BOARD=pico2_w`. Builds target the Arm cores (`rp2350-arm-s`) by default. For the Hazard3 RISC-V cores, add `-DPICO_PLATFORM=rp2350-riscv` and install a RISC-V toolchain.
- **First build:** build and flash the SDK's blink and BLE examples before touching our code. See the [smoke test](firmware/README.md#smoke-test).
- **Flash:** hold BOOTSEL while plugging the board in, then run `picotool load -x <file>.uf2`, or copy the `.uf2` onto the `RP2350` drive.
- **Editor:** `.clangd` points clangd at `arm-none-eabi-gcc` with the Cortex-M33 flags. Without it, clangd parses the firmware as host (macOS) code and reports false errors.

### Model (training)

- Python and [uv](https://docs.astral.sh/uv/). In `model/`: `uv sync` installs dependencies, `uv run <script>` runs things, `uv add <package>` adds a dependency.
- Commit both `pyproject.toml` and `uv.lock`.

### Base station (Pi 5)

- A Raspberry Pi 5 with Python, [bleak](https://github.com/hbldh/bleak) and uv (same workflow as `model/`).
- Decoder and dashboard work doesn't need the Pi: bleak also runs on a laptop, and a phone running a BLE advertiser app such as nRF Connect can stand in as a node (see [Hardware](README.md#hardware)).

---

## Code style

The config files are the source of truth; this is the summary.

**All files** (`.editorconfig`): UTF-8, LF line endings, a final newline, no trailing whitespace.

**C and C++** (`.clang-format`): LLVM style with tabs, shown 4 wide, and a 100-column limit.
- Format only the lines you changed: stage your work, run `git clang-format`, review the result, then stage again. `git clang-format main` covers everything changed on your branch, and `clang-format -i <file>` formats a whole file.
- Keep formatting-only changes in their own `style:` commit, and don't reformat files you aren't otherwise changing.
- Leave third-party and vendored code (radio drivers, Bluetooth stacks, model runtimes) as it is.
- Naming follows the README's code: `snake_case` for functions and variables, a module prefix on public names (`mesh_`, `audio_`, ...), a `_t` suffix on typedefs (`mesh_pkt_t`), and `UPPER_SNAKE` for macros and enum constants.
- Data that lives in flash is `const` all the way down (for example `const void *const` for pointer tables), so the compiler rejects writes that would silently fail on hardware.

**Shell** (`scripts/`): tabs, like C. Start scripts with `#!/usr/bin/env bash` and `set -euo pipefail`, and keep them clean under [ShellCheck](https://www.shellcheck.net).

**Python:** PEP 8, formatted and linted with [Ruff](https://docs.astral.sh/ruff/): `uv run ruff format` and `uv run ruff check` (add it with `uv add --dev ruff`).

**Markdown:** 2-space indentation for nested lists, one paragraph per line (no hard wrapping). Trailing whitespace is kept in `.md` files on purpose, because two trailing spaces mean a line break.

---

## Project ground rules

These are specific to Serra, and reviewers will check them.

### The packet format is a contract

Nodes (C) and the base station (Python) have to agree byte for byte. If you change `mesh_pkt_t`, a payload struct or a message type:
- Update the firmware struct, the base-station decoder and the README's Mesh protocol section in the same PR.
- Keep wire structs `__attribute__((packed))` and use fixed-width types (`uint8_t`, `uint16_t`, ...).
- Multi-byte fields go over the air little-endian, the RP2350's native byte order. Decode them with `<` format strings in Python's `struct`.
- Stay inside the [payload budget](README.md#payload-budget): a legacy advertisement is 31 bytes, which leaves about 15 bytes of payload after our 9-byte header. Guard struct sizes so a layout change can't slip through, e.g. `static_assert(sizeof(mesh_pkt_t) == 9, "mesh header is 9 bytes");`.
- If old and new nodes can no longer understand each other, say so in the PR: every node needs reflashing.

### Build on the pinned Pico SDK

- **No new dependencies without a decision.** The Pico SDK and the libraries it bundles (CYW43 driver, BTstack, newlib) are the chosen base. If you think we need anything else, propose it as a design decision first.
- **One SDK version for everyone.** The firmware is built against Pico SDK 2.3.1 (`PICO_SDK_VERSION` in `scripts/install-firmware-tooling.sh`). An upgrade is its own PR: bump the script, rebuild, retest on hardware and update the docs.
- **SDK drivers before register code.** When you do need register-level access, for example for low-power states the SDK doesn't cover, use the SDK's `hardware/regs/` and `hardware/structs/` headers rather than hand-typed addresses.

### Leave the SDK's radio stack alone

We use the Pico SDK's CYW43 driver and BTstack as they are ([design decision 6](README.md#6-keep-the-pico-sdks-radio-driver)). Wrap them; don't patch them. If one of them blocks you, open an issue before reaching for a fork.

### Mind the power budget

Nodes run on batteries, and [listen cheaply, classify rarely](README.md#7-listen-cheaply-classify-rarely) is the core of the design.
- Core 0 runs a main loop that calls `cyw43_arch_poll()` (`pico_cyw43_arch_poll`), plus SDK alarms. Don't block or busy-wait in that loop or in an alarm callback: do a little work, return, and let the core wait for work (`cyw43_arch_wait_for_work_until()`) when there's nothing to do.
- Changes to always-on paths (the wake trigger, BLE scan windows) cost battery life. State the expected impact in your PR, with numbers if you have them: current draw, duty cycle, inference time.

### Record design changes

The README's [Design decisions](README.md#design-decisions) section is the project's decision log. If your change adds or reverses a decision, update it in the same PR, using the same **Decision** / **Why** format.

### Data and recordings

- Recordings live in `model/data/` on your machine and stay out of git. Document where to get them.
- Note the source and license of every dataset you use. The "help" and `other_speech` clips come from the [Multilingual Spoken Words Corpus](https://mlcommons.org/datasets/multilingual-spoken-words/) (CC-BY 4.0, so credit it).
- Get consent before recording people talking, even as background noise. That includes the "help" volunteer and anyone recorded screaming.
- When you can, record through the same mic the nodes use (INMP441); the mic shapes the signal.

---

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`.

- **Types:** `feat`, `fix`, `docs`, `style` (formatting and formatter config, no behavior change), `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- **Scopes** (optional) follow the layout: `runtime`, `audio`, `classifier`, `mesh`, `firmware` (for changes across several of those), `model`, `base-station`, `scripts`, `docs`.
- **Summary:** imperative, lowercase, no trailing period, under 72 characters.
- **Body:** explain why, especially for protocol and power changes.
- One logical change per commit.
- Pairing? Credit your partner with a `Co-authored-by: Name <email>` trailer.

```
docs: initialize readme
feat(mesh): drop packets already in the recently-seen cache
fix(audio): stop I2S capture before entering idle
perf(classifier): run inference only after the wake trigger fires
```

---

## Branches and pull requests

`main` should always build, flash and run the demo.

1. Branch from `main` with a short name, `<type>/<topic>`: for example `feat/mesh-dedup` or `fix/i2s-idle`. Outside contributors: fork the repo and branch there.
2. Keep the PR small and focused on one thing.
3. Give the PR a Conventional Commits title. PRs are squash-merged, so the title becomes the commit on `main`.
4. Describe what changed and why, and fill in the checklist below.
5. A teammate approves, then the author squash-merges.

Copy this into your PR description:

```markdown
- [ ] Formatted (`git clang-format` / `uv run ruff format`)
- [ ] Builds for `pico2_w` against Pico SDK 2.3.1 with no new warnings (and `rp2350-riscv` if RISC-V code changed)
- [ ] Tested on hardware: boards, INMP441 mic, alert classes exercised (whistle / scream / help)
- [ ] Packet format changed? Firmware, base station and README updated together
- [ ] Design decision changed? README updated
- [ ] Numbers or screenshots where relevant (inference time, power, hop count, latency, dashboard)
```

---

## Reporting bugs and proposing ideas

Open an [issue](https://github.com/Damilss/serra/issues).

**Bugs:** include what you expected and what happened, the hardware (boards, mic, power source), the build (commit, Pico SDK version, Arm or RISC-V, `arm-none-eabi-gcc --version`), steps to reproduce, and serial output or logs.

**Ideas:** check [Known limitations and open questions](README.md#known-limitations-and-open-questions) and [Future work](README.md#future-work) first; it may already be listed.

---

## License

Serra is licensed under the [GNU General Public License v3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

Only bring in third-party code, models or datasets whose license allows it, and note the source and license in your PR.
