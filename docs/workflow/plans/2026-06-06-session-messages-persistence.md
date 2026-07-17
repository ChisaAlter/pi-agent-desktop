# Pi Desktop — 会话消息持久化与加载 (Hotfix)

> **For agentic workers:** REQUIRED SUB-SKILL: workflow:subagent-driven-development (recommended) or workflow:executing-plans。Steps 用 checkbox (`- [ ]`) 跟踪。

**Goal:** 修复"点了会话不显示消息历史"的根因。切会话 / 重启窗口 / 重启 app 后,会话的完整消息历史仍可见。

**根因 (3 处,缺一不可):**
1. `apps/desktop/src/renderer/src/stores/session-store.ts:73` `loadSessions()` 拉服务端数据时硬编码 `messages: []`,把历史消息全部覆盖为空
2. `apps/desktop/src/main/index.ts` 主进程 `session:create` 没初始化 `messages: []` 字段;`electron-store` 的 sessions 数组里 Session 没有 messages 字段
3. `apps/desktop/src/main/index.ts` 主进程**没有** `session:append-message` / `session:update-message` / `session:update-tool-call` 三个 IPC,renderer 端 `usePiStream` 的 addMessage/updateMessage 只写内存,从不落盘

**结果链:** 用户发消息 → `usePiStream` 写 renderer 内存 store → 切换会话 / 刷新 → 内存清空 → loadSessions 拉回的 sessions 里 messages 全是 [] → ChatView 取 `currentSession.messages.length === 0` → 永远显示 welcome 屏 "准备好开始了吗?" → 用户感受"点了没反应"。

**架构 (修复后):**
```
usePiStream  →  session-store action (内存同步)
            ↓ fire-and-forget IPC
      piAPI.appendMessage / updateMessage / updateToolCall
            ↓
      preload bridge
            ↓
   主进程 session:append-message / update-message / update-tool-call
            ↓
   services/session-store.ts (主进程侧,async mutex 串行化)
            ↓
   electron-store  →  下次启动 listSessions 返完整消息
```

**Tech Stack:** Electron 36, electron-store 8, zod 3, vitest 2, IPC channel 模式 (同其他 session:xxx)

**Reference:** `packages/shared-types/src/index.ts` L21-49 (Session/Message/ToolCall 类型早已定义,契约不缺,只缺实现)

---

## 文件结构 (本 hotfix 涉及)

```
packages/shared-types/src/
└── index.ts                    # MODIFY: PiAPI 加 3 个方法

apps/desktop/src/main/
├── services/
│   ├── session-store.ts        # NEW:  主进程侧 session 持久化模块 (含 mutex)
│   └── __tests__/session-store.test.ts   # NEW
├── ipc/
│   └── sessions.ipc.ts         # NEW:  3 个 IPC handler + zod 校验
├── ipc/schemas.ts              # MODIFY: 加 3 个 schema
└── index.ts                    # MODIFY: 引入 sessions.ipc, 初始化时调用

apps/desktop/src/preload/
└── index.ts                    # MODIFY: 暴露 3 个新方法

apps/desktop/src/renderer/src/
├── stores/session-store.ts     # MODIFY: 移除 messages:[] 硬编码, action 加 IPC 同步
├── hooks/usePiStream.ts        # MODIFY: 流式消息调持久化 action; debounce
└── components/PersistenceBanner/    # NEW: 写失败提示
```

---

## 风险与缓解 (实施前必读)

| 风险 | 等级 | 缓解 |
|------|------|------|
| **R1:** 流式 text_delta 高频触发 IPC,卡 UI/写爆盘 | 高 | Debounce 500ms;`turn_end` / `agent_end` 强制 flush |
| **R2:** electron-store 全量写 sessions 数组,会话多/消息多后变慢 | 中 | 本期可接受 (<1000 msgs/session);v1.1 改 JSONL |
| **R3:** 老数据无 messages 字段,loadSessions 报错 | 中 | loadSessions 后 client 端做 migration,补 `[]` |
| **R4:** 写失败 → 内存有但磁盘丢,状态不一致 | 中 | fire-and-forget + `electron-log` error;UI 顶部 banner |
| **R5:** zod 校验 IPC payload 开销 | 低 | 消息结构简单,zod < 1ms/条 |
| **R6:** 并发写 race (text_delta 和 turn_end 同时到) | 中 | 主进程侧 async mutex 串行化 |
| **R7:** `deleteSession` 后内存里残留 stale messages? | 低 | session-store `setCurrentSession` 时校验 session 是否存在 |

