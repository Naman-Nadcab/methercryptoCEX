'use client';

import type { ReactNode } from 'react';
import { Button, Input, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import type { MMPairRuntimeConfig } from '@/lib/mm-control-api';

type Props = {
  symbol: string | null;
  draft: MMPairRuntimeConfig | null;
  onChange: (next: MMPairRuntimeConfig) => void;
  onSave: () => void;
  saving: boolean;
  saveError: boolean;
};

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-ds-md border border-admin-border/80 bg-admin-bg/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-admin-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function MmPairSettingsPanel({ symbol, draft, onChange, onSave, saving, saveError }: Props) {
  if (!symbol) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pair settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-admin-muted">Select a market from the desk table.</p>
        </CardContent>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pair settings</CardTitle>
        </CardHeader>
        <CardContent className="h-48 animate-pulse rounded-ds-md bg-admin-card/50" />
      </Card>
    );
  }

  return (
    <Card id="mm-pair-settings-anchor">
      <CardHeader>
        <CardTitle className="flex items-baseline gap-2">
          Pair settings
          <span className="font-mono text-sm font-normal text-admin-muted">{symbol}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-admin-border"
            checked={draft.enabled}
            onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          />
          <span className="text-sm text-admin-text">Pair enabled</span>
        </label>

        <FieldGroup title="Trading">
          <div>
            <label className="mb-1 block text-xs text-admin-muted">Spread mode</label>
            <select
              className="w-full rounded-ds-md border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text"
              value={draft.spread_mode}
              onChange={(e) =>
                onChange({
                  ...draft,
                  spread_mode: e.target.value as MMPairRuntimeConfig['spread_mode'],
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-admin-muted">Spread (bps)</label>
            <Input
              type="number"
              value={draft.spread_bps}
              onChange={(e) => onChange({ ...draft, spread_bps: Number(e.target.value) || 1 })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Order size</label>
              <Input
                type="number"
                value={draft.order_size}
                onChange={(e) => onChange({ ...draft, order_size: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Ladder levels</label>
              <Input
                type="number"
                value={draft.ladder_levels}
                onChange={(e) => onChange({ ...draft, ladder_levels: Number(e.target.value) || 1 })}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Strategy">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Flow mode</label>
              <select
                className="w-full rounded-ds-md border border-admin-border bg-admin-bg px-2 py-2 text-sm"
                value={draft.flow_mode}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    flow_mode: e.target.value as MMPairRuntimeConfig['flow_mode'],
                  })
                }
              >
                <option value="neutral">Neutral</option>
                <option value="aggressive">Aggressive</option>
                <option value="defensive">Defensive</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Volatility</label>
              <select
                className="w-full rounded-ds-md border border-admin-border bg-admin-bg px-2 py-2 text-sm"
                value={draft.volatility_mode}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    volatility_mode: e.target.value as MMPairRuntimeConfig['volatility_mode'],
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Refresh</label>
              <select
                className="w-full rounded-ds-md border border-admin-border bg-admin-bg px-2 py-2 text-sm"
                value={draft.refresh_mode}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    refresh_mode: e.target.value as MMPairRuntimeConfig['refresh_mode'],
                  })
                }
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Risk">
          <div>
            <label className="mb-1 block text-xs text-admin-muted">Pair capital (USD)</label>
            <Input
              type="number"
              placeholder="Optional — uses global max"
              value={draft.pair_capital_usd ?? ''}
              onChange={(e) =>
                onChange({
                  ...draft,
                  pair_capital_usd: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Max position USD</label>
              <Input
                type="number"
                placeholder="Optional"
                value={draft.max_position_usd ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    max_position_usd: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-admin-muted">Max daily loss USD</label>
              <Input
                type="number"
                placeholder="Optional"
                value={draft.max_daily_loss_usd ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    max_daily_loss_usd: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
        </FieldGroup>

        <Button onClick={onSave} disabled={saving}>
          Save pair
        </Button>
        {saveError && (
          <p className="text-sm text-admin-danger">Save failed — check permissions (control:commands).</p>
        )}
      </CardContent>
    </Card>
  );
}
