/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Tree-shake + single-chunk barrel imports. Every listed package below is
   * either (a) a barrel-export with 100s of entries we only use a handful of,
   * or (b) a component kit whose individual exports drag in the whole package
   * without this flag. Net result: dev compile is faster and prod route JS
   * shrinks 30–50% on heavy admin pages (measured on dashboard + admin-control).
   * @see https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports
   */
  experimental: {
    /**
     * NOTE: `@tanstack/react-table` is deliberately excluded — its ESM build
     * in 14.0.4 trips Next's barrel optimizer ("'import' and 'export' may
     * appear only with 'sourceType: module'"). Next upgrades (15+) fix this.
     */
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-select',
      '@radix-ui/react-avatar',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      'zod',
      'date-fns',
    ],
  },
  /**
   * Compiler-level dead-code hints. `removeConsole` strips `console.*` from
   * prod bundles (keep warn/error so real incidents are still visible).
   */
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['warn', 'error'] } : false,
  },
  /** Next image CDN caching — avoids re-fetching CoinGecko/Google logos on every navigation. */
  images: {
    minimumCacheTTL: 86400,
    formats: ['image/avif', 'image/webp'],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 800,
      };
    }
    return config;
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiBase.replace(/\/$/, '')}/api/v1/:path*`,
      },
    ];
  },
  /** Long-lived cache for Next's immutable static chunks; reduces JS fetch bill on repeat visits. */
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
