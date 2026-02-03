export interface ChainConfig {
  id: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  wssUrl: string;
  blockTime: number; // in seconds
  confirmations: number;
  nativeDecimals: number;
  explorerUrl: string;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ethereum: {
    id: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/eth/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    wssUrl: 'wss://rpc.ankr.com/eth/ws/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    blockTime: 12,
    confirmations: 25,
    nativeDecimals: 18,
    explorerUrl: 'https://etherscan.io',
  },
  bsc: {
    id: 56,
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    rpcUrl: 'https://rpc.ankr.com/bsc/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    wssUrl: 'wss://rpc.ankr.com/bsc/ws/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    blockTime: 3,
    confirmations: 25,
    nativeDecimals: 18,
    explorerUrl: 'https://bscscan.com',
  },
  polygon: {
    id: 137,
    name: 'Polygon',
    symbol: 'MATIC',
    rpcUrl: 'https://rpc.ankr.com/polygon/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    wssUrl: 'wss://rpc.ankr.com/polygon/ws/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    blockTime: 2,
    confirmations: 25,
    nativeDecimals: 18,
    explorerUrl: 'https://polygonscan.com',
  },
  base: {
    id: 8453,
    name: 'Base',
    symbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/base/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    wssUrl: 'wss://rpc.ankr.com/base/ws/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    blockTime: 2,
    confirmations: 25,
    nativeDecimals: 18,
    explorerUrl: 'https://basescan.org',
  },
  arbitrum: {
    id: 42161,
    name: 'Arbitrum One',
    symbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/arbitrum/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    wssUrl: 'wss://rpc.ankr.com/arbitrum/ws/d3f6ef0c0e41a88132c95e71c5dbbb0527827d73d26e52628851ae2c620303d4',
    blockTime: 0.25,
    confirmations: 25,
    nativeDecimals: 18,
    explorerUrl: 'https://arbiscan.io',
  },
};

// ERC20 Transfer event signature
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Common token addresses per chain
export const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  ethereum: {
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    DAI: '0x6B175474E89094C44Da98b954EescdeCB5BC4e8F',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  polygon: {
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  arbitrum: {
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
};
