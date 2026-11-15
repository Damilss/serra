'use client';

// Like the dashboard, the venue demo is canvas and live data only, so it renders in the browser.

import dynamic from 'next/dynamic';

export const DemoClient = dynamic(() => import('@/components/demo/VenueDemo').then((m) => m.VenueDemo), {
  ssr: false,
});
