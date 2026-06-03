// Electron Vite Configuration

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// v1.0.10 (L2): 把 package.json 的 version 注入 renderer 当作 __APP_VERSION__ 常量,
// 避免 status bar / About 面板写死字符串, 跟实际 release 不同步.
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Historical note (2026-06-01, e2e-framework task):
        // @earendil-works/pi-coding-agent@0.75.5 is ESM-only and has no
        // `require` condition in its exports map. Adding it to `exclude`
        // would force vite to bundle it into the main chunk (emitting a
        // CJS wrapper that satisfies `require()`).
        //
        // E2E blocker (v1.0.10 — confirmed by manual launch):
        //   Even after bundling, the resulting main process crashes at module
        //   load. The crash chain is pi-coding-agent -> undici -> CacheStorage
        //   which transitively requires `webidl.util.markAsUncloneable` (a
        //   Node 22.5+ builtin). Electron 34 doesn't expose it. Patching
        //   node:sqlite (also a 22.5+ builtin) is not enough — undici needs
        //   the same treatment, then probably more. The dep chain assumes
        //   Node 22.5+ runtime; in Electron 34 (which uses its own Node fork)
        //   the only fix is upgrading Electron. See
        //   docs/OPTIMIZATION-ROADMAP.md "E2E 阻塞说明" — real fix is v1.1
        //   via Electron bump.
        //
        // For runtime verification of v1.0.10 IPC fixes WITHOUT launching
        // the full app, see `scripts/smoke-main-runtime.cjs` — it patches
        // node:sqlite stubs, mocks electron, and runs setupIPC. C1 fix
        // (no duplicate IPC handlers) is verified by that smoke launcher.
        //
        // The exclude entry is left in place as a historical record.
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
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
        // v1.0.10 (build fix): tsconfig paths 把 @shared 映射到 packages/shared-types/src,
        // 但 vite/rollup 不读 tsconfig, 必须显式声明. v1.0.6.1 引入 @shared 之后
        // 一直 build 失败没人发现 — 直到 e2e 验证才发现.
        '@shared': resolve(__dirname, '../../packages/shared-types/src'),
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
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@pi-desktop/pi-driver': resolve(__dirname, '../../packages/pi-driver/src'),
        '@pi-desktop/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
        '@shared': resolve(__dirname, '../../packages/shared-types/src'),
      }
    }
  }
});