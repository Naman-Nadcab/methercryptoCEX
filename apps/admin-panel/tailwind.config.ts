import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        admin: {
          bg: '#0B0F14',
          surface: '#111820',
          card: '#141A21',
          'card-hover': '#1A2230',
          primary: '#6366F1',
          'primary-hover': '#818CF8',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          muted: '#9BA7B4',
          border: '#1F2A37',
          info: '#3B82F6',
          text: '#E6EDF3',
          'text-secondary': '#9BA7B4',
        },
        ds: {
          bg: '#0B0F14',
          'bg-alt': '#111820',
          card: '#141A21',
          'card-hover': '#1A2230',
          border: '#1F2A37',
          text: '#E6EDF3',
          'text-muted': '#9BA7B4',
          accent: '#6366F1',
        },
      },
      borderRadius: {
        card: '10px',
        'ds-sm': '6px',
        'ds-md': '8px',
        'ds-lg': '12px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 4px 12px -2px rgba(0, 0, 0, 0.4)',
        modal: '0 20px 40px -8px rgba(0, 0, 0, 0.5)',
        dropdown: '0 10px 20px -4px rgba(0, 0, 0, 0.4)',
        'glow-primary': '0 0 20px rgba(99,102,241,0.2)',
        'glow-danger': '0 0 20px rgba(239,68,68,0.2)',
        'glow-success': '0 0 20px rgba(16,185,129,0.2)',
        'glow-warning': '0 0 20px rgba(245,158,11,0.2)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'fade-in': 'fade-in 200ms ease-out',
        'scale-in': 'scale-in 200ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
