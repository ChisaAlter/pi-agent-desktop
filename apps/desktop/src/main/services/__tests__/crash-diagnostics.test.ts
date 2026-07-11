import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { attachCrashDiagnostics, attachRendererCrashDiagnostics } from "../crash-diagnostics";

describe("crash diagnostics", () => {
    it("logs process and Electron child failures without throwing", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });

        processEvents.emit("uncaughtExceptionMonitor", new Error("fatal secret"), "uncaughtException");
        processEvents.emit("unhandledRejection", new Error("rejected"), Promise.resolve());
        appEvents.emit("child-process-gone", {}, { type: "Utility", reason: "crashed", exitCode: 9 });

        expect(logger.error).toHaveBeenCalledTimes(3);
        dispose();
        expect(processEvents.listenerCount("unhandledRejection")).toBe(0);
    });

    it("logs renderer termination details", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents, logger });

        webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 137 });

        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", { reason: "oom", exitCode: 137 });
        dispose();
    });
});
