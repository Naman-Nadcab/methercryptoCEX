# CryptoExchange - Enterprise-Grade Cryptocurrency Exchange

A complete, production-ready cryptocurrency exchange platform featuring spot trading, P2P marketplace, multi-chain wallet support, and enterprise-grade security.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (Nginx)                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              ┌─────▼─────┐                   ┌─────▼─────┐
              │  Frontend │                   │  Backend  │
              │ (Next.js) │                   │ (Express) │
              └───────────┘                   └─────┬─────┘
                                                    │
              ┌─────────────────────────────────────┼─────────────────┐
              │                                     │                 │
        ┌─────▼─────┐    ┌──────────┐    ┌────────▼────────┐    ┌────▼────┐
        │PostgreSQL │    │  Redis   │    │   RabbitMQ     │    │WebSocket│
        │   (DB)    │    │ (Cache)  │    │   (Queue)      │    │ Server  │
        └───────────┘    └──────────┘    └────────────────┘    └─────────┘
```

## Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Data Fetching**: TanStack Query
- **Charts**: Lightweight Charts
- **Forms**: React Hook Form + Zod

### Backend
- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Cache**: Redis
- **Message Queue**: RabbitMQ
- **WebSocket**: ws

### Blockchain
- **EVM Chains**: Ethers.js
- **Solana**: @solana/web3.js
- **Bitcoin**: bitcoinjs-lib
- **Tron**: TronWeb

## Features

### User Management
- ✅ Email/Password authentication
- ✅ Google OAuth
- ✅ Apple OAuth
- ✅ Email verification (OTP)
- ✅ Phone verification (SMS OTP)
- ✅ Two-factor authentication
- ✅ Referral system

### KYC System
- ✅ PAN verification
- ✅ Aadhaar verification
- ✅ Face liveness detection
- ✅ Geo-location capture
- ✅ KYC level tracking

### Wallet System
- ✅ Auto-wallet generation on signup
- ✅ HD wallets (BIP32/BIP44)
- ✅ Multi-chain support:
  - Ethereum, BSC, Polygon
  - Arbitrum, Optimism, Base
  - Solana
  - Tron
  - Bitcoin
- ✅ AES-256 encryption
- ✅ HSM-ready architecture

### Spot Trading
- ✅ Market orders
- ✅ Limit orders
- ✅ Stop-loss orders
- ✅ Redis-based in-memory orderbook
- ✅ Price-time priority matching
- ✅ Atomic balance locking
- ✅ Real-time WebSocket updates

### P2P Trading
- ✅ Create buy/sell ads
- ✅ Fixed/Floating pricing
- ✅ Payment method management
- ✅ Escrow system
- ✅ Dispute resolution
- ✅ Geo-based filtering

### Security
- ✅ JWT + Refresh tokens
- ✅ Role-based access control
- ✅ Rate limiting (Redis)
- ✅ DDoS protection
- ✅ Input sanitization
- ✅ SQL injection protection
- ✅ XSS protection
- ✅ IP whitelisting (admin)
- ✅ Full audit logging

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- RabbitMQ 3+

### Installation

1. **Clone and install dependencies**
```bash
cd Exchange
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Run database migrations**
```bash
npm run db:migrate
```

4. **Start development servers**
```bash
# Start Redis (required for backend – sessions, cache, rate limiting, OTP)
# Without Redis, backend will log errors; login OTP and rate limiting may fail.
# Use either: docker compose (v2) or docker-compose (v1)
docker compose up -d redis rabbitmq
# OR: docker-compose up -d redis rabbitmq

# Or use dev:all to start Redis + RabbitMQ and then all apps:
npm run dev:all

# Or start individually:
npm run dev --workspace=@exchange/backend
npm run dev --workspace=@exchange/frontend

# Primary operator console (admin-panel + backend):
npm run dev:admin
# Then open http://localhost:3001/dashboard — this is the canonical admin UI (MM desk, control center, etc.).
```

### Operator console (primary admin)

- **`apps/admin-panel`** at **`http://localhost:3001`** (default dev port) — **`/dashboard`** is the **primary** operator / admin application. New operator features should land here first.
- **`apps/frontend`** at **`/admin`** is a **legacy / extended** admin shell. Prefer **admin-panel** for day-to-day operations unless you need a screen that only exists under `/admin`.
- **Safe migration playbook (phases, parity map, smoke checklist):** [`docs/ADMIN_PANEL_MIGRATION.md`](docs/ADMIN_PANEL_MIGRATION.md).

### Using Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Project Structure

```
Exchange/
├── apps/
│   ├── backend/                 # Express.js API
│   │   ├── src/
│   │   │   ├── config/         # Configuration
│   │   │   ├── lib/            # Core libraries
│   │   │   ├── middleware/     # Express middleware
│   │   │   ├── routes/         # API routes
│   │   │   ├── services/       # Business logic
│   │   │   ├── types/          # TypeScript types
│   │   │   ├── websocket/      # WebSocket server
│   │   │   └── database/       # Migrations
│   │   └── Dockerfile
│   │
│   └── frontend/               # Next.js App
│       ├── src/
│       │   ├── app/            # App Router pages
│       │   ├── components/     # React components
│       │   ├── lib/            # Utilities
│       │   └── store/          # Zustand stores
│       └── Dockerfile
│
├── docker-compose.yml
├── package.json                # Monorepo root
├── turbo.json                  # Turborepo config
└── .env.example
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - Register new user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/otp/send` - Send OTP
- `POST /api/v1/auth/otp/verify` - Verify OTP

### Trading
- `GET /api/v1/trading/pairs` - Get trading pairs
- `GET /api/v1/trading/orderbook/:pairId` - Get orderbook
- `GET /api/v1/trading/trades/:pairId` - Get recent trades
- `POST /api/v1/trading/orders` - Place order
- `DELETE /api/v1/trading/orders/:orderId` - Cancel order
- `GET /api/v1/trading/orders` - Get user orders
- `GET /api/v1/trading/balances` - Get balances

### WebSocket Channels
- `orderbook:{pairId}` - Orderbook updates
- `trades:{pairId}` - Trade updates
- `ticker:{pairId}` - Ticker updates
- `user:{userId}:orders` - Order updates (authenticated)
- `user:{userId}:balances` - Balance updates (authenticated)

## Security Considerations

### Production Checklist
- [ ] Use proper SSL certificates
- [ ] Configure HSM for key management
- [ ] Enable WAF rules
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategies
- [ ] Enable rate limiting at edge
- [ ] Implement IP geoblocking
- [ ] Regular security audits

### Environment Variables
Never commit sensitive environment variables. Use secrets management:
- AWS Secrets Manager
- HashiCorp Vault
- Azure Key Vault

## Scaling

### Horizontal Scaling
- Backend: Stateless, can scale horizontally
- WebSocket: Use Redis pub/sub for cross-instance communication
- Matching Engine: Single instance per trading pair (can shard)

### Database Scaling
- Read replicas for query distribution
- Connection pooling with PgBouncer
- Table partitioning for large tables

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is proprietary software. All rights reserved.

## Support

For enterprise support, contact: support@cryptoexchange.com
