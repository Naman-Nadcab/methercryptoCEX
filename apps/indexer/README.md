# EVM Blockchain Indexer

A multi-chain EVM blockchain indexer for tracking cryptocurrency deposits on Ethereum, BSC, Polygon, Base, and Arbitrum.

## Features

- **Multi-chain Support**: Indexes 5 EVM chains simultaneously
  - Ethereum (Chain ID: 1)
  - BNB Smart Chain (Chain ID: 56)
  - Polygon (Chain ID: 137)
  - Base (Chain ID: 8453)
  - Arbitrum One (Chain ID: 42161)

- **Real-time Tracking**: WebSocket connections for instant block notifications
- **Native Token Detection**: Tracks ETH, BNB, MATIC transfers
- **ERC20 Token Detection**: Monitors Transfer events for all tokens
- **Confirmation Tracking**: Waits for required confirmations before crediting
- **HD Wallet Generation**: Generates unique deposit addresses per user per chain
- **Automatic Balance Updates**: Credits user balances after confirmation

## Installation

```bash
cd apps/indexer
npm install
```

## Configuration

Environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `MASTER_MNEMONIC` - HD wallet master mnemonic (for address generation)
- `ENCRYPTION_KEY` - 32-character key for private key encryption
- `INDEXER_API_PORT` - API server port (default: 4001)
- `LOG_LEVEL` - Logging level (default: info)

## Running

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Get Indexer Stats
```
GET /stats
```

### Generate Deposit Address
```
POST /address/generate
Body: { "userId": "uuid", "chainId": "ethereum" }
```

### Get User Addresses
```
GET /address/:userId
```

### Add Address to Watch List
```
POST /watch
Body: { "chainId": "ethereum", "address": "0x..." }
```

## Supported Chains & Tokens

### Ethereum
- Native: ETH
- Tokens: USDT, USDC, DAI, WETH

### BNB Smart Chain
- Native: BNB
- Tokens: USDT, USDC, BUSD, WBNB

### Polygon
- Native: MATIC
- Tokens: USDT, USDC, DAI, WMATIC

### Base
- Native: ETH
- Tokens: USDC, DAI, WETH

### Arbitrum
- Native: ETH
- Tokens: USDT, USDC, DAI, WETH

## Database Tables

- `indexer_state` - Tracks last processed block per chain
- `deposits` - Records all detected deposits
- `user_wallets` - Stores user deposit addresses (encrypted)
- `tokens` - Token contract addresses

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Indexer Manager                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │   ETH   │ │   BSC   │ │ Polygon │ │  Base   │ ...   │
│  │ Indexer │ │ Indexer │ │ Indexer │ │ Indexer │       │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │
│       │           │           │           │             │
│       └───────────┴───────────┴───────────┘             │
│                       │                                  │
│              ┌────────▼────────┐                        │
│              │  Confirmation   │                        │
│              │    Tracker      │                        │
│              └────────┬────────┘                        │
│                       │                                  │
│              ┌────────▼────────┐                        │
│              │   PostgreSQL    │                        │
│              │    Database     │                        │
│              └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

## Deposit Flow

1. User requests deposit address via API
2. HD wallet generates unique address for user + chain
3. Address added to watched list
4. Indexer detects incoming transaction
5. Deposit recorded with `confirming` status
6. Confirmation tracker monitors block confirmations
7. After required confirmations, balance is credited
8. Status updated to `completed`
