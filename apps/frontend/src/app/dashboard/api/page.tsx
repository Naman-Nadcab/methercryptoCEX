'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ChevronRight, X, Loader2, Eye, EyeOff, Copy, Check, Key, Trash2, Edit3, Shield, AlertCircle } from 'lucide-react';
import { SkeletonTableBody } from '@/components/ui/Skeleton';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { APIUsageStats } from '@/components/api/APIUsageStats';
import { APISecurityIndicators } from '@/components/api/APISecurityIndicators';
import { APIDocLinks } from '@/components/api/APIDocLinks';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface ApiKey {
  id: string;
  name: string;
  keyType: 'system' | 'self';
  apiKeyUsage: 'transaction' | 'third_party';
  apiKey: string;
  apiSecret: string;
  permission: 'read_write' | 'read_only';
  ipRestriction: 'ip_only' | 'no_restriction';
  ipAddresses: string[];
  permissions: Record<string, boolean>;
  createdAt: string;
  expiresAt: string | null;
}

export default function ApiPage() {
  const router = useRouter();
  const { accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, [accessToken]);

  const fetchApiKeys = async () => {
    if (!accessToken) return;

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/api-keys`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();

      if (result.success && result.data) {
        setApiKeys(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSecretVisibility = (keyId: string) => {
    const newVisible = new Set(visibleSecrets);
    if (newVisible.has(keyId)) {
      newVisible.delete(keyId);
    } else {
      newVisible.add(keyId);
    }
    setVisibleSecrets(newVisible);
  };

  const copyToClipboard = async (text: string, keyId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const maskSecret = (secret: string) => {
    if (!secret) return '••••••••••••••••';
    return secret.slice(0, 4) + '••••••••' + secret.slice(-4);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDaysToExpiration = (expiresAt: string | null) => {
    if (!expiresAt) return { text: 'Never', color: 'text-green-500' };
    const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { text: 'Expired', color: 'text-red-500' };
    if (days < 30) return { text: `${days} days`, color: 'text-yellow-500' };
    return { text: `${days} days`, color: 'text-muted-foreground' };
  };

  const handleCreateKey = (type: 'system' | 'self') => {
    setShowTypeModal(false);
    router.push(`/dashboard/api/create?type=${type}`);
  };

  const handleDeleteKey = async (key: ApiKey) => {
    if (!confirm(`Revoke API key "${key.name}"? Spot and P2P automation using this key will stop.`)) return;
    setDeletingId(key.id);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/api-keys/${key.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setApiKeys((prev) => prev.filter((k) => k.id !== key.id));
        toast({ title: 'API key deleted', description: 'Access has been revoked', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to delete API key', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Delete API key error:', error);
      toast({ title: 'Error', description: 'Failed to delete API key', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-4 lg:p-8 bg-background min-h-full">
      <div className="max-w-7xl mx-auto">
        {/* Banner */}
        <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 rounded-xl px-6 py-4 mb-8">
          <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10"></div>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-card/20 rounded-xl flex items-center justify-center">
                <span className="text-2xl">🚀</span>
              </div>
              <div>
                <h3 className="text-white font-semibold">Methereum OpenAPI V5</h3>
                <p className="text-blue-100 text-sm">Transition from legacy versions to our latest API with enhanced features</p>
              </div>
            </div>
            <Link
              href={process.env.NEXT_PUBLIC_API_DOCS_URL || '/dashboard/announcements'}
              target={process.env.NEXT_PUBLIC_API_DOCS_URL ? '_blank' : undefined}
              rel={process.env.NEXT_PUBLIC_API_DOCS_URL ? 'noopener noreferrer' : undefined}
              className="px-4 py-2 bg-card/20 hover:bg-card/30 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              aria-label="API Documentation"
            >
              Documentation <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">API Management</h1>
            <p className="text-muted-foreground mt-1">Manage your API keys for automated trading and integrations</p>
          </div>
          <button
            onClick={() => setShowTypeModal(true)}
            className="px-6 py-3 bg-primary hover:bg-primary/85 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 flex items-center gap-2"
          >
            <Key className="w-5 h-5" />
            Create New Key
          </button>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-card rounded-xl p-5 border border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground inline-flex items-center gap-1">
                  API Keys <InfoTooltip content="Your API keys for trading and integrations. Keys without IP binding expire in 3 months." />
                </h3>
                <p className="text-xs text-muted-foreground">{apiKeys.length} / 20 keys</p>
              </div>
            </div>
            <div className="w-full bg-accent rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(apiKeys.length / 20) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-card rounded-xl p-5 border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-buy" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Security</h3>
                <p className="text-xs text-muted-foreground">IP Whitelisting recommended</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Keys without IP binding expire in 3 months</p>
          </div>

          <div className="bg-card rounded-xl p-5 border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Community</h3>
                <p className="text-xs text-muted-foreground">Join our Telegram</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button className="text-xs text-primary hover:text-primary/85">English Group →</button>
              <button className="text-xs text-primary hover:text-primary/85">中文群组 →</button>
            </div>
          </div>
        </div>

        {/* API Usage Analytics */}
        <div className="mb-8">
          <APIUsageStats
            requestsToday={0}
            errors={0}
            rateLimitUsage={0}
            rateLimitMax={100}
            loading={loading}
          />
        </div>

        {/* API Security Indicators & Doc Links */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Security</p>
            <APISecurityIndicators
              ipWhitelistCount={apiKeys.filter((k) => k.ipAddresses?.length > 0).length}
              readOnlyCount={apiKeys.filter((k) => k.permission === 'read_only').length}
              withdrawalDisabledCount={apiKeys.filter((k) => k.permission === 'read_only').length}
              totalKeys={apiKeys.length}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Documentation</p>
            <APIDocLinks />
          </div>
        </div>

        {/* API Key Records */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-5 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">API Key Records</h2>
            <p className="text-sm text-muted-foreground mt-1">Your active API keys and their permissions</p>
          </div>

          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">API Key</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Secret</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permission</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">IP Bound</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expires</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <SkeletonTableBody rows={4} columns={9} />
                </tbody>
              </table>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="py-20">
              {/* Empty State */}
              <div className="flex flex-col items-center justify-center">
                <div className="w-24 h-24 bg-accent rounded-full flex items-center justify-center mb-6">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="8" y="12" width="32" height="24" rx="4" className="fill-gray-200 dark:fill-gray-700"/>
                    <path d="M16 20h16M16 26h10" className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="36" cy="36" r="8" className="fill-blue-100 dark:fill-blue-900/50"/>
                    <path d="M33 36l2 2 4-4" className="stroke-blue-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No API Keys Yet</h3>
                <p className="text-muted-foreground text-center max-w-md mb-6">
                  Create your first API key to start integrating with our trading platform and automate your strategies.
                </p>
                <button
                  onClick={() => setShowTypeModal(true)}
                  className="px-6 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors"
                >
                  Create Your First Key
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">API Key</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Secret</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permission</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">IP Bound</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expires</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {apiKeys.map(key => {
                    const expiration = getDaysToExpiration(key.expiresAt);
                    return (
                      <tr key={key.id} className="hover:bg-muted dark:hover:bg-[#1e2329] transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                              <Key className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{key.name}</p>
                              <p className="text-xs text-muted-foreground">{key.apiKeyUsage === 'transaction' ? 'API Transaction' : 'Third-Party'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                            key.keyType === 'system' 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          }`}>
                            {key.keyType === 'system' ? 'HMAC' : 'RSA'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-foreground/80 bg-accent px-2 py-1 rounded">
                              {key.apiKey.slice(0, 8)}...{key.apiKey.slice(-4)}
                            </code>
                            <button
                              onClick={() => copyToClipboard(key.apiKey, `key-${key.id}`)}
                              className="p-1.5 hover:bg-accent rounded-lg transition-colors"
                            >
                              {copiedKey === `key-${key.id}` ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-foreground/80 bg-accent px-2 py-1 rounded">
                              {visibleSecrets.has(key.id) ? key.apiSecret?.slice(0, 16) + '...' : '••••••••••••'}
                            </code>
                            <button
                              onClick={() => toggleSecretVisibility(key.id)}
                              className="p-1.5 hover:bg-accent rounded-lg transition-colors"
                            >
                              {visibleSecrets.has(key.id) ? (
                                <EyeOff className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                            key.permission === 'read_write'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-accent text-foreground/70'
                          }`}>
                            {key.permission === 'read_write' ? 'Read-Write' : 'Read-Only'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {key.ipAddresses.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm text-buy">
                              <Shield className="w-4 h-4" />
                              {key.ipAddresses.length} IPs
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {formatDate(key.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-medium ${expiration.color}`}>
                            {expiration.text}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              disabled
                              className="p-2 rounded-lg opacity-50 cursor-not-allowed"
                              title="Edit coming soon - create a new key to change settings"
                              aria-label="Edit API key - coming soon"
                            >
                              <Edit3 className="w-4 h-4 text-muted-foreground" aria-hidden />
                            </button>
                            <button
                              onClick={() => handleDeleteKey(key)}
                              disabled={!!deletingId}
                              className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                              title="Delete API key"
                              aria-label={`Delete API key ${key.name}`}
                            >
                              {deletingId === key.id ? (
                                <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4 text-red-500" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-700 dark:text-yellow-400">
              <p className="font-medium mb-1">Security Recommendations</p>
              <ul className="list-disc list-inside space-y-1 text-yellow-600 dark:text-yellow-500">
                <li>Never share your API secret with anyone</li>
                <li>Add IP addresses to your keys for enhanced security</li>
                <li>Regularly rotate your API keys</li>
                <li>Use read-only permissions when write access isn't needed</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Select API Key Type Modal */}
      {showTypeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-xl font-bold text-foreground">
                Select Your API Key Type
              </h2>
              <button
                onClick={() => setShowTypeModal(false)}
                className="p-2 hover:bg-accent rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Options */}
            <div className="p-6 space-y-4">
              {/* System-generated */}
              <button
                onClick={() => handleCreateKey('system')}
                className="w-full p-5 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800/50 border-2 border-transparent hover:border-blue-500 rounded-xl transition-all text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/25">
                    <Key className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-foreground">System-generated API Keys</h3>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                      Uses <span className="font-semibold text-primary">HMAC encryption</span>. You'll receive a public and private key pair. Keep them secure like passwords.
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium rounded">Recommended</span>
                      <span className="px-2 py-1 bg-accent text-muted-foreground text-xs rounded">Easier Setup</span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Self-generated */}
              <button
                onClick={() => handleCreateKey('self')}
                className="w-full p-5 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800/50 border-2 border-transparent hover:border-purple-500 rounded-xl transition-all text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/25">
                    <Shield className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-foreground">Self-generated API Keys</h3>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-purple-500 transition-colors" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                      Uses <span className="font-semibold text-purple-600 dark:text-purple-400">RSA encryption</span>. Create your own key pair locally. We only store your public key - maximum security.
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs font-medium rounded">Advanced</span>
                      <span className="px-2 py-1 bg-accent text-muted-foreground text-xs rounded">API v3 & v5</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
