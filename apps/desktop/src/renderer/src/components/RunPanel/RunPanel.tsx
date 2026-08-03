import React from "react";
import { useI18n } from "../../i18n";
import { MemoryPanel } from "../LongHorizon/MemoryPanel";
import { TaskOverviewPanel } from "../LongHorizon/TaskOverviewPanel";

export type RunView = "tasks" | "memory";

interface RunPanelProps {
  view: RunView;
  onViewChange: (view: RunView) => void;
}

const RUN_TABS: Array<{ id: RunView; labelKey: string }> = [
  { id: "tasks", labelKey: "runPanel.tabs.tasks" },
  { id: "memory", labelKey: "runPanel.tabs.memory" },
];

export function RunPanel({ view, onViewChange }: RunPanelProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--mm-bg-body)]">
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--mm-border)] pl-12 pr-6">
        <div className="flex h-full items-center gap-5" role="tablist" aria-label={t("runPanel.ariaLabel")}>
          {RUN_TABS.map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewChange(tab.id)}
                className={`relative h-full text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mm-accent-blue)] ${
                  active
                    ? "text-[var(--mm-text-primary)]"
                    : "text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-primary)]"
                }`}
              >
                {t(tab.labelKey)}
                {active ? (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--mm-accent-blue)]" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "tasks" ? <TaskOverviewPanel /> : <MemoryPanel />}
      </div>
    </section>
  );
}
