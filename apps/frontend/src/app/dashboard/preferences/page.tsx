'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { ChevronDown, ChevronUp, Loader2, Info, Settings, Bell, Mail, Globe, DollarSign, TrendingUp, Wallet, MessageCircle, Check } from 'lucide-react';
import { notifyError } from '@/lib/notifyError';
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  isPushSupported,
  sendTestPush,
  type PushStatus,
} from '@/lib/pushNotifications';

interface PreferenceSettings {
  // General Settings
  equivalentCurrency: string;
  priceChangeReference: string;
  promptConfirmationOrders: boolean;
  showConfirmationMobile: boolean;
  promptLeverageAdjustment: boolean;
  turnOnOrderbookAnimation: boolean;
  promptCancelAllConfirmation: boolean;
  autoTransferDeposit: 'funding' | 'unified' | 'none';
  
  // Notification Settings
  notificationLanguage: string;
  latestEvents: boolean;
  announcement: boolean;
  rewards: boolean;
  tradingViewAlerts: boolean;
  news: boolean;
  strategySignal: boolean;
  changesToAccountInfo: boolean;
  telegramNotification: boolean;
  p2pTradingOrderNotification: boolean;
  p2pAppealOrderNotification: boolean;
  
  // Email Subscription - Events reminders
  airdropAwardAlert: boolean;
  commissionsReceived: boolean;
  eventReminderNewEvents: boolean;
  perksAndRewards: boolean;
  financialProductListings: boolean;
  spotListings: boolean;
  perpetualContractListings: boolean;
  trustpilotRatings: boolean;
  web3Events: boolean;
  
  // Email Subscription - General announcement
  systemMaintenance: boolean;
  platformAnnouncements: boolean;
  newFeatures: boolean;
  newsAndInsights: boolean;
}

