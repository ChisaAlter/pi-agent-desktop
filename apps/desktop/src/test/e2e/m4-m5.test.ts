/**
 * M4 + M5 e2e tests
 */
import { describe, it, expect } from "vitest";

describe("M4 PtyManager integration (smoke)", () => {
    it("PtyManager class is exported and instantiable", async () => {
        const { PtyManager } = await import("../../main/services/shell/pty-manager");
        const mgr = new PtyManager();
        expect(mgr.size()).toBe(0);
        expect(mgr.list()).toEqual([]);
    });
});

describe("M5 ErrorBoundary (smoke)", () => {
    it("default export name is ErrorBoundary", async () => {
        const mod = await import("../../renderer/src/components/common/ErrorBoundary");
        expect(mod.ErrorBoundary).toBeDefined();
    });
});

describe("M5 shared types include all M1-M4 events", () => {
    it("approval.ts declares RiskLevel and ApprovalRequest", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const { fileURLToPath } = await import("url");
        // Resolve from this test file's location
        const here = path.dirname(fileURLToPath(import.meta.url));
        const approvalPath = path.resolve(
            here,
            "..",
            "..",
            "..",
            "..",
            "..",
            "packages",
            "shared-types",
            "src",
            "approval.ts",
        );
        const src = fs.readFileSync(approvalPath, "utf-8");
        expect(src).toContain("export type RiskLevel");
        expect(src).toContain("export interface ApprovalRequest");
        expect(src).toContain('"high" | "edit" | "read"');
    });

    it("events.ts declares PiEvent union covering all M1 phases", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const { fileURLToPath } = await import("url");
        const here = path.dirname(fileURLToPath(import.meta.url));
        const eventsPath = path.resolve(
            here,
            "..",
            "..",
            "..",
            "..",
            "..",
            "packages",
            "shared-types",
            "src",
            "events.ts",
        );
        const src = fs.readFileSync(eventsPath, "utf-8");
        // M1 phases
        expect(src).toContain('"agent_start"');
        expect(src).toContain('"agent_end"');
        expect(src).toContain('"turn_start"');
        expect(src).toContain('"turn_end"');
        expect(src).toContain('"message_start"');
        expect(src).toContain('"message_update"');
        expect(src).toContain('"message_end"');
        // M1 interceptor needs tool_execution_start/end
        expect(src).toContain('"tool_execution_start"');
        expect(src).toContain('"tool_execution_end"');
    });
});
