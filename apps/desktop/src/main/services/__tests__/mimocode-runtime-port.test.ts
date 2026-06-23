import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS } from "@shared";
import {
    buildMiMoCodeRuntimePort,
    MIMOCODE_PRIMARY_AGENT_IDS,
    MIMOCODE_SYSTEM_AGENT_IDS,
    MIMOCODE_TOOL_IDS,
} from "../mimocode-runtime-port";

describe("MiMoCode runtime port", () => {
    it("keeps MiMoCode primary and system agents as the local source of truth", () => {
        expect(MIMOCODE_PRIMARY_AGENT_IDS).toEqual(["build", "plan", "compose", "max"]);
        expect(MIMOCODE_SYSTEM_AGENT_IDS).toEqual([
            "checkpoint-writer",
            "dream",
            "distill",
        ]);
    });

    it("ports MiMoCode builtin tool registry ids, including long-horizon tools", () => {
        expect(MIMOCODE_TOOL_IDS).toEqual(expect.arrayContaining([
            "bash",
            "read",
            "glob",
            "grep",
            "edit",
            "write",
            "actor",
            "fetch",
            "search",
            "code",
            "skill",
            "patch",
            "changedir",
            "question",
            "lsp",
            "planenter",
            "planexit",
            "memory",
            "history",
            "task",
            "workflow",
        ]));
    });

    it("builds a feature state that follows the settings switches", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            maxMode: { enabled: false, candidates: 3 },
            memory: { enabled: true, ccIndex: true, reconcileOnSearch: true, searchScoreFloor: 0.2 },
            history: { enabled: false },
            workflow: { enabled: false, maxConcurrentAgents: 2, maxLifecycleAgents: 8, maxDepth: 3 },
            dream: { enabled: false },
            distill: { enabled: true },
        });

        expect(port.primaryAgents.map((agent) => agent.id)).toEqual(["build", "plan", "compose"]);
        expect(port.systemAgents.map((agent) => agent.id)).toEqual(["checkpoint-writer", "distill"]);
        expect(port.enabledToolIds).toContain("memory");
        expect(port.enabledToolIds).not.toContain("history");
        expect(port.enabledToolIds).not.toContain("workflow");
        expect(port.features.memory).toEqual({
            enabled: true,
            ccIndex: true,
            reconcileOnSearch: true,
            searchScoreFloor: 0.2,
        });
        expect(port.features.maxMode).toEqual({ enabled: false, candidates: 3 });
        expect(port.features.workflow).toEqual({
            enabled: false,
            maxConcurrentAgents: 2,
            maxLifecycleAgents: 8,
            maxDepth: 3,
        });
    });
});