const currencies = [
  { value: 'USD', label: 'USD', flag: '🇺🇸', name: 'US Dollar' },
  { value: 'EUR', label: 'EUR', flag: '🇪🇺', name: 'Euro' },
  { value: 'GBP', label: 'GBP', flag: '🇬🇧', name: 'British Pound' },
  { value: 'INR', label: 'INR', flag: '🇮🇳', name: 'Indian Rupee' },
  { value: 'JPY', label: 'JPY', flag: '🇯🇵', name: 'Japanese Yen' },
  { value: 'AUD', label: 'AUD', flag: '🇦🇺', name: 'Australian Dollar' },
  { value: 'CAD', label: 'CAD', flag: '🇨🇦', name: 'Canadian Dollar' },
  { value: 'CNY', label: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan' },
  { value: 'KRW', label: 'KRW', flag: '🇰🇷', name: 'Korean Won' },
  { value: 'SGD', label: 'SGD', flag: '🇸🇬', name: 'Singapore Dollar' },
];

const languages = [
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'zh', label: '中文', flag: '🇨🇳' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
  { value: 'ko', label: '한국어', flag: '🇰🇷' },
  { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'pt', label: 'Português', flag: '🇧🇷' },
  { value: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { value: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { value: 'th', label: 'ไทย', flag: '🇹🇭' },
];

const priceChangeOptions = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export default function PreferencesPage() {
  const { accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  const [activeTab, setActiveTab] = useState<'general' | 'notification' | 'email'>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  
  // Dropdown states
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showPriceChangeDropdown, setShowPriceChangeDropdown] = useState(false);
  
  // Collapsible sections
  const [eventsRemindersExpanded, setEventsRemindersExpanded] = useState(true);
  const [generalAnnouncementExpanded, setGeneralAnnouncementExpanded] = useState(true);

  // Browser push (VAPID) state
  const [pushStatus, setPushStatus] = useState<PushStatus>({ supported: false, permission: 'default', subscribed: false });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  const refreshPushStatus = async () => setPushStatus(await getPushStatus());

  useEffect(() => {
    if (isPushSupported()) refreshPushStatus();
  }, []);

  const handleEnablePush = async () => {
    if (!accessToken) return;
    setPushBusy(true);
    setPushNotice(null);
    const r = await enablePushNotifications(accessToken);
    setPushNotice(r.ok ? 'Push notifications enabled on this device' : (r.error || 'Failed'));
    await refreshPushStatus();
    setPushBusy(false);
  };

  const handleDisablePush = async () => {
    if (!accessToken) return;
    setPushBusy(true);
    setPushNotice(null);
    const r = await disablePushNotifications(accessToken);
    setPushNotice(r.ok ? 'Push notifications disabled on this device' : (r.error || 'Failed'));
    await refreshPushStatus();
    setPushBusy(false);
  };

  const handleTestPush = async () => {
    if (!accessToken) return;
    setPushBusy(true);
    setPushNotice(null);
    const r = await sendTestPush(accessToken);
    if (!r.ok) setPushNotice(r.error || 'Test failed');
    else if ((r.sent ?? 0) === 0) setPushNotice('No active device subscriptions to notify');
    else setPushNotice(`Test push sent to ${r.sent} device(s)`);
    setPushBusy(false);
  };

  const [settings, setSettings] = useState<PreferenceSettings>({
    equivalentCurrency: 'USD',
    priceChangeReference: '24h',
    promptConfirmationOrders: true,
    showConfirmationMobile: true,
    promptLeverageAdjustment: true,
    turnOnOrderbookAnimation: true,
    promptCancelAllConfirmation: true,
    autoTransferDeposit: 'funding',
    notificationLanguage: 'en',
    latestEvents: true,
    announcement: true,
    rewards: true,
    tradingViewAlerts: true,
    news: true,
    strategySignal: true,
    changesToAccountInfo: true,
    telegramNotification: false,
    p2pTradingOrderNotification: false,
    p2pAppealOrderNotification: false,
    airdropAwardAlert: true,
    commissionsReceived: false,
    eventReminderNewEvents: true,
    perksAndRewards: false,
    financialProductListings: true,
    spotListings: true,
    perpetualContractListings: true,
    trustpilotRatings: true,
    web3Events: true,
    systemMaintenance: true,
    platformAnnouncements: true,
    newFeatures: true,
    newsAndInsights: true,
  });

  useEffect(() => {
    fetchSettings();
  }, [accessToken]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside dropdown areas
      if (!target.closest('.dropdown-container')) {
        setShowCurrencyDropdown(false);
        setShowLanguageDropdown(false);
        setShowPriceChangeDropdown(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const fetchSettings = async () => {
    if (!accessToken) return;

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/preferences`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();

      if (result.success && result.data) {
        setSettings(prev => ({ ...prev, ...result.data }));
      }
    } catch (error) {
      notifyError('Failed to load preferences. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof PreferenceSettings, value: any) => {
    const previousValue = settings[key];
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    setSaving(key);

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ [key]: value })
      });
      if (!response.ok) {
        setSettings((prev) => ({ ...prev, [key]: previousValue }));
        notifyError('Failed to update preference. Please try again.');
      }
    } catch (error) {
      setSettings((prev) => ({ ...prev, [key]: previousValue }));
      notifyError('Failed to update preference. Please try again.');
    } finally {
      setTimeout(() => setSaving(null), 500);
    }
  };

  const Toggle = ({ checked, onChange, saving: isSaving = false }: { checked: boolean; onChange: (v: boolean) => void; saving?: boolean }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-all duration-300 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-5 h-5 bg-card rounded-full transition-all duration-300 shadow-md flex items-center justify-center ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      >
        {isSaving && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
      </span>
    </button>
  );

  const Checkbox = ({ checked, onChange, label, saving: isSaving = false }: { 
    checked: boolean; 
    onChange: (v: boolean) => void; 
    label: string;
    saving?: boolean;
  }) => (
    <label className="flex items-center gap-3 cursor-pointer py-3 px-4 rounded-xl hover:bg-accent/50 transition-colors">
      <div
        onClick={(e) => { e.preventDefault(); onChange(!checked); }}
        className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all duration-200 ${
          checked ? 'bg-primary border-primary' : 'border-border'
        }`}
      >
        {isSaving ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary-foreground" />
        ) : checked ? (
          <Check className="w-3 h-3 text-primary-foreground" />
        ) : null}
      </div>
      <span className="text-sm text-foreground/80">{label}</span>
    </label>
  );

  const RadioCard = ({ checked, onChange, label, description }: {
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
  }) => (
    <button
      onClick={onChange}
      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
        checked 
          ? 'border-primary bg-muted' 
          : 'border-border hover:border-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
          checked ? 'border-primary' : 'border-border'
        }`}>
          {checked && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div className="flex-1">
          <span className={`font-medium ${checked ? 'text-primary' : 'text-foreground'}`}>{label}</span>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
    </button>
  );

  const SettingRow = ({ 
    label, 
    description, 
    checked, 
    onChange, 
    settingKey 
  }: { 
    label: string; 
    description?: string; 
    checked: boolean; 
    onChange: (v: boolean) => void;
    settingKey: string;
  }) => (
    <div className="flex items-center justify-between py-4 px-2 border-b border-border last:border-0">
      <div className="flex-1 pr-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {description && (
            <div className="group relative">
              <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover text-popover-foreground text-xs rounded-lg border border-border opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                {description}
              </div>
            </div>
          )}
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} saving={saving === settingKey} />
    </div>
  );

  const tabs = [
    { id: 'general', label: 'General Settings', icon: Settings },
    { id: 'notification', label: 'Notification Settings', icon: Bell },
    { id: 'email', label: 'Email Subscription', icon: Mail },
  ];

  return (
    <div className="p-4 lg:p-8 bg-background min-h-full">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Preference Settings</h1>
          <p className="text-muted-foreground mt-2">Customize your trading experience and notification preferences</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-8 p-1.5 bg-card rounded-xl border border-border">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-blue-500/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Loading preferences...</p>
            </div>
          </div>
        ) : (
          <>
            {/* General Settings Tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Currency Section */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-buy-light rounded-xl flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-buy" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Currency</h2>
                      <p className="text-xs text-muted-foreground">Set your preferred display currency</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <label className="block text-sm font-medium text-foreground/80 mb-3">
                      Equivalent Currency
                    </label>
                    <div className="relative dropdown-container" style={{ zIndex: showCurrencyDropdown ? 50 : 1 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowCurrencyDropdown(!showCurrencyDropdown);
                          setShowLanguageDropdown(false);
                          setShowPriceChangeDropdown(false);
                        }}
                        className="w-full max-w-md px-4 py-3.5 bg-muted border border-border rounded-xl text-left flex items-center justify-between hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{currencies.find(c => c.value === settings.equivalentCurrency)?.flag || '🌐'}</span>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">
                              {currencies.find(c => c.value === settings.equivalentCurrency)?.label || 'Select'}
                            </span>
                            <span className="text-muted-foreground text-sm">
                              {currencies.find(c => c.value === settings.equivalentCurrency)?.name}
                            </span>
                          </div>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${showCurrencyDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {showCurrencyDropdown && (
                        <div className="absolute top-full left-0 w-full max-w-md mt-2 bg-card border border-border rounded-xl shadow-2xl overflow-hidden" style={{ zIndex: 100 }}>
                          <div className="max-h-80 overflow-y-auto">
                            {currencies.map((currency, index) => (
                              <button
                                key={currency.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateSetting('equivalentCurrency', currency.value);
                                  setShowCurrencyDropdown(false);
                                }}
                                className={`w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-accent/80 transition-colors ${
                                  settings.equivalentCurrency === currency.value 
                                    ? 'bg-muted border-l-4 border-primary' 
                                    : 'border-l-4 border-transparent'
                                } ${index !== currencies.length - 1 ? 'border-b border-border' : ''}`}
                              >
                                <span className="text-2xl">{currency.flag}</span>
                                <div className="flex-1">
                                  <div className="font-semibold text-foreground">{currency.label}</div>
                                  <div className="text-sm text-muted-foreground">{currency.name}</div>
                                </div>
                                {settings.equivalentCurrency === currency.value && (
                                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                    <Check className="w-4 h-4 text-primary-foreground" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Trade Section */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Trade</h2>
                      <p className="text-xs text-muted-foreground">Configure your trading interface preferences</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    {/* Price Change Reference */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-foreground/80 mb-3">
                        Price Change Reference
                      </label>
                      <div className="relative dropdown-container" style={{ zIndex: showPriceChangeDropdown ? 50 : 1 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPriceChangeDropdown(!showPriceChangeDropdown);
                            setShowCurrencyDropdown(false);
                            setShowLanguageDropdown(false);
                          }}
                          className="w-full max-w-md px-4 py-3.5 bg-muted border border-border rounded-xl text-left flex items-center justify-between hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                        >
                          <span className="font-semibold text-foreground">
                            {priceChangeOptions.find(o => o.value === settings.priceChangeReference)?.label || 'Last 24 hours'}
                          </span>
                          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${showPriceChangeDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {showPriceChangeDropdown && (
                          <div className="absolute top-full left-0 w-full max-w-md mt-2 bg-card border border-border rounded-xl shadow-2xl overflow-hidden" style={{ zIndex: 100 }}>
                            {priceChangeOptions.map((option, index) => (
                              <button
                                key={option.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateSetting('priceChangeReference', option.value);
                                  setShowPriceChangeDropdown(false);
                                }}
                                className={`w-full px-4 py-3.5 text-left flex items-center justify-between hover:bg-accent/80 transition-colors ${
                                  settings.priceChangeReference === option.value 
                                    ? 'bg-muted border-l-4 border-primary' 
                                    : 'border-l-4 border-transparent'
                                } ${index !== priceChangeOptions.length - 1 ? 'border-b border-border' : ''}`}
                              >
                                <span className="font-semibold text-foreground">{option.label}</span>
                                {settings.priceChangeReference === option.value && (
                                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                    <Check className="w-4 h-4 text-primary-foreground" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Checkboxes */}
                    <div className="space-y-1 bg-muted rounded-xl p-2">
                      <Checkbox
                        checked={settings.promptConfirmationOrders}
                        onChange={(v) => updateSetting('promptConfirmationOrders', v)}
                        label="Prompt confirmation window for orders"
                        saving={saving === 'promptConfirmationOrders'}
                      />
                      <Checkbox
                        checked={settings.showConfirmationMobile}
                        onChange={(v) => updateSetting('showConfirmationMobile', v)}
                        label="Show Confirmation Window for Orders on Mobile Site"
                        saving={saving === 'showConfirmationMobile'}
                      />
                      <Checkbox
                        checked={settings.turnOnOrderbookAnimation}
                        onChange={(v) => updateSetting('turnOnOrderbookAnimation', v)}
                        label="Turn on orderbook animation"
                        saving={saving === 'turnOnOrderbookAnimation'}
                      />
                      <Checkbox
                        checked={settings.promptCancelAllConfirmation}
                        onChange={(v) => updateSetting('promptCancelAllConfirmation', v)}
                        label="Prompt 'Cancel All' confirmation window"
                        saving={saving === 'promptCancelAllConfirmation'}
                      />
                    </div>
                  </div>
                </div>

                {/* Deposit Section */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Deposit</h2>
                      <p className="text-xs text-muted-foreground">Configure automatic deposit transfers</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <RadioCard
                        checked={settings.autoTransferDeposit === 'funding'}
                        onChange={() => updateSetting('autoTransferDeposit', 'funding')}
                        label="Funding Account"
                        description="Auto-transfer deposits to Funding Account"
                      />
                      <RadioCard
                        checked={settings.autoTransferDeposit === 'unified'}
                        onChange={() => updateSetting('autoTransferDeposit', 'unified')}
                        label="Unified Trading Account"
                        description="Auto-transfer deposits to Unified Trading Account"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notification Settings Tab */}
            {activeTab === 'notification' && (
              <div className="space-y-6">
                {/* Language */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                      <Globe className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Language</h2>
                      <p className="text-xs text-muted-foreground">Choose your notification language</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="relative dropdown-container" style={{ zIndex: showLanguageDropdown ? 50 : 1 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowLanguageDropdown(!showLanguageDropdown);
                          setShowCurrencyDropdown(false);
                          setShowPriceChangeDropdown(false);
                        }}
                        className="w-full max-w-md px-4 py-3.5 bg-muted border border-border rounded-xl text-left flex items-center justify-between hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{languages.find(l => l.value === settings.notificationLanguage)?.flag || '🌐'}</span>
                          <span className="font-semibold text-foreground">
                            {languages.find(l => l.value === settings.notificationLanguage)?.label || 'English'}
                          </span>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${showLanguageDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {showLanguageDropdown && (
                        <div className="absolute top-full left-0 w-full max-w-md mt-2 bg-card border border-border rounded-xl shadow-2xl overflow-hidden" style={{ zIndex: 100 }}>
                          <div className="max-h-80 overflow-y-auto">
                            {languages.map((lang, index) => (
                              <button
                                key={lang.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateSetting('notificationLanguage', lang.value);
                                  setShowLanguageDropdown(false);
                                }}
                                className={`w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-accent/80 transition-colors ${
                                  settings.notificationLanguage === lang.value 
                                    ? 'bg-muted border-l-4 border-primary' 
                                    : 'border-l-4 border-transparent'
                                } ${index !== languages.length - 1 ? 'border-b border-border' : ''}`}
                              >
                                <span className="text-2xl">{lang.flag}</span>
                                <span className="flex-1 font-semibold text-foreground">{lang.label}</span>
                                {settings.notificationLanguage === lang.value && (
                                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                    <Check className="w-4 h-4 text-primary-foreground" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Browser Push Subscription */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                      <Bell className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Browser Push</h2>
                      <p className="text-xs text-muted-foreground">Get deposit, withdrawal, and security alerts even when the tab is closed</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    {!pushStatus.supported && (
                      <p className="text-sm text-muted-foreground">
                        This browser doesn't support web push notifications. Use a recent Chrome, Edge, Firefox, or Safari 16+.
                      </p>
                    )}
                    {pushStatus.supported && pushStatus.permission === 'denied' && (
                      <p className="text-sm text-destructive">
                        Notifications are blocked in your browser settings. Unblock them for this site and reload.
                      </p>
                    )}
                    {pushStatus.supported && pushStatus.permission !== 'denied' && (
                      <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2 text-sm">
                          <span className={`w-2 h-2 rounded-full ${pushStatus.subscribed ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                          <span className="text-muted-foreground">
                            Status: <span className="font-semibold text-foreground">{pushStatus.subscribed ? 'Enabled on this device' : 'Not enabled'}</span>
                          </span>
                        </div>
                        <div className="flex gap-2 ml-auto">
                          {!pushStatus.subscribed ? (
                            <button
                              onClick={handleEnablePush}
                              disabled={pushBusy}
                              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2"
                            >
                              {pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                              Enable notifications
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={handleTestPush}
                                disabled={pushBusy}
                                className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-semibold hover:bg-accent disabled:opacity-60"
                              >
                                Send test
                              </button>
                              <button
                                onClick={handleDisablePush}
                                disabled={pushBusy}
                                className="px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-sm font-semibold hover:bg-destructive/10 disabled:opacity-60"
                              >
                                Disable
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {pushNotice && (
                      <p className="text-sm text-muted-foreground border-t border-border pt-3">{pushNotice}</p>
                    )}
                  </div>
                </div>

                {/* Notification Toggles */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-warning-light rounded-xl flex items-center justify-center">
                      <Bell className="w-5 h-5 text-warning" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Push Notifications</h2>
                      <p className="text-xs text-muted-foreground">Manage your in-app notifications</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="space-y-1">
                      <SettingRow label="Latest Events" checked={settings.latestEvents} onChange={(v) => updateSetting('latestEvents', v)} settingKey="latestEvents" />
                      <SettingRow label="Announcement" checked={settings.announcement} onChange={(v) => updateSetting('announcement', v)} settingKey="announcement" />
                      <SettingRow label="Rewards" checked={settings.rewards} onChange={(v) => updateSetting('rewards', v)} settingKey="rewards" />
                      <SettingRow label="TradingView Alerts" checked={settings.tradingViewAlerts} onChange={(v) => updateSetting('tradingViewAlerts', v)} settingKey="tradingViewAlerts" />
                      <SettingRow label="News" checked={settings.news} onChange={(v) => updateSetting('news', v)} settingKey="news" />
                      <SettingRow label="Strategy Signal" checked={settings.strategySignal} onChange={(v) => updateSetting('strategySignal', v)} settingKey="strategySignal" />
                      <SettingRow label="Changes to Account Info" description="Get notified when your account settings change" checked={settings.changesToAccountInfo} onChange={(v) => updateSetting('changesToAccountInfo', v)} settingKey="changesToAccountInfo" />
                    </div>
                  </div>
                </div>

                {/* Telegram Notifications */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                      <MessageCircle className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Telegram Notifications</h2>
                      <p className="text-xs text-muted-foreground">Receive notifications via Telegram bot</p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="flex items-center justify-between p-4 bg-muted rounded-xl mb-4">
                      <div>
                        <span className="font-medium text-foreground">Enable Telegram Notifications</span>
                        <p className="text-xs text-muted-foreground mt-1">Connect your Telegram account to receive alerts</p>
                      </div>
                      <Toggle checked={settings.telegramNotification} onChange={(v) => updateSetting('telegramNotification', v)} saving={saving === 'telegramNotification'} />
                    </div>
                    
                    <div className={`space-y-1 transition-opacity ${settings.telegramNotification ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                      <Checkbox
                        checked={settings.p2pTradingOrderNotification}
                        onChange={(v) => updateSetting('p2pTradingOrderNotification', v)}
                        label="P2P Trading Order Notification"
                        saving={saving === 'p2pTradingOrderNotification'}
                      />
                      <Checkbox
                        checked={settings.p2pAppealOrderNotification}
                        onChange={(v) => updateSetting('p2pAppealOrderNotification', v)}
                        label="P2P Appeal Order Notification"
                        saving={saving === 'p2pAppealOrderNotification'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Email Subscription Tab */}
            {activeTab === 'email' && (
              <div className="space-y-6">
                {/* Events Reminders */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setEventsRemindersExpanded(!eventsRemindersExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                        <Bell className="w-5 h-5 text-primary" />
                      </div>
                      <div className="text-left">
                        <h2 className="text-lg font-semibold text-foreground">Events Reminders</h2>
                        <p className="text-xs text-muted-foreground">Airdrops, rewards, and event notifications</p>
                      </div>
                    </div>
                    <div className={`w-8 h-8 rounded-lg bg-accent flex items-center justify-center transition-transform ${eventsRemindersExpanded ? '' : '-rotate-180'}`}>
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </button>
                  
                  {eventsRemindersExpanded && (
                    <div className="px-6 pb-6">
                      <div className="space-y-1 bg-muted rounded-xl p-2">
                        <SettingRow label="Airdrop award alert" checked={settings.airdropAwardAlert} onChange={(v) => updateSetting('airdropAwardAlert', v)} settingKey="airdropAwardAlert" />
                        <SettingRow label="Commissions received" checked={settings.commissionsReceived} onChange={(v) => updateSetting('commissionsReceived', v)} settingKey="commissionsReceived" />
                        <SettingRow label="Event Reminder / New events" checked={settings.eventReminderNewEvents} onChange={(v) => updateSetting('eventReminderNewEvents', v)} settingKey="eventReminderNewEvents" />
                        <SettingRow label="Perks and rewards" checked={settings.perksAndRewards} onChange={(v) => updateSetting('perksAndRewards', v)} settingKey="perksAndRewards" />
                        <SettingRow label="Financial product listings" checked={settings.financialProductListings} onChange={(v) => updateSetting('financialProductListings', v)} settingKey="financialProductListings" />
                        <SettingRow label="Spot listings" checked={settings.spotListings} onChange={(v) => updateSetting('spotListings', v)} settingKey="spotListings" />
                        <SettingRow label="Trustpilot ratings" checked={settings.trustpilotRatings} onChange={(v) => updateSetting('trustpilotRatings', v)} settingKey="trustpilotRatings" />
                        <SettingRow label="Web3 events" checked={settings.web3Events} onChange={(v) => updateSetting('web3Events', v)} settingKey="web3Events" />
                      </div>
                    </div>
                  )}
                </div>

                {/* General Announcement */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setGeneralAnnouncementExpanded(!generalAnnouncementExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-warning-light rounded-xl flex items-center justify-center">
                        <Mail className="w-5 h-5 text-warning" />
                      </div>
                      <div className="text-left">
                        <h2 className="text-lg font-semibold text-foreground">General Announcement</h2>
                        <p className="text-xs text-muted-foreground">Platform updates and maintenance alerts</p>
                      </div>
                    </div>
                    <div className={`w-8 h-8 rounded-lg bg-accent flex items-center justify-center transition-transform ${generalAnnouncementExpanded ? '' : '-rotate-180'}`}>
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </button>
                  
                  {generalAnnouncementExpanded && (
                    <div className="px-6 pb-6">
                      <div className="space-y-1 bg-muted rounded-xl p-2">
                        <SettingRow label="System maintenance" checked={settings.systemMaintenance} onChange={(v) => updateSetting('systemMaintenance', v)} settingKey="systemMaintenance" />
                        <SettingRow label="Platform announcements" checked={settings.platformAnnouncements} onChange={(v) => updateSetting('platformAnnouncements', v)} settingKey="platformAnnouncements" />
                        <SettingRow label="New features" checked={settings.newFeatures} onChange={(v) => updateSetting('newFeatures', v)} settingKey="newFeatures" />
                        <SettingRow label="News and insights" checked={settings.newsAndInsights} onChange={(v) => updateSetting('newsAndInsights', v)} settingKey="newsAndInsights" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
