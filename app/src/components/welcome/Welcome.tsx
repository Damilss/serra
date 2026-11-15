'use client';

// Welcome screen: animated topo background, the hero lockup and pitch, and the base station's
// start-up log. "Open base station" plays the loading screen, then opens /dashboard.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SerraLogo } from '../brand/Logos';
import { playLoader } from '../Loader';
import { BootLog } from './BootLog';
import { WelcomeCanvas } from './WelcomeCanvas';

export function Welcome() {
  const router = useRouter();

  // Links to "/#dashboard" (the old single-page mockup's URL) still land on the dashboard.
  useEffect(() => {
    if (window.location.hash === '#dashboard') router.replace('/dashboard');
  }, [router]);

  const enter = (e: React.MouseEvent) => {
    e.preventDefault();
    playLoader(() => router.push('/dashboard'));
  };

  return (
    <section id="welcome" className="welcome" aria-label="Welcome">
      <WelcomeCanvas />
      <div className="welcome-inner">
        <div className="hero">
          <SerraLogo animated />
          <p className="tagline">When the trail goes dark</p>
          <h1>Off-grid search and rescue mesh</h1>
          <p className="lede">
            Serranodes listen for distress whistles, screams and calls for help using our proprietary audio
            classification model running locally. Alerts hop across the Serranet to a base station,
            establishing search zones in minutes rather than hours.
          </p>
          <div className="cta-row">
            <Link href="/dashboard" className="cta" id="enter" onClick={enter}>
              Open base station
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
            <span className="hint">No cell · No satellite</span>
          </div>
        </div>
        <BootLog />
      </div>
    </section>
  );
}
