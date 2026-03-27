'use client';

import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { RiskDistribution } from '@/lib/risk-api';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer } from 'recharts';
import { Users, Shield, AlertTriangle } from 'lucide-react';

const COLORS = ['#10B981', '#F59E0B', '#EF4444'];

export interface RiskDistributionCardsProps {
  distribution: RiskDistribution | null | undefined;
}

export function RiskDistributionCards({ distribution }: RiskDistributionCardsProps) {
  const low = distribution?.low_risk_users ?? 0;
  const medium = distribution?.medium_risk_users ?? 0;
  const high = distribution?.high_risk_users ?? 0;
  const total = low + medium + high;
  const pieData = [
    { name: 'Low Risk', value: low, color: COLORS[0] },
    { name: 'Medium Risk', value: medium, color: COLORS[1] },
    { name: 'High Risk', value: high, color: COLORS[2] },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-3 lg:col-span-3">
        <StatCard
          title="Low Risk Users"
          value={low.toLocaleString()}
          icon={Users}
          iconBg="bg-green-100 text-green-700"
        />
        <StatCard
          title="Medium Risk Users"
          value={medium.toLocaleString()}
          icon={Shield}
          iconBg="bg-amber-100 text-amber-700"
        />
        <StatCard
          title="High Risk Users"
          value={high.toLocaleString()}
          icon={AlertTriangle}
          iconBg="bg-red-100 text-red-700"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Risk Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {pieData.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-admin-muted">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieData[i].color} />
                  ))}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
