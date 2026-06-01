// Electron Vite Configuration

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Historical note (2026-06-01, e2e-framework task):
        // @earendil-works/pi-coding-agent@0.75.5 is ESM-only and has no
        // `require` condition in its exports map. Adding it to `exclude`
        // would force vite to bundle it into the main chunk (emitting a
        // CJS wrapper that satisfies `require()`). In practice this does
        // NOT unblock e2e — the dep additionally hard-requires `node:sqlite`
        // (a Node 22.5+ builtin) which Electron 34 doesn't expose, so the
        // bundled main process still crashes with ERR_UNKNOWN_BUILTIN_MODULE
        // at startup. See docs/OPTIMIZATION-ROADMAP.md "E2E 阻塞说明".
        // The exclude entry is left in place as a historical record of the
        // diagnosis. The real fix lands in v1.1 via Electron bump.
        exclude: [
          '@pi-desktop/pi-driver',
          '@pi-desktop/shared-types',
          '@earendil-works/pi-coding-agent',
        ],
      }),
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