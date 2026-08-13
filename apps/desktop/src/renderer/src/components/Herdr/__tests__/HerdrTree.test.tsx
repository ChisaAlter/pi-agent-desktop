// @vitest-environment jsdom
// HerdrTree — 左侧 4 级层级树测试（jsdom + zh-CN；种子数据 = 原型同款 mock agents）。

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { HerdrTree } from '../HerdrTree';
import { buildHerdrTree, useHerdrStore } from '../../../stores/herdr-store';
import { HERDR_MOCK_AGENTS, HERDR_MOCK_SESSION } from '../../../stores/herdr-mock-data';

const renderTree = () => render(<I18nProvider><HerdrTree /></I18nProvider>);

beforeEach(() => {
  useHerdrStore.setState({
    server: 'connected',
    view: 'fleet',
    selectedAgent: null,
    agents: HERDR_MOCK_AGENTS,
    tree: buildHerdrTree(HERDR_MOCK_SESSION, HERDR_MOCK_AGENTS),
  });
});

describe('HerdrTree — 4 级层级树', () => {
  it('渲染 4 级结构: 会话 → 2 工作区 → 3 标签 → 4 pane, 含 testid 契约', () => {
    renderTree();

    // 根 + 头部
    expect(screen.getByTestId('herdr-tree')).toBeTruthy();
    expect(screen.getByText('Herdr 运行时')).toBeTruthy();
    expect(screen.getByTitle('创建')).toBeTruthy();

    // 会话行常显
    expect(screen.getByTestId('herdr-session-row')).toBeTruthy();
    expect(screen.getByText('◫ 会话')).toBeTruthy();
    expect(screen.getByText('pi-desktop')).toBeTruthy();

    // 工作区行（data-ws + data-kind）
    const wsRows = screen.getAllByTestId('herdr-ws-row');
    expect(wsRows).toHaveLength(2);
    expect(wsRows[0].getAttribute('data-ws')).toBe('primary');
    expect(wsRows[0].getAttribute('data-kind')).toBe('workspace');
    expect(wsRows[1].getAttribute('data-ws')).toBe('wt/auth-fix');
    expect(wsRows[1].getAttribute('data-kind')).toBe('worktree');
    expect(screen.getByText('工作区')).toBeTruthy();
    expect(screen.getByText('工作树')).toBeTruthy();

    // 标签行
    expect(screen.getAllByTestId('herdr-tab-row')).toHaveLength(3);

    // pane 行（data-agent + data-state = 展示态）
    const paneRows = screen.getAllByTestId('herdr-pane-row');
    expect(paneRows).toHaveLength(4);
    expect(paneRows.map((r) => r.getAttribute('data-agent'))).toEqual(['planner', 'auth-worker', 'tests-worker', 'reviewer']);
    expect(paneRows.map((r) => r.getAttribute('data-state'))).toEqual(['working', 'blocked', 'done', 'idle']);

    // sub 文案: kind · pane; done 显示 待查看 后缀
    expect(screen.getByText('Pi · p-01')).toBeTruthy();
    expect(screen.getByText('Pi · p-02')).toBeTruthy();
    expect(screen.getByText('Codex · 待查看')).toBeTruthy();
    expect(screen.getByText('Claude · p-04')).toBeTruthy();
  });

  it('点击会话行折叠全部工作区（会话行常显）', () => {
    renderTree();
    fireEvent.click(screen.getByTestId('herdr-session-row'));
    expect(screen.queryAllByTestId('herdr-ws-row')).toHaveLength(0);
    expect(screen.getByTestId('herdr-session-row')).toBeTruthy();
    expect(screen.getByText('›')).toBeTruthy(); // chevron 变为收起态
    // 展开恢复
    fireEvent.click(screen.getByTestId('herdr-session-row'));
    expect(screen.getAllByTestId('herdr-ws-row')).toHaveLength(2);
  });

  it('点击工作区行折叠/展开子树', () => {
    renderTree();
    fireEvent.click(screen.getAllByTestId('herdr-ws-row')[0]); // primary 折叠
    expect(screen.getAllByTestId('herdr-tab-row')).toHaveLength(1); // 只剩 审查中
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(1); // 只剩 reviewer
    fireEvent.click(screen.getAllByTestId('herdr-ws-row')[0]); // 展开
    expect(screen.getAllByTestId('herdr-tab-row')).toHaveLength(3);
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(4);
  });

  it('点击标签行折叠 pane 行', () => {
    renderTree();
    fireEvent.click(screen.getAllByTestId('herdr-tab-row')[1]); // implementation 折叠
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(2); // planner + reviewer
    fireEvent.click(screen.getAllByTestId('herdr-tab-row')[1]); // 展开
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(4);
  });

  it('搜索框按文本过滤 pane 行, 结构保留', () => {
    renderTree();
    const search = screen.getByTestId('herdr-tree-search');
    expect(search.getAttribute('placeholder')).toBe('搜索终端窗格、智能体或工作区');

    fireEvent.change(search, { target: { value: '审查' } });
    let paneRows = screen.getAllByTestId('herdr-pane-row');
    expect(paneRows).toHaveLength(1);
    expect(paneRows[0].getAttribute('data-agent')).toBe('reviewer');
    // 结构与父级行保留（原型只隐藏 pane 行）
    expect(screen.getAllByTestId('herdr-tab-row')).toHaveLength(3);

    // 按 pane 编号搜索
    fireEvent.change(search, { target: { value: 'p-02' } });
    paneRows = screen.getAllByTestId('herdr-pane-row');
    expect(paneRows).toHaveLength(1);
    expect(paneRows[0].getAttribute('data-agent')).toBe('auth-worker');

    // 清空恢复
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(4);
  });

  it('状态过滤: 全部/阻塞/待查看（done 即待查看）', () => {
    renderTree();
    const filters = screen.getAllByTestId('herdr-filter');
    expect(filters.map((b) => b.getAttribute('data-filter'))).toEqual(['all', 'blocked', 'done']);

    fireEvent.click(screen.getByText('阻塞'));
    let paneRows = screen.getAllByTestId('herdr-pane-row');
    expect(paneRows).toHaveLength(1);
    expect(paneRows[0].getAttribute('data-agent')).toBe('auth-worker');
    expect(paneRows[0].getAttribute('data-state')).toBe('blocked');

    fireEvent.click(screen.getByText('待查看'));
    paneRows = screen.getAllByTestId('herdr-pane-row');
    expect(paneRows).toHaveLength(1);
    expect(paneRows[0].getAttribute('data-agent')).toBe('tests-worker');
    expect(paneRows[0].getAttribute('data-state')).toBe('done');

    fireEvent.click(screen.getByText('全部'));
    expect(screen.getAllByTestId('herdr-pane-row')).toHaveLength(4);
  });

  it('点击 pane 行 → selectAgent + setView("pane")（断言 store 状态）', () => {
    renderTree();
    fireEvent.click(screen.getAllByTestId('herdr-pane-row')[1]); // auth-worker
    expect(useHerdrStore.getState().selectedAgent).toBe('auth-worker');
    expect(useHerdrStore.getState().view).toBe('pane');

    fireEvent.click(screen.getAllByTestId('herdr-pane-row')[3]); // reviewer
    expect(useHerdrStore.getState().selectedAgent).toBe('reviewer');
    expect(useHerdrStore.getState().view).toBe('pane');
  });

  it('选中 pane 行高亮（#e8f0ff 底）', () => {
    renderTree();
    const rows = screen.getAllByTestId('herdr-pane-row');
    fireEvent.click(rows[3]); // reviewer
    expect(rows[3].classList.contains('selected')).toBe(true);
    expect(rows[3].style.background).toBe('rgb(232, 240, 255)');
    expect(rows[0].classList.contains('selected')).toBe(false);
  });

  it('store.selectedAgent 预选 → 对应行高亮', () => {
    useHerdrStore.setState({ selectedAgent: 'planner' });
    renderTree();
    const rows = screen.getAllByTestId('herdr-pane-row');
    expect(rows[0].classList.contains('selected')).toBe(true);
    expect(rows[1].classList.contains('selected')).toBe(false);
  });

  it('server 断线 → 全部 pane 行 data-state=disconnected（禁陈旧 done）', () => {
    useHerdrStore.setState({ server: 'offline' });
    renderTree();
    const rows = screen.getAllByTestId('herdr-pane-row');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.getAttribute('data-state')).toBe('disconnected');
    }
    // 断线时 待查看 过滤不命中任何行
    fireEvent.click(screen.getByText('待查看'));
    expect(screen.queryAllByTestId('herdr-pane-row')).toHaveLength(0);
  });

  it('空树（非 mock）→ 显示 herdr.tree.empty 空态', () => {
    useHerdrStore.setState({ server: 'offline', agents: [], tree: { session: '', workspaces: [] } });
    renderTree();
    expect(screen.getByTestId('herdr-tree-empty')).toBeTruthy();
    expect(screen.getByText('未检测到 Herdr 运行时')).toBeTruthy();
    expect(screen.queryAllByTestId('herdr-pane-row')).toHaveLength(0);
    expect(screen.queryAllByTestId('herdr-ws-row')).toHaveLength(0);
  });
});
