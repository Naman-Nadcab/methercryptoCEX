'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import type { MmControlStatus, MMGlobalRuntimeConfig } from '@/lib/mm-control-api';
import { buildPairIntelligence } from '@/lib/mm-desk-helpers';

type Props = {
  status: MmControlStatus | null;
  global: MMGlobalRuntimeConfig | null;
  symbol: string | null;
};

export function MmIntelligencePanel({ status, global, symbol }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Desk intelligence</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {!symbol || !status || !global ? (
          <p className="text-admin-muted">Select a symbol for contextual reasons.</p>
        ) : (
          <ul className="space-y-2">
            {buildPairIntelligence(symbol, status, global).map((line, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-ds-md border border-admin-border/50 bg-admin-bg/30 px-3 py-2 text-admin-text leading-snug"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-admin-accent" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
