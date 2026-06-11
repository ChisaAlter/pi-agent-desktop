/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Codex 浅灰白色主题
        'pi-bg': '#f5f5f5',
        'pi-panel': '#ffffff',
        'pi-border': '#e5e5e5',
        'pi-text-primary': '#1a1a1a',
        'pi-text-secondary': '#666666',
        'pi-text-tertiary': '#999999',
        'pi-accent': '#1a1a1a',
        'pi-success': '#10b981',
        'pi-warning': '#f59e0b',
        'pi-error': '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        'body': '14px',
        'small': '12px',
      },
      width: {
        'icon-bar': '48px',
        'project-panel': '220px',
        'floating-panel': '280px',
      },
      borderRadius: {
        'panel': '8px',
        'card': '6px',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '300ms',
      },
    },
  },
  plugins: [],
}
