'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export interface ActivityItem {
  id: string;
  type: string;
  message: string;
  time: string;
  icon?: React.ReactNode;
}

export interface ActivityFeedProps {
  title?: string;
  items: ActivityItem[];
  className?: string;
}

export function ActivityFeed({ title = 'Recent Activity', items, className }: ActivityFeedProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3">
              {item.icon && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-admin-muted">
                  {item.icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-admin-text">{item.message}</p>
                <p className="mt-0.5 text-xs text-admin-muted">{item.time}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
