import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    HerdrRpcClient,
    type HerdrRpcSocket,
    type HerdrSubscriptionEvent,
} from "../rpc-client";

class FakeSocket extends EventEmitter implements HerdrRpcSocket {
    readonly writes: string[] = [];
    ended = false;
    destroyed = false;

    write(data: string): boolean {
        this.writes.push(data);
        return true;
    }

    end(): void {
        this.ended = true;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit("close");
    }

    connect(): void {
        this.emit("connect");
    }

    receive(data: string): void {
        this.emit("data", Buffer.from(data, "utf8"));
    }

    fail(error: Error): void {
        this.emit("error", error);
    }

    closeFromServer(): void {
        this.emit("close");
    }

    get closed(): boolean {
        return this.ended || this.destroyed;
    }
}

interface WireRequest {
    id: string;
    method: string;
    params: unknown;
}

function writtenRequest(socket: FakeSocket): WireRequest {
    const parsed: unknown = JSON.parse(socket.writes[0].trim());
    if (!parsed || typeof parsed !== "object") throw new Error("expected request object");
    const record = parsed as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.method !== "string") {
        throw new Error("expected request id and method");
    }
    return { id: record.id, method: record.method, params: record.params };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

afterEach(() => {
    vi.useRealTimers();
});

describe("HerdrRpcClient", () => {
    it("uses one socket per concurrent request and closes each after its response", async () => {
        const sockets = [new FakeSocket(), new FakeSocket()];
        const connector = vi.fn(() => {
            const socket = sockets[connector.mock.calls.length - 1];
            if (!socket) throw new Error("unexpected socket request");
            return socket;
        });
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector });

        const first = client.request<{ value: number }>("first", { index: 1 });
        const second = client.request<{ value: number }>("second", { index: 2 });
        expect(connector).toHaveBeenCalledTimes(2);
        sockets[0].connect();
        sockets[1].connect();
        await flushPromises();

        const firstRequest = writtenRequest(sockets[0]);
        const secondRequest = writtenRequest(sockets[1]);
        const firstResponse = JSON.stringify({ id: firstRequest.id, result: { value: 1 } }) + "\n";
        sockets[0].receive(firstResponse.slice(0, 13));
        sockets[0].receive(firstResponse.slice(13));
        sockets[1].receive(JSON.stringify({ id: secondRequest.id, result: { value: 2 } }) + "\n");

        await expect(first).resolves.toEqual({ value: 1 });
        await expect(second).resolves.toEqual({ value: 2 });
        expect(firstRequest.method).toBe("first");
        expect(secondRequest.method).toBe("second");
        expect(sockets[0].closed).toBe(true);
        expect(sockets[1].closed).toBe(true);
    });

    it("closes a request socket on malformed JSON", async () => {
        const socket = new FakeSocket();
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector: () => socket });
        const pending = client.request("ping", {});
        socket.connect();
        socket.receive("{not-json}\n");

        await expect(pending).rejects.toThrow("invalid JSON");
        expect(socket.closed).toBe(true);
    });

    it("closes a request socket when its timeout expires", async () => {
        vi.useFakeTimers();
        const socket = new FakeSocket();
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector: () => socket });
        const pending = client.request("slow", {}, 25);
        const assertion = expect(pending).rejects.toThrow("timed out after 25ms");
        socket.connect();

        await vi.advanceTimersByTimeAsync(25);

        await assertion;
        expect(socket.closed).toBe(true);
    });

    it("uses a dedicated subscription socket and exposes active unsubscribe closure", async () => {
        const requestOne = new FakeSocket();
        const requestTwo = new FakeSocket();
        const subscription = new FakeSocket();
        const sockets = [requestOne, requestTwo, subscription];
        const connector = vi.fn(() => {
            const socket = sockets[connector.mock.calls.length - 1];
            if (!socket) throw new Error("unexpected socket request");
            return socket;
        });
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector });

        const first = client.request("first", {});
        const second = client.request("second", {});
        requestOne.connect();
        requestTwo.connect();
        requestOne.receive(JSON.stringify({ id: writtenRequest(requestOne).id, result: {} }) + "\n");
        requestTwo.receive(JSON.stringify({ id: writtenRequest(requestTwo).id, result: {} }) + "\n");
        await Promise.all([first, second]);

        const events: HerdrSubscriptionEvent[] = [];
        const subscribing = client.subscribe(
            { subscriptions: [{ type: "pane.agent_status_changed" }] },
            (event) => events.push(event),
        );
        expect(connector).toHaveBeenCalledTimes(3);
        subscription.connect();
        const subscribeRequest = writtenRequest(subscription);
        subscription.receive(JSON.stringify({
            id: subscribeRequest.id,
            result: { type: "subscription_started" },
        }) + "\n");
        const handle = await subscribing;

        subscription.receive(JSON.stringify({
            event: "pane.agent_status_changed",
            data: { pane_id: "pane-1", agent_status: "working" },
        }) + "\n");
        expect(events).toEqual([{
            event: "pane.agent_status_changed",
            data: { pane_id: "pane-1", agent_status: "working" },
        }]);
        expect(subscription.closed).toBe(false);

        handle.unsubscribe();
        await expect(handle.closed).resolves.toBeNull();
        expect(subscription.closed).toBe(true);
    });

    it("reports an unexpected subscription close after acknowledgement without reconnecting", async () => {
        const socket = new FakeSocket();
        const connector = vi.fn(() => socket);
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector });
        const subscribing = client.subscribe({ subscriptions: [] }, vi.fn());
        socket.connect();
        socket.receive(JSON.stringify({
            id: writtenRequest(socket).id,
            result: { type: "subscription_started" },
        }) + "\n");
        const handle = await subscribing;

        socket.closeFromServer();

        const reason = await handle.closed;
        expect(reason).toBeInstanceOf(Error);
        expect(reason?.message).toContain("socket closed");
        expect(connector).toHaveBeenCalledOnce();
    });

    it("reports a subscription socket error after acknowledgement and closes it", async () => {
        const socket = new FakeSocket();
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector: () => socket });
        const subscribing = client.subscribe({ subscriptions: [] }, vi.fn());
        socket.connect();
        socket.receive(JSON.stringify({
            id: writtenRequest(socket).id,
            result: { type: "subscription_started" },
        }) + "\n");
        const handle = await subscribing;

        socket.fail(new Error("pipe failed"));

        await expect(handle.closed).resolves.toEqual(new Error("pipe failed"));
        expect(socket.closed).toBe(true);
    });

    it("rejects and closes ordinary request sockets on error, close, and dispose", async () => {
        const erroredSocket = new FakeSocket();
        const closedSocket = new FakeSocket();
        const disposedSocket = new FakeSocket();
        const sockets = [erroredSocket, closedSocket, disposedSocket];
        const connector = vi.fn(() => {
            const socket = sockets[connector.mock.calls.length - 1];
            if (!socket) throw new Error("unexpected socket request");
            return socket;
        });
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector });

        const errored = client.request("first", {});
        erroredSocket.fail(new Error("pipe unavailable"));
        await expect(errored).rejects.toThrow("pipe unavailable");
        expect(erroredSocket.closed).toBe(true);

        const closed = client.request("second", {});
        closedSocket.closeFromServer();
        await expect(closed).rejects.toThrow("socket closed");

        const disposed = client.request("third", {});
        client.dispose();
        await expect(disposed).rejects.toThrow("disposed");
        expect(disposedSocket.closed).toBe(true);
    });

    it("rejects guessed subscription_event wrapper lines", async () => {
        const socket = new FakeSocket();
        const client = new HerdrRpcClient({ socketPath: "\\\\.\\pipe\\herdr", connector: () => socket });
        const subscribing = client.subscribe({ subscriptions: [] }, vi.fn());
        socket.connect();
        socket.receive(JSON.stringify({
            id: writtenRequest(socket).id,
            result: { type: "subscription_started" },
        }) + "\n");
        const handle = await subscribing;

        socket.receive(JSON.stringify({
            type: "subscription_event",
            subscription_event: { event: "pane.scroll_changed", data: {} },
        }) + "\n");

        const reason = await handle.closed;
        expect(reason).toBeInstanceOf(Error);
        expect(reason?.message).toContain("subscription event is malformed");
        expect(socket.closed).toBe(true);
    });
});
