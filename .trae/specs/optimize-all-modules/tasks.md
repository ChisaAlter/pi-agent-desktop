# Tasks

按优先级与依赖关系排序。每个 Task 内的 SubTask 可并行,Task 之间有显式依赖。

## Phase 1: Critical 安全与数据一致性修复(无依赖,可全并行)

- [x] Task 1: 修复 `git:undo` 路径遍历与误删风险
  - [ ] SubTask 1.1: 在 `apps/desktop/src/main/ipc/chat.ipc.ts` 行 926 后加 `if (gitPath.startsWith("../") || gitPath === "..") return ipcError("ipcErrors.chat.gitUndoInvalid", "目标路径超出工作区")`
  - [ ] SubTask 1.2: 行 928-943 fallback 分支前用 `execFileSync("git", ["status", "--porcelain", "--", gitPath])` 判断是否 `??` untracked,只对 untracked 文件 `rmSync`,否则 log + 返回 ipcError
  - [ ] SubTask 1.3: 加单测覆盖:`git:undo` workspace 外路径、tracked 文件、untracked 文件三种场景

- [x] Task 2: 修复 `long-horizon/database.ts` 跨 workspace 数据泄漏 + BM25 score floor bug
  - [ ] SubTask 2.1: 行 238-252 `listRecentMemories` WHERE 子句改为 `(?1 IS NULL OR workspace_id = ?1 OR (scope='global' AND workspace_id IS NULL))`
  - [ ] SubTask 2.2: 行 377-381 `searchLayered` 先过滤 `record.score != null && record.score > 0`;cutoff 语义改为 `topScore * (1 - floor)`;统一 bm25 取绝对值
  - [ ] SubTask 2.3: 行 345-351 `buildTree` 加 `maxDepth=16` + `Set<string>` 防环
  - [ ] SubTask 2.4: 行 266-287 `setSourceTasks` 用 `BEGIN/COMMIT` 事务包裹
  - [ ] SubTask 2.5: 加单测:跨 workspace 查询隔离、score floor 过滤、循环 parent_id 防护

- [x] Task 3: 修复 `agent-runtime/registry.ts` `suppressEventForwarding` 跨 agent 串扰
  - [ ] SubTask 3.1: 行 66 `private suppressEventForwarding = false` 改为 `private suppressedAgentIds = new Set<string>()`
  - [ ] SubTask 3.2: 行 129/257/313/457/473 所有 `this.suppressEventForwarding = true/false` 改为 `add(agentId)`/`delete(agentId)`
  - [ ] SubTask 3.3: 行 290 `if (!this.suppressEventForwarding)` 改为 `if (!this.suppressedAgentIds.has(runtime.tab.id))`
  - [ ] SubTask 3.4: 加单测:多 agent 并发模式切换,验证非目标 agent 事件不被抑制

- [x] Task 4: 修复 `usePiStream.ts` 三大 Critical 问题
  - [ ] SubTask 4.1: 行 456 `const { getCurrentSession, addMessage, ... } = useSessionStore()` 改为顶部 selector 订阅 + actions 用 `useSessionStore.getState().xxx` 直接调用
  - [ ] SubTask 4.2: 行 991/995-1027 followUp 分支 return 前加 `promptInFlightRef.current = false`
  - [ ] SubTask 4.3: 行 644-654/666-678/716-726/780-786/827-836 `streamPersistRef` 重建时用 `{ ...streamPersistRef.current, sessionId, messageId }` 或用 textRef/thinkingRef 初始化
  - [ ] SubTask 4.4: 加测试:流式时兄弟组件 re-render 次数为 0、followUp 后续发送正常创建 message row、message_end 后 thinking/toolCalls 不丢失

- [x] Task 5: 修复 `TopTabBar.tsx` `sr-only` 包裹 rightSlot bug
  - [ ] SubTask 5.1: `apps/desktop/src/renderer/src/components/TopTabBar/TopTabBar.tsx` 行 62 `<div className="sr-only">` 改为 `<div className="...">` 正常显示
  - [ ] SubTask 5.2: 验证 WorkspaceSwitcher 在 TopTabBar 右槽正常显示

