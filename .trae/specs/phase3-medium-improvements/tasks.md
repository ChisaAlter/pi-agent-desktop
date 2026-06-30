# Tasks

按依赖关系排序。Task 之间大部分可并行，显式依赖标注在末尾。

## Task 35: 跨 store 共性封装

- [x] Task 35: 跨 store 共性封装
  - [x] SubTask 35.1: 创建 `utils/subscription-manager.ts`，导出 `createSubscriptionManager()` 工厂函数，支持单/多 unsubscribe handle。替换 plan-store (L298-318, 4 个 unsub)、queue-store (L206-222, 1 个 unsub)、permission-store (L51-73, 1 个 unsub) 的 `let subscribed` + `unsubscribe` 模式
  - [x] SubTask 35.2: 创建 `utils/pi-api.ts`，导出 `getPiAPI(): Window["piAPI"] | undefined`。替换 session-store (L206)、workspace-store (L51)、updater-store (L17)、settings-store (L137) 4 处重复定义
  - [x] SubTask 35.3: 创建 `utils/ipc.ts`，导出 `partition` helper（签名取宽松版 `IpcError | string` 以兼容 pi-status-store）。替换 pi-status-store (L38) 和 updater-store (L21) 2 处。验证 `__tests__/pi-status-store.test.ts` 仍通过
  - [x] SubTask 35.4: session-store `loadSessions()` (L315) 改为显式 `init()` action；workspace-store `loadWorkspaces()` (L92) 同理。settings-store **DEFER**（含 listener 注册 + 6 个闭包变量，风险高）

## Task 36: non-serializable 移出 zustand state

- [x] Task 36: non-serializable 移出 zustand state
  - [x] SubTask 36.1: `approval-store.ts` `_pendingResolves: Map` (L29/L46) 移到模块级 `const pendingResolves = new Map()`。6 个 action 不再 clone Map，直接操作模块级变量。`waitForApproval` (L158) 加 `Promise.race` + 5 分钟默认超时（resolve `false`）。更新所有引用 `_pendingResolves` 的测试
  - [x] SubTask 36.2: `attachments-store.ts` `byWorkspace: Map` (L8/L16) 改为 `Record<string, Attachment[]>`。`add`/`remove`/`clear` 改为 `{ ...s.byWorkspace, [wsId]: next }` 浅拷贝。`list` 改为 `state.byWorkspace[wsId] ?? []`。Grep `byWorkspace` 确认无直接引用
  - [x] SubTask 36.3: `pi-status-store.ts` `_cleanup` (L32/L49) 移到模块级 `let cleanupFn: (() => void) | null = null`。`setupListeners` (L64) 加幂等守卫 `if (cleanupFn) return`。`cleanupListeners` (L84) 改为操作模块级变量。更新测试
  - [x] SubTask 36.4: `updater-store.ts` `_cleanup` (L8/L30) 同 36.3 移到模块级。已有幂等守卫 (L103) 保留。更新测试

## Task 37: IPC handler 重复代码抽取

- [x] Task 37: IPC handler 重复代码抽取
  - [x] SubTask 37.1: 创建 `main/ipc/helpers.ts`，导出 `withValidation(schema, input, invalidKey, onValid)` helper。替换 packages.ipc.ts 4 处 safeParse + try/catch 模板 (L15-30, L56-71, L73-88, L90-105)
  - [x] SubTask 37.2: 创建 `setupSessionImporterIpc(prefix, importer, scanSchema, importSchema)` helper。合并 claude-sessions.ipc.ts (14行) + codex-sessions.ipc.ts (14行) 为共用工厂调用
  - [x] SubTask 37.3: 创建 `withPiDriver(getPiDriver, fn, opts)` helper。替换 pi-driver.ipc.ts 5 处 `if (!piDriver)` guard (L9, L17, L33, L50, L67) + 4 处 try/catch (L20-28, L36-45, L53-62, L70-79)
  - [x] SubTask 37.4: 创建 `withPackageAction(schema, args, opts, fn)` helper（若与 37.1 `withValidation` 重叠则合并）。替换 packages.ipc.ts 4 处。同时覆盖 2 处无 schema 的 try/catch (L32-42, L44-54)
  - [x] SubTask 37.5: 创建 `withUpdaterAction(action, opts)` helper。替换 updater.ipc.ts 3 处 try/catch (L11-21, L23-33, L35-45)

## Task 38: command-risk.ts 补测 + 正则完善

