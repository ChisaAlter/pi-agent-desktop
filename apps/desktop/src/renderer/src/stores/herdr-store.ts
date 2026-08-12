/**
 * herdr-store — Herdr 控制面（智能体/任务编排 tab）的单一数据源。
 *
 * 数据源契约（UI-REQ-014）：运行时真相最终必须来自 Main 权威 snapshot+seq
 * （Phase 3 落地）。当前实现：
 *   - __PI_HERDR_MOCK__='1' → 原型同款模拟数据（herdr-mock-data.ts，仅开发/parity，
 *     该文件头部带 mock 隔离标记，grep 可定位全部 mock）
 *   - 否则（默认）→ 无运行时：server=offline、agents=[]，UI 显示断线/空态
 * mock 关闭时禁止假数据（D6/NL-010）。
 *
 * 状态语义（原型为准，D7）：
 *   done = idle + unseen（state='done' 即待查看）；markSeen → idle
 *   优先级 Blocked(4) > Done-unseen(3) > Working(2) > Idle(1) > Unknown(0)
 *   server 断线 → 全部显示 disconnected，禁止陈旧 done
 *   blocked 审批必须在真实 pane 内处理（resolveBlock 只切换视图，不伪造批准）
 */
import { create } from 'zustand';
import {
  HERDR_MOCK_AGENTS,
  HERDR_MOCK_MISSION,
  HERDR_MOCK_TAB_DISPLAY,
  HERDR_MOCK_TERMINAL_LINES,
  HERDR_MOCK_SESSION,
  HERDR_MOCK_SERVER,
} from './herdr-mock-data';

export type HerdrServerState = 'connected' | 'offline' | 'reconnecting';
export type HerdrAgentState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';
export type HerdrDisplayState = HerdrAgentState | 'disconnected';
export type HerdrAgentKind = 'Pi' | 'Codex' | 'Claude';
export type HerdrView = 'fleet' | 'pane' | 'mission';
export type HerdrLayoutMode = 'studio' | 'mission' | 'terminal';
export type HerdrMissionStatus = 'draft' | 'planned' | 'running' | 'review' | 'revision' | 'passed';
export type HerdrMissionNodeStatus = 'ready' | 'running' | 'passed' | 'rejected';

export interface HerdrAgent {
  name: string;
  displayName: string;
  kind: HerdrAgentKind;
  /** 内部状态（不含 disconnected — 由 server 派生，防陈旧 done） */
  state: HerdrAgentState;
  pane: string;
  tab: string;
  workspace: string;
  task: string;
  session: string;
  worktree: string;
  authority: string;
}

export interface HerdrTreeTab {
  id: string;
  name: string;
  panes: HerdrAgent[];
}

export interface HerdrTreeWorkspace {
  id: string;
  name: string;
  kind: 'workspace' | 'worktree';
  tabs: HerdrTreeTab[];
}

export interface HerdrTreeModel {
  session: string;
  workspaces: HerdrTreeWorkspace[];
}

export interface HerdrMissionDagNode {
  id: string;
  name: string;
  agent: string;
  pane: string;
  status: HerdrMissionNodeStatus;
  attempt: number;
}

/** mission 三栏业务面板的派生视图（交付物/审查/整合）。 */
export interface HerdrMissionPanels {
  artifacts: { owner: string; attempt: number; summary: string; commit: string; tests: string; diff: { del: string; add: string } } | null;
  review: { kind: 'rejected' | 'revising' | 'passed'; text: string; action: 'revision' | 'review-pass' | null } | null;
  integration: { state: 'waiting' | 'ready'; text: string } | null;
}

