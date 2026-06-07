# pi-desktop v0.4.7

这是一次小版本更新，重点是加入内嵌终端，并整理前端结构，为后续终端体验继续迭代打基础。

## 新增
- 内嵌终端 Dock：在聊天时间线和输入框之间打开当前 Agent 绑定的终端。
- 终端多 tab：支持新建、切换、关闭单个 tab，以及关闭全部 tab。
- 终端主题：支持 Pi Soft、Solarized Light、Solarized Dark、One Dark、Monokai。
- 跨平台 shell fallback：Windows 优先 `pwsh.exe`，回退到 `powershell.exe` / `cmd.exe`；macOS/Linux 优先 `$SHELL`，回退到 `bash` / `sh`。

## 优化
- 拆分配置弹窗，将 Models/Auth/Settings/Raw 和共享输入组件移入独立文件。
- 拆分主界面展示组件，降低 `App.tsx` 复杂度。
- Windows 打包使用 `node-pty` 预构建产物，避免强制 native rebuild 时依赖 Visual Studio Spectre 库。

## 验证
- 已通过 `npm run typecheck`。
- 已通过 `npm run build`。
- 已通过 `npm run pack` 并生成 Windows unpacked 目录包。
