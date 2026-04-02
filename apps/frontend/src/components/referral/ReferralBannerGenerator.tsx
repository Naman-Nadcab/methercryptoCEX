'use client';

import { useCallback } from 'react';
import { Download, Twitter, MessageCircle, Square } from 'lucide-react';

export type BannerFormat = 'twitter' | 'telegram' | 'square';

const DIMENSIONS: Record<BannerFormat, { width: number; height: number }> = {
  twitter: { width: 1200, height: 628 },
  telegram: { width: 1080, height: 1080 },
  square: { width: 1080, height: 1080 },
};

export interface ReferralBannerGeneratorProps {
  referralCode: string;
  referralLink: string;
  appName?: string;
}

export function ReferralBannerGenerator({
  referralCode,
  referralLink,
  appName = 'Methereum',
}: ReferralBannerGeneratorProps) {
  const drawBanner = useCallback(
    (format: BannerFormat) => {
      const { width, height } = DIMENSIONS[format];
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#1e40af');
      gradient.addColorStop(0.5, '#1d4ed8');
      gradient.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.beginPath();
      ctx.arc(width * 0.8, height * 0.2, width * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(width * 0.15, height * 0.85, width * 0.15, 0, Math.PI * 2);
      ctx.fill();

      const scale = Math.min(width, height) / 400;
      ctx.fillStyle = '#3b82f6';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(scale * 24, scale * 24, scale * 48, scale * 48, scale * 8);
        ctx.fill();
      } else {
        ctx.fillRect(scale * 24, scale * 24, scale * 48, scale * 48);
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${scale * 28}px Arial`;
      ctx.fillText(appName.slice(0, 1), scale * 36, scale * 58);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${scale * 22}px Arial`;
      ctx.fillText(appName, scale * 82, scale * 52);

      ctx.font = `bold ${scale * 32}px Arial`;
      const title = 'Join & Earn Rewards!';
      ctx.fillText(title, scale * 24, scale * 120);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `${scale * 18}px Arial`;
      ctx.fillText('Sign up with my referral code and claim bonuses.', scale * 24, scale * 165);

      ctx.font = `${scale * 72}px Arial`;
      ctx.fillText('🏆', width / 2 - scale * 36, height * 0.45);

      const boxY = height * 0.72;
      ctx.fillStyle = 'rgba(30, 58, 138, 0.85)';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(scale * 24, boxY, width - scale * 48, scale * 120, scale * 12);
        ctx.fill();
      } else {
        ctx.fillRect(scale * 24, boxY, width - scale * 48, scale * 120);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${scale * 16}px Arial`;
      ctx.fillText('Referral Code', scale * 40, boxY + scale * 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${scale * 22}px Arial`;
      ctx.fillText(referralCode, scale * 40, boxY + scale * 58);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${scale * 12}px Arial`;
      const linkShort = referralLink.length > 45 ? referralLink.slice(0, 42) + '...' : referralLink;
      ctx.fillText(linkShort, scale * 40, boxY + scale * 88);

      return canvas.toDataURL('image/png');
    },
    [referralCode, referralLink, appName]
  );

  const handleDownload = (format: BannerFormat) => {
    const dataUrl = drawBanner(format);
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `referral-banner-${format}-${referralCode}.png`;
    link.href = dataUrl;
    link.click();
  };

  const options: { format: BannerFormat; label: string; icon: typeof Twitter }[] = [
    { format: 'twitter', label: 'Twitter', icon: Twitter },
    { format: 'telegram', label: 'Telegram', icon: MessageCircle },
    { format: 'square', label: 'Square', icon: Square },
  ];

  return (
    <div className="bg-card rounded-xl p-6 border border-border card-bybit">
      <h3 className="text-sm font-semibold text-foreground mb-1">Banner Generator</h3>
      <p className="text-xs text-muted-foreground mb-4">Download referral banners for social sharing</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {options.map(({ format, label, icon: Icon }) => (
          <button
            key={format}
            type="button"
            onClick={() => handleDownload(format)}
            className="flex flex-col items-center gap-3 p-4 rounded-xl border border-border hover:border-blue-400 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-card/[0.04] transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
              <Icon className="w-6 h-6 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground">
              {DIMENSIONS[format].width}×{DIMENSIONS[format].height}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Download className="w-3.5 h-3.5" />
              Download
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
