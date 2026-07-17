import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorkflowTool } from "./workflow-tool.ts";
import { WorkflowRunStore } from "./workflow-run-store.ts";
import type { WorkflowRunSnapshot } from "./types.ts";

function workflowCard(snapshot: WorkflowRunSnapshot) {
    const completed = snapshot.phases.filter((phase) => phase.status === "completed" || phase.status === "skipped").length;
    const statusTone = snapshot.status === "completed"
        ? "success"
        : snapshot.status === "failed"
            ? "danger"
            : snapshot.status === "cancelled"
                ? "warning"
                : "info";
    const sections: Array<Record<string, unknown>> = [
        {
            id: "workflow-progress",
            kind: "progress",
            items: [{ id: "phases", label: "工作流阶段", value: completed, max: Math.max(snapshot.phases.length, 1), status: snapshot.currentPhase ?? snapshot.status }],
        },
        {
            id: "workflow-steps",
            kind: "steps",
            items: snapshot.phases.map((phase) => ({
                id: phase.name,
                label: phase.name,
                status: phase.status,
                description: phase.summary,
            })),
        },
    ];
    if (snapshot.artifacts.length > 0) {
        sections.push({
            id: "workflow-artifacts",
            kind: "file_list",
            items: snapshot.artifacts.map((path, index) => ({ id: `artifact-${index}`, label: path.split(/[\\/]/).at(-1) ?? path, path, status: "completed" })),
        });
    }
    if (snapshot.outcome?.summary || snapshot.error) {
        sections.push({
            id: "workflow-outcome",
            kind: "callout",
            tone: statusTone,
            title: snapshot.status === "completed" ? "工作流完成" : snapshot.status === "failed" ? "工作流失败" : "工作流状态",
            content: snapshot.error ?? snapshot.outcome?.summary ?? snapshot.status,
        });
    }
    return {
        version: "v2" as const,
        id: `workflow-${snapshot.id}`,
        title: "Compose Workflow",
        subtitle: snapshot.task,
        tone: statusTone,
        sections,
    };
}

export default function composeWorkflowExtension(pi: ExtensionAPI): void {
    const workflowRuns = new WorkflowRunStore();
    pi.registerTool(createWorkflowTool(workflowRuns, {
        onSnapshot: (snapshot) => {
            pi.sendMessage({
                customType: "generated-ui",
                content: "",
                display: true,
                details: { operation: "upsert", card: workflowCard(snapshot) },
            }, { triggerTurn: false });
        },
    }));
}
