export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Workforce "Harmony" palette - warm, balanced, serene
        cream: {
          50: '#FFFCF7',
          100: '#F8F5EE',
          200: '#F0EBE0',
        },
        burgundy: {
          600: '#6B1D29',
          500: '#8B2635',
          400: '#A83042',
        },
        gold: {
          500: '#C9A227',
          400: '#D4B340',
          300: '#E5C965',
        },
        sage: {
          600: '#3D6B4A',
          500: '#4A7C59',
          400: '#5C9469',
        },
        charcoal: {
          900: '#1F2324',
          800: '#2D3436',
          700: '#404546',
          600: '#6B7280',
        },
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'fade-up': 'fade-up 0.4s ease-out forwards',
        'slide-in': 'slide-in 0.3s ease-out forwards',
      },
      keyframes: {
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      boxShadow: {
        'harmony': '0 4px 20px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
        'harmony-lg': '0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        'harmony-glow': '0 0 20px rgba(201, 162, 39, 0.15)',
      },
    },
  },
  plugins: [],
};
