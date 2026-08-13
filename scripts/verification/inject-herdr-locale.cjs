// 一次性脚本：向 en.json / zh-CN.json 追加 herdr 命名空间并校验键集一致。
// 用法: node scripts/verification/inject-herdr-locale.cjs
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const enPath = path.join(root, 'apps/desktop/src/renderer/src/i18n/locales/en.json');
const zhPath = path.join(root, 'apps/desktop/src/renderer/src/i18n/locales/zh-CN.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

// 与 golden-baseline 同源的 herdr 双语键集定义
const KEYS = {
  statusBar: {
    connected: ['Herdr connected', 'Herdr 已连接'],
    offline: ['Herdr disconnected', 'Herdr 已断开'],
    reconnecting: ['Herdr reconnecting', 'Herdr 正在重连'],
    sessionProcess: ['Session: {{session}} · PID {{pid}}', '会话：{{session}} · 进程 {{pid}}'],
    managedByDesktop: ['Desktop-managed', 'Desktop 托管'],
    systemInstalled: ['System install', '系统安装'],
    compatible: ['Fully compatible', '完全兼容'],
    incompatible: ['Incompatible', '不兼容'],
    compatUnknown: ['Compatibility unknown', '兼容性未知'],
    version: ['v{{version}}', 'v{{version}}'],
    openSettings: ['Open settings', '打开设置'],
  },
  tree: {
    title: ['Herdr runtime', 'Herdr 运行时'],
    create: ['Create', '创建'],
    searchPlaceholder: ['Search panes, agents or workspaces', '搜索终端窗格、智能体或工作区'],
    filterAll: ['All', '全部'],
    filterBlocked: ['Blocked', '阻塞'],
    filterDone: ['Unseen', '待查看'],
    workspace: ['workspace', '工作区'],
    worktree: ['worktree', '工作树'],
    session: ['session', '会话'],
    empty: ['No Herdr runtime detected', '未检测到 Herdr 运行时'],
  },
  view: {
    fleet: ['Agent overview', '智能体总览'],
    pane: ['Live terminal', '实时终端'],
    mission: ['Mission cockpit', '任务驾驶舱'],
  },
  status: {
    working: ['Working', '工作中'],
    blocked: ['Blocked', '已阻塞'],
    done: ['Done · unseen', '已完成 · 待查看'],
    idle: ['Idle', '空闲'],
    unknown: ['Unknown', '状态未知'],
    disconnected: ['Disconnected', '连接已断开'],
  },
  fleet: {
    agentCount: ['{{count}} agents · {{tabs}} tabs · repo {{repo}}', '{{count}} 个智能体 · {{tabs}} 个标签页 · 仓库 {{repo}}'],
    branch: ['branch {{branch}}', '分支 {{branch}}'],
  },
  card: {
    pane: ['pane {{pane}}', '窗格 {{pane}}'],
    session: ['Session', '会话'],
    worktree: ['Worktree', '工作树'],
    authority: ['Status source', '状态来源'],
    openTerminal: ['Open terminal', '打开终端'],
    handleBlocked: ['Handle blocked', '处理阻塞'],
    markSeen: ['Mark as seen', '标记已查看'],
    recentOutput: ['Recent output', '最近输出'],
    more: ['More ⋯', '更多 ⋯'],
    empty: ['No agents in this workspace', '该工作区暂无智能体'],
  },
  pane: {
    attached: ['● Live attached', '● 已实时连接'],
    detached: ['○ Detached', '○ 已断开'],
    attach: ['Detach', '断开连接'],
    reattach: ['Reattach', '重新连接'],
    focus: ['Focus', '聚焦'],
    resize: ['Resize', '调整尺寸'],
    sendKeys: ['Send keys', '发送按键'],
    blockedTitle: ['Agent blocked', '智能体被阻塞'],
    blockedDesc: ['Pi is waiting for command approval; handle it in the real terminal pane.', 'Pi 正在等待命令执行审批；请在真实终端窗格中处理。'],
    resolveBlock: ['Open terminal and approve', '进入终端并批准'],
    identity: ['Runtime identity', '运行时身份'],
    agent: ['Agent', '智能体'],
    paneTerminal: ['Pane / terminal', '窗格／终端'],
    authoritySource: ['Status authority', '状态权威来源'],
    stateSeq: ['State change seq', '状态变更序号'],
    nativeSession: ['Native session', '原生会话'],
    worktree: ['Worktree', '工作树'],
    transport: ['Transport', '传输方式'],
    transportLive: ['Binary client · live', '二进制客户端 · 实时'],
    promptPlaceholder: ['Send instructions to the agent in the real terminal…', '向真实终端中的智能体发送指令…'],
    waitIdle: ['Wait for idle/done', '等待空闲／完成'],
    waitBlocked: ['Wait for blocked', '等待阻塞'],
    waitNone: ['Do not wait', '不等待'],
    sendAndWait: ['Send and wait', '发送并等待'],
    readHistory: ['Read history output', '读取历史输出'],
    readHistoryHint: ['agent.read history — separate from the live terminal', 'agent.read 历史 — 与实时连接的终端明确区分'],
    empty: ['No Herdr runtime — live terminal unavailable', '未连接 Herdr 运行时 — 实时终端不可用'],
  },
  mission: {
    title: ['Mission control center', '任务控制中心'],
    subtitle: ['Desktop injects mission semantics; agents, panes, PTY and lifecycle stay managed by official Herdr.', '桌面端注入任务语义；智能体、终端窗格、PTY 和生命周期仍由官方 Herdr 管理。'],
    statusDraft: ['Draft', '草稿'],
    statusPlanned: ['Planned', '已规划'],
    statusRunning: ['Running', '执行中'],
    statusReview: ['Under review', '审查中'],
    statusRevision: ['Revising', '修订中'],
    statusPassed: ['Passed', '已通过'],
    goalPlaceholder: ['Enter the mission goal…', '输入总任务目标…'],
    plan: ['Generate task graph', '生成任务图'],
    run: ['Start mission', '开始任务'],
    authorityPrefix: ['The single source of truth for runtime state:', '运行状态的唯一真相来源：'],
    authoritySession: ['Herdr session {{session}}', 'Herdr 会话 {{session}}'],
    authorityProjection: ['desktop projection seq {{seq}}', '桌面投影序号 {{seq}}'],
    authorityNoReplay: ['non-idempotent operations are not replayed after reconnect', '非幂等操作不会在重连后自动重放'],
    dagEmpty: ['Enter a goal and generate the task graph to see how the planner agent injects work into real Herdr workers.', '输入目标并生成任务图，查看规划智能体如何将工作注入真实 Herdr 执行智能体。'],
    nodeReady: ['Ready', '就绪'],
    nodeRunning: ['Running', '执行中'],
    nodePassed: ['Passed', '已通过'],
    nodeRejected: ['Rejected', '未通过'],
    round: ['round {{n}}', '轮次 {{n}}'],
    artifacts: ['Deliverables', '交付物'],
    review: ['Review & revision', '审查与修订'],
    integration: ['Branch integration', '分支整合'],
    artifactsWaiting: ['Waiting for workers to deliver', '等待执行智能体交付'],
    reviewWaiting: ['Waiting for the reviewer agent', '等待审查智能体'],
    integrationWaiting: ['Waiting for approved commits', '等待通过审查的提交'],
    artifactCommit: ['commit {{commit}} · tests {{tests}}', '提交 {{commit}} · 测试 {{tests}}'],
    reviewRejected: ['Review failed', '审查未通过'],
    reviewRevising: ['Revision in progress', '正在执行修订'],
    reviewPassed: ['Review passed', '审查已通过'],
    createRevision: ['Create revision round 2', '创建修订轮次 2'],
    reviewPassAction: ['Finish revision and re-review', '完成修订并复审'],
    integrationReady: ['Ready in integration worktree', '已进入待整合工作树'],
    requestMerge: ['Request merge to main', '请求合入主分支'],
    mergeConfirmTitle: ['Final merge confirmation', '最终合入确认'],
    mergeConfirmText: ['The reviewer passed and the integration worktree has no conflicts. This operation still requires your explicit confirmation; agents never write to the main branch automatically.', '审查智能体已通过，整合工作树无冲突。此操作仍需要用户明确确认，不会由智能体自动写入主分支。'],
    mergeConfirmAction: ['Confirm merge', '确认合入'],
    cancel: ['Cancel', '取消'],
    empty: ['No Herdr runtime — mission planning unavailable', '未连接 Herdr 运行时 — 任务编排不可用'],
  },
  rail: {
    title: ['Context details', '上下文详情'],
    currentPane: ['Current terminal pane', '当前终端窗格'],
    agent: ['Agent', '智能体'],
    hierarchy: ['Hierarchy', '层级'],
    runtime: ['Runtime', '运行时'],
    status: ['Status', '状态'],
    authority: ['Status source', '状态来源'],
    nativeSession: ['Native session reference', '原生会话引用'],
    runtimeConnected: ['Official Herdr · connected', '官方 Herdr · 已连接'],
    runtimeOffline: ['Official Herdr · disconnected', '官方 Herdr · 已断开'],
    runtimeReconnecting: ['Official Herdr · reconnecting', '官方 Herdr · 正在重连'],
    capabilities: ['Available capabilities', '可用能力'],
    capSendPrompt: ['Send instructions', '发送指令'],
    capWait: ['Wait', '等待'],
    capRead: ['Read', '读取'],
    capSendKeys: ['Send keys', '发送按键'],
    capLiveAttach: ['Live attach', '实时连接'],
    capResume: ['Resume session', '恢复会话'],
    worktreeLease: ['Worktree lease', '工作树租约'],
    leaseWorkspace: ['Workspace', '工作区'],
    leaseBranch: ['Branch', '分支'],
    leaseOwner: ['Owned by', '归属'],
    leaseOwnerText: ['mission/auth-hardening · round {{n}}', '任务/auth-hardening · 轮次 {{n}}'],
    evidenceBoundary: ['Evidence boundary', '证据边界'],
    evidenceText: ['In production, status must be traced back to Herdr snapshots, event seqs, pane/terminal identity and Git commits — never derived from UI cards.', '生产版必须从 Herdr 快照、事件序号、窗格／终端身份及 Git 提交反查，不能从界面卡片推导运行状态。'],
    empty: ['Select an agent to see context', '选中智能体后显示上下文'],
  },
  layout: {
    label: ['Layout', '布局'],
    studio: ['Studio', '智能体工作台'],
    mission: ['Mission-first', '任务优先'],
    terminal: ['Terminal-first', '终端优先'],
    title: ['Switch layout', '切换布局'],
  },
  empty: {
    title: ['Herdr runtime not connected', '未连接 Herdr 运行时'],
    hint: ['The Herdr control plane will appear here once the runtime is configured.', '配置运行时后，此处将显示 Herdr 控制面。'],
  },
  toast: {
    markSeen: ['{{name}}: unseen cleared, done → idle', '{{name}}：待查看状态已清除，已完成 → 空闲'],
    resolveBlock: ['Approval completed inside the real Herdr terminal; lifecycle hook reports “working”', '审批在真实 Herdr 终端窗格内完成，生命周期钩子上报「工作中」'],
    recentOutput: ['Reading agent.read history — kept separate from the live terminal', '读取 agent.read 历史；与实时连接的终端 明确分离'],
    more: ['Will operate {{pane}} via the official Herdr agent.{{action}} API', '将通过官方 Herdr agent.{{action}} 接口操作 {{pane}}'],
    promptSent: ['Instruction seq advanced; waiting for idle/done', '指令生效序号已前进；开始等待空闲／完成'],
    planCreated: ['Planner generated 4 task nodes; workers not started yet', '规划智能体已生成 4 个任务节点；尚未启动执行智能体'],
    runFirst: ['Generate the task graph first', '请先生成任务图'],
    revisionCreated: ['Created revision round 2 via Herdr start/instruction API', '已通过 Herdr 启动／指令接口 创建修订轮次 2'],
    reviewPassed: ['Real reviewer agent passed the second review', '真实审查智能体二次审查通过'],
    mergeConfirmed: ['User merge confirmation recorded', '已记录用户合入确认'],
    focusSent: ['Called Herdr agent.focus and marked as seen', '已调用 Herdr agent.focus 并标记已查看'],
    resizeSent: ['Sent 142×38 resize event via official terminal transport', '已通过官方终端传输协议 发送 142×38 尺寸调整事件'],
    keysSent: ['Key panel: Ctrl+C / Enter / custom sequences', '发送按键面板：Ctrl+C / 回车 / 自定义键序列'],
    attached: ['Live connection established via official binary transport', '已通过官方二进制传输协议建立实时连接'],
    detached: ['Client detached; the Herdr terminal pane keeps running', '客户端已断开；Herdr 终端窗格继续运行'],
  },
};

function build(langIndex) {
  const out = {};
  for (const [group, entries] of Object.entries(KEYS)) {
    out[group] = {};
    for (const [key, pair] of Object.entries(entries)) out[group][key] = pair[langIndex];
  }
  return out;
}

const enHerdr = build(0);
const zhHerdr = build(1);
en.herdr = enHerdr;
zh.herdr = zhHerdr;
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n');
fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2) + '\n');

const flat = (o, p = '', out = []) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out.push(key);
  }
  return out;
};
const ek = flat(en.herdr).sort();
const zk = flat(zh.herdr).sort();
if (JSON.stringify(ek) !== JSON.stringify(zk)) {
  console.error('键集不一致! en=', ek.length, 'zh=', zk.length);
  process.exit(1);
}
console.log(`herdr 命名空间注入完成: ${ek.length} 键，en/zh 键集一致`);
