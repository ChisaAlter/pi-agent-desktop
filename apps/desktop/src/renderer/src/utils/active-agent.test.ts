import { describe, expect, it } from "vitest";
import type { AgentTab } from "@shared";
import { resolveActiveAgent } from "./active-agent";

const agents: AgentTab[] = [
  { id: "default", workspaceId: "ws1", title: "Default", status: "idle", createdAt: 1, updatedAt: 1 },
  { id: "session-1", workspaceId: "ws1", sessionId: "s1", title: "S1", status: "idle", createdAt: 2, updatedAt: 2 },
  { id: "other", workspaceId: "ws2", sessionId: "s2", title: "Other", status: "idle", createdAt: 3, updatedAt: 3 },
];

describe("resolveActiveAgent", () => {
  it("prefers the workspace/session match", () => {
    expect(resolveActiveAgent(agents, "ws1", { sessionId: "s1" })?.id).toBe("session-1");
  });

  it("does not accept a selected agent from another workspace", () => {
    expect(resolveActiveAgent(agents, "ws1", { agentId: "other" })?.id).toBe("default");
  });

  it("falls back to the workspace sessionless agent", () => {
    expect(resolveActiveAgent(agents, "ws1")?.id).toBe("default");
    expect(resolveActiveAgent(agents, "missing")).toBeNull();
  });
});
