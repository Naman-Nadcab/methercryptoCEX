# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone layout varies (flat vs apps/frontend/) depending on trace root; entrypoint handles both
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# When standalone nests apps/frontend, static + public must live next to server.js
COPY --from=builder /app/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/public ./apps/frontend/public

RUN chmod +x /app/docker-entrypoint.sh

# Switch to non-root user
USER nextjs

WORKDIR /app

# Expose port
EXPOSE 3000

# Environment variables
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
