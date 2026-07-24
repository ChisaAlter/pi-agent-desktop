import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, showSaveDialog } = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    },
    dialog: { showSaveDialog },
}));

vi.mock("electron-log/main", () => ({ default: { error: vi.fn() } }));

import { setupDiagnosticsIpc } from "../diagnostics.ipc";

describe("setupDiagnosticsIpc", () => {
    const dirs: string[] = [];

    beforeEach(() => {
        handlers.clear();
        showSaveDialog.mockReset();
    });

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("returns cancelled without building or writing a report", async () => {
        const buildReport = vi.fn();
        showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
        setupDiagnosticsIpc({ getMainWindow: () => null, buildReport });

        expect(await handlers.get("diagnostics:export")?.({})).toEqual({ cancelled: true });
        expect(buildReport).not.toHaveBeenCalled();
    });

    it("writes a formatted diagnostic JSON report", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostic-ipc-"));
        dirs.push(dir);
        const filePath = join(dir, "report.json");
        showSaveDialog.mockResolvedValue({ canceled: false, filePath });
        setupDiagnosticsIpc({
            getMainWindow: () => null,
            buildReport: () => ({ appVersion: "1.2.3", database: { ok: true, details: ["ok"] } }),
        });

        expect(await handlers.get("diagnostics:export")?.({})).toEqual({ cancelled: false, path: filePath });
        expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({ appVersion: "1.2.3" });
    });

    // wave-99 residual
    it("returns cancelled when filePath is missing even if not canceled", async () => {
        const buildReport = vi.fn();
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: undefined });
        setupDiagnosticsIpc({ getMainWindow: () => null, buildReport });
        expect(await handlers.get("diagnostics:export")?.({})).toEqual({ cancelled: true });
        expect(buildReport).not.toHaveBeenCalled();
    });

    it("returns branded ipcError when buildReport throws", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostic-ipc-fail-"));
        dirs.push(dir);
        const filePath = join(dir, "report.json");
        showSaveDialog.mockResolvedValue({ canceled: false, filePath });
        setupDiagnosticsIpc({
            getMainWindow: () => null,
            buildReport: () => {
                throw new Error("db locked");
            },
        });
        await expect(handlers.get("diagnostics:export")?.({})).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.diagnostics.exportFailed",
            fallback: expect.stringContaining("db locked"),
        });
    });

    it("awaits async buildReport and pretty-prints JSON with trailing newline", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostic-ipc-async-"));
        dirs.push(dir);
        const filePath = join(dir, "report.json");
        showSaveDialog.mockResolvedValue({ canceled: false, filePath });
        setupDiagnosticsIpc({
            getMainWindow: () => null,
            buildReport: async () => ({ appVersion: "9.9.9", note: "async" }),
        });
        await expect(handlers.get("diagnostics:export")?.({})).resolves.toEqual({
            cancelled: false,
            path: filePath,
        });
        const raw = readFileSync(filePath, "utf8");
        expect(raw.endsWith("\n")).toBe(true);
        expect(JSON.parse(raw)).toEqual({ appVersion: "9.9.9", note: "async" });
        expect(raw).toContain("\n  ");
    });

    it("passes main window to showSaveDialog when available", async () => {
        const mainWindow = { id: "main" };
        showSaveDialog.mockResolvedValue({ canceled: true });
        setupDiagnosticsIpc({
            getMainWindow: () => mainWindow as never,
            buildReport: vi.fn(),
        });
        await handlers.get("diagnostics:export")?.({});
        expect(showSaveDialog).toHaveBeenCalledWith(
            mainWindow,
            expect.objectContaining({
                title: "导出 Pi Desktop 诊断报告",
                filters: [{ name: "JSON", extensions: ["json"] }],
            }),
        );
    });

    // wave-104 residual
    it("calls showSaveDialog without parent when main window is null", async () => {
        showSaveDialog.mockResolvedValue({ canceled: true });
        setupDiagnosticsIpc({ getMainWindow: () => null, buildReport: vi.fn() });
        await handlers.get("diagnostics:export")?.({});
        expect(showSaveDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "导出 Pi Desktop 诊断报告",
                filters: [{ name: "JSON", extensions: ["json"] }],
            }),
        );
    });

    it("returns exportFailed when showSaveDialog rejects", async () => {
        showSaveDialog.mockRejectedValue(new Error("dialog crashed"));
        setupDiagnosticsIpc({ getMainWindow: () => null, buildReport: vi.fn() });
        await expect(handlers.get("diagnostics:export")?.({})).resolves.toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.diagnostics.exportFailed",
            fallback: expect.stringContaining("dialog crashed"),
        });
    });
});
