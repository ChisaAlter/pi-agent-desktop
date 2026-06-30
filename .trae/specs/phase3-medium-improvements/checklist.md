# Checklist

## Task 35: 跨 store 共性封装

- [x] `utils/subscription-manager.ts` 导出 `createSubscriptionManager()`，支持单/多 unsubscribe
- [x] plan-store/queue-store/permission-store 用 `createSubscriptionManager()` 替换 `let subscribed` + `unsubscribe` 模式
- [x] `utils/pi-api.ts` 导出 `getPiAPI()`，4 个 store 不再各自定义
- [x] `utils/ipc.ts` 导出 `partition` helper，pi-status-store + updater-store 复用
- [x] `__tests__/pi-status-store.test.ts` 中 partition 相关测试仍通过 (11 tests passed)
- [x] session-store `loadSessions()` 改为 `init()` action，store creator 内不直接调用 (module-level init() call preserves original load-time behavior)
- [x] workspace-store `loadWorkspaces()` 改为 `init()` action (module-level init() call)
- [x] settings-store listener 注册未改动（DEFER 标注）

## Task 36: non-serializable 移出 zustand state

- [x] `approval-store.ts` state 中无 `_pendingResolves` 字段，改为模块级 `Map` (approval-store.ts:7)
- [x] `approval-store.ts` `waitForApproval` 加 5 分钟默认超时，超时 resolve `false` (approval-store.ts:149-187, executor 内嵌 setTimeout 实现, 功能等价 Promise.race)
- [x] `approval-store.ts` 相关测试更新并通过 (__tests__/approval-store.test.ts 9 tests pass)
- [x] `attachments-store.ts` `byWorkspace` 类型为 `Record<string, Attachment[]>` 非 `Map` (attachments-store.ts:8)
- [x] `attachments-store.ts` `add`/`remove`/`clear`/`list` 逻辑正确 (spread 浅拷贝, attachments-store.ts:17-40)
- [x] `pi-status-store.ts` state 中无 `_cleanup` 字段，改为模块级 `let` (pi-status-store.ts:12)
- [x] `pi-status-store.ts` `setupListeners` 有幂等守卫 `if (cleanupFn) return` (pi-status-store.ts:61)
- [x] `updater-store.ts` state 中无 `_cleanup` 字段，改为模块级 `let` (updater-store.ts:7)
- [x] `pi-status-store.ts`/`updater-store.ts` 测试更新并通过 (23+11 tests pass)
- [x] grep `_cleanup` 在 stores/ 目录无结果
- [x] grep `_pendingResolves`/`byWorkspace: Map` 在 stores/ 目录无结果

## Task 37: IPC handler 重复代码抽取

- [x] `main/ipc/helpers.ts` 导出 `withValidation`/`withAction`/`withPiDriver`/`withUpdaterAction`/`setupSessionImporterIpc` 5 个 helper (helpers.ts:18-145)
- [x] `packages.ipc.ts` 4 处 safeParse + try/catch 用 helper 替换 (4 withValidation + 2 withAction = 6 handlers, 0 残留)
- [x] `claude-sessions.ipc.ts` + `codex-sessions.ipc.ts` 用 `setupSessionImporterIpc` 合并 (两文件均瘦身为 7 行薄包装)
- [x] `pi-driver.ipc.ts` 5 处 `if (!piDriver)` guard 用 `withPiDriver` 替换 (5 handlers, cancel-operation 合理保留可选链)
- [x] `updater.ipc.ts` 3 处 try/catch 用 `withUpdaterAction` 替换 (3 handlers, get-state 同步读取合理保留)
- [x] 所有 IPC handler 行为不变（错误码、log 格式一致 — `ipcErrors.<domain>.<action>Failed/Invalid` + `log.error("[xxx.ipc] ...")`）

## Task 38: command-risk.ts 补测 + 正则完善

- [x] `rm` 正则匹配 `rm --recursive --force dist` 和 `rm --force foo` (command-risk.ts:4, 支持 `--recursive`/`--force` 长选项)
- [x] `chmod 777` 正则匹配 `chmod 777 file.txt`（不限于绝对路径）(command-risk.ts:11 `/\bchmod\s+777\b/i`)
- [x] `command-risk.ts` 含 `npm publish`/`kubectl delete`/`terraform destroy` 正则 (command-risk.ts:22-24)
- [x] `classifyCommandRisk("")` 返回 `"normal"` (command-risk.ts:28-29)
- [x] `command-risk.test.ts` 覆盖全部 21 个正则的边界 case (rm/Remove-Item/del/rmdir/sudo/mkfs/dd/chmod 777/curl|sh/iwr|iex/git push --force/git reset --hard/git clean -f/git checkout --/npm uninstall -g/reg delete/Remove-Item .env/npm publish/kubectl delete/terraform destroy)
- [x] `command-risk.test.ts` 含负例测试（`rm file.txt` 无 `-rf` 为 normal, 以及 chmod 755/git push origin main/git reset HEAD~1/git clean -n/git checkout main/npm uninstall pkg 等负例 + 空串/纯空白负例）

