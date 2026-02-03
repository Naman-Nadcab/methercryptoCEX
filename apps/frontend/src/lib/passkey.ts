/**
 * WebAuthn/Passkey Client Library - Production-Ready Implementation
 * 
 * This module handles all WebAuthn operations on the browser side.
 * 
 * IMPORTANT SECURITY NOTES:
 * 1. All cryptographic verification happens SERVER-SIDE
 * 2. This code only handles browser credential API interactions
 * 3. Never trust client-side validation for security decisions
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

// =============================================================================
// TYPES
// =============================================================================

export interface PasskeyError {
  code: string;
  message: string;
  originalError?: Error;
}

export interface PasskeyRegistrationResult {
  success: boolean;
  credential?: RegistrationResponseJSON;
  error?: PasskeyError;
}

export interface PasskeyAuthenticationResult {
  success: boolean;
  credential?: AuthenticationResponseJSON;
  error?: PasskeyError;
}

export interface PasskeyCapabilities {
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable: boolean;
  conditionalMediationAvailable: boolean;
}

// =============================================================================
// CAPABILITY DETECTION
// =============================================================================

/**
 * Check if the browser and device support passkeys
 * 
 * WHY: We need to know if we should show passkey options to the user
 * Don't show passkey UI if the device doesn't support it
 */
export async function checkPasskeyCapabilities(): Promise<PasskeyCapabilities> {
  const capabilities: PasskeyCapabilities = {
    webAuthnSupported: false,
    platformAuthenticatorAvailable: false,
    conditionalMediationAvailable: false,
  };

  // Check basic WebAuthn support
  if (!browserSupportsWebAuthn()) {
    return capabilities;
  }
  capabilities.webAuthnSupported = true;

  // Check for platform authenticator (Touch ID, Face ID, Windows Hello)
  try {
    capabilities.platformAuthenticatorAvailable = await platformAuthenticatorIsAvailable();
  } catch {
    capabilities.platformAuthenticatorAvailable = false;
  }

  // Check for conditional mediation (autofill)
  try {
    if (window.PublicKeyCredential && 
        typeof (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> }).isConditionalMediationAvailable === 'function') {
      capabilities.conditionalMediationAvailable = await (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable: () => Promise<boolean> }).isConditionalMediationAvailable();
    }
  } catch {
    capabilities.conditionalMediationAvailable = false;
  }

  return capabilities;
}

/**
 * Get a human-readable device name from user agent
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Android/.test(ua)) return 'Android Device';
  if (/Linux/.test(ua)) return 'Linux PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  
  return 'Unknown Device';
}

// =============================================================================
// REGISTRATION
// =============================================================================

/**
 * Register a new passkey
 * 
 * @param options - PublicKeyCredentialCreationOptionsJSON from server
 * @returns RegistrationResponseJSON to send to server for verification
 * 
 * WHY this flow:
 * 1. Server generates challenge and options
 * 2. Browser creates credential using platform authenticator
 * 3. Server verifies and stores the credential
 */
