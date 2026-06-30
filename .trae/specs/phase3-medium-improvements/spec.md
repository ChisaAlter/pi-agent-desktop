# Phase 3: Medium/Low 改进 Spec

## Why

Phase 1 (Critical 安全/数据一致性) 与 Phase 2 (High 性能/并发) 已全部完成并通过验证 (typecheck + 1068 tests)。Phase 3 处理剩余的 Medium/Low 级问题，聚焦三类：

1. **代码重复消除**：跨 store 的 `getPiAPI`/`partition`/subscription 模式重复 4-6 处；IPC handler 的 validation/try-catch/guard 模板重复 15+ 处。
2. **安全加固**：`local-file-protocol.ts` 任意本地文件可读（可读 `.ssh/id_rsa`）；`isSafeUrl` IPv4 链路本地检测过于宽泛 (`169.*` 全部拦截而非 `169.254.*`)；`command-risk.ts` 缺 `npm publish`/`kubectl delete`/`terraform destroy` 等高危命令。
3. **性能/健壮性**：`files:readTextFile` 同步读取整个文件到内存再截断（5GB 日志会 OOM）；`config-manager.ts` 无缓存无原子写；`updater.ts` 定时器无 dispose；`pending-edits.ts` 每次 `list()` 全量排序。

## What Changes

### Task 35: 跨 store 共性封装
- 抽 `utils/subscription-manager.ts` — 统一 plan-store/queue-store/permission-store 的 `subscribed` + `unsubscribe` 模式（支持单/多 unsubscribe）
- 抽 `utils/pi-api.ts` — `getPiAPI()` helper，替换 4 处重复定义
- 抽 `utils/ipc.ts` — `partition` helper（取宽松签名 `IpcError | string`），替换 pi-status-store + updater-store 2 处
- session-store/workspace-store 的 `loadXxx()` 改为显式 `init()` action（settings-store 因含 listener 注册 + 6 个闭包变量，**DEFER** 到后续单独处理）

### Task 36: non-serializable 移出 zustand state
- `approval-store.ts` `_pendingResolves: Map` → 模块级 Map + `waitForApproval` 加 5 分钟默认超时
- `attachments-store.ts` `byWorkspace: Map` → `Record<string, Attachment[]>`
- `pi-status-store.ts` + `updater-store.ts` `_cleanup` → 模块级 `let`，同时给 pi-status-store 加幂等守卫

### Task 37: IPC handler 重复代码抽取
- `withValidation(schema, input, onValid)` — 替换 packages.ipc.ts 4 处 safeParse 模板
- `setupSessionImporterIpc(importer, prefix)` — 合并 claude-sessions + codex-sessions（100% 重复）
- `withPiDriver(getPiDriver, fn, opts)` — 替换 pi-driver.ipc.ts 5 处 guard + 4 处 try/catch
- `withPackageAction(schema, args, opts, fn)` — 替换 packages.ipc.ts 4 处
- `withUpdaterAction(action, opts)` — 替换 updater.ipc.ts 3 处 try/catch

### Task 38: command-risk.ts 补测 + 正则完善
- 补全 18 个现有正则的边界测试（当前仅 3 个 it 覆盖 ~33%）
- `rm` 正则补 `--recursive`/`--force` 长选项
- `chmod 777` 改为 `/\bchmod\s+777\b/`（不限制路径）
- 新增 `npm publish`/`kubectl delete`/`terraform destroy` 高危命令
- `classifyCommandRisk("")` 返回 `"normal"` 而非 `"high"`

### Task 39: protected path 校验补齐
- `local-file-protocol.ts` — 集成 `getProtectedPathReason`，拦截 `.ssh/id_rsa` 等敏感文件（**最高优先**，当前完全无校验）
- `git.ipc.ts` — `git:checkout`/`git:create-branch` 的 raw `execFileSync` 分支补 IPC 级校验（service 层已有但 raw 调用绕过）
- `files.ipc.ts` — **已完成**（Phase 2 已做），跳过

