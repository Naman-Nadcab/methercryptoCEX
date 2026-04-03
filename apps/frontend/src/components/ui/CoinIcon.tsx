'use client';

import { useState } from 'react';
import Image from 'next/image';

const COIN_COLORS: Record<string, string> = {
  BTC: '#F7931A', ETH: '#627EEA', BNB: '#F3BA2F', SOL: '#9945FF',
  XRP: '#23292F', ADA: '#0033AD', AVAX: '#E84142', DOT: '#E6007A',
  ATOM: '#2E3148', NEAR: '#00C08B', SUI: '#4DA2FF', APT: '#06BF94',
  SEI: '#9B1C2E', TRX: '#FF0013', LTC: '#345D9D', MATIC: '#8247E5',
  ARB: '#28A0F0', OP: '#FF0420', IMX: '#00BFFF', UNI: '#FF007A',
  AAVE: '#B6509E', LINK: '#2A5ADA', MKR: '#1AAB9B', LDO: '#00A3FF',
  INJ: '#00F2FE', DOGE: '#C2A633', SHIB: '#FF9300', PEPE: '#479C45',
  WIF: '#E8A42A', FLOKI: '#D89C2A', BONK: '#F09242', FET: '#1D2951',
  RENDER: '#1D1D26', WLD: '#000000', FIL: '#0090FF', GRT: '#6747ED',
  AR: '#222326', ICP: '#3B00B9', HBAR: '#000000', VET: '#15BDFF',
  USDT: '#26A17B', USDC: '#2775CA', DAI: '#F5AC37',
};

function coinLogoPath(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s === 'render') return '/assets/upload/currency-logo/rndr.svg';
  return `/assets/upload/currency-logo/${s}.svg`;
}

function fallbackColor(symbol: string): string {
  return COIN_COLORS[symbol.toUpperCase()] ??
    `hsl(${(symbol.charCodeAt(0) * 37 + symbol.charCodeAt(symbol.length - 1) * 53) % 360}, 55%, 50%)`;
}

interface CoinIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function CoinIcon({ symbol, size = 24, className = '' }: CoinIconProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`rounded-full flex items-center justify-center font-bold shrink-0 select-none ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: fallbackColor(symbol),
          color: '#fff',
          fontSize: size * 0.4,
          lineHeight: 1,
        }}
      >
        {symbol.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <Image
      src={coinLogoPath(symbol)}
      alt={symbol}
      width={size}
      height={size}
      className={`rounded-full shrink-0 object-contain ${className}`}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
