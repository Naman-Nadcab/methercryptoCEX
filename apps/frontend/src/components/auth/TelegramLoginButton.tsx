'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { handleTelegramCallback } from '@/lib/oauth';
import { useAuthStore } from '@/store/auth';

interface TelegramLoginButtonProps {
  botName?: string;
  onError?: (error: string) => void;
}

declare global {
  interface Window {
    TelegramLoginWidget: {
      dataOnauth: (user: TelegramUser) => void;
    };
    onTelegramAuth: (user: TelegramUser) => void;
  }
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export default function TelegramLoginButton({ 
  botName = 'Methereumbot',
  onError 
}: TelegramLoginButtonProps) {
  const router = useRouter();
  const { setUser, setTokens } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [showWidget, setShowWidget] = useState(false);

  useEffect(() => {
    // Define the callback function
    window.onTelegramAuth = async (user: TelegramUser) => {
      setLoading(true);
      try {
        const result = await handleTelegramCallback(user);
        
        if (result.success && result.data) {
          const userData = {
            id: result.data.user.id,
            email: result.data.user.email,
            phone: result.data.user.phone,
            username: result.data.user.username,
            status: result.data.user.status as 'pending' | 'active' | 'suspended' | 'banned' | 'deleted',
            emailVerified: result.data.user.emailVerified,
            phoneVerified: result.data.user.phoneVerified,
            tierLevel: result.data.user.tierLevel,
          };
          setUser(userData);
          setTokens(result.data.accessToken, result.data.refreshToken);
          router.push('/dashboard');
        } else {
          onError?.(result.error?.message || 'Telegram login failed');
        }
      } catch (err) {
        onError?.('An error occurred during Telegram login');
      } finally {
        setLoading(false);
        setShowWidget(false);
      }
    };

    return () => {
      delete (window as any).onTelegramAuth;
    };
  }, [router, setUser, setTokens, onError]);

  useEffect(() => {
    if (showWidget && containerRef.current) {
      // Clear previous widget
      containerRef.current.innerHTML = '';
      
      // Create and append the Telegram script
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.setAttribute('data-telegram-login', botName);
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-radius', '8');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      script.setAttribute('data-request-access', 'write');
      script.async = true;
      
      containerRef.current.appendChild(script);
    }
  }, [showWidget, botName]);

  const handleClick = () => {
    setShowWidget(true);
  };

  if (loading) {
    return (
      <div className="w-14 h-14 flex items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <Loader2 className="w-5 h-5 animate-spin text-[#0088cc]" />
      </div>
    );
  }

  if (showWidget) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowWidget(false)}>
        <div 
          className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-center">
            Log in with Telegram
          </h3>
          <div ref={containerRef} className="flex justify-center min-h-[44px]" />
          <button
            onClick={() => setShowWidget(false)}
            className="mt-4 w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-14 h-14 flex items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 hover:border-purple-500 dark:hover:border-purple-500 bg-white dark:bg-gray-800 transition-colors"
    >
      <svg className="w-6 h-6 text-[#0088cc]" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    </button>
  );
}
