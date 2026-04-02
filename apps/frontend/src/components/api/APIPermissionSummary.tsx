'use client';

import { Key, Shield, Lock, Wallet } from 'lucide-react';

export interface APIPermissionSummaryProps {
  keyName: string;
  permission: 'read_write' | 'read_only';
  ipRestriction: 'ip_only' | 'no_restriction';
  ipAddressCount: number;
  withdrawalAccess: 'enabled' | 'disabled' | 'read_only';
  enabledPermissions: string[];
}

const permissionLabels: Record<string, string> = {
  unifiedTrading: 'Unified Trading',
  spotTrade: 'Spot Trading',
  earn: 'Earn',
  earnFlexibleSavings: 'Flexible Savings',
  fiatTrading: 'Fiat Trading',
  p2pOrders: 'P2P Orders',
  p2pAds: 'P2P Ads',
  assets: 'Asset Management',
  walletAccountTransfer: 'Account Transfer',
  walletSubaccountTransfer: 'Subaccount Transfer',
  walletWithdrawal: 'Withdrawal',
  exchangeConvertHistory: 'Convert History',
  contractOrders: 'Contract Orders',
  contractPositions: 'Contract Positions',
  usdcDerivativesTrading: 'USDC Derivatives',
  bybitPayOrders: 'Pay Orders',
  cryptoFiatOrders: 'Crypto-Fiat',
};

export function APIPermissionSummary({
  keyName,
  permission,
  ipRestriction,
  ipAddressCount,
  withdrawalAccess,
  enabledPermissions,
}: APIPermissionSummaryProps) {
  return (
    <div className="bg-card rounded-xl p-5 border border-border">
      <h3 className="text-sm font-semibold text-foreground mb-4">Permission Summary</h3>
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key name</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">
            {keyName || '—'}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Permissions</span>
          </div>
          <p className="text-sm text-foreground">
            {permission === 'read_only' ? 'Read-Only' : 'Read-Write'}
          </p>
          {enabledPermissions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {enabledPermissions.slice(0, 6).map((k) => (
                <span
                  key={k}
                  className="px-2 py-0.5 bg-accent text-foreground/80 text-xs rounded"
                >
                  {permissionLabels[k] ?? k}
                </span>
              ))}
              {enabledPermissions.length > 6 && (
                <span className="px-2 py-0.5 text-muted-foreground text-xs">
                  +{enabledPermissions.length - 6} more
                </span>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">IP restrictions</span>
          </div>
          <p className="text-sm text-foreground">
            {ipRestriction === 'ip_only'
              ? ipAddressCount > 0
                ? `${ipAddressCount} IP${ipAddressCount !== 1 ? 's' : ''} whitelisted`
                : 'IP Whitelist (no IPs added yet)'
              : 'No restriction'}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Withdrawal access</span>
          </div>
          <p className={`text-sm font-medium ${
            withdrawalAccess === 'enabled' ? 'text-buy' :
            withdrawalAccess === 'read_only' ? 'text-amber-600 dark:text-amber-400' :
            'text-muted-foreground'
          }`}>
            {withdrawalAccess === 'enabled' ? 'Enabled' : withdrawalAccess === 'read_only' ? 'Not available (read-only key)' : 'Disabled'}
          </p>
        </div>
      </div>
    </div>
  );
}
