// 命令风险分类 — 单一事实源
// 消费方:
//   1. 渲染层终端门禁 (classifyTerminalCommand → draft/run 两段式确认)
//   2. 主进程审批分类器 (classifyToolCall → high/edit/read)
// 因此这里必须是"最全"的名单: 任何破坏性命令漏掉, 终端与代理两条路径同时失守.
// 设计原则: 保守 (宁高勿漏) — 分类为 high 只是多一次确认/审批, 不会阻断正常开发流.

export type CommandRiskLevel = "high" | "normal";

const HIGH_RISK_COMMAND_PATTERNS: RegExp[] = [
    // ── Unix / 跨平台文件系统破坏 ──────────────────────────────
    /\brm\s+(?:-[^\s]*[rf][^\s]*|-[^\s]*[fr][^\s]*|--recursive\b|--force\b)/i,
    // Remove-Item -Recurse/-Force 及 PowerShell 前缀缩写 (-R/-Fo 等)
    /\bRemove-Item\b.*\s-(?:Rec[a-z]*|For[a-z]*|R|F)\b/i,
    // Remove-Item 指向凭据/密钥路径 (即使无 -Force/-Recurse)
    /\bRemove-Item\b.*(?:\.env|id_rsa|id_ed25519|\.ssh)/i,
    // cmd del / delete 带 /s 或 /q
    /\bdel(?:ete)?\b.*\s\/[sq]\b/i,
    // PowerShell 别名 del/delete -Recurse/-Force
    /\bdel(?:ete)?\b.*\s-(?:Rec[a-z]*|For[a-z]*|R|F)\b/i,
    // cmd rd / rmdir 递归删除 (rd 是 rmdir 别名, 之前漏判)
    /\b(?:rd|rmdir)\b.*\s\/[sq]\b/i,
    // cmd erase (del 别名) 递归删除
    /\berase\b.*\s\/[sq]\b/i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bchmod\s+777\b/i,

    // ── Windows 系统级破坏 / 持久化 ────────────────────────────
    // 磁盘格式化 (format / format.com)
    /\bformat(?:\.com)?\s+[a-z]:/i,
    // diskpart 脚本化磁盘操作
    /\bdiskpart\b/i,
    // taskkill 强制结束进程
    /\btaskkill\b.*\s\/f\b/i,
    // netsh 变更系统网络/防火墙状态 (查询类不含 set/reset 等关键字, 不受影响)
    /\bnetsh\b.*\b(?:set|reset|flush|delete|add|stop|start)\b/i,
    // bitsadmin 后台传输 (下载执行链常用)
    /\bbitsadmin\b/i,
    // 关机/重启 (Windows /s /r; unix -h/-p/-r)
    /\bshutdown\b.*\s\/[sr]\b/i,
    /\bshutdown\b.*\s-[hpr]\b/i,
    /\breboot\b/i,
    /\bStop-Computer\b/i,
    // PowerShell 强制杀进程
    /\bStop-Process\b.*\s-(?:For[a-z]*|F)\b/i,
    // sc delete 删除服务
    /\bsc(?:\.exe)?\s+delete\b/i,
    // schtasks 计划任务持久化
    /\bschtasks\b.*\/create\b/i,
    /\bbcdedit\b/i,
    /\bnet\s+(?:user|localgroup|accounts)\b/i,
    // cipher /w 安全擦除
    /\bcipher\b.*\s\/w\b/i,
    // 提权执行
    /\bStart-Process\b.*-Verb\b.*RunAs\b/i,
    // 注册表写操作 (add/delete; 查询类不含)
    /\breg(?:\.exe)?\s+add\b/i,
    /\breg\s+delete\b/i,

    // ── 远程脚本下载即执行 ─────────────────────────────────────
    /\b(?:curl|wget)\b.*\|\s*(?:sh|bash|powershell|pwsh)\b/i,
    // 下载到文件后执行 (wget -O x && sh x / curl -o x && bash x)
    /\b(?:curl|wget)\b.*\s(?:-O|-o)\b.*\s&&\s*(?:sh|bash)\b/i,
    /\biwr\b.*\|\s*(?:powershell|pwsh|iex)\b/i,
    /\birm\b.*\|\s*(?:powershell|pwsh|iex)\b/i,
    // 直接调用 Invoke-Expression (iex)
    /\b(?:Invoke-Expression|iex)\b/i,

    // ── git 破坏性操作 ────────────────────────────────────────
    /\bgit\s+push\b.*--force(?:-with-lease)?\b/i,
    // 删除远端分支
    /\bgit\s+push\b.*\s--delete\b/i,
    /\bgit\s+reset\b.*\s--hard\b/i,
    /\bgit\s+clean\b.*\s-[^\s]*f/i,
    // 丢弃整个工作区改动 (git checkout . / git restore . / -- 变体)
    // 注意: `git restore file.ts` 中的 `.ts` 不会被误判 — 要求 . 是独立路径
    /\bgit\s+(?:checkout|restore)\b.*\s(?:--\s+)?\.(?:\s|$)/i,
    // 删除/移动分支、删除/创建/覆盖 tag、修改 remote 配置、drop/clear stash
    /\bgit\s+branch\b.*\s--delete\b|\bgit\s+branch\b.*\s-[dD]\b/i,
    /\bgit\s+tag\b.*\s--delete\b|\bgit\s+tag\b.*\s-[daf]\b/i,
    /\bgit\s+remote\b.*\s(?:add|remove|rename|set-url)\b/i,
    /\bgit\s+stash\b.*\s(?:drop|clear)\b/i,
    // git config 写操作 (--get/--list/-l 等只读形态除外; --global/--local 前缀允许)
    /\bgit\s+config\b(?!\s*(?:--(?:global|local|system|worktree)\s+)*(?:--(?:get|get-all|get-regexp|list)\b|-l\b))/i,

    // ── 包管理器 / 容器 ────────────────────────────────────────
    // 全局卸载 (npm rm 是 uninstall 别名, 之前漏判)
    /\b(?:npm|pnpm|yarn)\s+(?:rm|remove|uninstall)\b.*\s-g\b/i,
    /\bnpm\s+publish\b/i,
    // docker 批量清理 (system prune -a / rmi -f)
    /\bdocker\b.*\sprune\b.*\s-a/i,
    /\bdocker\b.*\srmi\b.*\s-f\b/i,

    // ── 基础设施 ──────────────────────────────────────────────
    /\bkubectl\s+delete\b/i,
    /\bterraform\s+(?:apply\s+-auto-approve|destroy(?:\s+-auto-approve)?|import)\b/i,
];

export function classifyCommandRisk(command: string): CommandRiskLevel {
    const trimmed = command.trim();
    if (!trimmed) return "normal";
    return HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed)) ? "high" : "normal";
}

export function isHighRiskCommand(command: string): boolean {
    return classifyCommandRisk(command) === "high";
}
