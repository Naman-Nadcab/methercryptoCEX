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
import type {
  IpRuleRecord,
  IpRuleScope,
  IpRuleType,
  CreateIpRuleInput,
} from '@/lib/securityApi';
import type { UseFormReturn } from 'react-hook-form';

const SCOPE_OPTIONS: { value: IpRuleScope; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

const RULE_TYPE_OPTIONS: { value: IpRuleType; label: string }[] = [
  { value: 'whitelist', label: 'Whitelist' },
  { value: 'blacklist', label: 'Blacklist' },
];

/** IPv4: single address or CIDR (e.g. 192.168.1.0/24). IPv6: contains :, optional /prefix */
function isValidCidr(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (s.includes(':')) {
    const [addr, prefix] = s.split('/');
    if (prefix !== undefined) {
      const n = parseInt(prefix, 10);
      if (Number.isNaN(n) || n < 0 || n > 128) return false;
    }
    return /^[\da-fA-F:]+$/.test(addr?.trim() ?? '');
  }
  const ipv4Cidr = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;
  if (!ipv4Cidr.test(s)) return false;
  const [addr, prefix] = s.split('/');
  const octets = (addr ?? '').split('.').map(Number);
  if (octets.some((o) => o > 255)) return false;
  if (prefix !== undefined) {
    const n = parseInt(prefix, 10);
    if (Number.isNaN(n) || n < 0 || n > 32) return false;
  }
  return true;
}

const createSchema = z
  .object({
    scope: z.enum(['admin', 'user']),
    rule_type: z.enum(['whitelist', 'blacklist']),
    ip_cidr: z.string().optional(),
    country_code: z.string().optional(),
    enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const ip = (data.ip_cidr ?? '').trim();
    const country = (data.country_code ?? '').trim();
    if (!ip && !country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of IP/CIDR or Country code is required',
        path: ['ip_cidr'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of IP/CIDR or Country code is required',
        path: ['country_code'],
      });
      return;
    }
    if (country && !/^[A-Z]{2}$/.test(country)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Country code must be 2 uppercase letters (ISO-2)',
        path: ['country_code'],
      });
    }
    if (ip && !isValidCidr(ip)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid IPv4 or IPv6 CIDR format',
        path: ['ip_cidr'],
      });
    }
  });

const editSchema = z
  .object({
    ip_cidr: z.string().optional(),
    country_code: z.string().optional(),
    enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const ip = (data.ip_cidr ?? '').trim();
    const country = (data.country_code ?? '').trim();
    if (!ip && !country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of IP/CIDR or Country code is required',
        path: ['ip_cidr'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of IP/CIDR or Country code is required',
        path: ['country_code'],
      });
      return;
    }
    if (country && !/^[A-Z]{2}$/.test(country)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Country code must be 2 uppercase letters (ISO-2)',
        path: ['country_code'],
      });
    }
    if (ip && !isValidCidr(ip)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid IPv4 or IPv6 CIDR format',
        path: ['ip_cidr'],
      });
    }
  });

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface IpRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: IpRuleRecord | null;
  onSubmitCreate: (values: CreateIpRuleInput) => Promise<void>;
  onSubmitEdit: (values: EditFormValues) => Promise<void>;
  loading?: boolean;
}

export function IpRuleDialog({
  open,
  onOpenChange,
  rule,
  onSubmitCreate,
  onSubmitEdit,
  loading = false,
}: IpRuleDialogProps) {
  const isEdit = Boolean(rule);

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      scope: 'admin',
      rule_type: 'whitelist',
      ip_cidr: '',
      country_code: '',
      enabled: true,
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      ip_cidr: '',
      country_code: '',
      enabled: true,
    },
  });

  const form = isEdit ? editForm : createForm;
  const baseForm = form as UseFormReturn<{ ip_cidr?: string; country_code?: string; enabled: boolean }>;

  useEffect(() => {
    if (open && rule) {
      editForm.reset({
        ip_cidr: rule.ip_cidr ?? '',
        country_code: rule.country_code ?? '',
        enabled: rule.enabled,
      });
    }
    if (open && !rule) {
      createForm.reset({
        scope: 'admin',
        rule_type: 'whitelist',
        ip_cidr: '',
        country_code: '',
        enabled: true,
      });
    }
  }, [open, rule, createForm, editForm]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isEdit) {
      await onSubmitEdit(values as EditFormValues);
    } else {
      const v = values as CreateFormValues;
      await onSubmitCreate({
        scope: v.scope,
        rule_type: v.rule_type,
        ip_cidr: v.ip_cidr?.trim() || null,
        country_code: v.country_code?.trim() || null,
        enabled: v.enabled,
      });
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit IP Rule' : 'Create IP Rule'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Scope
                </label>
                <Select
                  value={createForm.watch('scope')}
                  onValueChange={(v) => createForm.setValue('scope', v as IpRuleScope)}
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
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Rule type
                </label>
                <Select
                  value={createForm.watch('rule_type')}
                  onValueChange={(v) => createForm.setValue('rule_type', v as IpRuleType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
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
            </>
          )}
          {isEdit && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Scope</p>
              <p className="text-sm font-medium capitalize text-slate-900 dark:text-white">
                {rule?.scope}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                Rule type
              </p>
              <p className="text-sm font-medium capitalize text-slate-900 dark:text-white">
                {rule?.rule_type}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              IP / CIDR (optional)
            </label>
            <Input
              placeholder="e.g. 192.168.1.0/24 or leave empty"
              {...baseForm.register('ip_cidr')}
            />
            {baseForm.formState.errors.ip_cidr && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {baseForm.formState.errors.ip_cidr.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Country code (optional, ISO-2)
            </label>
            <Input
              placeholder="e.g. US"
              maxLength={2}
              className="uppercase"
              {...baseForm.register('country_code', {
                onChange: (e) =>
                  baseForm.setValue('country_code', (e.target.value ?? '').toUpperCase().slice(0, 2)),
              })}
            />
            {baseForm.formState.errors.country_code && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {baseForm.formState.errors.country_code.message}
              </p>
            )}
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
