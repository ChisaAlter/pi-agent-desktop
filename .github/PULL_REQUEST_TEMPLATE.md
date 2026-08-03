name: Pull Request
description: 提交代码改动
---

## 变更

简要说明改了什么。

## 关联 Issue

Closes # / Fixes #

## 验证

- [ ] `pnpm -r typecheck` 通过
- [ ] `pnpm -r lint` 通过（无新增 warning）
- [ ] `pnpm -r test` 通过
- [ ] `pnpm --filter @pi-desktop/desktop test:coverage` 通过，未降低覆盖率门槛
- [ ] `pnpm verify:docs` 通过（如涉及文档/版本/架构事实）
- [ ] `node scripts/smoke-main-runtime.cjs` 通过（如涉及 main/IPC/构建）
- [ ] 相关 Electron E2E 已运行（如涉及 UI、窗口、IPC、设置、权限、Compose 或会话）
- [ ] 手动跑过改动部分
- [ ] 加了新测试 (if applicable)
- [ ] 更新了相关文档 (if applicable)

## 截图

UI 改动时附上。

## Checklist

- [ ] 单一目的 (一个 PR 一件事)
- [ ] Commit message 符合 Conventional Commits
- [ ] 没有引入新的 lint/typecheck 错误
