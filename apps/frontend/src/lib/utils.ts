import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Decimal from 'decimal.js';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format number with commas
export function formatNumber(
  value: string | number,
  decimals: number = 2
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

// Format currency
export function formatCurrency(
  value: string | number,
  currency: string = 'USD',
  decimals: number = 2
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

// Format crypto amount
export function formatCrypto(
  value: string | number,
  symbol: string,
  decimals: number = 8
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return `0 ${symbol}`;

  const formatted = new Decimal(num).toFixed(decimals);
  // Remove trailing zeros
  const trimmed = formatted.replace(/\.?0+$/, '');
  return `${trimmed} ${symbol}`;
}

// Format percentage
export function formatPercentage(value: string | number, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';
  
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

// Format price with appropriate decimals
export function formatPrice(price: string | number, quoteAsset: string = 'USDT'): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '0';

  // Determine decimals based on price magnitude
  let decimals = 2;
  if (num < 0.0001) decimals = 8;
  else if (num < 0.01) decimals = 6;
  else if (num < 1) decimals = 4;
  else if (num < 100) decimals = 2;
  
  return formatNumber(num, decimals);
}

// Shorten address
export function shortenAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// Format time ago
export function timeAgo(date: Date | string | number): string {
  const now = new Date();
  const past = new Date(date);
  const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return past.toLocaleDateString();
}

// Format date time
export function formatDateTime(date: Date | string | number): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

// Validate email
export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Validate phone
export function isValidPhone(phone: string): boolean {
  const re = /^\+?[1-9]\d{9,14}$/;
  return re.test(phone.replace(/\s/g, ''));
}

// Debounce function
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Sleep function
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate random string
export function generateId(length: number = 8): string {
  return Math.random().toString(36).substring(2, length + 2);
}

// Copy to clipboard
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Get chain name
export function getChainName(chainId: string): string {
  const chains: Record<string, string> = {
    ethereum: 'Ethereum',
    bsc: 'BNB Smart Chain',
    polygon: 'Polygon',
    arbitrum: 'Arbitrum',
    optimism: 'Optimism',
    base: 'Base',
    solana: 'Solana',
    tron: 'Tron',
    bitcoin: 'Bitcoin',
  };
  return chains[chainId] || chainId;
}

// Get chain explorer URL
export function getExplorerUrl(chainId: string, type: 'tx' | 'address', value: string): string {
  const explorers: Record<string, string> = {
    ethereum: 'https://etherscan.io',
    bsc: 'https://bscscan.com',
    polygon: 'https://polygonscan.com',
    arbitrum: 'https://arbiscan.io',
    optimism: 'https://optimistic.etherscan.io',
    base: 'https://basescan.org',
    solana: 'https://solscan.io',
    tron: 'https://tronscan.org',
    bitcoin: 'https://blockstream.info',
  };

  const base = explorers[chainId];
  if (!base) return '#';

  if (chainId === 'solana') {
    return `${base}/${type === 'tx' ? 'tx' : 'account'}/${value}`;
  }
  if (chainId === 'tron') {
    return `${base}/#/${type === 'tx' ? 'transaction' : 'address'}/${value}`;
  }
  if (chainId === 'bitcoin') {
    return `${base}/${type}/${value}`;
  }
  
  return `${base}/${type}/${value}`;
}
