/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Required by apps/frontend/Dockerfile (COPY .next/standalone). Safe for all deploys. */
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
      },
    ],
  },
  async redirects() {
    const raw = process.env.NEXT_PUBLIC_ADMIN_PANEL_URL || 'http://localhost:3001';
    const adminOrigin = raw.replace(/\/$/, '');
    return [
      { source: '/admin/login', destination: `${adminOrigin}/login`, permanent: false },
      { source: '/admin', destination: `${adminOrigin}/dashboard`, permanent: false },
      { source: '/admin/:path+', destination: `${adminOrigin}/:path+`, permanent: false },
    ];
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiBase.replace(/\/$/, '')}/api/v1/:path*`,
      },
      { source: '/favicon.ico', destination: '/icon.svg' },
      /* /spot is served by app/spot/page.tsx when present; rewrite applies if no file matches */
      { source: '/spot', destination: '/trade/spot' },
      { source: '/dashboard/trade', destination: '/trade/spot' },
      { source: '/dashboard/trade/spot', destination: '/trade/spot' },
    ];
  },
  async headers() {
    /** Keep security headers on HTML routes; omit from Next static/image (same idea as middleware matcher). */
    return [
      {
        source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
