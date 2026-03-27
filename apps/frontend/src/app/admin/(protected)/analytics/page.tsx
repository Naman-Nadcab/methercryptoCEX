'use client';

import Link from 'next/link';
import { Card, Row, Col } from 'antd';
import {
  BarChart3,
  Users,
  Wallet,
  TrendingUp,
  Shield,
  Droplets,
} from 'lucide-react';

const analyticsCards = [
  {
    title: 'Trading Analytics',
    description: 'Volume, order flow, revenue trends',
    href: '/admin/dashboard',
    icon: <BarChart3 className="w-8 h-8" />,
    color: 'admin-accent-blue',
  },
  {
    title: 'User Analytics',
    description: 'Growth, active users, sessions',
    href: '/admin/users',
    icon: <Users className="w-8 h-8" />,
    color: 'admin-accent-purple',
  },
  {
    title: 'Liquidity Analytics',
    description: 'Orderbook depth, market making',
    href: '/admin/market-making',
    icon: <Droplets className="w-8 h-8" />,
    color: 'admin-accent-green',
  },
  {
    title: 'Treasury Analytics',
    description: 'Hot/cold wallets, deposits, withdrawals',
    href: '/admin/treasury',
    icon: <Wallet className="w-8 h-8" />,
    color: 'admin-accent-orange',
  },
  {
    title: 'Compliance Analytics',
    description: 'AML alerts, STR/CTR, risk intelligence',
    href: '/admin/compliance/alerts',
    icon: <Shield className="w-8 h-8" />,
    color: 'text-red-400',
  },
  {
    title: 'Risk Intelligence',
    description: 'Wash trading, spoofing, price spikes',
    href: '/admin/risk-intelligence',
    icon: <TrendingUp className="w-8 h-8" />,
    color: 'admin-accent-orange',
  },
];

export default function AnalyticsHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold admin-metric-value">Advanced Analytics</h1>
        <p className="text-sm admin-metric-label mt-0.5">
          Trading, user, liquidity, treasury, and compliance analytics — full operational visibility
        </p>
      </div>

      <Row gutter={[16, 16]}>
        {analyticsCards.map((card) => (
          <Col key={card.href} xs={24} sm={12} lg={8}>
            <Link href={card.href}>
              <Card
                hoverable
                className="admin-card h-full"
              >
                <div className="flex items-start gap-4">
                  <div className={`${card.color} opacity-80`}>{card.icon}</div>
                  <div>
                    <h3 className="font-semibold admin-metric-value">{card.title}</h3>
                    <p className="text-sm admin-metric-label mt-0.5">{card.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
