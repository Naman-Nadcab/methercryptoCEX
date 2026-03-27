'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function ChartCard({ title, subtitle, children, className }: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <p className="mt-1 text-sm text-admin-muted">{subtitle}</p>}
      </CardHeader>
      <CardContent className="h-[280px]">{children}</CardContent>
    </Card>
  );
}
