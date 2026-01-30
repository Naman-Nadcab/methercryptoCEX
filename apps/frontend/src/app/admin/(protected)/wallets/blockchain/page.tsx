'use client';

export default function BlockchainStatusPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Blockchain Status</h1>
      <p className="text-gray-400 text-sm">Monitor blockchain nodes</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { chain: 'Ethereum', status: 'Synced', blocks: '19,234,567' },
          { chain: 'Bitcoin', status: 'Synced', blocks: '834,567' },
          { chain: 'BSC', status: 'Synced', blocks: '36,234,567' },
        ].map((node) => (
          <div key={node.chain} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900 dark:text-white">{node.chain}</span>
              <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">{node.status}</span>
            </div>
            <p className="text-sm text-gray-400 mt-2">Block: {node.blocks}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
