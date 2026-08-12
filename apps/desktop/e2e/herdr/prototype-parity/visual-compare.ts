/**
 * Herdr parity 视觉对比助手（原型黄金基线 vs 生产截图）
 *
 * 对比方式：按 shell 区域（左树 / 中内容 / 右栏）裁剪后逐区域 pixelmatch，
 * 避开 titlebar/tabbar/状态条等 app chrome 差异。区域坐标由每张图各自的
 * chrome 高度决定（原型 banner 26+topbar 44+serverbar 54=124px；
 * 生产 TitleBar 32+TopTabBar 36+HerdrStatusBar 54=122px）。
 *
 * 使用：parity-visual.spec.ts 内直接调用 compareRegions()。
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';

export interface RegionSpec {
  name: string;
  /** 内容区起点 y（chrome 底部） */
  chromeTop: number;
  /** 左栏宽度 */
  leftWidth: number;
  /** 右栏宽度 */
  rightWidth: number;
  /** 右栏起点 x（viewport 宽 - rightWidth） */
  rightStart: number;
}

/**
 * 原型变体布局几何（与原型 CSS 一致）：
 *   studio:   --left:270px; --right:310px
 *   mission:  --left:220px; --right:335px
 *   terminal: --left:230px; --right:270px
 * chromeTop: 原型 banner 26 + topbar 44 + serverbar 54 = 124；
 * 生产 TitleBar 32 + TopTabBar 36 + HerdrStatusBar 54 = 122（M11 校准）。
 */
export const VIEWPORT_WIDTH = 1440;

export function regionSpecFor(entryName: string, chromeTop: number): RegionSpec {
  if (entryName.startsWith('mission-')) {
    return { name: 'mission', chromeTop, leftWidth: 220, rightWidth: 335, rightStart: VIEWPORT_WIDTH - 335 };
  }
  if (entryName.startsWith('terminal-')) {
    return { name: 'terminal', chromeTop, leftWidth: 230, rightWidth: 270, rightStart: VIEWPORT_WIDTH - 270 };
  }
  return { name: 'studio', chromeTop, leftWidth: 270, rightWidth: 310, rightStart: VIEWPORT_WIDTH - 310 };
}

export const PROTOTYPE_CHROME_TOP = 124; // 26 + 44 + 54
export const PRODUCTION_CHROME_TOP = 122; // 32 + 36 + 54

/** 读取 PNG 文件为 pngjs 对象（自动处理行序）。 */
export function loadPng(filePath: string): PNG {
  const buf = fs.readFileSync(filePath);
  return PNG.sync.read(buf);
}

/** 裁剪区域并返回新 PNG。 */
export function cropPng(src: PNG, x: number, y: number, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  const srcW = src.width;
  const hh = Math.min(h, src.height - y);
  const ww = Math.min(w, src.width - x);
  for (let row = 0; row < hh; row++) {
    for (let col = 0; col < ww; col++) {
      const si = ((y + row) * srcW + (x + col)) * 4;
      const di = (row * w + col) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export interface RegionResult {
  name: string;
  diffRatio: number;
  diffPixels: number;
  totalPixels: number;
}

/**
 * 逐区域对比 baseline 与 production 截图。
 * 返回每个区域的 diffRatio（0..1）与汇总结果；threshold 内视为通过。
 */
export function compareRegions(
  baselinePng: PNG,
  productionPng: PNG,
  regions: RegionSpec,
  threshold: number,
): { results: RegionResult[]; passed: boolean; overallRatio: number } {
  const areas: Array<{ name: string; x: number; y: number; w: number; h: number }> = [
    { name: 'left', x: 0, y: regions.chromeTop, w: regions.leftWidth, h: baselinePng.height - regions.chromeTop },
    {
      name: 'center',
      x: regions.leftWidth,
      y: regions.chromeTop,
      w: regions.rightStart - regions.leftWidth,
      h: baselinePng.height - regions.chromeTop,
    },
    { name: 'right', x: regions.rightStart, y: regions.chromeTop, w: regions.rightWidth, h: baselinePng.height - regions.chromeTop },
  ];
  const results: RegionResult[] = [];
  let totalDiff = 0;
  let totalPixels = 0;
  for (const area of areas) {
    const a = cropPng(baselinePng, area.x, area.y, area.w, area.h);
    const b = cropPng(productionPng, area.x, area.y, area.w, area.h);
    const diff = new PNG({ width: a.width, height: a.height });
    const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.15 });
    const ratio = diffPixels / (a.width * a.height);
    results.push({ name: area.name, diffRatio: ratio, diffPixels, totalPixels: a.width * a.height });
    totalDiff += diffPixels;
    totalPixels += a.width * a.height;
  }
  const overallRatio = totalDiff / totalPixels;
  return { results, passed: results.every((r) => r.diffRatio <= threshold) && overallRatio <= threshold, overallRatio };
}

/** 汇总文本（供 spec 输出与 gates.yml 证据记录）。 */
export function formatRegionReport(results: RegionResult[], overallRatio: number, threshold: number): string {
  const lines = results.map((r) => `${r.name}: ${(r.diffRatio * 100).toFixed(2)}% (${r.diffPixels}/${r.totalPixels}px)`);
  return [`overall ${(overallRatio * 100).toFixed(2)}% ≤ ${(threshold * 100).toFixed(2)}%`, ...lines].join(' · ');
}
