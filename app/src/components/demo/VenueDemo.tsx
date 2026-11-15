'use client';

// Venue demo (/demo): the live-demo view for three Serranodes on a taped triangle. Detect-only: a
// call shows that the nodes heard it, classified it on the device, flooded an alert across the mesh,
// and that the base station received it. It is not located on the floor.
//
// Calls come live from the base-station decoder (serra-base, over the Pi's USB link) once the Live
// decoder card is connected, or are simulated: click the floor or a taped mark to "blow a whistle"
// there (rehearsal without hardware).

import Link from 'next/link';
import { useEffect } from 'react';
import { connectDecoder, createGrouper } from '@/lib/decoder';
import { useVenue } from '@/lib/venueStore';
import { SerraLogo } from '../brand/Logos';
import { Clock } from '../dashboard/TopBar';
import { SiteNav } from '../SiteNav';
import { VenueMap } from './VenueMap';
import { CallLog, LiveCard, ResultCard, SetupCard } from './VenuePanel';

/** Keeps the page connected to the decoder while the Live decoder card is switched on. */
function useDecoderLink() {
  const liveOn = useVenue((s) => s.liveOn);
  const url = useVenue((s) => s.decoderUrl);
  useEffect(() => {
    if (!liveOn) return;
    const v = useVenue.getState();
    const grouper = createGrouper(
      (heard) => useVenue.getState().ingest(heard),
      // close a group early once every corner's node is in (only once all three are known)
      () => {
        const s = useVenue.getState();
        return s.assigned.every(Boolean) ? s.nodeIds : [];
      },
    );
    const stop = connectDecoder(url, {
      event: (e) => {
        useVenue.getState().packetSeen();
        grouper.push(e);
      },
      state: v.setLink,
      health: v.setHealth,
    });
    return () => {
      grouper.reset();
      stop();
    };
  }, [liveOn, url]);
}

const CHIP = { off: 'connecting', connecting: 'connecting', live: 'live', down: 'lost' } as const;

export function VenueDemo() {
  useDecoderLink();
  const liveOn = useVenue((s) => s.liveOn);
  const link = useVenue((s) => s.link);
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
          <span className="chip" id="venue-chip">
            {liveOn ? (
              <>
                Decoder <b>{CHIP[link]}</b>
              </>
            ) : (
              <>
                Calls <b>simulated</b>
              </>
            )}
          </span>
          <span className="chip">
            <Clock />
          </span>
        </div>
      </header>
      <div className="venue-stage">
        <VenueMap />
        <aside className="panel venue-side" aria-label="Detected call">
          <ResultCard />
          <LiveCard />
          <SetupCard />
          <CallLog />
        </aside>
      </div>
    </section>
  );
}
