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
});
