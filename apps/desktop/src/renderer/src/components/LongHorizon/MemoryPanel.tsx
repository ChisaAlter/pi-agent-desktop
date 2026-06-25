import React, { useEffect, useMemo, useState } from "react";
import { isIpcError, type LongHorizonMemoryRecord } from "@shared";
import { useRuntimeFeatureStore, isRuntimeFeatureEnabled } from "../../stores/runtime-feature-store";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

function recordMeta(record: LongHorizonMemoryRecord): string {
  const parts: string[] = [record.layer, record.kind];
  if (record.score !== undefined) parts.push(`score ${record.score.toFixed(2)}`);
  return parts.join(" · ");
}

export function MemoryPanel(): React.JSX.Element {
  const featureState = useRuntimeFeatureStore((state) => state.featureState);
  const longHorizon = useSettingsStore((state) => state.settings.longHorizon);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
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
    if (!currentWorkspace) return "请选择 workspace 后查看记忆索引。";
    return trimmedQuery ? `搜索 “${trimmedQuery}”` : `最近记忆 · ${currentWorkspace.name}`;
  }, [currentWorkspace, trimmedQuery]);

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[var(--mm-bg-body)] px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-[var(--mm-text-primary)]">记忆</h1>
          <p className="mt-1 text-sm text-[var(--mm-text-secondary)]">{subtitle}</p>
        </div>
        <label className="w-full max-w-[340px]">
          <span className="sr-only">搜索记忆</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索记忆..."
            className="w-full rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm text-[var(--mm-text-primary)] outline-none focus:border-[var(--mm-accent-blue)]"
          />
        </label>
      </div>

      {!enabled ? (
        <div className="rounded-2xl border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          当前未启用 memory system，打开设置里的长程记忆能力后会在这里展示 session / project / global / history 检索结果。
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          正在读取记忆索引...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          {trimmedQuery ? "没有找到匹配的记忆条目。" : "当前还没有可展示的记忆条目。"}
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
