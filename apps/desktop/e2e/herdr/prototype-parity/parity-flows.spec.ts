/**
 * Parity 交互流 — 与原型定义的操作序列一一对应的生产对齐流。
 *
 * 同一条流可对 prototype（oracle）与 production（mock 模式）运行：
 *   HERDR_PARITY_TARGET=prototype  npx playwright test --config=playwright.parity.config.ts
 *   HERDR_PARITY_TARGET=production npx playwright test e2e/herdr/prototype-parity  (需先 build)
 *
 * G0 覆盖第 1 条流（层级树 → 选中 pane → 实时终端 → blocked 处理 → seen → 断线），
 * 断言与原型行为一一对应；M11 扩展其余流并在 production 重跑。
 */
import { test, expect } from '@playwright/test';
import { openParitySession, parityTarget, selectorsFor } from './parity-target';

test.describe('parity: 层级树 → 实时终端 → blocked 处理 → seen → 断线', () => {
  test('树显示 4 级层级（会话/工作区/标签/窗格），pane 带状态点与身份', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.paneView === null, `production 选择器未就绪（Phase 1 M11）`);

    // 4 级结构：indent1=工作区行(2)、indent2=标签行(3)、indent3=窗格行(4)
    await expect(page.locator(sel.paneRows!)).toHaveCount(4);
    await expect(page.locator(sel.treeRowsByIndent(1)!)).toHaveCount(2);
    await expect(page.locator(sel.treeRowsByIndent(2)!)).toHaveCount(3);
    await expect(page.locator(sel.treeRowsByIndent(3)!)).toHaveCount(4);
    // 身份子文本: Pi · p-01 / Codex · 待查看
    await expect(page.locator(sel.paneRow('auth-worker'))).toContainText('Pi · p-02');
    await expect(page.locator(sel.paneRow('tests-worker'))).toContainText('待查看');
    await close();
  });

  test('点 pane → 打开实时终端；blocked 横幅独立一行', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.paneView === null, `production 选择器未就绪（Phase 1 M11）`);

    await page.click(sel.paneRow('auth-worker'));
    await expect(page.locator(sel.paneView)).toBeVisible();
    // 面包屑含 pane 名（选中联动）
    await expect(page.locator('#paneCrumb')).toContainText('auth-worker');
    // blocked 横幅独立可见（「智能体被阻塞」+ 主按钮）
    await expect(page.locator(sel.blockBanner!)).toBeVisible();
    await expect(page.locator(sel.blockBanner!)).toContainText('智能体被阻塞');
    await close();
  });

  test('blocked 在真实 pane 内处理（横幅消失 + 序号前进 + 终端追加批准行）', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.paneView === null, `production 选择器未就绪（Phase 1 M11）`);

    await page.click(sel.paneRow('auth-worker'));
    const seqBefore = await page.locator('#stateSeq').textContent();
    await page.click(sel.resolveBlock!);
    await expect(page.locator(sel.blockBanner!)).toBeHidden();
    await expect(page.locator('#terminal')).toContainText('已在终端窗格中批准');
    const seqAfter = await page.locator('#stateSeq').textContent();
    expect(Number(seqAfter)).toBeGreaterThan(Number(seqBefore));
    await close();
  });

  test('seen 语义: done 卡片「标记已查看」→ 状态变空闲', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.paneView === null, `production 选择器未就绪（Phase 1 M11）`);

    // tests-worker 初始为 done（已完成 · 待查看）
    await expect(page.locator(sel.cardStatus('tests-worker')!)).toContainText('待查看');
    // 主 CTA（操作条第一个按钮）为「标记已查看」
    await page.locator(sel.cardActions('tests-worker')!).locator('button').first().click();
    await expect(page.locator(sel.cardStatus('tests-worker')!)).toContainText('空闲');
    await close();
  });

  test('断线 → 全部卡片 disconnected，禁止陈旧 done', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.paneView === null, `production 选择器未就绪（Phase 1 M11）`);

    // 原型无断线按钮，直接驱动状态机（生产版由连接监督器驱动）
    await page.evaluate(() => (window as unknown as { setServer: (s: string) => void }).setServer('offline'));
    const cards = page.locator('.agent-card');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toHaveAttribute('data-state', 'disconnected');
    }
    await close();
  });
});

test.describe('parity: mission 全流程闭环（生成→开始→驳回→修订→复审→合入确认）', () => {
  test('完整闭环到「最终合入确认」模态', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.missionStatus === null, `production 选择器未就绪（Phase 1 M11）`);

    await page.click(sel.viewTab('mission')!);
    // 草稿 → 生成任务图 → 已规划 + 4 节点
    await expect(page.locator(sel.missionStatus!)).toHaveText('草稿');
    await page.click(sel.action('plan')!);
    await expect(page.locator(sel.missionStatus!)).toHaveText('已规划');
    await expect(page.locator(sel.dagNodes!)).toHaveCount(4);
    // 开始任务 → 执行中 → 审查中（原型 2200ms 定时器）
    await page.click(sel.action('run-mission')!);
    await expect(page.locator(sel.missionStatus!)).toHaveText('执行中');
    await expect(page.locator(sel.revisionBtn!)).toBeVisible({ timeout: 10_000 });
    // 驳回 → 创建修订轮次 2 → 完成修订并复审 → 已通过
    await page.click(sel.revisionBtn!);
    await expect(page.locator(sel.reviewPassBtn!)).toBeVisible();
    await page.click(sel.reviewPassBtn!);
    await expect(page.locator(sel.missionStatus!)).toHaveText('已通过');
    // 整合 → 请求合入 → 用户确认模态（不得自动合入）
    await page.click(sel.mergeBtn!);
    await expect(page.locator(sel.modalBg!)).toBeVisible();
    await expect(page.locator(sel.modalTitle!)).toHaveText('最终合入确认');
    await close();
  });
});

test.describe('parity: 设置更新流（检查→验证→安全切换）', () => {
  test('兼容性 tab 的更新三步流程', async () => {
    const target = parityTarget();
    const { page, close } = await openParitySession();
    const sel = selectorsFor(target);
    test.skip(sel.settingsTab === null, `production 选择器未就绪（Phase 1 M11）`);

    await page.click(sel.action('open-settings')!);
    await page.click(sel.settingsTab('compat')!);
    // 检查更新 → 候选版本面板出现
    await page.click(sel.updateAction('check-update')!);
    await expect(page.locator('[data-action=verify-update]')).toBeVisible();
    // 验证候选版 → 已验证
    await page.click(sel.updateAction('verify-update')!);
    await expect(page.locator('#compatPill')).toHaveText('完全兼容');
    // 安全切换 → 等待安全切换点模态（有智能体运行不静默重启）
    await page.click(sel.updateAction('switch-update')!);
    await expect(page.locator(sel.modalBg!)).toBeVisible();
    await expect(page.locator(sel.modalTitle!)).toHaveText('等待安全切换点');
    await close();
  });
});