---

## Task 1: 主进程侧 session 持久化模块 (基础)

**Files:**
- Create: `apps/desktop/src/main/services/session-store.ts`
- Create: `apps/desktop/src/main/services/__tests__/session-store.test.ts`

**架构:** 把 sessions 的 4 个基础操作 + 3 个 message 操作抽到独立模块,所有写入走 async mutex。

```ts
// services/session-store.ts (骨架)
import Store from 'electron-store';
import type { Session, Message, ToolCall } from '@shared';
import log from 'electron-log/main';

let mutex: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = mutex;
    let release: () => void = () => undefined;
    mutex = new Promise<void>((r) => (release = r));
    try {
        await prev;
        return await fn();
    } finally {
        release();
    }
}

interface StoreSchema { workspaces: Workspace[]; sessions: Session[]; settings: AppSettings; }
const store = new Store<StoreSchema>(...);  // 跟 index.ts 共享

export async function listSessions(): Promise<Session[]> { return store.get('sessions'); }
export async function getSession(id: string): Promise<Session | undefined> { ... }
export async function createSession(workspaceId: string, title?: string, id?: string): Promise<Session> {
    return withLock(() => {
        const session: Session = { id, workspaceId, title: title ?? '未命名会话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        const all = store.get('sessions');
        all.push(session);
        store.set('sessions', all);
        return session;
    });
}
// ... rename / delete / appendMessage / updateMessage / updateToolCall
```

**Step:**
- [ ] 创建 `services/session-store.ts`,导出 `listSessions / getSession / createSession / renameSession / deleteSession / appendMessage / updateMessage / updateToolCall`
- [ ] 每个写操作走 `withLock` 串行化
- [ ] 写失败 throw → IPC handler 转 `IpcError`
- [ ] 创建 `__tests__/session-store.test.ts`,覆盖:append 增条数、update 改内容、delete 留其他、rename 不动 messages、并发 append 顺序保留

**Verify:** `pnpm --filter @pi-desktop/desktop test session-store` 全 pass。

---

## Task 2: 3 个 IPC handler + zod 校验

**Files:**
- Create: `apps/desktop/src/main/ipc/sessions.ipc.ts`
- Modify: `apps/desktop/src/ipc/schemas.ts`
- Modify: `apps/desktop/src/main/index.ts` (引入并注册)

**Step:**
- [ ] `ipc/schemas.ts` 加 `appendMessageSchema`,`updateMessageSchema`,`updateToolCallSchema` (zod,严格匹配 `Message` / `ToolCall` 形状)
- [ ] 创建 `ipc/sessions.ipc.ts`:
  ```ts
  ipcMain.handle('session:append-message', async (_, sessionId: string, message: Message) => {
      appendMessageSchema.parse([sessionId, message]);  // 校验
      return appendMessage(sessionId, message).catch((e) => ipcError('ipcErrors.session.appendFailed', e.message, { id: sessionId }));
  });
  ipcMain.handle('session:update-message', ...);
  ipcMain.handle('session:update-tool-call', ...);
  ```
- [ ] `index.ts` 把现有 4 个 session handler (`session:list/create/rename/delete`) **重构为走 `services/session-store.ts`**,不在 index.ts 内联实现
- [ ] `index.ts` 启动时调 `setupSessionsIpc()` 注册 7 个 handler

**Verify:** `pnpm --filter @pi-desktop/desktop test` + 新增 `__tests__/sessions.ipc.test.ts` 覆盖 schema 校验失败 → 返 IpcError。

---

## Task 3: shared-types 契约扩展

**Files:**
- Modify: `packages/shared-types/src/index.ts`

