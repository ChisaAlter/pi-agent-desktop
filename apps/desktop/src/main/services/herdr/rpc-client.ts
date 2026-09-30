import { createConnection } from "node:net";
import { StringDecoder } from "node:string_decoder";

export interface HerdrRpcSocket {
    write(data: string): boolean;
    end(): void;
    destroy(error?: Error): void;
    on(event: "connect", listener: () => void): this;
    on(event: "data", listener: (data: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
}

export type HerdrSocketConnector = (socketPath: string) => HerdrRpcSocket;

export interface HerdrSubscriptionEvent {
    event: string;
    data: unknown;
}

export type HerdrSubscriptionListener = (event: HerdrSubscriptionEvent) => void;

export interface HerdrSubscriptionHandle {
    unsubscribe(): void;
    /** Resolves with null for an intentional close, or the unexpected close reason. */
    closed: Promise<Error | null>;
}

export interface HerdrRpcClientOptions {
    /** Connectable endpoint. On Windows this must be an NPFS path such as `\\.\pipe\...`. */
    socketPath: string;
    connector?: HerdrSocketConnector;
    defaultTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class HerdrRpcRequestError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`Herdr RPC error ${code}: ${message}`);
        this.name = "HerdrRpcRequestError";
        this.code = code;
    }
}

export class HerdrRpcTimeoutError extends Error {
    readonly method: string;
    readonly timeoutMs: number;

    constructor(method: string, timeoutMs: number) {
        super(`Herdr RPC request ${method} timed out after ${timeoutMs}ms`);
        this.name = "HerdrRpcTimeoutError";
        this.method = method;
        this.timeoutMs = timeoutMs;
    }
}

export class HerdrRpcProtocolError extends Error {
    constructor(message: string) {
        super(`Herdr RPC protocol error: ${message}`);
        this.name = "HerdrRpcProtocolError";
    }
}

export class HerdrRpcClient {
    private readonly socketPath: string;
    private readonly connector: HerdrSocketConnector;
    private readonly defaultTimeoutMs: number;
    private readonly activeOperations = new Set<(reason: Error, intentional: boolean) => void>();
    private disposed = false;
    private nextRequestId = 1;

    constructor(options: HerdrRpcClientOptions) {
        if (process.platform === "win32" && !options.socketPath.startsWith("\\\\.\\pipe\\")) {
            throw new Error("Herdr RPC on Windows requires an NPFS socket path");
        }
        this.socketPath = options.socketPath;
        this.connector = options.connector ?? ((socketPath) => createConnection(socketPath));
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }

