/**
 * Parity 目标抽象：同一套对齐流可跑「原型」（oracle）或「生产」（mock 模式）。
 *
 *   HERDR_PARITY_TARGET=prototype  → 驱动 docs/prototypes/herdr-desktop-ui-prototype.html
 *   HERDR_PARITY_TARGET=production → 驱动打包产物（Phase 1 M11 接线，需先 build）
 *
 * G0 阶段用 prototype 目标验证框架与原型交互流（断言与原型行为一致）；
 * M11 用 production 目标在真实应用上重跑同一套断言。
 */
import { chromium, _electron, type Browser, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

export type ParityTarget = 'prototype' | 'production';

const PROTOTYPE_PATH = path.resolve(__dirname, '../../../../../docs/prototypes/herdr-desktop-ui-prototype.html');

export function parityTarget(): ParityTarget {
  return process.env.HERDR_PARITY_TARGET === 'production' ? 'production' : 'prototype';
}

export interface ParitySession {
  page: Page;
  target: ParityTarget;
  close: () => Promise<void>;
}

/** 打开对齐目标并返回可控会话（1440×960 / DPR 1，与黄金基线一致）。 */
export async function openParitySession(): Promise<ParitySession> {
  const target = parityTarget();
  if (target === 'prototype') {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`file://${PROTOTYPE_PATH.replace(/\\/g, '/')}`);
    return { page, target, close: () => browser.close() };
  }
  // production: 打包产物 + mock 运行时（Phase 1 M11 完整接线）
  const entry = path.resolve(__dirname, '../../../../out/main/index.js');
  const app = await _electron.launch({
    args: [entry],
    env: { ...process.env, PI_HERDR_MOCK: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 960 });
  return { page, target, close: () => app.close() };
}

/**
 * 目标感知选择器：prototype 用原型 DOM 选择器；production 用 data-testid。
 * 尚未在 production 中实现的交互返回 null（对应测试跳过并标注）。
 */
export interface ParitySelectors {
  /** 全部 pane 行（层级树第 4 级） */
  paneRows: string | null;
  /** 树中 pane 行（pane 名称 → 行选择器） */
  paneRow(pane: string): string | null;
  /** 树中工作区行（indent1）与标签行（indent2）——层级结构断言 */
  treeRowsByIndent(indent: number): string | null;
  /** pane 视图容器 */
  paneView: string | null;
  /** blocked 横幅 */
  blockBanner: string | null;
  /** 处理 blocked 主按钮 */
  resolveBlock: string | null;
  /** fleet 视图中的卡片（agent 名 → 卡片选择器） */
  card(agent: string): string | null;
  /** 卡片状态徽章文本 */
  cardStatus(agent: string): string | null;
  /** 卡片操作条容器（主 CTA 为其中第一个按钮） */
  cardActions(agent: string): string | null;
  /** mission 状态徽章 */
  missionStatus: string | null;
  /** DAG 节点 */
  dagNodes: string | null;
  /** 创建修订轮次按钮 */
  revisionBtn: string | null;
  /** 完成修订并复审按钮 */
  reviewPassBtn: string | null;
  /** 请求合入主分支按钮 */
  mergeBtn: string | null;
  /** 模态遮罩/标题 */
  modalBg: string | null;
  modalTitle: string | null;
  /** 设置导航 tab（compat/general/diagnostics） */
  settingsTab(tab: string): string | null;
  /** 设置内更新流按钮（check-update/verify-update/switch-update） */
  updateAction(action: string): string | null;
  /** 通用 data-action 按钮（plan/run-mission/revision/review-pass/merge/open-settings 等） */
  action(action: string): string | null;
  /** 中部视图切换 tab（fleet/pane/mission） */
  viewTab(view: string): string | null;
}

const PROTOTYPE_SELECTORS: ParitySelectors = {
  paneRows: '.pane-row',
  paneRow: (pane) => `.pane-row[data-agent="${pane}"]`,
  treeRowsByIndent: (indent) => `.tree-row.indent${indent}`,
  paneView: '#paneView',
  blockBanner: '#blockBanner',
  resolveBlock: '[data-action=resolve-block]',
  card: (agent) => `.agent-card[data-agent="${agent}"]`,
  cardStatus: (agent) => `.agent-card[data-agent="${agent}"] .card-status`,
  cardActions: (agent) => `.agent-card[data-agent="${agent}"] .card-actions`,
  missionStatus: '#missionStatus',
  dagNodes: '#dagCanvas .node',
  revisionBtn: '[data-action=revision]',
  reviewPassBtn: '[data-action=review-pass]',
  mergeBtn: '[data-action=merge]',
  modalBg: '#modalBg',
  modalTitle: '#modalTitle',
  settingsTab: (tab) => `.settings-item[data-settings-tab="${tab}"]`,
  updateAction: (action) => `[data-action=${action}]`,
  action: (action) => `[data-action=${action}]`,
  viewTab: (view) => `.view-tab[data-view="${view}"]`,
};

export function selectorsFor(target: ParityTarget): ParitySelectors {
  if (target === 'prototype') return PROTOTYPE_SELECTORS;
  // production 选择器由 Phase 1 M11 填充（data-testid 契约在组件实现时同步登记）
  return {
    paneRows: null,
    paneRow: () => null,
    treeRowsByIndent: () => null,
    paneView: null,
    blockBanner: null,
    resolveBlock: null,
    card: () => null,
    cardStatus: () => null,
    cardActions: () => null,
    missionStatus: null,
    dagNodes: null,
    revisionBtn: null,
    reviewPassBtn: null,
    mergeBtn: null,
    modalBg: null,
    modalTitle: null,
    settingsTab: () => null,
    updateAction: () => null,
    action: () => null,
    viewTab: () => null,
  };
}