- [x] Task 6: 修复 `CommandPalette.tsx` render 体内 `useSessionStore.getState()` 反模式
  - [ ] SubTask 6.1: `apps/desktop/src/renderer/src/components/CommandPalette/CommandPalette.tsx` 行 380-408 `const sessions = useSessionStore.getState().sessions` 改为顶部 `const sessions = useSessionStore((s) => s.sessions)`
  - [ ] SubTask 6.2: 行 225-258 render 体内 `results` 计算改为 `useMemo(() => computeResults(...), [mode, query, files, ...])`
  - [ ] SubTask 6.3: 行 235-258 `gitContextCommands` 改为 `useMemo` 依赖 `[gitStatus]`

- [x] Task 7: 修复 `ChatView.tsx` `handleStop` stale closure
  - [ ] SubTask 7.1: `apps/desktop/src/renderer/src/components/ChatView/ChatView.tsx` 行 523-538 `handleStop` 改用 `useEventCallback` 模式(用 ref 持有最新 messages,callback 依赖空数组)
  - [ ] SubTask 7.2: 行 385-484 plan action 90 行 effect 拆为 `usePlanSyncEffect(currentSessionId)` 独立 hook + `useRenderedPlanCardIds` 去重 hook

- [x] Task 8: 修复 `settings.ipc.ts` 两个 bug
  - [ ] SubTask 8.1: 行 106 `hasApiKey: false` 改为 `hasApiKey: Boolean(p.apiKey)` 或从 `configManager.getAuthConfig()` 读取
  - [ ] SubTask 8.2: 行 113 `join(process.cwd(), '.agents', 'skills')` 改为接收 `workspaceId` 参数,从 `store.get('workspaces')` 查 path 后定位
  - [ ] SubTask 8.3: 抽 `services/skills/list-local-skills.ts` 移出 IPC 层

- [x] Task 9: 修复 `preload/index.ts` 通用 `invoke` 白名单混 invoke/send 通道
  - [ ] SubTask 9.1: 行 333-355 `ALLOWED` 拆为 `ALLOWED_INVOKE`(只含 `ipcMain.handle` 通道)与 `ALLOWED_SEND`(只含 `ipcMain.on` 通道)
  - [ ] SubTask 9.2: `invoke` 通用方法只接受 `ALLOWED_INVOKE`;`send` 走单独方法或 dedicated method
  - [ ] SubTask 9.3: 验证 `log:write`/`approval:respond`/`approval:set-auto-approve`/`plan:respond`/`permission:respond`/`workbench:set-active-file` 不再走 `invoke`

- [x] Task 10: 修复 `child-agent.ts` AbortSignal race + stdin error 漏调 finish
  - [ ] SubTask 10.1: `apps/desktop/extensions/compose-mode/child-agent.ts` 行 117 之前加 `if (input.signal?.aborted) { return { ok: false, ... } }` 短路
  - [ ] SubTask 10.2: spawn 之前注册 abort listener,listener 内记 `pendingKill = true` 标志,spawn 后立即检查并 kill
  - [ ] SubTask 10.3: 行 129-131 `child.stdin?.on("error", ...)` 改为 `child.kill()` + `finish(1)`
  - [ ] SubTask 10.4: 行 152 `finish` 内加 `input.signal?.removeEventListener("abort", abort)` 防 listener 累积

- [x] Task 11: 修复 `smoke-main-runtime.cjs` 污染 built bundle
  - [ ] SubTask 11.1: `scripts/smoke-main-runtime.cjs` 改为 `fs.mkdtempSync` 创建 tmp 目录,`fs.copyFileSync` 复制 `out/main/index.js` 到 tmp 后 patch,require tmp 版本
  - [ ] SubTask 11.2: `.github/workflows/ci.yml` 在 `Build renderer` 后加 `node scripts/smoke-main-runtime.cjs` 步骤
  - [ ] SubTask 11.3: `.github/workflows/release.yml` 在 typecheck/lint/test 后加 smoke 步骤

