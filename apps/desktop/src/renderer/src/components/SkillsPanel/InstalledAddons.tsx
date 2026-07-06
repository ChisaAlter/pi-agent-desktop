import React, { useEffect, useRef, useState } from "react";
import { usePiPackagesStore } from "../../stores/pi-packages-store";
import { useSkillsStore } from "../../stores/skills-store";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function InstalledAddons(): React.JSX.Element {
  const {
    installed: piPackages,
    installedLoading: packagesLoading,
    actionSource,
    error: packageError,
    retryAction: packageRetryAction,
    lastAction: packageLastAction,
    refreshInstalled: refreshPackages,
    remove: removePackage,
    update: updatePackage,
  } = usePiPackagesStore();
  const {
    installed: skills,
    installedLoading: skillsLoading,
    error: skillError,
    refreshInstalled: refreshSkills,
    toggleSkill,
    uninstallSkill,
  } = useSkillsStore();
  const [pendingRemove, setPendingRemove] = useState<{ type: "package" | "skill"; id: string } | null>(null);
  const [skillAction, setSkillAction] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, pendingRemove !== null);

  useEffect(() => {
    void refreshPackages();
    void refreshSkills();
  }, [refreshPackages, refreshSkills]);

  const loading = packagesLoading || skillsLoading;
  const error = packageError ?? skillError;

  const runSkillAction = async (id: string, action: () => Promise<void>): Promise<void> => {
    setSkillAction(id);
    try {
      await action();
    } finally {
      setSkillAction(null);
    }
  };

  return (
    <div className="p-4">
      {error && !loading && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {packageRetryAction && packageError && (
            <button
              type="button"
              onClick={() => void packageRetryAction()}
              disabled={Boolean(actionSource)}
              className="shrink-0 rounded-md bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-50"
            >
              重试
            </button>
          )}
        </div>
      )}
      {packageLastAction && !error && (
        <div className="mb-4 rounded-lg border border-[#dbe8d0] bg-[#f5fbf0] px-3 py-2 text-sm text-[var(--color-success)]" role="status">
          {packageLastAction.message}{packageLastAction.requiresRestart ? "。新 Pi 会话或重启当前会话后生效。" : ""}
        </div>
      )}
      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--mm-text-tertiary)]" role="status">加载已安装项目...</div>
      ) : piPackages.length === 0 && skills.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--mm-text-tertiary)]" role="status">
          暂无已安装插件或 skill
        </div>
      ) : (
        <div className="space-y-3">
          {piPackages.map((item) => (
            <div key={item.source} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--mm-text-primary)]">{item.name}</div>
                <div className="truncate font-mono text-xs text-[var(--mm-text-tertiary)]">{item.source} · {item.scope === "global" ? "全局" : "项目本地"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`更新 ${item.name}`}
                  disabled={actionSource === item.source}
                  onClick={() => void updatePackage(item.source)}
                  className="rounded px-3 py-1 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-50"
                >
                  {actionSource === item.source ? "处理中..." : "更新"}
                </button>
                <button
                  type="button"
                  aria-label={`卸载 ${item.name}`}
                  disabled={actionSource === item.source}
                  onClick={() => setPendingRemove({ type: "package", id: item.source })}
                  className="rounded px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {actionSource === item.source ? "处理中..." : "卸载"}
                </button>
              </div>
            </div>
          ))}

          {skills.map((skill) => (
            <div key={skill.slug} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--mm-text-primary)]">{skill.slug}</div>
                <div className="text-xs text-[var(--mm-text-tertiary)]">SkillHub · {skill.enabled ? "已启用" : "已禁用"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`${skill.enabled ? "禁用" : "启用"} ${skill.slug}`}
                  disabled={skillAction === skill.slug}
                  onClick={() => void runSkillAction(skill.slug, () => toggleSkill(skill.slug, !skill.enabled))}
                  className="rounded px-3 py-1 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-50"
                >
                  {skillAction === skill.slug ? "处理中..." : skill.enabled ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  aria-label={`卸载 ${skill.slug}`}
                  disabled={skillAction === skill.slug}
                  onClick={() => setPendingRemove({ type: "skill", id: skill.slug })}
                  className="rounded px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {skillAction === skill.slug ? "处理中..." : "卸载"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
          <div
            ref={dialogRef}
            className="w-[380px] rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="确认卸载"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPendingRemove(null);
            }}
          >
            <h3 className="text-base font-semibold text-[var(--mm-text-primary)]">卸载{pendingRemove.type === "package" ? "插件" : "技能"}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--mm-text-secondary)]">
              确认卸载 <span className="font-mono text-[var(--mm-text-primary)]">{pendingRemove.id}</span> 吗？
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = pendingRemove;
                  setPendingRemove(null);
                  if (next.type === "package") {
                    void removePackage(next.id);
                  } else {
                    void runSkillAction(next.id, () => uninstallSkill(next.id));
                  }
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                卸载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