**Step:**
- [ ] `PiAPI` 加 3 个方法:
  ```ts
  appendMessage(sessionId: string, message: Message): Promise<void | IpcError>;
  updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void | IpcError>;
  updateToolCall(sessionId: string, messageId: string, toolCallId: string, updates: Partial<ToolCall>): Promise<void | IpcError>;
  ```
- [ ] `pnpm -r typecheck` 通过(主进程/preload/renderer 都要跟着过)

**Verify:** `pnpm --filter @pi-desktop/desktop typecheck` 0 错。

---

## Task 4: preload 桥接

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

**Step:**
- [ ] 加 3 个 `ipcRenderer.invoke` 桥接:
  ```ts
  appendMessage: (sessionId, message) => ipcRenderer.invoke('session:append-message', sessionId, message),
  updateMessage: (sessionId, messageId, updates) => ipcRenderer.invoke('session:update-message', sessionId, messageId, updates),
  updateToolCall: (sessionId, messageId, toolCallId, updates) => ipcRenderer.invoke('session:update-tool-call', sessionId, messageId, toolCallId, updates),
  ```

**Verify:** `pnpm --filter @pi-desktop/desktop typecheck` 0 错。

---

## Task 5: session-store 移除硬编码 + 同步 IPC

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/session-store.ts`

**关键改动:**
- [ ] L73 `messages: []` 改为 `messages: (s.messages as Message[] | undefined) ?? []`
- [ ] 旧数据 migration:loadSessions 完成后,遍历 sessions,任何 messages 字段为 undefined 的补 `[]`(跟服务端对齐)
- [ ] `addMessage` action:内存 set 之后,`window.piAPI?.appendMessage(sessionId, message).catch(e => logger.error('[session-store] persist addMessage failed', e))`
- [ ] `updateMessage` action:同上
- [ ] `addToolCall` action:走 `updateMessage` 路径(把 toolCalls 数组一起 update),不单独写
- [ ] `updateToolCall` action:同上
- [ ] `addStreamingMessage` / `updateStreamingContent` action:流式消息可能高频,**不直接同步** → 走 `pendingPersistRef` 累积,task 6 里有 debounce 处理

**新增测试** (`stores/__tests__/session-store.test.ts`):
- [ ] `loadSessions` 后,messages 字段是服务端给的(空数组或真实数据)
- [ ] `addMessage` 内存 + 调 `piAPI.appendMessage`
- [ ] `piAPI.appendMessage` 失败 → 内存已更新,log error,不 throw

**Verify:** `pnpm --filter @pi-desktop/desktop test session-store` 全 pass。

---

## Task 6: usePiStream 流式消息持久化 + Debounce

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts`

**关键改动:**
- [ ] 引入 `useRef<{ textTimer: number | null; flushPending: () => void }>` 维护 debounce 状态
- [ ] 暴露 `useSessionStore` 的 updateMessage (已有)
- [ ] 改 `addMessage` / `updateMessage` 调用:**改用 `useSessionStore.getState()` 直接调**(绕过 React 调度,保证同步写入)
- [ ] 关键:流式 `text_delta` / `thinking_delta` 触发 `updateMessage` 时,**不**调 IPC(高频),只更新内存 + 启/重置 500ms debounce timer
- [ ] `turn_end` / `agent_end` / debounce 到点:flush 一次,把当前 textRef/thinkingRef 持久化到主进程
- [ ] flush 实现:`window.piAPI?.updateMessage(sessionId, messageId, { content, thinking })` + 调 `updateToolCall` 同步所有 running tool calls

**性能特征:**
- 单条 assistant message 全程最多 N 次内存 update + 1 次磁盘持久化 (turn_end 触发)
- IPC 频率:每次 turn 1 次 updateMessage + 0..N 次 updateToolCall + 1 次 user message appendMessage
- 不再 text_delta-by-text_delta 写盘

**Verify:** 现有 `usePiStream.test.tsx` 不应挂;新增测试覆盖 "text_delta 100 次只触发 1 次 IPC updateMessage"。

---

