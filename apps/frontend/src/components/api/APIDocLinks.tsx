'use client';

import Link from 'next/link';
import { FileCode2, Zap, BookOpen } from 'lucide-react';

const baseUrl = process.env.NEXT_PUBLIC_API_DOCS_URL || '';

const links = [
  { label: 'Python SDK', icon: FileCode2, path: '/sdk/python', slug: 'python' },
  { label: 'Node SDK', icon: FileCode2, path: '/sdk/node', slug: 'node' },
  { label: 'REST docs', icon: BookOpen, path: '', slug: 'rest' },
  { label: 'WebSocket docs', icon: Zap, path: '/websocket', slug: 'ws' },
];

export function APIDocLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((item) => {
        const Icon = item.icon;
        const href = baseUrl ? `${baseUrl.replace(/\/$/, '')}${item.path}` : '/dashboard/announcements';
        const isExternal = !!baseUrl;
        return (
          <Link
            key={item.slug}
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-foreground/80 text-sm font-medium transition-colors"
          >
            <Icon className="w-4 h-4 text-primary" />
            {item.label}
            {isExternal && (
              <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            )}
          </Link>
        );
      })}
    </div>
  );
}
