# Pi Desktop v0.1.0

首个公开版本。Windows 10/11 x64 桌面应用, 集成 Pi CLI 跑本地 AI 编码任务。

## 下载

- **Installer**: `Pi Desktop-0.1.0-setup.exe` (101 MB) — NSIS 装包, 可选装路径
- **未打包**: `win-unpacked/Pi Desktop.exe` (190 MB) — 免装直跑

> 首次启动会看到 SmartScreen 警告 (我们没买代码签名证书, 见 [v1.1 路线图](#v11-路线图))。
> 点"更多信息 → 仍要运行"即可。

## 安装前置

1. **Node 22.19+**: 装好 (Electron 34 强制要求)
2. **Pi CLI**: 装好并加入 PATH (从 https://github.com/earendil-works/pi-coding-agent)
3. **可选 - SkillHub CLI**: 装好才能用技能市场 (从 https://github.com/earendil-works/skillhub)

## 怎么用

1. 启动 Pi Desktop
2. 点 "+ 工作区" 选个代码目录
3. 切到 "对话" tab 输入任务, 按 Enter
4. 装 SkillHub 后切到 "技能" tab 浏览/装技能
5. 切到 "终端" tab 跑命令 (真 PTY, 支持 vim/htop)

## 5 大 Milestone 全部完成

| Milestone | 内容 | Tests |
|-----------|------|-------|
| **M1** 基础 | 修 3 个核心 bug: cwd / 长连接 / 分层审批 | 48 |
| **M2** 上下文 | @ 文件引用 / 图片粘贴 / Ctrl+K 命令面板 | 21 |
| **M3** 技能 | SkillHub CLI 集成 / 市场+我的+创建 3 tab | 13 |
| **M4** 终端 | node-pty 真 PTY / 多 tab / xterm.js | 12 |
| **M5** 工程 | electron-updater / GitHub Actions CI+Release / ErrorBoundary | 6 |
| **M6** 发布 | 修 typecheck 残留 / 归档旧 UI / 真实 NSIS 打包 | - |

**总计: 107 通过, 2 跳过, 0 失败** (`pnpm -r test` 验证)

## 关键架构决策

- **Pi in-process 长连接** — 用 `createAgentSession({ cwd })` 跑 Pi, 走 `session.subscribe()` 监听事件, 无 JSONL 解析, 无冷启动
- **分层审批** — high-risk 弹模态预拦 / file_edit 事后 diff+undo / read 放行
- **Skills via SkillHub** — 包装 CLI (`skillhub search --json`), 暂不写格式 adapter
- **node-pty** — 修旧 `child_process.spawn` 不支持 resize / TUI 的问题

## 已知限制 (留给 v1.1+)

- ⚠️ **旧 UI 组件 (Sidebar / ProjectPanel / IconBar / 等) 已归档** 到 `docs/design-archive/legacy-components/`, 等 v1.1 重做 (依赖 Pi 新事件类型的 ChatView 重写)
- ⚠️ **macOS / Linux 不支持** — Electron 本身跨平台, 但 Pi 装在 Windows 上测过, 其他平台没测
- ⚠️ **没代码签名** — 用户首次会看到 SmartScreen 警告
- ⚠️ **没有真 Pi 扩展** — 审批拦截是订阅模式, 真扩展 (Pi 提供的 `tool_call` event + `block: true`) 等 v1.1
- ⚠️ **SkillHub 格式 adapter** — 装的是 OpenClaw 格式, 跟 Pi 的差异 v1.1 处理

## v1.1 路线图

- [ ] 重写 ChatView (基于新事件类型) + 集成 Sidebar / ProjectPanel / GitPanel
- [ ] Monaco Skill 编辑器
- [ ] macOS / Linux 装/打包
- [ ] 真 Pi 扩展 (pre-block tools)
- [ ] 代码签名 (消除 SmartScreen 警告)
- [ ] SkillHub 格式 adapter
- [ ] 分发镜像 (winget / scoop / chocolatey)

## 反馈

GitHub Issues: https://github.com/YOUR-ORG/pi-desktop/issues

提交 bug 报告前请确认:
- [ ] `pi --version` 跑得通
- [ ] `node --version` >= 22.19
- [ ] 装了 SkillHub (如果问题是技能相关)

---

**Built with**: Electron 34 · React 19 · TypeScript 5.6 · xterm.js 6 · node-pty 1.1
**License**: MIT
