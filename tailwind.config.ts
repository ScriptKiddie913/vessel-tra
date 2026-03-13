import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'intel-bg': '#060a14',
        'intel-panel': '#0a0e1a',
        'intel-border': 'rgba(255,255,255,0.06)',
        'intel-cyan': '#00e5ff',
        'intel-green': '#00ff88',
        'intel-red': '#ff3d3d',
        'intel-amber': '#ffab00',
        'intel-purple': '#b388ff',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Space Mono"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2s linear infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
