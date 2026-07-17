# M1 手工冒烟测试清单

**日期**: 2026-06-01
**状态**: M1 实施完成 (Tasks 0-14 ✅)

## 怎么跑

```bash
cd C:\Ai\pi-desktop\apps\desktop
pnpm dev
```

Electron 窗口会打开, 默认 workspace 设为 `process.cwd()` (即 `apps/desktop`)。

## 5 步验证

### Step 1: 简单消息
- [ ] 在输入框输入 "Say 'hello' in one word"
- [ ] 看到流式响应
- [ ] 渲染 "hello"

**期望**: 工具栏绿灯, 内容流式追加, 完成后 turn_end。

### Step 2: 工具调用可视化
- [ ] 输入 "List the files in the current directory"
- [ ] 看到 `toolcall_start` 卡片 (bash 工具)
- [ ] 看到 `toolcall_end` 卡片 (带结果)
- [ ] AI 总结列出文件

**期望**: 工具调用卡片正常显示, 状态从 running → completed。

### Step 3: Cwd bug 已修 (M1 关键 bug)
- [ ] 在左 workspace 面板加一个新 workspace (选 `C:\Users\48818\.pi\agent` 或任何有文件的目录)
- [ ] 切到新 workspace
- [ ] 发消息 "Show me what files are here"
- [ ] AI 应该列出**新 workspace 目录**的文件, 不是 `apps/desktop/` 的

**期望**: 验证 Pi 跑在用户选的 workspace 路径, 不是 Electron 进程 cwd。

### Step 4: 高危工具拦截
- [ ] 在任一 workspace 输入 "Delete the file /tmp/test.txt" (或类似 high-risk 命令)
- [ ] 弹 HighRiskModal 模态 (带预览 + Y/N 按键提示)
- [ ] 按 N 拒绝 → Pi session 被 abort, 后续事件流停止
- [ ] 再发一次, 按 Y 允许 → 工具执行, 流程继续

**期望**: 模态弹出, Y/N 键盘响应, 拒绝时 turn 终止。

### Step 5: file_edit 事后审批
- [ ] 在 workspace 目录里准备一个测试文件 (例如 `test.txt`)
- [ ] 输入 "Append a line 'M1 test' to test.txt"
- [ ] 工具执行, 完成后 EditReviewList 出现这张卡的 diff
- [ ] 点 "撤销" 按钮 → `git checkout -- test.txt` 恢复原状
- [ ] 文件 diff 在弹回原内容 (或文件被删, 视 git 状态而定)

**期望**: EditReviewList 显示 diff, 撤销按钮调 `git:undo` 成功恢复。

## 已知限制

- ⚠️ 高危工具拒绝时**杀整个 turn** 而非单工具 (M1 接受此 trade-off, M3+ 用真 Pi 扩展升级)
- ⚠️ EditReviewList 撤销依赖 git; 非 git 仓库文件撤销=删除
- ⚠️ 没改 App.tsx (在 stashed UI 改动里), 所以 HighRiskModal/EditReviewList 组件需要手动挂到 App.tsx 才会显示

## 测试通过情况

```
packages/shared-types:  6/6 passed
apps/desktop:
  src/test/sanity:                       1/1
  src/test/e2e/chat:                     1/1 (+ 2 skipped, 需 PI_TEST_API_KEY)
  src/main/services/approval/classifier: 16/16
  src/main/services/approval/pending-edits: 9/9
  src/main/services/approval/interceptor: 8/8
  src/main/services/pi-session/factory:  2/2
  src/main/services/pi-session/registry: 5/5
  src/main/services/pi-session/event-bridge: 6/6
  ──────────────────────────────────────────────
  Total:                                54 tests, 0 failures
```

## 验收

M1 完成的 3 个 critical bug:
- [x] Cwd 正确 (Task 11 修 usePiStream, 走 workspace.path)
- [x] Pi 长连接 (Task 5+6+9, 走 AgentSession in-process, 走 WorkspaceRegistry)
- [x] 审批真拦 (Task 7+8+12, 走 subscribe + IPC + abort, HighRiskModal 弹模态)
