'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Users, Search, Loader2, CheckCircle, XCircle, ChevronRight } from 'lucide-react';

interface User {
  id: string;
  email: string;
  phone: string | null;
  username: string | null;
  status: string;
  email_verified: boolean;
  phone_verified: boolean;
  tier_level: number;
  kyc_status: string | null;
  kyc_level: number | null;
  created_at: string;
  last_login_at: string | null;
  total_balance: string;
}

export default function UsersPage() {
  const { accessToken } = useAdminAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Infinite scroll state
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const fetchUsers = async (reset = true) => {
    if (!accessToken) return;
    
    const currentPage = reset ? 1 : page;
    
    if (reset) {
      setLoading(true);
    }
    
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const response = await fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        const { users: newUsers, pagination } = result.data;
        
        if (reset) {
          setUsers(newUsers);
          setPage(2);
        } else {
          setUsers(prev => [...prev, ...newUsers]);
          setPage(prev => prev + 1);
        }
        
        setTotal(pagination.total);
        const totalLoaded = reset ? newUsers.length : users.length + newUsers.length;
        setHasMore(totalLoaded < pagination.total);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load more function
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const response = await fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        const { users: newUsers, pagination } = result.data;
        setUsers(prev => [...prev, ...newUsers]);
        setPage(prev => prev + 1);
        setTotal(pagination.total);
        setHasMore(users.length + newUsers.length < pagination.total);
      }
    } catch (error) {
      console.error('Failed to load more users:', error);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [page, hasMore, search, statusFilter, accessToken, apiUrl, users.length]);

  useEffect(() => {
    if (accessToken) {
      fetchUsers(true);
    }
  }, [accessToken]);

  // Fetch when filters change
  useEffect(() => {
    if (accessToken) {
      const debounce = setTimeout(() => {
        fetchUsers(true);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [statusFilter]);

  // Infinite scroll listener
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 150 && hasMore && !loadingMoreRef.current) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore, hasMore]);

  const handleSearch = () => {
    fetchUsers(true);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400',
      pending: 'bg-yellow-500/20 text-yellow-400',
      suspended: 'bg-orange-500/20 text-orange-400',
      banned: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  const getKycBadge = (kycStatus: string | null, kycLevel: number | null) => {
    if (!kycStatus) {
      return { label: 'Unverified', color: 'bg-gray-500/20 text-gray-400' };
    }
    
    const statusLabels: Record<string, string> = {
      'pending': 'Pending',
      'under_review': 'Under Review',
      'approved': 'Verified',
      'rejected': 'Rejected',
    };
    
    const statusColors: Record<string, string> = {
      'pending': 'bg-yellow-500/20 text-yellow-500',
      'under_review': 'bg-blue-500/20 text-blue-400',
      'approved': 'bg-green-500/20 text-green-500',
      'rejected': 'bg-red-500/20 text-red-400',
    };
    
    const levelLabels: Record<number, string> = {
      1: 'Basic',
      2: 'Advanced',
      3: 'Pro',
    };
    
    let label = statusLabels[kycStatus] || kycStatus;
    if (kycStatus === 'approved' && kycLevel) {
      label = levelLabels[kycLevel] || 'Verified';
    }
    
    return { 
      label, 
      color: statusColors[kycStatus] || 'bg-gray-500/20 text-gray-400' 
    };
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Total {total} users in database</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Users</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Loaded</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{users.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active</p>
          <p className="text-2xl font-bold text-green-500 mt-1">
            {users.filter(u => u.status === 'active').length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">KYC Verified</p>
          <p className="text-2xl font-bold text-blue-500 mt-1">
            {users.filter(u => u.kyc_status === 'approved').length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <input
            type="text"
            placeholder="Search by email, phone, username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white placeholder-gray-500 w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
        >
          Search
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden flex flex-col shadow-sm">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Users</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">{users.length} of {total} loaded</span>
        </div>
        
        {users.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No users found</p>
          </div>
        ) : (
          <div 
            ref={tableContainerRef}
            className="overflow-auto"
          >
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">KYC Level</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Verified</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Joined</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const kyc = getKycBadge(user.kyc_status, user.kyc_level);
                  return (
                    <tr key={user.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-100 dark:hover:bg-gray-700/20">
                      <td className="px-6 py-4">
                        <Link href={`/admin/users/${user.id}`} className="block group">
                          <p className="text-gray-900 dark:text-white font-medium group-hover:text-blue-500 dark:group-hover:text-blue-400">{user.email}</p>
                          <p className="text-xs text-gray-500">{user.phone || 'No phone'}</p>
                          {user.username && <p className="text-xs text-gray-500 dark:text-gray-400">@{user.username}</p>}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(user.status)}`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${kyc.color}`}>
                          {kyc.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {user.email_verified ? (
                            <span title="Email verified"><CheckCircle className="w-4 h-4 text-green-400" /></span>
                          ) : (
                            <span title="Email not verified"><XCircle className="w-4 h-4 text-gray-500" /></span>
                          )}
                          {user.phone_verified ? (
                            <span title="Phone verified"><CheckCircle className="w-4 h-4 text-green-400" /></span>
                          ) : (
                            <span title="Phone not verified"><XCircle className="w-4 h-4 text-gray-500" /></span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-400"
                        >
                          View
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Loading more indicator */}
            {loadingMore && (
              <div className="py-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading more...</span>
              </div>
            )}
            
            {/* End of list indicator */}
            {!hasMore && users.length > 0 && (
              <div className="py-4 text-center text-gray-500 text-sm">
                All {total} users loaded
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
