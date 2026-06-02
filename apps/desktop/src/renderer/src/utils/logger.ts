// Renderer-side logger (v1.0.6)
// 替换散落的 console.error / console.warn, 统一走主进程 electron-log
//
// 设计:
// - 直接用 console 是"就地"打日志, 渲染层 devtools 看得见但生产环境丢了
// - 走 IPC 让主进程 electron-log 落文件, 等于把渲染端日志也接到 M7
//   observability 那个统一日志通道
// - 同一个 logger 后面接 Sentry / LogRocket 不用改业务代码
//
// 调用方式:
//   import { logger } from "../../utils/logger";
//   logger.error("[files.ipc] scan error", err);
//   logger.warn("[PtyManager] write error for ${id}", err);

// RendererLogger is a value (default export), 用 typeof import 拿类型
type RendererLoggerType = typeof import("electron-log/renderer").default;

type LogFn = (msg: string, ...args: unknown[]) => void;
type Logger = { error: LogFn; warn: LogFn; info: LogFn; debug: LogFn };

function buildConsoleLogger(): Logger {
    return {
        error: (msg, ...args) => console.error(msg, ...args),
        warn: (msg, ...args) => console.warn(msg, ...args),
        info: (msg, ...args) => console.info(msg, ...args),
        debug: (msg, ...args) => console.debug(msg, ...args),
    };
}

// electron-log/renderer 在 jsdom 环境里调 window.ipcRenderer 会 throw.
// 用 dynamic import 包 try/catch 降级 console. ESM top-level await 不行
// (renderer bundle 是 sync), 所以用 side-effect import 兜底.
let logImpl: Logger;
try {
    // require 在 vitest jsdom 下会 fail (electron-log/renderer 顶层就 try-调 window.ipc),
    // 捕获后降级 console, 业务代码不感知.
    const mod: Logger = (require("electron-log/renderer") as RendererLoggerType) as unknown as Logger;
    logImpl = mod;
} catch {
    logImpl = buildConsoleLogger();
}

export const logger: Logger = logImpl;
