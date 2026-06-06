import React, { useEffect } from "react";
import { usePermissionStore } from "../../stores/permission-store";
import { Popover } from "../common/Popover";

const MORE_DECISIONS = [
  { value: "allow_once", label: "允许一次" },
  { value: "allow_always", label: "始终授权" },
  { value: "deny_session", label: "拒绝本轮" },
] as const;

export function PermissionRequestStack(): React.JSX.Element | null {
  const { pending, respond } = usePermissionStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && pending[0]) {
        respond(pending[0].requestId, "deny");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, respond]);

  if (pending.length === 0) return null;

  return (
    <div className="mx-auto mb-2 max-w-[768px] space-y-2">
      {pending.map((request, index) => (
        <div
          key={request.requestId}
          className="rounded-xl border border-[#d8d8d8] bg-[#f7f7f5] px-4 py-3 shadow-sm"
          role="alertdialog"
          aria-label={`权限请求 ${index + 1}`}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#1f1f1f]">权限请求 {index + 1}</div>
              <div className="truncate text-xs text-[#666]">{request.title}</div>
            </div>
            <span className="rounded-md bg-white px-2 py-1 text-[11px] text-[#666]">
              {request.kind}
            </span>
          </div>
          {request.message && (
            <pre className="mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-[#333]">
              {request.message}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => respond(request.requestId, "deny")}
              className="rounded-lg px-3 py-1.5 text-xs text-[#555] hover:bg-white"
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
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d8d8d8] bg-white px-2.5 text-xs text-[#444] hover:bg-[#fafafa]"
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
                      className="flex h-8 w-full items-center justify-between gap-3 px-3 text-left text-xs text-[#333] hover:bg-[#f4f4f3]"
                    >
                      <span>{item.label}</span>
                      {item.value === "allow_always" && (
                        <span className="rounded bg-[#f0f0ef] px-1.5 py-0.5 text-[10px] text-[#777]">持久</span>
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
  );
}
