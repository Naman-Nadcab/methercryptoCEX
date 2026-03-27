/**
 * Public auth routes that bypass heavy middleware (session-core, IP rules, VPN check).
 * Keep this list in sync with the user login/signup funnel (OTP, passkey, OAuth, refresh).
 * Admin login uses /api/v1/admin/* — not listed here.
 */
export const PUBLIC_AUTH_ROUTES = new Set([
  // OTP / password login funnel
  '/api/v1/auth/send-otp',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
  '/api/v1/auth/login/resend-otp',
  '/api/v1/auth/login/check-passkeys',
  '/api/v1/auth/login/verify-step',
  '/api/v1/auth/refresh',
  // Passkey (unauthenticated steps)
  '/api/v1/auth/passkey/authenticate/options',
  '/api/v1/auth/passkey/authenticate/verify',
  // OAuth (initiate + callback)
  '/api/v1/auth/oauth/google/url',
  '/api/v1/auth/oauth/google/callback',
  '/api/v1/auth/oauth/apple/url',
  '/api/v1/auth/oauth/apple/callback',
  '/api/v1/auth/oauth/telegram',
]);
