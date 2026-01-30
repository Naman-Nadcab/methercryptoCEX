export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports & Analytics</h1>
      <p className="text-gray-500 dark:text-gray-400">Generate and view platform reports</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <a href="/admin/reports/financial" className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/50">
          <h3 className="font-semibold text-gray-900 dark:text-white">Financial Reports</h3>
          <p className="text-sm text-gray-400 mt-1">Revenue, P&L, fee breakdown</p>
        </a>
        <a href="/admin/reports/users" className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/50">
          <h3 className="font-semibold text-gray-900 dark:text-white">User Reports</h3>
          <p className="text-sm text-gray-400 mt-1">Growth, retention, activity</p>
        </a>
        <a href="/admin/reports/trading" className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/50">
          <h3 className="font-semibold text-gray-900 dark:text-white">Trading Reports</h3>
          <p className="text-sm text-gray-400 mt-1">Volume, pairs, liquidity</p>
        </a>
      </div>
    </div>
  );
}
