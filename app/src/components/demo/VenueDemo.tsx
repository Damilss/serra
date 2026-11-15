'use client';

// Venue demo (/demo): the live-demo view for three Serranodes on a taped triangle. A call is located
// by loudness trilateration (lib/venue.ts) and drawn on a floor plan of the triangle.
//
// Until the live feed is connected, calls are simulated: click the floor or a taped mark to "blow a
// whistle" there. With "Show caller" on (rehearsal), the true position is drawn next to the estimate.

import Link from 'next/link';
import { useEffect } from 'react';
import { useVenue } from '@/lib/venueStore';
import { SerraLogo } from '../brand/Logos';
import { Clock } from '../dashboard/TopBar';
import { SiteNav } from '../SiteNav';
import { VenueMap } from './VenueMap';
import { CallLog, ResultCard, SetupCard } from './VenuePanel';

export function VenueDemo() {
  // Read-only handle for the Playwright tests and the browser console.
  useEffect(() => {
    Object.defineProperty(window, 'serraVenue', {
      configurable: true,
      value: Object.freeze({
        get layout() {
          return useVenue.getState().layout;
        },
        get calls() {
          return useVenue.getState().calls;
        },
      }),
    });
  }, []);

  return (
    <section id="venue" className="dash" aria-label="Venue demo">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Serra home">
          <SerraLogo />
          <span className="sep" />
          <span className="label">Venue demo · 3 Serranodes</span>
        </Link>
        <SiteNav />
        <div className="chips">
          <span className="chip">
            Locating by <b>loudness</b>
          </span>
          <span className="chip">
            <Clock />
          </span>
        </div>
      </header>
      <div className="venue-stage">
        <VenueMap />
        <aside className="panel venue-side" aria-label="Located call">
          <ResultCard />
          <SetupCard />
          <CallLog />
        </aside>
      </div>
    </section>
  );
}
