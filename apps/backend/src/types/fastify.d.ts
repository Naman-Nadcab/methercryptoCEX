/**
 * Fastify module augmentation — authenticate decorator and request.user typing.
 * Ensures request.user is never string | Buffer | unknown.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

/** Canonical JWT payload shape. Enforces deterministic payload with id. */
export interface JwtUserPayload {
  userId: string;
  email?: string;
  phone?: string;
  role: string;
  sessionId: string;
  type?: string;
}

/** Request.user shape — id/sessionId from authenticate; jwtVerify sets userId (alias for id). API key auth may set permission and scopes. */
export interface FastifyUser {
  id: string;
  userId?: string;
  email?: string;
  phone?: string;
  role: string;
  sessionId: string;
  /** Set when authenticated via X-API-Key; undefined for JWT (treated as read_write). */
  permission?: 'read_only' | 'read_write';
  /** Set when authenticated via X-API-Key; true = allow, false = key has no_withdraw scope. Undefined for JWT (treated as allow). */
  allowWithdraw?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Sets request.user if valid token; does not fail if no token. */
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** JWT or X-API-Key (for market making / bots). */
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: FastifyUser;
    requestId?: string;
  }
}

/** Augment @fastify/jwt so request.user has deterministic shape (id, sessionId, email). */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: FastifyUser;
  }
}
