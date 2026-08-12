// Electron Vite Configuration

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };
const autoUpdateEnabled = process.env.PI_DESKTOP_ENABLE_AUTO_UPDATE === "1";

export default defineConfig({
  main: {
    define: {
      __PI_DESKTOP_AUTO_UPDATE_ENABLED__: JSON.stringify(autoUpdateEnabled),
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
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
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
        '@shared': resolve(__dirname, '../../packages/shared-types/src'),
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@pi-desktop/shared-types']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
        '@shared': resolve(__dirname, '../../packages/shared-types/src'),
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
        build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        }
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // Herdr GUI mock 运行时开关（原型数据驱动，仅开发/测试用；默认关闭）
      __PI_HERDR_MOCK__: JSON.stringify(process.env.PI_HERDR_MOCK === '1' ? '1' : '0'),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
        '@shared': resolve(__dirname, '../../packages/shared-types/src'),
      }
    }
  }
});
