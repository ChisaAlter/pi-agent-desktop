// PROTOTYPE_MOCK — Herdr GUI 原型同款模拟数据（与已批准原型 JS 数据一一对应）。
// 仅由 herdr-store 在 __PI_HERDR_MOCK__='1' 时消费；生产构建默认关闭。
// 任何 mock 数据冒充真实运行时（Phase 3+ 证据）均被禁止（NL-010/NL-015）。
import type { HerdrAgent, HerdrMissionStatus, HerdrServerState } from './herdr-store';

export const HERDR_MOCK_SESSION = 'pi-desktop';

/** 与原型 agents 对象一致（字段一一对应，含 seen 语义）。 */
export const HERDR_MOCK_AGENTS: HerdrAgent[] = [
  {
    name: 'planner',
    displayName: '规划智能体',
    kind: 'Pi',
    state: 'working',
    pane: 'p-01',
    tab: 'coordinator',
    workspace: 'primary',
    task: '拆解任务并验证任务依赖',
    session: 'pi-plan.jsonl',
    worktree: 'primary',
    authority: 'Herdr Pi 生命周期钩子',
  },
  {
    name: 'auth-worker',
    displayName: '认证实现智能体',
    kind: 'Pi',
    state: 'blocked',
    pane: 'p-02',
    tab: 'implementation',
    workspace: 'primary',
    task: '修复认证中间件并补齐错误处理',
    session: 'auth.jsonl',
    worktree: 'wt/auth-fix',
    authority: 'Herdr Pi 生命周期钩子',
  },
  {
    name: 'tests-worker',
    displayName: '测试智能体',
    kind: 'Codex',
    state: 'done',
    pane: 'p-03',
    tab: 'implementation',
    workspace: 'primary',
    task: '新增认证回归测试',
    session: 'codex:7d2a',
    worktree: 'wt/auth-tests',
    authority: 'Herdr 进程与终端检测',
  },
  {
    name: 'reviewer',
    displayName: '审查智能体',
    kind: 'Claude',
    state: 'idle',
    pane: 'p-04',
    tab: '审查中',
    workspace: 'wt/auth-fix',
    task: '按验收标准审查交付物',
    session: 'claude:review-12',
    worktree: 'wt/auth-review',
    authority: 'Herdr Claude 生命周期钩子',
  },
];

/**
 * tab 显示名映射（原型树的标签：任务协调/并行实现/独立审查；
 * 内部 id 为 coordinator/implementation/审查中）。
 */
export const HERDR_MOCK_TAB_DISPLAY: Record<string, string> = {
  coordinator: '任务协调',
  implementation: '并行实现',
  '审查中': '独立审查',
};

/** 与原型 terminal 初始内容一致。 */
export const HERDR_MOCK_TERMINAL_LINES: string[] = [
  '❯ pi --session C:\\Users\\…\\pi-sessions\\auth.jsonl',
  'Herdr 集成已连接 · 窗格 p-02 · 状态来源 herdr:pi',
  '',
  '我将检查认证中间件并补充回归测试。',
  '',
  '● 正在读取 apps/desktop/src/main/services/auth/session.ts',
  '● 拟执行命令：',
  '  pnpm --filter @pi-desktop/desktop test auth',
  '',
  '◆ 正在等待审批…',
];

/** mission 初始目标（与原型 input 默认值一致）。 */
export const HERDR_MOCK_GOAL = '修复认证流程、补齐回归测试，并通过独立 审查智能体 审查';

/** 服务状态（原型 state.server）。 */
export const HERDR_MOCK_SERVER: HerdrServerState = 'connected';

/** mission 初始状态。 */
export const HERDR_MOCK_MISSION = {
  status: 'draft' as HerdrMissionStatus,
  seq: 0,
  attempt: 1,
  goal: HERDR_MOCK_GOAL,
};
