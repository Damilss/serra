import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dashboard is served on the base station's local network with no internet:
  // nothing here may depend on a CDN at runtime (fonts are bundled from @fontsource).
  poweredByHeader: false,
};

export default nextConfig;
