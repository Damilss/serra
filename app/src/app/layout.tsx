import type { Metadata, Viewport } from 'next';
// Fonts are bundled from npm (no Google Fonts request), so the dashboard works with no internet.
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { Loader } from '@/components/Loader';

export const metadata: Metadata = {
  title: 'Serra Base Station',
  description:
    'Off-grid search and rescue: Serranodes hear distress calls and relay them across the Serranet.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D1512',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Loader />
      </body>
    </html>
  );
}