- [x] Task 38: command-risk.ts 补测 + 正则完善
  - [x] SubTask 38.1: 扩充 `command-risk.test.ts`（当前 3 个 it），为全部 18 个正则加边界 case 测试。覆盖：`rm -rf`、`Remove-Item -Recurse`、`del /s`、`rmdir /s`、`sudo`、`mkfs`、`dd if=`、`chmod 777`、`curl|sh`、`iwr|iex`、`irm|iex`、`git push --force`、`git reset --hard`、`git clean -f`、`git checkout -- .`、`npm uninstall -g`、`reg delete`、`Remove-Item .env`。加负例测试（`rm file.txt` 无 `-rf` 应为 normal）
  - [x] SubTask 38.2: `command-risk.ts` L4 `rm` 正则补 `--recursive`/`--force` 长选项匹配
  - [x] SubTask 38.3: `command-risk.ts` L11 `chmod 777` 改为 `/\bchmod\s+777\b/`（去掉路径限制）
  - [x] SubTask 38.4: `command-risk.ts` 新增 `npm publish`/`kubectl delete`/`terraform destroy` 正则
  - [x] SubTask 38.5: `command-risk.ts` L26 `classifyCommandRisk("")` 返回 `"normal"` 而非 `"high"`

## Task 39: protected path 校验补齐

- [x] Task 39: protected path 校验补齐
  - [x] SubTask 39.1: `local-file-protocol.ts` (16行) 集成 `getProtectedPathReason`。在 `net.fetch` 前校验 decoded `filePath`，命中则返回 `new Response("Forbidden", { status: 403 })`。**最高优先**——当前完全无校验
  - [x] SubTask 39.2: `git.ipc.ts` `git:checkout` (L197) 和 `git:create-branch` (L218) 的 raw `execFileSync('git', ['branch', '-a'])` 分支前加 `getProtectedPathReason(workspacePath)` 校验（defense-in-depth，service 层已有但 raw 调用绕过）
  - [x] SubTask 39.3: `files.ipc.ts` — **已完成**（Phase 2 已做 protected path 校验），跳过

## Task 40: 杂项 Medium 修复

- [x] Task 40: 杂项 Medium 修复
  - [x] SubTask 40.1: `ssrf-guard.ts` L25-26 IPv4 修复：`const [, a, b] = ipv4Match.map(Number); if (a === 169 && b === 254) return false`（缩窄到 `169.254.0.0/16`）
  - [x] SubTask 40.3: `files.ipc.ts` `files:readTextFile` (L73) 改 `fs/promises.open + fd.read(buffer, 0, maxBytes, 0)`，只读前 512KB
  - [x] SubTask 40.4: `files.ipc.ts` `files:search`/`files:list` 加 30s TTL 缓存（模块级 `Map<workspacePath, { ts: number; data: T }>`）
  - [x] SubTask 40.5: `list-local-skills.ts` 改 `fs/promises`（`access`/`readdir`/`readFile`）+ 30s TTL 缓存
  - [x] SubTask 40.6: `settings.ipc.ts` `settings:set` (L43-45) `structuredClone(current)` 改为浅拷贝 `{ ...current }`
  - [x] SubTask 40.7: `config-manager.ts` `readJsonFile` 加内存缓存（`Map<fileName, { mtime: number; parsed: T }>` + stat mtime 失效）；`writeJsonFile` 改原子写（tmp + rename）
  - [x] SubTask 40.8: `pending-edits.ts` 加 `getByToolCallId(toolCallId)` 方法（线性扫描 200 条上限即可）；`list()` 加 dirty-flag 缓存（track/review/approve/reject/remove/clear 时失效）
  - [x] SubTask 40.10: `updater.ts` L242/L250 保存 `setTimeout`/`setInterval` 返回引用；service 对象加 `dispose()` 方法清理定时器
  - [x] SubTask 40.2: **DEFER** — `isSafeUrl` DNS rebinding（使函数变 async，影响 config.ipc.ts + skills.ipc.ts 所有调用方）
  - [x] SubTask 40.9: **DEFER** — `interceptor.ts` fallback（需扩展 InterceptorDeps 接口 + 可能阻塞事件流）

# Task Dependencies

- Task 35/36/37/38/39/40 大部分可并行
- Task 36.1 (approval-store) 和 Task 36.2 (attachments-store) 独立
- Task 37.1 (withValidation) 和 Task 37.4 (withPackageAction) 可能合并为一个 helper — 先做 37.1，37.4 复用
- Task 38.1 (测试) 依赖 38.2-38.5 (正则修改) 完成
- 无 Phase 1/2 依赖（Phase 1/2 已完成）

# 并行执行建议

- **Wave 1（全并行）**: Task 35 + Task 36 + Task 38 (正则修改 38.2-38.5) + Task 39 + Task 40 (除 40.7 config-manager 外)
- **Wave 2**: Task 37 (IPC helpers) + Task 38.1 (补测试) + Task 40.7 (config-manager)
- **Wave 3**: 最终验证 `pnpm -r typecheck && pnpm -r test`
