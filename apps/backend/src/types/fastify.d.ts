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

/** Request.user shape — id/sessionId from authenticate; jwtVerify sets userId (alias for id). */
export interface FastifyUser {
  id: string;
  userId?: string;
  email?: string;
  phone?: string;
  role: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
