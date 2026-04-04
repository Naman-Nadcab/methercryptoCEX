'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { 
  ChevronRight, 
  Plus, 
  Trash2,
  Loader2,
  ChevronDown,
  HelpCircle
} from 'lucide-react';

interface AddressRow {
  id: string;
  asset: string;
  chainType: string;
  address: string;
  tagMemo: string;
  remark: string;
}

interface InternalTransferRow {
  id: string;
  recipientType: 'email' | 'mobile' | 'uid';
  recipient: string;
  countryCode: string;
  remark: string;
}

interface Asset {
  id: string;
  symbol: string;
  name: string;
}

interface Chain {
  id: string;
  name: string;
  symbol: string;
}

export default function AddBatchesPage() {
  const router = useRouter();
  const { accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  // Tab state
  const [activeTab, setActiveTab] = useState<'onchain' | 'internal'>('onchain');

  // On-chain addresses
  const [onchainAddresses, setOnchainAddresses] = useState<AddressRow[]>([
    { id: '1', asset: '', chainType: '', address: '', tagMemo: '', remark: '' }
  ]);

  // Internal transfer addresses
  const [internalAddresses, setInternalAddresses] = useState<InternalTransferRow[]>([
    { id: '1', recipientType: 'email', recipient: '', countryCode: '+91', remark: '' }
  ]);

  // Checkboxes
  const [saveAsUniversal, setSaveAsUniversal] = useState(false);
  const [noVerificationRequired, setNoVerificationRequired] = useState(false);

  // Data from API
  const [assets, setAssets] = useState<Asset[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Country codes
  const countryCodes = [
    { code: '+91', name: 'India', flag: '🇮🇳' },
    { code: '+1', name: 'United States', flag: '🇺🇸' },
    { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
    { code: '+86', name: 'China', flag: '🇨🇳' },
    { code: '+81', name: 'Japan', flag: '🇯🇵' },
    { code: '+65', name: 'Singapore', flag: '🇸🇬' },
    { code: '+971', name: 'UAE', flag: '🇦🇪' },
  ];

  useEffect(() => {
    fetchAssets();
    fetchChains();
  }, [accessToken]);

  const fetchAssets = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/wallet/tokens`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      });
      const result = await response.json();
      if (result.success && result.data) {
        setAssets(result.data.map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          name: t.name
        })));
      }
    } catch (error) {
      console.error('Failed to fetch assets:', error);
    } finally {
      setLoadingAssets(false);
    }
  };

  const fetchChains = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/wallet/chains`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      });
      const result = await response.json();
      if (result.success && result.data) {
        setChains(result.data.map((c: any) => ({
          id: c.id,
          name: c.name,
          symbol: c.symbol
        })));
      }
    } catch (error) {
      console.error('Failed to fetch chains:', error);
      // Fallback chains
      setChains([
        { id: '1', name: 'Ethereum', symbol: 'ETH' },
        { id: '2', name: 'BSC', symbol: 'BNB' },
        { id: '3', name: 'Polygon', symbol: 'MATIC' },
        { id: '4', name: 'Solana', symbol: 'SOL' },
        { id: '5', name: 'Tron', symbol: 'TRX' },
        { id: '6', name: 'Bitcoin', symbol: 'BTC' },
      ]);
    }
  };

  // On-chain address handlers
  const addOnchainRow = () => {
    const newId = (onchainAddresses.length + 1).toString();
    setOnchainAddresses([
      ...onchainAddresses,
      { id: newId, asset: '', chainType: '', address: '', tagMemo: '', remark: '' }
    ]);
  };

  const removeOnchainRow = (id: string) => {
    if (onchainAddresses.length > 1) {
      setOnchainAddresses(onchainAddresses.filter(a => a.id !== id));
    }
  };

  const updateOnchainRow = (id: string, field: keyof AddressRow, value: string) => {
    setOnchainAddresses(onchainAddresses.map(a => 
      a.id === id ? { ...a, [field]: value } : a
    ));
  };

  // Internal transfer handlers
  const addInternalRow = () => {
    const newId = (internalAddresses.length + 1).toString();
    setInternalAddresses([
      ...internalAddresses,
      { id: newId, recipientType: 'email', recipient: '', countryCode: '+91', remark: '' }
    ]);
  };

  const removeInternalRow = (id: string) => {
    if (internalAddresses.length > 1) {
      setInternalAddresses(internalAddresses.filter(a => a.id !== id));
    }
  };

  const updateInternalRow = (id: string, field: keyof InternalTransferRow, value: string) => {
    setInternalAddresses(internalAddresses.map(a => 
      a.id === id ? { ...a, [field]: value } : a
    ));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    
    try {
      const addressesToSubmit = activeTab === 'onchain' 
        ? onchainAddresses.filter(a => a.asset && a.address)
        : internalAddresses.filter(a => a.recipient);

      if (addressesToSubmit.length === 0) {
        toast({ title: 'Validation', description: 'Please add at least one valid address', variant: 'destructive' });
        setSubmitting(false);
        return;
      }

      // Submit each address
      const promises = addressesToSubmit.map(async (addr) => {
        const payload = activeTab === 'onchain' 
          ? {
              asset: (addr as AddressRow).asset,
              network: (addr as AddressRow).chainType,
              address: (addr as AddressRow).address,
              memo: (addr as AddressRow).tagMemo,
              note: (addr as AddressRow).remark,
              type: 'onchain',
              walletType: saveAsUniversal ? 'universal' : 'regular',
              saveAsUniversal,
              noVerificationNeeded: noVerificationRequired
            }
          : {
              recipientAccount: (addr as InternalTransferRow).recipientType === 'mobile'
                ? `${(addr as InternalTransferRow).countryCode}${(addr as InternalTransferRow).recipient}`
                : (addr as InternalTransferRow).recipient,
              recipientType: (addr as InternalTransferRow).recipientType,
              note: (addr as InternalTransferRow).remark,
              type: 'internal',
              noVerificationNeeded: noVerificationRequired
            };

        return fetch(`${apiUrl}/api/v1/auth/withdrawal-addresses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify(payload)
        });
      });

      const results = await Promise.all(promises);
      const allSuccessful = results.every(r => r.ok);

      if (allSuccessful) {
        toast({ title: 'Success', description: 'All addresses added successfully', variant: 'success' });
        router.push('/dashboard/address-book');
      } else {
        toast({ title: 'Partial success', description: 'Some addresses failed to add. Please try again.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to submit addresses:', error);
      toast({ title: 'Error', description: 'Failed to add addresses', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 bg-background min-h-full">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <span 
            className="text-muted-foreground hover:text-primary cursor-pointer"
            onClick={() => router.push('/dashboard/address-book')}
          >
            Address Book
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-foreground font-medium">Add in Batches</span>
        </div>

        {/* Main Card */}
        <div className="bg-card rounded-lg p-6">
          {/* Title */}
          <h1 className="text-xl font-semibold text-foreground mb-6">
            Add Your Wallet Addresses
          </h1>

          {/* Tabs */}
          <div className="flex gap-8 border-b border-border mb-6">
            <button
              onClick={() => setActiveTab('onchain')}
              className={`pb-4 text-base font-medium border-b-2 transition-colors ${
                activeTab === 'onchain'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground/80'
              }`}
            >
              On-Chain Withdrawal Address
            </button>
            <button
              onClick={() => setActiveTab('internal')}
              className={`pb-4 text-base font-medium border-b-2 transition-colors ${
                activeTab === 'internal'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground/80'
              }`}
            >
              Internal Transfer Address
            </button>
          </div>

          {/* On-Chain Withdrawal Form */}
          {activeTab === 'onchain' && (
            <div className="space-y-4">
              {onchainAddresses.map((addr, index) => (
                <div key={addr.id}>
                  {/* Row Label */}
                  <div className="text-sm text-muted-foreground mb-3">
                    Address {index + 1}
                  </div>
                  
                  {/* Header Row (only for first item) */}
                  {index === 0 && (
                    <div className="grid grid-cols-12 gap-4 mb-2">
                      <div className="col-span-2 text-sm text-muted-foreground">
                        <span className="text-sell">*</span> Assets
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground">
                        <span className="text-sell">*</span> Chain Type
                      </div>
                      <div className="col-span-3 text-sm text-muted-foreground">
                        <span className="text-sell">*</span> Address
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground">
                        Tag/Memo
                      </div>
                      <div className="col-span-2 text-sm text-muted-foreground">
                        Remark
                      </div>
                      <div className="col-span-1 text-sm text-muted-foreground">
                        Action
                      </div>
                    </div>
                  )}
                  
                  {/* Input Row */}
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Assets Dropdown */}
                    <div className="col-span-2 relative">
                      <select
                        value={addr.asset}
                        onChange={e => updateOnchainRow(addr.id, 'asset', e.target.value)}
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm appearance-none cursor-pointer outline-none focus:border-primary"
                      >
                        <option value="">Please select</option>
                        {assets.map(asset => (
                          <option key={asset.id} value={asset.symbol}>{asset.symbol}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Chain Type Dropdown */}
                    <div className="col-span-2 relative">
                      <select
                        value={addr.chainType}
                        onChange={e => updateOnchainRow(addr.id, 'chainType', e.target.value)}
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm appearance-none cursor-pointer outline-none focus:border-primary"
                      >
                        <option value="">Please select</option>
                        {chains.map(chain => (
                          <option key={chain.id} value={chain.name}>{chain.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Address Input */}
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={addr.address}
                        onChange={e => updateOnchainRow(addr.id, 'address', e.target.value)}
                        placeholder="Please input your withdrawal wallet address"
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                      />
                    </div>

                    {/* Tag/Memo Input */}
                    <div className="col-span-2">
                      <input
                        type="text"
                        value={addr.tagMemo}
                        onChange={e => updateOnchainRow(addr.id, 'tagMemo', e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                      />
                    </div>

                    {/* Remark Input */}
                    <div className="col-span-2">
                      <input
                        type="text"
                        value={addr.remark}
                        onChange={e => updateOnchainRow(addr.id, 'remark', e.target.value)}
                        placeholder="Add a remark"
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                      />
                    </div>

                    {/* Delete Button */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => removeOnchainRow(addr.id)}
                        disabled={onchainAddresses.length === 1}
                        className="p-2 text-muted-foreground hover:text-sell disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add Button */}
              <button
                onClick={addOnchainRow}
                className="flex items-center gap-2 px-6 py-2.5 border border-border text-foreground/80 rounded-lg hover:bg-accent transition-colors mt-4"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          )}

          {/* Internal Transfer Form */}
          {activeTab === 'internal' && (
            <div className="space-y-4">
              {internalAddresses.map((addr, index) => (
                <div key={addr.id}>
                  {/* Row Label */}
                  <div className="text-sm text-muted-foreground mb-3">
                    Address {index + 1}
                  </div>
                  
                  {/* Header Row (only for first item) */}
                  {index === 0 && (
                    <div className="grid grid-cols-12 gap-4 mb-2">
                      <div className="col-span-2 text-sm text-muted-foreground">
                        <span className="text-sell">*</span> Type
                      </div>
                      <div className="col-span-5 text-sm text-muted-foreground">
                        <span className="text-sell">*</span> Recipient
                      </div>
                      <div className="col-span-4 text-sm text-muted-foreground">
                        Remark
                      </div>
                      <div className="col-span-1 text-sm text-muted-foreground">
                        Action
                      </div>
                    </div>
                  )}
                  
                  {/* Input Row */}
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Recipient Type Dropdown */}
                    <div className="col-span-2 relative">
                      <select
                        value={addr.recipientType}
                        onChange={e => updateInternalRow(addr.id, 'recipientType', e.target.value)}
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm appearance-none cursor-pointer outline-none focus:border-primary"
                      >
                        <option value="email">Email</option>
                        <option value="mobile">Mobile</option>
                        <option value="uid">UID</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Recipient Input */}
                    <div className="col-span-5">
                      {addr.recipientType === 'mobile' ? (
                        <div className="flex gap-2">
                          <div className="relative w-24">
                            <select
                              value={addr.countryCode}
                              onChange={e => updateInternalRow(addr.id, 'countryCode', e.target.value)}
                              className="w-full px-2 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm appearance-none cursor-pointer outline-none focus:border-primary"
                            >
                              {countryCodes.map(c => (
                                <option key={c.code} value={c.code}>{c.code}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                          </div>
                          <input
                            type="text"
                            value={addr.recipient}
                            onChange={e => updateInternalRow(addr.id, 'recipient', e.target.value.replace(/\D/g, ''))}
                            placeholder="Please enter"
                            className="flex-1 px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                          />
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={addr.recipient}
                          onChange={e => updateInternalRow(addr.id, 'recipient', e.target.value)}
                          placeholder={addr.recipientType === 'email' ? 'Enter email address' : 'Enter UID'}
                          className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                        />
                      )}
                    </div>

                    {/* Remark Input */}
                    <div className="col-span-4">
                      <input
                        type="text"
                        value={addr.remark}
                        onChange={e => updateInternalRow(addr.id, 'remark', e.target.value)}
                        placeholder="Add a remark"
                        className="w-full px-3 py-2.5 bg-card border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                      />
                    </div>

                    {/* Delete Button */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => removeInternalRow(addr.id)}
                        disabled={internalAddresses.length === 1}
                        className="p-2 text-muted-foreground hover:text-sell disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add Button */}
              <button
                onClick={addInternalRow}
                className="flex items-center gap-2 px-6 py-2.5 border border-border text-foreground/80 rounded-lg hover:bg-accent transition-colors mt-4"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          )}

          {/* Checkboxes */}
          <div className="mt-8 space-y-4">
            {/* Universal Wallet Checkbox (only for on-chain) */}
            {activeTab === 'onchain' && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsUniversal}
                  onChange={e => setSaveAsUniversal(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground/80">
                  The above wallet addresses have been saved as Universal Wallet Address, enabling withdrawals of multiple coins.
                </span>
              </label>
            )}

            {/* No Verification Checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={noVerificationRequired}
                onChange={e => setNoVerificationRequired(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground/80 flex items-center gap-1">
                No withdrawal security verification required for above wallet addresses in future transactions.
                <HelpCircle className="w-4 h-4 text-muted-foreground" />
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-6 px-8 py-3 bg-primary hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
