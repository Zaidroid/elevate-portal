// GSG brand tokens. Mirror of leaves-tracker/src/index.css — single TS source.

export const colors = {
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
  red: {
    400: '#e5825e',
    500: '#DE6336',
    600: '#b24f2b',
  },
  teal: {
    400: '#59b0d0',
    500: '#309DC4',
    600: '#267e9d',
  },
  orange: {
    400: '#eca265',
    500: '#E78B3F',
    600: '#b96f32',
  },
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  editableBlue: '#DCE8F4',
} as const;

export const fonts = {
  sans: "'Source Sans Pro', 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  arabic: "'Tajawal', 'Source Sans Pro', sans-serif",
} as const;

export const spacing = {
  grid: 8, // px — 8px grid system per GSG design rules
} as const;
