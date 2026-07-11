interface EventSource {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface CrashLogger {
    error(message: string, ...args: unknown[]): void;
}

export function attachCrashDiagnostics(opts: {
    processEvents: EventSource;
    appEvents: EventSource;
    logger: CrashLogger;
}): () => void {
    const onUncaughtException = (error: unknown, origin: unknown): void => {
        opts.logger.error("[crash] uncaught exception:", { origin, error });
    };
    const onUnhandledRejection = (reason: unknown): void => {
        opts.logger.error("[crash] unhandled rejection:", reason);
    };
    const onChildProcessGone = (_event: unknown, details: unknown): void => {
        opts.logger.error("[crash] Electron child process gone:", details);
    };

    opts.processEvents.on("uncaughtExceptionMonitor", onUncaughtException);
    opts.processEvents.on("unhandledRejection", onUnhandledRejection);
    opts.appEvents.on("child-process-gone", onChildProcessGone);

    return () => {
        opts.processEvents.off("uncaughtExceptionMonitor", onUncaughtException);
        opts.processEvents.off("unhandledRejection", onUnhandledRejection);
        opts.appEvents.off("child-process-gone", onChildProcessGone);
    };
}

export function attachRendererCrashDiagnostics(opts: {
    webContents: EventSource;
    logger: CrashLogger;
}): () => void {
    const onRendererGone = (_event: unknown, details: unknown): void => {
        opts.logger.error("[crash] renderer process gone:", details);
    };
    opts.webContents.on("render-process-gone", onRendererGone);
    return () => opts.webContents.off("render-process-gone", onRendererGone);
}
