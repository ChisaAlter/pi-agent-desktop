/**
 * Parity 独立配置 — 原型目标对齐测试（无需 Electron 构建产物）。
 *
 *   npx playwright test --config=playwright.parity.config.ts
 *
 * production 目标走主配置（apps/desktop/playwright.config.ts，需先 build）：
 *   HERDR_PARITY_TARGET=production npx playwright test e2e/herdr/prototype-parity
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/herdr/prototype-parity',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'e2e-output/parity',
});
