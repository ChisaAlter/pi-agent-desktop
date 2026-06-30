export type WorkflowOperation = "run" | "status" | "wait" | "cancel";
export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkflowPhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ComposeWorkflowType = "feature" | "bugfix" | "refactor" | "feedback";

export interface ComposeWorkflowArgs {
    task: string;
    type?: ComposeWorkflowType;
    featureName?: string;
    maxConcurrent?: number;
    skipReport?: boolean;
    isolateWorktrees?: boolean;
    commit?: boolean;
    commitMessage?: string;
    /** Optional global deadline (ms) for the whole workflow. Defaults to 1h. */
    timeoutMs?: number;
}

export interface ComposeWorkflowTask {
    id: string;
    description: string;
    acceptance: string;
    dependsOn: string[];
    files?: string[];
}

export interface WorkflowPhaseRecord {
    name: string;
    status: WorkflowPhaseStatus;
    startedAt?: number;
    endedAt?: number;
    summary?: string;
}

export interface WorkflowRunOutcome {
    status: WorkflowRunStatus;
    summary: string;
    artifacts: string[];
    phaseSummaries: string[];
    error?: string;
}

export interface WorkflowRunSnapshot {
    id: string;
    name: "compose";
    status: WorkflowRunStatus;
    currentPhase?: string;
    task: string;
    createdAt: number;
    updatedAt: number;
    artifacts: string[];
    phases: WorkflowPhaseRecord[];
    outcome?: WorkflowRunOutcome;
    error?: string;
}

export interface ChildAgentRunInput {
    label: string;
    cwd: string;
    prompt: string;
    provider?: string;
    modelId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
}

export interface ChildAgentRunResult {
    ok: boolean;
    label: string;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    text: string;
}

export interface ComposeArtifactPaths {
    docsDir: string;
    specsDir: string;
    plansDir: string;
    reportsDir: string;
    slug: string;
    specPath: string;
    planPath: string;
    reportPath: string;
}
