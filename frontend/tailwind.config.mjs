/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          200: '#b9cfff',
          300: '#8fafff',
          400: '#6087ff',
          500: '#3c62ff',
          600: '#2443f5',
          700: '#1c33d4',
          800: '#1d2ea8',
          900: '#1d2d83',
          950: '#141b4f',
        },
        accent: {
          400: '#8b5cf6',
          500: '#7c3aed',
          600: '#6d28d9',
        },
      },
      animation: {
        'gradient-shift': 'gradient-shift 18s ease infinite',
        'float-slow': 'float 9s ease-in-out infinite',
        'float-med': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3.5s ease-in-out infinite',
        'shine': 'shine 2.5s linear infinite',
        'progress-stripe': 'progress-stripe 1.2s linear infinite',
      },
      keyframes: {
        'gradient-shift': {
          '0%,100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        float: {
          '0%,100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-14px,0)' },
        },
        'pulse-glow': {
          '0%,100%': { opacity: '0.35' },
          '50%': { opacity: '0.75' },
        },
        shine: {
          '0%': { 'background-position': '-200% 0' },
          '100%': { 'background-position': '200% 0' },
        },
        'progress-stripe': {
          '0%': { 'background-position': '0 0' },
          '100%': { 'background-position': '32px 0' },
        },
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(99,102,241,0.55)',
        card: '0 20px 60px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05) inset',
      },
    },
  },
  plugins: [],
};
