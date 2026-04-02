# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage
FROM node:20-alpine AS runner

RUN apk add --no-cache wget

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 indexer

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p logs && chown -R indexer:nodejs logs

USER indexer

EXPOSE 4001

ENV INDEXER_API_PORT=4001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4001/health || exit 1

CMD ["node", "dist/index.js"]