- [x] Task 12: 修复 `electron-builder.yml` + `release.yml` native rebuild 缺失
  - [ ] SubTask 12.1: `.github/workflows/release.yml` "Install dependencies" 后加 `pnpm --filter @pi-desktop/desktop exec electron-rebuild -f -w node-pty,sharp`
  - [ ] SubTask 12.2: `apps/desktop/electron-builder.yml` 行 10 `!src/*` 改为 `!src/**/*` 排除所有源码
  - [ ] SubTask 12.3: 行 36 `warningsAsErrors: false` 改为 `true`
  - [ ] SubTask 12.4: 加 `asarUnpack: ["**/node-pty/**", "**/sharp/**", "**/*.node"]`
  - [ ] SubTask 12.5: 行 19-20 删除占位 `publisherName` 或改为 `${env.PI_DESKTOP_PUBLISHER_NAME}`

- [x] Task 13: 更新 AGENTS.md 修正 better-sqlite3 虚假描述
  - [ ] SubTask 13.1: 删除 "better-sqlite3 (persistence)" 与 "session-sqlite.ts (v1.2 baseline)" 段落
  - [ ] SubTask 13.2: 改为 "long-horizon/database.ts 使用 node:sqlite (Node 22 内置 DatabaseSync);会话持久化走 electron-store (JSON)"
  - [ ] SubTask 13.3: 修正 "Native modules" 列表,删除 better-sqlite3(若实际未引入)

## Phase 2: High 性能与并发修复(部分依赖 Phase 1)

- [ ] Task 14: `git-service.ts` 全部 `execFileSync` 异步化 [依赖 Task 1]
  - [ ] SubTask 14.1: 所有 `execFileSync` 改为 `execFile` + Promise 封装
  - [ ] SubTask 14.2: 所有调用加 `timeout: 10000`
  - [ ] SubTask 14.3: `gitChangedFiles` 行 233/239 用 `git status -z`(NUL 分隔)解析,支持文件名含空格
  - [ ] SubTask 14.4: 行 167 `gitCheckout` 分支名正则放宽或用 `rev-parse --verify` 校验

- [ ] Task 15: `long-horizon/database.ts` DatabaseSync 异步化 [依赖 Task 2]
  - [ ] SubTask 15.1: 短期:所有 DB 调用包到 `worker_threads`,主线程投递任务
  - [ ] SubTask 15.2: `migrateLegacyMemoryJsonl` 行 132-147 改为 `readline.createInterface` 流式 + 分批事务
  - [ ] SubTask 15.3: `tokenize` 行 63-73 CJK 单字也建索引(unigram + bigram 混合)

- [ ] Task 16: `session-store.ts` mutex 按 session 粒度 + 索引
  - [ ] SubTask 16.1: 行 25 `let mutexChain` 改为 `const mutexChains = new Map<string, Promise<unknown>>()`
  - [ ] SubTask 16.2: `withLock` 接受 `key: string` 参数
  - [ ] SubTask 16.3: 所有 `withLock(() => ...)` 改为 `withLock(sessionId, () => ...)`
  - [ ] SubTask 16.4: 新增模块级 `const sessionIndex = new Map<string, Session>()`,写入时同步更新,读取时 `sessionIndex.get(id)` 替代 `all.find(...)`

- [ ] Task 17: `extension-ui-bridge.ts` + `approval-bridge.ts` 按 workspaceId 隔离
  - [ ] SubTask 17.1: `extension-ui-bridge.ts` 行 37-38 `pendingRequests` 改为 `Map<workspaceId, Map<string, PendingRequest>>`;`currentPermissionMode` 改为 `Map<workspaceId, ...>`
  - [ ] SubTask 17.2: 行 41-43 `getWindow` 改为 `createExtensionUiBridge` 增加 `getTargetWindow: () => BrowserWindow` 参数
  - [ ] SubTask 17.3: `approval-bridge.ts` 行 12/24 同样按 workspaceId 隔离 pending map
  - [ ] SubTask 17.4: 长期:合并 approval-bridge 到 extension-ui-bridge 消除职责重叠

