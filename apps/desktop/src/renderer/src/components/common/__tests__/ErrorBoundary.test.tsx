// ErrorBoundary test (M5 Task M5-4)
// 验证组件错误被 ErrorBoundary 捕获

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ErrorBoundary } from "../ErrorBoundary";

// ThrowOnRender 抛错组件, 用 shouldThrow prop 控制
function ThrowOnRender({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
    if (shouldThrow) {
        throw new Error("test error");
    }
    return <div>正常内容</div>;
}

describe("ErrorBoundary", () => {
    it("renders children when no error", () => {
        render(
            <ErrorBoundary>
                <div>hello</div>
            </ErrorBoundary>
        );
        expect(screen.getByText("hello")).toBeTruthy();
    });

    it("catches error and shows fallback", () => {
        // 屏蔽 console.error 防止测试输出乱
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <ErrorBoundary>
                <ThrowOnRender shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.queryByText("正常内容")).toBeNull();
        expect(screen.getByText("出错了")).toBeTruthy();
        expect(screen.getByText("test error")).toBeTruthy();

        consoleSpy.mockRestore();
    });

    it("renders custom fallback when provided", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <ErrorBoundary
                fallback={(err, reset) => (
                    <div>
                        <span>Custom: {err.message}</span>
                        <button onClick={reset}>Reset</button>
                    </div>
                )}
            >
                <ThrowOnRender shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText("Custom: test error")).toBeTruthy();

        consoleSpy.mockRestore();
    });
});
