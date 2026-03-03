// OAuth utility functions
import { getApiBaseUrl } from './getApiUrl';

const API_URL = getApiBaseUrl();

export interface OAuthResult {
  success: boolean;
  data?: {
    user: {
      id: string;
      email: string;
      phone: string | null;
      username: string | null;
      status: string;
      emailVerified: boolean;
      phoneVerified: boolean;
      tierLevel: number;
    };
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

const OAUTH_REDIRECT_KEY = 'oauth_redirect';

/**
 * Initiate Google OAuth login
 * @param redirect - Optional post-login redirect path (e.g. from ?redirect=)
 */
export async function initiateGoogleLogin(redirect?: string): Promise<void> {
  try {
    if (redirect && redirect.startsWith('/')) {
      typeof sessionStorage !== 'undefined' && sessionStorage.setItem(OAUTH_REDIRECT_KEY, redirect);
    }
    const redirectUri = `${window.location.origin}/auth/callback/google`;
    const response = await fetch(
      `${API_URL}/api/v1/auth/oauth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}`
    );
    const result = await response.json();

    if (result.success && result.data?.url) {
      // Redirect to Google (state is verified on backend via Redis)
      window.location.href = result.data.url;
    } else {
      throw new Error(result.error?.message || 'Failed to get Google OAuth URL');
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    throw error;
  }
}

/**
 * Handle Google OAuth callback
 */
export async function handleGoogleCallback(code: string, state: string): Promise<OAuthResult> {
  // State verification happens on backend via Redis
  const redirectUri = `${window.location.origin}/auth/callback/google`;
  const response = await fetch(`${API_URL}/api/v1/auth/oauth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
  });

  return response.json();
}

/**
 * Initiate Apple OAuth login
 * @param redirect - Optional post-login redirect path (e.g. from ?redirect=)
 */
export async function initiateAppleLogin(redirect?: string): Promise<void> {
  try {
    if (redirect && redirect.startsWith('/')) {
      typeof sessionStorage !== 'undefined' && sessionStorage.setItem(OAUTH_REDIRECT_KEY, redirect);
    }
    const redirectUri = `${window.location.origin}/auth/callback/apple`;
    const response = await fetch(
      `${API_URL}/api/v1/auth/oauth/apple/url?redirect_uri=${encodeURIComponent(redirectUri)}`
    );
    const result = await response.json();

    if (result.success && result.data?.url) {
      // Redirect to Apple (state is verified on backend via Redis)
      window.location.href = result.data.url;
    } else {
      throw new Error(result.error?.message || 'Failed to get Apple OAuth URL');
    }
  } catch (error) {
    console.error('Apple OAuth error:', error);
    throw error;
  }
}

/** Get and clear stored OAuth redirect. Returns path if valid (starts with /dashboard or /). */
export function consumeOAuthRedirect(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  const stored = sessionStorage.getItem(OAUTH_REDIRECT_KEY);
  sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
  if (stored && (stored.startsWith('/dashboard') || stored === '/' || (stored.startsWith('/') && !stored.includes('//')))) {
    return stored;
  }
  return null;
}

/**
 * Handle Apple OAuth callback
 */
export async function handleAppleCallback(
  code: string,
  idToken: string,
  state: string,
  user?: string
): Promise<OAuthResult> {
  // State verification happens on backend via Redis
  const response = await fetch(`${API_URL}/api/v1/auth/oauth/apple/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, id_token: idToken, state, user }),
  });

  return response.json();
}

/**
 * Initiate Telegram login via widget
 * This function should be called after the Telegram widget script is loaded
 */
export function initiateTelegramLogin(): void {
  // Telegram Login Widget will handle this
  // We need to set up the widget in the component
}

/**
 * Handle Telegram login callback
 */
export async function handleTelegramCallback(telegramData: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}): Promise<OAuthResult> {
  const response = await fetch(`${API_URL}/api/v1/auth/oauth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(telegramData),
  });

  return response.json();
}
