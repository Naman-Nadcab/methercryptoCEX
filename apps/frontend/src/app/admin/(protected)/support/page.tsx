export default function SupportPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support Tickets</h1>
      <p className="text-gray-500 dark:text-gray-400">Manage customer support tickets</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Tickets</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">45</p>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Pending Response</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">12</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Resolved Today</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">28</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Response Time</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">2.4h</p>
        </div>
      </div>
    </div>
  );
}
