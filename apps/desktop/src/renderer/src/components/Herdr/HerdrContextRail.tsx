/**
 * HerdrContextRail — Herdr 控制面右侧「上下文详情」面板（选中联动）。
 *
 * 视觉基准: docs/prototypes/herdr-desktop-ui-prototype.html 的 renderRail()
 * (line 167) + .right/.section-head/.rail-section/.dl/.cap-list/.pill CSS:
 *   310px 面板 → 45px section-head（标题 + Herdr pill）→ 4 个 rail-section
 *   （padding 13px, border-bottom 分隔）: 当前终端窗格(dl 86px 两列) /
 *   可用能力(pill 组) / 工作树租约(dl) / 证据边界(说明文字)。
 *
 * 数据源: useHerdrStore (selectedAgent/agents/server/missionAttempt/tree.session)。
 *   层级 = tree.session / agent.workspace / agent.tab / agent.pane;
 *   分支 = herdr/{agent.name}; 归属轮次 = missionAttempt;
 *   展示态走 displayStateOf (server 断线 → disconnected, 禁陈旧 done)。
 *   状态 pill 色: done=琥珀 warn / blocked|disconnected=红 bad / working=蓝 /
 *   idle=绿 / unknown=灰。
 *
 * 负向清单 (NL-013): 证据边界 section 必须存在 — 生产版不得从界面卡片推导
 * 运行状态, 必须从 Herdr 快照、事件序号、窗格／终端身份及 Git 提交反查。
 * 未选中 agent 时显示 herdr.rail.empty 空态（不渲染任何 section）。
 */
import React from 'react';
import { useI18n } from '../../i18n';
import {
  displayStateOf,
  useHerdrStore,
  type HerdrDisplayState,
  type HerdrServerState,
} from '../../stores/herdr-store';

/** 能力 pill 组 — 与原型 renderRail() 的 cap-list 顺序一致。 */
const CAPABILITIES = ['capSendPrompt', 'capWait', 'capRead', 'capSendKeys', 'capLiveAttach', 'capResume'] as const;

/** 状态 pill 色 — 原型 .pill.warn/.bad/.blue/.good + unknown 灰（默认 .pill）。 */
const PILL_STYLE: Record<HerdrDisplayState, string> = {
  done: 'bg-[#fff0d9] text-[#96600f]',
  blocked: 'bg-[#fde9eb] text-[#a4313e]',
  disconnected: 'bg-[#fde9eb] text-[#a4313e]',
  working: 'bg-[#eaf1ff] text-[#2458bd]',
  idle: 'bg-[#e5f5ed] text-[#14734f]',
  unknown: 'bg-[#edf1f6] text-[#516074]',
};

const BASE_PILL = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-1 text-[11px]';

/** 原型 .pill（灰底中性）— 能力项与 header 外 pill 的默认样式。 */
const NEUTRAL_PILL = `${BASE_PILL} bg-[#edf1f6] text-[#516074]`;

/** 原型 .pill.blue — header 的 Herdr pill。 */
const BLUE_PILL = `${BASE_PILL} bg-[#eaf1ff] text-[#2458bd]`;

/** 运行时映射: connected → runtimeConnected / offline → runtimeOffline / reconnecting → runtimeReconnecting。 */
function runtimeKey(server: HerdrServerState): string {
  return `herdr.rail.runtime${server[0].toUpperCase()}${server.slice(1)}`;
}

