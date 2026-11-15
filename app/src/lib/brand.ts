// Brand colors for canvas drawing (serra_brand/README.md). CSS uses the same values as variables.

export const C = {
  night: '#0D1512',
  pine: '#1B2B24',
  moss: '#8FA397',
  fog: '#EEF1EC',
  flare: '#FF5A1F',
  ember: '#B93A0B',
  stone: '#56615B',
} as const;

/** Appends an alpha byte to a hex color: A(C.flare, 0.5) → '#FF5A1F80'. */
export const A = (hex: string, a: number) =>
  hex +
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');

const MONO = '"JetBrains Mono Variable", "JetBrains Mono", monospace';

/** Sets the canvas font to the brand's mono caps style. */
export function monoFont(ctx: CanvasRenderingContext2D, size: number, weight = 500) {
  ctx.font = `${weight} ${size}px ${MONO}`;
  try {
    ctx.letterSpacing = '0.08em';
  } catch {}
}

/** Sizes a canvas for its CSS box at device-pixel resolution (capped at 2×) and returns its context. */
export function sizeCanvas(cv: HTMLCanvasElement, W: number, H: number) {
  const d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * d);
  cv.height = Math.round(H * d);
  const c = cv.getContext('2d')!;
  c.setTransform(d, 0, 0, d, 0, 0);
  return c;
}
