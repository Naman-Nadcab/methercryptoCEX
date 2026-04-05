/**
 * Design System Tokens — single source of truth for all visual primitives.
 *
 * Usage:
 *   - Tailwind classes reference these via tailwind.config.ts extensions.
 *   - Components import these for programmatic access (charts, canvas, etc.).
 *   - NEVER hardcode hex values in components — always use tokens or Tailwind classes.
 */

/* ------------------------------------------------------------------ */
/*  Colors                                                             */
/* ------------------------------------------------------------------ */

export const colors = {
  // Light theme (legacy admin pages)
  light: {
    bg:        '#F8FAFC',
    bgAlt:     '#F1F5F9',
    card:      '#FFFFFF',
    border:    '#E2E8F0',
    text:      '#1E293B',
    textMuted: '#64748B',
    primary:   '#6366F1',
    success:   '#10B981',
    warning:   '#F59E0B',
    danger:    '#EF4444',
    info:      '#3B82F6',
  },
  // Dark theme (v2 control center pages)
  dark: {
    bg:        '#0F1117',
    bgAlt:     '#111827',
    card:      '#11161D',
    cardHover: '#151B26',
    border:    '#1F2A37',
    text:      '#E5E7EB',
    textMuted: '#9CA3AF',
    primary:   '#6366F1',
    accent:    '#3B82F6',
    success:   '#10B981',
    warning:   '#F59E0B',
    danger:    '#EF4444',
    info:      '#3B82F6',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Spacing (multiples of 4)                                           */
/* ------------------------------------------------------------------ */

export const spacing = {
  '0.5': '2px',
  '1':   '4px',
  '2':   '8px',
  '3':   '12px',
  '4':   '16px',
  '5':   '20px',
  '6':   '24px',
  '8':   '32px',
  '10':  '40px',
  '12':  '48px',
  '16':  '64px',
} as const;

/* ------------------------------------------------------------------ */
/*  Border Radius                                                      */
/* ------------------------------------------------------------------ */

export const radius = {
  sm:   '6px',
  md:   '10px',
  lg:   '16px',
  xl:   '20px',
  full: '9999px',
} as const;

/* ------------------------------------------------------------------ */
/*  Typography                                                         */
/* ------------------------------------------------------------------ */

export const typography = {
  sizes: {
    '2xs': { fontSize: '10px', lineHeight: '14px' },
    xs:    { fontSize: '12px', lineHeight: '16px' },
    sm:    { fontSize: '14px', lineHeight: '20px' },
    base:  { fontSize: '16px', lineHeight: '24px' },
    lg:    { fontSize: '18px', lineHeight: '28px' },
    xl:    { fontSize: '20px', lineHeight: '28px' },
    '2xl': { fontSize: '24px', lineHeight: '32px' },
    '3xl': { fontSize: '30px', lineHeight: '36px' },
  },
  weights: {
    normal:   '400',
    medium:   '500',
    semibold: '600',
    bold:     '700',
  },
  tracking: {
    tight:  '-0.025em',
    normal: '0',
    wide:   '0.025em',
    wider:  '0.05em',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Shadows                                                            */
/* ------------------------------------------------------------------ */

export const shadows = {
  card:      '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
  cardHover: '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.05)',
  modal:     '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
  dropdown:  '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
  glow: {
    primary: '0 0 20px rgba(99,102,241,0.15)',
    danger:  '0 0 20px rgba(239,68,68,0.15)',
    success: '0 0 20px rgba(16,185,129,0.15)',
    warning: '0 0 20px rgba(245,158,11,0.15)',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Transitions                                                        */
/* ------------------------------------------------------------------ */

export const transitions = {
  fast:    '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  default: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow:    '300ms cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/* ------------------------------------------------------------------ */
/*  Z-Index Scale                                                      */
/* ------------------------------------------------------------------ */

export const zIndex = {
  base:       0,
  dropdown:   20,
  sticky:     30,
  sidebar:    40,
  modal:      50,
  popover:    60,
  toast:      70,
  tooltip:    80,
  commandBar: 90,
} as const;
