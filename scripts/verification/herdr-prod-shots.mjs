#!/usr/bin/env node
/**
 * 生产 mock 状态截图采集（供视觉对比审查/证据存档）
 * 用法: node scripts/verification/herdr-prod-shots.mjs   （需先 build:mock）
 * 输出: apps/desktop/e2e-output/parity-shots/{entry}.png
 */
import { _electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const OUT = path.join(root, 'docs/verification/herdr-shots');

const MATRIX = [
  { name: 'studio-fleet', drive: async (p) => {} },
  { name: 'studio-pane', drive: async (p) => void (await p.click('[data-testid="herdr-view-tab"][data-view="pane"]')) },
  {
    name: 'studio-mission-planned',
    drive: async (p) => {
      await p.click('[data-testid="herdr-view-tab"][data-view="mission"]');
      await p.click('[data-testid="mission-plan"]');
    },
  },
  {
    name: 'studio-mission-merge',
    drive: async (p) => {
      await p.click('[data-testid="herdr-view-tab"][data-view="mission"]');
      await p.click('[data-testid="mission-plan"]');
      await p.click('[data-testid="mission-run"]');
      await p.waitForTimeout(2600);
      await p.click('[data-testid="revision-btn"]');
      await p.waitForTimeout(150);
      await p.click('[data-testid="review-pass-btn"]');
      await p.waitForTimeout(150);
      await p.click('[data-testid="merge-btn"]');
      await p.waitForTimeout(150);
    },
  },
  {
    name: 'mission-mission-planned',
    drive: async (p) => {
      await p.click('[data-testid="layout-mission"]');
      await p.waitForTimeout(150);
      await p.click('[data-testid="mission-plan"]');
    },
  },
  {
    name: 'mission-fleet',
    drive: async (p) => {
      await p.click('[data-testid="layout-mission"]');
      await p.waitForTimeout(150);
      await p.click('[data-testid="herdr-view-tab"][data-view="fleet"]');
    },
  },
  {
    name: 'terminal-pane',
    drive: async (p) => {
      await p.click('[data-testid="layout-terminal"]');
      await p.waitForTimeout(300);
    },
  },
  {
    name: 'terminal-fleet',
    drive: async (p) => {
      await p.click('[data-testid="layout-terminal"]');
      await p.waitForTimeout(150);
      await p.click('[data-testid="herdr-view-tab"][data-view="fleet"]');
    },
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const entry = path.join(root, 'apps/desktop/out/main/index.js');

  // 冷启动偶发抖动：最多 3 次启动尝试
  let session = null;
  for (let attempt = 1; attempt <= 3 && !session; attempt++) {
    try {
      const a = await _electron.launch({
        args: [`--user-data-dir=${path.join(os.tmpdir(), `herdr-shots-${Date.now()}-${attempt}`)}`, entry],
        env: { ...process.env, PI_HERDR_MOCK: '1', CI: '1' },
        timeout: 60_000,
      });
      const p = await a.firstWindow({ timeout: 45_000 });
      await p.setViewportSize({ width: 1440, height: 960 });
      await p.waitForLoadState('domcontentloaded');
      const tab = p.locator('[data-mmcode-tab="agents"]');
      await tab.waitFor({ timeout: 120_000 });
      session = { app: a, page: p, agentsTab: tab };
    } catch (err) {
      console.warn(`[shots] 启动尝试 ${attempt}/3 失败: ${String(err.message).split('\n')[0]}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!session) {
    console.error('[shots] 连续 3 次启动失败，放弃');
    process.exit(1);
  }
  const { app, page, agentsTab } = session;
  const modal = page.locator('[data-testid="onboarding-modal"]');
  if (await modal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 10_000 });
  }
  await agentsTab.click();
  // 冷启动时点击可能落在挂载前，重试导航直到控制面可见
  for (let attempt = 0; attempt < 3; attempt++) {
    const visible = await page.locator('[data-testid="herdr-control-surface"]').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1500);
    await agentsTab.click({ timeout: 10_000 }).catch(() => undefined);
  }
  await page.locator('[data-testid="herdr-control-surface"]').waitFor({ state: 'visible', timeout: 15_000 });

  for (const entryDef of MATRIX) {
    // 每个条目前重置 mock 状态（store.reset）+ 布局回 studio
    if (entryDef !== MATRIX[0]) {
      await page.evaluate(() => {
        const api = window.__herdrMockApi__;
        if (api?.reset) api.reset();
        const s = document.querySelector('[data-testid="layout-studio"]');
        if (s) s.click();
      }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
    await entryDef.drive(page);
    await page.waitForTimeout(2600);
    const shot = await page.screenshot();
    const file = path.join(OUT, `${entryDef.name}.png`);
    fs.writeFileSync(file, shot);
    console.log(`✓ ${path.relative(root, file)} (${shot.length} bytes)`);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
