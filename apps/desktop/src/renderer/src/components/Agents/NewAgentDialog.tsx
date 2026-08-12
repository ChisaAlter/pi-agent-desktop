import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useWorkspaceStore } from "../../stores/workspace-store";

/**
 * "新建 agent" dialog — pick a workspace, give the agent a title and an
 * optional kick-off task description. Creates via agentsCreate and (when a
 * description is present) immediately prompts the new agent.
 */
export function NewAgentDialog({
    open,
    defaultWorkspaceId,
    onClose,
    onCreate,
}: {
    open: boolean;
    defaultWorkspaceId?: string;
    onClose: () => void;
    onCreate: (input: { workspaceId: string; title: string; description: string }) => void;
}): React.JSX.Element | null {
    const { t } = useI18n();
    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? workspaces[0]?.id ?? "");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setWorkspaceId(defaultWorkspaceId ?? workspaces[0]?.id ?? "");
        setTitle("");
        setDescription("");
        setSubmitting(false);
    }, [open, defaultWorkspaceId, workspaces]);

    if (!open) return null;

    const canSubmit = Boolean(workspaceId) && !submitting;

    const handleSubmit = (): void => {
        if (!canSubmit) return;
        setSubmitting(true);
        onCreate({ workspaceId, title: title.trim(), description: description.trim() });
    };

    const inputClass =
        "w-full rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 py-1.5 text-[13px] text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)]";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            data-testid="new-agent-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("agents.newTitle")}
            onClick={onClose}
        >
            <div
                className="w-[420px] max-w-[90vw] rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <h3 className="m-0 mb-3 text-[14px] font-medium text-[var(--mm-text-primary)]">{t("agents.newTitle")}</h3>

                <label className="mb-3 block">
                    <span className="mb-1 block text-xs text-[var(--mm-text-secondary)]">{t("agents.workspace")}</span>
                    <select
                        value={workspaceId}
                        onChange={(event) => setWorkspaceId(event.target.value)}
                        className={inputClass}
                    >
                        {workspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                                {workspace.name}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="mb-3 block">
                    <span className="mb-1 block text-xs text-[var(--mm-text-secondary)]">{t("agents.title")}</span>
                    <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={t("agents.titlePlaceholder")}
                        autoFocus
                        className={inputClass}
                    />
                </label>

                <label className="mb-4 block">
                    <span className="mb-1 block text-xs text-[var(--mm-text-secondary)]">{t("agents.taskDescription")}</span>
                    <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t("agents.taskPlaceholder")}
                        rows={3}
                        className={`${inputClass} resize-none`}
                    />
                </label>

                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-1.5 text-[13px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)]"
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="rounded-md bg-[var(--mm-accent-blue)] px-3 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {t("agents.create")}
                    </button>
                </div>
            </div>
        </div>
    );
}
