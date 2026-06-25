import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS, normalizeLongHorizonSettings } from "./index";

describe("normalizeLongHorizonSettings", () => {
    it("migrates legacy composeWorkflow into workflow defaults", () => {
        const merged = normalizeLongHorizonSettings({
            enabled: true,
            composeWorkflow: { enabled: false },
        });

        expect(merged.workflow.enabled).toBe(false);
        expect(merged.composeWorkflow.enabled).toBe(false);
        expect(merged.workflow.maxConcurrentAgents).toBe(4);
        expect(merged.maxMode.candidates).toBe(5);
    });

    it("falls back to build when the stored default mode is no longer supported", () => {
        const merged = normalizeLongHorizonSettings({
            defaultMode: "max" as never,
        });

        expect(merged.defaultMode).toBe("build");
    });

    it("preserves modern nested defaults when value is empty", () => {
        const merged = normalizeLongHorizonSettings();

        expect(merged).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
    });
});
