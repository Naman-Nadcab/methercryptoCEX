'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { ChevronRight, Loader2, Info, Key, Shield, Check, AlertTriangle, Copy } from 'lucide-react';
import { APIPermissionSummary } from '@/components/api/APIPermissionSummary';

function CreateApiKeyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyType = searchParams.get('type') as 'system' | 'self' || 'system';
  
  const { accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ apiKey: string; apiSecret?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  // Form State
  const [apiKeyUsage, setApiKeyUsage] = useState<'transaction' | 'third_party'>('transaction');
  const [publicKey, setPublicKey] = useState('');
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'read_write' | 'read_only'>('read_only');
  const [ipRestriction, setIpRestriction] = useState<'ip_only' | 'no_restriction'>('no_restriction');
  const [ipAddresses, setIpAddresses] = useState('');
  const [expiration, setExpiration] = useState<'30' | '90' | 'never'>('90');
  
  // Permission checkboxes - grouped
  const [permissions, setPermissions] = useState({
    // Unified Trading
    unifiedTrading: false,
    contractOrders: false,
    contractPositions: false,
    usdcDerivativesTrading: false,
    spotTrade: false,
    // Earn
    earn: false,
    earnFlexibleSavings: false,
    // Fiat Trading
    fiatTrading: false,
    p2pOrders: false,
    p2pAds: false,
    bybitPayOrders: false,
    cryptoFiatOrders: false,
    // Assets
    assets: false,
    walletAccountTransfer: false,
    walletSubaccountTransfer: false,
    walletWithdrawal: false,
    exchangeConvertHistory: false,
  });

  const togglePermission = (key: keyof typeof permissions) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: 'Validation', description: 'Please enter a name for the API key', variant: 'destructive' });
      return;
    }

    if (keyType === 'self' && !publicKey.trim()) {
      toast({ title: 'Validation', description: 'Please enter your public key', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          keyType,
          apiKeyUsage,
          publicKey: keyType === 'self' ? publicKey : undefined,
          name,
          permission,
          ipRestriction,
          ipAddresses: ipAddresses.split(',').map(ip => ip.trim()).filter(Boolean),
          permissions,
          expiresInDays: ipRestriction === 'ip_only' ? null : (expiration === 'never' ? null : parseInt(expiration, 10)),
        })
      });

      const result = await response.json();

      if (result.success) {
        setCreatedKey({
          apiKey: result.data.apiKey,
          apiSecret: result.data.apiSecret
        });
        setShowSuccess(true);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to create API key', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to create API key:', error);
      toast({ title: 'Error', description: 'Failed to create API key', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Success Modal
  if (showSuccess && createdKey) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-xl w-full max-w-lg shadow-2xl">
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">API Key Created!</h2>
            <p className="text-muted-foreground mb-6">Save your credentials now. The secret will not be shown again.</p>
            
            <div className="space-y-4 text-left">
              <div className="p-4 bg-muted rounded-xl">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 text-sm font-mono text-foreground break-all">{createdKey.apiKey}</code>
                  <button
                    onClick={() => copyToClipboard(createdKey.apiKey, 'apiKey')}
                    className="p-2 hover:bg-accent rounded-lg transition-colors"
                  >
                    {copiedKey === 'apiKey' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>
              
              {createdKey.apiSecret && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <label className="text-xs font-medium text-yellow-700 dark:text-yellow-500 uppercase tracking-wider">API Secret (Save Now!)</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-foreground break-all">{createdKey.apiSecret}</code>
                    <button
                      onClick={() => copyToClipboard(createdKey.apiSecret!, 'apiSecret')}
                      className="p-2 hover:bg-yellow-200 dark:hover:bg-yellow-800 rounded-lg transition-colors"
                    >
                      {copiedKey === 'apiSecret' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-yellow-600" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => router.push('/dashboard/api')}
              className="w-full mt-6 px-6 py-3 bg-primary hover:bg-primary/85 text-white font-semibold rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const RadioCard = ({ checked, onChange, label, description, recommended = false }: {
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
    recommended?: boolean;
  }) => (
    <button
      onClick={onChange}
      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
        checked 
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
          : 'border-border hover:border-border dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
          checked ? 'border-blue-500' : 'border-border dark:border-gray-600'
        }`}>
          {checked && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${checked ? 'text-blue-700 dark:text-blue-400' : 'text-foreground'}`}>{label}</span>
            {recommended && (
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-primary text-xs font-medium rounded">Recommended</span>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
    </button>
  );

  const PermissionCheckbox = ({ checked, onChange, label, description, disabled = false }: {
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
    disabled?: boolean;
  }) => (
    <label className={`flex items-start gap-3 cursor-pointer py-3 px-4 rounded-lg hover:bg-accent/50 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <div
        onClick={() => !disabled && onChange()}
        className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors flex-shrink-0 mt-0.5 ${
          checked ? 'bg-primary border-blue-500' : 'border-border dark:border-gray-600'
        }`}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );

  return (
    <div className="p-4 lg:p-8 bg-background min-h-full">
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <button 
            onClick={() => router.push('/dashboard/api')}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            API
          </button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-foreground font-medium">Create New Key</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center shadow-lg ${
            keyType === 'system' 
              ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/25' 
              : 'bg-gradient-to-br from-purple-500 to-purple-600 shadow-purple-500/25'
          }`}>
            {keyType === 'system' ? <Key className="w-7 h-7 text-white" /> : <Shield className="w-7 h-7 text-white" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {keyType === 'system' ? 'System-generated API Key' : 'Self-generated API Key'}
            </h1>
            <p className="text-muted-foreground">
              {keyType === 'system' ? 'HMAC Encryption' : 'RSA Encryption'} • Configure your API permissions
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* API Key Usage */}
          <div className="bg-card rounded-xl p-6 border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">API Key Usage</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RadioCard
                checked={apiKeyUsage === 'transaction'}
                onChange={() => setApiKeyUsage('transaction')}
                label="API Transaction"
                description="For personal trading and automation"
                recommended
              />
              <RadioCard
                checked={apiKeyUsage === 'third_party'}
                onChange={() => setApiKeyUsage('third_party')}
                label="Third-Party Applications"
                description="Connect external trading tools"
              />
            </div>
          </div>

          {/* Public Key (Self-generated only) */}
          {keyType === 'self' && (
            <div className="bg-card rounded-xl p-6 border border-border">
              <h2 className="text-lg font-semibold text-foreground mb-4">Your Public Key *</h2>
              <textarea
                value={publicKey}
                onChange={e => setPublicKey(e.target.value)}
                placeholder="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
-----END PUBLIC KEY-----"
                rows={5}
                className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-primary/20 resize-none font-mono text-sm"
              />
              <button className="mt-3 text-primary hover:text-primary/85 text-sm font-medium flex items-center gap-1">
                <Info className="w-4 h-4" />
                How to create RSA public and private keys →
              </button>
            </div>
          )}

          {/* Key Name & Permissions */}
          <div className="bg-card rounded-xl p-6 border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">Key Configuration</h2>
            
            <div className="space-y-6">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">
                  Key Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g., Trading Bot, Portfolio Tracker"
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Permission Level */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-3">
                  Permission Level
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RadioCard
                    checked={permission === 'read_only'}
                    onChange={() => setPermission('read_only')}
                    label="Read-Only"
                    description="View data only, no trading"
                    recommended
                  />
                  <RadioCard
                    checked={permission === 'read_write'}
                    onChange={() => setPermission('read_write')}
                    label="Read-Write"
                    description="Full trading capabilities"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* IP Security */}
          <div className="bg-card rounded-xl p-6 border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">IP Security</h2>
            
            <div className="space-y-4">
              <RadioCard
                checked={ipRestriction === 'ip_only'}
                onChange={() => setIpRestriction('ip_only')}
                label="IP Whitelist"
                description="Only specified IPs can use this key. Keys are permanently valid."
                recommended
              />
              <RadioCard
                checked={ipRestriction === 'no_restriction'}
                onChange={() => setIpRestriction('no_restriction')}
                label="No IP Restriction"
                description="⚠️ Key expires in 3 months. Fiat and withdrawal restricted."
              />

              {ipRestriction === 'ip_only' && (
                <div className="mt-4 pl-8">
                  <label className="block text-sm font-medium text-foreground/80 mb-2">
                    IP Addresses (comma separated)
                  </label>
                  <textarea
                    value={ipAddresses}
                    onChange={e => setIpAddresses(e.target.value)}
                    placeholder="192.168.1.1, 10.0.0.1, 203.0.113.50"
                    rows={3}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-primary/20 resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Up to 100 IP addresses allowed</p>
                </div>
              )}
            </div>
          </div>

          {/* API Permissions */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">API Permissions</h2>
              <p className="text-sm text-muted-foreground">Select which features this key can access</p>
            </div>

            {/* Trading */}
            <div className="border-b border-border">
              <div className="px-6 py-3 bg-muted">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Trading</h3>
              </div>
              <div className="p-2">
                <PermissionCheckbox
                  checked={permissions.unifiedTrading}
                  onChange={() => togglePermission('unifiedTrading')}
                  label="Unified Trading"
                  description="Access unified trading account features"
                />
                <div className="ml-8 border-l-2 border-border pl-4">
                  <PermissionCheckbox
                    checked={permissions.spotTrade}
                    onChange={() => togglePermission('spotTrade')}
                    label="Spot Trading"
                    description="Query spot orders"
                  />
                </div>
              </div>
            </div>

            {/* Earn */}
            <div className="border-b border-border">
              <div className="px-6 py-3 bg-muted">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Earn</h3>
              </div>
              <div className="p-2">
                <PermissionCheckbox
                  checked={permissions.earn}
                  onChange={() => togglePermission('earn')}
                  label="Earn Products"
                  description="Access savings and staking features"
                />
                <div className="ml-8 border-l-2 border-border pl-4">
                  <PermissionCheckbox
                    checked={permissions.earnFlexibleSavings}
                    onChange={() => togglePermission('earnFlexibleSavings')}
                    label="Flexible Savings & On-Chain Earn"
                    description="Query products, orders, and earnings"
                  />
                </div>
              </div>
            </div>

            {/* Fiat */}
            <div className="border-b border-border">
              <div className="px-6 py-3 bg-muted">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Fiat Trading</h3>
              </div>
              <div className="p-2">
                <PermissionCheckbox
                  checked={permissions.fiatTrading}
                  onChange={() => togglePermission('fiatTrading')}
                  label="Fiat Trading"
                  description="P2P and fiat conversion access"
                />
                <div className="ml-8 border-l-2 border-border pl-4">
                  <PermissionCheckbox
                    checked={permissions.p2pOrders}
                    onChange={() => togglePermission('p2pOrders')}
                    label="P2P Orders"
                    description="View P2P order details"
                  />
                  <PermissionCheckbox
                    checked={permissions.p2pAds}
                    onChange={() => togglePermission('p2pAds')}
                    label="P2P Ads"
                    description="View advertisement details"
                  />
                  <PermissionCheckbox
                    checked={permissions.bybitPayOrders}
                    onChange={() => togglePermission('bybitPayOrders')}
                    label="Pay Orders"
                    description="View payment orders"
                  />
                  <PermissionCheckbox
                    checked={permissions.cryptoFiatOrders}
                    onChange={() => togglePermission('cryptoFiatOrders')}
                    label="Crypto-Fiat Conversion"
                    description="Broker conversion orders"
                  />
                </div>
              </div>
            </div>

            {/* Assets */}
            <div>
              <div className="px-6 py-3 bg-muted">
                <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Assets</h3>
              </div>
              <div className="p-2">
                <PermissionCheckbox
                  checked={permissions.assets}
                  onChange={() => togglePermission('assets')}
                  label="Asset Management"
                  description="Wallet and exchange access"
                />
                <div className="ml-8 border-l-2 border-border pl-4">
                  <PermissionCheckbox
                    checked={permissions.walletAccountTransfer}
                    onChange={() => togglePermission('walletAccountTransfer')}
                    label="Account Transfer"
                    description="Query transfer records"
                  />
                  <PermissionCheckbox
                    checked={permissions.walletSubaccountTransfer}
                    onChange={() => togglePermission('walletSubaccountTransfer')}
                    label="Subaccount Transfer"
                    description="Main and subaccount transfers"
                  />
                  <div className="py-3 px-4 rounded-lg opacity-50">
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-md border-2 border-border dark:border-gray-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">Withdrawal</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Not available for read-only keys</p>
                      </div>
                    </div>
                  </div>
                  <PermissionCheckbox
                    checked={permissions.exchangeConvertHistory}
                    onChange={() => togglePermission('exchangeConvertHistory')}
                    label="Convert & Exchange History"
                    description="Query exchange records"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Permission Summary */}
          <APIPermissionSummary
                keyName={name}
                permission={permission}
                ipRestriction={ipRestriction}
                ipAddressCount={ipAddresses.split(',').map((ip) => ip.trim()).filter(Boolean).length}
                withdrawalAccess={
                  permission === 'read_only' ? 'read_only' : permissions.walletWithdrawal ? 'enabled' : 'disabled'
                }
                enabledPermissions={Object.entries(permissions).filter(([, v]) => v).map(([k]) => k)}
              />

          {/* Submit */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-8 py-4 bg-primary hover:bg-primary/85 disabled:bg-blue-300 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Key className="w-5 h-5" />
                  Create API Key
                </>
              )}
            </button>
            <button
              onClick={() => router.push('/dashboard/api')}
              className="px-8 py-4 text-muted-foreground hover:text-foreground dark:hover:text-white font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CreateApiKeyPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <CreateApiKeyContent />
    </Suspense>
  );
}
