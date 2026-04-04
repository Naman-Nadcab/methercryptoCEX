'use client';

import { useState } from 'react';
import { ChevronDown, FileText, Download, Clock, Check, FileSpreadsheet, History, Info } from 'lucide-react';

type TabType = 'transaction' | 'order' | 'account';
type TimeRangeType = '7days' | '30days' | '90days' | 'customize';
type StatementType = 'monthly' | 'custom';

export default function DataExportPage() {
  const [activeTab, setActiveTab] = useState<TabType>('transaction');
  const [account, setAccount] = useState('');
  const [exportType, setExportType] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRangeType>('7days');
  const [startDate, setStartDate] = useState('2026-01-23');
  const [endDate, setEndDate] = useState('2026-01-30');
  const [includeLegalName, setIncludeLegalName] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [statementType, setStatementType] = useState<StatementType>('monthly');
  const [statementTypeDropdown, setStatementTypeDropdown] = useState('');
  const [statementTypeDropdownOpen, setStatementTypeDropdownOpen] = useState(false);

  const tabs = [
    { id: 'transaction' as TabType, label: 'Transaction Log', icon: FileText },
    { id: 'order' as TabType, label: 'Order History', icon: History },
    { id: 'account' as TabType, label: 'Account Statement', icon: FileSpreadsheet },
  ];

  const accountOptions = [
    { value: 'main', label: 'Main Account' },
    { value: 'funding', label: 'Funding Account' },
    { value: 'trading', label: 'Trading Account' },
  ];

  const typeOptions = [
    { value: 'deposit', label: 'Deposit' },
    { value: 'withdrawal', label: 'Withdrawal' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'trade', label: 'Trade' },
    { value: 'all', label: 'All Types' },
  ];

  const statementTypeOptions = [
    { value: 'all', label: 'All' },
    { value: 'spot', label: 'Spot' },
    { value: 'funding', label: 'Funding' },
  ];

  const handleExport = () => {
    alert('Export functionality is coming soon.');
  };

  const Dropdown = ({ 
    label, 
    value, 
    options, 
    isOpen, 
    onToggle, 
    onSelect 
  }: { 
    label: string;
    value: string;
    options: { value: string; label: string }[];
    isOpen: boolean;
    onToggle: () => void;
    onSelect: (value: string) => void;
  }) => (
    <div className="relative dropdown-container">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="w-full max-w-xs px-4 py-3.5 bg-muted border border-border rounded-xl text-left flex items-center justify-between hover:border-primary transition-colors"
      >
        <span className={value ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          {value ? options.find(o => o.value === value)?.label : 'Please select'}
        </span>
        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 right-0 max-w-xs mt-2 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(option.value);
              }}
              className={`w-full px-4 py-3 text-left flex items-center justify-between hover:bg-accent transition-colors ${
                value === option.value ? 'bg-muted' : ''
              }`}
            >
              <span className="font-medium text-foreground">{option.label}</span>
              {value === option.value && <Check className="w-5 h-5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const RadioCard = ({ checked, onChange, label, description }: {
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
  }) => (
    <button
      onClick={onChange}
      className={`flex-1 p-4 rounded-xl border-2 text-left transition-all ${
        checked 
          ? 'border-primary bg-muted' 
          : 'border-border hover:border-border'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
          checked ? 'border-primary' : 'border-border'
        }`}>
          {checked && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div>
          <span className={`font-medium ${checked ? 'text-primary' : 'text-foreground'}`}>{label}</span>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
    </button>
  );

  return (
    <div className="p-4 lg:p-8 bg-background min-h-full" onClick={(e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setAccountDropdownOpen(false);
        setTypeDropdownOpen(false);
        setStatementTypeDropdownOpen(false);
      }
    }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Data Export</h1>
          <p className="text-muted-foreground mt-2">Export your transaction history, orders, and account statements</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-8 p-1.5 bg-card rounded-xl border border-border w-fit">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-blue-500/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Create Export Section */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-border flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Create Export</h2>
              <p className="text-sm text-muted-foreground">Generate a new data export file</p>
            </div>
          </div>

          <div className="p-6">
            {/* Info Box */}
            <div className="p-4 bg-muted border border-border rounded-xl mb-6">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground space-y-1">
                  {activeTab === 'account' ? (
                    <>
                      <p>Generate and download statements from your Funding and Unified Trading Accounts.</p>
                      <p>Statements can be generated for up to 12 months of historical data, with a limit of 50 exports per month.</p>
                    </>
                  ) : (
                    <>
                      <p>Daily data is updated the following day and is available for export.</p>
                      <p>The export period is limited to 12 months, with a maximum of 50 exports per month.</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Account Selection */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-3">Account</label>
                <Dropdown
                  label="Account"
                  value={account}
                  options={accountOptions}
                  isOpen={accountDropdownOpen}
                  onToggle={() => {
                    setAccountDropdownOpen(!accountDropdownOpen);
                    setTypeDropdownOpen(false);
                    setStatementTypeDropdownOpen(false);
                  }}
                  onSelect={(val) => {
                    setAccount(val);
                    setAccountDropdownOpen(false);
                  }}
                />
              </div>

              {/* Account Statement Specific Options */}
              {activeTab === 'account' && (
                <>
                  {/* Statement Type Radio */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-3">Statement Period</label>
                    <div className="flex gap-4 max-w-lg">
                      <RadioCard
                        checked={statementType === 'monthly'}
                        onChange={() => setStatementType('monthly')}
                        label="Monthly Statement"
                      />
                      <RadioCard
                        checked={statementType === 'custom'}
                        onChange={() => setStatementType('custom')}
                        label="Custom Time"
                      />
                    </div>
                  </div>

                  {/* Type Dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-3">Type</label>
                    <Dropdown
                      label="Type"
                      value={statementTypeDropdown}
                      options={statementTypeOptions}
                      isOpen={statementTypeDropdownOpen}
                      onToggle={() => {
                        setStatementTypeDropdownOpen(!statementTypeDropdownOpen);
                        setAccountDropdownOpen(false);
                        setTypeDropdownOpen(false);
                      }}
                      onSelect={(val) => {
                        setStatementTypeDropdown(val);
                        setStatementTypeDropdownOpen(false);
                      }}
                    />
                  </div>
                </>
              )}

              {/* Transaction/Order Options */}
              {activeTab !== 'account' && (
                <>
                  {/* Type */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-3">Type</label>
                    <Dropdown
                      label="Type"
                      value={exportType}
                      options={typeOptions}
                      isOpen={typeDropdownOpen}
                      onToggle={() => {
                        setTypeDropdownOpen(!typeDropdownOpen);
                        setAccountDropdownOpen(false);
                        setStatementTypeDropdownOpen(false);
                      }}
                      onSelect={(val) => {
                        setExportType(val);
                        setTypeDropdownOpen(false);
                      }}
                    />
                  </div>

                  {/* Time Range */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-3">Time Range (UTC)</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 max-w-xl">
                      {[
                        { value: '7days', label: 'Last 7 Days' },
                        { value: '30days', label: 'Last 30 Days' },
                        { value: '90days', label: 'Last 90 Days' },
                        { value: 'customize', label: 'Custom' },
                      ].map(option => (
                        <button
                          key={option.value}
                          onClick={() => setTimeRange(option.value as TimeRangeType)}
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                            timeRange === option.value
                              ? 'bg-primary text-primary-foreground shadow-lg shadow-blue-500/25'
                              : 'bg-accent text-foreground/80 hover:bg-accent'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {/* Date Range Inputs */}
                    {timeRange === 'customize' && (
                      <div className="flex items-center gap-3 max-w-md">
                        <div className="relative flex-1">
                          <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground outline-none focus:border-primary"
                          />
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <div className="relative flex-1">
                          <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Format Options */}
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-3">Options</label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div
                        onClick={() => setIncludeLegalName(!includeLegalName)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all ${
                          includeLegalName ? 'bg-primary border-primary' : 'border-border'
                        }`}
                      >
                        {includeLegalName && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <span className="text-sm text-foreground/80">Include Legal Name in export</span>
                    </label>
                  </div>
                </>
              )}

              {/* Export Button */}
              <div className="pt-4 border-t border-border flex items-center gap-4">
                <button
                  onClick={handleExport}
                  className="px-8 py-3.5 bg-primary hover:bg-primary/85 text-primary-foreground font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25 flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Export Now
                  <span className="ml-1 px-2 py-0.5 bg-primary-foreground/20 text-[10px] font-bold rounded-md uppercase">Coming Soon</span>
                </button>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span><span className="font-semibold text-primary">50</span> exports remaining this month</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* My Exports Section */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-buy-light rounded-xl flex items-center justify-center">
                <History className="w-5 h-5 text-buy" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">My Exports</h2>
                <p className="text-sm text-muted-foreground">Download your previously generated exports</p>
              </div>
            </div>
            <button className="text-sm text-primary hover:text-primary/85 font-medium">
              How to Extract Content →
            </button>
          </div>

          {/* Table Header */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Statement</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Range</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Submitted</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          {/* Empty State */}
          <div className="py-20">
            <div className="flex flex-col items-center justify-center">
              <div className="w-24 h-24 bg-accent rounded-full flex items-center justify-center mb-6">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <rect x="8" y="6" width="32" height="36" rx="4" className="fill-muted"/>
                  <rect x="14" y="14" width="20" height="3" rx="1.5" className="fill-border"/>
                  <rect x="14" y="20" width="14" height="3" rx="1.5" className="fill-border"/>
                  <rect x="14" y="26" width="17" height="3" rx="1.5" className="fill-border"/>
                  <circle cx="36" cy="36" r="10" className="fill-primary/15"/>
                  <path d="M32 36l3 3 5-5" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No Exports Yet</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Create your first export to download your transaction history, orders, or account statements.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
