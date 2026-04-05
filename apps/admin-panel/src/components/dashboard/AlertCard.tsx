'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { AlertTriangle } from 'lucide-react';

export interface AlertCardProps {
  title: string;
  severity?: 'low' | 'medium' | 'high';
  message?: string;
  time?: string;
  className?: string;
}

export function AlertCard({ title, severity = 'medium', message, time, className }: AlertCardProps) {
  return (
    <Card className={cn('border-l-4 border-l-admin-warning', className)}>
      <CardContent className="flex items-start gap-3 py-4">
        <div className="rounded-full bg-admin-warning/10 p-2">
          <AlertTriangle className="h-4 w-4 text-admin-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-admin-text">{title}</p>
            <Badge
              variant={severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'default'}
            >
              {severity}
            </Badge>
          </div>
          {message && <p className="mt-1 text-sm text-admin-muted">{message}</p>}
          {time && <p className="mt-1 text-xs text-admin-muted">{time}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
