'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAdminAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const handleLogin = async (data: LoginForm) => {
    setLoading(true);
    setError('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!result.success) {
        const msg = typeof result.error === 'string'
          ? result.error
          : (result.error?.message || result.message || 'Login failed');
        setError(msg);
        return;
      }

      // Store auth data
      login(result.data.admin, result.data.accessToken, result.data.refreshToken);

      // Redirect to dashboard
      router.push('/admin/dashboard');
    } catch (err) {
      setError(
        'Cannot reach the API. Start the backend (cd apps/backend && npm run dev) and ensure Redis is running (e.g. docker run -p 6379:6379 redis or npm run docker:up from repo root).'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-600 mb-4">
            <Shield className="w-8 h-8 text-gray-900 dark:text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
          <p className="text-gray-500 mt-1">Sign in to your admin account</p>
        </div>

        {/* Login Card */}
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl">
          <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-6">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  {...form.register('email')}
                  type="email"
                  placeholder="admin@example.com"
                  className="w-full bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-11 pr-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              {form.formState.errors.email && (
                <p className="mt-1 text-sm text-red-400">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  {...form.register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className="w-full bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-11 pr-11 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-300"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="mt-1 text-sm text-red-400">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-gray-900 dark:text-white font-semibold py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-600">
          Protected area. Authorized personnel only.
        </p>
      </div>
    </div>
  );
}
