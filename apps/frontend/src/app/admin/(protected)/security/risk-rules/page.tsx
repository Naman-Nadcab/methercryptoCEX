'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, PowerOff, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/admin/security/DataTable';
import { ConfirmDialog } from '@/components/admin/security/ConfirmDialog';
import { RiskRuleDialog } from './risk-rule-dialog';
import { toast } from '@/components/ui/toaster';
import {
  securityApi,
  type RiskRuleRecord,
  type RiskScope,
  type CreateRiskRuleInput,
  type UpdateRiskRuleInput,
} from '@/lib/securityApi';
import { cn } from '@/lib/utils';

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All scopes' },
  { value: 'login', label: 'Login' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'p2p', label: 'P2P' },
  { value: 'api', label: 'API' },
  { value: 'admin', label: 'Admin' },
];

const ENABLED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const LIMIT = 100;

function DecisionBadge({ decision }: { decision: string }) {
  const styles = {
    allow: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    challenge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    block: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[decision as keyof typeof styles] ?? 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300'
      )}
    >
      {decision}
    </span>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
        enabled
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
      )}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

export default function RiskRulesPage() {
  const queryClient = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [enabledFilter, setEnabledFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RiskRuleRecord | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { type: 'enable' | 'disable' | 'delete'; rule: RiskRuleRecord }
    | null
  >(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const scopeParam = scopeFilter === 'all' ? undefined : (scopeFilter as RiskScope);
  const enabledQuery =
    enabledFilter === 'all' ? undefined : enabledFilter === 'enabled';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'security', 'risk-rules', scopeParam, enabledQuery],
    queryFn: () =>
      securityApi.riskRules({
        scope: scopeParam ?? null,
        enabled: enabledQuery ?? null,
        limit: LIMIT,
        offset: 0,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'risk-rules'] });

  const createMutation = useMutation({
    mutationFn: (input: CreateRiskRuleInput) => securityApi.createRiskRule(input),
    onSuccess: () => {
      toast({ title: 'Rule created', variant: 'success' });
      invalidate();
    },
    onError: (e) => {
      toast({
        title: 'Failed to create rule',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRiskRuleInput }) =>
      securityApi.updateRiskRule(id, input),
    onSuccess: () => {
      toast({ title: 'Rule updated', variant: 'success' });
      invalidate();
      setEditingRule(null);
    },
    onError: (e) => {
      toast({
        title: 'Failed to update rule',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      securityApi.toggleRiskRule(id, enabled),
    onSuccess: (_, { enabled }) => {
      toast({
        title: enabled ? 'Rule enabled' : 'Rule disabled',
        variant: 'success',
      });
      invalidate();
      setConfirmState(null);
    },
    onError: (e) => {
      toast({
        title: 'Failed to update rule',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => securityApi.deleteRiskRule(id),
    onSuccess: () => {
      toast({ title: 'Rule deleted', variant: 'success' });
      invalidate();
      setConfirmState(null);
    },
    onError: (e) => {
      toast({
        title: 'Failed to delete rule',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const handleCreate = async (values: CreateRiskRuleInput) => {
    setSubmitLoading(true);
    try {
      await createMutation.mutateAsync(values);
      setDialogOpen(false);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleEdit = async (values: UpdateRiskRuleInput) => {
    if (!editingRule) return;
    setSubmitLoading(true);
    try {
      await updateMutation.mutateAsync({ id: editingRule.id, input: values });
      setDialogOpen(false);
    } finally {
      setSubmitLoading(false);
    }
  };

  const rules = data?.rules ?? [];
  const total = data?.total ?? 0;

  const columns = useMemo(
    () => [
      {
        id: 'scope',
        header: 'Scope',
        cell: (row: RiskRuleRecord) => (
          <span className="inline-flex rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium capitalize text-slate-700 dark:text-slate-300">
            {row.scope}
          </span>
        ),
      },
      {
        id: 'score',
        header: 'Score range',
        cell: (row: RiskRuleRecord) => (
          <span className="tabular-nums">
            {row.min_score} – {row.max_score}
          </span>
        ),
      },
      {
        id: 'decision',
        header: 'Decision',
        cell: (row: RiskRuleRecord) => <DecisionBadge decision={row.decision} />,
      },
      {
        id: 'priority',
        header: 'Priority',
        cell: (row: RiskRuleRecord) => (
          <span className="tabular-nums">{row.priority}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row: RiskRuleRecord) => <StatusBadge enabled={row.enabled} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        className: 'text-right',
        cell: (row: RiskRuleRecord) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setEditingRule(row);
                setDialogOpen(true);
              }}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {row.enabled ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setConfirmState({ type: 'disable', rule: row })}
                title="Disable"
              >
                <PowerOff className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setConfirmState({ type: 'enable', rule: row })}
                title="Enable"
              >
                <Power className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
              onClick={() => setConfirmState({ type: 'delete', rule: row })}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const confirmLoading =
    toggleMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            Risk Rules
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure how the risk engine reacts to security signals
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingRule(null);
            setDialogOpen(true);
          }}
          className="shrink-0"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add rule
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Scope
          </label>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Status
          </label>
          <Select value={enabledFilter} onValueChange={setEnabledFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENABLED_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error instanceof Error ? error.message : 'Failed to load rules'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          <span className="text-sm text-slate-500">Loading rules…</span>
        </div>
      ) : (
        <DataTable<RiskRuleRecord>
          columns={columns}
          data={rules}
          keyExtractor={(row) => row.id}
          emptyMessage="No risk rules match the filters"
        />
      )}

      {!isLoading && rules.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {rules.length} of {total} rule{total !== 1 ? 's' : ''}
        </p>
      )}

      <RiskRuleDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRule(null);
        }}
        rule={editingRule}
        onSubmitCreate={handleCreate}
        onSubmitEdit={handleEdit}
        loading={submitLoading}
      />

      {confirmState && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => !open && setConfirmState(null)}
          title={
            confirmState.type === 'delete'
              ? 'Delete risk rule'
              : confirmState.type === 'enable'
                ? 'Enable rule'
                : 'Disable rule'
          }
          description={
            confirmState.type === 'delete'
              ? `Are you sure you want to delete this rule (scope: ${confirmState.rule.scope}, score ${confirmState.rule.min_score}–${confirmState.rule.max_score})? This cannot be undone.`
              : confirmState.type === 'enable'
                ? `Enable this rule (scope: ${confirmState.rule.scope})?`
                : `Disable this rule (scope: ${confirmState.rule.scope})?`
          }
          confirmLabel={
            confirmState.type === 'delete'
              ? 'Delete'
              : confirmState.type === 'enable'
                ? 'Enable'
                : 'Disable'
          }
          variant={confirmState.type === 'delete' ? 'danger' : 'default'}
          loading={confirmLoading}
          onConfirm={async () => {
            if (confirmState.type === 'delete') {
              await deleteMutation.mutateAsync(confirmState.rule.id);
            } else {
              await toggleMutation.mutateAsync({
                id: confirmState.rule.id,
                enabled: confirmState.type === 'enable',
              });
            }
          }}
        />
      )}
    </div>
  );
}
