'use client';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Search } from 'lucide-react';

export interface UserFiltersValues {
  search: string;
  status: string;
  kycStatus: string;
  country: string;
  signupDate: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'locked', label: 'Banned' },
];

const KYC_OPTIONS = [
  { value: 'all', label: 'All KYC' },
  { value: '0', label: 'Not started' },
  { value: '1', label: 'Level 1' },
  { value: '2', label: 'Level 2' },
  { value: '3', label: 'Level 3' },
];

export interface UserFiltersProps {
  values: UserFiltersValues;
  onChange: (values: UserFiltersValues) => void;
  onExportCsv?: () => void;
}

export function UserFilters({ values, onChange, onExportCsv }: UserFiltersProps) {
  const update = (key: keyof UserFiltersValues, value: string) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-muted" aria-hidden />
        <Input
          placeholder="Search by email, username, user ID..."
          value={values.search}
          onChange={(e) => update('search', e.target.value)}
          className="pl-9"
        />
      </div>
      <select
        value={values.status}
        onChange={(e) => update('status', e.target.value)}
        className="h-10 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-admin-primary"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={values.kycStatus}
        onChange={(e) => update('kycStatus', e.target.value)}
        className="h-10 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-admin-primary"
      >
        {KYC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={values.country}
        onChange={(e) => update('country', e.target.value)}
        className="h-10 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-admin-primary"
      >
        <option value="all">All countries</option>
      </select>
      <select
        value={values.signupDate}
        onChange={(e) => update('signupDate', e.target.value)}
        className="h-10 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-admin-primary"
      >
        <option value="all">Any date</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </select>
      {onExportCsv && (
        <Button variant="secondary" size="sm" onClick={onExportCsv}>
          Export CSV
        </Button>
      )}
    </div>
  );
}
