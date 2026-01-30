export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
      <p className="text-gray-500 dark:text-gray-400">Manage system announcements and user notifications</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Sent Today</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">12,450</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Delivery Rate</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">98.5%</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Failed</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">187</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active Announcements</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">3</p>
        </div>
      </div>
    </div>
  );
}
