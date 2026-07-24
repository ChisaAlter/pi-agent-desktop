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

    // wave-91 residual
    it("preserves supported defaultMode plan and compose", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "build" }).defaultMode).toBe("build");
    });

    it("merges nested toggles without dropping sibling defaults", () => {
        const merged = normalizeLongHorizonSettings({
            memory: { enabled: false },
            maxMode: { enabled: true, candidates: 9 },
            workflow: { enabled: false, maxDepth: 8 },
        });
        expect(merged.memory.enabled).toBe(false);
        expect(merged.memory.ccIndex).toBe(false);
        expect(merged.memory.reconcileOnSearch).toBe(true);
        expect(merged.maxMode.enabled).toBe(true);
        expect(merged.maxMode.candidates).toBe(9);
        expect(merged.workflow.enabled).toBe(false);
        expect(merged.workflow.maxConcurrentAgents).toBe(4);
        expect(merged.workflow.maxDepth).toBe(8);
    });

    it("treats null input like empty and keeps defaults", () => {
        expect(normalizeLongHorizonSettings(null)).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
    });

    it("does not let composeWorkflow override explicit workflow when both are present", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxConcurrentAgents: 2 },
            composeWorkflow: { enabled: false },
        });
        // workflow field wins over legacy composeWorkflow for the workflow object
        expect(merged.workflow.enabled).toBe(true);
        expect(merged.workflow.maxConcurrentAgents).toBe(2);
        expect(merged.composeWorkflow.enabled).toBe(false);
    });

    // wave-115 residual
    it("maps empty string defaultMode to build", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "PLAN" as never }).defaultMode).toBe("build");
    });

    it("merges goal/task/actor siblings without dropping defaults", () => {
        const merged = normalizeLongHorizonSettings({
            goal: { enabled: false },
            task: { enabled: false },
            actor: { enabled: true },
            enabled: false,
        });
        expect(merged.enabled).toBe(false);
        expect(merged.goal).toEqual({
            ...DEFAULT_LONG_HORIZON_SETTINGS.goal,
            enabled: false,
        });
        expect(merged.task.enabled).toBe(false);
        expect(merged.actor.enabled).toBe(true);
        // untouched siblings retain defaults
        expect(merged.checkpoint).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.checkpoint);
        expect(merged.history).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.history);
    });

    it("uses composeWorkflow only for workflow when workflow is omitted", () => {
        const merged = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: false },
        });
        expect(merged.workflow.enabled).toBe(false);
        // other workflow fields keep defaults when only legacy toggle is provided
        expect(merged.workflow.maxConcurrentAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxConcurrentAgents,
        );
        expect(merged.composeWorkflow.enabled).toBe(false);
    });

    // wave-143 residual
    it("merges dream/distill/subagents/planMode/composeMode without dropping siblings", () => {
        const merged = normalizeLongHorizonSettings({
            dream: { enabled: true },
            distill: { enabled: true },
            subagents: { enabled: false },
            planMode: { enabled: false },
            composeMode: { enabled: false },
            memory: { enabled: true, searchScoreFloor: 0.5 },
        });
        expect(merged.dream.enabled).toBe(true);
        expect(merged.distill.enabled).toBe(true);
        expect(merged.subagents.enabled).toBe(false);
        expect(merged.planMode.enabled).toBe(false);
        expect(merged.composeMode.enabled).toBe(false);
        // partial memory merge keeps other memory defaults
        expect(merged.memory).toEqual({
            ...DEFAULT_LONG_HORIZON_SETTINGS.memory,
            searchScoreFloor: 0.5,
        });
        expect(merged.maxMode).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.maxMode);
    });

    it("spreads unknown top-level fields from partial input while keeping defaults", () => {
        const merged = normalizeLongHorizonSettings({
            enabled: false,
            // unknown key should still be present via ...value spread
            experimentalFlag: true,
        } as never);
        expect(merged.enabled).toBe(false);
        expect((merged as { experimentalFlag?: boolean }).experimentalFlag).toBe(true);
        expect(merged.defaultMode).toBe("build");
        expect(merged.memory).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.memory);
    });

    it("preserves workflow numeric knobs when only enabled is patched", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true },
        });
        expect(merged.workflow).toEqual({
            ...DEFAULT_LONG_HORIZON_SETTINGS.workflow,
            enabled: true,
        });
        expect(merged.workflow.maxConcurrentAgents).toBe(4);
        expect(merged.workflow.maxLifecycleAgents).toBe(100);
        expect(merged.workflow.maxDepth).toBe(4);
    });

    // wave-153 residual
    it("prefers workflow over composeWorkflow when both are provided", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxDepth: 9 },
            composeWorkflow: { enabled: false },
        });
        // value?.workflow ?? value?.composeWorkflow → workflow wins
        expect(merged.workflow.enabled).toBe(true);
        expect(merged.workflow.maxDepth).toBe(9);
        expect(merged.workflow.maxConcurrentAgents).toBe(4);
        // composeWorkflow sibling still merges from its own field
        expect(merged.composeWorkflow.enabled).toBe(false);
    });

    it("returns defaults for undefined and empty object input", () => {
        expect(normalizeLongHorizonSettings(undefined)).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(normalizeLongHorizonSettings({})).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        // product does not freeze — returned object is a fresh merge
        expect(normalizeLongHorizonSettings({})).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS);
    });

    it("merges maxMode candidates without requiring enabled", () => {
        const merged = normalizeLongHorizonSettings({
            maxMode: { candidates: 12 } as never,
        });
        expect(merged.maxMode).toEqual({
            ...DEFAULT_LONG_HORIZON_SETTINGS.maxMode,
            candidates: 12,
        });
        expect(merged.maxMode.enabled).toBe(true);
    });

    it("does not let composeWorkflow rewrite workflow when workflow is explicit empty object", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: {} as never,
            composeWorkflow: { enabled: false },
        });
        // empty workflow object is still truthy for ?? so composeWorkflow is ignored for workflow merge
        expect(merged.workflow.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow.enabled);
        expect(merged.composeWorkflow.enabled).toBe(false);
    });

    // wave-161 residual
    it("normalizes defaultMode to build unless plan or compose", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "build" }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "weird" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "" as never }).defaultMode).toBe("build");
    });

    it("merges nested feature flags independently and accepts null input as defaults", () => {
        expect(normalizeLongHorizonSettings(null)).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        const merged = normalizeLongHorizonSettings({
            memory: { enabled: false, searchScoreFloor: 0.5 },
            dream: { enabled: true },
            distill: { enabled: true },
        });
        expect(merged.memory.enabled).toBe(false);
        expect(merged.memory.searchScoreFloor).toBe(0.5);
        expect(merged.memory.ccIndex).toBe(false); // default retained
        expect(merged.dream.enabled).toBe(true);
        expect(merged.distill.enabled).toBe(true);
        expect(merged.planMode.enabled).toBe(true);
    });

    it("uses composeWorkflow as workflow source only when workflow is nullish", () => {
        const fromCompose = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: false, maxDepth: 2 } as never,
        });
        // workflow = composeWorkflow when workflow undefined
        expect(fromCompose.workflow.enabled).toBe(false);
        expect(fromCompose.workflow.maxDepth).toBe(2);
        expect(fromCompose.composeWorkflow.enabled).toBe(false);
    });

    // wave-180 residual
    it("prefers workflow over composeWorkflow when both are present", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxDepth: 9 },
            composeWorkflow: { enabled: false, maxDepth: 1 } as never,
        });
        expect(merged.workflow.enabled).toBe(true);
        expect(merged.workflow.maxDepth).toBe(9);
        // composeWorkflow still merges independently for its own field
        expect(merged.composeWorkflow.enabled).toBe(false);
    });

    it("merges maxMode candidates while retaining defaults for omitted nested keys", () => {
        const merged = normalizeLongHorizonSettings({
            maxMode: { candidates: 9 } as Partial<typeof DEFAULT_LONG_HORIZON_SETTINGS.maxMode> as never,
            planMode: { enabled: false },
        });
        expect(merged.maxMode.candidates).toBe(9);
        expect(merged.maxMode.enabled).toBe(true);
        expect(merged.planMode.enabled).toBe(false);
        expect(merged.composeMode.enabled).toBe(true);
        expect(merged.enabled).toBe(true);
    });

    it("undefined input equals DEFAULT_LONG_HORIZON_SETTINGS without mutating defaults", () => {
        const a = normalizeLongHorizonSettings(undefined);
        const b = normalizeLongHorizonSettings();
        expect(a).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(b).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        a.enabled = false;
        expect(DEFAULT_LONG_HORIZON_SETTINGS.enabled).toBe(true);
    });

    // wave-189 residual
    it("null input equals defaults; partial nested planMode does not wipe sibling nested defaults", () => {
        const fromNull = normalizeLongHorizonSettings(null);
        expect(fromNull).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        const partial = normalizeLongHorizonSettings({
            planMode: { enabled: false },
            memory: { enabled: false } as never,
        });
        expect(partial.planMode.enabled).toBe(false);
        expect(partial.composeMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.composeMode.enabled);
        expect(partial.memory.enabled).toBe(false);
        expect(partial.history).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.history);
        expect(partial.subagents).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.subagents);
    });

    it("workflow-only partial leaves composeWorkflow defaults; does not share nested refs with DEFAULT", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: false, maxDepth: 3 },
        });
        // product shallow-merges nested objects — omitted keys retain defaults
        expect(merged.workflow.enabled).toBe(false);
        expect(merged.workflow.maxDepth).toBe(3);
        expect(merged.workflow.maxConcurrentAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxConcurrentAgents,
        );
        expect(merged.workflow.maxLifecycleAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxLifecycleAgents,
        );
        expect(merged.composeWorkflow).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow);
        expect(merged.workflow).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow);
        expect(merged.planMode).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS.planMode);
    });

    // wave-197 residual
    it("top-level enabled false preserves nested defaults; dream interval merges without wiping enabled default false", () => {
        const disabled = normalizeLongHorizonSettings({ enabled: false });
        expect(disabled.enabled).toBe(false);
        expect(disabled.planMode).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.planMode);
        expect(disabled.composeMode).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.composeMode);
        const dream = normalizeLongHorizonSettings({
            dream: { intervalDays: 7 } as never,
        });
        // product spreads partial dream over defaults (enabled stays false)
        expect(dream.dream.enabled).toBe(false);
        expect(dream.dream.intervalDays).toBe(7);
        expect(dream.distill).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.distill);
    });

    it("composeWorkflow legacy alone still seeds workflow when workflow key omitted", () => {
        const merged = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: false },
        });
        expect(merged.workflow.enabled).toBe(false);
        expect(merged.composeWorkflow.enabled).toBe(false);
        expect(merged.workflow.maxDepth).toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxDepth);
    });

    // wave-203 residual
    it("defaultMode only plan/compose stick; unknown modes coerce to build", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "build" }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "max" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "PLAN" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings(null).defaultMode).toBe("build");
    });

    it("partial planMode merges over defaults without wiping sibling flags", () => {
        const merged = normalizeLongHorizonSettings({
            planMode: { enabled: false } as never,
        });
        expect(merged.planMode.enabled).toBe(false);
        // other planMode keys remain from defaults
        expect(merged.planMode).toEqual({
            ...DEFAULT_LONG_HORIZON_SETTINGS.planMode,
            enabled: false,
        });
        expect(merged.composeMode).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.composeMode);
        expect(merged).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS);
    });

    // wave-210 residual
    it("partial workflow merges numeric caps over defaults", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxDepth: 2 } as never,
        });
        expect(merged.workflow.enabled).toBe(true);
        expect(merged.workflow.maxDepth).toBe(2);
        expect(merged.workflow.maxConcurrentAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxConcurrentAgents,
        );
        expect(merged.workflow.maxLifecycleAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxLifecycleAgents,
        );
        // composeWorkflow stays independent when only workflow is patched
        expect(merged.composeWorkflow).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow);
    });

    it("undefined input clones defaults without sharing reference", () => {
        const a = normalizeLongHorizonSettings(undefined);
        const b = normalizeLongHorizonSettings();
        expect(a).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(b).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(a).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(a).not.toBe(b);
        a.planMode.enabled = !a.planMode.enabled;
        expect(b.planMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.planMode.enabled);
    });

    // wave-217 residual
    it("null input equals defaults; plan/compose defaultMode preserved; max falls back to build", () => {
        expect(normalizeLongHorizonSettings(null)).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "max" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "" as never }).defaultMode).toBe("build");
    });

    it("workflow wins over composeWorkflow for workflow merge; composeWorkflow still independent", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxDepth: 1 } as never,
            composeWorkflow: { enabled: false },
        });
        expect(merged.workflow.enabled).toBe(true);
        expect(merged.workflow.maxDepth).toBe(1);
        expect(merged.workflow.maxConcurrentAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxConcurrentAgents,
        );
        expect(merged.composeWorkflow.enabled).toBe(false);
        // memory partial merge keeps other memory defaults
        const mem = normalizeLongHorizonSettings({
            memory: { searchScoreFloor: 0.5 } as never,
        });
        expect(mem.memory.searchScoreFloor).toBe(0.5);
        expect(mem.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);
        expect(mem.memory.ccIndex).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.ccIndex);
    });

    // wave-240 residual
    it("composeWorkflow alone seeds workflow when workflow omitted; both merge independently", () => {
        const fromCompose = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: false },
        });
        // product: workflow = value?.workflow ?? value?.composeWorkflow
        expect(fromCompose.workflow.enabled).toBe(false);
        expect(fromCompose.composeWorkflow.enabled).toBe(false);

        const both = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxConcurrentAgents: 9 } as never,
            composeWorkflow: { enabled: false },
        });
        expect(both.workflow.enabled).toBe(true);
        expect(both.workflow.maxConcurrentAgents).toBe(9);
        expect(both.composeWorkflow.enabled).toBe(false);
    });

    it("nested partials merge without wiping sibling toggles; unknown top-level fields pass via spread", () => {
        const merged = normalizeLongHorizonSettings({
            enabled: false,
            maxMode: { candidates: 3 } as never,
            dream: { enabled: true, auto: true } as never,
            distill: { intervalDays: 7 } as never,
            goal: { enabled: false },
        });
        expect(merged.enabled).toBe(false);
        expect(merged.maxMode.candidates).toBe(3);
        expect(merged.maxMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.maxMode.enabled);
        expect(merged.dream.enabled).toBe(true);
        expect(merged.dream.auto).toBe(true);
        expect(merged.distill.intervalDays).toBe(7);
        expect(merged.distill.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.distill.enabled);
        expect(merged.goal.enabled).toBe(false);
        expect(merged.planMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.planMode.enabled);
        // nested objects are new references
        expect(merged.memory).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory);
        expect(merged.workflow).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow);
    });

    // wave-251 residual
    it("undefined input returns deep clone of defaults; nullish nested values do not wipe siblings", () => {
        const a = normalizeLongHorizonSettings(undefined);
        const b = normalizeLongHorizonSettings(undefined);
        expect(a).toEqual(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(a).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(a.memory).not.toBe(b.memory);
        a.memory.enabled = !DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled;
        expect(b.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);

        const partial = normalizeLongHorizonSettings({
            planMode: { enabled: false },
            subagents: {} as never,
        });
        expect(partial.planMode.enabled).toBe(false);
        expect(partial.subagents.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.subagents.enabled);
        expect(partial.composeMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.composeMode.enabled);
    });

    it("workflow max fields coerce/preserve product defaults when partial", () => {
        const merged = normalizeLongHorizonSettings({
            workflow: { maxDepth: 5 } as never,
        });
        expect(merged.workflow.maxDepth).toBe(5);
        expect(merged.workflow.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow.enabled);
        expect(merged.workflow.maxConcurrentAgents).toBe(
            DEFAULT_LONG_HORIZON_SETTINGS.workflow.maxConcurrentAgents,
        );
        expect(merged.composeWorkflow).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow);
    });

    // wave-260 residual
    it("normalizeLongHorizonSettings deep-clones nested memory/planMode independently", () => {
        const a = normalizeLongHorizonSettings({ memory: { enabled: false } as never });
        const b = normalizeLongHorizonSettings({ memory: { enabled: false } as never });
        expect(a.memory).not.toBe(b.memory);
        a.memory.enabled = true;
        expect(b.memory.enabled).toBe(false);
        expect(a.planMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.planMode.enabled);
    });

    it("unknown top-level keys are preserved by product merge; empty object still has defaults", () => {
        // product shallow-merge keeps unknown keys rather than stripping them
        const merged = normalizeLongHorizonSettings({ weird: true } as never) as unknown as Record<string, unknown>;
        expect(merged.weird).toBe(true);
        expect(merged.workflow).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.workflow);
        expect(merged).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS as never);
        const empty = normalizeLongHorizonSettings({} as never);
        expect(empty.workflow.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.workflow.enabled);
        expect(empty.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);
    });


    // wave-267 residual
    it("null/undefined input yields full DEFAULT_LONG_HORIZON_SETTINGS clone", () => {
        const a = normalizeLongHorizonSettings(null);
        const b = normalizeLongHorizonSettings(undefined);
        expect(a.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.enabled);
        expect(b.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.enabled);
        expect(a).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS);
        expect(a.memory).not.toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory);
        a.memory.enabled = !DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled;
        expect(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled).not.toBe(a.memory.enabled);
    });

    it("partial nested planMode merges without dropping sibling toggles", () => {
        const merged = normalizeLongHorizonSettings({
            planMode: { enabled: false } as never,
            composeMode: { enabled: true } as never,
        });
        expect(merged.planMode.enabled).toBe(false);
        expect(merged.composeMode.enabled).toBe(true);
        expect(merged.workflow).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.workflow);
        expect(merged.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);
    });

    // wave-272 residual
    it("defaultMode normalizes unknown values to build; plan/compose preserved", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "build" }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "weird" as never }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({}).defaultMode).toBe(DEFAULT_LONG_HORIZON_SETTINGS.defaultMode);
    });

    it("workflow falls back from composeWorkflow when workflow omitted; nested maxMode candidates merge", () => {
        const fromCompose = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: false },
        } as never);
        // product: workflow = value.workflow ?? value.composeWorkflow then merge onto defaults
        expect(fromCompose.workflow.enabled).toBe(false);
        const max = normalizeLongHorizonSettings({
            maxMode: { candidates: 9 } as never,
        });
        expect(max.maxMode.candidates).toBe(9);
        expect(max.maxMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.maxMode.enabled);
        expect(max.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);
    });


    // wave-279 residual
    it("nested memory merge preserves siblings; top-level spread keeps provided enabled as-is", () => {
        const merged = normalizeLongHorizonSettings({
            enabled: false,
            memory: { enabled: false } as never,
        });
        expect(merged.enabled).toBe(false);
        expect(merged.memory.enabled).toBe(false);
        expect(merged.planMode.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.planMode.enabled);
        expect(merged.history.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.history.enabled);
    });

    it("returns new object each call; mutating result does not alias defaults", () => {
        const a = normalizeLongHorizonSettings({});
        const b = normalizeLongHorizonSettings({});
        expect(a).not.toBe(b);
        a.enabled = !b.enabled;
        expect(DEFAULT_LONG_HORIZON_SETTINGS.enabled).not.toBe(a.enabled);
        expect(b.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.enabled);
    });



    // wave-287 residual
    it("dream/distill/goal nested merge preserves siblings; memory floor/ccIndex/reconcile siblings", () => {
        const merged = normalizeLongHorizonSettings({
            dream: { enabled: true, intervalDays: 7 } as never,
            distill: { auto: true } as never,
            goal: { enabled: false } as never,
            memory: { searchScoreFloor: 0.5 } as never,
        });
        expect(merged.dream.enabled).toBe(true);
        expect((merged.dream as { intervalDays?: number }).intervalDays).toBe(7);
        expect(merged.distill.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.distill.enabled);
        expect((merged.distill as { auto?: boolean }).auto).toBe(true);
        expect(merged.goal.enabled).toBe(false);
        expect(merged.memory.searchScoreFloor).toBe(0.5);
        expect(merged.memory.ccIndex).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.ccIndex);
        expect(merged.memory.reconcileOnSearch).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.reconcileOnSearch);
        expect(merged.memory.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.memory.enabled);
        expect(merged.subagents).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.subagents);
    });

    it("both workflow and composeWorkflow provided: workflow wins for workflow field; defaultMode explore→build", () => {
        const both = normalizeLongHorizonSettings({
            workflow: { enabled: true, maxDepth: 2 } as never,
            composeWorkflow: { enabled: false } as never,
            defaultMode: "explore" as never,
        });
        // product: workflow = value.workflow ?? value.composeWorkflow, so explicit workflow wins
        expect(both.workflow.enabled).toBe(true);
        expect(both.workflow.maxDepth).toBe(2);
        expect(both.composeWorkflow.enabled).toBe(false);
        // only plan/compose preserved; explore normalizes to build
        expect(both.defaultMode).toBe("build");

        const taskActor = normalizeLongHorizonSettings({
            task: { enabled: false } as never,
            actor: { enabled: false } as never,
            subagents: { enabled: false } as never,
        });
        expect(taskActor.task.enabled).toBe(false);
        expect(taskActor.actor.enabled).toBe(false);
        expect(taskActor.subagents.enabled).toBe(false);
        expect(taskActor.checkpoint.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.checkpoint.enabled);
    });



    // wave-311 residual
    it("normalizeLongHorizonSettings: composeWorkflow aliases workflow when workflow missing", () => {
        const fromCompose = normalizeLongHorizonSettings({
            composeWorkflow: { enabled: true, maxDepth: 3 } as never,
        });
        // product: workflow = value?.workflow ?? value?.composeWorkflow
        expect(fromCompose.workflow.enabled).toBe(true);
        expect(fromCompose.workflow.maxDepth).toBe(3);
        // composeWorkflow still merged from its own field
        expect(fromCompose.composeWorkflow.enabled).toBe(true);
    });

    it("normalizeLongHorizonSettings: defaultMode only plan|compose else build; nested partial merge", () => {
        expect(normalizeLongHorizonSettings({ defaultMode: "plan" }).defaultMode).toBe("plan");
        expect(normalizeLongHorizonSettings({ defaultMode: "compose" }).defaultMode).toBe("compose");
        expect(normalizeLongHorizonSettings({ defaultMode: "build" }).defaultMode).toBe("build");
        expect(normalizeLongHorizonSettings({ defaultMode: "PLAN" as never }).defaultMode).toBe("build");
        const partial = normalizeLongHorizonSettings({
            planMode: { enabled: false } as never,
            dream: { enabled: true } as never,
        });
        expect(partial.planMode.enabled).toBe(false);
        // other planMode defaults retained from DEFAULT
        expect(partial.planMode).toMatchObject({ ...DEFAULT_LONG_HORIZON_SETTINGS.planMode, enabled: false });
        expect(partial.dream.enabled).toBe(true);
        expect(partial.distill.enabled).toBe(DEFAULT_LONG_HORIZON_SETTINGS.distill.enabled);
        expect(partial.history).toEqual(DEFAULT_LONG_HORIZON_SETTINGS.history);
    });
});
