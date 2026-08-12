// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildHerdrTree,
  displayStateOf,
  priorityOf,
  rollupState,
  dagNodeStatuses,
  missionDag,
  missionPanels,
} from '../herdr-store';
import { HERDR_MOCK_AGENTS } from '../herdr-mock-data';
import type { HerdrAgent } from '../herdr-store';

const agent = (name: string, state: HerdrAgent['state']): HerdrAgent => ({
  name,
  displayName: name,
  kind: 'Pi',
  state,
  pane: 'p-01',
  tab: 't',
  workspace: 'w',
  task: '',
  session: '',
  worktree: 'w',
  authority: 'mock',
});

describe('displayStateOf（断线禁陈旧 done）', () => {
  it('server 断线 → 全部 disconnected，包括 working/done', () => {
    expect(displayStateOf(agent('a', 'working'), 'offline')).toBe('disconnected');
    expect(displayStateOf(agent('a', 'done'), 'offline')).toBe('disconnected');
    expect(displayStateOf(agent('a', 'blocked'), 'offline')).toBe('disconnected');
  });
  it('连接时透传内部状态', () => {
    expect(displayStateOf(agent('a', 'done'), 'connected')).toBe('done');
  });
});

describe('priorityOf（UI-REQ-026 优先级表）', () => {
  it('Blocked(4) > Done-unseen(3) > Working(2) > Idle(1) > Unknown(0)', () => {
    expect(priorityOf('blocked')).toBe(4);
    expect(priorityOf('done')).toBe(3);
    expect(priorityOf('working')).toBe(2);
    expect(priorityOf('idle')).toBe(1);
    expect(priorityOf('unknown')).toBe(0);
    expect(priorityOf('disconnected')).toBe(0);
  });
});

describe('rollupState（组内取最差）', () => {
  it('blocked 压过 done-unseen 压过 working', () => {
    expect(rollupState([agent('a', 'working'), agent('b', 'done'), agent('c', 'blocked')], 'connected')).toBe('blocked');
    expect(rollupState([agent('a', 'working'), agent('b', 'done')], 'connected')).toBe('done');
    expect(rollupState([agent('a', 'idle'), agent('b', 'working')], 'connected')).toBe('working');
  });
  it('断线时 rollup 为 disconnected（无陈旧 done）', () => {
    expect(rollupState([agent('a', 'done'), agent('b', 'blocked')], 'offline')).toBe('disconnected');
  });
});

describe('buildHerdrTree（4 级层级）', () => {
  it('session → workspace → tab → pane 结构正确', () => {
    const tree = buildHerdrTree('pi-desktop', HERDR_MOCK_AGENTS);
    expect(tree.session).toBe('pi-desktop');
    expect(tree.workspaces).toHaveLength(2); // primary + wt/auth-fix
    const primary = tree.workspaces.find((w) => w.name === 'primary')!;
    expect(primary.kind).toBe('workspace');
    expect(primary.tabs).toHaveLength(2); // coordinator + implementation
    const impl = primary.tabs.find((t) => t.name === 'implementation')!;
    expect(impl.panes).toHaveLength(2); // auth-worker + tests-worker
    expect(tree.workspaces.find((w) => w.name === 'wt/auth-fix')!.kind).toBe('worktree');
  });
  it('空 agents → 空树', () => {
    expect(buildHerdrTree('', []).workspaces).toHaveLength(0);
  });
});

describe('mission DAG（与原型 renderDag 一致）', () => {
  it('planned → 全部就绪', () => {
    expect(dagNodeStatuses('planned')).toEqual(['ready', 'ready', 'ready', 'ready']);
  });
  it('running → passed,running,running,ready', () => {
    expect(dagNodeStatuses('running')).toEqual(['passed', 'running', 'running', 'ready']);
  });
  it('review → passed,passed,passed,rejected', () => {
    expect(dagNodeStatuses('review')).toEqual(['passed', 'passed', 'passed', 'rejected']);
  });
  it('revision → passed,running,passed,ready', () => {
    expect(dagNodeStatuses('revision')).toEqual(['passed', 'running', 'passed', 'ready']);
  });
  it('passed → 全部通过', () => {
    expect(dagNodeStatuses('passed')).toEqual(['passed', 'passed', 'passed', 'passed']);
  });
  it('draft → 全部就绪（未生成图）', () => {
    expect(dagNodeStatuses('draft')).toEqual(['ready', 'ready', 'ready', 'ready']);
  });
  it('轮次：节点 02/04 使用 attempt，01/03 固定 1', () => {
    const dag = missionDag('revision', 2);
    expect(dag[1].attempt).toBe(2);
    expect(dag[3].attempt).toBe(2);
    expect(dag[0].attempt).toBe(1);
    expect(dag[2].attempt).toBe(1);
  });
});

describe('missionPanels（三栏派生，与原型 renderMissionPanels 一致）', () => {
  it('draft → 三栏全部等待态', () => {
    const p = missionPanels('draft', 1);
    expect(p.artifacts).toBeNull();
    expect(p.review).toBeNull();
    expect(p.integration).toEqual({ state: 'waiting', text: '等待通过审查的提交' });
  });
  it('review → 交付物 + 审查未通过（驳回 → 创建修订轮次）', () => {
    const p = missionPanels('review', 1);
    expect(p.artifacts?.commit).toBe('8ea21f4');
    expect(p.review?.kind).toBe('rejected');
    expect(p.review?.action).toBe('revision');
  });
  it('revision → 修订中 + 复审动作', () => {
    const p = missionPanels('revision', 2);
    expect(p.review?.kind).toBe('revising');
    expect(p.review?.action).toBe('review-pass');
  });
  it('passed → 审查通过 + 整合就绪', () => {
    const p = missionPanels('passed', 1);
    expect(p.review?.kind).toBe('passed');
    expect(p.review?.action).toBeNull();
    expect(p.integration?.state).toBe('ready');
  });
});
