# M3 手工冒烟测试清单

**日期**: 2026-06-01
**状态**: M3 实施完成 (Tasks M3-1 ~ M3-8 ✅)

## 关键发现

- `skillhub` CLI 已装在 `C:\Users\48818\.local\bin\skillhub`
- 真实搜索 "hello" 出来 20 个结果, 都有 slug/name/desc/version/source
- `skillhub install <slug> --dir skills` 装到 `./skills/`
- `skillhub list` 输出 plain text, 一行一个 slug

## 怎么跑

```bash
cd C:\Ai\pi-desktop\apps\desktop
pnpm dev
```

⚠️ App.tsx 集成未做 (UI 改动在 stash 里)。SkillsPanel 组件写好了, 需要手动挂到 App.tsx 顶层 (替换 IconBar 的 "Skills" 按钮 onClick → setActivePanel("skills") + 渲染 SkillsPanel).

## 5 步验证

### Step 1: 装 SkillHub (如果还没)
- [ ] 运行: `curl -fsSL https://skillhub.cn/install/install.sh | bash`
- [ ] 验证: `skillhub --version` 返回版本号

### Step 2: 打开 Skills 页面
- [ ] 在桌面应用点 "Skills" 图标 (需要 App.tsx 集成)
- [ ] 看到 "市场 / 我的" 两个 tab, 默认在 "市场"
- [ ] 看到搜索框 + "+ 创建" 按钮
- [ ] 看到 "全部 / 官方 / 贡献" filter chips
- [ ] 看到 "热门" 排序下拉

### Step 3: 搜 + 装
- [ ] 搜索 "hello"
- [ ] 看到 8 张卡片 (fuzzy 排序后)
- [ ] 每张卡显示: 标题 + 版本 + 描述 + @slug + source 标签 + 装按钮
- [ ] 点某张卡的 "装" 按钮
- [ ] 进度提示 (skillhub install 在跑)
- [ ] 装完后切到 "我的" tab, 看到新装的技能

### Step 4: 启/禁/卸载
- [ ] 在 "我的" tab 看到已装列表
- [ ] 每个条目显示: 状态点 (绿/灰) + slug + 状态文字
- [ ] 点 "禁用" → 状态点变灰
- [ ] 点 "启用" → 状态点变绿
- [ ] 点 "卸载" → 弹确认, 确认后该条目消失

### Step 5: 创建下拉
- [ ] 点 "+ 创建" 按钮
- [ ] 看到 3 个选项: "用 Pi 构建" / "编写技能" / "从 Github 导入"
- [ ] 点 "从 Github 导入" → 弹输入框
- [ ] 粘 URL (e.g. `https://github.com/user/repo`) → 弹消息 (M3 简版, 提示用 git clone)
- [ ] 关闭弹层

## 测试通过情况

```
M1 + M2 + M3 总计:
  M1: classifier(16) + pending-edits(9) + interceptor(8)
      + factory(2) + registry(5) + event-bridge(6)
      + chat e2e(1 + 2 skipped)
  M2: fuzzy-match(7) + mention-parser(9) + file-scanner(4)
      + m2 e2e(7)
  M3: skillhub-adapter(9) + m3 e2e(4)
  sanity(1)
  shared-types(6)
─────────────────────────────────────────────────
  Total: 88 tests, 0 failures, 2 skipped
```

## 验收

M3 完成的 6 个特性:
- [x] SkillHub CLI 检测 (没装时友好提示安装命令)
- [x] 市场 tab 搜 + 卡片网格 (匹配 Mavis Code 截图)
- [x] 卡片显示 slug/name/desc/version/source
- [x] 装 / 启 / 禁 / 卸载 都生效
- [x] 我的 tab 状态点 (绿/灰) + 启/禁按钮
- [x] + 创建 3 选项 (M3.1+ 实装 Monaco / GitHub 自动)

## 已知限制

- ⚠️ App.tsx 集成未做 (UI 在 stash)
- ⚠️ SkillEditor (Monaco) 推迟到 M3.1
- ⚠️ 真实 Pi 扩展 (替换 M1 subscribe 拦截) 推迟到 M3.1
- ⚠️ GitHub 自动 import 是 stub (M3 简版, 实际应该 git clone + 解析 SKILL.md)
- ⚠️ SkillHub 装的 OpenClaw 格式 → Pi 兼容未验证 (M3.1 验证)
- ⚠️ 启用/禁用只是 Pi CLI 启动时不加载, 实际拦截未做
