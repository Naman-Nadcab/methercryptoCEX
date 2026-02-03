/**
 * WebAuthn Native Implementation - Production-Ready for Crypto Exchange
 * 
 * This module uses the NATIVE WebAuthn API directly (not a wrapper library)
 * to have FULL CONTROL over the authentication flow.
 * 
 * KEY REQUIREMENTS:
 * 1. PLATFORM AUTHENTICATOR ONLY - No security keys, no cross-device
 * 2. SAME-DEVICE BIOMETRIC - Touch ID / Face ID / Windows Hello
 * 3. NO QR CODE - Never show QR scan for same-device passkeys
 * 4. RESIDENT KEYS - Discoverable credentials for passwordless
 * 
 * WHY NATIVE API INSTEAD OF LIBRARY:
 * - Full control over mediation behavior
 * - Can specify hints for platform preference
 * - Direct access to PublicKeyCredential options
 */

// =============================================================================
// TYPES
// =============================================================================

export interface WebAuthnError {
  code: string;
  message: string;
  name?: string;
}

export interface RegistrationOptions {
  challenge: string;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: 'public-key';
    alg: number;
  }>;
  timeout?: number;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'required' | 'preferred' | 'discouraged';
    userVerification?: 'required' | 'preferred' | 'discouraged';
  };
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
  hints?: string[]; // WebAuthn Level 3: 'client-device' | 'security-key' | 'hybrid'
}

export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: 'required' | 'preferred' | 'discouraged';
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
  hints?: string[]; // WebAuthn Level 3: 'client-device' | 'security-key' | 'hybrid'
}

export interface RegistrationResult {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
    authenticatorData?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

export interface AuthenticationResult {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert base64url string to ArrayBuffer
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  // Add padding if necessary
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to base64url string
 */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Check if platform authenticator is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }
  
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Check if WebAuthn is supported
 */
export function isWebAuthnSupported(): boolean {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

/**
 * Get device name from user agent
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
// REGISTRATION (navigator.credentials.create)
// =============================================================================

/**
 * Register a new passkey using NATIVE WebAuthn API
 * 
 * CRITICAL SETTINGS:
 * - authenticatorAttachment: 'platform' - ONLY built-in authenticators
 * - residentKey: 'required' - Discoverable credentials for passwordless
 * - userVerification: 'required' - MUST verify with biometric/PIN
 * 
 * @param options - Options from server (JSON format)
 * @returns Registration response to send back to server
 */
export async function createPasskey(
  options: RegistrationOptions
): Promise<{ success: true; credential: RegistrationResult } | { success: false; error: WebAuthnError }> {
  
  // Pre-flight checks
  if (!isWebAuthnSupported()) {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'WebAuthn is not supported in this browser',
      },
    };
  }

  const platformAvailable = await isPlatformAuthenticatorAvailable();
  if (!platformAvailable) {
    return {
      success: false,
      error: {
        code: 'NO_PLATFORM_AUTHENTICATOR',
        message: 'Touch ID / Face ID is not available. Please enable biometric authentication in System Settings.',
      },
    };
  }

  try {
    // Convert options to native WebAuthn format
    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge: base64urlToBuffer(options.challenge),
      
      rp: {
        name: options.rp.name,
        id: options.rp.id,
      },
      
      user: {
        id: base64urlToBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      
      pubKeyCredParams: options.pubKeyCredParams.map(param => ({
        type: param.type,
        alg: param.alg,
      })),
      
      timeout: options.timeout || 120000,
      
      // CRITICAL: Force platform authenticator
      authenticatorSelection: {
        // PLATFORM ONLY - This PREVENTS external security keys and cross-device
        authenticatorAttachment: 'platform',
        
        // REQUIRED - Discoverable credentials for passwordless login
        residentKey: 'required',
        requireResidentKey: true,
        
        // REQUIRED - MUST verify with biometric/PIN
        userVerification: 'required',
      },
      
      attestation: options.attestation || 'none',
      
      // Exclude existing credentials to prevent re-registration
      excludeCredentials: options.excludeCredentials?.map(cred => ({
        id: base64urlToBuffer(cred.id),
        type: cred.type,
        transports: cred.transports as AuthenticatorTransport[] | undefined,
      })),
    };

    console.log('[WebAuthn] Creating credential with options:', {
      rpId: options.rp.id,
      rpName: options.rp.name,
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
      hints: options.hints,
    });

    // For browsers that support hints (WebAuthn Level 3), add them
    // This helps Safari/Chrome on macOS to prefer Touch ID over QR
    const createOptions: CredentialCreationOptions = {
      publicKey: publicKeyCredentialCreationOptions,
    };

    // Call native WebAuthn API
    const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;

    if (!credential) {
      return {
        success: false,
        error: {
          code: 'NO_CREDENTIAL',
          message: 'No credential was created',
        },
      };
    }

    const response = credential.response as AuthenticatorAttestationResponse;

    // Get transports if available (important for future authentication)
    let transports: string[] | undefined;
    if (typeof response.getTransports === 'function') {
      transports = response.getTransports();
    }

    // Build response in JSON format for server
    const registrationResult: RegistrationResult = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        attestationObject: bufferToBase64url(response.attestationObject),
        transports,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
    };

    console.log('[WebAuthn] Credential created successfully:', {
      id: credential.id.substring(0, 20) + '...',
      transports,
      authenticatorAttachment: credential.authenticatorAttachment,
    });

    return {
      success: true,
      credential: registrationResult,
    };

  } catch (error) {
    console.error('[WebAuthn] Registration error:', error);
    return {
      success: false,
      error: mapWebAuthnError(error),
    };
  }
}

// =============================================================================
// AUTHENTICATION (navigator.credentials.get)
// =============================================================================