- [ ] Task 18: `pi-session/registry.ts` `ensureSubscribed` TOCTOU 修复
  - [ ] SubTask 18.1: 在 `entry` 上加 `subscribing: Promise<void>` 字段
  - [ ] SubTask 18.2: 第一次调用时创建 promise,第二次复用(类似 `creating` 模式)
  - [ ] SubTask 18.3: watchdog disarm 改为"最后活动时间"检测,任何事件都更新 lastActivity

- [ ] Task 19: `chat.ipc.ts` 拆分 + 同步 IO 异步化 [依赖 Task 1/8]
  - [ ] SubTask 19.1: 拆分为 `chat-slash.ipc.ts`(290-469)/`chat-plan.ipc.ts`(87-288, 522-559)/`chat-longhorizon.ipc.ts`(561-668)/`chat-prompt.ipc.ts`(812-904)/`chat-git.ipc.ts`(906-945),`chat.ipc.ts` 只保留 `setupChatIpc` 编排
  - [ ] SubTask 19.2: `materializeInlinePlan` 行 260-288 `mkdirSync`/`writeFileSync` 改 `fs/promises`
  - [ ] SubTask 19.3: 行 598-607 `pi:runtime-feature-state` 一次性调用 `resolveBundledDesktopExtensionPaths` + module-level memoize
  - [ ] SubTask 19.4: 行 686-690 删除 `mode` 变量与 `void mode` 死代码
  - [ ] SubTask 19.5: 行 830 算出 mode 后立即 `agentModeByWorkspace.set(ws.id, mode)`,避免 await 期间 stale 读

- [ ] Task 20: `skills.ipc.ts` SSRF + 并发 toggle 修复
  - [ ] SubTask 20.1: 抽 `services/ssrf-guard.ts` 共享 `isSafeUrl`(从 `config.ipc.ts` 提取)
  - [ ] SubTask 20.2: 行 175-176 `skills:github-import` URL 校验复用 `isSafeUrl`
  - [ ] SubTask 20.3: 行 15 删除顶部 `rmSync` import,行 204 删除 `const { rmSync } = await import("fs")` 重复动态 import
  - [ ] SubTask 20.4: `skills:toggle` 行 144-162 用 `withLock(stateFile)` 序列化 read-modify-write
  - [ ] SubTask 20.5: 行 212 `emptyHooksDir` 改用 `os.tmpdir()`,行 227 cleanup 失败加 `log.warn`

- [ ] Task 21: `workspace.ipc.ts` 抽 `mutateWorkspaces(fn)` + mutex + protected path 校验
  - [ ] SubTask 21.1: 抽 `mutateWorkspaces(fn: (current: Workspace[]) => Workspace[]): Promise<Workspace[]>` 内部用 mutex
  - [ ] SubTask 21.2: `workspace:create`/`create-empty` 加 `getProtectedPathReason(path)` 校验
  - [ ] SubTask 21.3: `files:select` handler 移到 `files.ipc.ts`
  - [ ] SubTask 21.4: `workspace:delete` 加 `return { success: true }`

- [ ] Task 22: `schemas.ts` 长度限制 + toolCallSchema
  - [ ] SubTask 22.1: 所有 `z.array(...)` 加 `.max(...)`(files `.max(10000)`,sourcePaths `.max(100)`)
  - [ ] SubTask 22.2: 所有 `z.string()` query 加 `.max(256)`
  - [ ] SubTask 22.3: 定义 `toolCallSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown(), output: z.unknown().optional(), status: z.enum([...]) })`,替换 `z.array(z.unknown())`
  - [ ] SubTask 22.4: 补 `gitLogSchema`/`gitStatusSchema`/`gitBranchesSchema`
  - [ ] SubTask 22.5: `updateSessionMetadataSchema` 行 239 `lastOpenedAt: z.number()` 加 `.nonnegative()`

