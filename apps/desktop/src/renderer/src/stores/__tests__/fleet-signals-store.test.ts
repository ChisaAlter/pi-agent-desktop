import { beforeEach, describe, expect, it } from "vitest";
import type { ApprovalRequest, PiEvent } from "@shared";
import { useFleetSignalsStore } from "../fleet-signals-store";

function queueEvent(steering: string[], followUp: string[]): PiEvent {
    return { type: "queue_update", steering, followUp } as unknown as PiEvent;
}

beforeEach(() => {
    useFleetSignalsStore.setState({
        queueBlockedByAgent: {},
        approvalByRequest: {},
        approvalPendingByWorkspace: {},
    });
});

describe("fleet-signals-store — queue 挂起信号", () => {
    it("steering/followUp 非空 → 该 agent blocked", () => {
        useFleetSignalsStore.getState().applyQueueEvent("agent-1", queueEvent(["排队消息"], []));
        expect(useFleetSignalsStore.getState().queueBlockedByAgent["agent-1"]).toBe(true);
    });

    it("turn_end 解除挂起", () => {
        useFleetSignalsStore.getState().applyQueueEvent("agent-1", queueEvent(["排队消息"], []));
        useFleetSignalsStore.getState().applyQueueEvent("agent-1", { type: "turn_end" } as PiEvent);
        expect(useFleetSignalsStore.getState().queueBlockedByAgent["agent-1"]).toBeUndefined();
    });

    it("空队列不误报", () => {
        useFleetSignalsStore.getState().applyQueueEvent("agent-1", queueEvent([], []));
        expect(useFleetSignalsStore.getState().queueBlockedByAgent["agent-1"]).toBeUndefined();
    });
});

describe("fleet-signals-store — approval 挂起信号", () => {
    const makeRequest = (requestId: string, workspaceId: string): ApprovalRequest => ({
        requestId,
        method: "confirm",
        title: "允许执行",
        workspaceId,
    });

    it("approval:request → workspace 挂起计数 +1", () => {
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r1", "ws-1"));
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBe(1);
    });

    it("同 requestId 幂等", () => {
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r1", "ws-1"));
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r1", "ws-1"));
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBe(1);
    });

    it("approval:resolved → 计数归零并移除", () => {
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r1", "ws-1"));
        useFleetSignalsStore.getState().resolveApproval("r1");
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBeUndefined();
        expect(useFleetSignalsStore.getState().approvalByRequest["r1"]).toBeUndefined();
    });

    it("多请求逐个 resolve 递减", () => {
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r1", "ws-1"));
        useFleetSignalsStore.getState().trackApprovalRequest(makeRequest("r2", "ws-1"));
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBe(2);
        useFleetSignalsStore.getState().resolveApproval("r1");
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBe(1);
        useFleetSignalsStore.getState().resolveApproval("r2");
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace["ws-1"]).toBeUndefined();
    });

    it("无 workspaceId 的请求不跟踪", () => {
        useFleetSignalsStore.getState().trackApprovalRequest({ requestId: "r1", method: "confirm", title: "x" });
        expect(useFleetSignalsStore.getState().approvalPendingByWorkspace).toEqual({});
    });
});
