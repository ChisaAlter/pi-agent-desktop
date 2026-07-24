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
        expect(webContents.listenerCount("render-process-gone")).toBe(0);
    });

    it("does not log after dispose", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        processEvents.emit("unhandledRejection", new Error("late"), Promise.resolve());
        appEvents.emit("child-process-gone", {}, { type: "GPU", reason: "killed", exitCode: 1 });
        expect(logger.error).not.toHaveBeenCalled();
    });

    // wave-98 residual
    it("logs non-Error uncaught values and string rejections", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });

        processEvents.emit("uncaughtExceptionMonitor", "string-fatal", "uncaughtException");
        processEvents.emit("unhandledRejection", "plain-reject");
        processEvents.emit("unhandledRejection", { code: "EPIPE", message: "broken" });

        expect(logger.error).toHaveBeenCalledWith(
            "[crash] uncaught exception:",
            { origin: "uncaughtException", error: "string-fatal" },
        );
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", "plain-reject");
        expect(logger.error).toHaveBeenCalledWith(
            "[crash] unhandled rejection:",
            { code: "EPIPE", message: "broken" },
        );
        dispose();
    });

    it("stops logging renderer crashes after dispose", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents, logger });
        dispose();
        webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
        expect(logger.error).not.toHaveBeenCalled();
        expect(webContents.listenerCount("render-process-gone")).toBe(0);
    });

    it("logs multiple child-process-gone events independently", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });

        appEvents.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
        appEvents.emit("child-process-gone", {}, { type: "Utility", reason: "killed", exitCode: 15 });

        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenNthCalledWith(
            1,
            "[crash] Electron child process gone:",
            { type: "GPU", reason: "crashed", exitCode: 1 },
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            2,
            "[crash] Electron child process gone:",
            { type: "Utility", reason: "killed", exitCode: 15 },
        );
    });

    // wave-123 residual
    it("dispose is idempotent and can re-attach fresh listeners", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        dispose();
        processEvents.emit("unhandledRejection", "after-double-dispose");
        expect(logger.error).not.toHaveBeenCalled();

        const dispose2 = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("uncaughtExceptionMonitor", new Error("again"), "uncaughtException");
        expect(logger.error).toHaveBeenCalledTimes(1);
        dispose2();
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(0);
    });

    // wave-133 residual
    it("renderer dispose is idempotent and re-attach logs again", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents, logger });
        dispose();
        dispose();
        webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
        expect(logger.error).not.toHaveBeenCalled();

        const dispose2 = attachRendererCrashDiagnostics({ webContents, logger });
        webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 137 });
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", {
            reason: "oom",
            exitCode: 137,
        });
        dispose2();
        expect(webContents.listenerCount("render-process-gone")).toBe(0);
    });

    it("logs nullish uncaught/rejection payloads without throwing", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("uncaughtExceptionMonitor", null, "uncaughtException");
        processEvents.emit("unhandledRejection", undefined);
        appEvents.emit("child-process-gone", {}, null);
        expect(logger.error).toHaveBeenCalledTimes(3);
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: "uncaughtException",
            error: null,
        });
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", undefined);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", null);
        dispose();
    });

    // wave-136 residual — crash inject depth
    it("logs injected child-process-gone type matrix (GPU/Utility/Plugin)", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });

        const matrix = [
            { type: "GPU", reason: "crashed", exitCode: 1 },
            { type: "Utility", reason: "oom", exitCode: 137 },
            { type: "Plugin", reason: "killed", exitCode: 15 },
            { type: "Unknown", reason: "integrity-failure", exitCode: -1 },
        ];
        for (const details of matrix) {
            appEvents.emit("child-process-gone", {}, details);
        }
        expect(logger.error).toHaveBeenCalledTimes(matrix.length);
        for (const details of matrix) {
            expect(logger.error).toHaveBeenCalledWith(
                "[crash] Electron child process gone:",
                details,
            );
        }
    });

    it("logs injected renderer gone reasons without mutating details", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachRendererCrashDiagnostics({ webContents, logger });
        const reasons = [
            { reason: "clean-exit", exitCode: 0 },
            { reason: "abnormal-exit", exitCode: 1 },
            { reason: "killed", exitCode: 9 },
            { reason: "crashed", exitCode: -1073741819 },
            { reason: "oom", exitCode: 137 },
            { reason: "launch-failed", exitCode: 127 },
            { reason: "integrity-failure", exitCode: 2 },
        ];
        for (const details of reasons) {
            webContents.emit("render-process-gone", {}, details);
        }
        expect(logger.error).toHaveBeenCalledTimes(reasons.length);
        expect(logger.error).toHaveBeenNthCalledWith(
            1,
            "[crash] renderer process gone:",
            reasons[0],
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            reasons.length,
            "[crash] renderer process gone:",
            reasons[reasons.length - 1],
        );
    });

    it("forwards Error cause chain on uncaught without throw", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        const root = new Error("root-cause");
        const wrapped = new Error("outer", { cause: root });
        processEvents.emit("uncaughtExceptionMonitor", wrapped, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: "uncaughtException",
            error: wrapped,
        });
        const logged = logger.error.mock.calls[0]?.[1] as { error: Error };
        expect(logged.error.cause).toBe(root);
    });

    // wave-157 residual
    it("dispose is idempotent and second dispose does not throw", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        expect(() => dispose()).not.toThrow();
        processEvents.emit("unhandledRejection", "late", Promise.resolve());
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs multiple child-process-gone events independently", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        appEvents.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
        appEvents.emit("child-process-gone", {}, { type: "Utility", reason: "killed", exitCode: 9 });
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenNthCalledWith(
            1,
            "[crash] Electron child process gone:",
            { type: "GPU", reason: "crashed", exitCode: 1 },
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            2,
            "[crash] Electron child process gone:",
            { type: "Utility", reason: "killed", exitCode: 9 },
        );
    });

    it("renderer dispose stops further render-process-gone logs", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents, logger });
        webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
        expect(logger.error).toHaveBeenCalledTimes(1);
        dispose();
        webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 137 });
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    // wave-175 residual
    it("logs null/undefined crash payloads without throwing", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        expect(() => {
            processEvents.emit("uncaughtExceptionMonitor", null, undefined);
            processEvents.emit("unhandledRejection", undefined);
            appEvents.emit("child-process-gone", null, null);
        }).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: undefined,
            error: null,
        });
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", undefined);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", null);
    });

    it("renderer dispose is idempotent and double-attach logs twice until each is disposed", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const disposeA = attachRendererCrashDiagnostics({ webContents, logger });
        const disposeB = attachRendererCrashDiagnostics({ webContents, logger });
        webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
        expect(logger.error).toHaveBeenCalledTimes(2);
        disposeA();
        webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 137 });
        expect(logger.error).toHaveBeenCalledTimes(3);
        disposeB();
        expect(() => disposeB()).not.toThrow();
        webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });
        expect(logger.error).toHaveBeenCalledTimes(3);
    });

    it("does not register handlers on wrong event names", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("uncaughtException", new Error("not-monitor"));
        appEvents.emit("render-process-gone", {}, { reason: "x" });
        expect(logger.error).not.toHaveBeenCalled();
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(1);
        expect(processEvents.listenerCount("unhandledRejection")).toBe(1);
        expect(appEvents.listenerCount("child-process-gone")).toBe(1);
    });

    // wave-184 residual
    it("process dispose is idempotent and clears all three listeners", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        expect(() => dispose()).not.toThrow();
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(0);
        expect(processEvents.listenerCount("unhandledRejection")).toBe(0);
        expect(appEvents.listenerCount("child-process-gone")).toBe(0);
        processEvents.emit("uncaughtExceptionMonitor", new Error("late"), "x");
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("double-attach process diagnostics logs twice until each dispose", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const a = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const b = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("unhandledRejection", "r1");
        expect(logger.error).toHaveBeenCalledTimes(2);
        a();
        processEvents.emit("unhandledRejection", "r2");
        expect(logger.error).toHaveBeenCalledTimes(3);
        b();
        processEvents.emit("unhandledRejection", "r3");
        expect(logger.error).toHaveBeenCalledTimes(3);
    });

    it("renderer logs non-object details payloads without throwing", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachRendererCrashDiagnostics({ webContents, logger });
        expect(() => {
            webContents.emit("render-process-gone", {}, "string-details");
            webContents.emit("render-process-gone", {}, 42);
        }).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", "string-details");
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", 42);
    });

    // wave-195 residual
    it("renderer dispose is idempotent and stops further logs", () => {
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents, logger });
        dispose();
        expect(() => dispose()).not.toThrow();
        webContents.emit("render-process-gone", {}, { reason: "crashed" });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs uncaughtExceptionMonitor with origin object shape", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        const err = new Error("boom");
        processEvents.emit("uncaughtExceptionMonitor", err, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: "uncaughtException",
            error: err,
        });
    });

    it("logs child-process-gone details as second arg", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        const details = { type: "GPU", reason: "crashed", exitCode: 1 };
        appEvents.emit("child-process-gone", {}, details);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", details);
    });

    // wave-200 residual
    it("double attach stacks listeners; dispose only removes its own handlers", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const loggerA = { error: vi.fn() };
        const loggerB = { error: vi.fn() };
        const disposeA = attachCrashDiagnostics({ processEvents, appEvents, logger: loggerA });
        const disposeB = attachCrashDiagnostics({ processEvents, appEvents, logger: loggerB });
        processEvents.emit("unhandledRejection", "r1");
        expect(loggerA.error).toHaveBeenCalledTimes(1);
        expect(loggerB.error).toHaveBeenCalledTimes(1);
        disposeA();
        processEvents.emit("unhandledRejection", "r2");
        expect(loggerA.error).toHaveBeenCalledTimes(1);
        expect(loggerB.error).toHaveBeenCalledTimes(2);
        disposeB();
        processEvents.emit("unhandledRejection", "r3");
        expect(loggerA.error).toHaveBeenCalledTimes(1);
        expect(loggerB.error).toHaveBeenCalledTimes(2);
    });

    it("process dispose clears uncaughtExceptionMonitor and child-process-gone together", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        processEvents.emit("uncaughtExceptionMonitor", new Error("late"), "uncaughtException");
        appEvents.emit("child-process-gone", {}, { type: "Utility" });
        expect(logger.error).not.toHaveBeenCalled();
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(0);
        expect(appEvents.listenerCount("child-process-gone")).toBe(0);
    });

    // wave-205 residual
    it("uncaughtExceptionMonitor logs origin+error object payload", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        attachCrashDiagnostics({ processEvents, appEvents, logger });
        const err = new Error("boom");
        processEvents.emit("uncaughtExceptionMonitor", err, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: "uncaughtException",
            error: err,
        });
    });

    it("renderer dispose is independent of process attach", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const disposeProcess = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const disposeRenderer = attachRendererCrashDiagnostics({ webContents, logger });
        disposeRenderer();
        webContents.emit("render-process-gone", {}, { reason: "crashed" });
        expect(logger.error).not.toHaveBeenCalled();
        processEvents.emit("unhandledRejection", "still-active");
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", "still-active");
        disposeProcess();
    });

    it("renderer gone logs details; double dispose of process is safe", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const webContents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        attachRendererCrashDiagnostics({ webContents, logger });
        const details = { reason: "oom", exitCode: -1 };
        webContents.emit("render-process-gone", {}, details);
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", details);
        dispose();
        expect(() => dispose()).not.toThrow();
    });

    // wave-212 residual
    it("child-process-gone logs details; dispose stops further process events", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const details = { type: "GPU", reason: "crashed", exitCode: 1 };
        appEvents.emit("child-process-gone", {}, details);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", details);
        dispose();
        logger.error.mockClear();
        processEvents.emit("unhandledRejection", "after-dispose");
        processEvents.emit("uncaughtExceptionMonitor", new Error("x"), "test");
        appEvents.emit("child-process-gone", {}, { reason: "late" });
        expect(logger.error).not.toHaveBeenCalled();
    });

    // wave-221 residual
    it("uncaughtExceptionMonitor logs origin+error object shape", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const err = new Error("boom");
        processEvents.emit("uncaughtExceptionMonitor", err, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith("[crash] uncaught exception:", {
            origin: "uncaughtException",
            error: err,
        });
        dispose();
    });

    it("multiple renderer attachments are independent and dispose isolates", () => {
        const wc1 = new EventEmitter();
        const wc2 = new EventEmitter();
        const logger = { error: vi.fn() };
        const d1 = attachRendererCrashDiagnostics({ webContents: wc1, logger });
        const d2 = attachRendererCrashDiagnostics({ webContents: wc2, logger });
        d1();
        wc1.emit("render-process-gone", {}, { reason: "late" });
        expect(logger.error).not.toHaveBeenCalled();
        wc2.emit("render-process-gone", {}, { reason: "alive" });
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", { reason: "alive" });
        d2();
    });

    // wave-249 residual
    it("unhandledRejection logs null/undefined/number without throwing", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("unhandledRejection", null);
        processEvents.emit("unhandledRejection", undefined);
        processEvents.emit("unhandledRejection", 42);
        expect(logger.error).toHaveBeenNthCalledWith(1, "[crash] unhandled rejection:", null);
        expect(logger.error).toHaveBeenNthCalledWith(2, "[crash] unhandled rejection:", undefined);
        expect(logger.error).toHaveBeenNthCalledWith(3, "[crash] unhandled rejection:", 42);
        dispose();
    });

    it("double dispose is safe; re-attach logs again after prior dispose", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const d1 = attachCrashDiagnostics({ processEvents, appEvents, logger });
        d1();
        d1();
        expect(processEvents.listenerCount("unhandledRejection")).toBe(0);
        const d2 = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("unhandledRejection", "again");
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", "again");
        d2();
        const wc = new EventEmitter();
        const rd = attachRendererCrashDiagnostics({ webContents: wc, logger });
        rd();
        rd();
        expect(wc.listenerCount("render-process-gone")).toBe(0);
    });

    // wave-263 residual
    it("uncaughtExceptionMonitor logs Error and non-Error origin together", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const err = new Error("boom");
        processEvents.emit("uncaughtExceptionMonitor", err, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith(
            "[crash] uncaught exception:",
            { origin: "uncaughtException", error: err },
        );
        processEvents.emit("uncaughtExceptionMonitor", { code: 1 }, undefined);
        expect(logger.error).toHaveBeenCalledWith(
            "[crash] uncaught exception:",
            { origin: undefined, error: { code: 1 } },
        );
        dispose();
    });

    it("child-process-gone and renderer-gone pass details through unchanged", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const details = { type: "GPU", reason: "crashed", exitCode: 1 };
        appEvents.emit("child-process-gone", {}, details);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", details);
        dispose();

        const wc = new EventEmitter();
        const rd = attachRendererCrashDiagnostics({ webContents: wc, logger });
        const rDetails = { reason: "killed", exitCode: 9 };
        wc.emit("render-process-gone", {}, rDetails);
        expect(logger.error).toHaveBeenCalledWith("[crash] renderer process gone:", rDetails);
        rd();
        wc.emit("render-process-gone", {}, rDetails);
        // only one renderer log from before dispose
        expect(logger.error.mock.calls.filter((c) => c[0] === "[crash] renderer process gone:")).toHaveLength(1);
    });


    // wave-273 residual
    it("unhandledRejection logs reason; dispose removes listeners so later emits are ignored", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("unhandledRejection", "boom-reason");
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", "boom-reason");
        dispose();
        logger.error.mockClear();
        processEvents.emit("unhandledRejection", "after-dispose");
        processEvents.emit("uncaughtExceptionMonitor", new Error("x"), "origin");
        appEvents.emit("child-process-gone", {}, { type: "Utility" });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("double dispose is safe; renderer dispose isolates from further gone events", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        dispose();
        expect(() => dispose()).not.toThrow();

        const wc = new EventEmitter();
        const rd = attachRendererCrashDiagnostics({ webContents: wc, logger });
        rd();
        expect(() => rd()).not.toThrow();
        logger.error.mockClear();
        wc.emit("render-process-gone", {}, { reason: "crashed" });
        expect(logger.error).not.toHaveBeenCalled();
    });


    // wave-279 residual
    it("uncaughtExceptionMonitor logs error and origin; child-process-gone logs details", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        const err = new Error("fatal");
        processEvents.emit("uncaughtExceptionMonitor", err, "uncaughtException");
        expect(logger.error).toHaveBeenCalledWith(
            "[crash] uncaught exception:",
            { origin: "uncaughtException", error: err },
        );
        const details = { type: "GPU", reason: "crashed", exitCode: 1 };
        appEvents.emit("child-process-gone", {}, details);
        expect(logger.error).toHaveBeenCalledWith("[crash] Electron child process gone:", details);
        dispose();
    });

    it("multiple process event types can fire before dispose", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        processEvents.emit("unhandledRejection", { code: "E" });
        processEvents.emit("uncaughtExceptionMonitor", new Error("e"), "origin");
        expect(logger.error.mock.calls.length).toBeGreaterThanOrEqual(2);
        dispose();
    });



    // wave-288 residual
    it("dispose removes all three process/app listeners; post-dispose emits are silent", () => {
        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachCrashDiagnostics({ processEvents, appEvents, logger });
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(1);
        expect(processEvents.listenerCount("unhandledRejection")).toBe(1);
        expect(appEvents.listenerCount("child-process-gone")).toBe(1);
        dispose();
        expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(0);
        expect(processEvents.listenerCount("unhandledRejection")).toBe(0);
        expect(appEvents.listenerCount("child-process-gone")).toBe(0);
        logger.error.mockClear();
        processEvents.emit("unhandledRejection", "late");
        processEvents.emit("uncaughtExceptionMonitor", new Error("late"), "o");
        appEvents.emit("child-process-gone", {}, { type: "GPU" });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("renderer dispose is idempotent; unhandledRejection logs reason only", () => {
        const wc = new EventEmitter();
        const logger = { error: vi.fn() };
        const dispose = attachRendererCrashDiagnostics({ webContents: wc, logger });
        expect(wc.listenerCount("render-process-gone")).toBe(1);
        dispose();
        dispose();
        expect(wc.listenerCount("render-process-gone")).toBe(0);

        const processEvents = new EventEmitter();
        const appEvents = new EventEmitter();
        const dispose2 = attachCrashDiagnostics({ processEvents, appEvents, logger });
        logger.error.mockClear();
        processEvents.emit("unhandledRejection", "reason-only");
        expect(logger.error).toHaveBeenCalledWith("[crash] unhandled rejection:", "reason-only");
        dispose2();
    });

});
