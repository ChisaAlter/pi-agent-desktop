#!/usr/bin/env node
/**
 * Herdr 原型黄金截图基线生成器
 *
 * 驱动已批准的交互原型（docs/prototypes/herdr-desktop-ui-prototype.html）
 * 在固定 viewport 1440×960、DPR 1 下生成全矩阵截图，存入
 *   apps/desktop/e2e-output/baselines/herdr/
 * 供生产实现后 parity-visual 逐区域像素对比（视觉唯一权威 = 原型）。
 *
 * 矩阵：studio/mission/terminal 布局 × fleet/pane/mission 视图 + 设置 + 合入确认模态。
 * 基线确定性：固定 viewport、固定交互序列、无随机、无计时器依赖
 * （merge 流依赖原型 2200ms 定时器，等待 2600ms 保证状态落定）。
 *
 * 用法：
 *   node scripts/verification/herdr-golden-baseline.mjs        # 全矩阵生成
 *   node scripts/verification/herdr-golden-baseline.mjs --list # 只打印矩阵
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const PROTOTYPE = path.join(root, 'docs/prototypes/herdr-desktop-ui-prototype.html');
const OUT_DIR = path.join(root, 'apps/desktop/e2e-output/baselines/herdr');

const VIEWPORT = { width: 1440, height: 960 };

/** 矩阵定义（name 即基线文件名前缀）。 */
const MATRIX = [
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

async function drive(page, entry) {
  // 布局
  await page.click(`[data-variant="${entry.variant}"]`);
  // 视图（variant 切换可能已把视图切走，显式切回目标视图）
  const viewTab = page.locator(`.view-tab[data-view="${entry.view}"]`);
  if (await viewTab.count()) {
    await viewTab.click();
  }
  await page.waitForTimeout(120);
  // mission 视图的确定性状态
  if (entry.plan) {
    await page.click('[data-action=plan]');
    await page.waitForTimeout(120);
  }
  if (entry.mergeFlow) {
    await page.click('[data-action=plan]');
    await page.waitForTimeout(120);
    await page.click('[data-action=run-mission]');
    await page.waitForTimeout(2600); // 原型 2200ms 后进入 review 态
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
  // toast 窗口 2400ms：截图前等它消失，保证基线不依赖 toast 时序
  await page.waitForTimeout(2600);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const e of MATRIX) console.log(`${e.name}.png  (${e.variant} / ${e.view}${e.plan ? ' / planned' : ''}${e.mergeFlow ? ' / merge-modal' : ''}${e.settings ? ' / settings' : ''})`);
    return;
  }

  if (!fs.existsSync(PROTOTYPE)) {
    console.error(`原型不存在: ${PROTOTYPE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`file://${PROTOTYPE.replace(/\\/g, '/')}`);

  const manifest = { viewport: VIEWPORT, generated: new Date().toISOString(), entries: [] };
  for (const entry of MATRIX) {
    await page.goto(`file://${PROTOTYPE.replace(/\\/g, '/')}`);
    await drive(page, entry);
    const buf = await page.screenshot();
    const file = path.join(OUT_DIR, `${entry.name}.png`);
    fs.writeFileSync(file, buf);
    manifest.entries.push({
      name: entry.name, variant: entry.variant, view: entry.view,
      plan: !!entry.plan, mergeFlow: !!entry.mergeFlow, settings: !!entry.settings,
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    });
    console.log(`✓ ${path.relative(root, file)} (${buf.length} bytes)`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n基线完成: ${MATRIX.length} 张 → ${path.relative(root, OUT_DIR)}/`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
