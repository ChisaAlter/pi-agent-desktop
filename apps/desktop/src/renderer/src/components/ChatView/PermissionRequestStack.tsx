import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMotionPresenceList } from "../../hooks/useMotionPresence";
import { usePermissionStore } from "../../stores/permission-store";
import { Popover } from "../common/Popover";

const MORE_DECISIONS = [
  { value: "allow_once", label: "允许一次" },
  { value: "allow_always", label: "始终授权" },
  { value: "deny_session", label: "拒绝本轮" },
] as const;

interface PermissionRequestStackProps {
  workspaceId?: string;
  agentId?: string | null;
  displayMode?: "composer" | "viewport" | "desktop";
}

function isVisibleInScope(
  request: ReturnType<typeof usePermissionStore.getState>["pending"][number],
  workspaceId?: string,
  agentId?: string | null,
  displayMode: "composer" | "viewport" | "desktop" = "composer",
): boolean {
  if (workspaceId && request.workspaceId && request.workspaceId !== workspaceId) return false;
  if (displayMode === "composer" && request.agentId) return request.agentId === agentId;
  return true;
}

export function PermissionRequestStack({
  workspaceId,
  agentId = null,
  displayMode = "composer",
}: PermissionRequestStackProps): React.JSX.Element | null {
  const { pending, respond } = usePermissionStore();
  const visiblePending = useMemo(
    () => (displayMode === "desktop"
      ? []
      : pending.filter((request) => isVisibleInScope(request, workspaceId, agentId, displayMode))),
    [agentId, displayMode, pending, workspaceId],
  );
  const presentPending = useMotionPresenceList(visiblePending, (request) => request.requestId, 120);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && visiblePending[0]) {
        respond(visiblePending[0].requestId, "deny");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visiblePending, respond]);

  if (presentPending.length === 0) return null;

  const overlayClassName = displayMode === "viewport"
    ? "pointer-events-none fixed bottom-4 right-4 z-[90] w-full max-w-sm"
    : displayMode === "desktop"
      ? "pointer-events-none z-[90] w-full max-w-sm"
      : "pointer-events-none fixed z-[90]";

  const overlayStyle = displayMode === "viewport"
    ? undefined
    : displayMode === "desktop"
      ? undefined
    : {
      left: "var(--pi-global-composer-left, 0px)",
      right: "var(--pi-global-composer-right, 0px)",
      bottom: "calc(var(--pi-global-composer-height, 103px) + 12px)",
    } satisfies React.CSSProperties;

  const stack = (
    <div
      data-testid="permission-request-overlay"
      className={overlayClassName}
      style={overlayStyle}
    >
      <div className="pointer-events-auto space-y-2">
        {presentPending.map(({ item: request, state }, index) => (
          <div
            key={request.requestId}
            className="pi-motion-permission rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-4 py-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
            data-motion-state={state}
            role="alertdialog"
            aria-label={`权限请求 ${index + 1}`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--mm-text-primary)]">权限请求 {index + 1}</div>
                <div className="truncate text-xs text-[var(--mm-text-secondary)]">{request.title}</div>
              </div>
              <span className="rounded-md bg-[var(--mm-bg-panel)] px-2 py-1 text-[11px] text-[var(--mm-text-secondary)]">
                {request.kind}
              </span>
            </div>
            {request.message && (
              <pre className="mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--mm-bg-panel)] px-3 py-2 text-xs leading-relaxed text-[var(--mm-text-secondary)]">
                {request.message}
              </pre>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => respond(request.requestId, "deny")}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)]"
              >
                拒绝 Esc
              </button>
              <button
                type="button"
                onClick={() => respond(request.requestId, "allow_session")}
                className="rounded-lg bg-[#262626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#111]"
              >
                仅本对话
              </button>
              <Popover
                align="end"
                contentClassName="min-w-[132px]"
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2.5 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)]"
                    aria-label="更多权限决策"
                  >
                    <span>更多</span>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                }
              >
                {(close) => (
                  <div className="py-1">
                    {MORE_DECISIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          respond(request.requestId, item.value);
                          close();
                        }}
                        className="flex h-8 w-full items-center justify-between gap-3 px-3 text-left text-xs text-[var(--mm-text-secondary)] hover:bg-[#f4f4f3]"
                      >
                        <span>{item.label}</span>
                        {item.value === "allow_always" && (
                          <span className="rounded bg-[#f0f0ef] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-tertiary)]">持久</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return stack;
  }

  return createPortal(stack, document.body);
}