interface HerdrStoreState {
  /** mock 模式开关（编译期注入） */
  mock: boolean;
  server: HerdrServerState;
  view: HerdrView;
  selectedAgent: string | null;
  attached: boolean;
  /** 状态变更序号（Phase 3 由 Main 权威序列取代） */
  stateSeq: number;
  agents: HerdrAgent[];
  tree: HerdrTreeModel;
  terminalLog: string[];
  /** prompt 预填草稿（mock 与原型预填一致；真实运行时为空） */
  promptDraft: string;
  missionStatus: HerdrMissionStatus;
  missionSeq: number;
  missionAttempt: number;
  missionGoal: string;
  /** 最终合入确认模态（UI-REQ-044：合入必须用户确认，不自动执行） */
  mergeConfirmOpen: boolean;

  // ---- actions ----
  selectAgent(name: string): void;
  setView(view: HerdrView): void;
  markSeen(name: string): void;
  /** blocked → 进入真实 pane 处理（切换视图，不伪造批准） */
  openPaneForBlocked(): void;
  setServer(server: HerdrServerState): void;
  attach(): void;
  prompt(text: string): void;
  setMissionGoal(goal: string): void;
  planMission(): void;
  runMission(): void;
  /** running → review（原型 2200ms 定时推进，由 UI 层调度） */
  advanceMission(): void;
  createRevision(): void;
  passReview(): void;
  requestMerge(): void;
  openMergeConfirm(): void;
  closeMergeConfirm(): void;
  confirmMerge(): void;
  reset(): void;
}

/** 构建 4 级树（session → workspace → tab → pane），保持原型顺序。 */
export function buildHerdrTree(session: string, agents: HerdrAgent[], tabDisplay?: Record<string, string>): HerdrTreeModel {
  const workspaceOrder: string[] = [];
  const map = new Map<string, Map<string, HerdrAgent[]>>();
  for (const agent of agents) {
    if (!map.has(agent.workspace)) {
      map.set(agent.workspace, new Map());
      workspaceOrder.push(agent.workspace);
    }
    const tabs = map.get(agent.workspace)!;
    if (!tabs.has(agent.tab)) tabs.set(agent.tab, []);
    tabs.get(agent.tab)!.push(agent);
  }
  const workspaces: HerdrTreeWorkspace[] = workspaceOrder.map((ws) => {
    const tabs = map.get(ws)!;
    return {
      id: ws,
      name: ws,
      kind: ws.startsWith('wt/') ? 'worktree' : 'workspace',
      tabs: [...tabs.entries()].map(([tab, panes]) => ({
        id: tab,
        name: tabDisplay?.[tab] ?? tab,
        panes,
      })),
    };
  });
  return { session, workspaces };
}

/** 展示状态：server 断线 → 全部 disconnected（禁陈旧 done）；否则内部状态。 */
export function displayStateOf(agent: HerdrAgent, server: HerdrServerState): HerdrDisplayState {
  if (server !== 'connected') return 'disconnected';
  return agent.state;
}

/** 优先级（UI-REQ-026）：Blocked(4) > Done-unseen(3) > Working(2) > Idle(1) > Unknown(0)。 */
export function priorityOf(state: HerdrDisplayState): number {
  switch (state) {
    case 'blocked': return 4;
    case 'done': return 3;
    case 'working': return 2;
    case 'idle': return 1;
    default: return 0; // unknown / disconnected
  }
}

/** 工作区 rollup：取组内最高优先级状态。 */
export function rollupState(agents: HerdrAgent[], server: HerdrServerState): HerdrDisplayState {
  let best: HerdrDisplayState = 'unknown';
  let bestPriority = -1;
  for (const agent of agents) {
    const state = displayStateOf(agent, server);
    const p = priorityOf(state);
    if (p > bestPriority) {
      best = state;
      bestPriority = p;
    }
  }
  return best;
}

/** DAG 节点状态（与原型 renderDag 完全一致）。 */
export function dagNodeStatuses(status: HerdrMissionStatus): HerdrMissionNodeStatus[] {
  switch (status) {
    case 'planned': return ['ready', 'ready', 'ready', 'ready'];
    case 'running': return ['passed', 'running', 'running', 'ready'];
    case 'review': return ['passed', 'passed', 'passed', 'rejected'];
    case 'revision': return ['passed', 'running', 'passed', 'ready'];
    case 'passed': return ['passed', 'passed', 'passed', 'passed'];
    default: return ['ready', 'ready', 'ready', 'ready'];
  }
}

