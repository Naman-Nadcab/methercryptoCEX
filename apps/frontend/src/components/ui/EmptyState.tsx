'use client';

import Link from 'next/link';
import { type LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  /** Icon to show (default: Inbox) */
  icon?: LucideIcon;
  /** Short title, e.g. "No orders yet" */
  title: string;
  /** Optional longer description */
  description?: string;
  /** Optional CTA: { label, href } */
  action?: { label: string; href: string };
  /** Optional CTA as button (e.g. "Place first order") */
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionLabel,
  actionHref,
  className = '',
}: EmptyStateProps) {
  const href = action?.href ?? actionHref;
  const label = action?.label ?? actionLabel;

  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}
      role="status"
      aria-label={title}
    >
      <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
        <Icon className="w-7 h-7" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-4">
          {description}
        </p>
      )}
      {href && label && (
        <Link
          href={href}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
        >
          {label}
        </Link>
      )}
    </div>
  );
}
