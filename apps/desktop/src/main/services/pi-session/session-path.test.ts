import { basename, join } from "path";
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { resolveNativeSessionPath } from "./session-path";

describe("resolveNativeSessionPath", () => {
  it("builds stable hashed jsonl path under pi-sessions", () => {
    const sessionId = "sess_ABC-123.demo";
    const path = resolveNativeSessionPath("C:\\UserData\\Pi", sessionId);
    const readable = "sess_abc-123.demo".slice(0, 48);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("C:\\UserData\\Pi", "pi-sessions", `${readable}-${hash}.jsonl`));
  });

  it("rejects invalid session ids", () => {
    expect(() => resolveNativeSessionPath("/tmp/u", "../escape")).toThrow(/Invalid desktop session id/);
    expect(() => resolveNativeSessionPath("/tmp/u", "bad id")).toThrow(/Invalid desktop session id/);
    expect(() => resolveNativeSessionPath("/tmp/u", "ok@id")).toThrow(/Invalid desktop session id/);
  });

  it("trims trailing dots in readable fragment and keeps stable hash", () => {
    const sessionId = "a....";
    const path = resolveNativeSessionPath("/data", sessionId);
    expect(path.startsWith(join("/data", "pi-sessions"))).toBe(true);
    expect(path.endsWith(".jsonl")).toBe(true);
    expect(path).toMatch(/a-[0-9a-f]{16}\.jsonl$/);
  });

  // wave-106 residual
  it("falls back to session when readable fragment collapses after trimming", () => {
    const sessionId = "....";
    const path = resolveNativeSessionPath("/data", sessionId);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("/data", "pi-sessions", `session-${hash}.jsonl`));
  });

  it("truncates long ids to 48 readable chars while hashing the full id", () => {
    const sessionId = `sess_${"x".repeat(80)}`;
    const path = resolveNativeSessionPath("C:/u", sessionId);
    const readable = sessionId.toLowerCase().slice(0, 48);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("C:/u", "pi-sessions", `${readable}-${hash}.jsonl`));
    expect(path).not.toContain("x".repeat(49));
  });

  it("rejects empty session id", () => {
    expect(() => resolveNativeSessionPath("/tmp/u", "")).toThrow(/Invalid desktop session id/);
  });

  // wave-137 residual
  it("accepts underscore hyphen and dotted ids within the allowed charset", () => {
    const sessionId = "sess_2026-07-21.v1";
    const path = resolveNativeSessionPath("D:\\AppData\\Pi", sessionId);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(
      join("D:\\AppData\\Pi", "pi-sessions", `sess_2026-07-21.v1-${hash}.jsonl`),
    );
  });

  it("rejects path separators and spaces consistently", () => {
    for (const bad of ["a/b", "a\\b", "a b", "id#1", "id%2", "id+1"]) {
      expect(() => resolveNativeSessionPath("/u", bad)).toThrow(/Invalid desktop session id/);
    }
  });

  it("is stable across repeated calls for the same id", () => {
    const a = resolveNativeSessionPath("/u", "stable-id");
    const b = resolveNativeSessionPath("/u", "stable-id");
    expect(a).toBe(b);
  });

  it("produces different hashes for different full ids that share a truncated readable prefix", () => {
    const prefix = `sess_${"y".repeat(60)}`;
    const a = `${prefix}A`;
    const b = `${prefix}B`;
    const pathA = resolveNativeSessionPath("/u", a);
    const pathB = resolveNativeSessionPath("/u", b);
    expect(pathA).not.toBe(pathB);
    // readable prefix identical (first 48 of lowercased id) but hash differs
    const readableA = a.toLowerCase().slice(0, 48);
    const readableB = b.toLowerCase().slice(0, 48);
    expect(readableA).toBe(readableB);
    expect(pathA.includes(readableA)).toBe(true);
    expect(pathB.includes(readableB)).toBe(true);
  });

  // wave-173 residual
  it("lowercases mixed-case ids for readable fragment but hashes original bytes", () => {
    const sessionId = "Sess_MiXeD-Case.Demo";
    const path = resolveNativeSessionPath("/data", sessionId);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("/data", "pi-sessions", `sess_mixed-case.demo-${hash}.jsonl`));
    // different casing is a different full id → different hash
    const other = resolveNativeSessionPath("/data", "sess_mixed-case.demo");
    expect(other).not.toBe(path);
  });

  it("trims only trailing dots after length slice, not internal dots", () => {
    // internal dots stay; trailing dots after slice(0,48) are stripped twice in product
    const sessionId = `keep.dots.${"x".repeat(40)}...`;
    const path = resolveNativeSessionPath("/u", sessionId);
    expect(path).toMatch(/keep\.dots\./);
    expect(path).not.toMatch(/\.\.\.-[0-9a-f]{16}\.jsonl$/);
    expect(path).toMatch(/-[0-9a-f]{16}\.jsonl$/);
  });

  it("rejects unicode, shell metacharacters, and control-like ids", () => {
    for (const bad of ["会话", "sess:1", "sess;1", "sess|1", "sess`1", "sess\nid", "sess\tid"]) {
      expect(() => resolveNativeSessionPath("/u", bad)).toThrow(/Invalid desktop session id/);
    }
  });

  // wave-226 residual
  it("only-dots id becomes session fragment with stable hash", () => {
    const path = resolveNativeSessionPath("C:/ud", "....");
    const file = path.split(/[\\/]/).pop()!;
    expect(file.startsWith("session-")).toBe(true);
    expect(file).toMatch(/-[a-f0-9]{16}\.jsonl$/);
  });

  it("case-sensitive hash: AbC and abc share fragment but not path", () => {
    const lower = resolveNativeSessionPath("C:/ud", "AbC");
    const upper = resolveNativeSessionPath("C:/ud", "abc");
    expect(lower).not.toBe(upper);
    const fragL = lower.split(/[\\/]/).pop()!.split("-")[0];
    const fragU = upper.split(/[\\/]/).pop()!.split("-")[0];
    expect(fragL).toBe("abc");
    expect(fragU).toBe("abc");
  });



  // wave-293 residual
  it("readable fragment lowercases and caps 48; hash is first 16 of sha256", () => {
    const long = "A".repeat(60);
    const path = resolveNativeSessionPath("C:/ud", long);
    const file = path.split(/[\\/]/).pop()!;
    const [frag, hashWithExt] = [file.slice(0, file.lastIndexOf("-")), file.slice(file.lastIndexOf("-") + 1)];
    expect(frag).toBe("a".repeat(48));
    expect(hashWithExt).toMatch(/^[a-f0-9]{16}\.jsonl$/);
    // same id → same path
    expect(resolveNativeSessionPath("C:/ud", long)).toBe(path);
    // different userData root keeps filename
    const otherRoot = resolveNativeSessionPath("D:/other", long);
    expect(otherRoot.split(/[\\/]/).pop()).toBe(file);
  });

  it("rejects empty/space/slash ids; allows underscore hyphen dot alnum", () => {
    for (const bad of ["", " ", "a/b", "a\\b", "a b", "a+b", "a@b"]) {
      expect(() => resolveNativeSessionPath("/u", bad)).toThrow(/Invalid desktop session id/);
    }
    expect(() => resolveNativeSessionPath("/u", "ok_id-1.2")).not.toThrow();
    const p = resolveNativeSessionPath("/u", "ok_id-1.2");
    expect(p).toMatch(/pi-sessions/);
    expect(p).toMatch(/ok_id-1\.2-[a-f0-9]{16}\.jsonl$/);
  });



  // wave-301 residual
  it("resolveNativeSessionPath joins userData/pi-sessions/fragment-hash.jsonl", () => {
    const sessionId = "workspace_abc-1";
    const path = resolveNativeSessionPath("C:\\Users\\demo\\AppData", sessionId);
    const hash = createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("C:\\Users\\demo\\AppData", "pi-sessions", `workspace_abc-1-${hash}.jsonl`));
  });

  it("trailing dots only stripped from readable fragment after lower+slice; hash uses original id", () => {
    const id = "Keep.Me....";
    const path = resolveNativeSessionPath("/ud", id);
    const file = path.split(/[\\/]/).pop()!;
    expect(file.startsWith("keep.me-")).toBe(true);
    // product strips trailing dots from readable fragment only (not internal dots)
    expect(file).not.toMatch(/\.-[a-f0-9]{16}\.jsonl$/);
    const hash = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 16);
    expect(file).toBe(`keep.me-${hash}.jsonl`);
  });

  it("rejects path separators and plus; allows A-Za-z0-9._-", () => {
    for (const bad of ["a/b", "a\\b", "a b", "a+b", "id!", ""]) {
      expect(() => resolveNativeSessionPath("/u", bad)).toThrow(/Invalid desktop session id/);
    }
    const ok = resolveNativeSessionPath("/u", "A.B_c-9");
    expect(ok).toMatch(/a\.b_c-9-[a-f0-9]{16}\.jsonl$/);
  });


  // wave-318 residual
  it("only A-Za-z0-9._- session ids accepted; hash is first 16 hex of sha256(utf8)", () => {
    const id = "Ws.1_ok-2";
    const path = resolveNativeSessionPath("C:/ud", id);
    const hash = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 16);
    expect(path).toBe(join("C:/ud", "pi-sessions", `ws.1_ok-2-${hash}.jsonl`));
    for (const bad of ["", "a b", "a/b", "a" + String.fromCharCode(92) + "b", "a+b", "id!", "中文"]) {
      expect(() => resolveNativeSessionPath("/u", bad)).toThrow(/Invalid desktop session id/);
    }
  });

  it("readable fragment lowercases, strips trailing dots, caps 48, falls back to session", () => {
    const dots = "....";
    const pDots = resolveNativeSessionPath("/ud", dots);
    const hashDots = createHash("sha256").update(dots, "utf8").digest("hex").slice(0, 16);
    expect(basename(pDots)).toBe(`session-${hashDots}.jsonl`);

    const long = ("X".repeat(60)) + "...";
    const pLong = resolveNativeSessionPath("/ud", long);
    const fileLong = basename(pLong);
    const frag = fileLong.slice(0, fileLong.lastIndexOf("-"));
    expect(frag).toBe("x".repeat(48));
    const hashLong = createHash("sha256").update(long, "utf8").digest("hex").slice(0, 16);
    expect(fileLong.endsWith(`-${hashLong}.jsonl`)).toBe(true);
  });

  it("same sessionId same path under different roots shares filename; case changes hash", () => {
    const id = "Case.Id";
    const a = resolveNativeSessionPath("/a", id);
    const b = resolveNativeSessionPath("/b", id);
    expect(basename(a)).toBe(basename(b));
    const lower = resolveNativeSessionPath("/a", "case.id");
    expect(lower).not.toBe(a);
    expect(basename(lower).startsWith("case.id-")).toBe(true);
    expect(basename(a).startsWith("case.id-")).toBe(true);
  });


});
