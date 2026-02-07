'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, PowerOff, Trash2, Loader2, AlertTriangle } from 'lucide-react';
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
import { IpRuleDialog } from './ip-rule-dialog';
import { toast } from '@/components/ui/toaster';
import { formatDateTime } from '@/lib/utils';
import {
  securityApi,
  type IpRuleRecord,
  type IpRuleScope,
  type IpRuleType,
  type CreateIpRuleInput,
  type UpdateIpRuleInput,
} from '@/lib/securityApi';
import { cn } from '@/lib/utils';

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All scopes' },
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

const RULE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'whitelist', label: 'Whitelist' },
  { value: 'blacklist', label: 'Blacklist' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const LIMIT = 100;

function ScopeBadge({ scope }: { scope: string }) {
  const styles = {
    admin: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[scope as keyof typeof styles] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
      )}
    >
      {scope}
    </span>
  );
}

function RuleTypeBadge({ ruleType }: { ruleType: string }) {
  const styles = {
    whitelist: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    blacklist: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[ruleType as keyof typeof styles] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
      )}
    >
      {ruleType}
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

export default function IpRulesPage() {
  const queryClient = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<IpRuleRecord | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { type: 'enable' | 'disable' | 'delete'; rule: IpRuleRecord }
    | null
  >(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const scopeParam = scopeFilter === 'all' ? undefined : (scopeFilter as IpRuleScope);
  const ruleTypeParam = ruleTypeFilter === 'all' ? undefined : (ruleTypeFilter as IpRuleType);
  const enabledQuery =
    statusFilter === 'all' ? undefined : statusFilter === 'enabled';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'security', 'ip-rules', scopeParam, ruleTypeParam, enabledQuery],
    queryFn: () =>
      securityApi.ipRules({
        scope: scopeParam ?? null,
        rule_type: ruleTypeParam ?? null,
        enabled: enabledQuery ?? null,
        limit: LIMIT,
        offset: 0,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-rules'] });

  const createMutation = useMutation({
    mutationFn: (input: CreateIpRuleInput) => securityApi.createIpRule(input),
    onSuccess: () => {
      toast({ title: 'IP rule created', variant: 'success' });
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
    mutationFn: ({ id, input }: { id: string; input: UpdateIpRuleInput }) =>
      securityApi.updateIpRule(id, input),
    onSuccess: () => {
      toast({ title: 'IP rule updated', variant: 'success' });
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
      securityApi.toggleIpRule(id, enabled),
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
    mutationFn: (id: string) => securityApi.deleteIpRule(id),
    onSuccess: () => {
      toast({ title: 'IP rule deleted', variant: 'success' });
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

  const handleCreate = async (values: CreateIpRuleInput) => {
    setSubmitLoading(true);
    try {
      await createMutation.mutateAsync(values);
      setDialogOpen(false);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleEdit = async (values: {
    ip_cidr?: string;
    country_code?: string;
    enabled: boolean;
  }) => {
    if (!editingRule) return;
    setSubmitLoading(true);
    try {
      await updateMutation.mutateAsync({
        id: editingRule.id,
        input: {
          ip_cidr: values.ip_cidr?.trim() ? values.ip_cidr.trim() : null,
          country_code: values.country_code?.trim() ? values.country_code.trim().toUpperCase() : null,
          enabled: values.enabled,
        },
      });
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
        cell: (row: IpRuleRecord) => <ScopeBadge scope={row.scope} />,
      },
      {
        id: 'rule_type',
        header: 'Rule type',
        cell: (row: IpRuleRecord) => <RuleTypeBadge ruleType={row.rule_type} />,
      },
      {
        id: 'ip_cidr',
        header: 'IP / CIDR',
        cell: (row: IpRuleRecord) => (
          <span className="font-mono text-sm">
            {row.ip_cidr ?? '—'}
          </span>
        ),
      },
      {
        id: 'country_code',
        header: 'Country',
        cell: (row: IpRuleRecord) => (
          <span>{row.country_code ?? '—'}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row: IpRuleRecord) => <StatusBadge enabled={row.enabled} />,
      },
      {
        id: 'created_at',
        header: 'Created at',
        cell: (row: IpRuleRecord) => (
          <span className="text-slate-600 dark:text-slate-400">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        className: 'text-right',
        cell: (row: IpRuleRecord) => (
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
            IP Rules
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Restrict access by IP address or country
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

      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-amber-800 dark:text-amber-200"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <p className="text-sm font-medium">
          Admin IP rules can lock you out. Use with caution.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Scope
          </label>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="w-[140px]">
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
            Rule type
          </label>
          <Select value={ruleTypeFilter} onValueChange={setRuleTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_TYPE_OPTIONS.map((opt) => (
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
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
        <DataTable<IpRuleRecord>
          columns={columns}
          data={rules}
          keyExtractor={(row) => row.id}
          emptyMessage="No IP rules match the filters"
        />
      )}

      {!isLoading && rules.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {rules.length} of {total} rule{total !== 1 ? 's' : ''}
        </p>
      )}

      <IpRuleDialog
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
              ? 'Delete IP rule'
              : confirmState.type === 'enable'
                ? 'Enable rule'
                : 'Disable rule'
          }
          description={
            confirmState.type === 'delete'
              ? `Are you sure you want to delete this rule (${confirmState.rule.scope}, ${confirmState.rule.rule_type}${confirmState.rule.ip_cidr ? ` ${confirmState.rule.ip_cidr}` : ''}${confirmState.rule.country_code ? ` ${confirmState.rule.country_code}` : ''})? This cannot be undone.`
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
