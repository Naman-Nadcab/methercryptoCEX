'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { 
  Settings, Mail, MessageSquare, TrendingUp, Coins, Users, CreditCard,
  Plus, Edit2, Trash2, Loader2, Save, Check, X, AlertCircle, 
  Eye, EyeOff, TestTube, Zap, Globe
} from 'lucide-react';

interface ApiSetting {
  id: string;
  category: string;
  provider: string;
  name: string;
  api_key: string | null;
  api_secret: string | null;
  api_url: string | null;
  additional_config: Record<string, any>;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface TabConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
  category: string;
  providers: ProviderConfig[];
}

interface ProviderConfig {
  id: string;
  name: string;
  fields: FieldConfig[];
}

interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select' | 'checkbox';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  isConfig?: boolean; // If true, stored in additional_config
}

// Tab configurations
const tabs: TabConfig[] = [
  {
    id: 'email',
    label: 'Email',
    icon: <Mail className="w-4 h-4" />,
    category: 'email',
    providers: [
      {
        id: 'resend',
        name: 'Resend',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'password', placeholder: 're_xxxxxxxxxx', required: true },
          { key: 'from_email', label: 'From Email', type: 'text', placeholder: 'noreply@example.com', isConfig: true },
          { key: 'from_name', label: 'From Name', type: 'text', placeholder: 'My Exchange', isConfig: true },
        ],
      },
      {
        id: 'sendgrid',
        name: 'SendGrid',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'password', required: true },
          { key: 'from_email', label: 'From Email', type: 'text', isConfig: true },
          { key: 'from_name', label: 'From Name', type: 'text', isConfig: true },
        ],
      },
      {
        id: 'smtp',
        name: 'Custom SMTP',
        fields: [
          { key: 'api_url', label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com', required: true },
          { key: 'port', label: 'Port', type: 'text', placeholder: '587', isConfig: true },
          { key: 'api_key', label: 'Username', type: 'text' },
          { key: 'api_secret', label: 'Password', type: 'password' },
          { key: 'encryption', label: 'Encryption', type: 'select', options: [
            { value: 'tls', label: 'TLS' },
            { value: 'ssl', label: 'SSL' },
            { value: 'none', label: 'None' },
          ], isConfig: true },
          { key: 'from_email', label: 'From Email', type: 'text', isConfig: true },
        ],
      },
    ],
  },
  {
    id: 'sms',
    label: 'SMS',
    icon: <MessageSquare className="w-4 h-4" />,
    category: 'sms',
    providers: [
      {
        id: 'twilio',
        name: 'Twilio',
        fields: [
          { key: 'api_key', label: 'Account SID', type: 'text', required: true },
          { key: 'api_secret', label: 'Auth Token', type: 'password', required: true },
          { key: 'from_number', label: 'From Number', type: 'text', placeholder: '+1234567890', isConfig: true },
        ],
      },
      {
        id: 'msg91',
        name: 'MSG91',
        fields: [
          { key: 'api_key', label: 'Auth Key', type: 'password', required: true },
          { key: 'sender_id', label: 'Sender ID', type: 'text', isConfig: true },
          { key: 'template_id', label: 'Template ID', type: 'text', isConfig: true },
        ],
      },
      {
        id: 'nexmo',
        name: 'Vonage (Nexmo)',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'text', required: true },
          { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
          { key: 'from_number', label: 'From Number', type: 'text', isConfig: true },
        ],
      },
      {
        id: 'fast2sms',
        name: 'Fast2SMS (India)',
        fields: [
          { key: 'api_key', label: 'Authorization Key', type: 'password', required: true, placeholder: 'p0zL51Of3c8Ts...' },
          { key: 'sender_id', label: 'Sender ID', type: 'text', placeholder: 'INRXPE', isConfig: true },
          { key: 'message_id', label: 'Message/Template ID', type: 'text', placeholder: '181649', isConfig: true },
          { key: 'route', label: 'Route', type: 'select', options: [
            { value: 'dlt', label: 'DLT (Transactional)' },
            { value: 'otp', label: 'OTP' },
            { value: 'q', label: 'Quick SMS' },
          ], isConfig: true },
        ],
      },
    ],
  },
  {
    id: 'coinmarketcap',
    label: 'CoinMarketCap',
    icon: <TrendingUp className="w-4 h-4" />,
    category: 'market_data',
    providers: [
      {
        id: 'coinmarketcap',
        name: 'CoinMarketCap',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'password', required: true },
          { key: 'api_url', label: 'API URL', type: 'url', placeholder: 'https://pro-api.coinmarketcap.com' },
          { key: 'plan', label: 'Plan', type: 'select', options: [
            { value: 'basic', label: 'Basic (Free)' },
            { value: 'hobbyist', label: 'Hobbyist' },
            { value: 'startup', label: 'Startup' },
            { value: 'standard', label: 'Standard' },
            { value: 'professional', label: 'Professional' },
            { value: 'enterprise', label: 'Enterprise' },
          ], isConfig: true },
        ],
      },
    ],
  },
  {
    id: 'coingecko',
    label: 'CoinGecko',
    icon: <Coins className="w-4 h-4" />,
    category: 'market_data',
    providers: [
      {
        id: 'coingecko',
        name: 'CoinGecko',
        fields: [
          { key: 'api_key', label: 'API Key (Pro)', type: 'password', placeholder: 'Leave empty for free tier' },
          { key: 'api_url', label: 'API URL', type: 'url', placeholder: 'https://api.coingecko.com/api/v3' },
          { key: 'is_pro', label: 'Pro Account', type: 'checkbox', isConfig: true },
        ],
      },
    ],
  },
  {
    id: 'social',
    label: 'Social Login',
    icon: <Users className="w-4 h-4" />,
    category: 'social_login',
    providers: [
      {
        id: 'google',
        name: 'Google',
        fields: [
          { key: 'api_key', label: 'Client ID', type: 'text', required: true, placeholder: 'xxxxx.apps.googleusercontent.com' },
          { key: 'api_secret', label: 'Client Secret', type: 'password', required: true },
          { key: 'callback_url', label: 'Callback URL', type: 'url', placeholder: 'http://localhost:3000/auth/callback/google', isConfig: true },
        ],
      },
      {
        id: 'apple',
        name: 'Apple',
        fields: [
          { key: 'api_key', label: 'Service ID', type: 'text', required: true },
          { key: 'api_secret', label: 'Key ID', type: 'text', required: true },
          { key: 'team_id', label: 'Team ID', type: 'text', isConfig: true },
          { key: 'private_key', label: 'Private Key', type: 'password', isConfig: true },
          { key: 'callback_url', label: 'Callback URL', type: 'url', placeholder: 'http://localhost:3000/auth/callback/apple', isConfig: true },
        ],
      },
      {
        id: 'telegram',
        name: 'Telegram',
        fields: [
          { key: 'api_key', label: 'Bot Token', type: 'password', required: true, placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz' },
          { key: 'bot_username', label: 'Bot Username', type: 'text', placeholder: 'YourBotName', isConfig: true },
        ],
      },
      {
        id: 'facebook',
        name: 'Facebook',
        fields: [
          { key: 'api_key', label: 'App ID', type: 'text', required: true },
          { key: 'api_secret', label: 'App Secret', type: 'password', required: true },
          { key: 'callback_url', label: 'Callback URL', type: 'url', isConfig: true },
        ],
      },
      {
        id: 'twitter',
        name: 'Twitter/X',
        fields: [
          { key: 'api_key', label: 'API Key', type: 'text', required: true },
          { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
          { key: 'callback_url', label: 'Callback URL', type: 'url', isConfig: true },
        ],
      },
    ],
  },
  {
    id: 'payment',
    label: 'Payment Gateway',
    icon: <CreditCard className="w-4 h-4" />,
    category: 'payment',
    providers: [
      {
        id: 'stripe',
        name: 'Stripe',
        fields: [
          { key: 'api_key', label: 'Publishable Key', type: 'text', required: true },
          { key: 'api_secret', label: 'Secret Key', type: 'password', required: true },
          { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', isConfig: true },
          { key: 'is_live', label: 'Live Mode', type: 'checkbox', isConfig: true },
        ],
      },
      {
        id: 'razorpay',
        name: 'Razorpay',
        fields: [
          { key: 'api_key', label: 'Key ID', type: 'text', required: true },
          { key: 'api_secret', label: 'Key Secret', type: 'password', required: true },
          { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', isConfig: true },
          { key: 'is_live', label: 'Live Mode', type: 'checkbox', isConfig: true },
        ],
      },
      {
        id: 'paypal',
        name: 'PayPal',
        fields: [
          { key: 'api_key', label: 'Client ID', type: 'text', required: true },
          { key: 'api_secret', label: 'Client Secret', type: 'password', required: true },
          { key: 'is_live', label: 'Live Mode', type: 'checkbox', isConfig: true },
        ],
      },
      {
        id: 'paytm',
        name: 'Paytm',
        fields: [
          { key: 'api_key', label: 'Merchant ID', type: 'text', required: true },
          { key: 'api_secret', label: 'Merchant Key', type: 'password', required: true },
          { key: 'website', label: 'Website', type: 'text', isConfig: true },
          { key: 'is_live', label: 'Live Mode', type: 'checkbox', isConfig: true },
        ],
      },
    ],
  },
];

export default function ApiSettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [settings, setSettings] = useState<ApiSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const currentTab = tabs.find(t => t.id === activeTab)!;

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchSettings = async () => {
    if (!accessToken) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/api?category=${currentTab.category}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setSettings(result.data.settings);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [accessToken, activeTab]);

  const getSettingForProvider = (providerId: string): ApiSetting | undefined => {
    return settings.find(s => s.provider === providerId);
  };

  const startEditing = (provider: ProviderConfig) => {
    const existing = getSettingForProvider(provider.id);
    const data: Record<string, any> = {
      provider: provider.id,
      name: provider.name,
      is_active: existing?.is_active ?? false,
      is_default: existing?.is_default ?? false,
    };

    provider.fields.forEach(field => {
      if (field.isConfig) {
        data[field.key] = existing?.additional_config?.[field.key] ?? (field.type === 'checkbox' ? false : '');
      } else {
        data[field.key] = existing?.[field.key as keyof ApiSetting] ?? '';
      }
    });

    setFormData(data);
    setEditingProvider(provider.id);
  };

  const saveSettings = async (provider: ProviderConfig) => {
    setSaving(true);
    try {
      const additional_config: Record<string, any> = {};
      provider.fields.forEach(field => {
        if (field.isConfig && formData[field.key] !== undefined) {
          additional_config[field.key] = formData[field.key];
        }
      });

      const payload = {
        category: currentTab.category,
        provider: provider.id,
        name: provider.name,
        api_key: formData.api_key || null,
        api_secret: formData.api_secret || null,
        api_url: formData.api_url || null,
        additional_config,
        is_active: formData.is_active ?? false,
        is_default: formData.is_default ?? false,
      };

      const response = await fetch(`${apiUrl}/api/v1/admin/settings/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (result.success) {
        showToast('Settings saved successfully!');
        setEditingProvider(null);
        fetchSettings();
      } else {
        showToast(result.error?.message || 'Failed to save', 'error');
      }
    } catch (error) {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (settingId: string) => {
    setTesting(settingId);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/api/${settingId}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        showToast('Connection test successful!');
      } else {
        showToast(result.error?.message || 'Connection test failed', 'error');
      }
    } catch (error) {
      showToast('Connection test failed', 'error');
    } finally {
      setTesting(null);
    }
  };

  const toggleActive = async (settingId: string) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/api/${settingId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setSettings(prev => prev.map(s => 
          s.id === settingId ? { ...s, is_active: result.data.setting.is_active } : s
        ));
      }
    } catch (error) {
      showToast('Failed to toggle status', 'error');
    }
  };

  const deleteSetting = async (settingId: string) => {
    if (!confirm('Are you sure you want to delete this API configuration?')) return;
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/api/${settingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        showToast('Setting deleted');
        fetchSettings();
      } else {
        showToast(result.error?.message || 'Failed to delete', 'error');
      }
    } catch (error) {
      showToast('Failed to delete setting', 'error');
    }
  };

  const togglePasswordVisibility = (key: string) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const ToggleSwitch = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-500" />
            API Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-[10px] mt-1">
            Configure external API integrations
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setEditingProvider(null);
              }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-gray-100 dark:bg-gray-700/50 border-b-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30'
              }`}
            >
              {tab.icon}
              {tab.label}
              {settings.filter(s => s.provider && currentTab.providers.some(p => p.id === s.provider) && s.is_active).length > 0 && 
               tab.id === activeTab && (
                <span className="w-2 h-2 bg-green-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Provider Cards */}
              {currentTab.providers.map(provider => {
                const existing = getSettingForProvider(provider.id);
                const isEditing = editingProvider === provider.id;

                return (
                  <div
                    key={provider.id}
                    className={`border rounded-xl overflow-hidden ${
                      existing?.is_active ? 'border-green-500/50 bg-green-50 dark:bg-green-500/5' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30'
                    }`}
                  >
                    {/* Provider Header */}
                    <div className="px-4 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700/50">
                      <div className="flex items-center gap-3">
                        <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <h3 className="font-semibold text-xs text-gray-900 dark:text-white">{provider.name}</h3>
                        {existing?.is_default && (
                          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] rounded">
                            Default
                          </span>
                        )}
                        {existing?.is_active && (
                          <span className="px-2 py-0.5 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {existing && !isEditing && (
                          <>
                            <button
                              onClick={() => testConnection(existing.id)}
                              disabled={testing === existing.id}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white transition-colors"
                              title="Test Connection"
                            >
                              {testing === existing.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <TestTube className="w-4 h-4" />
                              )}
                            </button>
                            <ToggleSwitch
                              enabled={existing.is_active}
                              onToggle={() => toggleActive(existing.id)}
                            />
                          </>
                        )}
                        <button
                          onClick={() => isEditing ? setEditingProvider(null) : startEditing(provider)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isEditing 
                              ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30' 
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white'
                          }`}
                        >
                          {isEditing ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                        </button>
                        {existing && !isEditing && (
                          <button
                            onClick={() => deleteSetting(existing.id)}
                            className="p-1.5 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Edit Form */}
                    {isEditing && (
                      <div className="p-4 space-y-4 bg-white dark:bg-gray-800/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {provider.fields.map(field => (
                            <div key={field.key} className={field.type === 'checkbox' ? 'md:col-span-2' : ''}>
                              {field.type === 'checkbox' ? (
                                <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={formData[field.key] || false}
                                    onChange={e => setFormData({ ...formData, [field.key]: e.target.checked })}
                                    className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-blue-600"
                                  />
                                  <span className="text-[10px] text-gray-700 dark:text-gray-700 dark:text-gray-300">{field.label}</span>
                                </label>
                              ) : (
                                <>
                                  <label className="block text-[10px] text-gray-600 dark:text-gray-400 mb-1">
                                    {field.label}
                                    {field.required && <span className="text-red-500 dark:text-red-400">*</span>}
                                  </label>
                                  {field.type === 'select' ? (
                                    <select
                                      value={formData[field.key] || ''}
                                      onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    >
                                      <option value="">Select...</option>
                                      {field.options?.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="relative">
                                      <input
                                        type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                                        value={formData[field.key] || ''}
                                        onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                                        placeholder={field.placeholder}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] text-gray-900 dark:text-white pr-10 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                      {field.type === 'password' && (
                                        <button
                                          type="button"
                                          onClick={() => togglePasswordVisibility(field.key)}
                                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white"
                                        >
                                          {showPasswords[field.key] ? (
                                            <EyeOff className="w-4 h-4" />
                                          ) : (
                                            <Eye className="w-4 h-4" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Toggles */}
                        <div className="flex items-center gap-6 pt-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.is_active || false}
                              onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                              className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-blue-600"
                            />
                            <span className="text-[10px] text-gray-700 dark:text-gray-700 dark:text-gray-300">Active</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.is_default || false}
                              onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
                              className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-blue-600"
                            />
                            <span className="text-[10px] text-gray-700 dark:text-gray-700 dark:text-gray-300">Set as Default</span>
                          </label>
                        </div>

                        {/* Save Button */}
                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <button
                            onClick={() => setEditingProvider(null)}
                            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveSettings(provider)}
                            disabled={saving}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-xs"
                          >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Saved Config Display (when not editing) */}
                    {existing && !isEditing && (
                      <div className="px-4 py-3 bg-white dark:bg-transparent">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[10px]">
                          {existing.api_key && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-500">API Key:</span>
                              <span className="ml-2 text-gray-700 dark:text-gray-700 dark:text-gray-300">••••••••</span>
                            </div>
                          )}
                          {existing.api_url && (
                            <div className="col-span-2">
                              <span className="text-gray-500 dark:text-gray-500">URL:</span>
                              <span className="ml-2 text-gray-700 dark:text-gray-300 break-all">{existing.api_url}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-gray-500 dark:text-gray-500">Updated:</span>
                            <span className="ml-2 text-gray-700 dark:text-gray-700 dark:text-gray-300">
                              {new Date(existing.updated_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Not Configured Message */}
                    {!existing && !isEditing && (
                      <div className="px-4 py-4 text-center bg-white dark:bg-transparent">
                        <p className="text-gray-500 dark:text-gray-500 text-[10px]">Not configured</p>
                        <button
                          onClick={() => startEditing(provider)}
                          className="mt-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs flex items-center gap-1 mx-auto"
                        >
                          <Plus className="w-4 h-4" />
                          Configure {provider.name}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Saved Settings Table */}
      {settings.length > 0 && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xs font-semibold text-gray-900 dark:text-white">
              Saved {currentTab.label} Configurations
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Provider</th>
                  <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">API Key</th>
                  <th className="px-4 py-2 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Default</th>
                  <th className="px-4 py-2 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Updated</th>
                  <th className="px-4 py-2 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-200 dark:divide-gray-700">
                {settings.map(setting => (
                  <tr key={setting.id} className="hover:bg-gray-50 dark:hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        <span className="font-medium text-[10px] text-gray-900 dark:text-white">{setting.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-[10px]">
                      {setting.api_key ? '••••••••' + setting.api_key.slice(-4) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {setting.is_default ? (
                        <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 mx-auto" />
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        setting.is_active 
                          ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' 
                          : 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400'
                      }`}>
                        {setting.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-500 dark:text-gray-400">
                      {new Date(setting.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            const provider = currentTab.providers.find(p => p.id === setting.provider);
                            if (provider) startEditing(provider);
                          }}
                          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteSetting(setting.id)}
                          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-500/20 rounded text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
