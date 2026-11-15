// Alert chime: three sine notes through Web Audio (no audio files). Browsers only allow audio after a
// user gesture, so ensureAudio() is called from click handlers.

let actx: AudioContext | null = null;

export function ensureAudio() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = actx ?? new Ctx();
    void actx.resume?.();
  } catch {}
}

export function chime() {
  if (!actx) return;
  const ctx = actx;
  [0, 0.16, 0.32].forEach((d, k) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = ctx.currentTime + d;
    o.type = 'sine';
    o.frequency.value = [880, 1108, 1318][k];
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.5);
  });
}
