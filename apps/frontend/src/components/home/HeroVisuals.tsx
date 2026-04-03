'use client';

import Image from 'next/image';

const ORBS = [
  { size: 400, x: '10%', y: '20%', delay: '0s', blur: 120 },
  { size: 350, x: '70%', y: '10%', delay: '1s', blur: 100 },
  { size: 300, x: '50%', y: '60%', delay: '2s', blur: 80 },
];

export function HeroVisuals() {
  return (
    <>
      {/* Animated gradient orbs */}
      {ORBS.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none animate-[home-glow-pulse_8s_ease-in-out_infinite]"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 70%)',
            filter: `blur(${orb.blur}px)`,
            animationDelay: orb.delay,
          }}
        />
      ))}

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating currency icons - right side */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden xl:block w-80 h-80">
        {[
          { src: '/assets/upload/currency-logo/btc.svg', top: '0%', left: '20%', delay: 0 },
          { src: '/assets/upload/currency-logo/eth.svg', top: '15%', left: '70%', delay: 0.5 },
          { src: '/assets/upload/currency-logo/sol.svg', top: '50%', left: '5%', delay: 1 },
          { src: '/assets/upload/currency-logo/bnb.svg', top: '55%', left: '65%', delay: 1.5 },
          { src: '/assets/upload/currency-logo/xrp.svg', top: '80%', left: '35%', delay: 2 },
        ].map((c, i) => (
          <div
            key={c.src}
            className="absolute w-12 h-12 rounded-xl bg-muted border border-white/10 flex items-center justify-center shadow-xl animate-[home-float_4s_ease-in-out_infinite] hover:border-blue-500/30 hover:scale-110 transition-all"
            style={{
              top: c.top,
              left: c.left,
              animationDelay: `${c.delay}s`,
            }}
          >
            <Image src={c.src} alt="" width={28} height={28} className="object-contain" />
          </div>
        ))}
      </div>

      {/* Abstract chart line - decorative */}
      <svg
        className="absolute bottom-20 right-20 w-64 h-32 opacity-20 pointer-events-none hidden lg:block"
        viewBox="0 0 200 80"
        fill="none"
      >
        <path
          d="M0 60 Q30 50 50 45 T100 35 T150 25 T200 15"
          stroke="url(#chartGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="200"
          strokeDashoffset="200"
          style={{ animation: 'home-line-draw 2s ease-out 0.5s forwards' }}
        />
        <defs>
          <linearGradient id="chartGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.8" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}
