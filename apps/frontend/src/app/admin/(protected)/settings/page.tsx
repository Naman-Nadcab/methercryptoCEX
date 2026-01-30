export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">System Settings</h1>
      <p className="text-[10px] text-gray-500 dark:text-gray-400">Configure platform settings and features</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold text-xs text-gray-900 dark:text-white mb-4">General Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400">Platform Name</label>
              <input type="text" defaultValue="CryptoExchange" className="w-full mt-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-[10px] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400">Support Email</label>
              <input type="email" defaultValue="support@exchange.com" className="w-full mt-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-[10px] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold text-xs text-gray-900 dark:text-white mb-4">Feature Toggles</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600 dark:text-gray-400">Enable Registration</span>
              <button className="w-9 h-5 bg-green-500 rounded-full relative transition-colors">
                <span className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600 dark:text-gray-400">Enable Trading</span>
              <button className="w-9 h-5 bg-green-500 rounded-full relative transition-colors">
                <span className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600 dark:text-gray-400">Maintenance Mode</span>
              <button className="w-9 h-5 bg-gray-300 dark:bg-gray-600 rounded-full relative transition-colors">
                <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
