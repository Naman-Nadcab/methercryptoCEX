'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import Link from 'next/link';

export interface TableCardProps {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}

export function TableCard({ title, href, linkLabel = 'View all', children, className }: TableCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {href && (
          <Link href={href} className="text-sm font-medium text-admin-primary hover:underline">
            {linkLabel}
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-0 pt-0">{children}</CardContent>
    </Card>
  );
}
