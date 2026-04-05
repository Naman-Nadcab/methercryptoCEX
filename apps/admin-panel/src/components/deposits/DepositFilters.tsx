'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface DepositFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  asset: string;
  onAssetChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
}

export function DepositFilters({
  search,
  onSearchChange,
  asset,
  onAssetChange,
  status,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onApply,
  onClear,
}: DepositFiltersProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-admin-muted">Search</label>
            <Input
              placeholder="TX hash or user email"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-admin-muted">Asset</label>
            <select
              value={asset}
              onChange={(e) => onAssetChange(e.target.value)}
              className="w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            >
              <option value="">All</option>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-admin-muted">Status</label>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="confirming">Processing</option>
              <option value="completed">Confirmed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-admin-muted">From date</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-admin-muted">To date</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="w-full"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={onApply}>Apply</Button>
          <Button variant="secondary" onClick={onClear}>
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