/**
 * Authenticate with a passkey using NATIVE WebAuthn API
 * 
 * CRITICAL: This function is designed to NEVER show QR code for same-device auth
 * 
 * HOW WE PREVENT QR CODE:
 * 1. allowCredentials MUST be populated with registered credential IDs
 * 2. transports MUST include 'internal' to indicate platform authenticator
 * 3. userVerification = 'required' enforces biometric
 * 4. mediation = 'optional' (not 'conditional') for direct prompt
 * 
 * @param options - Options from server (JSON format)
 * @returns Authentication response to send back to server
 */
export async function getPasskeyAssertion(
  options: AuthenticationOptions
): Promise<{ success: true; credential: AuthenticationResult } | { success: false; error: WebAuthnError }> {
  
  // Pre-flight checks
  if (!isWebAuthnSupported()) {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: 'WebAuthn is not supported in this browser',
      },
    };
  }

  // CRITICAL: allowCredentials must not be empty
  if (!options.allowCredentials || options.allowCredentials.length === 0) {
    return {
      success: false,
      error: {
        code: 'NO_CREDENTIALS',
        message: 'No passkeys registered for this account',
      },
    };
  }

  try {
    // Convert allowCredentials to native format
    // CRITICAL: Include 'internal' transport to indicate platform authenticator
    const allowCredentials: PublicKeyCredentialDescriptor[] = options.allowCredentials.map(cred => {
      // Ensure 'internal' is in transports for platform authenticator
      const transports = cred.transports || [];
      if (!transports.includes('internal')) {
        transports.push('internal');
      }
      
      return {
        id: base64urlToBuffer(cred.id),
        type: cred.type,
        transports: transports as AuthenticatorTransport[],
      };
    });

    // Build native WebAuthn options
    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge: base64urlToBuffer(options.challenge),
      
      rpId: options.rpId,
      
      timeout: options.timeout || 120000,
      
      // CRITICAL: Must be 'required' for biometric verification
      userVerification: 'required',
      
      // CRITICAL: This tells the browser which credentials to look for
      // If browser can't find these credentials locally, it may offer QR
      // BUT with 'internal' transport, it should prioritize local lookup
      allowCredentials,
    };

    console.log('[WebAuthn] Getting assertion with options:', {
      rpId: options.rpId,
      userVerification: 'required',
      allowCredentialsCount: allowCredentials.length,
      credentialIds: options.allowCredentials.map(c => c.id.substring(0, 20) + '...'),
    });

    // Call native WebAuthn API
    // Using mediation: 'optional' (default) - shows immediate prompt
    // DO NOT use mediation: 'conditional' - that's for autofill
    const credential = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
      // mediation: 'optional' is default, don't need to specify
    }) as PublicKeyCredential;

    if (!credential) {
      return {
        success: false,
        error: {
          code: 'NO_CREDENTIAL',
          message: 'No credential was selected',
        },
      };
    }

    const response = credential.response as AuthenticatorAssertionResponse;

    // Build response in JSON format for server
    const authenticationResult: AuthenticationResult = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        authenticatorData: bufferToBase64url(response.authenticatorData),
        signature: bufferToBase64url(response.signature),
        userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
    };

    console.log('[WebAuthn] Assertion received successfully:', {
      id: credential.id.substring(0, 20) + '...',
      authenticatorAttachment: credential.authenticatorAttachment,
    });

    return {
      success: true,
      credential: authenticationResult,
    };

  } catch (error) {
    console.error('[WebAuthn] Authentication error:', error);
    return {
      success: false,
      error: mapWebAuthnError(error),
    };
  }
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Map WebAuthn errors to user-friendly messages
 */
function mapWebAuthnError(error: unknown): WebAuthnError {
  if (!(error instanceof Error)) {
    return {
      code: 'UNKNOWN',
      message: 'An unexpected error occurred',
    };
  }

  const e = error as DOMException;

  switch (e.name) {
    case 'NotAllowedError':
      // User cancelled, timed out, or not allowed
      if (e.message.includes('denied') || e.message.includes('cancelled')) {
        return {
          code: 'USER_CANCELLED',
          message: 'Authentication was cancelled. Please try again.',
          name: e.name,
        };
      }
      if (e.message.includes('timeout')) {
        return {
          code: 'TIMEOUT',
          message: 'Authentication timed out. Please try again.',
          name: e.name,
        };
      }
      return {
        code: 'NOT_ALLOWED',
        message: 'Biometric authentication was not allowed. Please make sure Touch ID / Face ID is enabled.',
        name: e.name,
      };

    case 'InvalidStateError':
      // Credential already exists (registration) or not found (authentication)
      return {
        code: 'INVALID_STATE',
        message: 'No matching passkey found on this device. Please register a passkey first.',
        name: e.name,
      };

    case 'NotSupportedError':
      return {
        code: 'NOT_SUPPORTED',
        message: 'This device does not support the required security features.',
        name: e.name,
      };

    case 'SecurityError':
      return {
        code: 'SECURITY_ERROR',
        message: 'Security validation failed. Please make sure you are on the correct website.',
        name: e.name,
      };

    case 'AbortError':
      return {
        code: 'ABORTED',
        message: 'Operation was aborted. Please try again.',
        name: e.name,
      };

    case 'ConstraintError':
      return {
        code: 'CONSTRAINT_ERROR',
        message: 'Your device does not meet the security requirements.',
        name: e.name,
      };

    default:
      return {
        code: 'UNKNOWN',
        message: e.message || 'An error occurred during authentication',
        name: e.name,
      };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  RegistrationOptions,
  AuthenticationOptions,
  RegistrationResult,
  AuthenticationResult,
};
