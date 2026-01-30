'use client';

export default function UserTiersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Tiers</h1>
        <p className="text-gray-400 text-sm mt-1">Manage user tier levels and VIP status</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { name: 'Unverified', level: 0, users: 15420, color: 'gray' },
          { name: 'Basic', level: 1, users: 18650, color: 'blue' },
          { name: 'Advanced', level: 2, users: 8540, color: 'purple' },
          { name: 'VIP', level: 3, users: 2621, color: 'yellow' },
        ].map((tier) => (
          <div key={tier.level} className={`bg-${tier.color}-500/10 border border-${tier.color}-500/30 rounded-xl p-4`}>
            <div className="flex items-center justify-between">
              <span className={`text-${tier.color}-400 font-medium`}>Level {tier.level}</span>
              <span className={`px-2 py-1 rounded-full text-xs bg-${tier.color}-500/20 text-${tier.color}-400`}>{tier.name}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{tier.users.toLocaleString()}</p>
            <p className="text-xs text-gray-500">users</p>
          </div>
        ))}
      </div>
    </div>
  );
}