- [ ] Task 23: `shared-types/index.ts` 拆分 + IpcError discriminated union
  - [ ] SubTask 23.1: 拆为 ~20 个领域文件(workspace/session/agent/slash/long-horizon/goals/imports/pi-config/settings/permissions/plan/pi-driver/updater/ipc-error/files/terminal/git/skills/projects/pi-packages/pi-api),`index.ts` 只 re-export
  - [ ] SubTask 23.2: `IpcError` 加 `__brand: "IpcError"` 字段
  - [ ] SubTask 23.3: 全代码库 grep `await piAPI.` 找出未 `isIpcError` narrow 的调用,补 narrow
  - [ ] SubTask 23.4: 运行时常量(`DEFAULT_LONG_HORIZON_SETTINGS`/`ipcError`/`isIpcError`/`classifyCommandRisk`)移到 `@pi-desktop/shared-runtime` 或显式标注保留
  - [ ] SubTask 23.5: `events.ts` Legacy 扁平形状加 `@deprecated since v1.0, removed in v1.3`

- [ ] Task 24: `preload/index.ts` 类型契约补齐 [依赖 Task 23]
  - [ ] SubTask 24.1: 所有 `ipcRenderer.invoke("...")` 加 `as Promise<T>` 或抽 `invokeTyped<T>(channel, ...args)` helper
  - [ ] SubTask 24.2: 行 174 `onPermissionUpdate` 定义 `PermissionUpdatePayload` 接口
  - [ ] SubTask 24.3: 行 212 `onSettingsChanged` 改为 `subscribe<AppSettings>("settings:changed", cb)`
  - [ ] SubTask 24.4: `describeImages` 实现或从 `PiAPI` 类型删除
  - [ ] SubTask 24.5: `permissionRespond` 第二参数收敛为 `ExtensionUiResponse | PermissionDecision`

- [ ] Task 25: `compose-workflow.ts` 全局超时 + Merge fast-fail + topoSort SCC
  - [ ] SubTask 25.1: `executeComposeWorkflow` 入口计算 `deadline = Date.now() + (args.timeoutMs ?? 60*60*1000)`,每阶段前检查
  - [ ] SubTask 25.2: 入口处 `args.commit === true && worktreeSupport.clean === false` 立即抛 `IpcError("compose.dirtyRepo")`
  - [ ] SubTask 25.3: `topoSortTasks` 改 Tarjan SCC:环内 task 串行,环外按拓扑批次;`unknownDeps` 收集并在 `degradedReason` 提示
  - [ ] SubTask 25.4: `parseReviewResult` 改用 JSON 输出协议 `===REVIEW===\n{"ready":bool,...}`,失败时默认 `ready=false`(fail-safe)
  - [ ] SubTask 25.5: 650 行单文件拆分为 `phases/brainstorm.ts`/`design.ts`/`implement.ts`/`verify.ts`/`review.ts`/`report.ts`/`merge.ts`

- [ ] Task 26: `ChatInput.tsx` 1432 行拆分
  - [ ] SubTask 26.1: 抽 `useInputText(value, onChange)` hook(文本状态 + textarea 自适应,改 `useLayoutEffect`)
  - [ ] SubTask 26.2: 抽 `usePrefillConsumer(prefill, onConsumed)` hook(预填消费 + onConsumedRef)
  - [ ] SubTask 26.3: 抽 `useInputShortcuts(submit, stop, history)` hook
  - [ ] SubTask 26.4: 抽 `<InputAttachments />`/`<InputMentionPopover />`/`<InputCommandPopover />`/`<InputToolbar />` 子组件
  - [ ] SubTask 26.5: 主 `<ChatInput />` 仅做组合,单文件 < 300 行

- [ ] Task 27: `FileWorkspace.tsx` 1052 行重构
  - [ ] SubTask 27.1: 抽 `useLatestRequest()` 通用竞态保护 hook,替换 4 处 sequence ref
  - [ ] SubTask 27.2: 抽 `useDebouncedSave(filePath, draft, onSave)` hook,内部 `useRef` 持有 timer,unmount 统一 `clearTimeout`
  - [ ] SubTask 27.3: 23 个 useState 用 `useReducer` + 6 个 slice(tree/file/git/diff/save/conflict)
  - [ ] SubTask 27.4: 抽 `<SaveConflictDialog />` 子组件 + `useSaveConflict()` hook