/** dl 两列 — 原型 .dl: 86px label 列。 */
function DlRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-[#687386]">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

export function HerdrContextRail(): React.JSX.Element {
  const { t } = useI18n();
  const selectedAgent = useHerdrStore((s) => s.selectedAgent);
  const agents = useHerdrStore((s) => s.agents);
  const server = useHerdrStore((s) => s.server);
  const session = useHerdrStore((s) => s.tree.session);
  const missionAttempt = useHerdrStore((s) => s.missionAttempt);

  const agent = selectedAgent ? agents.find((a) => a.name === selectedAgent) : null;
  const display: HerdrDisplayState | null = agent ? displayStateOf(agent, server) : null;

  return (
    <aside
      data-testid="herdr-context-rail"
      className="flex h-full w-[310px] shrink-0 flex-col overflow-y-auto border-l border-[#dfe4eb] bg-white"
    >
      {/* 原型 .section-head: 45px, 标题 + spacer + Herdr pill */}
      <div className="flex h-[45px] flex-none items-center gap-2 border-b border-[#dfe4eb] px-3 font-semibold">
        <span>{t('herdr.rail.title')}</span>
        <span className="ml-auto" />
        <span className={BLUE_PILL}>Herdr</span>
      </div>

      {!agent ? (
        <div data-testid="rail-empty" className="grid min-h-[140px] place-items-center text-[#687386]">
          {t('herdr.rail.empty')}
        </div>
      ) : (
        <div className="flex-none">
          {/* Section 1 — 当前终端窗格 */}
          <section data-testid="rail-identity" className="border-b border-[#dfe4eb] px-[13px] py-[13px]">
            <h3 className="mb-2.5 text-[12px] font-semibold">{t('herdr.rail.currentPane')}</h3>
            <dl className="grid grid-cols-[86px_1fr] gap-x-[6px] gap-y-2 text-[11px]">
              <DlRow label={t('herdr.rail.agent')}>
                <b className="font-semibold text-[#172033]">{agent.displayName}</b> · {agent.kind}
              </DlRow>
              <DlRow label={t('herdr.rail.hierarchy')}>
                {session} / {agent.workspace} / {agent.tab} / {agent.pane}
              </DlRow>
              <DlRow label={t('herdr.rail.runtime')}>{t(runtimeKey(server))}</DlRow>
              <DlRow label={t('herdr.rail.status')}>
                <span data-testid="rail-status-pill" data-state={display} className={`${BASE_PILL} ${PILL_STYLE[display!]}`}>
                  {t(`herdr.status.${display}`)}
                </span>
              </DlRow>
              <DlRow label={t('herdr.rail.authority')}>{agent.authority}</DlRow>
              <DlRow label={t('herdr.rail.nativeSession')}>{agent.session}</DlRow>
            </dl>
          </section>

          {/* Section 2 — 可用能力 */}
          <section data-testid="rail-capabilities" className="border-b border-[#dfe4eb] px-[13px] py-[13px]">
            <h3 className="mb-2.5 text-[12px] font-semibold">{t('herdr.rail.capabilities')}</h3>
            <div className="flex flex-wrap gap-[5px]">
              {CAPABILITIES.map((key) => (
                <span key={key} className={NEUTRAL_PILL}>
                  {t(`herdr.rail.${key}`)}
                </span>
              ))}
            </div>
          </section>

          {/* Section 3 — 工作树租约 */}
          <section data-testid="rail-lease" className="border-b border-[#dfe4eb] px-[13px] py-[13px]">
            <h3 className="mb-2.5 text-[12px] font-semibold">{t('herdr.rail.worktreeLease')}</h3>
            <dl className="grid grid-cols-[86px_1fr] gap-x-[6px] gap-y-2 text-[11px]">
              <DlRow label={t('herdr.rail.leaseWorkspace')}>{agent.worktree}</DlRow>
              <DlRow label={t('herdr.rail.leaseBranch')}>herdr/{agent.name}</DlRow>
              <DlRow label={t('herdr.rail.leaseOwner')}>{t('herdr.rail.leaseOwnerText', { n: missionAttempt })}</DlRow>
            </dl>
          </section>

          {/* Section 4 — 证据边界 (NL-013: 必须存在, 不因运行时状态省略) */}
          <section data-testid="rail-evidence" className="px-[13px] py-[13px]">
            <h3 className="mb-2.5 text-[12px] font-semibold">{t('herdr.rail.evidenceBoundary')}</h3>
            <p className="m-0 text-[12px] leading-[1.55] text-[#687386]">{t('herdr.rail.evidenceText')}</p>
          </section>
        </div>
      )}
    </aside>
  );
}
