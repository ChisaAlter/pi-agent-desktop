/**
 * Parity 视觉对齐 — 原型黄金基线 vs 生产截图的区域像素对比。
 *
 * G0（本阶段）：基线完整性自检 — 重新驱动原型生成截图并与入库基线对比，
 * 校验 manifest SHA-256（防基线被替换后重新生成 manifest 的不可察觉篡改）。
 * M11（Phase 1）：对 production（mock 模式）同一状态截图逐区域对比，
 * 通过阈值由 G1 校准，结果写入 herdr-ui-evidence。
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { compareRegions, loadPng, formatRegionReport, regionSpecFor, PROTOTYPE_CHROME_TOP } from './visual-compare';
import { parityTarget } from './parity-target';

// 基线入库于 docs/verification/baselines（Playwright outputDir 每次运行清空 e2e-output，不能放那里）
const BASELINE_DIR = path.resolve(__dirname, '../../../../../docs/verification/baselines/herdr');
const PROTOTYPE_PATH = path.resolve(__dirname, '../../../../../docs/prototypes/herdr-desktop-ui-prototype.html');
const VIEWPORT = { width: 1440, height: 960 };

/** 自检矩阵：与 golden-baseline.mjs 的 MATRIX 一一对应（9 张全量）。 */
const SELF_CHECK_MATRIX = [
  { name: 'studio-fleet', variant: 'studio', view: 'fleet' },
  { name: 'studio-pane', variant: 'studio', view: 'pane' },
  { name: 'studio-mission-planned', variant: 'studio', view: 'mission', plan: true },
  { name: 'studio-settings', variant: 'studio', view: 'fleet', settings: true },
  { name: 'studio-mission-merge', variant: 'studio', view: 'mission', mergeFlow: true },
  { name: 'mission-mission-planned', variant: 'mission', view: 'mission', plan: true },
  { name: 'mission-fleet', variant: 'mission', view: 'fleet' },
  { name: 'terminal-pane', variant: 'terminal', view: 'pane' },
  { name: 'terminal-fleet', variant: 'terminal', view: 'fleet' },
];

/** 与 golden-baseline.mjs 相同的确定性驱动（保持双端一致；toast 等待保证截图无时序依赖）。 */
async function drivePrototype(page: import('@playwright/test').Page, entry: { variant: string; view: string; plan?: boolean; settings?: boolean; mergeFlow?: boolean }): Promise<void> {
  await page.goto(`file://${PROTOTYPE_PATH.replace(/\\/g, '/')}`);
  await page.click(`[data-variant="${entry.variant}"]`);
  const viewTab = page.locator(`.view-tab[data-view="${entry.view}"]`);
  if (await viewTab.count()) await viewTab.click();
  await page.waitForTimeout(120);
  if (entry.plan) {
    await page.click('[data-action=plan]');
    await page.waitForTimeout(120);
  }
  if (entry.mergeFlow) {
    await page.click('[data-action=plan]');
    await page.waitForTimeout(120);
    await page.click('[data-action=run-mission]');
    await page.waitForTimeout(2600);
    await page.click('[data-action=revision]');
    await page.waitForTimeout(150);
    await page.click('[data-action=review-pass]');
    await page.waitForTimeout(150);
    await page.click('[data-action=merge]');
    await page.waitForTimeout(150);
  }
  if (entry.settings) {
    await page.click('[data-action=open-settings]');
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2600); // toast 窗口 2400ms
}

test.describe('parity 视觉对齐（基线完整性自检）', () => {
  test.skip(parityTarget() === 'production', '视觉对齐的 production 对比在 Phase 1 M11 启用');

  test('manifest 哈希与基线文件一致（防篡改/防替换）', async () => {
    const manifestFile = path.join(BASELINE_DIR, 'manifest.json');
    expect(fs.existsSync(manifestFile), 'manifest.json 缺失').toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const entries = manifest.entries ?? [];
    expect(entries.length).toBe(SELF_CHECK_MATRIX.length);
    for (const entry of entries) {
      const file = path.join(BASELINE_DIR, `${entry.name}.png`);
      expect(fs.existsSync(file), `${entry.name}.png 缺失`).toBe(true);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      expect(actual, `${entry.name}.png 与 manifest 哈希不一致（基线被替换？）`).toBe(entry.sha256);
    }
  });

  for (const entry of SELF_CHECK_MATRIX) {
    test(`基线自检 ${entry.name}（重驱动原型 vs 入库基线）`, async () => {
      const baselineFile = path.join(BASELINE_DIR, `${entry.name}.png`);
      expect(fs.existsSync(baselineFile), `基线缺失 ${baselineFile}`).toBe(true);

      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await drivePrototype(page, entry);
      const shot = await page.screenshot();
      await browser.close();

      const tmp = path.join(os.tmpdir(), `.herdr-selfcheck-${entry.name}.png`);
      fs.writeFileSync(tmp, shot);
      const baseline = loadPng(baselineFile);
      const current = loadPng(tmp);
      // 自检容差: 重驱动同一原型应像素级一致（<0.5% 抗字体光栅化抖动）
      const regions = regionSpecFor(entry.name, PROTOTYPE_CHROME_TOP);
      const { results, passed, overallRatio } = compareRegions(baseline, current, regions, PROTOTYPE_CHROME_TOP, PROTOTYPE_CHROME_TOP, 0.005);
      fs.rmSync(tmp, { force: true });
      expect(passed, `基线自检超差: ${formatRegionReport(results, overallRatio, 0.005)}`).toBe(true);
    });
  }
});

