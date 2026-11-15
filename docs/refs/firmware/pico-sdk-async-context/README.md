# Pico SDK `async_context` (reference copy)

Read-only copies of the Pico SDK files behind our core 0 main loop, so the team can read and link to them without digging through `$PICO_SDK_PATH`.

**Not compiled.** The build always uses the SDK's own headers from `$PICO_SDK_PATH`. Don't move these files onto the include path: a copy of `pico/async_context.h` there would shadow the real one and go stale on the next SDK upgrade.

| File | SDK path | What it is |
|---|---|---|
| `async_context.h` | `src/rp2_common/pico_async_context/include/pico/async_context.h` | The API we use: at-time workers (`async_context_add_at_time_worker_in_ms`), when-pending workers (`async_context_add_when_pending_worker`, `async_context_set_work_pending`), `async_context_poll`, `async_context_wait_for_work_until` |
| `async_context_poll.h` | `src/rp2_common/pico_async_context/include/pico/async_context_poll.h` | The poll-mode context type that `pico_cyw43_arch_poll` creates |
| `async_context_poll.c` | `src/rp2_common/pico_async_context/async_context_poll.c` | Poll-mode implementation. Note `async_context_poll_wait_for_work_until()`: it sleeps until the earlier of the deadline passed in and the next at-time worker, which is why `main.c` can pass `at_the_end_of_time` |
| `LICENSE.TXT` | `LICENSE.TXT` | The SDK's BSD-3-Clause license, which these copies are redistributed under |

Copied from Pico SDK **2.3.1**, the version the firmware builds against (see CONTRIBUTING, "One SDK version for everyone"). Update these copies in the same PR as any SDK upgrade.

How we use it: `cyw43_arch_async_context()` returns the context that BTstack and the CYW43 driver already run on. Our periodic work (LED, test beacon, later the mesh tx queue) runs on it as at-time workers that re-add themselves; `main.c` loops on `cyw43_arch_poll()` + `cyw43_arch_wait_for_work_until()`. See the README's "Low-power runtime" section.
