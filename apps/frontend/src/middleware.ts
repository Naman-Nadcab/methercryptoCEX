/**
 * Legacy → canonical 308 redirects when `NEXT_PUBLIC_CANONICAL_ROUTES=true`.
 * Preserves `search` on every redirect. Order: exact list → dashboard map → p2p map.
 * See `src/lib/routes.ts` and `CANONICAL_REDIRECTS_EXACT` in `tier1-canonical-routes.ts`.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  CANONICAL_REDIRECTS_EXACT,
  isDeprecatedRoutePath,
} from '@/lib/tier1-canonical-routes';
import {
  mapLegacyDashboardPathToCanonical,
  mapLegacyP2pPathToCanonical,
} from '@/lib/tier1-shell-routes';

const CANONICAL_ENABLED = process.env.NEXT_PUBLIC_CANONICAL_ROUTES === 'true';
const DEPRECATED_LOG = process.env.ENABLE_DEPRECATED_ROUTE_LOG === 'true';

/** 308 = permanent redirect, preserves method (GET); safe for bookmarked URLs. */
const REDIRECT_STATUS = 308;

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (DEPRECATED_LOG && isDeprecatedRoutePath(pathname)) {
    console.info(
      JSON.stringify({
        event: 'deprecated_route_hit',
        path: pathname,
        ts: new Date().toISOString(),
      })
    );
  }

  if (!CANONICAL_ENABLED) {
    return NextResponse.next();
  }

  for (const { from, to, note } of CANONICAL_REDIRECTS_EXACT) {
    if (pathname === from && to !== from) {
      const url = request.nextUrl.clone();
      url.pathname = to;
      url.search = search;
      if (DEPRECATED_LOG) {
        console.info(
          JSON.stringify({
            event: 'canonical_redirect',
            from: pathname,
            to,
            note,
            ts: new Date().toISOString(),
          })
        );
      }
      return NextResponse.redirect(url, REDIRECT_STATUS);
    }
  }

  const legacyMapped = mapLegacyDashboardPathToCanonical(pathname);
  if (legacyMapped && legacyMapped !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = legacyMapped;
    url.search = search;
    if (DEPRECATED_LOG) {
      console.info(
        JSON.stringify({
          event: 'canonical_redirect',
          from: pathname,
          to: legacyMapped,
          note: 'legacy_dashboard_shell',
          ts: new Date().toISOString(),
        })
      );
    }
    return NextResponse.redirect(url, REDIRECT_STATUS);
  }

  const p2pMapped = mapLegacyP2pPathToCanonical(pathname);
  if (p2pMapped && p2pMapped !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = p2pMapped;
    url.search = search;
    if (DEPRECATED_LOG) {
      console.info(
        JSON.stringify({
          event: 'canonical_redirect',
          from: pathname,
          to: p2pMapped,
          note: 'legacy_p2p_v2',
          ts: new Date().toISOString(),
        })
      );
    }
    return NextResponse.redirect(url, REDIRECT_STATUS);
  }

  return NextResponse.next();
}

/**
 * Skip middleware for static assets and Next internals. Use the **documented**
 * pattern only — overly complex regex can fail to parse and Next will fall back
 * to matching **all** routes (`/:path*`), which can break CSS/JS in production.
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
 */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)',
  ],
};
