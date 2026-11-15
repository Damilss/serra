'use client';

// Loading screen between the welcome page and the dashboard: the call mark's arcs turn into three
// circles and all four orbit. Purely for show (about 3.5 s).
// Lives in the root layout so it survives the route change and can fade out over the dashboard.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { create } from 'zustand';
import { Arcs } from './brand/Logos';

type Phase = 'idle' | 'in' | 'morph' | 'spin' | 'online' | 'out';

const useLoader = create<{ phase: Phase; set: (p: Phase) => void }>()((set) => ({
  phase: 'idle',
  set: (phase) => set({ phase }),
}));

const TEXT: Record<Phase, [string, string]> = {
  idle: ['', ''],
  in: ['Joining Serranet', 'Scanning BLE'],
  morph: ['Joining Serranet', 'Syncing 5 Serranodes'],
  spin: ['Joining Serranet', 'Syncing 5 Serranodes'],
  online: ['Serranet online', 'Opening map'],
  out: ['Serranet online', 'Opening map'],
};

/** Plays the loading screen, then navigates to `href`. Returns false if it's already playing. */
export function playLoader(navigate: () => void) {
  const { phase, set } = useLoader.getState();
  if (phase !== 'idle') return false;
  set('in');
  setTimeout(() => set('morph'), 1000);
  setTimeout(() => set('spin'), 1750);
  setTimeout(() => set('online'), 2500);
  setTimeout(() => {
    navigate();
    set('out');
  }, 3100);
  setTimeout(() => set('idle'), 3500);
  return true;
}

export function Loader() {
  const phase = useLoader((s) => s.phase);
  const router = useRouter();
  // warm up the dashboard route while the welcome screen is showing
  useEffect(() => {
    router.prefetch('/dashboard');
  }, [router]);
  if (phase === 'idle') return null;
  const cls = ['loader', phase !== 'out' && 'in', phase === 'out' && 'out']
    .concat(['morph', 'spin', 'online', 'out'].includes(phase) ? 'morph' : [])
    .concat(['spin', 'online', 'out'].includes(phase) ? 'spin' : [])
    .filter(Boolean)
    .join(' ');
  const [text, sub] = TEXT[phase];
  return (
    <div className={cls} id="loader" role="status" aria-live="polite">
      <svg className="ld-svg" viewBox="0 0 120 120" aria-hidden="true">
        <g className="ld-arcs" transform="translate(17 28)">
          <Arcs />
        </g>
        <g className="ld-ring">
          <circle className="ld-c c1" r="7.5" fill="#EEF1EC" />
          <circle className="ld-c c2" r="7.5" fill="#EEF1EC" />
          <circle className="ld-c c3" r="7.5" fill="#EEF1EC" />
          <circle className="ld-c ld-dot" r="7.5" fill="#FF5A1F" />
        </g>
      </svg>
      <span className="label ld-text" id="ld-text">
        {text}
      </span>
      <span className="label ld-sub" id="ld-sub">
        {sub}
      </span>
    </div>
  );
}
