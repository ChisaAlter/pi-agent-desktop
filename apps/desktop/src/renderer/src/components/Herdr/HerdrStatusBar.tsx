import React from 'react';
import { useI18n } from '../../i18n';
import { useHerdrStore, type HerdrServerState } from '../../stores/herdr-store';

/**
 * HerdrStatusBar — Herdr 控制面顶部的运行时状态栏。
 * 视觉基准: docs/prototypes/herdr-desktop-ui-prototype.html 的 .serverbar
 * (min-height 54px, 浅色 #fbfcfe 底 + 下边框):
 *   [●状态点] Herdr 已连接     [pill: Desktop 托管] v0.9.0    [pill: 完全兼容]     [⚙]
 *          会话：pi-desktop · 进程 18420
 *
 * 数据源: herdr-store 的 Main 权威投影。只在智能体/任务编排 tab 挂载，
 * 不打断对话页。非 mock 一律不伪造数据 (D6/NL-010)。
 *
 * 负向清单 (NL-002/NL-065): 本栏只保留 连接状态 + 会话/进程、来源 + 版本、
 * 兼容性、⚙ 设置入口；其余运行时操作一律收敛到设置窗口（见 check-herdr-ui.cjs）。
 */
const DOT_STYLE: Record<HerdrServerState, string> = {
  // 原型 .status-dot: 9px 圆点 + 4px 光晕 (绿 #16845b / 灰 #7c8798 / 琥珀 #b56a0b)
  connected: 'bg-[#16845b] shadow-[0_0_0_4px_#dcf5e9]',
  offline: 'bg-[#7c8798] shadow-[0_0_0_4px_#e6e9ed]',
  // 琥珀脉冲 — 复用代码库 pi-motion-running-dot (1050ms 呼吸 ≈ 原型 1s pulse)
  reconnecting: 'bg-[#b56a0b] shadow-[0_0_0_4px_#f8ebd4] pi-motion-running-dot',
};

/** 兼容性 pill — 原型 .pill.good / .pill.bad / .pill (未知)。 */
const COMPAT_PILL_STYLE: Record<'compatible' | 'incompatible' | 'unknown', string> = {
  compatible: 'bg-[#e5f5ed] text-[#14734f]',
  incompatible: 'bg-[#fde9eb] text-[#a4313e]',
  unknown: 'bg-[#edf1f6] text-[#516074]',
};

// MOCK — 原型同款状态栏数据 (pid 18420 / 来源 Desktop 托管 / v0.9.0)。
// 仅 mock 模式展示；生产接入前禁止伪造运行时数据 (D6/NL-010)。
const MOCK_HERDR_PID = 18420;
const MOCK_HERDR_VERSION = '0.9.0';
const MOCK_COMPAT: 'compatible' = 'compatible';

export function HerdrStatusBar(): React.JSX.Element {
  const { t } = useI18n();
  const mock = useHerdrStore((s) => s.mock);
  const server = useHerdrStore((s) => s.server);
  const session = useHerdrStore((s) => s.tree.session);
  const runtimeStatus = useHerdrStore((s) => s.runtimeStatus);

  const statusText = t(`herdr.statusBar.${server}`);
  const settingsTitle = t('herdr.statusBar.openSettings');

  // 空态: server=offline 且非 mock → 断线文案 + herdr.tree.empty 提示, 无假数据
  const empty = server === 'offline' && !mock;
  // mock 仍用原型固定值；真实路径只展示 Main 投影里的运行时元数据，禁止伪造
  const showRuntime = server !== 'offline' && (mock || runtimeStatus !== null);
  const pid = mock ? MOCK_HERDR_PID : runtimeStatus?.pid;
  const version = mock ? MOCK_HERDR_VERSION : runtimeStatus?.version;
  const compat = mock ? MOCK_COMPAT : (runtimeStatus?.compatibility ?? 'unknown');
  const sourceOwned = mock || runtimeStatus?.owned === true;
  const sessionLine =
    showRuntime && session
      ? t('herdr.statusBar.sessionProcess', { session, pid: pid == null ? '—' : String(pid) })
      : null;

  return (
    <section
      data-testid="herdr-status-bar"
      className="flex min-h-[54px] flex-wrap items-center gap-4 border-b border-[#dfe4eb] bg-[#fbfcfe] px-3.5 py-2"
    >
      <div className="flex min-w-[240px] items-center gap-2">
        <span
          data-testid="herdr-status-dot"
          data-server={server}
          aria-hidden="true"
          className={`h-[9px] w-[9px] shrink-0 rounded-full ${DOT_STYLE[server]}`}
        />
        <div className="min-w-0">
          <b className="block text-[13px] font-semibold leading-5 text-[#172033]">{statusText}</b>
          {sessionLine ? (
            <div className="truncate text-[10px] leading-4 text-[#687386]">{sessionLine}</div>
          ) : empty ? (
            <div className="truncate text-[10px] leading-4 text-[#687386]" data-testid="herdr-status-empty-hint">
              {t('herdr.tree.empty')}
            </div>
          ) : null}
        </div>
      </div>

      {showRuntime ? (
        <div className="flex items-center gap-[7px] text-[#687386]">
          <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-[#eaf1ff] px-2 py-1 text-[11px] text-[#2458bd]">
            {t(sourceOwned ? 'herdr.statusBar.managedByDesktop' : 'herdr.statusBar.systemInstalled')}
          </span>
          {version ? (
            <span className="whitespace-nowrap text-[11px]">
              {t('herdr.statusBar.version', { version })}
            </span>
          ) : null}
        </div>
      ) : null}

      {showRuntime ? (
        <div className="flex items-center gap-[7px] text-[#687386]">
          <span
            data-testid="compat-pill"
            className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-1 text-[11px] ${COMPAT_PILL_STYLE[compat]}`}
          >
            {t(`herdr.statusBar.${compat === 'unknown' ? 'compatUnknown' : compat}`)}
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void window.piAPI?.openSettingsWindow()}
          title={settingsTitle}
          aria-label={settingsTitle}
          className="grid h-[30px] w-[30px] place-items-center rounded-md border border-[#dfe4eb] bg-white text-[13px] text-[#516074] transition-colors hover:bg-[#f8fafc] hover:text-[#172033]"
        >
          ⚙
        </button>
      </div>
    </section>
  );
}
