# M2 手工冒烟测试清单

**日期**: 2026-06-01
**状态**: M2 实施完成 (Tasks M2-1 ~ M2-6 ✅)

## 怎么跑

```bash
cd C:\Ai\pi-desktop\apps\desktop
pnpm dev
```

⚠️ **重要**: App.tsx 还在 stashed UI 改动里。M2 组件 (`MentionPopover`, `AttachmentChip`, `CommandPalette`) 已经写好, 但**需要手动挂到 App.tsx 才会显示**。

## 5 步验证

### Step 1: @ 文件引用
- [ ] 在输入框输入 "看看 @"
- [ ] 弹 popover (在输入框上方)
- [ ] 继续输入文件名 (e.g. "看看 @au"), popover 实时过滤
- [ ] 上下箭头选, Enter 确认
- [ ] 文本框替换为 "看看 @src/auth.ts"
- [ ] **期望**: popover 跟随 cursor 位置, fuzzy 排序, 路径插入到 @ 后

### Step 2: 图片粘贴
- [ ] 截图 (或复制任意图片)
- [ ] 粘贴到输入框 (Ctrl+V)
- [ ] 输入框上方出现图片 chip (缩略图 + 文件名 + ✕ 按钮)
- [ ] 点 ✕ 移除 chip
- [ ] 粘贴多张图片 → 多 chip
- [ ] **期望**: base64 dataURL 存到 attachments store, 按 workspace 隔离

### Step 3: CommandPalette 打开 + 文件搜索
- [ ] 按 Ctrl+K
- [ ] 模态从顶部弹出, "文件" tab 默认
- [ ] 输入 "auth" 看 fuzzy 排序 (前缀匹配靠前)
- [ ] 上下箭头选, Enter 确认
- [ ] Tab 切到 "历史" tab
- [ ] Tab 切到 "命令" tab, 搜 "new" 看 "新建对话" 命令
- [ ] Esc 关闭
- [ ] **期望**: 三 tab 切换, fuzzy 排序, 键盘完全可控

### Step 4: 历史搜索
- [ ] 先发几条消息 (造点历史)
- [ ] Ctrl+K, 切到 "历史" tab
- [ ] 搜某条消息里的关键词
- [ ] 看到匹配的消息卡片, 副标题显示 session 名 + user/Pi
- [ ] **期望**: 跨 session 搜, 按 score 排, 20 条上限

### Step 5: 端到端 (需要 App.tsx 集成)
- [ ] 把 CommandPalette 挂到 App.tsx 顶层 (e.g. `{isOpen && <CommandPalette ... />}`)
- [ ] 把 MentionPopover/AttachmentChip 已经在 ChatInput 里 (M2-3 已做)
- [ ] 完整跑一遍: 输入消息 (带 @ 引用 + 粘贴图片) → Ctrl+K 命令面板 → 发消息
- [ ] **期望**: 整个工作流无报错, 附件随消息发出 (注: 实际 Pi 接收 attachments 需要扩展 IPC 协议, M2 只做 UI 层, 真正发到 Pi 是 M3 任务)

## 已知限制

- ⚠️ App.tsx 集成未做 (因为 UI 改动在 stash 里, 等 stash 解开时一起做)
- ⚠️ CommandPalette 的命令 callback (新建对话等) 需在 App.tsx 里 wire 实际行为
- ⚠️ 文件搜索的 workspace path 由 `useWorkspaceStore.getCurrentWorkspace()` 决定, 未选 workspace 时用 "default" fallback
- ⚠️ 附件实际发给 Pi 的协议 (M2 只做 UI 收集, M3 加 IPC send 时带 attachments)

## 测试通过情况

```
packages/shared-types:  6/6
apps/desktop:
  src/test/sanity:                       1/1
  src/test/e2e/chat (M1):                1/1 + 2 skipped
  src/test/e2e/m2 (M2):                  7/7
  src/main/services/approval/classifier: 16/16
  src/main/services/approval/pending-edits: 9/9
  src/main/services/approval/interceptor: 8/8
  src/main/services/pi-session/factory:  2/2
  src/main/services/pi-session/registry: 5/5
  src/main/services/pi-session/event-bridge: 6/6
  src/main/services/search/file-scanner:  4/4
  src/main/utils/fuzzy-match:            7/7
  src/renderer/src/utils/mention-parser:   9/9
  ──────────────────────────────────────────────
  Total:                                73 tests, 0 failures, 2 skipped
```

## 验收

M2 完成的 4 个特性:
- [x] @ 文件引用 (MentionPopover + fuzzy + resolve)
- [x] 图片粘贴 (AttachmentChip + dataURL 存储)
- [x] Ctrl+K CommandPalette (文件 / 历史 / 命令 三 tab)
- [x] AttachmentChip 可视化 (file + image 两种样式)