    request<T>(method: string, params: unknown = {}, timeoutMs = this.defaultTimeoutMs): Promise<T> {
        this.assertRequestAllowed(timeoutMs);
        if (this.disposed) return Promise.reject(new Error("Herdr RPC client is disposed"));

        return new Promise<T>((resolve, reject) => {
            const id = this.nextId();
            let socket: HerdrRpcSocket;
            try {
                socket = this.connector(this.socketPath);
            } catch (cause) {
                reject(toError(cause, "Herdr RPC socket connection failed"));
                return;
            }

            const decoder = new StringDecoder("utf8");
            let buffer = "";
            let settled = false;
            const timeout = setTimeout(() => {
                finish(undefined, new HerdrRpcTimeoutError(method, timeoutMs));
            }, timeoutMs);
            const cancel = (reason: Error): void => finish(undefined, reason);
            this.activeOperations.add(cancel);

            const finish = (result?: T, error?: Error): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                this.activeOperations.delete(cancel);
                if (error) {
                    socket.destroy();
                    reject(error);
                    return;
                }
                socket.end();
                resolve(result as T);
            };

            socket.on("connect", () => {
                if (settled) return;
                try {
                    socket.write(`${JSON.stringify({ id, method, params })}\n`);
                } catch (cause) {
                    finish(undefined, toError(cause, "Herdr RPC socket write failed"));
                }
            });
            socket.on("data", (data) => {
                if (settled) return;
                buffer += decoder.write(data);
                const newlineIndex = buffer.indexOf("\n");
                if (newlineIndex < 0) return;
                const line = buffer.slice(0, newlineIndex).trim();
                if (!line) {
                    finish(undefined, new HerdrRpcProtocolError("response line is empty"));
                    return;
                }
                try {
                    finish(parseResponse<T>(line, id));
                } catch (cause) {
                    finish(undefined, toProtocolError(cause));
                }
            });
            socket.on("error", (error) => finish(undefined, error));
            socket.on("close", () => {
                finish(undefined, new Error("Herdr RPC socket closed before a response"));
            });
        });
    }

    subscribe(
        params: unknown,
        listener: HerdrSubscriptionListener,
        timeoutMs = this.defaultTimeoutMs,
    ): Promise<HerdrSubscriptionHandle> {
        this.assertRequestAllowed(timeoutMs);
        if (this.disposed) return Promise.reject(new Error("Herdr RPC client is disposed"));

        return new Promise<HerdrSubscriptionHandle>((resolve, reject) => {
            const id = this.nextId();
            let socket: HerdrRpcSocket;
            try {
                socket = this.connector(this.socketPath);
            } catch (cause) {
                reject(toError(cause, "Herdr RPC socket connection failed"));
                return;
            }

            const decoder = new StringDecoder("utf8");
            let buffer = "";
            let acknowledged = false;
            let finished = false;
            let resolveClosed: (reason: Error | null) => void = () => undefined;
            const closed = new Promise<Error | null>((closedResolve) => {
                resolveClosed = closedResolve;
            });
            const timeout = setTimeout(() => {
                finish(new HerdrRpcTimeoutError("events.subscribe", timeoutMs), false);
            }, timeoutMs);
            const cancel = (reason: Error, intentional: boolean): void => finish(reason, intentional);
            this.activeOperations.add(cancel);

            const finish = (reason: Error | null, intentional: boolean): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                this.activeOperations.delete(cancel);
                if (intentional) socket.end();
                else socket.destroy();
                if (!acknowledged) {
                    reject(reason ?? new Error("Herdr RPC subscription closed before acknowledgement"));
                    return;
                }
                resolveClosed(intentional ? null : reason ?? new Error("Herdr RPC subscription socket closed"));
            };

            const handleLine = (line: string): void => {
                if (!acknowledged) {
                    parseSubscriptionAcknowledgement(line, id);
                    acknowledged = true;
                    clearTimeout(timeout);
                    resolve({
                        unsubscribe: () => finish(null, true),
                        closed,
                    });
                    return;
                }
                const event = parseSubscriptionEvent(line);
                listener(event);
            };

            socket.on("connect", () => {
                if (finished) return;
                try {
                    socket.write(`${JSON.stringify({ id, method: "events.subscribe", params })}\n`);
                } catch (cause) {
                    finish(toError(cause, "Herdr RPC socket write failed"), false);
                }
            });
            socket.on("data", (data) => {
                if (finished) return;
                buffer += decoder.write(data);
                while (!finished) {
                    const newlineIndex = buffer.indexOf("\n");
                    if (newlineIndex < 0) return;
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!line) continue;
                    try {
                        handleLine(line);
                    } catch (cause) {
                        finish(toProtocolError(cause), false);
                    }
                }
            });
            socket.on("error", (error) => finish(error, false));
            socket.on("close", () => {
                finish(new Error("Herdr RPC subscription socket closed"), false);
            });
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const reason = new Error("Herdr RPC client is disposed");
        for (const cancel of [...this.activeOperations]) cancel(reason, true);
        this.activeOperations.clear();
    }

    private nextId(): string {
        return `pi-desktop-${this.nextRequestId++}`;
    }

    private assertRequestAllowed(timeoutMs: number): void {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError("Herdr RPC timeout must be greater than zero");
        }
    }
}

function parseResponse<T>(line: string, expectedId: string): T {
    const response = parseObjectLine(line);
    if (response.id !== expectedId) {
        throw new HerdrRpcProtocolError("response id does not match request");
    }
    if ("error" in response) throw parseRpcError(response.error);
    if (!("result" in response)) throw new HerdrRpcProtocolError("response is missing result");
    return response.result as T;
}

function parseSubscriptionAcknowledgement(line: string, expectedId: string): void {
    const response = parseObjectLine(line);
    if (response.id !== expectedId) {
        throw new HerdrRpcProtocolError("subscription acknowledgement id does not match request");
    }
    if ("error" in response) throw parseRpcError(response.error);
    if (!isRecord(response.result) || response.result.type !== "subscription_started") {
        throw new HerdrRpcProtocolError("subscription acknowledgement is malformed");
    }
}

function parseSubscriptionEvent(line: string): HerdrSubscriptionEvent {
    const value = parseObjectLine(line);
    if (typeof value.event !== "string" || !("data" in value) || "id" in value) {
        throw new HerdrRpcProtocolError("subscription event is malformed");
    }
    return { event: value.event, data: value.data };
}

function parseObjectLine(line: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line) as unknown;
    } catch (cause) {
        throw new HerdrRpcProtocolError(`invalid JSON: ${toError(cause, "parse failed").message}`);
    }
    if (!isRecord(parsed)) throw new HerdrRpcProtocolError("line must be a JSON object");
    return parsed;
}

function parseRpcError(value: unknown): HerdrRpcRequestError {
    if (!isRecord(value)) throw new HerdrRpcProtocolError("error response is malformed");
    const code = typeof value.code === "string" ? value.code : "unknown";
    const message = typeof value.message === "string" ? value.message : "unknown error";
    return new HerdrRpcRequestError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProtocolError(cause: unknown): Error {
    if (cause instanceof HerdrRpcRequestError || cause instanceof HerdrRpcProtocolError) return cause;
    return new HerdrRpcProtocolError(toError(cause, "invalid response").message);
}

function toError(cause: unknown, fallback: string): Error {
    if (cause instanceof Error) return cause;
    return new Error(typeof cause === "string" ? cause : fallback);
}
