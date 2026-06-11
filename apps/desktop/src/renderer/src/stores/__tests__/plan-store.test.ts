import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePlanStore, isGenericPlanGuidance } from "../plan-store";

// In Node test environment, `window` is not defined but the store code uses `window.piAPI`.
// Alias globalThis as window so the store can access piAPI.
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

beforeEach(() => {
  usePlanStore.setState({
    enabled: false,
    activeCard: null,
    decisionRequest: null,
    pendingPlanClarification: null,
    renderedPlanCardIds: [],
    activeExecution: null,
    steps: [],
    status: "idle",
    lastError: null,
  });
  // Ensure globalThis.piAPI is cleared before each test
  delete (globalThis as Record<string, unknown>).piAPI;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).piAPI;
});

describe("isGenericPlanGuidance", () => {
  it("returns false for content with execution steps + goal description", () => {
    const content = `
## 目标
实现用户登录功能

## 执行步骤
1. 修改 auth.ts 添加登录逻辑
2. 新增 login 组件
3. 测试登录流程
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns false for content with code blocks", () => {
    const content = `
你想要规划什么？我可以帮你制定计划。

\`\`\`typescript
const x = 1;
\`\`\`
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns false for content with concrete plan title", () => {
    const content = `
# 实施计划
目标：实现用户认证
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns false for content with English plan title", () => {
    const content = `
# Implementation Plan
Goal: implement user auth
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns false for content with English execution steps", () => {
    const content = `
- Add login component
- Create auth service
- Test the flow
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns false for content with file paths (2+)", () => {
    const content = `
你想要规划什么？请告诉我你的目标。

涉及文件: src/auth.ts, src/login.tsx
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });

  it("returns true for pure clarification prompts", () => {
    const content = "你想要规划什么？请告诉我你的目标和想法。";
    expect(isGenericPlanGuidance(content)).toBe(true);
  });

  it("returns true for capability descriptions", () => {
    const content = "你可以让我阅读、编辑、重构、调试代码，也可以分解需求、制定执行计划。";
    expect(isGenericPlanGuidance(content)).toBe(true);
  });

  it("returns true for English clarification prompt", () => {
    const content = "What would you like me to plan? Please describe your goal.";
    expect(isGenericPlanGuidance(content)).toBe(true);
  });

  it("returns false for content with mixed goal and steps", () => {
    const content = `
## 目标
实现用户注册

- 修改 src/register.ts
- 新增注册表单组件
`;
    expect(isGenericPlanGuidance(content)).toBe(false);
  });
});

describe("setEnabled revert logic", () => {
  it("reverts to previous value on IPC failure (not !enabled)", async () => {
    // Start with enabled=false
    expect(usePlanStore.getState().enabled).toBe(false);

    // Mock IPC that rejects
    const mockPlanSetEnabled = vi.fn().mockRejectedValue(new Error("IPC error"));
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    // Set enabled to true
    usePlanStore.getState().setEnabled("ws-1", true);

    // Immediately after set, enabled should be true (optimistic)
    expect(usePlanStore.getState().enabled).toBe(true);

    // Wait for the promise to reject
    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(false);
    });

    // lastError should be set
    expect(usePlanStore.getState().lastError).toBe("IPC error");
  });

  it("reverts to correct previous value when toggling from true to false", async () => {
    // Start with enabled=true
    usePlanStore.setState({ enabled: true });

    const mockPlanSetEnabled = vi.fn().mockResolvedValue("some error");
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    // Set enabled to false
    usePlanStore.getState().setEnabled("ws-1", false);

    // Immediately after set, enabled should be false (optimistic)
    expect(usePlanStore.getState().enabled).toBe(false);

    // Wait for the promise to resolve with error
    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(true);
    });

    // lastError should be set with the string result
    expect(usePlanStore.getState().lastError).toBe("some error");
  });

  it("clears lastError on successful toggle", async () => {
    usePlanStore.setState({ lastError: "previous error" });

    const mockPlanSetEnabled = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", true);

    // lastError should be cleared immediately
    expect(usePlanStore.getState().lastError).toBeNull();

    // enabled should remain true (no revert since result is undefined)
    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(true);
    });
  });

  it("clearError clears lastError", () => {
    usePlanStore.setState({ lastError: "some error" });
    expect(usePlanStore.getState().lastError).toBe("some error");

    usePlanStore.getState().clearError();
    expect(usePlanStore.getState().lastError).toBeNull();
  });

  it("sets default error message on non-Error catch", async () => {
    const mockPlanSetEnabled = vi.fn().mockRejectedValue("string error");
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", true);

    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(false);
    });

    expect(usePlanStore.getState().lastError).toBe("计划模式切换失败");
  });
});
