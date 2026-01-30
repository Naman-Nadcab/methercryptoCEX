'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Shield, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface KycStats {
  pending: number;
  under_review: number;
  approved: number;
  rejected: number;
  total: number;
}

interface KycApplication {
  id: string;
  user_id: string;
  kyc_level: number;
  status: string;
  legal_first_name: string;
  legal_last_name: string;
  email: string;
  phone: string;
  username: string;
  submitted_at: string;
  created_at: string;
}

export default function KYCPage() {
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<KycStats | null>(null);
  const [applications, setApplications] = useState<KycApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchKYC = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const response = await fetch(`${apiUrl}/api/v1/admin/kyc?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setStats(result.data.stats);
        setApplications(result.data.applications);
      }
    } catch (error) {
      console.error('Failed to fetch KYC:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKYC();
  }, [accessToken, statusFilter]);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { color: string; icon: React.ReactNode }> = {
      pending: { color: 'bg-yellow-500/20 text-yellow-400', icon: <Clock className="w-3 h-3" /> },
      under_review: { color: 'bg-blue-500/20 text-blue-400', icon: <Shield className="w-3 h-3" /> },
      approved: { color: 'bg-green-500/20 text-green-400', icon: <CheckCircle className="w-3 h-3" /> },
      rejected: { color: 'bg-red-500/20 text-red-400', icon: <XCircle className="w-3 h-3" /> },
    };
    return config[status] || config.pending;
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">KYC Management</h1>
        <p className="text-gray-400 text-sm mt-1">Manage user verification applications</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">Pending</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats?.pending || 0}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">Under Review</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{stats?.under_review || 0}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Approved</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats?.approved || 0}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-600 dark:text-red-400">Rejected</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats?.rejected || 0}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-500/10 border border-gray-200 dark:border-gray-500/30 rounded-xl p-4">
          <p className="text-sm text-gray-600 dark:text-gray-600 dark:text-gray-400">Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{stats?.total || 0}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="all">All Applications</option>
          <option value="pending">Pending</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Applications */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        {applications.length === 0 ? (
          <div className="p-8 text-center">
            <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No KYC applications found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Level</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const badge = getStatusBadge(app.status);
                  return (
                    <tr key={app.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-100 dark:hover:bg-gray-700/20">
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {app.legal_first_name && app.legal_last_name 
                              ? `${app.legal_first_name} ${app.legal_last_name}`
                              : app.email}
                          </p>
                          <p className="text-xs text-gray-500">{app.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
                          Level {app.kyc_level}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
                          {badge.icon}
                          {app.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {app.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : new Date(app.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
