# Electron 实机 QA — composer 固定高度布局契约

- 时间: 2026-08-06T10:00:39.273Z
- 驱动: 生产 build + CDP (绕过 playwright electron 主进程通道)
- 结果: 9/9 通过

| 用例 | 结果 | 详情 |
|---|---|---|
| 基线: 空 composer 95px/变量103px/控制栏贴底 | ✓ | shell=95px |
| 500 行长文本: textarea 自身滚动, shell 不变 | ✓ | scrollH=8750/clientH=47 |
| 无空格超长 URL: 无横向溢出 | ✓ | ok |
| 20 图片附件: chips 在 shell 内, 附件区滚动, 控制栏贴底 | ✓ | attScroll=178/47 |
| 超大图片被拒: 错误受控在 shell 内 | ✓ | 图片大小不能超过 5MB |
| resize 拖拽: 契约保持, 变量同步 | ✓ | shell=175px var=183px |
| Slash 菜单: 向上弹出可见, 不被裁剪 | ✓ | gap=-7.7px top=437 |
| 卸载清理变量 + 切回恢复 | ✓ | ok |
| 1365×768 宽窗: 契约保持 | ✓ | innerWidth=1366 |
