'use client';

// Switches between the field dashboard (the production vision: a ranger's view of a wilderness
// Serranet) and the venue demo (three nodes on a taped triangle, live trilateration).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard', label: 'Field' },
  { href: '/demo', label: 'Venue demo' },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav className="seg site-nav" aria-label="View">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
