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
        expect(MIMOCODE_PRIMARY_AGENT_IDS).toEqual(["build", "plan", "compose"]);
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
        expect(port.systemAgents.map((agent) => agent.id)).toEqual(["checkpoint-writer"]);
        expect(port.enabledToolIds).toContain("memory");
        expect(port.enabledToolIds).not.toContain("history");
        expect(port.enabledToolIds).not.toContain("workflow");
        expect(port.features.memory).toEqual({
            enabled: true,
            supported: true,
            loadedFrom: "desktop",
            ccIndex: true,
            reconcileOnSearch: true,
            searchScoreFloor: 0.2,
        });
        expect(port.features.planMode).toEqual({
            enabled: true,
            supported: true,
            loadedFrom: "pi-openplan",
        });
        expect(port.features.composeMode).toEqual({
            enabled: true,
            supported: true,
            loadedFrom: "desktop",
        });
        expect(port.features.maxMode).toEqual({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
            reason: "Pi Desktop 已移除 Max mode。",
            candidates: 3,
        });
        expect(port.features.workflow).toMatchObject({
            enabled: false,
            supported: true,
            loadedFrom: "disabled",
            maxConcurrentAgents: 2,
            maxLifecycleAgents: 8,
            maxDepth: 3,
        });
        expect(port.features.dream).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.features.distill).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
    });

    it("marks plan and compose as unsupported when their runtime bundles are unavailable", () => {
        const port = buildMiMoCodeRuntimePort(
            DEFAULT_LONG_HORIZON_SETTINGS,
            {
                planModeSupported: false,
                composeModeSupported: false,
                workflowSupported: false,
            },
        );

        expect(port.primaryAgents.map((agent) => agent.id)).toEqual(["build"]);
        expect(port.features.planMode).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.features.composeMode).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.features.maxMode).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.features.workflow).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
    });

    // wave-101 residual
    it("disables all long-horizon tools when the master switch is off", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: false,
            planMode: { enabled: true },
            composeMode: { enabled: true },
            memory: { enabled: true },
            history: { enabled: true },
            task: { enabled: true },
            actor: { enabled: true },
            workflow: { enabled: true, maxConcurrentAgents: 2, maxLifecycleAgents: 8, maxDepth: 2 },
            subagents: { enabled: true },
        });

        expect(port.features.planMode.enabled).toBe(false);
        expect(port.features.composeMode.enabled).toBe(false);
        expect(port.features.memory.enabled).toBe(false);
        expect(port.features.history.enabled).toBe(false);
        expect(port.features.task.enabled).toBe(false);
        expect(port.features.actor.enabled).toBe(false);
        expect(port.features.workflow.enabled).toBe(false);
        // primary agents still include only modes that remain enabled after master+feature gates
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build"]);
        expect(port.enabledToolIds).not.toContain("memory");
        expect(port.enabledToolIds).not.toContain("history");
        expect(port.enabledToolIds).not.toContain("task");
        expect(port.enabledToolIds).not.toContain("actor");
        expect(port.enabledToolIds).not.toContain("workflow");
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
    });

    it("drops system agents when subagents are disabled", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            subagents: { enabled: false },
            dream: { enabled: true },
            distill: { enabled: true },
        });
        expect(port.systemAgents).toEqual([]);
    });

    it("omits plan tools when plan mode is off and keeps compose primary agent", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            planMode: { enabled: false },
            composeMode: { enabled: true },
            memory: { enabled: true },
            history: { enabled: true },
            task: { enabled: true },
            actor: { enabled: false },
            workflow: { enabled: false },
        });
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "compose"]);
        expect(port.enabledToolIds).toContain("memory");
        expect(port.enabledToolIds).toContain("history");
        expect(port.enabledToolIds).toContain("task");
        expect(port.enabledToolIds).not.toContain("actor");
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
        expect(port.enabledToolIds).not.toContain("workflow");
    });

    it("enables workflow tooling only when workflow is on and supported", () => {
        const on = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            workflow: { enabled: true, maxConcurrentAgents: 3, maxLifecycleAgents: 9, maxDepth: 2 },
        });
        expect(on.features.workflow).toMatchObject({
            enabled: true,
            supported: true,
            maxConcurrentAgents: 3,
            maxLifecycleAgents: 9,
            maxDepth: 2,
        });
        expect(on.enabledToolIds).toContain("workflow");

        const unsupported = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                workflow: { enabled: true },
            },
            { workflowSupported: false },
        );
        expect(unsupported.features.workflow.enabled).toBe(false);
        expect(unsupported.enabledToolIds).not.toContain("workflow");
    });

    // wave-134 residual
    it("keeps maxMode disabled even when settings candidates are set", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            maxMode: { enabled: true, candidates: 7 },
        } as typeof DEFAULT_LONG_HORIZON_SETTINGS);
        expect(port.features.maxMode.enabled).toBe(false);
        expect(port.features.maxMode.supported).toBe(false);
        expect(port.features.maxMode.candidates).toBe(7);
        expect(port.primaryAgents.map((a) => a.id)).not.toContain("max");
    });

    it("includes checkpoint-writer when subagents on even if dream/distill unsupported", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            subagents: { enabled: true },
            dream: { enabled: true },
            distill: { enabled: true },
        });
        const ids = port.systemAgents.map((a) => a.id);
        expect(ids).toContain("checkpoint-writer");
        // dream/distill feature flags stay unsupported/disabled
        expect(port.features.dream.enabled).toBe(false);
        expect(port.features.distill.enabled).toBe(false);
        // systemAgents list still may include dream/distill entries when feature flags say enabled false
        // product: systemAgents filters by features.dream/distill.enabled
        expect(ids).not.toContain("dream");
        expect(ids).not.toContain("distill");
    });

    it("keeps core tool ids when only plan tools are stripped", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            planMode: { enabled: false },
            memory: { enabled: true },
            history: { enabled: true },
            task: { enabled: true },
            actor: { enabled: true },
            workflow: { enabled: false },
        });
        expect(port.enabledToolIds).toEqual(
            expect.arrayContaining(["bash", "read", "write", "memory", "history", "task", "actor"]),
        );
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
        expect(port.enabledToolIds).not.toContain("workflow");
    });

    // wave-172 residual
    it("disables plan primary agent when planModeSupported is false even if settings on", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                planMode: { enabled: true },
                composeMode: { enabled: true },
            },
            { planModeSupported: false, composeModeSupported: true },
        );
        expect(port.features.planMode.enabled).toBe(false);
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "compose"]);
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
    });

    it("longHorizon master off disables feature tools but keeps core tool ids", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: false,
            memory: { enabled: true },
            history: { enabled: true },
            task: { enabled: true },
            actor: { enabled: true },
            workflow: { enabled: true },
            planMode: { enabled: true },
            composeMode: { enabled: true },
            subagents: { enabled: true },
        });
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build"]);
        // product: systemAgents gates on settings.subagents.enabled only (not master);
        // dream/distill still filtered by features.*.enabled which is false under master-off.
        expect(port.systemAgents.map((a) => a.id)).toEqual(["checkpoint-writer"]);
        expect(port.features.subagents.enabled).toBe(false);
        expect(port.features.memory.enabled).toBe(false);
        expect(port.enabledToolIds).toEqual(
            expect.arrayContaining(["bash", "read", "write", "edit", "grep"]),
        );
        expect(port.enabledToolIds).not.toContain("memory");
        expect(port.enabledToolIds).not.toContain("history");
        expect(port.enabledToolIds).not.toContain("task");
        expect(port.enabledToolIds).not.toContain("actor");
        expect(port.enabledToolIds).not.toContain("workflow");
        expect(port.enabledToolIds).not.toContain("planenter");
    });

    // wave-185 residual
    it("composeModeSupported false drops compose primary even when settings on", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                planMode: { enabled: true },
                composeMode: { enabled: true },
            },
            { composeModeSupported: false, planModeSupported: true },
        );
        expect(port.features.composeMode.enabled).toBe(false);
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "plan"]);
        expect(port.features.planMode.enabled).toBe(true);
    });

    it("workflowSupported false disables workflow even if settings and compose support on", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                workflow: { enabled: true, maxConcurrentAgents: 9, maxLifecycleAgents: 50, maxDepth: 2 },
                composeMode: { enabled: true },
            },
            { workflowSupported: false, composeModeSupported: true },
        );
        expect(port.features.workflow.enabled).toBe(false);
        expect(port.features.workflow.maxConcurrentAgents).toBe(9);
        expect(port.features.workflow.maxLifecycleAgents).toBe(50);
        expect(port.features.workflow.maxDepth).toBe(2);
        expect(port.enabledToolIds).not.toContain("workflow");
    });

    it("subagents off yields empty systemAgents regardless of dream/distill settings", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            subagents: { enabled: false },
            dream: { enabled: true },
            distill: { enabled: true },
        });
        expect(port.systemAgents).toEqual([]);
        expect(port.features.dream.enabled).toBe(false);
        expect(port.features.distill.enabled).toBe(false);
    });

    // wave-199 residual
    it("defaults primary to build-only when plan/compose settings off", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            planMode: { enabled: false },
            composeMode: { enabled: false },
            workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
        });
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build"]);
        expect(port.features.planMode.enabled).toBe(false);
        expect(port.features.composeMode.enabled).toBe(false);
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
        expect(port.enabledToolIds).not.toContain("workflow");
    });

    it("memory feature keeps nested defaults when enabled under master on", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            memory: {
                enabled: true,
                ccIndex: true,
                reconcileOnSearch: false,
                searchScoreFloor: 0.42,
            },
        });
        expect(port.features.memory.enabled).toBe(true);
        expect(port.features.memory.ccIndex).toBe(true);
        expect(port.features.memory.reconcileOnSearch).toBe(false);
        expect(port.features.memory.searchScoreFloor).toBe(0.42);
        expect(port.enabledToolIds).toContain("memory");
    });

    it("maxMode stays disabled with candidates preserved from settings", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            maxMode: { enabled: true, candidates: 9 },
        });
        expect(port.features.maxMode.enabled).toBe(false);
        expect(port.features.maxMode.candidates).toBe(9);
        expect(port.features.maxMode.supported).toBe(false);
        expect(port.features.maxMode.loadedFrom).toBe("unsupported");
    });

    it("workflow inherits composeModeSupported when workflowSupported omitted", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                workflow: { enabled: true, maxConcurrentAgents: 2, maxLifecycleAgents: 10, maxDepth: 1 },
                composeMode: { enabled: true },
            },
            { composeModeSupported: false },
        );
        // product: workflowSupported ?? composeModeSupported ?? true
        expect(port.features.workflow.enabled).toBe(false);
        expect(port.features.workflow.supported).toBe(false);
        expect(port.enabledToolIds).not.toContain("workflow");
        // compose primary also dropped by composeModeSupported false
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "plan"]);
    });

    // wave-207 residual
    it("planModeSupported false drops plan primary and planenter/planexit tools", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                planMode: { enabled: true },
                composeMode: { enabled: true },
                // DEFAULT workflow.enabled is false — enable explicitly when asserting tool id
                workflow: { enabled: true, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
            },
            { planModeSupported: false },
        );
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "compose"]);
        expect(port.features.planMode.enabled).toBe(false);
        expect(port.features.planMode.supported).toBe(false);
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
        expect(port.enabledToolIds).toContain("workflow");
    });

    it("workflowSupported true keeps workflow even when composeModeSupported false", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                composeMode: { enabled: true },
                workflow: { enabled: true, maxConcurrentAgents: 3, maxLifecycleAgents: 9, maxDepth: 2 },
            },
            { composeModeSupported: false, workflowSupported: true },
        );
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "plan"]);
        expect(port.features.composeMode.enabled).toBe(false);
        expect(port.features.workflow.enabled).toBe(true);
        expect(port.features.workflow.supported).toBe(true);
        expect(port.features.workflow.maxConcurrentAgents).toBe(3);
        expect(port.features.workflow.maxDepth).toBe(2);
        expect(port.enabledToolIds).toContain("workflow");
    });

    it("dream/distill remain unsupported even when settings flip them on under subagents", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            subagents: { enabled: true },
            dream: { enabled: true },
            distill: { enabled: true },
        });
        expect(port.features.dream).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.features.distill).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        // systemAgents filters by features.dream/distill.enabled → only checkpoint-writer
        expect(port.systemAgents.map((a) => a.id)).toEqual(["checkpoint-writer"]);
    });

    it("disabling memory/history/task/actor removes only those tool ids from registry", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            memory: { enabled: false, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
            history: { enabled: false },
            task: { enabled: false },
            actor: { enabled: false },
            workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
            planMode: { enabled: false },
        });
        for (const id of ["memory", "history", "task", "actor", "workflow", "planenter", "planexit"]) {
            expect(port.enabledToolIds).not.toContain(id);
        }
        // core tools remain
        expect(port.enabledToolIds).toEqual(
            expect.arrayContaining(["bash", "read", "write", "edit", "grep", "glob", "skill"]),
        );
        expect(MIMOCODE_TOOL_IDS.length).toBeGreaterThan(port.enabledToolIds.length);
    });

    // wave-222 residual
    it("top-level longHorizon disabled forces feature toggles off but keeps tool core ids", () => {
        const port = buildMiMoCodeRuntimePort({
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: false,
            planMode: { enabled: true },
            composeMode: { enabled: true },
            memory: { enabled: true, ccIndex: true, reconcileOnSearch: true, searchScoreFloor: 0.2 },
            workflow: { enabled: true, maxConcurrentAgents: 2, maxLifecycleAgents: 9, maxDepth: 2 },
            subagents: { enabled: true },
        });
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build"]);
        // systemAgents keys off settings.subagents.enabled (not features.subagents);
        // dream/distill stay out because features.*.enabled is false under master off
        expect(port.systemAgents.map((a) => a.id)).toEqual(["checkpoint-writer"]);
        expect(port.features.planMode.enabled).toBe(false);
        expect(port.features.memory.enabled).toBe(false);
        expect(port.features.workflow.enabled).toBe(false);
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).toEqual(expect.arrayContaining(["bash", "read", "write"]));
    });

    it("planModeSupported false marks planMode unsupported even when settings enabled", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                enabled: true,
                planMode: { enabled: true },
            },
            { planModeSupported: false },
        );
        expect(port.features.planMode).toMatchObject({
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
        });
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "compose"]);
        expect(port.enabledToolIds).not.toContain("planenter");
        expect(port.enabledToolIds).not.toContain("planexit");
    });

    it("exports stable primary/system/tool id vocabularies", () => {
        expect([...MIMOCODE_PRIMARY_AGENT_IDS]).toEqual(["build", "plan", "compose"]);
        expect([...MIMOCODE_SYSTEM_AGENT_IDS]).toEqual(["checkpoint-writer", "dream", "distill"]);
        expect(MIMOCODE_TOOL_IDS).toContain("workflow");
        expect(MIMOCODE_TOOL_IDS).toContain("skill");
        expect(new Set(MIMOCODE_TOOL_IDS).size).toBe(MIMOCODE_TOOL_IDS.length);
    });

    // wave-251 residual
    it("composeModeSupported false drops compose primary and compose tools", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                enabled: true,
                composeMode: { enabled: true },
                planMode: { enabled: true },
            },
            { composeModeSupported: false },
        );
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build", "plan"]);
        expect(port.features.composeMode).toMatchObject({
            enabled: false,
            supported: false,
        });
        expect(port.enabledToolIds).not.toContain("workflow");
    });

    it("workflowSupported false keeps compose agent when enabled but marks workflow unsupported", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                enabled: true,
                composeMode: { enabled: true },
                workflow: { enabled: true, maxConcurrentAgents: 2, maxLifecycleAgents: 4, maxDepth: 2 },
            },
            { workflowSupported: false },
        );
        expect(port.primaryAgents.map((a) => a.id)).toContain("compose");
        expect(port.features.workflow.enabled).toBe(false);
        expect(port.features.workflow.supported).toBe(false);
        expect(port.enabledToolIds).not.toContain("workflow");
        expect(port.enabledToolIds).toEqual(expect.arrayContaining(["bash", "read"]));
    });

    // wave-262 residual
    it("composeModeSupported false drops compose from primaryAgents when compose enabled", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                enabled: true,
                composeMode: { enabled: true },
            },
            { composeModeSupported: false },
        );
        expect(port.primaryAgents.map((a) => a.id)).not.toContain("compose");
        expect(port.features.composeMode.supported).toBe(false);
    });

    it("longHorizon disabled yields build-only primary agents and empty workflow tools", () => {
        const port = buildMiMoCodeRuntimePort(
            {
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                enabled: false,
            },
            {},
        );
        expect(port.primaryAgents.map((a) => a.id)).toEqual(["build"]);
        expect(port.enabledToolIds).not.toContain("workflow");
    });

});