test.describe('parity 视觉对齐（production 对比）', () => {
  test.skip(parityTarget() === 'prototype', 'production 对比需 HERDR_PARITY_TARGET=production + mock 构建');

  /** 生产条目矩阵与驱动（与 golden-baseline.mjs 的状态一一对应）。 */
  const PRODUCTION_MATRIX = [
    { name: 'studio-fleet', drive: async (page: import('@playwright/test').Page) => {} },
    { name: 'studio-pane', drive: async (page) => void (await page.click('[data-testid="herdr-view-tab"][data-view="pane"]')) },
    {
      name: 'studio-mission-planned',
      drive: async (page) => {
        await page.click('[data-testid="herdr-view-tab"][data-view="mission"]');
        await page.click('[data-testid="mission-plan"]');
      },
    },
    {
      name: 'studio-mission-merge',
      drive: async (page) => {
        await page.click('[data-testid="herdr-view-tab"][data-view="mission"]');
        await page.click('[data-testid="mission-plan"]');
        await page.click('[data-testid="mission-run"]');
        await page.waitForTimeout(2600);
        await page.click('[data-testid="revision-btn"]');
        await page.waitForTimeout(150);
        await page.click('[data-testid="review-pass-btn"]');
        await page.waitForTimeout(150);
        await page.click('[data-testid="merge-btn"]');
        await page.waitForTimeout(150);
      },
    },
    {
      name: 'mission-mission-planned',
      drive: async (page) => {
        await page.click('[data-testid="layout-mission"]');
        await page.waitForTimeout(150);
        await page.click('[data-testid="mission-plan"]');
      },
    },
    {
      name: 'mission-fleet',
      drive: async (page) => {
        await page.click('[data-testid="layout-mission"]');
        await page.waitForTimeout(150);
        await page.click('[data-testid="herdr-view-tab"][data-view="fleet"]');
      },
    },
    {
      name: 'terminal-pane',
      drive: async (page) => {
        await page.click('[data-testid="layout-terminal"]');
        await page.waitForTimeout(300);
      },
    },
    {
      name: 'terminal-fleet',
      drive: async (page) => {
        await page.click('[data-testid="layout-terminal"]');
        await page.waitForTimeout(150);
        await page.click('[data-testid="herdr-view-tab"][data-view="fleet"]');
      },
    },
    // studio-settings: 生产设置为设置窗口 tab（Phase 2），模态基线不做生产对比（F2 映射决策）
  ];

  for (const entry of PRODUCTION_MATRIX) {
    test(`视觉对比 ${entry.name}（生产 mock 态 vs 原型黄金基线）`, async () => {
      test.setTimeout(120_000);
      const { openParitySession } = await import('./parity-target');
      const { page, close } = await openParitySession();
      await entry.drive(page);
      // 等待渲染稳定（toast 窗口 2400ms）
      await page.waitForTimeout(2600);
      // 生产 chrome 高度实测（titlebar+tabbar+statusbar 底部），保证区域对齐
      const statusBar = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="herdr-status-bar"]');
        if (!el) return 122;
        const box = el.getBoundingClientRect();
        return box.y + box.height;
      });
      const shot = await page.screenshot();
      await close();

      const baselineFile = path.join(BASELINE_DIR, `${entry.name}.png`);
      expect(fs.existsSync(baselineFile), `基线缺失 ${baselineFile}`).toBe(true);
      const tmp = path.join(os.tmpdir(), `.herdr-prod-${entry.name}.png`);
      fs.writeFileSync(tmp, shot);
      const baseline = loadPng(baselineFile);
      const current = loadPng(tmp);
      // 阈值 G1 校准（当前为初始值 0.03 = 区域 3% 像素）
      const threshold = 0.03;
      const regions = regionSpecFor(entry.name, PROTOTYPE_CHROME_TOP);
      // terminal 布局按 D4 决策仅比较中心区（生产 rail 保持浅色主题，与原型暗色 rail 有意不同）
      const skip = entry.name.startsWith('terminal-') ? ['left', 'right'] : [];
      const { results, passed, overallRatio } = compareRegions(baseline, current, regions, PROTOTYPE_CHROME_TOP, Math.round(statusBar), threshold, { skip });
      fs.rmSync(tmp, { force: true });
      console.log(`[parity-visual] ${entry.name} chromeTop=${Math.round(statusBar)}: ${formatRegionReport(results, overallRatio, threshold)}`);
      expect(passed, `视觉对比超差: ${formatRegionReport(results, overallRatio, threshold)}`).toBe(true);
    });
  }
});
