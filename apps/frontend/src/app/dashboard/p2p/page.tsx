'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { P2PFilters } from '@/components/p2p/P2PFilters';
import { P2PMerchantTable, type P2PMerchantRow } from '@/components/p2p/P2PMerchantTable';
import { P2PTradeWindow } from '@/components/p2p/P2PTradeWindow';

// Mock merchants for UI demo; replace with fetchP2PAds when integrating
function getMockMerchants(crypto: string, fiat: string, paymentFilter: string): P2PMerchantRow[] {
  const list: P2PMerchantRow[] = [
    { id: '1', merchantName: 'TraderKing', price: `85.20 ${fiat}`, available: `10,000 ${crypto}`, limitMin: `500 ${fiat}`, limitMax: `50,000 ${fiat}`, paymentMethods: ['Bank Transfer', 'UPI'], completionRate: 99.2, totalTrades: 1200, averageReleaseTimeMin: 3, isVerified: true },
    { id: '2', merchantName: 'Merchant_B', price: `85.50 ${fiat}`, available: `5,000 ${crypto}`, limitMin: `1,000 ${fiat}`, limitMax: `100,000 ${fiat}`, paymentMethods: ['UPI', 'Wise'], completionRate: 99, totalTrades: 850, averageReleaseTimeMin: 5, isVerified: true },
    { id: '3', merchantName: 'Merchant_C', price: `85.00 ${fiat}`, available: `20,000 ${crypto}`, limitMin: `200 ${fiat}`, limitMax: `20,000 ${fiat}`, paymentMethods: ['Bank Transfer', 'PayPal'], completionRate: 97, totalTrades: 420, averageReleaseTimeMin: 8, isVerified: false },
  ];
  if (paymentFilter && paymentFilter !== 'All') {
    return list.filter((m) => m.paymentMethods.some((p) => p.toLowerCase().includes(paymentFilter.toLowerCase())));
  }
  return list;
}

export default function DashboardP2PPage() {
  const router = useRouter();
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [crypto, setCrypto] = useState('USDT');
  const [fiat, setFiat] = useState('INR');
  const [paymentMethod, setPaymentMethod] = useState('All');
  const [amount, setAmount] = useState('');
  const [tradeWindowOpen, setTradeWindowOpen] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<P2PMerchantRow | null>(null);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');

  const merchants = useMemo(
    () => getMockMerchants(crypto, fiat, paymentMethod),
    [crypto, fiat, paymentMethod]
  );

  const handleBuy = (row: P2PMerchantRow) => {
    setSelectedMerchant(row);
    setTradeType('buy');
    setTradeWindowOpen(true);
  };

  const handleSell = (row: P2PMerchantRow) => {
    setSelectedMerchant(row);
    setTradeType('sell');
    setTradeWindowOpen(true);
  };

  const handleConfirmPayment = () => {
    setTradeWindowOpen(false);
    setSelectedMerchant(null);
    router.push(`/dashboard/p2p/${tradeType}/${crypto}/${fiat}`);
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#0b0e11] dark:text-gray-100">
      <ExchangeHeader showPairSearch={false} />
      <P2PFilters
        type={type}
        crypto={crypto}
        fiat={fiat}
        paymentMethod={paymentMethod}
        amount={amount}
        onTypeChange={setType}
        onCryptoChange={setCrypto}
        onFiatChange={setFiat}
        onPaymentMethodChange={setPaymentMethod}
        onAmountChange={setAmount}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        <P2PMerchantTable
          type={type}
          rows={merchants}
          onBuy={handleBuy}
          onSell={handleSell}
        />
      </div>
      <div className="flex-shrink-0 border-t border-gray-200/90 bg-white p-3 dark:border-gray-800/90 dark:bg-[#181a20]">
        <Link
          href="/dashboard/p2p/payment-methods"
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Manage payment methods
        </Link>
        <span className="mx-2 text-gray-400">·</span>
        <Link
          href="/dashboard/orders/p2p"
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          My P2P orders
        </Link>
      </div>

      <P2PTradeWindow
        open={tradeWindowOpen}
        type={tradeType}
        merchant={selectedMerchant}
        fiat={fiat}
        crypto={crypto}
        onClose={() => { setTradeWindowOpen(false); setSelectedMerchant(null); }}
        onConfirmPayment={handleConfirmPayment}
      />
    </div>
  );
}
