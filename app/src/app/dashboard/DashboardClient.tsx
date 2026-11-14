'use client';

// The dashboard runs entirely in the browser: canvases, the clock, audio and live data. Rendering it
// on the server would only produce a stale snapshot, so it is loaded client-side.

import dynamic from 'next/dynamic';

export const DashboardClient = dynamic(
  () => import('@/components/dashboard/Dashboard').then((m) => m.Dashboard),
  { ssr: false },
);