- [ ] Task 28: `RightRail.tsx` 15s 轮询 + setTimeout 清理
  - [ ] SubTask 28.1: 行 182 `setInterval` 加 `document.visibilityState` 监听,隐藏时 `clearInterval` + 右栏折叠时跳过
  - [ ] SubTask 28.2: 抽 `useTransientState(duration)` hook,替换 4 处 `setTimeout(() => setXxx(null), 1600)`
  - [ ] SubTask 28.3: 滚动监听加 `requestAnimationFrame` 节流

- [ ] Task 29: 虚拟列表项 `MessageBubble.tsx` 性能优化
  - [ ] SubTask 29.1: 加 `export const MessageBubble = React.memo(function MessageBubble(...) { ... }, areEqual)`,自定义 areEqual 比较 message.id + isStreaming
  - [ ] SubTask 29.2: `inferInlinePlanAction`/`toolSummary`/`splitInlineThinking` 全部用 `useMemo` 包裹
  - [ ] SubTask 29.3: `usePlanStore((state) => state.steps)` 改 selector 订阅 `state.steps[planAction?.id]`

- [ ] Task 30: `DateGroupedSessionList` + `ProjectGroupedSessionList` 抽共享模块
  - [ ] SubTask 30.1: 抽 `components/MiniMaxCode/SessionRow.tsx` 共享 SessionRow/IconMessage/SmallActionButton/ArchiveIcon 等
  - [ ] SubTask 30.2: 两个文件 import 共享模块,消除代码克隆
  - [ ] SubTask 30.3: `DateGroupedSessionList` 行 init `expandedGroups` 用 `useMemo` 依赖 `[t]` 处理语言切换

- [ ] Task 31: `PlanCard.tsx` 全量补 i18n
  - [ ] SubTask 31.1: 行 41-60 `statusLabel` 函数 case 全部改 `t("planCard.status.executing")` 等
  - [ ] SubTask 31.2: 所有硬编码中文("展开计划详情"/"发送补充"/"取消"/"执行计划")改 `t()`
  - [ ] SubTask 31.3: 补 zh-CN.json / en-US.json key
  - [ ] SubTask 31.4: `extractChoiceOptions` 用 `useMemo` 包裹

- [ ] Task 32: `vitest.config.ts` 补别名 + coverage + environment
  - [ ] SubTask 32.1: 加 `"@pi-desktop/shared-types": resolve(__dirname, "../../packages/shared-types/src")` 与 `"@pi-desktop/*": resolve(__dirname, "../../packages/*/src")`
  - [ ] SubTask 32.2: 加 `coverage: { provider: "v8", reporter: ["text", "html", "lcov"], include: ["src/**/*.{ts,tsx}", "extensions/**/*.{ts,tsx}"], exclude: ["**/__tests__/**"], thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 } }`
  - [ ] SubTask 32.3: 加 `environmentMatchGlobs: [["src/renderer/**/*.test.tsx", "jsdom"]]`
  - [ ] SubTask 32.4: `include` 加 `"../../packages/shared-types/**/*.test.ts"`

- [ ] Task 33: `ci.yml` 加 cache + matrix + E2E + artifact
  - [ ] SubTask 33.1: 加 `actions/cache@v4` 缓存 `~/.local/share/pnpm/store` + `apps/desktop/.electron-cache` + `~/.cache/electron`
  - [ ] SubTask 33.2: 加 matrix `os: [windows-latest, macos-latest, ubuntu-latest]`,mac/linux 跳过 E2E
  - [ ] SubTask 33.3: typecheck/lint/test/build 拆为 `quality` + `build` 两个 job 并行
  - [ ] SubTask 33.4: 加 E2E job `needs: build`,跑 `pnpm --filter @pi-desktop/desktop e2e`
  - [ ] SubTask 33.5: 加 `actions/upload-artifact@v4` 上传 `apps/desktop/out/`

