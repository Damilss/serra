// Small formatting helpers shared by the components and the canvas drawing.

export const pad = (v: number | string) => String(v).padStart(2, '0');
export const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const hex4 = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');
export const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
/** peak_level (tenths of a dB) → "85.3", the same as the decoder's peak_db = peak_level / 10. */
export const db = (peak: number) => (peak / 10).toFixed(1);
/** Seconds since the app started, the clock alerts and animations run on. */
export const now = () => performance.now() / 1000;

/** Small seeded PRNG, so mock jitter and waveforms come out the same on every load. */
export const mulberry = (seed: number) => () => {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  seed = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
