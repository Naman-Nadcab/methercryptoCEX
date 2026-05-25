'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { 
  ChevronRight, 
  Plus, 
  Search, 
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  Mail,
  Shield
} from 'lucide-react';

interface WithdrawalAddress {
  id: string;
  asset: string;
  network: string;
  note: string;
  address: string;
  memo?: string;
  last_updated: string;
  is_whitelisted: boolean;
}

interface Asset {
  id: string;
  symbol: string;
  name: string;
}

export default function AddressBookPage() {
  const router = useRouter();
  const { user, accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  // Refs for dropdown
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const assetDropdownRef = useRef<HTMLDivElement>(null);

  // States
  const [addresses, setAddresses] = useState<WithdrawalAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('All');
  const [assetFilter, setAssetFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  
  // Dropdown states
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  
  // Settings states
  const [withdrawViaAddressBook, setWithdrawViaAddressBook] = useState(false);
  const [newAddressLock, setNewAddressLock] = useState(false);
  const [withdrawalWhitelist, setWithdrawalWhitelist] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [togglingWhitelist, setTogglingWhitelist] = useState(false);

  // 2FA status
  const [user2faEnabled, setUser2faEnabled] = useState(false);

  // Whitelist verification modal states
  const [showWhitelistVerifyModal, setShowWhitelistVerifyModal] = useState(false);
  const [whitelistEmailOtp, setWhitelistEmailOtp] = useState('');
  const [whitelistEmailOtpTimer, setWhitelistEmailOtpTimer] = useState(0);
  const [sendingWhitelistOtp, setSendingWhitelistOtp] = useState(false);
  const [whitelistGoogle2faCode, setWhitelistGoogle2faCode] = useState('');
  const [verifyingWhitelist, setVerifyingWhitelist] = useState(false);

  // Assets from database
  const [dbAssets, setDbAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);

  // Add address modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [addModalTab, setAddModalTab] = useState<'onchain' | 'internal'>('onchain');
  const [walletAddressType, setWalletAddressType] = useState('regular');
  const [saveAsUniversal, setSaveAsUniversal] = useState(false);
  const [noVerificationNeeded, setNoVerificationNeeded] = useState(false);
  const [recipientType, setRecipientType] = useState<'email' | 'mobile' | 'uid'>('email');
  const [selectedCountryCode, setSelectedCountryCode] = useState('+91');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [newAddress, setNewAddress] = useState({
    asset: '',
    network: '',
    address: '',
    note: '',
    memo: '',
    type: 'onchain',
    recipientAccount: '',
    walletType: 'regular'
  });

  // Country codes
  const countryCodes = [
    { code: '+91', name: 'India', flag: '🇮🇳' },
    { code: '+1', name: 'United States', flag: '🇺🇸' },
    { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
    { code: '+86', name: 'China', flag: '🇨🇳' },
    { code: '+81', name: 'Japan', flag: '🇯🇵' },
    { code: '+82', name: 'South Korea', flag: '🇰🇷' },
    { code: '+65', name: 'Singapore', flag: '🇸🇬' },
    { code: '+971', name: 'UAE', flag: '🇦🇪' },
    { code: '+61', name: 'Australia', flag: '🇦🇺' },
    { code: '+49', name: 'Germany', flag: '🇩🇪' },
    { code: '+33', name: 'France', flag: '🇫🇷' },
    { code: '+7', name: 'Russia', flag: '🇷🇺' },
    { code: '+55', name: 'Brazil', flag: '🇧🇷' },
    { code: '+52', name: 'Mexico', flag: '🇲🇽' },
    { code: '+234', name: 'Nigeria', flag: '🇳🇬' },
  ];

  // Type options
  const typeOptions = [
    { value: 'All', label: 'All' },
    { value: 'regular', label: 'Regular Wallet Address' },
    { value: 'universal', label: 'Universal Wallet Address' },
    { value: 'internal', label: 'Internal Transfer' },
    { value: 'web3', label: 'web3' },
  ];

  // Networks (would come from API based on selected asset)
  const networks = ['Bitcoin', 'Ethereum (ERC20)', 'BSC (BEP20)', 'Polygon', 'Tron (TRC20)', 'Solana'];

  // Timer effect for whitelist OTP
  useEffect(() => {
    if (whitelistEmailOtpTimer > 0) {
      const timer = setTimeout(() => setWhitelistEmailOtpTimer(whitelistEmailOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [whitelistEmailOtpTimer]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target as Node)) {
        setShowTypeDropdown(false);
      }
      if (assetDropdownRef.current && !assetDropdownRef.current.contains(event.target as Node)) {
        setShowAssetDropdown(false);
        setAssetSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchAddresses();
    fetchSettings();
    fetchAssets();
    fetch2faStatus();
  }, [accessToken]);

  const fetch2faStatus = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/2fa/status`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      if (result.success) {
        setUser2faEnabled(result.data.enabled || false);
      }
    } catch (error) {
      console.error('Failed to fetch 2FA status:', error);
    }
  };

  const fetchAssets = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/wallet/tokens`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      });
      const result = await response.json();
      
      if (result.success && result.data) {
        setDbAssets(result.data.map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          name: t.name
        })));
      }
    } catch (error) {
      console.error('Failed to fetch assets:', error);
      // Fallback assets
      setDbAssets([
        { id: '1', symbol: 'BTC', name: 'Bitcoin' },
        { id: '2', symbol: 'USDT', name: 'Tether' },
        { id: '3', symbol: 'ETH', name: 'Ethereum' },
        { id: '4', symbol: 'XRP', name: 'Ripple' },
        { id: '5', symbol: 'LTC', name: 'Litecoin' },
        { id: '6', symbol: 'XLM', name: 'Stellar' },
        { id: '7', symbol: 'DOGE', name: 'Dogecoin' },
        { id: '8', symbol: 'UNI', name: 'Uniswap' },
        { id: '9', symbol: 'SUSHI', name: 'SushiSwap' },
        { id: '10', symbol: 'BNB', name: 'Binance Coin' },
        { id: '11', symbol: 'SOL', name: 'Solana' },
        { id: '12', symbol: 'MATIC', name: 'Polygon' },
      ]);
    } finally {
      setLoadingAssets(false);
    }
  };

  const fetchAddresses = async () => {
    if (!accessToken) return;
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-addresses`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      
      if (result.success) {
        setAddresses(result.data.addresses || []);
      }
    } catch (error) {
      console.error('Failed to fetch addresses:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    if (!accessToken) return;
    
    try {
      const [addressBookRes, whitelistRes, lockRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/auth/address-book/status`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }),
        fetch(`${apiUrl}/api/v1/auth/withdrawal-whitelist/status`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }),
        fetch(`${apiUrl}/api/v1/auth/new-address-lock/status`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      ]);

      const [addressBookResult, whitelistResult, lockResult] = await Promise.all([
        addressBookRes.json(),
        whitelistRes.json(),
        lockRes.json()
      ]);

      if (addressBookResult.success) setWithdrawViaAddressBook(addressBookResult.data.enabled || false);
      if (whitelistResult.success) setWithdrawalWhitelist(whitelistResult.data.enabled || false);
      if (lockResult.success) setNewAddressLock(lockResult.data.enabled || false);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  };

  // Mask email for display
  const maskEmail = (email: string) => {
    if (!email) return '';
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return email;
    const maskedLocal = localPart.slice(0, 3) + '****';
    return `${maskedLocal}@${domain}`;
  };

  // Handle whitelist toggle click - show verification modal
  const handleWhitelistToggle = () => {
    setShowWhitelistVerifyModal(true);
  };

  // Send whitelist email OTP
  const sendWhitelistEmailOtp = async () => {
    setSendingWhitelistOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', purpose: 'whitelist_toggle' }),
      });
      const result = await response.json();

      if (result.success) {
        setWhitelistEmailOtpTimer(120);
        toast({ title: 'Verification code sent', description: 'Check your email', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send verification code', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send OTP:', error);
      toast({ title: 'Error', description: 'Failed to send verification code', variant: 'destructive' });
    } finally {
      setSendingWhitelistOtp(false);
    }
  };

  // Verify and update whitelist setting
  const verifyAndUpdateWhitelist = async () => {
    if (!whitelistEmailOtp) {
      toast({ title: 'Validation', description: 'Please enter the email verification code', variant: 'destructive' });
      return;
    }

    if (user2faEnabled && !whitelistGoogle2faCode) {
      toast({ title: 'Validation', description: 'Please enter the Google 2FA code', variant: 'destructive' });
      return;
    }

    setVerifyingWhitelist(true);
    try {
      // Verify email OTP
      const verifyOtpRes = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', otp: whitelistEmailOtp, purpose: 'whitelist_toggle' }),
      });
      const otpResult = await verifyOtpRes.json();

      if (!otpResult.success) {
        toast({ title: 'Error', description: otpResult.error?.message || 'Invalid email verification code', variant: 'destructive' });
        setVerifyingWhitelist(false);
        return;
      }

      // If 2FA enabled, verify 2FA code
      if (user2faEnabled) {
        const verify2faRes = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ code: whitelistGoogle2faCode }),
        });
        const faResult = await verify2faRes.json();

        if (!faResult.success) {
          toast({ title: 'Error', description: faResult.error?.message || 'Invalid 2FA code', variant: 'destructive' });
          setVerifyingWhitelist(false);
          return;
        }
      }

      // Toggle whitelist setting
      const newValue = !withdrawalWhitelist;
      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-whitelist/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled: newValue }),
      });
      const result = await response.json();

      if (result.success) {
        setWithdrawalWhitelist(newValue);
        setShowWhitelistVerifyModal(false);
        setWhitelistEmailOtp('');
        setWhitelistGoogle2faCode('');
        setWhitelistEmailOtpTimer(0);
        toast({ title: 'Success', description: `Withdrawal Address Whitelist ${newValue ? 'enabled' : 'disabled'} successfully`, variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to update setting', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to update whitelist:', error);
      toast({ title: 'Error', description: 'Failed to update setting', variant: 'destructive' });
    } finally {
      setVerifyingWhitelist(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setTimeout(() => {
      setSearching(false);
    }, 300);
  };

  const handleAddAddress = async () => {
    if (addModalTab === 'onchain') {
      if (!newAddress.asset || !newAddress.network || !newAddress.address) {
        toast({ title: 'Validation', description: 'Please fill in all required fields', variant: 'destructive' });
        return;
      }
    } else {
      if (!newAddress.recipientAccount) {
        toast({ title: 'Validation', description: 'Please enter recipient account', variant: 'destructive' });
        return;
      }
    }

    setAddingAddress(true);
    try {
      // For mobile, prepend country code to recipient account
      let finalRecipientAccount = newAddress.recipientAccount;
      if (addModalTab === 'internal' && recipientType === 'mobile' && newAddress.recipientAccount) {
        finalRecipientAccount = `${selectedCountryCode}${newAddress.recipientAccount}`;
      }

      const payload = {
        ...newAddress,
        recipientAccount: finalRecipientAccount,
        type: addModalTab,
        walletType: walletAddressType,
        saveAsUniversal,
        noVerificationNeeded,
        recipientType: addModalTab === 'internal' ? recipientType : undefined,
        countryCode: addModalTab === 'internal' && recipientType === 'mobile' ? selectedCountryCode : undefined
      };

      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (result.success) {
        setShowAddModal(false);
        resetAddForm();
        fetchAddresses();
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to add address', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to add address:', error);
      toast({ title: 'Error', description: 'Failed to add address', variant: 'destructive' });
    } finally {
      setAddingAddress(false);
    }
  };

  const resetAddForm = () => {
    setNewAddress({
      asset: '',
      network: '',
      address: '',
      note: '',
      memo: '',
      type: 'onchain',
      recipientAccount: '',
      walletType: 'regular'
    });
    setAddModalTab('onchain');
    setWalletAddressType('regular');
    setSaveAsUniversal(false);
    setNoVerificationNeeded(false);
    setRecipientType('email');
    setSelectedCountryCode('+91');
    setShowCountryDropdown(false);
  };

  const handleDeleteAddress = async (id: string) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();

      if (result.success) {
        setDeleteConfirmId(null);
        fetchAddresses();
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to delete address', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to delete address:', error);
      toast({ title: 'Error', description: 'Failed to delete address', variant: 'destructive' });
    }
  };

  // Filter addresses based on search and filters
  const filteredAddresses = addresses.filter(addr => {
    if (typeFilter !== 'All') {
      // Type filtering logic would go here
    }
    if (assetFilter !== 'All' && addr.asset !== assetFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesAddress = addr.address.toLowerCase().includes(query);
      const matchesNote = addr.note?.toLowerCase().includes(query);
      const matchesAsset = addr.asset.toLowerCase().includes(query);
      const matchesNetwork = addr.network.toLowerCase().includes(query);
      if (!matchesAddress && !matchesNote && !matchesAsset && !matchesNetwork) return false;
    }
    return true;
  });

  // Filter assets for dropdown search
  const filteredAssets = dbAssets.filter(asset => 
    asset.symbol.toLowerCase().includes(assetSearchQuery.toLowerCase()) ||
    asset.name.toLowerCase().includes(assetSearchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="p-4 lg:p-6 bg-card dark:bg-background min-h-full">
      <div className="max-w-7xl mx-auto">
        {/* Title and Buttons Row */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground mb-4">
              Withdrawal Address
            </h1>

            {/* Settings Row */}
            <div className="space-y-3">
              {/* Withdraw via Address Book */}
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  withdrawViaAddressBook 
                    ? 'border-primary bg-primary' 
                    : 'border-border'
                }`}>
                  {withdrawViaAddressBook && (
                    <div className="w-2 h-2 rounded-full bg-card" />
                  )}
                </div>
                <span className="text-foreground/80">Withdraw via Address Book</span>
              </div>

              {/* 24 Hour Lock */}
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  newAddressLock 
                    ? 'border-primary bg-primary' 
                    : 'border-border'
                }`}>
                  {newAddressLock && (
                    <div className="w-2 h-2 rounded-full bg-card" />
                  )}
                </div>
                <span className="text-foreground/80">
                  Withdrawals are unavailable for newly saved addresses for 24 hours
                </span>
                <button 
                  onClick={() => router.push('/dashboard/security')}
                  className="text-primary hover:text-primary/85 flex items-center gap-0.5 font-medium ml-2"
                >
                  Set Up
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/85 text-primary-foreground rounded-lg transition-colors font-medium"
            >
              <Plus className="w-5 h-5" />
              Add
            </button>
            <button 
              onClick={() => router.push('/dashboard/address-book/add-batches')}
              className="px-6 py-3 border border-border text-foreground/80 rounded-lg hover:bg-accent transition-colors font-medium"
            >
              Add in Batches
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex items-end gap-4 mb-4 flex-wrap">
          {/* Type Dropdown */}
          <div className="relative" ref={typeDropdownRef}>
            <label className="block text-muted-foreground mb-2">Type:</label>
            <button
              onClick={() => {
                setShowTypeDropdown(!showTypeDropdown);
                setShowAssetDropdown(false);
              }}
              className="flex items-center justify-between gap-4 px-4 py-3 bg-card border border-border rounded-lg text-foreground min-w-[180px] hover:border-muted-foreground/30"
            >
              <span>{typeOptions.find(t => t.value === typeFilter)?.label || 'All'}</span>
              {showTypeDropdown ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            
            {showTypeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-full bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                {typeOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTypeFilter(option.value);
                      setShowTypeDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-accent text-sm transition-colors ${
                      typeFilter === option.value 
                        ? 'text-primary bg-muted' 
                        : 'text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assets Dropdown */}
          <div className="relative" ref={assetDropdownRef}>
            <label className="block text-muted-foreground mb-2">Assets:</label>
            <button
              onClick={() => {
                setShowAssetDropdown(!showAssetDropdown);
                setShowTypeDropdown(false);
              }}
              className="flex items-center justify-between gap-4 px-4 py-3 bg-card border border-border rounded-lg text-foreground min-w-[140px] hover:border-muted-foreground/30"
            >
              <div className="flex items-center gap-2">
                {assetFilter !== 'All' && (
                  <CoinIcon symbol={assetFilter} size={20} />
                )}
                <span>{assetFilter}</span>
              </div>
              {showAssetDropdown ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            
            {showAssetDropdown && (
              <div className="absolute top-full left-0 mt-1 w-[220px] bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                {/* Search Input */}
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={assetSearchQuery}
                      onChange={e => setAssetSearchQuery(e.target.value)}
                      placeholder="Search..."
                      autoFocus
                      className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
                
                {/* Options List */}
                <div className="max-h-[300px] overflow-y-auto">
                  {/* All Option */}
                  <button
                    onClick={() => {
                      setAssetFilter('All');
                      setShowAssetDropdown(false);
                      setAssetSearchQuery('');
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-accent text-sm transition-colors flex items-center gap-2 ${
                      assetFilter === 'All' 
                        ? 'text-primary bg-muted' 
                        : 'text-foreground'
                    }`}
                  >
                    All
                  </button>
                  
                  {/* Asset Options */}
                  {loadingAssets ? (
                    <div className="px-4 py-3 text-center">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : filteredAssets.length === 0 ? (
                    <div className="px-4 py-3 text-center text-muted-foreground text-sm">
                      No assets found
                    </div>
                  ) : (
                    filteredAssets.map(asset => (
                      <button
                        key={asset.id}
                        onClick={() => {
                          setAssetFilter(asset.symbol);
                          setShowAssetDropdown(false);
                          setAssetSearchQuery('');
                        }}
                        className={`w-full text-left px-4 py-3 hover:bg-accent text-sm transition-colors flex items-center gap-3 ${
                          assetFilter === asset.symbol 
                            ? 'text-primary bg-muted' 
                            : 'text-foreground'
                        }`}
                      >
                        <CoinIcon symbol={asset.symbol} size={24} />
                        <span>{asset.symbol}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Search Input */}
          <div>
            <label className="block text-muted-foreground mb-2">Search Address:</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Enter the address or add a note..."
                className="px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground w-[300px] outline-none focus:border-primary hover:border-muted-foreground/30"
              />
              <button 
                onClick={handleSearch}
                disabled={searching}
                className="px-6 py-3 border border-border text-foreground/80 rounded-lg hover:bg-accent transition-colors font-medium"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
              </button>
            </div>
          </div>
        </div>

        {/* Whitelist Toggle */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={handleWhitelistToggle}
            disabled={togglingWhitelist}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              withdrawalWhitelist ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 bg-card rounded-full transition-all shadow ${
                withdrawalWhitelist ? 'right-0.5' : 'left-0.5'
              }`}
            />
          </button>
          <span className="text-foreground/80">Withdrawal Address Whitelist</span>
        </div>

        {/* Table */}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Assets</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Network</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Note</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Withdrawal Address</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Memo/Tag</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Last Updated</th>
                <th className="text-left py-4 px-6 text-sm font-normal text-muted-foreground">Change</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : filteredAddresses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-20 bg-card">
                    <div className="flex flex-col items-center gap-4">
                      {/* Empty State Illustration */}
                      <div className="w-24 h-24 relative">
                        <svg viewBox="0 0 100 100" className="w-full h-full">
                          <rect x="20" y="10" width="55" height="70" rx="3" className="fill-muted" />
                          <rect x="25" y="15" width="45" height="60" rx="2" className="fill-card stroke-border" strokeWidth="1" />
                          <rect x="32" y="28" width="30" height="2" rx="1" className="fill-border" />
                          <rect x="32" y="36" width="25" height="2" rx="1" className="fill-border" />
                          <rect x="32" y="44" width="32" height="2" rx="1" className="fill-border" />
                          <rect x="32" y="52" width="20" height="2" rx="1" className="fill-border" />
                          <g transform="translate(55, 50) rotate(30)">
                            <rect x="0" y="0" width="8" height="35" rx="1" className="fill-warning" />
                            <rect x="0" y="0" width="8" height="6" className="fill-warning" />
                            <polygon points="0,35 4,45 8,35" className="fill-warning-light" />
                            <polygon points="2,40 4,45 6,40" className="fill-muted-foreground" />
                          </g>
                        </svg>
                      </div>
                      <p className="text-muted-foreground">No Records</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAddresses.map(addr => (
                  <tr key={addr.id} className="border-b border-border hover:bg-muted/80 bg-card">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <CoinIcon symbol={addr.asset} size={24} />
                        <span className="text-foreground font-medium">{addr.asset}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-foreground">{addr.network}</td>
                    <td className="py-4 px-6 text-muted-foreground">{addr.note || '-'}</td>
                    <td className="py-4 px-6 text-foreground font-mono text-sm">
                      {addr.address.length > 20 
                        ? `${addr.address.slice(0, 10)}...${addr.address.slice(-10)}`
                        : addr.address
                      }
                    </td>
                    <td className="py-4 px-6 text-muted-foreground">{addr.memo || '-'}</td>
                    <td className="py-4 px-6 text-muted-foreground text-sm">{formatDate(addr.last_updated)}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <button className="text-primary hover:text-primary/85 text-sm font-medium">Edit</button>
                        {deleteConfirmId === addr.id ? (
                          <>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-muted-foreground hover:text-foreground text-sm font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void handleDeleteAddress(addr.id)}
                              className="text-sell hover:text-sell/90 text-sm font-semibold"
                            >
                              Confirm delete
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(addr.id)}
                            className="text-sell hover:text-sell/90 text-sm font-medium"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Whitelist Verification Modal */}
      {showWhitelistVerifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Security Verification</h2>
                <button 
                  onClick={() => {
                    setShowWhitelistVerifyModal(false);
                    setWhitelistEmailOtp('');
                    setWhitelistGoogle2faCode('');
                    setWhitelistEmailOtpTimer(0);
                  }} 
                  className="text-muted-foreground hover:text-muted-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Email OTP Section */}
              <div className="mb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Mail className="w-4 h-4" />
                  <span>A verification code will be sent to <strong className="text-foreground">{maskEmail(user?.email || '')}</strong></span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={whitelistEmailOtp}
                    onChange={e => setWhitelistEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Please enter the email verification code"
                    className="flex-1 px-4 py-3 bg-muted border border-border rounded-lg text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  />
                  <button
                    onClick={sendWhitelistEmailOtp}
                    disabled={sendingWhitelistOtp || whitelistEmailOtpTimer > 0}
                    className="px-4 py-3 text-sm font-medium text-primary hover:text-primary/85 disabled:text-muted-foreground whitespace-nowrap"
                  >
                    {sendingWhitelistOtp ? 'Sending...' : whitelistEmailOtpTimer > 0 ? `${whitelistEmailOtpTimer}s` : 'Send Verification Code'}
                  </button>
                </div>
              </div>

              {/* Google 2FA Section */}
              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Shield className="w-4 h-4" />
                  Google 2FA Code
                </label>
                <input
                  type="text"
                  value={whitelistGoogle2faCode}
                  onChange={e => setWhitelistGoogle2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Please enter the Google Authenticator code"
                    className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  disabled={!user2faEnabled}
                />
                {!user2faEnabled && (
                  <p className="text-xs text-muted-foreground mt-1">Google 2FA is not enabled</p>
                )}
              </div>

              {/* Next Step Button */}
              <button
                onClick={verifyAndUpdateWhitelist}
                disabled={verifyingWhitelist || !whitelistEmailOtp || (user2faEnabled && !whitelistGoogle2faCode)}
                className="w-full py-3 bg-primary hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifyingWhitelist ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Next Step'
                )}
              </button>

              {/* Help Link */}
              <p className="text-center text-sm text-primary hover:underline cursor-pointer mt-4">
                Having problems with verification?
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add Address Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">Add</h2>
                <button 
                  onClick={() => {
                    setShowAddModal(false);
                    resetAddForm();
                  }} 
                  className="text-muted-foreground hover:text-muted-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Warning Note */}
              <div className="flex items-start gap-2 p-3 bg-warning-light rounded-lg mb-4">
                <div className="w-4 h-4 rounded-full bg-warning flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-primary-foreground text-xs">!</span>
                </div>
                <p className="text-sm text-foreground/80">
                  Note: Once successfully added, your withdrawal address cannot be modified.
                </p>
              </div>

              {/* Tabs */}
              <div className="flex gap-6 border-b border-border mb-4">
                <button
                  onClick={() => setAddModalTab('onchain')}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    addModalTab === 'onchain'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground/80'
                  }`}
                >
                  On-chain Withdrawal
                </button>
                <button
                  onClick={() => setAddModalTab('internal')}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    addModalTab === 'internal'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground/80'
                  }`}
                >
                  Internal Transfer
                </button>
              </div>

              {/* On-chain Withdrawal Form */}
              {addModalTab === 'onchain' && (
                <div className="space-y-4">
                  {/* Save as Universal Wallet Address */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Save as Universal Wallet Address</span>
                    <div className="w-4 h-4 rounded-full border border-border flex items-center justify-center cursor-help">
                      <span className="text-xs text-muted-foreground">?</span>
                    </div>
                  </div>

                  {/* Wallet Address Type */}
                  <div className="relative">
                    <select
                      value={walletAddressType}
                      onChange={e => setWalletAddressType(e.target.value)}
                      className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground outline-none focus:border-primary appearance-none cursor-pointer"
                    >
                      <option value="regular">Regular Wallet Address</option>
                      <option value="universal">Universal Wallet Address</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>

                  {/* Assets */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Assets</label>
                    <div className="relative">
                      <select
                        value={newAddress.asset}
                        onChange={e => setNewAddress({...newAddress, asset: e.target.value})}
                        className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground outline-none focus:border-primary appearance-none cursor-pointer"
                      >
                        <option value="">Please select</option>
                        {dbAssets.map(asset => (
                          <option key={asset.id} value={asset.symbol}>{asset.symbol}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Address</label>
                    <input
                      type="text"
                      value={newAddress.address}
                      onChange={e => setNewAddress({...newAddress, address: e.target.value})}
                      placeholder="Please input your withdrawal wallet address"
                      className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                    />
                  </div>

                  {/* Chain Type */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Chain Type</label>
                    <div className="relative">
                      <select
                        value={newAddress.network}
                        onChange={e => setNewAddress({...newAddress, network: e.target.value})}
                        className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground outline-none focus:border-primary appearance-none cursor-pointer"
                      >
                        <option value="">Select chain type</option>
                        {networks.map(network => (
                          <option key={network} value={network}>{network}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {/* Remark */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Remark</label>
                    <input
                      type="text"
                      value={newAddress.note}
                      onChange={e => setNewAddress({...newAddress, note: e.target.value})}
                      placeholder="Add a remark"
                      className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              {/* Internal Transfer Form */}
              {addModalTab === 'internal' && (
                <div className="space-y-4">
                  {/* Recipient Account */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Recipient Account</label>
                    
                    {/* Recipient Type Tabs */}
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => setRecipientType('email')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          recipientType === 'email'
                            ? 'bg-muted text-primary'
                            : 'bg-accent text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        Email Address
                      </button>
                      <button
                        onClick={() => setRecipientType('mobile')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          recipientType === 'mobile'
                            ? 'bg-muted text-primary'
                            : 'bg-accent text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        Mobile Number
                      </button>
                      <button
                        onClick={() => setRecipientType('uid')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          recipientType === 'uid'
                            ? 'bg-muted text-primary'
                            : 'bg-accent text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        UID
                      </button>
                    </div>

                    {/* Recipient Input - Different based on type */}
                    {recipientType === 'mobile' ? (
                      <div className="flex gap-2">
                        {/* Country Code Dropdown */}
                        <div className="relative">
                          <button
                            onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                            className="flex items-center gap-2 px-4 py-3 bg-card border border-border rounded-lg text-foreground min-w-[100px]"
                          >
                            <span>{selectedCountryCode}</span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                          
                          {showCountryDropdown && (
                            <div className="absolute top-full left-0 mt-1 w-[200px] bg-card border border-border rounded-lg shadow-lg z-30 max-h-[200px] overflow-y-auto">
                              {countryCodes.map(country => (
                                <button
                                  key={country.code}
                                  onClick={() => {
                                    setSelectedCountryCode(country.code);
                                    setShowCountryDropdown(false);
                                  }}
                                  className={`w-full text-left px-4 py-2.5 hover:bg-accent text-sm flex items-center gap-2 ${
                                    selectedCountryCode === country.code 
                                      ? 'text-primary bg-muted' 
                                      : 'text-foreground'
                                  }`}
                                >
                                  <span>{country.flag}</span>
                                  <span>{country.code}</span>
                                  <span className="text-muted-foreground text-xs">{country.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        {/* Phone Number Input */}
                        <input
                          type="text"
                          value={newAddress.recipientAccount}
                          onChange={e => setNewAddress({...newAddress, recipientAccount: e.target.value.replace(/\D/g, '')})}
                          placeholder="Please enter"
                          className="flex-1 px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={newAddress.recipientAccount}
                        onChange={e => setNewAddress({...newAddress, recipientAccount: e.target.value})}
                        placeholder="Please enter"
                        className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                      />
                    )}
                  </div>

                  {/* Remark */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Remark</label>
                    <input
                      type="text"
                      value={newAddress.note}
                      onChange={e => setNewAddress({...newAddress, note: e.target.value})}
                      placeholder="Add a remark"
                      className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              {/* No Verification Toggle */}
              <div className="mt-6 pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground/80">No verification needed for this address next time</span>
                    <div className="w-4 h-4 rounded-full border border-border flex items-center justify-center cursor-help">
                      <span className="text-xs text-muted-foreground">?</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setNoVerificationNeeded(!noVerificationNeeded)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      noVerificationNeeded ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-card rounded-full transition-all shadow ${
                        noVerificationNeeded ? 'right-0.5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Enable no-verification withdrawals</span>
                  <button 
                    onClick={() => {
                      setShowAddModal(false);
                      resetAddForm();
                      router.push('/dashboard/security#withdrawal-whitelist');
                    }}
                    className="text-sm text-primary hover:text-primary/85 flex items-center gap-1"
                  >
                    Enable
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Confirm Button */}
              <button
                onClick={handleAddAddress}
                disabled={addingAddress}
                className="w-full mt-6 py-3 bg-primary hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {addingAddress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
