import React, { useState, useCallback, useEffect, useRef } from "react";
import { SHORTCUTS, type ShortcutDef, groupByCategory } from "../../../shortcuts/registry";

interface ShortcutOverride {
  id: string;
  keys: string;
}

function KeyBadge({ keys }: { keys: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 font-mono text-xs text-[var(--mm-text-primary)]">
      {keys.split("+").map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 && <span className="text-[var(--mm-text-tertiary)]">+</span>}
          <kbd className="rounded border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-1.5 py-0.5 text-[11px] shadow-sm">{key}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

function ShortcutRecorder({
  onRecord,
  onCancel,
}: {
  onRecord: (keys: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
        parts.push(key);
        onRecord(parts.join("+"));
      }
    };

    const el = ref.current;
    if (el) {
      el.focus();
      el.addEventListener("keydown", handler);
      return () => el.removeEventListener("keydown", handler);
    }
    return;
  }, [onRecord, onCancel]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      className="flex items-center gap-2 rounded-lg border-2 border-dashed border-[var(--mm-accent-blue)] bg-[var(--mm-bg-panel)] px-3 py-2 text-xs"
    >
      <span className="text-[var(--mm-text-secondary)]">按下新的快捷键...</span>
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto rounded px-2 py-1 text-[10px] text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-panel)] hover:text-[var(--mm-text-primary)]"
      >
        取消
      </button>
    </div>
  );
}

export function ShortcutsSettings(): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ShortcutOverride[]>(() => {
    try {
      const stored = localStorage.getItem("pi-desktop-shortcut-overrides");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const categories = groupByCategory(SHORTCUTS);

  const getEffectiveKeys = useCallback(
    (shortcut: ShortcutDef): string => {
      const override = overrides.find((o) => o.id === shortcut.id);
      return override?.keys ?? shortcut.keys;
    },
    [overrides],
  );

  const handleRecord = useCallback(
    (shortcutId: string, newKeys: string) => {
      const newOverrides = overrides.filter((o) => o.id !== shortcutId);
      newOverrides.push({ id: shortcutId, keys: newKeys });
      setOverrides(newOverrides);
      localStorage.setItem("pi-desktop-shortcut-overrides", JSON.stringify(newOverrides));
      setEditingId(null);
    },
    [overrides],
  );

  const handleReset = useCallback(
    (shortcutId: string) => {
      const newOverrides = overrides.filter((o) => o.id !== shortcutId);
      setOverrides(newOverrides);
      localStorage.setItem("pi-desktop-shortcut-overrides", JSON.stringify(newOverrides));
    },
    [overrides],
  );

  const handleResetAll = useCallback(() => {
    setOverrides([]);
    localStorage.removeItem("pi-desktop-shortcut-overrides");
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--mm-text-primary)]">快捷键设置</h3>
          <p className="m-0 mt-1 text-xs text-[var(--mm-text-tertiary)]">自定义键盘快捷键绑定</p>
        </div>
        {overrides.length > 0 && (
          <button
            type="button"
            onClick={handleResetAll}
            className="rounded-lg border border-[var(--mm-border)] px-3 py-1.5 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[var(--mm-text-primary)]"
          >
            重置全部
          </button>
        )}
      </div>

      <div className="space-y-6">
        {categories.map(({ category, items }) => (
          <div key={category}>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--mm-text-tertiary)]">
              {category === "nav" ? "导航" : category === "chat" ? "对话" : category === "panel" ? "面板" : category === "edit" ? "编辑" : "帮助"}
            </h4>
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
              {items.map((shortcut) => {
                const effectiveKeys = getEffectiveKeys(shortcut);
                const isModified = overrides.some((o) => o.id === shortcut.id);
                const isEditing = editingId === shortcut.id;

                return (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between border-b border-[var(--mm-border)] px-4 py-3 last:border-b-0"
                  >
                    <span className="text-sm text-[var(--mm-text-primary)]">{shortcut.labelKey.split(".").pop()}</span>
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <ShortcutRecorder
                          onRecord={(keys) => handleRecord(shortcut.id, keys)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <>
                          <KeyBadge keys={effectiveKeys} />
                          <button
                            type="button"
                            onClick={() => setEditingId(shortcut.id)}
                            className="rounded px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[var(--mm-text-primary)]"
                          >
                            修改
                          </button>
                          {isModified && (
                            <button
                              type="button"
                              onClick={() => handleReset(shortcut.id)}
                              className="rounded px-2 py-1 text-[11px] text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-panel)] hover:text-[var(--mm-text-primary)]"
                            >
                              重置
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