export async function registerPasskey(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<PasskeyRegistrationResult> {
  try {
    // Validate options
    if (!options || !options.challenge) {
      return {
        success: false,
        error: {
          code: 'INVALID_OPTIONS',
          message: 'Invalid registration options received from server',
        },
      };
    }

    // Check platform authenticator availability
    const platformAvailable = await platformAuthenticatorIsAvailable();
    if (!platformAvailable) {
      return {
        success: false,
        error: {
          code: 'NO_PLATFORM_AUTHENTICATOR',
          message: 'Touch ID / Face ID is not available on this device. Please enable biometric authentication in your device settings.',
        },
      };
    }

    console.log('[Passkey] Starting registration with options:', {
      rpId: options.rp.id,
      rpName: options.rp.name,
      userName: options.user.name,
      authenticatorSelection: options.authenticatorSelection,
    });

    // Start the WebAuthn registration ceremony
    // This will trigger the platform authenticator (Touch ID / Face ID)
    const credential = await startRegistration(options);

    console.log('[Passkey] Registration successful, credential created');

    return {
      success: true,
      credential,
    };

  } catch (error) {
    console.error('[Passkey] Registration error:', error);
    return {
      success: false,
      error: mapWebAuthnError(error, 'registration'),
    };
  }
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

/**
 * Authenticate with a passkey
 * 
 * @param options - PublicKeyCredentialRequestOptionsJSON from server
 * @returns AuthenticationResponseJSON to send to server for verification
 * 
 * WHY this flow:
 * 1. Server generates challenge and allowed credentials
 * 2. Browser gets assertion from platform authenticator
 * 3. Server verifies signature and counter
 */
export async function authenticateWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<PasskeyAuthenticationResult> {
  try {
    // Validate options
    if (!options || !options.challenge) {
      return {
        success: false,
        error: {
          code: 'INVALID_OPTIONS',
          message: 'Invalid authentication options received from server',
        },
      };
    }

    console.log('[Passkey] Starting authentication with options:', {
      rpId: options.rpId,
      allowCredentials: options.allowCredentials?.length || 0,
      userVerification: options.userVerification,
    });

    // Start the WebAuthn authentication ceremony
    const credential = await startAuthentication(options);

    console.log('[Passkey] Authentication successful, assertion received');

    return {
      success: true,
      credential,
    };

  } catch (error) {
    console.error('[Passkey] Authentication error:', error);
    return {
      success: false,
      error: mapWebAuthnError(error, 'authentication'),
    };
  }
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Map WebAuthn errors to user-friendly messages
 * 
 * WHY: WebAuthn errors are technical and confusing for users
 * We map them to actionable messages
 */
function mapWebAuthnError(error: unknown, operation: 'registration' | 'authentication'): PasskeyError {
  if (!(error instanceof Error)) {
    return {
      code: 'UNKNOWN_ERROR',
      message: `An unexpected error occurred during ${operation}. Please try again.`,
    };
  }

  const e = error;

  // NotAllowedError - User cancelled or timed out
  if (e.name === 'NotAllowedError') {
    // Check for specific messages
    if (e.message.includes('denied') || e.message.includes('not allowed')) {
      return {
        code: 'USER_CANCELLED',
        message: 'Operation was cancelled. Please try again.',
        originalError: e,
      };
    }
    if (e.message.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: 'The operation timed out. Please try again.',
        originalError: e,
      };
    }
    return {
      code: 'NOT_ALLOWED',
      message: operation === 'registration'
        ? 'Passkey registration was not allowed. Please make sure Touch ID / Face ID is enabled in your device settings.'
        : 'Passkey authentication was not allowed. Please try again.',
      originalError: e,
    };
  }

  // InvalidStateError - Credential already exists (registration) or not found (auth)
  if (e.name === 'InvalidStateError') {
    return {
      code: 'INVALID_STATE',
      message: operation === 'registration'
        ? 'A passkey already exists for this device. Please remove it first or use a different device.'
        : 'No matching passkey found on this device. Please register a passkey first.',
      originalError: e,
    };
  }

  // NotSupportedError - Unsupported algorithm or authenticator type
  if (e.name === 'NotSupportedError') {
    return {
      code: 'NOT_SUPPORTED',
      message: 'This device does not support the required security features for passkeys.',
      originalError: e,
    };
  }

  // SecurityError - RP ID mismatch or insecure context
  if (e.name === 'SecurityError') {
    return {
      code: 'SECURITY_ERROR',
      message: 'Security validation failed. Please make sure you are using the correct website.',
      originalError: e,
    };
  }

  // AbortError - Operation was aborted
  if (e.name === 'AbortError') {
    return {
      code: 'ABORTED',
      message: 'The operation was cancelled. Please try again.',
      originalError: e,
    };
  }

  // ConstraintError - Authenticator doesn't meet requirements
  if (e.name === 'ConstraintError') {
    return {
      code: 'CONSTRAINT_ERROR',
      message: 'Your device does not meet the security requirements. Please use a device with Touch ID or Face ID.',
      originalError: e,
    };
  }

  // TypeError - Invalid parameters (should not happen with proper implementation)
  if (e.name === 'TypeError') {
    return {
      code: 'TYPE_ERROR',
      message: 'An internal error occurred. Please refresh the page and try again.',
      originalError: e,
    };
  }

  // Unknown error
  return {
    code: 'UNKNOWN_ERROR',
    message: `An error occurred: ${e.message}`,
    originalError: e,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
};
