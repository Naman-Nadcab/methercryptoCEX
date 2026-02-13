'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { RiskRuleRecord, RiskScope, RiskDecision } from '@/lib/securityApi';
import type { UseFormReturn } from 'react-hook-form';

const SCOPE_OPTIONS: { value: RiskScope; label: string }[] = [
  { value: 'login', label: 'Login' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'p2p', label: 'P2P' },
  { value: 'api', label: 'API' },
  { value: 'admin', label: 'Admin' },
];

const DECISION_OPTIONS: { value: RiskDecision; label: string }[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'challenge', label: 'Challenge' },
  { value: 'block', label: 'Block' },
];

// Base schema (ZodObject only) — .omit() must be called on this, not on a refined schema
const baseSchema = z.object({
  scope: z.enum(['login', 'withdrawal', 'p2p', 'api', 'admin']),
  min_score: z.number().min(0).max(100),
  max_score: z.number().min(0).max(100),
  decision: z.enum(['allow', 'challenge', 'block']),
  priority: z.number().int().optional(),
  enabled: z.boolean(),
});

const scoreRefine = (data: { min_score: number; max_score: number }) =>
  data.min_score <= data.max_score;

const createSchema = baseSchema.refine(scoreRefine, {
  message: 'Min score must be less than or equal to max score',
  path: ['max_score'],
});

const editSchema = baseSchema
  .omit({ scope: true })
  .refine(scoreRefine, {
    message: 'Min score must be less than or equal to max score',
    path: ['max_score'],
  });

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface RiskRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: RiskRuleRecord | null;
  onSubmitCreate: (values: CreateFormValues) => Promise<void>;
  onSubmitEdit: (values: EditFormValues) => Promise<void>;
  loading?: boolean;
}

export function RiskRuleDialog({
  open,
  onOpenChange,
  rule,
  onSubmitCreate,
  onSubmitEdit,
  loading = false,
}: RiskRuleDialogProps) {
  const isEdit = Boolean(rule);

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      scope: 'login',
      min_score: 0,
      max_score: 100,
      decision: 'allow',
      priority: 0,
      enabled: true,
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      min_score: 0,
      max_score: 100,
      decision: 'allow',
      priority: 0,
      enabled: true,
    },
  });

  const form = isEdit ? editForm : createForm;
  const baseForm = form as UseFormReturn<{
    min_score: number;
    max_score: number;
    decision: RiskDecision;
    priority?: number;
    enabled: boolean;
  }>;

  useEffect(() => {
    if (open && rule) {
      editForm.reset({
        min_score: rule.min_score,
        max_score: rule.max_score,
        decision: rule.decision,
        priority: rule.priority,
        enabled: rule.enabled,
      });
    }
    if (open && !rule) {
      createForm.reset({
        scope: 'login',
        min_score: 0,
        max_score: 100,
        decision: 'allow',
        priority: 0,
        enabled: true,
      });
    }
  }, [open, rule, createForm, editForm]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isEdit) {
      await onSubmitEdit(values);
    } else {
      await onSubmitCreate(values as CreateFormValues);
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Risk Rule' : 'Create Risk Rule'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Scope
              </label>
              <Select
                value={createForm.watch('scope')}
                onValueChange={(v) => createForm.setValue('scope', v as RiskScope)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createForm.formState.errors.scope && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {createForm.formState.errors.scope.message}
                </p>
              )}
            </div>
          )}
          {isEdit && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-500 dark:text-slate-400">Scope</label>
              <p className="text-sm font-medium capitalize text-slate-900 dark:text-white">
                {rule?.scope}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Min score (0–100)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                {...baseForm.register('min_score', { valueAsNumber: true })}
              />
              {baseForm.formState.errors.min_score && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {baseForm.formState.errors.min_score.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Max score (0–100)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                {...baseForm.register('max_score', { valueAsNumber: true })}
              />
              {baseForm.formState.errors.max_score && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {baseForm.formState.errors.max_score.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Decision
            </label>
            <Select
              value={baseForm.watch('decision')}
              onValueChange={(v) => baseForm.setValue('decision', v as RiskDecision)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select decision" />
              </SelectTrigger>
              <SelectContent>
                {DECISION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {baseForm.formState.errors.decision && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {baseForm.formState.errors.decision.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Priority (optional)
            </label>
            <Input
              type="number"
              step={1}
              {...baseForm.register('priority', {
                setValueAs: (v) => {
                  if (v === '' || v === undefined) return undefined;
                  const n = Number(v);
                  return Number.isNaN(n) ? undefined : n;
                },
              })}
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Enabled
            </label>
            <Switch
              checked={baseForm.watch('enabled')}
              onCheckedChange={(checked) => baseForm.setValue('enabled', checked)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
