'use client';

import { useState } from 'react';
import { ChevronDown, Calendar, FileText, HelpCircle, Info } from 'lucide-react';

type TabType = 'transaction' | 'order' | 'account';
type TimeRangeType = '7days' | '30days' | '90days' | 'customize';
type StatementType = 'monthly' | 'custom';

export default function DataExportPage() {
  const [activeTab, setActiveTab] = useState<TabType>('transaction');
  const [account, setAccount] = useState('');
  const [exportType, setExportType] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRangeType>('7days');
  const [startDate, setStartDate] = useState('2026-01-23');
  const [endDate, setEndDate] = useState('2026-01-29');
  const [includeLegalName, setIncludeLegalName] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [statementType, setStatementType] = useState<StatementType>('monthly');
  const [statementTypeDropdown, setStatementTypeDropdown] = useState('');
  const [statementTypeDropdownOpen, setStatementTypeDropdownOpen] = useState(false);

  const tabs = [
    { id: 'transaction' as TabType, label: 'Transaction Log' },
    { id: 'order' as TabType, label: 'Order History' },
    { id: 'account' as TabType, label: 'Account Statement' },
  ];

  const accountOptions = [
    { value: 'main', label: 'Main Account' },
    { value: 'sub1', label: 'Sub Account 1' },
    { value: 'sub2', label: 'Sub Account 2' },
  ];

  const typeOptions = [
    { value: 'deposit', label: 'Deposit' },
    { value: 'withdrawal', label: 'Withdrawal' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'trade', label: 'Trade' },
  ];

  const statementTypeOptions = [
    { value: 'all', label: 'All' },
    { value: 'spot', label: 'Spot' },
    { value: 'derivatives', label: 'Derivatives' },
    { value: 'funding', label: 'Funding' },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      {/* Page Title */}
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Data Export
      </h1>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-white" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Create Section */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Create
        </h2>

        {/* Instructions - Different for Account Statement */}
        {activeTab === 'account' ? (
          <div className="mb-6 text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              1. Generate and download statements from your Funding and Unified Trading Accounts. Note: This excludes Methereum Earn, Methereum structured products, Custodial Trading Subaccounts, MT4 Accounts, and bonuses.
            </p>
            <p>
              2. Daily data will be updated at 11:59:59PM UTC and will be available to download the following day. Statements can be generated for up to 12 months of historical data, with a limit of 50 exports per month. It takes approximately one (1) working day to generate a statement. The download link will be available for seven (7) days, so please download your statement promptly.
            </p>
          </div>
        ) : (
          <div className="mb-6 text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              1. Daily data is updated the following day and is available for export. The export period is limited to 12 months, with a maximum of 50 exports per month. The data export process will take about 1-3 days.
            </p>
            <p>
              2. The data export process will take about 1-3 days. Please check "My Export History" to download.
            </p>
          </div>
        )}

        {/* Form - Different for Account Statement */}
        {activeTab === 'account' ? (
          <div className="space-y-4">
            {/* Account */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300">Account</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setAccountDropdownOpen(!accountDropdownOpen);
                    setTypeDropdownOpen(false);
                    setStatementTypeDropdownOpen(false);
                  }}
                  className="w-56 flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                >
                  <span>{account ? accountOptions.find(a => a.value === account)?.label : 'Please select'}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {accountDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                    {accountOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setAccount(option.value);
                          setAccountDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Statement Type Radio */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300"></label>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="statementType"
                    checked={statementType === 'monthly'}
                    onChange={() => setStatementType('monthly')}
                    className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Monthly Statement</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="statementType"
                    checked={statementType === 'custom'}
                    onChange={() => setStatementType('custom')}
                    className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Custom Time</span>
                  <Info className="w-4 h-4 text-gray-400" />
                </label>
              </div>
            </div>

            {/* Type Dropdown */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300">Type</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setStatementTypeDropdownOpen(!statementTypeDropdownOpen);
                    setAccountDropdownOpen(false);
                    setTypeDropdownOpen(false);
                  }}
                  className="w-56 flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                >
                  <span>{statementTypeDropdown ? statementTypeOptions.find(t => t.value === statementTypeDropdown)?.label : 'Please select'}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {statementTypeDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                    {statementTypeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setStatementTypeDropdown(option.value);
                          setStatementTypeDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100 dark:border-gray-800 my-4"></div>

            {/* Export Button */}
            <div className="flex items-center gap-4">
              <button className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
                Export Now
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                <span className="text-orange-500">50</span> attempts left for this month.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Account */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300">Account</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setAccountDropdownOpen(!accountDropdownOpen);
                    setTypeDropdownOpen(false);
                  }}
                  className="w-56 flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                >
                  <span>{account ? accountOptions.find(a => a.value === account)?.label : 'Please select'}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {accountDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                    {accountOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setAccount(option.value);
                          setAccountDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Type */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300">Type</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setTypeDropdownOpen(!typeDropdownOpen);
                    setAccountDropdownOpen(false);
                  }}
                  className="w-56 flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                >
                  <span>{exportType ? typeOptions.find(t => t.value === exportType)?.label : 'Please select'}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {typeDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                    {typeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setExportType(option.value);
                          setTypeDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Time (UTC) */}
            <div className="flex items-start gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300 pt-2">Time (UTC)</label>
              <div className="space-y-3">
                {/* Radio buttons */}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timeRange"
                      checked={timeRange === '7days'}
                      onChange={() => setTimeRange('7days')}
                      className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Last 7 Days</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timeRange"
                      checked={timeRange === '30days'}
                      onChange={() => setTimeRange('30days')}
                      className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Last 30 Days</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timeRange"
                      checked={timeRange === '90days'}
                      onChange={() => setTimeRange('90days')}
                      className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Last 90 Days</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timeRange"
                      checked={timeRange === 'customize'}
                      onChange={() => setTimeRange('customize')}
                      className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Customize</span>
                  </label>
                </div>

                {/* Date range */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-32 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                      placeholder="Start date"
                    />
                  </div>
                  <span className="text-gray-400">→</span>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-32 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-400"
                      placeholder="End date"
                    />
                    <button className="ml-2 text-gray-400 hover:text-gray-600">
                      <Calendar className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Format */}
            <div className="flex items-center gap-4">
              <label className="w-28 text-sm text-gray-700 dark:text-gray-300">Format</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLegalName}
                  onChange={(e) => setIncludeLegalName(e.target.checked)}
                  className="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Legal Name</span>
              </label>
            </div>

            {/* Export Button */}
            <div className="flex items-center gap-4 pt-2">
              <div className="w-28"></div>
              <button className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
                Export Now
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                <span className="text-orange-500">50</span> attempts left for this month.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* My Exports Section */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">My Exports</h2>
          <a
            href="#"
            className="text-sm text-orange-500 hover:text-orange-600 hover:underline"
          >
            How to Extract Content From Your Data Export File
          </a>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  Statement
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  Date Range (UTC)
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  Submitted On
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Empty State */}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-20 h-20 mb-4">
            <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="15" y="10" width="50" height="60" rx="4" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2"/>
              <rect x="25" y="25" width="30" height="3" rx="1.5" fill="#D1D5DB"/>
              <rect x="25" y="33" width="20" height="3" rx="1.5" fill="#D1D5DB"/>
              <rect x="25" y="41" width="25" height="3" rx="1.5" fill="#D1D5DB"/>
              <circle cx="55" cy="55" r="15" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M50 55L54 59L62 51" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">No records found</p>
        </div>
      </div>

      {/* Floating Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-50">
        <HelpCircle className="w-6 h-6" />
      </button>
    </div>
  );
}
