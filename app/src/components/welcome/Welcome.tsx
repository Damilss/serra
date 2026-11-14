'use client';

// Welcome screen: animated topo background, the hero lockup and pitch, and the base station's
// start-up log. "Open base station" plays the loading screen, then opens /dashboard.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { prefersReducedMotion } from '@/lib/format';
import { SerraLogo } from '../brand/Logos';
import { playLoader } from '../Loader';
import { BootLog } from './BootLog';
import { WelcomeCanvas } from './WelcomeCanvas';

export function Welcome() {
  const router = useRouter();

  // Old mockup links (index.html#dashboard) still land on the dashboard.
  useEffect(() => {
    if (window.location.hash === '#dashboard') router.replace('/dashboard');
  }, [router]);

  const enter = (e: React.MouseEvent) => {
    e.preventDefault();
    if (prefersReducedMotion()) router.push('/dashboard');
    else playLoader(() => router.push('/dashboard'));
  };

  return (
    <section id="welcome" className="welcome" aria-label="Welcome">
      <WelcomeCanvas />
      <div className="corner">
        <span className="label">Serra base station</span>
        <span className="label">Hollow Pine Wilderness</span>
        <span className="label">V0.1</span>
      </div>
      <div className="welcome-inner">
        <div className="hero">
          <SerraLogo animated />
          <p className="tagline">Audio-first distress reporting</p>
          <h1>No cell service. No cloud. Still heard.</h1>
          <p className="lede">
            Serranodes listen for distress whistles, screams and calls for help with an AI model running on
            the microcontroller. When one hears something, the alert hops across the Serranet to show rescuers
            where it was heard.
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
            <span className="hint">Served on local Wi-Fi · no internet needed</span>
          </div>
          <dl className="facts">
            <div>
              <dt>Serranodes</dt>
              <dd>5</dd>
            </div>
            <div>
              <dt>Cloud calls</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Alert payload</dt>
              <dd>9 B</dd>
            </div>
            <div>
              <dt>Sound classes</dt>
              <dd>3</dd>
            </div>
          </dl>
        </div>
        <BootLog />
      </div>
      <div className="corner">
        <span className="label">Off-grid search and rescue mesh</span>
        <span className="label">No cloud. No internet.</span>
      </div>
    </section>
  );
}
