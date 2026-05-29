// Electron Vite Configuration

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@pi-desktop/pi-driver', '@pi-desktop/shared-types']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@pi-desktop/pi-driver': resolve(__dirname, '../../packages/pi-driver/src'),
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src')
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@pi-desktop/pi-driver', '@pi-desktop/shared-types']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@pi-desktop/pi-driver': resolve(__dirname, '../../packages/pi-driver/src'),
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src')
      }
    }
  }
});