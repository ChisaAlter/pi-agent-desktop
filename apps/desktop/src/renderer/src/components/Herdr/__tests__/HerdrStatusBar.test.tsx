// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HerdrStatusBar } from '../HerdrStatusBar';
import { I18nProvider } from '../../../i18n';
import { useHerdrStore } from '../../../stores/herdr-store';
import zhCN from '../../../i18n/locales/zh-CN.json';
import enUS from '../../../i18n/locales/en.json';

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

/** 原型同款 mock 种子: 会话 pi-desktop · 进程 18420 · Desktop 托管 · v0.9.0 · 完全兼容。 */
function seedMockConnected(): void {
  useHerdrStore.setState({
    mock: true,
    server: 'connected',
    tree: { session: 'pi-desktop', workspaces: [] },
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'piAPI', {
    value: { openSettingsWindow: vi.fn(async () => undefined) },
    configurable: true,
  });
  // 回到 initialState: 非 mock → offline / 空树 (测试环境 __PI_HERDR_MOCK__ 未定义)
  useHerdrStore.getState().reset();
});

describe('HerdrStatusBar — 运行时状态栏', () => {
  it('连接态 (mock): 状态文字 + 会话/进程 + 来源/版本 + 兼容性 pill + ⚙', () => {
    seedMockConnected();
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 已连接')).toBeTruthy();
    expect(screen.getByText('会话：pi-desktop · 进程 18420')).toBeTruthy();
    expect(screen.getByText('Desktop 托管')).toBeTruthy();
    expect(screen.getByText('v0.9.0')).toBeTruthy();
    expect(screen.getByText('完全兼容')).toBeTruthy();

    const dot = screen.getByTestId('herdr-status-dot');
    expect(dot.getAttribute('data-server')).toBe('connected');
    expect(screen.getByTestId('compat-pill')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开设置' })).toBeTruthy();
    expect(screen.getByTestId('herdr-status-bar')).toBeTruthy();
  });

  it('⚙ 点击 → 打开设置窗口 (openSettingsWindow)', () => {
    seedMockConnected();
    renderWithI18n(<HerdrStatusBar />);

    fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(window.piAPI.openSettingsWindow).toHaveBeenCalledTimes(1);
  });

  it('offline 空态 (非 mock): 断线文案 + 空态提示, 无会话/来源/兼容性假数据', () => {
    useHerdrStore.setState({ mock: false, server: 'offline', tree: { session: '', workspaces: [] } });
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 已断开')).toBeTruthy();
    expect(screen.getByText('未检测到 Herdr 运行时')).toBeTruthy();
    expect(screen.getByTestId('herdr-status-dot').getAttribute('data-server')).toBe('offline');
    expect(screen.queryByText(/会话：/)).toBeNull();
    expect(screen.queryByText('Desktop 托管')).toBeNull();
    expect(screen.queryByText('v0.9.0')).toBeNull();
    expect(screen.queryByTestId('compat-pill')).toBeNull();
  });

  it('offline (mock): 断线文案, 不展示会话/进程等运行时信息', () => {
    useHerdrStore.setState({ mock: true, server: 'offline', tree: { session: 'pi-desktop', workspaces: [] } });
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 已断开')).toBeTruthy();
    expect(screen.getByTestId('herdr-status-dot').getAttribute('data-server')).toBe('offline');
    expect(screen.queryByText(/会话：/)).toBeNull();
    expect(screen.queryByText('Desktop 托管')).toBeNull();
    expect(screen.queryByTestId('compat-pill')).toBeNull();
  });

  it('reconnecting: 琥珀色脉冲状态点 + 重连文案 (会话信息保留)', () => {
    useHerdrStore.setState({ mock: true, server: 'reconnecting', tree: { session: 'pi-desktop', workspaces: [] } });
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 正在重连')).toBeTruthy();
    const dot = screen.getByTestId('herdr-status-dot');
    expect(dot.getAttribute('data-server')).toBe('reconnecting');
    expect(dot.className).toContain('pi-motion-running-dot');
    // 重连期间保留上一次已知的会话信息 (mock)
    expect(screen.getByText('会话：pi-desktop · 进程 18420')).toBeTruthy();
  });

  it('非 mock 连接态: 不伪造 pid/来源/版本数据', () => {
    useHerdrStore.setState({ mock: false, server: 'connected', runtimeStatus: null, tree: { session: 'pi-desktop', workspaces: [] } });
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 已连接')).toBeTruthy();
    expect(screen.queryByText(/会话：/)).toBeNull();
    expect(screen.queryByText('Desktop 托管')).toBeNull();
    expect(screen.queryByText('v0.9.0')).toBeNull();
    expect(screen.queryByTestId('compat-pill')).toBeNull();
  });

  it('非 mock 连接态: 只展示 Main 投影里的真实运行时元数据', () => {
    useHerdrStore.setState({
      mock: false,
      server: 'connected',
      tree: { session: 'pi-e2e', workspaces: [] },
      runtimeStatus: {
        connection: 'connected',
        source: 'external',
        version: '0.8.0-preview',
        protocol: 19,
        pid: null,
        owned: false,
        compatibility: 'compatible',
        error: null,
      },
    });
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.getByText('Herdr 已连接')).toBeTruthy();
    expect(screen.getByText('会话：pi-e2e · 进程 —')).toBeTruthy();
    expect(screen.getByText('系统安装')).toBeTruthy();
    expect(screen.getByText('v0.8.0-preview')).toBeTruthy();
    expect(screen.getByText('完全兼容')).toBeTruthy();
    expect(screen.queryByText('v0.9.0')).toBeNull();
    expect(screen.queryByText('Desktop 托管')).toBeNull();
  });

  it('负向断言 (NL-002/NL-065): 无 检查更新/验证/切换 按钮, 唯一按钮是 ⚙', () => {
    seedMockConnected();
    renderWithI18n(<HerdrStatusBar />);

    expect(screen.queryByText(/检查更新|验证|切换/)).toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('打开设置');
  });

  it('i18n 键存在性: herdr.statusBar.* + herdr.tree.empty 在 zh-CN 与 en-US 字典中', () => {
    const statusBarKeys = [
      'connected',
      'offline',
      'reconnecting',
      'sessionProcess',
      'managedByDesktop',
      'systemInstalled',
      'compatible',
      'incompatible',
      'compatUnknown',
      'version',
      'openSettings',
    ];
    for (const locale of [zhCN, enUS]) {
      const statusBar = (locale as { herdr: { statusBar: Record<string, string> } }).herdr.statusBar;
      for (const key of statusBarKeys) {
        expect(typeof statusBar[key]).toBe('string');
        expect(statusBar[key].length).toBeGreaterThan(0);
      }
      expect((locale as { herdr: { tree: { empty: string } } }).herdr.tree.empty.length).toBeGreaterThan(0);
    }
    // 中文断言值固定 (本文件其余断言依赖)
    expect(zhCN.herdr.statusBar.connected).toBe('Herdr 已连接');
    expect(zhCN.herdr.statusBar.offline).toBe('Herdr 已断开');
    expect(zhCN.herdr.statusBar.reconnecting).toBe('Herdr 正在重连');
    expect(zhCN.herdr.tree.empty).toBe('未检测到 Herdr 运行时');
  });
});
