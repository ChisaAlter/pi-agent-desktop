/**
 * Parity 目标抽象：同一套对齐流可跑「原型」（oracle）或「生产」（mock 模式）。
 *
 *   HERDR_PARITY_TARGET=prototype  → 驱动 docs/prototypes/herdr-desktop-ui-prototype.html
 *   HERDR_PARITY_TARGET=production → 驱动打包产物（PI_HERDR_MOCK=1，需先 build）
 *
 * G0 用 prototype 目标验证框架与原型交互流；M11 起 production 目标在真实应用上
 * 重跑同一套断言。生产选择器 = data-testid 契约（组件实现时同步登记）。
 */
import { _electron, chromium, type ElectronApplication, type Page } from '@playwright/test';
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
  return openProductionParitySession();
}

/** production: 打包产物 + PI_HERDR_MOCK=1（mock 运行时），自动进入「智能体」section。 */
async function openProductionParitySession(): Promise<ParitySession> {
  // __dirname = apps/desktop/e2e/herdr/prototype-parity → 三级上溯到 apps/desktop
  const entry = path.resolve(__dirname, '../../../out/main/index.js');
  const userDataDir = path.join(process.env.TEMP ?? '/tmp', `herdr-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const app: ElectronApplication = await _electron.launch({
    args: [`--user-data-dir=${userDataDir}`, entry],
    env: { ...process.env, PI_HERDR_MOCK: '1', CI: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForLoadState('domcontentloaded');
  // 跳过 onboarding（modal 可能延迟挂载，先等 tab 出现再处理）
  const agentsTab = page.locator('[data-mmcode-tab="agents"]');
  await agentsTab.waitFor({ timeout: 120_000 });
  const modal = page.locator('[data-testid="onboarding-modal"]');
  if (await modal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '跳过引导' }).click({ timeout: 10_000 });
    await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }
  // 进入「智能体」section（mock 舰队）；冷启动时点击可能落在挂载前，重试导航
  await agentsTab.click();
  const surface = page.locator('[data-testid="herdr-control-surface"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    const visible = await surface.isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(1500);
    await agentsTab.click({ timeout: 10_000 }).catch(() => undefined);
  }
  await surface.waitFor({ state: 'visible', timeout: 15_000 });
  return { page, target: 'production' as const, close: () => app.close() };
}

/**
 * 目标感知选择器：prototype 用原型 DOM；production 用 data-testid 契约。
 * 尚未在 production 实现的交互返回 null（对应测试跳过并标注）。
 */
export interface ParitySelectors {
  /** 全部 pane 行（层级树第 4 级） */
  paneRows: string | null;
  /** 树中 pane 行（pane 名称 → 行选择器） */
  paneRow(pane: string): string | null;
  /** 树层级结构（indent1=工作区 / indent2=标签 / indent3=窗格） */
  treeRowsByIndent(indent: number): string | null;
  /** pane 视图容器 */
  paneView: string | null;
  /** 面包屑 */
  paneCrumb: string | null;
  /** 终端正文 */
  paneTerminal: string | null;
  /** 状态变更序号 */
  stateSeq: string | null;
  /** blocked 横幅 */
  blockBanner: string | null;
  /** 处理 blocked 主按钮 */
  resolveBlock: string | null;
  /** 全部舰队卡片 */
  cardAll: string | null;
  /** fleet 视图中的卡片（agent 名 → 卡片选择器） */
  card(agent: string): string | null;
  /** 卡片状态徽章 */
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
  /** 设置导航 tab（Phase 2 接线） */
  settingsTab(tab: string): string | null;
  /** 设置内更新流按钮（Phase 2 接线） */
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
  paneCrumb: '#paneCrumb',
  paneTerminal: '#terminal',
  stateSeq: '#stateSeq',
  blockBanner: '#blockBanner',
  resolveBlock: '[data-action=resolve-block]',
  cardAll: '.agent-card',
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

/** 生产 data-testid 契约（组件实现时同步登记，见各组件头部注释）。 */
const PRODUCTION_SELECTORS: ParitySelectors = {
  paneRows: '[data-testid=herdr-pane-row]',
  paneRow: (pane) => `[data-testid=herdr-pane-row][data-agent="${pane}"]`,
  treeRowsByIndent: (indent) =>
    indent === 1 ? '[data-testid=herdr-ws-row]' : indent === 2 ? '[data-testid=herdr-tab-row]' : '[data-testid=herdr-pane-row]',
  paneView: '[data-testid=herdr-pane-view]',
  paneCrumb: '[data-testid=pane-crumb]',
  paneTerminal: '[data-testid=pane-terminal]',
  stateSeq: '[data-testid=state-seq]',
  blockBanner: '[data-testid=block-banner]',
  resolveBlock: '[data-testid=resolve-block]',
  cardAll: '[data-testid=agent-card]',
  card: (agent) => `[data-testid=agent-card][data-agent="${agent}"]`,
  cardStatus: (agent) => `[data-testid=agent-card][data-agent="${agent}"] [data-agent-status]`,
  cardActions: (agent) => `[data-testid=agent-card][data-agent="${agent}"] [data-testid=card-actions]`,
  missionStatus: '[data-testid=mission-status]',
  dagNodes: '[data-testid=dag-node]',
  revisionBtn: '[data-testid=revision-btn]',
  reviewPassBtn: '[data-testid=review-pass-btn]',
  mergeBtn: '[data-testid=merge-btn]',
  modalBg: '[data-testid=merge-confirm-modal]',
  modalTitle: '[data-testid=merge-confirm-modal]',
  // 设置相关在 Phase 2（HerdrTab）接线，当前返回 null → 对应流跳过
  settingsTab: () => null,
  updateAction: () => null,
  action: (action) =>
    action === 'plan'
      ? '[data-testid=mission-plan]'
      : action === 'run-mission'
        ? '[data-testid=mission-run]'
        : action === 'revision'
          ? '[data-testid=revision-btn]'
          : action === 'review-pass'
            ? '[data-testid=review-pass-btn]'
            : action === 'merge'
              ? '[data-testid=merge-btn]'
              : null,
  viewTab: (view) => `[data-testid=herdr-view-tab][data-view="${view}"]`,
};

export function selectorsFor(target: ParityTarget): ParitySelectors {
  return target === 'prototype' ? PROTOTYPE_SELECTORS : PRODUCTION_SELECTORS;
}