- [ ] Task 34: `eslint.config.js` + `lefthook.yml` + `tsconfig.base.json` 配置修复
  - [ ] SubTask 34.1: `eslint.config.js` 删 30+ 行手动 globals 列表(因 `no-undef: off` 已失效)
  - [ ] SubTask 34.2: `react-hooks/exhaustive-deps` 升 `error`
  - [ ] SubTask 34.3: `no-empty` 改 `allowEmptyCatch: false`,强制 `catch (e) { /* reason */ }` 注释
  - [ ] SubTask 34.4: 加 `eslint-plugin-import` + `eslint-plugin-jsx-a11y`
  - [ ] SubTask 34.5: `lefthook.yml` 加 `pre-push: commands: test` + `commit-msg` conform 校验
  - [ ] SubTask 34.6: `lefthook.yml` typecheck/lint 加 `files: git diff --name-only HEAD HEAD~1 -- '*.ts' '*.tsx'` glob 限定
  - [ ] SubTask 34.7: `tsconfig.base.json` 加 `"@": ["apps/desktop/src/renderer/src"]` 与 `"@/*": ["apps/desktop/src/renderer/src/*"]`
  - [ ] SubTask 34.8: `tsconfig.base.json` 加 `verbatimModuleSyntax: true`

## Phase 3: Medium/Low 改进(可选,无依赖)

- [ ] Task 35: 跨 store 共性问题统一封装
  - [ ] SubTask 35.1: 抽 `utils/subscription-manager.ts` `createSubscriptionManager()`,统一 plan-store/queue-store/permission-store 模块级订阅变量
  - [ ] SubTask 35.2: 抽 `utils/pi-api.ts` `getPiAPI()` helper,替换 session-store/workspace-store/updater-store 重复定义
  - [ ] SubTask 35.3: 抽 `utils/ipc.ts` `partition`/`unwrapIpcResult` helper,替换 pi-status-store/updater-store 重复
  - [ ] SubTask 35.4: session-store/workspace-store/settings-store 的 `loadXxx()` 从 store creator 改为显式 `init()` action

- [ ] Task 36: non-serializable 移出 zustand state
  - [ ] SubTask 36.1: `approval-store.ts` `_pendingResolves` 改模块级 Map
  - [ ] SubTask 36.2: `attachments-store.ts` `byWorkspace` 改 `Record<string, Attachment[]>`
  - [ ] SubTask 36.3: `pi-status-store.ts`/`updater-store.ts` `_cleanup` 改模块级变量
  - [ ] SubTask 36.4: `approval-store.ts` `waitForApproval` 加默认 5 分钟超时

- [ ] Task 37: IPC handler 重复代码抽取
  - [ ] SubTask 37.1: 抽 `withValidation(schema, input, onValid)` helper,替换 agents.ipc.ts/claude-sessions/codex-sessions 的 `safeParse` 模板
  - [ ] SubTask 37.2: 抽 `setupSessionImporterIpc(importer, prefix)` helper,合并 claude-sessions + codex-sessions
  - [ ] SubTask 37.3: 抽 `withPiDriver<T>(fn)` helper,替换 pi-driver.ipc.ts 5 处 `if (!piDriver)` 重复
  - [ ] SubTask 37.4: 抽 `withPackageSource(handler, action)` helper,替换 packages.ipc.ts install/remove/update 三处
  - [ ] SubTask 37.5: 抽 `withUpdaterAction(action, errorCode)` helper,替换 updater.ipc.ts 三处

- [ ] Task 38: `command-risk.ts` 补单测 + 正则完善
  - [ ] SubTask 38.1: 加 `command-risk.test.ts` 覆盖 17 个正则的边界 case
  - [ ] SubTask 38.2: `rm -rf` 正则补充 `--recursive`/`--force` 长选项
  - [ ] SubTask 38.3: `chmod 777` 改为 `/\bchmod\s+777\b/`(任何路径)
  - [ ] SubTask 38.4: 加 `npm publish`/`docker rm -f`/`kubectl delete`/`terraform destroy` 等高危命令
  - [ ] SubTask 38.5: 行 25-27 `classifyCommandRisk("")` 返回 "normal" 而非 "high"

