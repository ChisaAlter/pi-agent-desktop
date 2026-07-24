import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// audit round 3, Task 3.4: cover the localfile:// workspace-boundary enforcement.
// The protocol handler is captured by mocking electron.protocol.handle, then
// invoked directly with synthetic Request objects so we can assert on the
// Response status without spinning up a real Electron session.

let capturedHandler: ((request: { url: string }) => Response | Promise<Response>) | null = null;
const netFetchMock = vi.fn();

vi.mock("electron", () => ({
    protocol: {
        handle: (_scheme: string, handler: (request: { url: string }) => Response | Promise<Response>) => {
            capturedHandler = handler;
        },
    },
    net: {
        fetch: (href: string) => netFetchMock(href),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { registerLocalFileProtocol } from "../local-file-protocol";

function buildRequest(filePath: string): { url: string } {
    // Mirror the URL shape the handler expects: `localfile://` + the path,
    // URL-encoded so spaces / non-ASCII survive the round-trip through
    // decodeURIComponent inside the handler.
    return { url: `localfile://${encodeURIComponent(filePath)}` };
}

describe("localfile:// protocol workspace boundary", () => {
    let workspace: string;

    beforeEach(() => {
        capturedHandler = null;
        netFetchMock.mockReset();
        netFetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
        workspace = join(tmpdir(), `pi-localfile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(workspace, { recursive: true });
    });

    afterEach(() => {
        rmSync(workspace, { recursive: true, force: true });
    });

    it("returns 403 when no active workspace is set", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => null });
        const handler = capturedHandler!;
        const res = await handler(buildRequest(join(workspace, "file.txt")));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("returns 403 for paths outside the active workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const outside = join(tmpdir(), `pi-outside-${Date.now()}.txt`);
        const res = await handler(buildRequest(outside));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("delegates to net.fetch for paths inside the active workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "notes.md");
        writeFileSync(inside, "hello", "utf-8");

        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
        // net.fetch should have been called with a file:// URL for the path.
        const fetchedHref = netFetchMock.mock.calls[0][0] as string;
        expect(fetchedHref.startsWith("file://")).toBe(true);
    });

    it("returns 403 for sensitive files even when inside the workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const sensitive = join(workspace, ".env");
        writeFileSync(sensitive, "SECRET=value", "utf-8");

        const res = await handler(buildRequest(sensitive));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });


    // wave-86 residual: more sensitive names, sibling prefix, URL decode, fetch failure
    it("returns 403 for additional sensitive paths inside the workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [".ssh/id_rsa", "token.json", "secrets.pem", ".aws/credentials"]) {
            const target = join(workspace, ...rel.split("/"));
            // ensure parent dirs exist for nested sensitive paths
            mkdirSync(join(target, ".."), { recursive: true });
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
            netFetchMock.mockClear();
        }
    });

    it("returns 403 for workspace-prefix sibling paths", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const sibling = `${workspace}-evil`;
        mkdirSync(sibling, { recursive: true });
        const file = join(sibling, "notes.md");
        writeFileSync(file, "nope", "utf-8");
        const res = await handler(buildRequest(file));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
        rmSync(sibling, { recursive: true, force: true });
    });

    it("returns 404 when net.fetch fails for an allowed path", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "missing-but-allowed.md");
        writeFileSync(inside, "x", "utf-8");
        netFetchMock.mockRejectedValueOnce(new Error("ENOENT"));
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(404);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    it("handles percent-encoded workspace paths", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "hello world.md");
        writeFileSync(inside, "ok", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    // wave-97 residual: more sensitive patterns, nested protected dirs, empty workspace, path traversal
    it("returns 403 for .env variants and credential-like filenames", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [".env.local", ".env.production", "credentials.json", "api-token.yaml", "secret.toml"]) {
            const target = join(workspace, rel);
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
            netFetchMock.mockClear();
        }
    });

    it("returns 403 for nested .ssh / .aws directories", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [".ssh/config", ".aws/config", ".kube/config", ".docker/config.json"]) {
            const target = join(workspace, ...rel.split("/"));
            mkdirSync(join(target, ".."), { recursive: true });
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
            netFetchMock.mockClear();
        }
    });

    it("returns 403 for empty-string workspace path", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => "" });
        const handler = capturedHandler!;
        const inside = join(workspace, "ok.md");
        writeFileSync(inside, "x", "utf-8");
        // empty workspace fails isPathInside / boundary checks → Forbidden
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("returns 403 for lexical path traversal that escapes the workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const escaped = join(workspace, "..", "escape.txt");
        writeFileSync(escaped, "nope", "utf-8");
        const res = await handler(buildRequest(escaped));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("allows ordinary nested workspace files", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const nested = join(workspace, "docs", "guide.md");
        mkdirSync(join(workspace, "docs"), { recursive: true });
        writeFileSync(nested, "ok", "utf-8");
        const res = await handler(buildRequest(nested));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    // wave-127 residual
    it("returns 403 for sensitive .env and .ssh paths inside workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        writeFileSync(join(workspace, ".env"), "SECRET=1", "utf-8");
        mkdirSync(join(workspace, ".ssh"), { recursive: true });
        writeFileSync(join(workspace, ".ssh", "id_rsa"), "k", "utf-8");

        const envRes = await handler(buildRequest(join(workspace, ".env")));
        expect(envRes.status).toBe(403);
        const sshRes = await handler(buildRequest(join(workspace, ".ssh", "id_rsa")));
        expect(sshRes.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("returns 404 when net.fetch fails for an allowed path", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "missing-ok-name.md");
        writeFileSync(inside, "x", "utf-8");
        netFetchMock.mockRejectedValueOnce(new Error("ENOENT"));
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(404);
    });

    // wave-132 residual
    it("returns 403 for .npmrc/.pypirc/.netrc and credential cert leaves", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [".npmrc", ".pypirc", ".netrc", "client.p12", "trust.keystore", "app.jks"]) {
            const target = join(workspace, rel);
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
            netFetchMock.mockClear();
        }
    });

    it("returns 403 for nested .gnupg/.azure/.gcloud sensitive dirs", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [".gnupg/pubring.kbx", ".azure/accessTokens.json", ".gcloud/credentials"]) {
            const target = join(workspace, ...rel.split("/"));
            mkdirSync(join(target, ".."), { recursive: true });
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
            netFetchMock.mockClear();
        }
    });

    it("returns 404 body text when net.fetch rejects allowed ordinary file", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "ordinary-readme.md");
        writeFileSync(inside, "ok", "utf-8");
        netFetchMock.mockRejectedValueOnce(new Error("EPERM"));
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toMatch(/not found/i);
    });

    // wave-172 residual
    it("returns 403 when workspace is empty string and for sibling-prefix paths", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => "" });
        const handlerEmpty = capturedHandler!;
        const resEmpty = await handlerEmpty(buildRequest(join(workspace, "a.md")));
        expect(resEmpty.status).toBe(403);
        await expect(resEmpty.text()).resolves.toMatch(/no active workspace|Forbidden/i);

        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        // sibling path that only shares a string prefix with workspace
        const sibling = `${workspace}-sibling`;
        mkdirSync(sibling, { recursive: true });
        writeFileSync(join(sibling, "leak.md"), "x", "utf-8");
        const res = await handler(buildRequest(join(sibling, "leak.md")));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
        rmSync(sibling, { recursive: true, force: true });
    });

    it("serves unicode filenames inside workspace via encoded localfile URL", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "中文 文件.md");
        writeFileSync(inside, "ok", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    // wave-191 residual
    it("rejects null workspace and sensitive .env inside workspace without fetch", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => null });
        const nullHandler = capturedHandler!;
        const resNull = await nullHandler(buildRequest(join(workspace, "a.md")));
        expect(resNull.status).toBe(403);
        await expect(resNull.text()).resolves.toMatch(/no active workspace|Forbidden/i);
        expect(netFetchMock).not.toHaveBeenCalled();

        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const envPath = join(workspace, ".env");
        writeFileSync(envPath, "SECRET=1", "utf-8");
        const resEnv = await handler(buildRequest(envPath));
        expect(resEnv.status).toBe(403);
        await expect(resEnv.text()).resolves.toMatch(/Forbidden/i);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("rejects path traversal out of workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const outside = join(workspace, "..", "outside-leak.md");
        writeFileSync(outside, "x", "utf-8");
        const res = await handler(buildRequest(outside));
        expect(res.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
        try {
            rmSync(outside, { force: true });
        } catch {
            /* ignore */
        }
    });

    // wave-199 residual
    it("returns 403 for sensitive .ssh path inside workspace without net.fetch", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const sshPath = join(workspace, ".ssh", "id_rsa");
        const res = await handler(buildRequest(sshPath));
        expect(res.status).toBe(403);
        await expect(res.text()).resolves.toMatch(/Forbidden/i);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("returns 404 when net.fetch rejects for an allowed in-workspace file", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "missing.md");
        writeFileSync(inside, "present", "utf-8");
        netFetchMock.mockRejectedValueOnce(new Error("ENOENT"));
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toMatch(/File not found/i);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    it("decodes URL-encoded path segments for in-workspace files", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "my notes.md");
        writeFileSync(inside, "hello", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
        const href = String(netFetchMock.mock.calls[0][0]);
        expect(href.startsWith("file:")).toBe(true);
    });

    // wave-207 residual
    it("returns 403 for bare id_rsa / known_hosts / secrets.db leaves without net.fetch", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const leaf of ["id_rsa", "id_ed25519", "known_hosts", "authorized_keys", "secrets.db", "tokens.sqlite"]) {
            const target = join(workspace, leaf);
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, leaf).toBe(403);
            await expect(res.text()).resolves.toMatch(/Forbidden/i);
        }
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("returns 403 for nested .kube / .docker sensitive dirs", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        for (const rel of [join(".kube", "config"), join(".docker", "config.json")]) {
            const target = join(workspace, rel);
            mkdirSync(join(workspace, rel.split(/[\\/]/)[0]!), { recursive: true });
            writeFileSync(target, "x", "utf-8");
            const res = await handler(buildRequest(target));
            expect(res.status, rel).toBe(403);
            expect(netFetchMock).not.toHaveBeenCalled();
        }
    });

    it("allows ordinary nested source files and still uses file: URL", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const nestedDir = join(workspace, "src", "lib");
        mkdirSync(nestedDir, { recursive: true });
        const inside = join(nestedDir, "util.ts");
        writeFileSync(inside, "export {}", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
        expect(String(netFetchMock.mock.calls[0][0])).toMatch(/^file:/);
    });

    // wave-221 residual
    it("returns 403 for parent-directory escape and absolute outside workspace", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const outside = join(workspace, "..", "escape.txt");
        writeFileSync(outside, "x", "utf-8");
        const res1 = await handler(buildRequest(outside));
        expect(res1.status).toBe(403);
        const res2 = await handler(buildRequest(join(tmpdir(), "nope.txt")));
        expect(res2.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
    });

    it("decodes percent-encoded workspace paths and serves inside file", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const dir = join(workspace, "with space");
        mkdirSync(dir, { recursive: true });
        const inside = join(dir, "ok.ts");
        writeFileSync(inside, "export {}", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when net.fetch rejects after guards pass", async () => {
        netFetchMock.mockRejectedValueOnce(new Error("ENOENT"));
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const inside = join(workspace, "missing-but-allowed.ts");
        writeFileSync(inside, "x", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toMatch(/File not found/i);
    });

    // wave-249 residual
    it("returns 403 for .env.local / credentials / .ssh and empty workspace string", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const envLocal = join(workspace, ".env.local");
        writeFileSync(envLocal, "K=1", "utf-8");
        expect((await handler(buildRequest(envLocal))).status).toBe(403);

        const creds = join(workspace, "credentials");
        writeFileSync(creds, "x", "utf-8");
        expect((await handler(buildRequest(creds))).status).toBe(403);

        mkdirSync(join(workspace, ".ssh"), { recursive: true });
        const id = join(workspace, ".ssh", "id_rsa");
        writeFileSync(id, "key", "utf-8");
        expect((await handler(buildRequest(id))).status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();

        capturedHandler = null;
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => "" });
        const emptyWs = capturedHandler!;
        const resEmpty = await emptyWs(buildRequest(join(workspace, "notes.md")));
        // empty string is falsy → no active workspace
        expect(resEmpty.status).toBe(403);
    });

    it("serves nested unicode path; sibling prefix of workspace name is still outside", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const dir = join(workspace, "文档");
        mkdirSync(dir, { recursive: true });
        const inside = join(dir, "说明.md");
        writeFileSync(inside, "你好", "utf-8");
        const res = await handler(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);

        const sibling = `${workspace}-sibling`;
        mkdirSync(sibling, { recursive: true });
        const outside = join(sibling, "leak.txt");
        writeFileSync(outside, "nope", "utf-8");
        netFetchMock.mockClear();
        const denied = await handler(buildRequest(outside));
        expect(denied.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
        rmSync(sibling, { recursive: true, force: true });
    });

    // wave-263 residual
    it("returns 403 for .env and .git/config protected; 200 for ordinary nested file", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;

        const envPath = join(workspace, ".env");
        writeFileSync(envPath, "SECRET=1", "utf-8");
        expect((await handler(buildRequest(envPath))).status).toBe(403);

        const gitDir = join(workspace, ".git");
        mkdirSync(gitDir, { recursive: true });
        const gitConfig = join(gitDir, "config");
        writeFileSync(gitConfig, "[core]\n", "utf-8");
        expect((await handler(buildRequest(gitConfig))).status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();

        const nested = join(workspace, "src", "app.ts");
        mkdirSync(join(workspace, "src"), { recursive: true });
        writeFileSync(nested, "export {}", "utf-8");
        netFetchMock.mockClear();
        const ok = await handler(buildRequest(nested));
        expect(ok.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    it("null workspace always 403; re-register with workspace then serves", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => null });
        const denied = await capturedHandler!(buildRequest(join(workspace, "x.md")));
        expect(denied.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();

        capturedHandler = null;
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const inside = join(workspace, "ok.md");
        writeFileSync(inside, "ok", "utf-8");
        const res = await capturedHandler!(buildRequest(inside));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
    });

    // wave-283 residual
    it("missing file yields 404 from net.fetch rejection; outside sibling prefix 403", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const missing = join(workspace, "no-such-file.md");
        netFetchMock.mockRejectedValueOnce(new Error("ENOENT"));
        const notFound = await handler(buildRequest(missing));
        expect(notFound.status).toBe(404);
        expect(await notFound.text()).toMatch(/File not found/i);

        // sibling path that shares a string prefix must not pass isPathInside
        const sibling = workspace + "-evil";
        mkdirSync(sibling, { recursive: true });
        writeFileSync(join(sibling, "secret.txt"), "x", "utf-8");
        netFetchMock.mockClear();
        const denied = await handler(buildRequest(join(sibling, "secret.txt")));
        expect(denied.status).toBe(403);
        expect(netFetchMock).not.toHaveBeenCalled();
        rmSync(sibling, { recursive: true, force: true });
    });

    it("URL-encoded unicode workspace paths are served when inside boundary", async () => {
        registerLocalFileProtocol({ getCurrentWorkspacePath: () => workspace });
        const handler = capturedHandler!;
        const unicodeName = "你好 world.md";
        const file = join(workspace, unicodeName);
        writeFileSync(file, "unicode-body", "utf-8");
        netFetchMock.mockClear();
        netFetchMock.mockResolvedValue(new Response("unicode-body", { status: 200 }));
        const res = await handler(buildRequest(file));
        expect(res.status).toBe(200);
        expect(netFetchMock).toHaveBeenCalledTimes(1);
        const href = String(netFetchMock.mock.calls[0]?.[0] ?? "");
        expect(href.startsWith("file:")).toBe(true);
    });



});