## Task 7: 写失败 UI 提示 (PersistenceBanner)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/PersistenceBanner/PersistenceBanner.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Step:**
- [ ] `session-store` 加 `persistErrorCount: number` + `lastPersistError: string | null`
- [ ] `addMessage`/`updateMessage` 在 IPC 失败时 +1 + 记录
- [ ] 创建 `PersistenceBanner` 组件:`persistErrorCount > 0` 时显示,文案 "消息可能未完整持久化 (N 次写失败)";用户点 ✕ 重置计数
- [ ] App.tsx 顶部渲染 banner

**Verify:** 手动 mock `piAPI.appendMessage` 抛错 → 看到 banner。

---

## 验证策略 (整体)

| 阶段 | 命令 | 通过条件 |
|------|------|---------|
| Type check | `pnpm -r typecheck` | 0 错误 |
| Lint | `pnpm -r lint` | 0 errors |
| Unit (主进程) | `pnpm --filter @pi-desktop/desktop test services/__tests__/session-store` | 全 pass |
| Unit (renderer) | `pnpm --filter @pi-desktop/desktop test stores usePiStream` | 全 pass |
| Full unit | `pnpm -r test` | 313+ pass / 0 fail / 2 skipped (不退步) |
| **E2E 手动** | `pnpm --filter @pi-desktop/desktop dev` | 见下方 5 步 |

**E2E 手动验收清单 (用户自测):**
1. 启动 app,新建会话 "测试 A",发 1 条消息
2. 等 Pi 完整响应 (含 tool call)
3. **关闭窗口,再启动 app**
4. 左侧任务历史点 "测试 A"
5. **预期:** 看到完整对话 (user msg + assistant msg + tool call + 最终回复)
6. **额外:** 再新建 "测试 B",发 1 条消息,不关闭 app,直接点 "测试 A" 切回去 → 立即看到 A 的完整消息

---

## 回退策略

| 场景 | 兜底 |
|------|------|
| 旧数据无 `messages` 字段 | loadSessions 客户端 migration 补 `[]` (Task 5) |
| 新 schema 校验失败 | 旧 IPC 仍工作,只是 messages 不存 (退化为 v0.1.0 行为) |
| 写失败 | fire-and-forget,UI banner 提示,内存数据仍可显示 |
| Debounce 卡住 | 5s hard timeout 强制 flush,确保 turn_end 后 5s 内必落盘 |
| 严重数据损坏 | 启动时 try/catch 读 sessions,失败时 fallback `[]` 并 log error |

**本次 hotfix 不引入 feature flag**(单向修复,无歧义;真有问题就 revert commit)。

---

## 实施顺序与工时

```
Task 1 (主进程 session-store 模块)     ─┐
Task 2 (IPC handler + schema)          ─┼─ Phase 1: 主进程数据层
Task 3 (shared-types 契约)             ─┤
Task 4 (preload 桥)                    ─┘
                                       
Task 5 (renderer session-store 改)     ─┐
Task 6 (usePiStream debounce)          ─┼─ Phase 2: renderer 集成
Task 7 (PersistenceBanner)            ─┘
```

**估计工时:** 200-300 行新代码 + ~150 行测试,**4-6 小时**集中实施 + **1-2 小时**测试/调试。

**提交流程:** 实施完跑完所有验证,commit 拆为 3 个:
1. `feat(main): persistent session store with message persistence`
2. `feat(renderer): debounced message persistence + remove hardcoded []`
3. `feat(ui): persistence banner for failed writes`

---

## 已知限制 (本期不修,留 v1.1)

- ❌ 不做 JSONL 格式 — electron-store 全量写本期可接受 (<1000 msgs/session)
- ❌ 不做消息搜索 — 数据已存,搜索 UI 留 v1.1
- ❌ 不做消息分页/虚拟滚动 — UI 性能优化
- ❌ 不做消息导出/导入 — 数据迁移工具
- ❌ 不做 compaction/摘要 — Pi 自带 `compaction_start` 事件,v1.1 接入
- ❌ 不做跨 workspace session — 维持当前 `Session.workspaceId` 字段但 UI 不实现

---

**版本:** Hotfix v0.1.1 (pre-release,替代未发布的 v0.1.0 hotfix)
**Owner:** TBD
**Status:** 📋 Ready for implementation