- [ ] Task 39: 各 IPC handler protected path 校验补齐
  - [ ] SubTask 39.1: `git.ipc.ts` `git:status`/`git:log`/`git:branches`/`git:checkout`/`git:create-branch` 加 `getProtectedPathReason(workspacePath)` 校验
  - [ ] SubTask 39.2: `git.ipc.ts` `gitOriginalContent` 加 protected path 双参校验
  - [ ] SubTask 39.3: `local-file-protocol.ts` 集成 `getProtectedPathReason` 拦截敏感文件
  - [ ] SubTask 39.4: `files.ipc.ts` `files:readTextFile`/`files:writeTextFile` 加 protected path 校验(若未做)

- [ ] Task 40: 杂项 Medium 修复
  - [ ] SubTask 40.1: `config.ipc.ts` `isSafeUrl` 行 22-26 修复 IPv4 校验 bug(`b1 === 169 && b2 === 254`)
  - [ ] SubTask 40.2: `config.ipc.ts` `isSafeUrl` 加 DNS 解析后 IP 二次校验(防 DNS rebinding)
  - [ ] SubTask 40.3: `files.ipc.ts` `files:readTextFile` 行 69-72 改 `fs/promises` 的 `open + read(head, 0, maxBytes)`
  - [ ] SubTask 40.4: `files.ipc.ts` `files:search`/`files:list` 加 30s TTL 缓存
  - [ ] SubTask 40.5: `settings.ipc.ts` `pi:list-skills` 改 `fs/promises` + 30s TTL 缓存
  - [ ] SubTask 40.6: `settings.ipc.ts` `settings:set` 行 41-43 `structuredClone(current)` 改为只拷贝被覆盖字段
  - [ ] SubTask 40.7: `config/config-manager.ts` 加内存缓存(mtime 失效)+ 原子写(tmp + rename)
  - [ ] SubTask 40.8: `approval/pending-edits.ts` 加 `getByToolCallId(toolCallId)` + 缓存 list 结果
  - [ ] SubTask 40.9: `approval/interceptor.ts` 行 80-84 high risk 分支加 fallback(扩展未加载时走老弹窗)
  - [ ] SubTask 40.10: `updater.ts` 行 242-256 setInterval/setTimeout 保存引用 + 返回 dispose

# Task Dependencies

- Task 1 → Task 14 (git:undo 修复后,git-service 异步化)
- Task 2 → Task 15 (database 修复后,DatabaseSync 异步化)
- Task 8 → Task 19 (settings.ipc 修复后,chat.ipc 拆分)
- Task 11 → Task 33 (smoke 修复后,加入 CI)
- Task 23 → Task 24 (shared-types 拆分后,preload 类型补齐)
- Task 25 SubTask 5(拆分)依赖 Task 25 SubTask 1-4(逻辑修复)
- Task 32 → Task 33 (vitest 配置后,CI 加 coverage 检查)
- Task 34 SubTask 1-4(eslint)与 Task 34 SubTask 5-6(lefthook)与 Task 34 SubTask 7-8(tsconfig)可并行
- Phase 1(Task 1-13)全部可并行,无内部依赖
- Phase 2(Task 14-34)按上述依赖,大部分可并行
- Phase 3(Task 35-40)无依赖,可全并行

# 并行执行建议

**Wave 1(Phase 1 全并行,13 个 Task)**:Task 1/2/3/4/5/6/7/8/9/10/11/12/13
**Wave 2(Phase 2 依赖 Wave 1)**:Task 14(依赖 1)/15(依赖 2)/16/17/18/19(依赖 1,8)/20/21/22/23/24(依赖 23)/25/26/27/28/29/30/31/32/33(依赖 11,32)/34
**Wave 3(Phase 3 全并行)**:Task 35/36/37/38/39/40