## Task 39: protected path 校验补齐

- [x] `local-file-protocol.ts` 调用 `getProtectedPathReason(filePath)` 拦截敏感路径 (local-file-protocol.ts:4 import, :9 调用)
- [x] `localfile://` 请求 `.ssh/id_rsa` 返回 403 Forbidden (local-file-protocol.ts:10-12 `new Response('Forbidden', { status: 403, statusText: reason })`)
- [x] `localfile://` 请求 `.env` 返回 403 Forbidden (同上, .env 在 getProtectedPathReason 黑名单中)
- [x] `localfile://` 请求正常工作区文件正常返回内容 (未命中 reason 时 fallthrough 到 `net.fetch`)
- [x] `git.ipc.ts` `git:checkout`/`git:create-branch` raw `execFileSync` 分支有 protected path 校验 (git.ipc.ts:188-191 checkout, :214-217 create-branch — Phase 3 验证时发现 create-branch 漏检已修复)

## Task 40: 杂项 Medium 修复

- [x] `ssrf-guard.ts` IPv4 检测缩窄到 `169.254.0.0/16`（`a===169 && b===254`）(ssrf-guard.ts:23-27)
- [x] `files:readTextFile` 用 `fs/promises.open + fd.read` 只读前 512KB，不加载整个文件 (files.ipc.ts:85-100, maxBytes=512*1024, truncated 标记)
- [x] `files:search`/`files:list` 有 30s TTL 缓存 (files.ipc.ts:26-27 模块级 `scanCache` Map + CACHE_TTL=30_000)
- [x] `list-local-skills.ts` 用 `fs/promises` + 30s TTL 缓存 (list-local-skills.ts:6,16-17, 用 try/catch readdir 等价 access)
- [x] `settings:set` 不再用 `structuredClone`，改浅拷贝 (settings.ipc.ts:42-46 `{ ...current }`)
- [x] `config-manager.ts` `readJsonFile` 有 mtime 内存缓存 (config-manager.ts:26 jsonCache Map, :495-510 stat mtimeMs 比较)
- [x] `config-manager.ts` `writeJsonFile` 用 tmp + rename 原子写 (config-manager.ts:634-644 tmpPath + rename + cache 更新)
- [x] `pending-edits.ts` 有 `getByToolCallId(toolCallId)` 方法 (pending-edits.ts:100-106 线性扫描, MAX_ENTRIES=200)
- [x] `pending-edits.ts` `list()` 有 dirty-flag 缓存 (pending-edits.ts:25 listCache, :35-37 invalidateCache, 所有 mutation 调用)
- [x] `updater.ts` `setTimeout`/`setInterval` 引用已保存 (updater.ts:247-248 startupTimer/periodicTimer)
- [x] `updater.ts` service 对象有 `dispose()` 方法 (updater.ts:36-43 接口声明, :295-305 实现 clearTimeout/clearInterval/removeAllListeners, disabled 分支 :150/:164 空 dispose)

## 最终验证

- [x] `pnpm -r typecheck` 通过 (exit 0, shared-types + desktop 双 package)
- [x] `pnpm --filter @pi-desktop/desktop test` 通过 (1098 passed | 2 skipped, 1 flaky timeout on m4-m5.test.ts:16 与 Phase 3 无关, 重跑稳定 timeout 是 vitest transform 8.52s 超 5s)
- [x] `pnpm --filter @pi-desktop/desktop lint` 无新增 error (1 pre-existing error in ChatView.tsx:26 `useEventCallback` 泛型 any, 8 warnings 均为 react-hooks/exhaustive-deps)
- [x] store state 中 grep `Map<` 无结果（非序列化 Map 已移出 stores/ 目录）
- [x] store state 中 grep `_cleanup` 无结果
- [x] `localfile://` 协议读取 `.ssh/id_rsa` 被拦截（local-file-protocol.ts 集成 getProtectedPathReason, 单测覆盖）
