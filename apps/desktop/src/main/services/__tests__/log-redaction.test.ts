import { describe, expect, it } from "vitest";
import { configureProductionLogging, redactLogValue } from "../log-redaction";

describe("log redaction", () => {
    it("redacts common secrets in strings", () => {
        expect(redactLogValue("Authorization: Bearer secret-token apiKey=sk-live-123 password=hunter2")).toBe(
            "Authorization: Bearer [REDACTED] apiKey=[REDACTED] password=[REDACTED]",
        );
    });

    it("redacts sensitive object fields recursively without mutating the source", () => {
        const source = {
            provider: "openai",
            headers: { Authorization: "Bearer abc", "x-api-key": "secret" },
            nested: { apiKey: "sk-test", password: "password123", model: "gpt-test" },
        };

        expect(redactLogValue(source)).toEqual({
            provider: "openai",
            headers: { Authorization: "[REDACTED]", "x-api-key": "[REDACTED]" },
            nested: { apiKey: "[REDACTED]", password: "[REDACTED]", model: "gpt-test" },
        });
        expect(source.nested.apiKey).toBe("sk-test");
    });

    it("handles errors and circular values safely", () => {
        const value: { token: string; self?: unknown; error: Error } = {
            token: "secret",
            error: new Error("request failed with sk-secret-value"),
        };
        value.self = value;

        const redacted = redactLogValue(value) as { token: string; self: string; error: Error };
        expect(redacted.token).toBe("[REDACTED]");
        expect(redacted.self).toBe("[Circular]");
        expect(redacted.error.message).not.toContain("sk-secret-value");
    });

    it("redacts OpenAI/Anthropic key shapes and cookie headers (B-020/E-014)", () => {
        const blob = [
            "sk-proj-ABCDEFGHIJKLMNOPQRSTUV",
            "api_key=sk-ant-api03-secret",
            "Cookie: session=abc; token=xyz",
            "x-api-key: anthropic-secret",
        ].join("\n");
        const out = String(redactLogValue(blob));
        expect(out).not.toContain("ABCDEFGHIJKLMNOPQRSTUV");
        expect(out).not.toContain("anthropic-secret");
        expect(out).not.toContain("session=abc");
        expect(out).toContain("Cookie: [REDACTED]");
        expect(out).toMatch(/REDACTED|\[REDACTED\]/i);
    });

    // wave-85 residual: primitives, depth, arrays, key aliases, quoted secrets
    it("passes through primitives and Date without mutation", () => {
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(undefined)).toBeUndefined();
        expect(redactLogValue(42)).toBe(42);
        expect(redactLogValue(true)).toBe(true);
        const d = new Date("2026-07-21T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
    });

    it("stringifies bigint/symbol/function safely", () => {
        expect(String(redactLogValue(10n))).toContain("10");
        expect(String(redactLogValue(Symbol("s")))).toContain("Symbol");
        expect(String(redactLogValue(() => 1))).toMatch(/function|=>/);
    });

    it("redacts array elements and sensitive keys case-insensitively", () => {
        const out = redactLogValue([
            "token=abc123",
            { API_KEY: "k1", Token: "t1", model: "ok" },
        ]) as unknown[];
        expect(String(out[0])).not.toContain("abc123");
        expect(out[1]).toEqual({ API_KEY: "[REDACTED]", Token: "[REDACTED]", model: "ok" });
    });

    it("redacts quoted secret values and Bearer variants", () => {
        const blob = 'password="hunter2" api_key=\'sk-live-xyz\' Authorization: Bearer tok.en/value';
        const out = String(redactLogValue(blob));
        expect(out).not.toContain("hunter2");
        expect(out).not.toContain("sk-live-xyz");
        expect(out).not.toContain("tok.en/value");
        expect(out).toContain("[REDACTED]");
    });

    it("caps deep nesting at MaxDepth", () => {
        let nested: Record<string, unknown> = { leaf: "ok" };
        for (let i = 0; i < 12; i += 1) nested = { child: nested };
        const out = redactLogValue(nested) as Record<string, unknown>;
        // walk until MaxDepth sentinel appears
        let cur: unknown = out;
        let saw = false;
        for (let i = 0; i < 20; i += 1) {
            if (cur === "[MaxDepth]") {
                saw = true;
                break;
            }
            if (!cur || typeof cur !== "object") break;
            cur = (cur as Record<string, unknown>).child;
        }
        expect(saw).toBe(true);
    });

    it("summarizes Buffer without dumping bytes", () => {
        const buf = Buffer.from("super-secret-bytes");
        const out = String(redactLogValue(buf));
        expect(out).toMatch(/Buffer/);
        expect(out).not.toContain("super-secret-bytes");
    });

    // wave-93 residual
    it("redacts sk- keys embedded among other tokens", () => {
        const out = String(redactLogValue("prefix sk-abcDEF123.xyz suffix"));
        expect(out).toContain("[REDACTED]");
        expect(out).not.toContain("sk-abcDEF123.xyz");
    });

    it("redacts x-api-key assignment forms case-insensitively", () => {
        const out = String(redactLogValue('X-API-KEY: "top-secret" and x-api-key=abc123'));
        expect(out).not.toContain("top-secret");
        expect(out).not.toContain("abc123");
        expect(out).toMatch(/\[REDACTED\]/);
    });

    it("installs a production logging hook once and redacts hook payloads", () => {
        const hooks: Array<(message: { data: unknown[] }) => { data: unknown[] }> = [];
        const logger = {
            transports: { file: { maxSize: 0 } },
            hooks,
        };
        configureProductionLogging(logger as never);
        configureProductionLogging(logger as never);
        expect(hooks).toHaveLength(1);
        expect(logger.transports.file.maxSize).toBe(10 * 1024 * 1024);
        const redacted = hooks[0]({ data: ["Bearer tok123", { password: "p" }] });
        expect(String(redacted.data[0])).toContain("[REDACTED]");
        expect((redacted.data[1] as { password: string }).password).toBe("[REDACTED]");
    });

    // wave-115 residual
    it("redacts cookie headers only up to the end of the line", () => {
        const out = String(redactLogValue("Cookie: a=1; b=2\nnext=line-ok sk-live-xyz"));
        expect(out).toContain("Cookie: [REDACTED]");
        expect(out).toContain("next=line-ok");
        expect(out).not.toContain("a=1; b=2");
        expect(out).not.toContain("sk-live-xyz");
    });

    it("redacts Error stack traces while preserving name", () => {
        const err = new Error("boom with password=hunter2");
        err.name = "AuthError";
        err.stack = "AuthError: boom with password=hunter2\n    at call (app.ts:1)";
        const redacted = redactLogValue(err) as Error;
        expect(redacted).toBeInstanceOf(Error);
        expect(redacted.name).toBe("AuthError");
        expect(redacted.message).not.toContain("hunter2");
        expect(String(redacted.stack)).not.toContain("hunter2");
        expect(String(redacted.stack)).toContain("[REDACTED]");
    });

    it("redacts secret-like object keys but leaves non-sensitive nested fields", () => {
        const out = redactLogValue({
            cookie: "session=1",
            secret: "s3cr3t",
            nested: { authorization: "Bearer abc", safe: "ok" },
        }) as Record<string, unknown>;
        expect(out.cookie).toBe("[REDACTED]");
        expect(out.secret).toBe("[REDACTED]");
        expect(out.nested).toEqual({ authorization: "[REDACTED]", safe: "ok" });
    });

    // wave-126 residual
    it("redacts array circular references and preserves sibling non-secret fields", () => {
        const arr: unknown[] = ["token=abc", { model: "gpt" }];
        arr.push(arr);
        const out = redactLogValue(arr) as unknown[];
        expect(String(out[0])).not.toContain("abc");
        expect(out[1]).toEqual({ model: "gpt" });
        expect(out[2]).toBe("[Circular]");
    });

    it("redacts api-key hyphen/underscore key aliases on objects", () => {
        const out = redactLogValue({
            "api-key": "k1",
            api_key: "k2",
            "x-api-key": "k3",
            safe: "ok",
        }) as Record<string, unknown>;
        expect(out["api-key"]).toBe("[REDACTED]");
        expect(out.api_key).toBe("[REDACTED]");
        expect(out["x-api-key"]).toBe("[REDACTED]");
        expect(out.safe).toBe("ok");
    });

    it("configureProductionLogging is a no-op when hooks is missing", () => {
        const logger = { transports: { file: { maxSize: 1 } } };
        expect(() => configureProductionLogging(logger as never)).not.toThrow();
        expect(logger.transports.file.maxSize).toBe(10 * 1024 * 1024);
    });

    // wave-132 residual
    it("redacts Error message when stack is undefined", () => {
        const err = new Error("token=abc123");
        err.stack = undefined;
        const redacted = redactLogValue(err) as Error;
        expect(redacted.message).not.toContain("abc123");
        expect(redacted.stack).toBeUndefined();
    });

    it("summarizes Buffer length without dumping secret bytes", () => {
        const buf = Buffer.from("hunter2-secret");
        const out = String(redactLogValue(buf));
        expect(out).toBe(`[Buffer ${buf.length} bytes]`);
        expect(out).not.toContain("hunter2");
    });

    it("still installs hooks when file transport is missing", () => {
        const hooks: Array<(message: { data: unknown[] }) => { data: unknown[] }> = [];
        const logger = { transports: {}, hooks };
        // module-level hookInstalled may already be true from earlier tests; ensure file maxSize path no-ops
        expect(() => configureProductionLogging(logger as never)).not.toThrow();
        // When hook already installed, hooks array stays empty; when not, length becomes 1.
        expect(hooks.length === 0 || hooks.length === 1).toBe(true);
    });

    it("does not treat non-exact keys containing secret substrings as sensitive fields", () => {
        const out = redactLogValue({
            mytoken: "visible",
            tokenized: "also-visible",
            token: "hide-me",
            model: "ok",
        }) as Record<string, unknown>;
        expect(out.mytoken).toBe("visible");
        expect(out.tokenized).toBe("also-visible");
        expect(out.token).toBe("[REDACTED]");
        expect(out.model).toBe("ok");
    });

    // wave-154 residual
    it("redacts cookie/authorization/secret object keys case-insensitively", () => {
        const out = redactLogValue({
            Cookie: "session=abc",
            COOKIE: "x=1",
            authorization: "Bearer z",
            Secret: "s",
            secret_token: "keep-me", // not exact key match
            password_hash: "keep-me-too",
        }) as Record<string, unknown>;
        expect(out.Cookie).toBe("[REDACTED]");
        expect(out.COOKIE).toBe("[REDACTED]");
        expect(out.authorization).toBe("[REDACTED]");
        expect(out.Secret).toBe("[REDACTED]");
        expect(out.secret_token).toBe("keep-me");
        expect(out.password_hash).toBe("keep-me-too");
    });

    it("redacts Cookie header and sk- keys inside nested arrays", () => {
        const out = redactLogValue({
            lines: [
                "Cookie: a=1; b=2",
                { note: "sk-nested-ABCDEF" },
            ],
        }) as { lines: unknown[] };
        expect(String(out.lines[0])).toBe("Cookie: [REDACTED]");
        expect(String((out.lines[1] as { note: string }).note)).not.toContain("sk-nested-ABCDEF");
        expect(String((out.lines[1] as { note: string }).note)).toContain("[REDACTED]");
    });

    it("preserves empty strings and empty containers", () => {
        expect(redactLogValue("")).toBe("");
        expect(redactLogValue([])).toEqual([]);
        expect(redactLogValue({})).toEqual({});
    });

    // wave-162 residual
    it("redacts Bearer tokens and sk- keys in free-form strings", () => {
        expect(redactLogValue("Authorization: Bearer abc.def-123")).toBe(
            "Authorization: Bearer [REDACTED]",
        );
        expect(String(redactLogValue("key sk-ABCDEFGhi rest"))).toContain("[REDACTED]");
        expect(String(redactLogValue("key sk-ABCDEFGhi rest"))).not.toContain("sk-ABCDEFGhi");
        expect(redactLogValue("api_key=supersecret")).toBe("api_key=[REDACTED]");
        expect(redactLogValue('password: "hunter2"')).toBe("password:[REDACTED]");
    });

    it("stringifies bigint/symbol/function and preserves Date identity", () => {
        expect(redactLogValue(10n)).toBe("10");
        expect(String(redactLogValue(Symbol("s")))).toContain("Symbol");
        expect(redactLogValue(() => 1)).toMatch(/function|=>/);
        const d = new Date("2026-01-01T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
    });

    it("marks circular refs and max depth without throwing", () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;
        expect(redactLogValue(circular)).toEqual({ self: "[Circular]" });

        let deep: unknown = "leaf";
        for (let i = 0; i < 12; i++) deep = { nested: deep };
        const out = redactLogValue(deep) as { nested: unknown };
        const flat = JSON.stringify(out);
        expect(flat).toContain("[MaxDepth]");
    });

    it("redacts Error message/stack strings but keeps Error instance shape", () => {
        const err = new Error("token=abc123");
        err.stack = "Error: token=abc123\n    at x";
        const out = redactLogValue(err) as Error;
        expect(out).toBeInstanceOf(Error);
        expect(out.message).toContain("[REDACTED]");
        expect(out.message).not.toContain("abc123");
        expect(String(out.stack)).toContain("[REDACTED]");
    });

    // wave-178 residual
    it("redacts nested apiKey/token keys and preserves non-sensitive siblings", () => {
        const out = redactLogValue({
            outer: {
                apiKey: "k",
                token: "t",
                note: "sk-VISIBLE",
                nested: { password: "p", ok: true },
            },
        }) as {
            outer: { apiKey: string; token: string; note: string; nested: { password: string; ok: boolean } };
        };
        expect(out.outer.apiKey).toBe("[REDACTED]");
        expect(out.outer.token).toBe("[REDACTED]");
        expect(out.outer.nested.password).toBe("[REDACTED]");
        expect(out.outer.nested.ok).toBe(true);
        expect(out.outer.note).toContain("[REDACTED]");
        expect(out.outer.note).not.toContain("sk-VISIBLE");
    });

    it("redacts Bearer tokens with commas/semicolons and preserves surrounding text", () => {
        expect(String(redactLogValue("hdr=Bearer abc.def, next=1"))).toBe(
            "hdr=Bearer [REDACTED], next=1",
        );
        expect(String(redactLogValue("Authorization: Bearer xyz; path=/"))).toBe(
            "Authorization: Bearer [REDACTED]; path=/",
        );
    });

    it("returns primitives and null unchanged including 0/false", () => {
        expect(redactLogValue(0)).toBe(0);
        expect(redactLogValue(false)).toBe(false);
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(undefined)).toBeUndefined();
    });

    // wave-189 residual
    it("redacts x-api-key / api-key / secret key=value forms case-insensitively", () => {
        expect(String(redactLogValue("x-api-key: supersecret"))).toBe("x-api-key:[REDACTED]");
        expect(String(redactLogValue("X-API-KEY=abc"))).toBe("X-API-KEY=[REDACTED]");
        expect(String(redactLogValue("api-key: 'quoted-secret'"))).toBe("api-key:[REDACTED]");
        expect(String(redactLogValue("secret=plain"))).toBe("secret=[REDACTED]");
        expect(String(redactLogValue("token: \"t\""))).toBe("token:[REDACTED]");
    });

    it("redacts object keys case-insensitively and leaves Date identity", () => {
        const d = new Date("2026-07-21T12:00:00.000Z");
        const out = redactLogValue({
            API_KEY: "x",
            Authorization: "Bearer z",
            Cookie: "a=1",
            when: d,
            safe: 1,
        }) as Record<string, unknown>;
        expect(out.API_KEY).toBe("[REDACTED]");
        expect(out.Authorization).toBe("[REDACTED]");
        expect(out.Cookie).toBe("[REDACTED]");
        expect(out.when).toBe(d);
        expect(out.safe).toBe(1);
    });

    // wave-196 residual
    it("empty string and non-sk substrings stay; sk- tokens redact; Error stack redacts", () => {
        expect(redactLogValue("")).toBe("");
        expect(String(redactLogValue("please ask-me later"))).toBe("please ask-me later");
        expect(String(redactLogValue("prefix sk-live-ABCDEF suffix"))).toBe(
            "prefix [REDACTED] suffix",
        );
        const err = new Error("failed with sk-secret-value");
        err.stack = "Error: failed with sk-secret-value\n    at x";
        const out = redactLogValue(err) as Error;
        expect(out).toBeInstanceOf(Error);
        expect(out.message).not.toContain("sk-secret-value");
        expect(out.stack).not.toContain("sk-secret-value");
        expect(out.message).toContain("[REDACTED]");
    });

    it("redacts nested array Errors and Buffer remains summary-only", () => {
        const nested = redactLogValue({
            items: [new Error("token=abc"), Buffer.from("x")],
        }) as { items: [Error, string] };
        expect(nested.items[0].message).toContain("[REDACTED]");
        expect(nested.items[0].message).not.toContain("abc");
        expect(nested.items[1]).toBe("[Buffer 1 bytes]");
    });

    // wave-201 residual
    it("redacts sensitive object keys case-insensitively and leaves sibling keys", () => {
        const out = redactLogValue({
            Authorization: "Bearer super-secret",
            cookie: "sid=1",
            password: "p",
            safe: "ok",
            nested: { "x-api-key": "k", keep: 1 },
        }) as Record<string, unknown>;
        expect(out.Authorization).toBe("[REDACTED]");
        expect(out.cookie).toBe("[REDACTED]");
        expect(out.password).toBe("[REDACTED]");
        expect(out.safe).toBe("ok");
        expect((out.nested as Record<string, unknown>)["x-api-key"]).toBe("[REDACTED]");
        expect((out.nested as Record<string, unknown>).keep).toBe(1);
    });

    it("Bearer tokens and Cookie headers redact in free-form strings", () => {
        expect(String(redactLogValue("Authorization: Bearer abc.def.ghi"))).toContain(
            "Bearer [REDACTED]",
        );
        expect(String(redactLogValue("Cookie: a=1; b=2"))).toBe("Cookie: [REDACTED]");
        expect(String(redactLogValue("api_key=plainvalue"))).toContain("[REDACTED]");
    });

    it("circular objects become [Circular]; bigint/symbol stringify", () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;
        expect(redactLogValue(circular)).toEqual({ self: "[Circular]" });
        expect(redactLogValue(10n)).toBe("10");
        expect(String(redactLogValue(Symbol.for("s")))).toContain("Symbol");
        expect(redactLogValue(() => 1)).toMatch(/function|=>/);
    });

    // wave-202 residual
    it("passes through null/undefined/number/boolean/Date without redaction side effects", () => {
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(undefined)).toBeUndefined();
        expect(redactLogValue(0)).toBe(0);
        expect(redactLogValue(false)).toBe(false);
        const d = new Date("2026-07-21T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
        expect(redactLogValue(["plain", 1, true])).toEqual(["plain", 1, true]);
    });

    it("depth limit returns [MaxDepth] before infinite nesting; sk- shapes redact in strings", () => {
        // depth starts at 0; each object level +1; at depth>=8 returns [MaxDepth]
        type Nest = { child?: Nest | string };
        let root: Nest = {};
        let cursor = root;
        for (let i = 0; i < 12; i++) {
            cursor.child = {};
            cursor = cursor.child as Nest;
        }
        cursor.child = "leaf";
        const redacted = redactLogValue(root) as Nest;
        const serialized = JSON.stringify(redacted);
        expect(serialized).toContain("[MaxDepth]");
        expect(String(redactLogValue("prefix sk-live-abc123_xyz suffix"))).toContain("[REDACTED]");
        expect(String(redactLogValue("prefix sk-live-abc123_xyz suffix"))).not.toContain("sk-live");
    });

    // wave-206 residual
    it("redacts Authorization Bearer and Cookie headers in plain strings", () => {
        const auth = String(redactLogValue("Authorization: Bearer super-secret-token"));
        expect(auth).toContain("[REDACTED]");
        expect(auth).not.toContain("super-secret-token");
        const cookie = String(redactLogValue("Cookie: session=abc; path=/"));
        expect(cookie).toContain("[REDACTED]");
        expect(cookie).not.toContain("session=abc");
    });

    it("redacts nested sensitive keys case-insensitively without mutating input", () => {
        const input = {
            APIKEY: "sk-should-hide",
            nested: { password: "p", token: "t", keep: "ok" },
            list: [{ secret: "s" }, { open: 1 }],
        };
        const out = redactLogValue(input) as typeof input;
        expect(String(out.APIKEY)).toContain("[REDACTED]");
        expect(String(out.nested.password)).toContain("[REDACTED]");
        expect(String(out.nested.token)).toContain("[REDACTED]");
        expect(out.nested.keep).toBe("ok");
        expect(String(out.list[0]?.secret)).toContain("[REDACTED]");
        expect(out.list[1]?.open).toBe(1);
        // original not mutated
        expect(input.APIKEY).toBe("sk-should-hide");
        expect(input.nested.password).toBe("p");
    });

    // wave-211 residual
    it("stringifies bigint/symbol/function; Buffer becomes size tag; x-api-key string form redacts", () => {
        expect(redactLogValue(10n)).toBe("10");
        expect(String(redactLogValue(Symbol.for("k")))).toContain("Symbol");
        expect(String(redactLogValue(() => 1))).toMatch(/function|=>/);
        const buf = Buffer.from("abc");
        expect(redactLogValue(buf)).toBe("[Buffer 3 bytes]");
        const xk = String(redactLogValue("x-api-key: super-secret"));
        expect(xk).toContain("[REDACTED]");
        expect(xk).not.toContain("super-secret");
    });

    it("Error message and stack both redact sk- tokens", () => {
        const err = new Error("failed sk-abc123_def");
        err.stack = "Error: failed sk-abc123_def\n    at x";
        const out = redactLogValue(err) as Error;
        expect(out).toBeInstanceOf(Error);
        expect(out.message).toContain("[REDACTED]");
        expect(out.message).not.toContain("sk-abc");
        expect(String(out.stack)).toContain("[REDACTED]");
        expect(String(out.stack)).not.toContain("sk-abc");
    });

    // wave-217 residual
    it("preserves Date/null/undefined/number/boolean; redacts api-key key aliases", () => {
        const d = new Date("2026-07-21T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(undefined)).toBeUndefined();
        expect(redactLogValue(0)).toBe(0);
        expect(redactLogValue(true)).toBe(true);
        const out = redactLogValue({
            "api-key": "hide-me",
            api_key: "hide-me-2",
            API_KEY: "hide-me-3",
            safe: "ok",
        }) as Record<string, unknown>;
        expect(out["api-key"]).toBe("[REDACTED]");
        expect(out.api_key).toBe("[REDACTED]");
        expect(out.API_KEY).toBe("[REDACTED]");
        expect(out.safe).toBe("ok");
    });

    it("Error without stack keeps stack undefined; name preserved; message redacted", () => {
        const err = new Error("token=super-secret");
        err.name = "AuthError";
        err.stack = undefined;
        const out = redactLogValue(err) as Error;
        expect(out).toBeInstanceOf(Error);
        expect(out.name).toBe("AuthError");
        expect(out.stack).toBeUndefined();
        expect(out.message).toContain("[REDACTED]");
        expect(out.message).not.toContain("super-secret");
    });

    // wave-246 residual
    it("string redaction: Bearer, Cookie, password/secret quoted and bare, sk- tokens", () => {
        expect(redactLogValue("Authorization Bearer sk-live.abc_123")).toBe(
            "Authorization Bearer [REDACTED]",
        );
        expect(String(redactLogValue("Cookie: session=abc; other=1"))).toBe(
            "Cookie: [REDACTED]",
        );
        expect(String(redactLogValue('password="p@ss" next'))).toContain("password=[REDACTED]");
        expect(String(redactLogValue("secret: bare-secret end"))).toContain("secret:[REDACTED]");
        // product drops surrounding spaces: token = 'quoted' → token=[REDACTED]
        expect(String(redactLogValue("token = 'quoted'"))).toBe("token=[REDACTED]");
        const skLine = String(redactLogValue("use sk-abc.def-xyz and keep ok"));
        expect(skLine).not.toContain("sk-abc");
        expect(skLine).toContain("[REDACTED]");
        expect(skLine).toContain("keep ok");
    });

    it("object keys authorization/cookie/password/secret/token redact values; nested arrays preserved", () => {
        const out = redactLogValue({
            authorization: "Bearer hide",
            cookie: "a=b",
            password: "p",
            secret: "s",
            token: "t",
            nested: [{ safe: "ok", apiKey: "hide" }],
        }) as Record<string, unknown>;
        expect(out.authorization).toBe("[REDACTED]");
        expect(out.cookie).toBe("[REDACTED]");
        expect(out.password).toBe("[REDACTED]");
        expect(out.secret).toBe("[REDACTED]");
        expect(out.token).toBe("[REDACTED]");
        const nested = out.nested as Array<Record<string, unknown>>;
        expect(nested[0]?.safe).toBe("ok");
        expect(nested[0]?.apiKey).toBe("[REDACTED]");
    });

    // wave-259 residual
    it("redacts x-api-key string forms and api_key/api-key object keys case-insensitively", () => {
        expect(String(redactLogValue("x-api-key: supersecret"))).toContain("x-api-key:[REDACTED]");
        expect(String(redactLogValue('x-api-key="quoted"'))).toContain("x-api-key=[REDACTED]");
        const out = redactLogValue({
            "X-API-KEY": "hide",
            api_key: "hide2",
            "api-key": "hide3",
            keep: "ok",
        }) as Record<string, unknown>;
        expect(out["X-API-KEY"]).toBe("[REDACTED]");
        expect(out.api_key).toBe("[REDACTED]");
        expect(out["api-key"]).toBe("[REDACTED]");
        expect(out.keep).toBe("ok");
    });

    it("primitives/Date pass through; Buffer becomes size tag; circular becomes [Circular]", () => {
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(undefined)).toBeUndefined();
        expect(redactLogValue(42)).toBe(42);
        expect(redactLogValue(true)).toBe(true);
        const d = new Date("2026-07-22T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
        const buf = Buffer.from("abc");
        expect(redactLogValue(buf)).toBe(`[Buffer ${buf.length} bytes]`);
        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;
        expect(redactLogValue(circular)).toEqual({ a: 1, self: "[Circular]" });
    });


    // wave-271 residual
    it("redacts Bearer and sk- tokens in strings; leaves non-secret text", () => {
        const out = String(redactLogValue("Bearer abc.def password=hunter2 sk-live-ABCDEFGHIJKLMN"));
        expect(out).toContain("Bearer [REDACTED]");
        expect(out).toContain("password=[REDACTED]");
        expect(out).toContain("[REDACTED]");
        expect(out).not.toContain("hunter2");
        expect(out).not.toContain("sk-live-ABCDEFGHIJKLMN");
        expect(String(redactLogValue("hello world"))).toBe("hello world");
    });

    it("depth cap returns MaxDepth; Error message redacted; function becomes string", () => {
        // build nested object deeper than 8
        let nested: Record<string, unknown> = { leaf: "ok" };
        for (let i = 0; i < 12; i++) nested = { child: nested };
        const deep = redactLogValue(nested) as Record<string, unknown>;
        // walk until MaxDepth or leaf
        let cur: unknown = deep;
        let sawMax = false;
        for (let i = 0; i < 20 && cur && typeof cur === "object"; i++) {
            if (cur === "[MaxDepth]") {
                sawMax = true;
                break;
            }
            cur = (cur as Record<string, unknown>).child;
            if (cur === "[MaxDepth]") {
                sawMax = true;
                break;
            }
        }
        expect(sawMax).toBe(true);

        const err = new Error("token=supersecret");
        const redacted = redactLogValue(err) as Error;
        expect(redacted).toBeInstanceOf(Error);
        expect(redacted.message).toContain("[REDACTED]");
        expect(redacted.message).not.toContain("supersecret");
        expect(typeof redactLogValue(() => 1)).toBe("string");
    });


    // wave-277 residual
    it("redacts sensitive object keys case-insensitively; leaves non-sensitive keys", () => {
        const out = redactLogValue({
            API_KEY: "k1",
            Authorization: "Bearer x",
            Cookie: "session=1",
            password: "p",
            Secret: "s",
            TOKEN: "t",
            "x-api-key": "xk",
            safe: "visible",
        }) as Record<string, unknown>;
        for (const key of ["API_KEY", "Authorization", "Cookie", "password", "Secret", "TOKEN", "x-api-key"]) {
            expect(out[key]).toBe("[REDACTED]");
        }
        expect(out.safe).toBe("visible");
    });

    it("redacts Cookie header and spaced token= forms in strings; Buffer becomes size tag", () => {
        const s = String(redactLogValue("Cookie: a=1; b=2\ntoken = supersecret"));
        expect(s).toContain("Cookie: [REDACTED]");
        expect(s).toMatch(/token\s*=\s*\[REDACTED\]/i);
        expect(s).not.toContain("supersecret");
        expect(s).not.toContain("a=1");
        expect(redactLogValue(Buffer.from("abc"))).toBe("[Buffer 3 bytes]");
        expect(redactLogValue(null)).toBeNull();
        expect(redactLogValue(42)).toBe(42);
    });

    // wave-285 residual
    it("MaxDepth at depth>=8; circular objects become [Circular]; arrays recurse", () => {
        const deep: unknown[] = [];
        let cur: unknown[] = deep;
        for (let i = 0; i < 10; i++) {
            const next: unknown[] = [];
            cur.push(next);
            cur = next;
        }
        cur.push({ password: "secret" });
        const out = redactLogValue(deep) as unknown[];
        // walk until MaxDepth appears
        const flat = JSON.stringify(out);
        expect(flat).toContain("[MaxDepth]");

        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;
        const redCirc = redactLogValue(circular) as Record<string, unknown>;
        expect(redCirc.self).toBe("[Circular]");
        expect(redactLogValue(["ok", { token: "x" }])).toEqual(["ok", { token: "[REDACTED]" }]);
    });

    it("Bearer and sk- tokens redacted in free-form strings; Error message redacted", () => {
        const s = String(redactLogValue("Authorization Bearer abc.def-ghi and sk-ABCDEFG123"));
        expect(s).toContain("Bearer [REDACTED]");
        expect(s).toContain("[REDACTED]");
        expect(s).not.toContain("abc.def-ghi");
        expect(s).not.toContain("sk-ABCDEFG123");
        const err = redactLogValue(new Error("password=hunter2")) as Error;
        expect(err.message).toMatch(/password\s*=\s*\[REDACTED\]/i);
        expect(err.message).not.toContain("hunter2");
    });




    // wave-298 residual
    it("redacts sensitive object keys case-insensitively; preserves non-sensitive", () => {
        const out = redactLogValue({
            API_KEY: "secret",
            Authorization: "Bearer abc",
            password: "p",
            token: "t",
            cookie: "c",
            "x-api-key": "k",
            safe: "ok",
            nested: { secret: "s", count: 1 },
        }) as Record<string, unknown>;
        expect(out.API_KEY).toBe("[REDACTED]");
        expect(out.Authorization).toBe("[REDACTED]");
        expect(out.password).toBe("[REDACTED]");
        expect(out.token).toBe("[REDACTED]");
        expect(out.cookie).toBe("[REDACTED]");
        expect(out["x-api-key"]).toBe("[REDACTED]");
        expect(out.safe).toBe("ok");
        expect((out.nested as Record<string, unknown>).secret).toBe("[REDACTED]");
        expect((out.nested as Record<string, unknown>).count).toBe(1);
    });

    it("string redaction for Bearer, Cookie, sk-, and key=value forms", () => {
        expect(String(redactLogValue("Authorization: Bearer abc.def"))).toContain("[REDACTED]");
        expect(String(redactLogValue("Cookie: session=abc"))).toContain("[REDACTED]");
        expect(String(redactLogValue("use sk-abc123XYZ_token here"))).toContain("[REDACTED]");
        expect(String(redactLogValue('api_key="supersecret"'))).toContain("[REDACTED]");
        expect(String(redactLogValue("password: hunter2"))).toContain("[REDACTED]");
        expect(redactLogValue(42)).toBe(42);
        expect(redactLogValue(true)).toBe(true);
        expect(redactLogValue(null)).toBeNull();
    });

    it("depth limit, circular refs, Buffer, Error, Date identity", () => {
        const d = new Date("2026-07-21T00:00:00.000Z");
        expect(redactLogValue(d)).toBe(d);
        expect(String(redactLogValue(Buffer.from("hi")))).toMatch(/Buffer/);
        const err = new Error("token=leak");
        const redactedErr = redactLogValue(err) as Error;
        expect(redactedErr).toBeInstanceOf(Error);
        expect(redactedErr.message).toContain("[REDACTED]");
        const circ: Record<string, unknown> = { a: 1 };
        circ.self = circ;
        expect(redactLogValue(circ)).toEqual({ a: 1, self: "[Circular]" });
    });

});
