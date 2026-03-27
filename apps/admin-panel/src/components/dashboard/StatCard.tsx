'use client';

import Link from 'next/link';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  iconBg?: string;
  href?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  iconBg = 'bg-admin-primary/10 text-admin-primary',
  href,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-0">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-admin-muted">{title}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
            {change != null && (
              <div className="mt-1 flex items-center gap-1 text-sm">
                {change >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-admin-success" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-admin-danger" />
                )}
                <span className={change >= 0 ? 'text-admin-success' : 'text-admin-danger'}>
                  {change >= 0 ? '+' : ''}{change}%
                </span>
                {changeLabel && <span className="text-admin-muted">{changeLabel}</span>}
              </div>
            )}
            {href && (
              <Link
                href={href}
                className="mt-2 inline-block text-sm font-medium text-admin-primary hover:underline"
              >
                View details
              </Link>
            )}
          </div>
          <div className={cn('rounded-full p-3', iconBg)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
