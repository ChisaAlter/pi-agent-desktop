# Spike: Pi AgentSession in-process 验证

**日期**: 2026-06-01
**结论**: ✅ 成功, 架构决策 (M1 用 in-process AgentSession) 落地可行

## 跑的命令

```bash
cd C:\Ai\pi-desktop\apps\desktop
node scripts/spike-pi-inprocess.mjs
```

## 实际输出

```
[spike] getAgentDir = C:\Users\48818\.pi\agent
[spike] cwd = C:\Ai\pi-desktop\apps\desktop
[spike] creating AgentSession...
[spike] extensions loaded: 11
[spike] sending prompt...
[event] agent_start
[event] turn_start
[event] message_start
[event] message_end
[event] message_start
[event] message_update × 10
[event] message_end
[event] turn_end
[event] agent_end
[spike] SUCCESS
```

## 关键发现

1. **`createAgentSession(options)`** 是真实 API, 不是 `createAgentSessionFromServices` (plan 写错了, 需更新)
2. **最小参数**: `cwd` 即可, 其他从 settings.json + auth.json 推断
3. **11 个扩展**自动加载 (从 settings.json 的 `packages` 字段, 含 pi-workflow/pi-plan-mode/pi-subagents 等)
4. **事件流**完整: `agent_start` → `turn_start` → `message_start/update/end` → `turn_end` → `agent_end`
5. **message_update 事件**默认发 10 个左右, 应该是 "pong" 拆成的字符流
6. **不需要 API key env** —— Pi 从 `~/.pi/agent/auth.json` 读 (用户已配 mimo provider)

## API 修正

`packages/shared-types` 和 `apps/desktop/src/main/services/pi-session/factory.ts` 应改为:

```typescript
import { createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
    cwd: workspacePath,
    // model: 可选, 不传走 settings.json 的 defaultProvider/defaultModel
});
```

返回 `{ session, extensionsResult, modelFallbackMessage? }`.

## 对 M1 计划的影响

- Task 5 (factory) 简化: 不需要 services 那层
- `loadApprovalExtension` 返回类型变为 `ExtensionFactory` (从 `Extension` 改)
- 其他不变, 架构决策保持

## 后续

- 跑完 spike 后 commit
- 修正 plan 里的 API 名字
- 派 subagent 跑 Tasks 1-16