### Task 40: 杂项 Medium 修复
- `ssrf-guard.ts` `isSafeUrl` IPv4 修复 (`b1===169 && b2===254`)
- `files:readTextFile` 改 `fs/promises.open + fd.read` 只读前 512KB
- `files:search`/`files:list` 加 30s TTL 缓存
- `list-local-skills.ts` 改 `fs/promises` + 30s TTL 缓存
- `settings:set` `structuredClone` 改浅拷贝
- `config-manager.ts` 加内存缓存 (mtime 失效) + 原子写 (tmp + rename)
- `pending-edits.ts` 加 `getByToolCallId` + `list()` 结果缓存
- `updater.ts` 定时器保存引用 + `dispose()`
- **DEFER**: `isSafeUrl` DNS rebinding（使函数变 async，影响面大）；`interceptor.ts` fallback（需设计 InterceptorDeps 扩展）

## Impact

- **Affected code**:
  - 渲染 Stores: `approval-store.ts`/`attachments-store.ts`/`pi-status-store.ts`/`updater-store.ts`/`plan-store.ts`/`queue-store.ts`/`permission-store.ts`/`session-store.ts`/`workspace-store.ts`
  - 新增 utils: `renderer/src/utils/subscription-manager.ts`/`pi-api.ts`/`ipc.ts`
  - IPC handlers: `agents.ipc.ts`/`claude-sessions.ipc.ts`/`codex-sessions.ipc.ts`/`pi-driver.ipc.ts`/`packages.ipc.ts`/`updater.ipc.ts`/`git.ipc.ts`/`files.ipc.ts`/`settings.ipc.ts`
  - Services: `ssrf-guard.ts`/`local-file-protocol.ts`/`config-manager.ts`/`pending-edits.ts`/`updater.ts`/`list-local-skills.ts`
  - Shared types: `command-risk.ts`/`command-risk.test.ts`
- **Breaking changes**: 无外部 API 变更；store state shape 变更（移除 `_pendingResolves`/`_cleanup`/`byWorkspace: Map`）需同步更新测试

## ADDED Requirements

### Requirement: Store 状态可序列化
所有 zustand store 的 state SHALL NOT 包含 `Map`/`Function`/`Promise` 等非序列化值。回调 Map 和 cleanup 函数 SHALL 存储在模块级变量中。

#### Scenario: approval-store waitForApproval 超时
- **WHEN** 调用 `waitForApproval(changeId)` 且 5 分钟内无用户决策
- **THEN** Promise resolve 为 `false`（拒绝），不永久泄漏

### Requirement: local-file-protocol 安全
`localfile://` 协议 SHALL 拦截敏感路径（`.ssh/`/`.env`/`.aws/credentials` 等），返回 403 Forbidden。

#### Scenario: 渲染进程读取 SSH 私钥
- **WHEN** renderer 请求 `localfile:///c%3A/Users/x/.ssh/id_rsa`
- **THEN** 返回 HTTP 403，不读取文件内容

### Requirement: command-risk 完备性
`classifyCommandRisk` SHALL 覆盖 `npm publish`/`kubectl delete`/`terraform destroy` 等高危命令；`rm` 正则 SHALL 匹配 `--recursive`/`--force` 长选项；空字符串 SHALL 返回 `"normal"`。

### Requirement: IPC handler 无重复模板
所有 IPC handler SHALL 使用 `withValidation`/`withPiDriver`/`withUpdaterAction` 等 helper 消除重复的 safeParse + try/catch + guard 模板。

### Requirement: 主进程文件 IO 不 OOM
`files:readTextFile` SHALL 使用流式读取（`fd.read` 限定 maxBytes），不将整个文件加载到内存。

## MODIFIED Requirements

### Requirement: config-manager 缓存与原子写
`config-manager.ts` SHALL 维护内存缓存（mtime 失效）；`writeJsonFile` SHALL 使用 tmp + rename 原子写。
