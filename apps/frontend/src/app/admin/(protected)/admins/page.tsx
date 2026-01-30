'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { UserCog, Loader2, Shield } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export default function AdminsPage() {
  const { accessToken } = useAdminAuthStore();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAdmins = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/admin/admins`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setAdmins(result.data.admins);
      }
    } catch (error) {
      console.error('Failed to fetch admins:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, [accessToken]);

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      super_admin: 'bg-red-500/20 text-red-400',
      admin: 'bg-blue-500/20 text-blue-400',
      finance_admin: 'bg-green-500/20 text-green-400',
      kyc_admin: 'bg-blue-500/20 text-blue-400',
      support_admin: 'bg-yellow-500/20 text-yellow-400',
    };
    return colors[role] || 'bg-gray-500/20 text-gray-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Users</h1>
        <p className="text-gray-400 text-sm mt-1">Manage admin accounts and roles</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Admins</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{admins.length}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Active</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{admins.filter(a => a.is_active).length}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-600 dark:text-red-400">Super Admins</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{admins.filter(a => a.role === 'super_admin').length}</p>
        </div>
      </div>

      {/* Admin List */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Admin Accounts</h2>
        </div>
        {admins.length === 0 ? (
          <div className="p-8 text-center">
            <UserCog className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No admin users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Admin</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Role</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Permissions</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id} className="border-b border-gray-200 dark:border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-500 rounded-full flex items-center justify-center">
                          <span className="text-gray-900 dark:text-white text-sm font-medium">
                            {admin.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'AD'}
                          </span>
                        </div>
                        <div>
                          <p className="text-gray-900 dark:text-white font-medium">{admin.name || 'Admin'}</p>
                          <p className="text-xs text-gray-500">{admin.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleBadge(admin.role)}`}>
                        {admin.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {admin.permissions?.slice(0, 3).map((perm, i) => (
                          <span key={i} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                            {perm}
                          </span>
                        ))}
                        {admin.permissions?.length > 3 && (
                          <span className="text-xs text-gray-500">+{admin.permissions.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${admin.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {admin.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
