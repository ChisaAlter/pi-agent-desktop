import { describe, expect, it } from "vitest";
import { resolveNativeSessionPath } from "../session-path";

describe("resolveNativeSessionPath", () => {
    it("maps a desktop session id to one stable JSONL path", () => {
        expect(resolveNativeSessionPath("C:/user-data", "session-123"))
            .toBe("C:\\user-data\\pi-sessions\\session-123-b9c84322f82434cb.jsonl");
    });

    it.each(["", "../auth", "session/child", "session\\child", "session id", "会话"])(
        "rejects invalid desktop session id %j",
        (sessionId) => {
            expect(() => resolveNativeSessionPath("C:/user-data", sessionId))
                .toThrow("Invalid desktop session id");
        },
    );

    it.each(["session_123", "session.123", "SESSION-123"])(
        "allows the documented filename characters in %s",
        (sessionId) => {
            expect(resolveNativeSessionPath("C:/user-data", sessionId))
                .toMatch(/^C:\\user-data\\pi-sessions\\[a-z0-9._-]+-[a-f0-9]{16}\.jsonl$/);
        },
    );

    it("does not collide when Windows folds filename case", () => {
        const upper = resolveNativeSessionPath("C:/user-data", "Session-A");
        const lower = resolveNativeSessionPath("C:/user-data", "session-a");

        expect(upper).toBe("C:\\user-data\\pi-sessions\\session-a-70d359e1f21e1bfd.jsonl");
        expect(lower).toBe("C:\\user-data\\pi-sessions\\session-a-fa57a52dbf081902.jsonl");
        expect(upper.toLowerCase()).not.toBe(lower.toLowerCase());
    });

    it.each([
        ["CON", "con-a3dbc4b644a9a2c5.jsonl"],
        ["name.", "name-f8f47e4731f66a0a.jsonl"],
        [".", "session-cdb4ee2aea69cc6a.jsonl"],
        ["..", "session-5ec1f7e700f37c3d.jsonl"],
    ])("maps Windows-special id %s to a regular filename", (sessionId, filename) => {
        expect(resolveNativeSessionPath("C:/user-data", sessionId))
            .toBe(`C:\\user-data\\pi-sessions\\${filename}`);
    });

    it("is stable for repeated calls with the same original id", () => {
        const first = resolveNativeSessionPath("C:/user-data", "Session-A");

        expect(resolveNativeSessionPath("C:/user-data", "Session-A")).toBe(first);
    });

    // wave-93 residual
    it("truncates long session ids in the readable fragment while keeping a stable hash", () => {
        const longId = `sess_${"a".repeat(80)}.final`;
        const path = resolveNativeSessionPath("D:/data", longId);
        const file = path.split(/[\\/]/).pop()!;
        const [fragment, hashWithExt] = [file.slice(0, file.lastIndexOf("-")), file.slice(file.lastIndexOf("-") + 1)];
        expect(fragment.length).toBeLessThanOrEqual(48);
        expect(hashWithExt).toMatch(/^[a-f0-9]{16}\.jsonl$/);
        expect(path).toBe(resolveNativeSessionPath("D:/data", longId));
    });

    it("rejects path-like and whitespace ids beyond the allowlist", () => {
        for (const bad of ["sess:1", "sess@1", "sess#1", " sess", "sess ", "a/b", "a\\b"]) {
            expect(() => resolveNativeSessionPath("C:/user-data", bad)).toThrow("Invalid desktop session id");
        }
    });

    it("places all sessions under pi-sessions of the given userData root", () => {
        const path = resolveNativeSessionPath("E:/pi-user", "ok-id_1");
        expect(path.startsWith("E:\\pi-user\\pi-sessions\\")).toBe(true);
        expect(path.endsWith(".jsonl")).toBe(true);
    });

    // wave-165 residual
    it("strips trailing dots from readable fragment but keeps them in the hash input", () => {
        const withDots = resolveNativeSessionPath("C:/user-data", "name...");
        const without = resolveNativeSessionPath("C:/user-data", "name");
        // readable fragment drops trailing dots
        expect(withDots.split(/[\\/]/).pop()).toMatch(/^name-[a-f0-9]{16}\.jsonl$/);
        // hash is over original id, so paths differ
        expect(withDots).not.toBe(without);
    });

    it("falls back to session fragment when id is only dots", () => {
        // "." and ".." already covered as Windows-special; multi-dot only
        const path = resolveNativeSessionPath("C:/user-data", "...");
        const file = path.split(/[\\/]/).pop()!;
        expect(file.startsWith("session-")).toBe(true);
        expect(file).toMatch(/^session-[a-f0-9]{16}\.jsonl$/);
    });

    it("allows underscore and hyphen and produces lowercase fragment", () => {
        const path = resolveNativeSessionPath("C:/ud", "My_Session-ID");
        const file = path.split(/[\\/]/).pop()!;
        expect(file.startsWith("my_session-id-")).toBe(true);
        expect(file).toMatch(/^[a-z0-9._-]+-[a-f0-9]{16}\.jsonl$/);
    });

    it("rejects unicode and punctuation outside the allowlist", () => {
        for (const bad of ["会话-1", "sess!", "sess+", "sess*", "sess?", "sess="]) {
            expect(() => resolveNativeSessionPath("C:/user-data", bad)).toThrow(
                "Invalid desktop session id",
            );
        }
    });

    it("hash length is always 16 hex chars independent of id length", () => {
        for (const id of ["a", "short", `sess_${"x".repeat(100)}`]) {
            const file = resolveNativeSessionPath("C:/d", id).split(/[\\/]/).pop()!;
            const hash = file.slice(file.lastIndexOf("-") + 1, file.lastIndexOf("."));
            expect(hash).toMatch(/^[a-f0-9]{16}$/);
        }
    });


    // wave-215 residual
    it("joins under pi-sessions and is stable for the same id", () => {
        const a = resolveNativeSessionPath("C:/user-data", "sess_abc");
        const b = resolveNativeSessionPath("C:/user-data", "sess_abc");
        expect(a).toBe(b);
        expect(a.replace(/\\/g, "/")).toMatch(
            /C:\/user-data\/pi-sessions\/sess_abc-[a-f0-9]{16}\.jsonl$/,
        );
    });

    it("truncates readable fragment to 48 chars after lowercasing and trailing-dot strip", () => {
        const long = `Sess_${"X".repeat(80)}`;
        const file = resolveNativeSessionPath("C:/ud", long).split(/[\\/]/).pop()!;
        const frag = file.slice(0, file.lastIndexOf("-"));
        expect(frag.length).toBeLessThanOrEqual(48);
        expect(frag).toBe(frag.toLowerCase());
        expect(frag.endsWith(".")).toBe(false);
        expect(file).toMatch(/-[a-f0-9]{16}\.jsonl$/);
    });

    it("rejects empty string and path separators in session id", () => {
        for (const bad of ["", "sess/id", "sess\\id", "sess id", "sess:id"]) {
            expect(() => resolveNativeSessionPath("C:/ud", bad)).toThrow("Invalid desktop session id");
        }
    });


    // wave-219 residual
    it("same sessionId yields stable path; allowed charset includes dots underscores dashes", () => {
        const a = resolveNativeSessionPath("C:/ud", "Sess.A_1-2");
        const b = resolveNativeSessionPath("C:/ud", "Sess.A_1-2");
        expect(a).toBe(b);
        expect(a.replace(/\\/g, "/")).toMatch(/^C:\/ud\/pi-sessions\//);
        expect(a).toMatch(/\.jsonl$/);
        // different ids must not collide on full path even if fragments similar
        const other = resolveNativeSessionPath("C:/ud", "Sess.A_1-3");
        expect(other).not.toBe(a);
    });

    it("rejects @ and # and unicode spaces; accepts alphanumeric-only short ids", () => {
        for (const bad of ["sess@id", "sess#1", "sess\u3000id"]) {
            expect(() => resolveNativeSessionPath("C:/ud", bad)).toThrow("Invalid desktop session id");
        }
        const ok = resolveNativeSessionPath("C:/ud", "abc123");
        const file = ok.split(/[\\/]/).pop()!;
        expect(file.startsWith("abc123-")).toBe(true);
        expect(file).toMatch(/-[a-f0-9]{16}\.jsonl$/);
    });

    // wave-226 residual
    it("trailing dots on session id collapse to session fragment when only dots remain after strip", () => {
        const path = resolveNativeSessionPath("C:/ud", "....");
        // charset allows dots; after lower/strip empty fragment becomes "session"
        const file = path.split(/[\\/]/).pop()!;
        expect(file.startsWith("session-")).toBe(true);
        expect(file).toMatch(/-[a-f0-9]{16}\.jsonl$/);
    });

    it("hash is sha256-16 of exact sessionId; different case is different id", () => {
        const lower = resolveNativeSessionPath("C:/ud", "AbC");
        const upper = resolveNativeSessionPath("C:/ud", "abc");
        // fragment lowercased but hash uses original id bytes
        expect(lower).not.toBe(upper);
        const fragL = lower.split(/[\\/]/).pop()!.split("-")[0];
        const fragU = upper.split(/[\\/]/).pop()!.split("-")[0];
        expect(fragL).toBe("abc");
        expect(fragU).toBe("abc");
        expect(lower.split("-").pop()).not.toBe(upper.split("-").pop());
    });

    it("userDataPath is joined as-is under pi-sessions", () => {
        const p = resolveNativeSessionPath("D:/AppData/Pi", "s1");
        expect(p.replace(/\\/g, "/")).toBe(
            `D:/AppData/Pi/pi-sessions/${p.split(/[\\/]/).pop()}`,
        );
    });

    // wave-241 residual
    it("rejects empty/space/path separators; accepts dots underscores dashes", () => {
        for (const bad of ["", " ", "a b", "a/b", "a\\b", "a:b", "a*b"]) {
            expect(() => resolveNativeSessionPath("C:/ud", bad)).toThrow("Invalid desktop session id");
        }
        const ok = resolveNativeSessionPath("C:/ud", "sess_1.2-3");
        const file = ok.split(/[\\/]/).pop()!;
        expect(file.startsWith("sess_1.2-3-")).toBe(true);
        expect(file).toMatch(/-[a-f0-9]{16}\.jsonl$/);
    });

    it("truncates readable fragment to 48 after lowercasing; strips trailing dots twice", () => {
        const long = "A".repeat(60);
        const p = resolveNativeSessionPath("C:/ud", long);
        const frag = p.split(/[\\/]/).pop()!.replace(/-[a-f0-9]{16}\.jsonl$/, "");
        expect(frag.length).toBe(48);
        expect(frag).toBe("a".repeat(48));
        // trailing dots after slice removed; pure-dot residue → "session"
        const dots = resolveNativeSessionPath("C:/ud", `${"x".repeat(48)}....`);
        const fragDots = dots.split(/[\\/]/).pop()!.replace(/-[a-f0-9]{16}\.jsonl$/, "");
        expect(fragDots).toBe("x".repeat(48));
    });

    it("hash is deterministic for same id and independent of userDataPath", () => {
        const a = resolveNativeSessionPath("C:/ud1", "stable-id");
        const b = resolveNativeSessionPath("D:/ud2", "stable-id");
        const hashA = a.split(/[\\/]/).pop()!.match(/-([a-f0-9]{16})\.jsonl$/)?.[1];
        const hashB = b.split(/[\\/]/).pop()!.match(/-([a-f0-9]{16})\.jsonl$/)?.[1];
        expect(hashA).toBe(hashB);
        expect(hashA).toHaveLength(16);
        expect(a.replace(/\\/g, "/")).toContain("C:/ud1/pi-sessions/");
        expect(b.replace(/\\/g, "/")).toContain("D:/ud2/pi-sessions/");
    });
});
