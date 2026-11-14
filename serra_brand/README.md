# Serra brand

- `serra-brand-kit.pdf` — the brand kit (logo, lockups, mark rules, color, type, in use, Serranet and Serranode).
- `logos/svg/` — vector logos, text converted to outlines (no font needed). Use these in the app and on the web.
- `logos/png/` — transparent PNGs. Marks are 512 px tall, wordmarks and lockups 320 px tall.

## File naming

`<name>-<piece>-<background>`

| Part | Values |
|---|---|
| name | `serra` (company and system), `serranet` (the mesh), `serranode` (the device) |
| piece | `mark` (symbol only), `wordmark` (word only), `lockup` (symbol + word) |
| background | `on-dark` (light logo for dark backgrounds), `on-light` (dark logo for light backgrounds) |

## Colors

| Name | Hex | Use |
|---|---|---|
| Night | `#0D1512` | Dark ground |
| Flare | `#FF5A1F` | The signal dot; one per view |
| Pine | `#1B2B24` | Surfaces on Night |
| Moss | `#8FA397` | Quiet text on Night; suffix on dark |
| Fog | `#EEF1EC` | Light ground; text on Night |
| Ember | `#B93A0B` | Flare for small text on Fog |
| Stone | `#56615B` | Secondary text on Fog; suffix on light |

## Type

Instrument Sans (SemiBold for display and "serra", Regular for body and the suffix, letter-spacing -0.045em on wordmarks). JetBrains Mono for node data.

## Serranet loading spinner

`serranet-mark-*.svg` has a square viewBox centred on the triangle, so it can be spun with CSS alone:

```css
@keyframes serranet-spin { to { transform: rotate(360deg); } }
.serranet-loading { animation: serranet-spin 1.4s linear infinite; transform-origin: 50% 50%; }
@media (prefers-reduced-motion: reduce) { .serranet-loading { animation: none; } }
```