export const HERDR_DAG_NODES: Array<{ id: string; name: string; agent: string; pane: string }> = [
  { id: '01', name: '规划与风险分析', agent: '规划智能体', pane: 'p-01' },
  { id: '02', name: '认证实现', agent: '认证实现智能体', pane: 'p-02' },
  { id: '03', name: '回归测试', agent: '测试智能体', pane: 'p-03' },
  { id: '04', name: '独立审查', agent: '审查智能体', pane: 'p-04' },
];

export function missionDag(status: HerdrMissionStatus, attempt: number): HerdrMissionDagNode[] {
  const statuses = dagNodeStatuses(status);
  return HERDR_DAG_NODES.map((node, i) => ({
    ...node,
    status: statuses[i],
    attempt: node.id === '02' || node.id === '04' ? attempt : 1,
  }));
}

/** mission 三栏派生（与原型 renderMissionPanels 一致）。 */
export function missionPanels(status: HerdrMissionStatus, attempt: number): HerdrMissionPanels {
  const panels: HerdrMissionPanels = { artifacts: null, review: null, integration: null };
  if (status === 'review' || status === 'revision' || status === 'passed') {
    panels.artifacts = {
      owner: 'auth-worker',
      attempt,
      summary: '修复 会话过期竞态 并增加 4 个回归测试。',
      commit: '8ea21f4',
      tests: '18/18 ✓',
      diff: { del: '- 若已过期，返回空值；', add: '+ 等待刷新或失效当前会话；' },
    };
  }
  if (status === 'review') {
    panels.review = { kind: 'rejected', text: '并发 刷新流程缺少同一会话 去重测试。', action: 'revision' };
  } else if (status === 'revision') {
    panels.review = { kind: 'revising', text: '审查意见已注入 auth-worker · 轮次 2。', action: 'review-pass' };
  } else if (status === 'passed') {
    panels.review = { kind: 'passed', text: '审查意见已解决；18 个测试及并发去重用例通过。', action: null };
    panels.integration = { state: 'ready', text: '8ea21f4 → c23b109 · 无冲突' };
  } else {
    panels.integration = { state: 'waiting', text: '等待通过审查的提交' };
  }
  return panels;
}

const mockActive = typeof __PI_HERDR_MOCK__ !== 'undefined' && __PI_HERDR_MOCK__ === '1';

function initialState(): Pick<
  HerdrStoreState,
  | 'mock' | 'server' | 'view' | 'selectedAgent' | 'attached' | 'stateSeq'
  | 'agents' | 'tree' | 'terminalLog' | 'promptDraft'
  | 'missionStatus' | 'missionSeq' | 'missionAttempt' | 'missionGoal' | 'mergeConfirmOpen'
> {
  if (mockActive) {
    const agents = HERDR_MOCK_AGENTS;
    return {
      mock: true,
      server: HERDR_MOCK_SERVER,
      view: 'fleet',
      selectedAgent: 'auth-worker',
      attached: true,
      stateSeq: 184,
      agents,
      tree: buildHerdrTree(HERDR_MOCK_SESSION, agents, HERDR_MOCK_TAB_DISPLAY),
      terminalLog: [...HERDR_MOCK_TERMINAL_LINES],
      promptDraft: '修复认证测试，并在完成后运行相关测试。',
      missionStatus: HERDR_MOCK_MISSION.status,
      missionSeq: HERDR_MOCK_MISSION.seq,
      missionAttempt: HERDR_MOCK_MISSION.attempt,
      missionGoal: HERDR_MOCK_MISSION.goal,
      mergeConfirmOpen: false,
    };
  }
  // 无运行时：断线/空态，禁止假数据
  return {
    mock: false,
    server: 'offline',
    view: 'fleet',
    selectedAgent: null,
    attached: false,
    stateSeq: 0,
    agents: [],
    tree: { session: '', workspaces: [] },
    terminalLog: [],
    promptDraft: '',
    missionStatus: 'draft',
    missionSeq: 0,
    missionAttempt: 1,
    missionGoal: '',
    mergeConfirmOpen: false,
  };
}

