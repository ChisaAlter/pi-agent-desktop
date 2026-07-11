import { describe, expect, it } from "vitest";
import { redactLogValue } from "../log-redaction";

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
});
