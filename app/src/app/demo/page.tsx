import type { Metadata } from 'next';
import { DemoClient } from './DemoClient';

export const metadata: Metadata = { title: 'Serra Base Station · Venue demo' };

export default function DemoPage() {
  return <DemoClient />;
}
