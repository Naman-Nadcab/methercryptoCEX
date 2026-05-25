/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Required by apps/frontend/Dockerfile (COPY .next/standalone). Safe for all deploys. */
  output: 'standalone',
  reactStrictMode: true,
  /**
   * Tree-shake + single-chunk barrel imports for the heaviest packages used across
   * the user app. `lightweight-charts` + `recharts` alone save ~250 KB on the
   * trade and dashboard routes once Next splits them into their own lazy chunks.
   * @see https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports
   */
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    /**
     * NOTE: `@tanstack/react-table` is deliberately excluded — its ESM build
     * in 14.0.4 trips Next's barrel optimizer ("'import' and 'export' may
     * appear only with 'sourceType: module'"). Upgrade Next ≥ 15 to re-enable.
     */
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'lightweight-charts',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-select',
      '@radix-ui/react-avatar',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      '@radix-ui/react-separator',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-progress',
      '@radix-ui/react-toast',
      'qrcode.react',
      'zod',
      'date-fns',
    ],
  },
  compiler: {
    /** Drop console.log/debug/info in prod bundles; keep warn/error for real incidents. */
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['warn', 'error'] } : false,
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
    minimumCacheTTL: 86400,
    formats: ['image/avif', 'image/webp'],
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
    const rows = [
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
    /**
     * Never send long-lived immutable caching for `/_next/static` in development:
     * chunk filenames stay stable (`webpack.js`) while contents change — browsers keep stale JS → blank screen + 404 cascades.
     * Production builds use content hashes on chunks; immutable cache is safe there.
     */
    if (process.env.NODE_ENV === 'production') {
      rows.push({
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      });
    }
    return rows;
  },
};

module.exports = nextConfig;
