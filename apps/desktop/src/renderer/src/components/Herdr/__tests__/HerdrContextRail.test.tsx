// @vitest-environment jsdom
// HerdrContextRail — 右侧选中联动上下文详情测试（jsdom + zh-CN；种子数据 =
// 原型同款 mock agents + server connected + selectedAgent=auth-worker）。
// 覆盖: 4 区完整渲染 / 切换选中联动 / 未选中空态 / 断线 → 状态 pill 连接已断开。

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { HerdrContextRail } from '../HerdrContextRail';
import { buildHerdrTree, useHerdrStore } from '../../../stores/herdr-store';
import { HERDR_MOCK_AGENTS, HERDR_MOCK_SESSION } from '../../../stores/herdr-mock-data';

const renderRail = () => render(<I18nProvider><HerdrContextRail /></I18nProvider>);

// 身份区 dd 的 displayName 用 <b> 包裹（原型 <b>${displayName}</b> · kind），
// getByText 默认只匹配元素直接文本节点, 跨元素文本需按 textContent 匹配。
const ddByText = (text: string) => (_content: string, element: Element | null): boolean =>
  element !== null && element.tagName === 'DD' && element.textContent === text;

beforeEach(() => {
  useHerdrStore.setState({
    server: 'connected',
    view: 'fleet',
    selectedAgent: 'auth-worker',
    agents: HERDR_MOCK_AGENTS,
    tree: buildHerdrTree(HERDR_MOCK_SESSION, HERDR_MOCK_AGENTS),
    missionAttempt: 1,
  });
});

describe('HerdrContextRail — 右侧上下文详情', () => {
  it('选中 auth-worker: 渲染 4 区 (身份/能力/租约/证据边界) + 全部字段', () => {
    renderRail();

    // 根 + header
    expect(screen.getByTestId('herdr-context-rail')).toBeTruthy();
    expect(screen.getByText('上下文详情')).toBeTruthy();
    expect(screen.getByText('Herdr')).toBeTruthy();

    // Section 1 — 当前终端窗格 (rail-identity)
    expect(screen.getByTestId('rail-identity')).toBeTruthy();
    expect(screen.getByText('当前终端窗格')).toBeTruthy();
    expect(screen.getByText(ddByText('认证实现智能体 · Pi'))).toBeTruthy();
    // 层级字符串 = tree.session / workspace / tab / pane, 含 p-02
    expect(screen.getByText('pi-desktop / primary / implementation / p-02')).toBeTruthy();
    expect(screen.getByText('官方 Herdr · 已连接')).toBeTruthy();
    expect(screen.getByText('已阻塞')).toBeTruthy();
    expect(screen.getByText('Herdr Pi 生命周期钩子')).toBeTruthy();
    expect(screen.getByText('auth.jsonl')).toBeTruthy();

    // Section 2 — 可用能力 (rail-capabilities): 6 项 pill
    const capabilities = screen.getByTestId('rail-capabilities');
    expect(capabilities).toBeTruthy();
    expect(screen.getByText('可用能力')).toBeTruthy();
    for (const cap of ['发送指令', '等待', '读取', '发送按键', '实时连接', '恢复会话']) {
      expect(screen.getByText(cap)).toBeTruthy();
    }
    expect(capabilities.querySelectorAll('span')).toHaveLength(6);

    // Section 3 — 工作树租约 (rail-lease)
    const lease = screen.getByTestId('rail-lease');
    expect(lease).toBeTruthy();
    expect(screen.getByText('工作树租约')).toBeTruthy();
    expect(screen.getByText('wt/auth-fix')).toBeTruthy();
    expect(screen.getByText('herdr/auth-worker')).toBeTruthy();
    expect(screen.getByText('任务/auth-hardening · 轮次 1')).toBeTruthy();

    // Section 4 — 证据边界 (rail-evidence, NL-013 负向检查: 必须存在)
    const evidence = screen.getByTestId('rail-evidence');
    expect(evidence).toBeTruthy();
    expect(screen.getByText('证据边界')).toBeTruthy();
    expect(screen.getByText(/生产版必须从 Herdr 快照、事件序号、窗格／终端身份及 Git 提交反查/)).toBeTruthy();
  });

  it('切换选中 reviewer → 联动更新身份/层级/租约/状态', () => {
    renderRail();
    expect(screen.getByText(ddByText('认证实现智能体 · Pi'))).toBeTruthy();

    act(() => {
      useHerdrStore.setState({ selectedAgent: 'reviewer' });
    });

    // 身份区联动
    expect(screen.getByText(ddByText('审查智能体 · Claude'))).toBeTruthy();
    expect(screen.getByText('pi-desktop / wt/auth-fix / 审查中 / p-04')).toBeTruthy();
    expect(screen.getByText('Herdr Claude 生命周期钩子')).toBeTruthy();
    expect(screen.getByText('claude:review-12')).toBeTruthy();
    expect(screen.getByText('空闲')).toBeTruthy();
    // 租约联动: 分支 herdr/{name}, 工作区 agent.worktree
    expect(screen.getByText('herdr/reviewer')).toBeTruthy();
    expect(screen.getByText('wt/auth-review')).toBeTruthy();
    // 旧选中内容消失
    expect(screen.queryByText(ddByText('认证实现智能体 · Pi'))).toBeNull();
    expect(screen.queryByText('herdr/auth-worker')).toBeNull();
  });

  it('未选中 agent → herdr.rail.empty 空态, 不渲染任何 section', () => {
    useHerdrStore.setState({ selectedAgent: null });
    renderRail();

    expect(screen.getByTestId('herdr-context-rail')).toBeTruthy();
    expect(screen.getByText('上下文详情')).toBeTruthy();
    expect(screen.getByText('选中智能体后显示上下文')).toBeTruthy();
    expect(screen.queryByTestId('rail-identity')).toBeNull();
    expect(screen.queryByTestId('rail-capabilities')).toBeNull();
    expect(screen.queryByTestId('rail-lease')).toBeNull();
    expect(screen.queryByTestId('rail-evidence')).toBeNull();
  });

  it('server 断线 → 状态 pill 显示「连接已断开」, 运行时映射 offline', () => {
    useHerdrStore.setState({ server: 'offline' });
    renderRail();

    expect(screen.getByText('官方 Herdr · 已断开')).toBeTruthy();
    expect(screen.getByText('连接已断开')).toBeTruthy();
    const pill = screen.getByTestId('rail-status-pill');
    expect(pill.getAttribute('data-state')).toBe('disconnected');
    // 禁陈旧 done/blocked: 断线时展示态一律 disconnected
    expect(pill.textContent).toBe('连接已断开');
  });

  it('server reconnecting → 运行时映射 runtimeReconnecting, 状态仍为 disconnected', () => {
    useHerdrStore.setState({ server: 'reconnecting' });
    renderRail();

    expect(screen.getByText('官方 Herdr · 正在重连')).toBeTruthy();
    expect(screen.getByText('连接已断开')).toBeTruthy();
    expect(screen.getByTestId('rail-status-pill').getAttribute('data-state')).toBe('disconnected');
  });
});