export const useHerdrStore = create<HerdrStoreState>()((set) => ({  ...initialState(),

  selectAgent: (name) => set({ selectedAgent: name }),
  setView: (view) => set({ view }),

  markSeen: (name) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.name === name && a.state === 'done' ? { ...a, state: 'idle' as const } : a)),
      tree: buildHerdrTree(state.tree.session, state.agents.map((a) => (a.name === name && a.state === 'done' ? { ...a, state: 'idle' as const } : a))),
    })),

  openPaneForBlocked: () =>
    set((state) => {
      const selected = state.selectedAgent ? state.agents.find((a) => a.name === state.selectedAgent) : null;
      if (selected?.state !== 'blocked') return state;
      // 在真实 pane 中处理 → 模拟生命周期上报（mock 专用；生产由 Herdr hook 上报）
      const nextSeq = state.stateSeq + 1;
      return {
        view: 'pane' as const,
        stateSeq: nextSeq,
        agents: state.agents.map((a) => (a.name === selected.name ? { ...a, state: 'working' as const } : a)),
        tree: buildHerdrTree(state.tree.session, state.agents.map((a) => (a.name === selected.name ? { ...a, state: 'working' as const } : a))),
        terminalLog: [...state.terminalLog, '✓ 已在终端窗格中批准', '● 正在运行 pnpm test auth…'],
      };
    }),

  setServer: (server) => set({ server }),

  attach: () => set((state) => ({ attached: !state.attached })),

  prompt: (text) =>
    set((state) => ({
      terminalLog: [...state.terminalLog, '', `❯ 通过 agent.prompt 注入指令`, text, '● 工作中…'],
      stateSeq: state.stateSeq + 1,
    })),

  setMissionGoal: (goal) => set({ missionGoal: goal }),

  planMission: () => set((state) => ({ missionStatus: 'planned', missionSeq: state.missionSeq + 1 })),

  runMission: () =>
    set((state) => {
      if (state.missionStatus === 'draft') return state; // 请先生成任务图
      return { missionStatus: 'running' as const, missionSeq: state.missionSeq + 1 };
    }),

  createRevision: () => set((state) => ({ missionStatus: 'revision', missionAttempt: 2, missionSeq: state.missionSeq + 1 })),

  advanceMission: () =>
    set((state) => {
      if (state.missionStatus !== 'running') return state;
      return { missionStatus: 'review' as const, missionSeq: state.missionSeq + 1 };
    }),

  passReview: () => set((state) => ({ missionStatus: 'passed', missionSeq: state.missionSeq + 1 })),

  requestMerge: () => set((state) => ({ missionSeq: state.missionSeq + 1, mergeConfirmOpen: true })),

  openMergeConfirm: () => set({ mergeConfirmOpen: true }),
  closeMergeConfirm: () => set({ mergeConfirmOpen: false }),
  confirmMerge: () =>
    set((state) => ({
      mergeConfirmOpen: false,
      missionStatus: 'passed' as const,
      missionSeq: state.missionSeq + 1,
    })),

  reset: () => set(initialState()),
}));

/** 非 React 环境取快照（i18n/工具函数用）。 */
export const herdrStoreSnapshot = () => useHerdrStore.getState();

// Mock 测试钩子（仅 mock 模式暴露，parity E2E 驱动断线/重连状态用）：
// 真实运行时（Phase 3）由 Main 权威连接监督器驱动，无此钩子。
if (mockActive && typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__herdrMockApi__ = {
        setServer: (server: HerdrServerState) => useHerdrStore.getState().setServer(server),
        getState: () => useHerdrStore.getState(),
        reset: () => useHerdrStore.getState().reset(),
    };
}
