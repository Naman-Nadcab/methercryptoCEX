'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMmControlGlobal,
  getMmControlPair,
  getMmControlStatus,
  postMmControlGlobal,
  postMmControlPair,
  isMmControlOk,
  type MMGlobalRuntimeConfig,
  type MMPairRuntimeConfig,
} from '@/lib/mm-control-api';
import { defaultPairResetBody } from '@/lib/mm-desk-helpers';
import { buildDeskAlerts, type DeskAlertFixId } from '@/lib/mm-desk-signals';
import { parseEliteSymbolMetrics } from '@/lib/mm-desk-elite-parse';
import { getMmEliteProfitability, postAdminCancelAllOrders } from '@/lib/mm-desk-extra-api';
import {
  MmDeskStatusBar,
  MmDeskAlertBanner,
  MmPairTable,
  type PairSparkHistory,
  MmPairSettingsPanel,
  MmLiveMetricsPanel,
  MmIntelligencePanel,
  MmExecutionDepthPanel,
  MmDeskOverrideStrip,
} from '@/components/mm-desk';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Badge,
  Skeleton,
  Modal,
  SafeActionModal,
} from '@/components/ui';

const REFETCH_MS = 12_000;
const SPARK_MAX_POINTS = 18;

export default function MmControlPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sparkHistory, setSparkHistory] = useState<PairSparkHistory>({});
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set());
  const [cancelMarket, setCancelMarket] = useState<string | null>(null);
  const [unwindMarket, setUnwindMarket] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ['admin', 'mm-control', 'status', token],
    queryFn: () => getMmControlStatus(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const globalQ = useQuery({
    queryKey: ['admin', 'mm-control', 'global', token],
    queryFn: () => getMmControlGlobal(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const symbols = useMemo(() => {
    if (!isMmControlOk(statusQ.data)) return [];
    const u = statusQ.data.data.live.map((r) => r.symbol);
    return Array.from(new Set(u)).sort();
  }, [statusQ.data]);

  useEffect(() => {
    if (!selectedSymbol && symbols.length) setSelectedSymbol(symbols[0]!);
  }, [symbols, selectedSymbol]);

  const pairQ = useQuery({
    queryKey: ['admin', 'mm-control', 'pair', token, selectedSymbol],
    queryFn: () => getMmControlPair(token, selectedSymbol!),
    enabled: !!token && !!selectedSymbol,
  });

  const eliteQ = useQuery({
    queryKey: ['admin', 'mm-elite-profitability', token],
    queryFn: () => getMmEliteProfitability(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const [globalDraft, setGlobalDraft] = useState<MMGlobalRuntimeConfig | null>(null);
  useEffect(() => {
    if (isMmControlOk(globalQ.data)) setGlobalDraft(globalQ.data.data);
  }, [globalQ.data]);

  const [pairDraft, setPairDraft] = useState<MMPairRuntimeConfig | null>(null);
  useEffect(() => {
    if (isMmControlOk(pairQ.data)) setPairDraft(pairQ.data.data.config);
  }, [pairQ.data]);

  const saveGlobalM = useMutation({
    mutationFn: (body: Partial<MMGlobalRuntimeConfig>) => postMmControlGlobal(token, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
    },
  });

  const savePairM = useMutation({
    mutationFn: ({ sym, body }: { sym: string; body: Partial<MMPairRuntimeConfig> }) =>
      postMmControlPair(token, sym, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
    },
  });

  const pairQuickM = useMutation({
    mutationFn: ({ sym, body }: { sym: string; body: Partial<MMPairRuntimeConfig> }) =>
      postMmControlPair(token, sym, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
    },
  });

  const requoteM = useMutation({
    mutationFn: (sym: string) => postMmControlPair(token, sym, { refresh_mode: 'fast' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
    },
  });

  const cancelAllM = useMutation({
    mutationFn: (sym: string) => postAdminCancelAllOrders(token, sym),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-desk-orderbook'] });
      setCancelMarket(null);
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'mm-control'] });
  }, [queryClient]);

  const statusData = isMmControlOk(statusQ.data) ? statusQ.data.data : null;
  const globalBusy =
    saveGlobalM.isPending ||
    pairQuickM.isPending ||
    savePairM.isPending ||
    cancelAllM.isPending ||
    requoteM.isPending;
  const pendingPairSym = pairQuickM.isPending ? pairQuickM.variables?.sym ?? null : null;
  const forceRequoteSymbol = requoteM.isPending ? requoteM.variables ?? null : null;

  const eliteBySymbol = useMemo(() => {
    const sym = eliteQ.data?.data?.symbols;
    if (!sym || typeof sym !== 'object') return {};
    const out: Record<string, ReturnType<typeof parseEliteSymbolMetrics>> = {};
    for (const k of Object.keys(sym as Record<string, unknown>)) {
      out[k] = parseEliteSymbolMetrics((sym as Record<string, unknown>)[k]);
    }
    return out;
  }, [eliteQ.data]);

  const pairForStrip = isMmControlOk(pairQ.data) ? pairQ.data.data.config : undefined;

  const onAlertFix = useCallback(
    (_alertId: string, fixId: DeskAlertFixId) => {
      if (fixId === 'enable_mm_runtime') saveGlobalM.mutate({ enabled: true });
      if (fixId === 'safe_desk_mode') saveGlobalM.mutate({ mode: 'safe' });
    },
    [saveGlobalM]
  );

  useEffect(() => {
    if (!statusData) return;
    setSparkHistory((prev) => {
      const next = { ...prev };
      for (const row of statusData.live) {
        const p = row.pnl1hUsd ?? 0;
        const f = row.fill_rate ?? 0;
        const cur = next[row.symbol] ?? { pnl: [], fill: [] };
        next[row.symbol] = {
          pnl: [...cur.pnl, p].slice(-SPARK_MAX_POINTS),
          fill: [...cur.fill, f].slice(-SPARK_MAX_POINTS),
        };
      }
      return next;
    });
  }, [statusQ.dataUpdatedAt, statusData]);

  const deskAlerts = useMemo(
    () => buildDeskAlerts(statusData, globalDraft),
    [statusData, globalDraft]
  );

  const scrollToPairSettings = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('mm-pair-settings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleConfigure = useCallback(
    (sym: string) => {
      setSelectedSymbol(sym);
      scrollToPairSettings();
    },
    [scrollToPairSettings]
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="h-8 w-8 shrink-0 text-admin-accent" />
          <div>
            <h1 className="text-2xl font-semibold text-admin-text">MM desk</h1>
            <p className="text-sm text-admin-muted">
              Runtime market-making control — live snapshot, per-market actions, and grouped configuration.
            </p>
          </div>
        </div>
      </header>

      <MmDeskAlertBanner
        alerts={deskAlerts}
        dismissed={dismissedAlerts}
        onDismiss={(id) => setDismissedAlerts((prev) => new Set(prev).add(id))}
        onAlertFix={onAlertFix}
        fixBusy={saveGlobalM.isPending}
      />

      <MmDeskStatusBar
        status={statusData}
        globalDraft={globalDraft}
        onRefresh={refresh}
        onStopAll={() => saveGlobalM.mutate({ enabled: false })}
        onSafeMode={() => saveGlobalM.mutate({ mode: 'safe' })}
        onResetDesk={() => saveGlobalM.mutate({ enabled: true, mode: 'normal' })}
        onSetMode={(mode) => saveGlobalM.mutate({ mode })}
        globalBusy={globalBusy}
      />

      <MmDeskOverrideStrip
        global={globalDraft}
        pair={pairForStrip}
        symbol={selectedSymbol}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Global runtime</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!globalDraft ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-admin-border"
                    checked={globalDraft.enabled}
                    onChange={(e) => setGlobalDraft({ ...globalDraft, enabled: e.target.checked })}
                  />
                  <span className="text-sm text-admin-text">MM enabled (runtime)</span>
                  <Badge variant={globalDraft.enabled ? 'success' : 'warning'}>
                    {globalDraft.enabled ? 'ON' : 'OFF'}
                  </Badge>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-admin-muted">Desk mode</label>
                    <select
                      className="w-full rounded-ds-md border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text"
                      value={globalDraft.mode}
                      onChange={(e) =>
                        setGlobalDraft({
                          ...globalDraft,
                          mode: e.target.value as MMGlobalRuntimeConfig['mode'],
                        })
                      }
                    >
                      <option value="safe">Safe</option>
                      <option value="normal">Normal</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-admin-muted">Daily profit target (USD)</label>
                    <Input
                      type="number"
                      placeholder="Default 200"
                      value={globalDraft.daily_target_usd ?? ''}
                      onChange={(e) =>
                        setGlobalDraft({
                          ...globalDraft,
                          daily_target_usd: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-admin-muted">Max position USD</label>
                    <Input
                      type="number"
                      placeholder="Env default"
                      value={globalDraft.max_position_usd ?? ''}
                      onChange={(e) =>
                        setGlobalDraft({
                          ...globalDraft,
                          max_position_usd: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-admin-muted">Max daily loss USD</label>
                    <Input
                      type="number"
                      placeholder="Env default"
                      value={globalDraft.max_daily_loss_usd ?? ''}
                      onChange={(e) =>
                        setGlobalDraft({
                          ...globalDraft,
                          max_daily_loss_usd: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <Button onClick={() => saveGlobalM.mutate(globalDraft)} disabled={saveGlobalM.isPending}>
                  Save global
                </Button>
                {saveGlobalM.isError && (
                  <p className="text-sm text-admin-danger">Save failed — check permissions (control:commands).</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-admin-muted">
            {statusData ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span>Bot (env)</span>
                  <Badge variant={statusData.bot.enabled ? 'success' : 'default'}>
                    {statusData.bot.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-admin-text">Spread {statusData.bot.envSpreadBps} bps</p>
                <p className="font-mono text-xs text-admin-text">Size {String(statusData.bot.envOrderSize)}</p>
                <p className="font-mono text-xs text-admin-text">Ladder L{statusData.bot.envLadderLevels}</p>
                {statusData.daily_target_progress ? (
                  <p className="pt-2 text-xs">
                    Target ${statusData.daily_target_progress.target_usd.toFixed(0)} · progress{' '}
                    {(statusData.daily_target_progress.progress * 100).toFixed(0)}%
                  </p>
                ) : null}
              </>
            ) : (
              <Skeleton className="h-28 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Markets</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQ.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : statusData ? (
            <MmPairTable
              status={statusData}
              selectedSymbol={selectedSymbol}
              globalEnabled={globalDraft?.enabled ?? false}
              globalMaxPositionUsd={globalDraft?.max_position_usd}
              sparkHistory={sparkHistory}
              eliteBySymbol={eliteBySymbol}
              onSelect={setSelectedSymbol}
              onPairToggle={(sym, enabled) => pairQuickM.mutate({ sym, body: { enabled } })}
              onConfigure={handleConfigure}
              onResetPair={(sym) => {
                pairQuickM.mutate({ sym, body: defaultPairResetBody(statusData.bot) });
              }}
              onForceRequote={(sym) => requoteM.mutate(sym)}
              onRequestCancelAll={(sym) => setCancelMarket(sym)}
              onRequestUnwind={(sym) => setUnwindMarket(sym)}
              pendingSymbol={pendingPairSym}
              forceRequoteSymbol={forceRequoteSymbol}
            />
          ) : (
            <p className="text-sm text-admin-muted">Unable to load desk snapshot.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <MmPairSettingsPanel
          symbol={selectedSymbol}
          draft={pairDraft}
          onChange={setPairDraft}
          onSave={() => selectedSymbol && pairDraft && savePairM.mutate({ sym: selectedSymbol, body: pairDraft })}
          saving={savePairM.isPending}
          saveError={savePairM.isError}
        />
        <div className="space-y-4">
          <MmExecutionDepthPanel token={token} symbol={selectedSymbol} />
          <MmLiveMetricsPanel status={statusData} symbol={selectedSymbol} />
        </div>
        <MmIntelligencePanel status={statusData} global={globalDraft} symbol={selectedSymbol} />
      </div>

      <SafeActionModal
        open={!!cancelMarket}
        onClose={() => setCancelMarket(null)}
        title="Cancel all orders on market"
        description={
          cancelMarket
            ? `Cancels every open order on ${cancelMarket} for all users (not MM-only).`
            : ''
        }
        impactWarning="Emergency control. Expect gaps in liquidity and user-visible cancels. Reconcile risk before re-enabling quoting."
        confirmWord="CANCEL ALL"
        severity="destructive"
        confirmLabel="Cancel all orders"
        onConfirm={async () => {
          if (cancelMarket) await cancelAllM.mutateAsync(cancelMarket);
        }}
      />

      <Modal open={!!unwindMarket} onClose={() => setUnwindMarket(null)} title="Force unwind" size="md">
        <p className="text-sm text-admin-muted">
          There is no dedicated &quot;unwind&quot; API on this stack. Use the checklist below with spot / treasury
          tools outside this panel as needed.
        </p>
        {unwindMarket ? (
          <p className="mt-2 font-mono text-sm text-admin-text">
            Market: <span className="text-admin-accent">{unwindMarket}</span>
          </p>
        ) : null}
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-admin-text">
          <li>Pause the pair or switch flow to defensive; optionally set desk Safe mode.</li>
          <li>Cancel resting liquidity if required (per-market cancel-all — with confirmation).</li>
          <li>Flatten base exposure via manual spot trades or internal transfer — operator discretion.</li>
        </ul>
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setUnwindMarket(null)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}
