/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#e8ecee',
          100: '#d1d9dd',
          200: '#a3b3ba',
          300: '#758c97',
          400: '#476674',
          500: '#1F3036',
          600: '#19262b',
          700: '#121c20',
          800: '#0c1215',
          900: '#06090a',
        },
        brand: {
          red: '#DE6336',
          'red-soft': '#e5825e',
          'red-dark': '#b24f2b',
          'red-ink': '#1b3a66',
          teal: '#309DC4',
          'teal-soft': '#59b0d0',
          'teal-dark': '#267e9d',
          orange: '#E78B3F',
          'orange-soft': '#eca265',
          'orange-dark': '#b96f32',
          editable: '#DCE8F4',
        },
        indigo: {
          50: '#eef2ff',
          100: '#e0e7ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      fontFamily: {
        sans: ['Source Sans 3', 'Source Sans Pro', 'Tajawal', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Source Sans 3', 'Source Sans Pro', 'Inter', 'system-ui', 'sans-serif'],
        ui: ['Inter', 'Source Sans 3', 'system-ui', 'sans-serif'],
        arabic: ['Tajawal', 'Source Sans 3', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1.15' }],
      },
      letterSpacing: {
        caps: '0.08em',
        eyebrow: '0.14em',
      },
      spacing: {
        'grid-1': '0.5rem',
        'grid-2': '1rem',
        'grid-3': '1.5rem',
        'grid-4': '2rem',
        'grid-5': '2.5rem',
        'grid-6': '3rem',
        'grid-8': '4rem',
        'grid-10': '5rem',
        'grid-12': '6rem',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)',
        'card-lg': '0 10px 28px rgba(31, 48, 54, 0.08)',
        'card-dark': '0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.35)',
        pop: '0 18px 48px rgba(31, 48, 54, 0.18)',
        'brand-red': '0 6px 14px rgba(222, 99, 54, 0.28)',
        'brand-red-lg': '0 8px 18px rgba(222, 99, 54, 0.45)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(30px,-30px) scale(1.05)' },
          '66%': { transform: 'translate(-20px,20px) scale(0.95)' },
        },
        'pulse-glow': {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(222,99,54,0.20)' },
          '50%': { boxShadow: '0 0 0 8px rgba(222,99,54,0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 300ms cubic-bezier(0.4, 0, 0.2, 1) both',
        'fade-in-up': 'fade-in-up 800ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'slide-in': 'slide-in-right 300ms cubic-bezier(0.4, 0, 0.2, 1) both',
        float: 'float 20s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
