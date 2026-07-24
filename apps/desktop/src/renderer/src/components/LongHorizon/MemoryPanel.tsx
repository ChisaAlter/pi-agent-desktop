import React, { useEffect, useMemo, useState } from "react";
import { isIpcError, type LongHorizonMemoryRecord } from "@shared";
import { useRuntimeFeatureStore, isRuntimeFeatureEnabled } from "../../stores/runtime-feature-store";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useI18n } from "../../i18n";

/** Exported for unit tests — compact meta line for memory cards. */
export function recordMeta(record: LongHorizonMemoryRecord): string {
  const parts: string[] = [record.layer, record.kind];
  if (record.score !== undefined) parts.push(`score ${record.score.toFixed(2)}`);
  return parts.join(" · ");
}

export function MemoryPanel(): React.JSX.Element {
  const featureState = useRuntimeFeatureStore((state) => state.featureState);
  const longHorizon = useSettingsStore((state) => state.settings.longHorizon);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<LongHorizonMemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = isRuntimeFeatureEnabled(featureState, longHorizon, "memory");
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!currentWorkspace?.id) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    let disposed = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = trimmedQuery
          ? await window.piAPI?.memorySearch?.({
              workspaceId: currentWorkspace.id,
              sessionId: currentSessionId ?? undefined,
              query: trimmedQuery,
              limit: 12,
            })
          : await window.piAPI?.memoryListRecent?.({
              workspaceId: currentWorkspace.id,
              sessionId: currentSessionId ?? undefined,
              limit: 12,
            });
        if (disposed) return;
        if (!result) {
          setRecords([]);
          setLoading(false);
          return;
        }
        if (isIpcError(result)) {
          setError(result.fallback);
          setRecords([]);
          setLoading(false);
          return;
        }
        setRecords(result);
        setLoading(false);
      } catch (loadError) {
        if (disposed) return;
        setRecords([]);
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [currentSessionId, currentWorkspace?.id, enabled, trimmedQuery]);

  const subtitle = useMemo(() => {
    if (!currentWorkspace) return t("memoryPanel.subtitle.selectWorkspace");
    return trimmedQuery
      ? t("memoryPanel.subtitle.searchQuery", { query: trimmedQuery })
      : t("memoryPanel.subtitle.recent", { name: currentWorkspace.name });
  }, [currentWorkspace, trimmedQuery, t]);

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[var(--mm-bg-body)] px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-[var(--mm-text-primary)]">{t("memoryPanel.title")}</h1>
          <p className="mt-1 text-sm text-[var(--mm-text-secondary)]">{subtitle}</p>
        </div>
        <label className="w-full max-w-[340px]">
          <span className="sr-only">{t("memoryPanel.searchLabel")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("memoryPanel.searchPlaceholder")}
            className="w-full rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-accent-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          />
        </label>
      </div>

      {!enabled ? (
        <div className="rounded-2xl border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          {t("memoryPanel.disabled")}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          {t("memoryPanel.loading")}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          {trimmedQuery ? t("memoryPanel.empty.noMatch") : t("memoryPanel.empty.noEntries")}
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {records.map((record) => (
            <li key={record.id} className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[11px] text-[var(--mm-text-tertiary)]">
                  {record.scope}
                </span>
                <span className="text-[11px] text-[var(--mm-text-tertiary)]">{recordMeta(record)}</span>
              </div>
              <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-[var(--mm-text-primary)]">{record.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
