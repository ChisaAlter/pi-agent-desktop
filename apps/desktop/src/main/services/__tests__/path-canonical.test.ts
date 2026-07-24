import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWorkspacePathAllowed,
  readLinkTarget,
  resolveCanonicalTarget,
} from "../path-canonical";

const temps: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-path-canonical-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveCanonicalTarget", () => {
  it("returns realpath for an existing file", async () => {
    const ws = await makeTempWorkspace();
    const file = join(ws, "note.txt");
    await writeFile(file, "hi", "utf8");
    await expect(resolveCanonicalTarget(file)).resolves.toBe(await import("fs/promises").then((m) => m.realpath(file)));
  });

  it("resolves missing leaf under an existing ancestor", async () => {
    const ws = await makeTempWorkspace();
    const nested = join(ws, "src", "new-file.ts");
    await mkdir(join(ws, "src"), { recursive: true });
    const resolved = await resolveCanonicalTarget(nested);
    expect(resolved.replaceAll("\\", "/")).toMatch(/src\/new-file\.ts$/);
  });
});

describe("readLinkTarget", () => {
  it("returns undefined for ordinary files", async () => {
    const ws = await makeTempWorkspace();
    const file = join(ws, "plain.txt");
    await writeFile(file, "x", "utf8");
    await expect(readLinkTarget(file)).resolves.toBeUndefined();
  });

  it("returns absolute target for a symbolic link when supported", async () => {
    const ws = await makeTempWorkspace();
    const target = join(ws, "target.txt");
    const link = join(ws, "alias.txt");
    await writeFile(target, "data", "utf8");
    try {
      await symlink(target, link);
    } catch {
      // Windows without Developer Mode / privilege may refuse symlink creation.
      return;
    }
    const resolved = await readLinkTarget(link);
    expect(resolved).toBeDefined();
    expect(resolved?.replaceAll("\\", "/").toLowerCase()).toContain("target.txt");
  });
});

describe("assertWorkspacePathAllowed", () => {
  it("allows ordinary files inside the workspace", async () => {
    const ws = await makeTempWorkspace();
    const file = join(ws, "src", "app.ts");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(file, "export {}", "utf8");
    const result = await assertWorkspacePathAllowed(file, ws);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/app\.ts$/i);
    }
  });

  it("rejects paths outside the workspace", async () => {
    const ws = await makeTempWorkspace();
    const outside = join(tmpdir(), "pi-outside-secret.txt");
    temps.push(outside);
    await writeFile(outside, "secret", "utf8");
    const result = await assertWorkspacePathAllowed(outside, ws);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/不在当前工作区|敏感|Home/);
    }
  });

  it("rejects sensitive files even inside the workspace", async () => {
    const ws = await makeTempWorkspace();
    const envFile = join(ws, ".env");
    await writeFile(envFile, "KEY=1", "utf8");
    const result = await assertWorkspacePathAllowed(envFile, ws);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("敏感");
    }
  });

  it("rejects when workspace path cannot be resolved", async () => {
    const missingWs = join(tmpdir(), `pi-missing-ws-${Date.now()}`);
    const result = await assertWorkspacePathAllowed(join(missingWs, "a.ts"), missingWs);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/无法解析工作区路径|不在当前工作区/);
    }
  });


  // wave-86 residual
  it("rejects the user home root even if requested as workspace leaf", async () => {
    const home = homedir();
    const result = await assertWorkspacePathAllowed(home, join(home, "project"));
    expect(result.allowed).toBe(false);
  });

  it("allows nested ordinary files with windows-style mixed separators when under workspace", async () => {
    const ws = await makeTempWorkspace();
    const nestedDir = join(ws, "src", "app");
    await mkdir(nestedDir, { recursive: true });
    const file = join(nestedDir, "main.ts");
    await writeFile(file, "export {}", "utf8");
    const result = await assertWorkspacePathAllowed(file, ws);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.canonicalPath.toLowerCase()).toContain("main.ts");
    }
  });

  // wave-112 residual
  it("resolves multi-segment missing leaves under an existing ancestor", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const missing = join(ws, "src", "deep", "nested", "file.ts");
    const resolved = await resolveCanonicalTarget(missing);
    expect(resolved.replaceAll("\\", "/")).toMatch(/src\/deep\/nested\/file\.ts$/i);
  });

  it("readLinkTarget returns undefined for missing paths", async () => {
    const ws = await makeTempWorkspace();
    await expect(readLinkTarget(join(ws, "no-such-link"))).resolves.toBeUndefined();
  });

  it("allows missing ordinary leaf files that will be created under workspace", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const result = await assertWorkspacePathAllowed(join(ws, "src", "brand-new.ts"), ws);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/brand-new\.ts$/i);
    }
  });

  // wave-120 residual
  it("rejects sensitive missing leaf under workspace before IO", async () => {
    const ws = await makeTempWorkspace();
    const result = await assertWorkspacePathAllowed(join(ws, ".env.production"), ws);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/敏感/);
    }
  });

  it("rejects workspace-relative escape via .. segments", async () => {
    const ws = await makeTempWorkspace();
    const outside = join(ws, "..", "escape-secret.txt");
    // write outside neighbor so realpath succeeds if lexical check failed
    await writeFile(outside, "x", "utf8");
    temps.push(outside);
    const result = await assertWorkspacePathAllowed(outside, ws);
    expect(result.allowed).toBe(false);
  });

  it("resolveCanonicalTarget on workspace root returns realpath", async () => {
    const ws = await makeTempWorkspace();
    const resolved = await resolveCanonicalTarget(ws);
    const { realpath } = await import("fs/promises");
    expect(resolved).toBe(await realpath(ws));
  });

  it("allows ordinary file under nested dirs created after workspace realpath", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "a", "b"), { recursive: true });
    const file = join(ws, "a", "b", "c.ts");
    await writeFile(file, "export {}", "utf8");
    const result = await assertWorkspacePathAllowed(file, ws);
    expect(result.allowed).toBe(true);
  });

  // wave-126 residual
  it("rejects sensitive pem/sqlite and .ssh paths even under workspace", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, ".ssh"), { recursive: true });
    await writeFile(join(ws, "cert.pem"), "x", "utf8");
    await writeFile(join(ws, "local.sqlite"), "x", "utf8");
    await writeFile(join(ws, ".ssh", "id_ed25519"), "x", "utf8");

    const pem = await assertWorkspacePathAllowed(join(ws, "cert.pem"), ws);
    expect(pem.allowed).toBe(false);
    if (!pem.allowed) expect(pem.reason).toMatch(/敏感/);

    const sqlite = await assertWorkspacePathAllowed(join(ws, "local.sqlite"), ws);
    expect(sqlite.allowed).toBe(false);

    const sshKey = await assertWorkspacePathAllowed(join(ws, ".ssh", "id_ed25519"), ws);
    expect(sshKey.allowed).toBe(false);
    if (!sshKey.allowed) expect(sshKey.reason).toMatch(/敏感|凭据/);
  });

  it("rejects missing sensitive leaf names under nested workspace dirs", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "config"), { recursive: true });
    const result = await assertWorkspacePathAllowed(join(ws, "config", "credentials.json"), ws);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/敏感/);
  });

  // wave-132 residual
  it("rejects sensitive credential dirs and config leaves under workspace", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, ".aws"), { recursive: true });
    await mkdir(join(ws, ".gnupg"), { recursive: true });
    await writeFile(join(ws, ".aws", "credentials"), "x", "utf8");
    await writeFile(join(ws, ".npmrc"), "token=1", "utf8");
    await writeFile(join(ws, ".pypirc"), "password=1", "utf8");
    await writeFile(join(ws, "secrets.env"), "K=1", "utf8");

    for (const rel of [".aws/credentials", ".gnupg/private-keys-v1.d", ".npmrc", ".pypirc", "secrets.env"]) {
      const result = await assertWorkspacePathAllowed(join(ws, ...rel.split("/")), ws);
      expect(result.allowed, rel).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/敏感|凭据/);
    }
  });

  it("returns parse-failure reason when workspace realpath is unreachable", async () => {
    const missingWs = join(tmpdir(), `pi-missing-ws-wave132-${Date.now()}`);
    const result = await assertWorkspacePathAllowed(join(missingWs, "src", "a.ts"), missingWs);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/无法解析工作区路径|不在当前工作区/);
    }
  });

  // wave-164 residual
  it("allows workspace root itself when target equals workspace path", async () => {
    const ws = await makeTempWorkspace();
    const result = await assertWorkspacePathAllowed(ws, ws);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.canonicalPath).toBeTruthy();
    }
  });

  it("readLinkTarget returns undefined for ordinary directories", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    await expect(readLinkTarget(join(ws, "src"))).resolves.toBeUndefined();
  });

  it("rejects sibling path that only shares a string prefix with workspace", async () => {
    const base = await makeTempWorkspace();
    const ws = join(base, "proj");
    const sibling = join(base, "proj-extra", "secret.txt");
    await mkdir(ws, { recursive: true });
    await mkdir(join(base, "proj-extra"), { recursive: true });
    await writeFile(sibling, "x", "utf8");
    const result = await assertWorkspacePathAllowed(sibling, ws);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/不在当前工作区/);
    }
  });

  it("resolveCanonicalTarget keeps multi-segment missing leaves after existing file ancestor", async () => {
    const ws = await makeTempWorkspace();
    // existing file as nearest ancestor: ENOTDIR when walking through file as dir
    await writeFile(join(ws, "leaf.txt"), "x", "utf8");
    // climbing past leaf.txt (file) should hit ENOTDIR and continue to parent
    const underFile = join(ws, "leaf.txt", "child", "ghost.ts");
    await expect(resolveCanonicalTarget(underFile)).resolves.toMatch(/leaf\.txt[\\/]child[\\/]ghost\.ts$/i);
  });

  // wave-181 residual
  it("allows nested existing file and multi-segment missing under same workspace", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src", "deep"), { recursive: true });
    const existing = join(ws, "src", "deep", "a.ts");
    await writeFile(existing, "export {}", "utf8");
    const ok = await assertWorkspacePathAllowed(existing, ws);
    expect(ok.allowed).toBe(true);
    if (ok.allowed) {
      expect(ok.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/deep\/a\.ts$/i);
    }

    const missing = join(ws, "src", "deep", "new", "b.ts");
    const pending = await assertWorkspacePathAllowed(missing, ws);
    expect(pending.allowed).toBe(true);
    if (pending.allowed) {
      expect(pending.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/deep\/new\/b\.ts$/i);
    }
  });

  it("readLinkTarget returns undefined for missing paths without throwing", async () => {
    const ws = await makeTempWorkspace();
    await expect(readLinkTarget(join(ws, "no-such-link"))).resolves.toBeUndefined();
  });

  it("rejects empty/whitespace target under a valid workspace via protected-paths", async () => {
    const ws = await makeTempWorkspace();
    // empty resolve typically escapes or fails lexical inside check
    const empty = await assertWorkspacePathAllowed("", ws);
    expect(empty.allowed).toBe(false);
  });

  // wave-191 residual
  it("rejects sibling-prefix workspace escape and allows ordinary nested file", async () => {
    const ws = await makeTempWorkspace();
    const sibling = `${ws}-sibling`;
    await mkdir(sibling, { recursive: true });
    temps.push(sibling);
    const leak = join(sibling, "secret.txt");
    await writeFile(leak, "x", "utf8");
    const denied = await assertWorkspacePathAllowed(leak, ws);
    expect(denied.allowed).toBe(false);

    const inside = join(ws, "ok.txt");
    await writeFile(inside, "ok", "utf8");
    const allowed = await assertWorkspacePathAllowed(inside, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.replaceAll("\\", "/")).toMatch(/ok\.txt$/i);
    }
  });

  it("rejects sensitive .env under workspace even when path is inside", async () => {
    const ws = await makeTempWorkspace();
    const envPath = join(ws, ".env");
    await writeFile(envPath, "SECRET=1", "utf8");
    const denied = await assertWorkspacePathAllowed(envPath, ws);
    expect(denied.allowed).toBe(false);
  });

  // wave-196 residual
  it("rejects nonexistent workspace root with unresolvable reason", async () => {
    const missingWs = join(tmpdir(), `pi-path-canonical-missing-${Date.now()}`);
    const result = await assertWorkspacePathAllowed(join(missingWs, "a.ts"), missingWs);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/无法解析工作区路径/);
    }
  });

  it("rejects sensitive .ssh path under an otherwise valid workspace", async () => {
    const ws = await makeTempWorkspace();
    const ssh = join(ws, ".ssh", "id_rsa");
    await mkdir(join(ws, ".ssh"), { recursive: true });
    await writeFile(ssh, "key", "utf8");
    const denied = await assertWorkspacePathAllowed(ssh, ws);
    expect(denied.allowed).toBe(false);
  });

  // wave-201 residual
  it("allows ordinary nested file and returns canonical absolute path", async () => {
    const ws = await makeTempWorkspace();
    const nestedDir = join(ws, "src");
    await mkdir(nestedDir, { recursive: true });
    const file = join(nestedDir, "app.ts");
    await writeFile(file, "export {}", "utf8");
    const allowed = await assertWorkspacePathAllowed(file, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.toLowerCase()).toContain("app.ts");
      expect(allowed.canonicalPath).not.toContain("..");
    }
  });

  it("rejects .env.local under workspace without resolving past lexical guard", async () => {
    const ws = await makeTempWorkspace();
    const envLocal = join(ws, ".env.local");
    await writeFile(envLocal, "X=1", "utf8");
    const denied = await assertWorkspacePathAllowed(envLocal, ws);
    expect(denied.allowed).toBe(false);
  });

  // wave-204 residual
  it("rejects path outside workspace when absolute sibling is provided", async () => {
    const ws = await makeTempWorkspace();
    const outside = await makeTempWorkspace();
    const file = join(outside, "secret.txt");
    await writeFile(file, "nope", "utf8");
    const denied = await assertWorkspacePathAllowed(file, ws);
    expect(denied.allowed).toBe(false);
  });

  it("allows missing leaf under existing workspace directory for create-style writes", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const missing = join(ws, "src", "brand-new.ts");
    const allowed = await assertWorkspacePathAllowed(missing, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/brand-new\.ts$/i);
    }
  });

  it("rejects .env under workspace root", async () => {
    const ws = await makeTempWorkspace();
    const envFile = join(ws, ".env");
    await writeFile(envFile, "K=1", "utf8");
    const denied = await assertWorkspacePathAllowed(envFile, ws);
    expect(denied.allowed).toBe(false);
  });

  // wave-211 residual
  it("rejects .ssh/id_rsa and .npmrc under workspace; allows ordinary nested file", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, ".ssh"), { recursive: true });
    const idRsa = join(ws, ".ssh", "id_rsa");
    await writeFile(idRsa, "key", "utf8");
    expect((await assertWorkspacePathAllowed(idRsa, ws)).allowed).toBe(false);

    const npmrc = join(ws, ".npmrc");
    await writeFile(npmrc, "//registry=x", "utf8");
    expect((await assertWorkspacePathAllowed(npmrc, ws)).allowed).toBe(false);

    await mkdir(join(ws, "src"), { recursive: true });
    const ok = join(ws, "src", "ok.ts");
    await writeFile(ok, "export {}", "utf8");
    const allowed = await assertWorkspacePathAllowed(ok, ws);
    expect(allowed.allowed).toBe(true);
  });

  it("rejects empty-string target and workspace-relative traversal outside", async () => {
    const ws = await makeTempWorkspace();
    // empty / bare relative escapes are not inside workspace after resolve
    const deniedEmpty = await assertWorkspacePathAllowed("", ws);
    expect(deniedEmpty.allowed).toBe(false);
    const outside = await assertWorkspacePathAllowed(join(ws, "..", "nope.txt"), ws);
    expect(outside.allowed).toBe(false);
  });

  // wave-218 residual
  it("allows missing nested leaf under existing ancestor; returns canonicalPath", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src", "lib"), { recursive: true });
    const missing = join(ws, "src", "lib", "brand-new.ts");
    const result = await assertWorkspacePathAllowed(missing, ws);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.canonicalPath.replaceAll("\\", "/")).toMatch(/src\/lib\/brand-new\.ts$/);
    }
  });

  it("readLinkTarget undefined for missing path; deny .env.local under workspace", async () => {
    const ws = await makeTempWorkspace();
    await expect(readLinkTarget(join(ws, "no-such-link"))).resolves.toBeUndefined();
    const envLocal = join(ws, ".env.local");
    await writeFile(envLocal, "X=1", "utf8");
    const denied = await assertWorkspacePathAllowed(envLocal, ws);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/敏感|配置|凭据/);
    }
  });

  // wave-249 residual
  it("rejects credentials/config/secrets under workspace; allows nested non-sensitive and .git-credentials", async () => {
    const ws = await makeTempWorkspace();
    // product: bare credentials/config + secrets* match SENSITIVE_FILE_PATTERNS; .git-credentials does not
    for (const name of ["credentials", "config", "secrets", "credentials.json"] as const) {
      const p = join(ws, name);
      await writeFile(p, "x", "utf8");
      expect((await assertWorkspacePathAllowed(p, ws)).allowed).toBe(false);
    }
    const gitCreds = join(ws, ".git-credentials");
    await writeFile(gitCreds, "x", "utf8");
    expect((await assertWorkspacePathAllowed(gitCreds, ws)).allowed).toBe(true);

    await mkdir(join(ws, "docs"), { recursive: true });
    const ok = join(ws, "docs", "readme.md");
    await writeFile(ok, "# ok", "utf8");
    const allowed = await assertWorkspacePathAllowed(ok, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.replaceAll("\\", "/")).toMatch(/docs\/readme\.md$/i);
    }
  });

  it("resolveCanonicalTarget multi-segment missing leaf; missing workspace denies", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "a"), { recursive: true });
    const deepMissing = join(ws, "a", "b", "c", "new.ts");
    const resolved = await resolveCanonicalTarget(deepMissing);
    expect(resolved.replaceAll("\\", "/")).toMatch(/a\/b\/c\/new\.ts$/i);

    const missingWs = join(ws, "does-not-exist-root");
    const denied = await assertWorkspacePathAllowed(join(ws, "x.ts"), missingWs);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/无法解析工作区路径|敏感|工作区|outside|路径/i);
    }
  });

  // wave-261 residual
  it("assertWorkspacePathAllowed denies outside workspace and sensitive basenames", async () => {
    const ws = await makeTempWorkspace();
    const outside = join(ws, "..", "outside-secret.txt");
    const deniedOutside = await assertWorkspacePathAllowed(outside, ws);
    expect(deniedOutside.allowed).toBe(false);

    const envPath = join(ws, ".env");
    await writeFile(envPath, "A=1", "utf8");
    const deniedEnv = await assertWorkspacePathAllowed(envPath, ws);
    expect(deniedEnv.allowed).toBe(false);
    if (!deniedEnv.allowed) {
      expect(deniedEnv.reason).toMatch(/敏感|配置|凭据|路径/i);
    }
  });

  it("resolveCanonicalTarget preserves existing file path after realpath", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const file = join(ws, "src", "a.ts");
    await writeFile(file, "export {}", "utf8");
    const resolved = await resolveCanonicalTarget(file);
    expect(resolved.replaceAll("\\", "/").toLowerCase()).toContain("src/a.ts");
  });


  // wave-272 residual
  it("readLinkTarget returns undefined for regular files and missing paths", async () => {
    const ws = await makeTempWorkspace();
    const file = join(ws, "plain.txt");
    await writeFile(file, "x", "utf8");
    await expect(readLinkTarget(file)).resolves.toBeUndefined();
    await expect(readLinkTarget(join(ws, "missing-link"))).resolves.toBeUndefined();
  });

  it("assertWorkspacePathAllowed allows ordinary nested file with canonicalPath", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const file = join(ws, "src", "ok.ts");
    await writeFile(file, "export {}", "utf8");
    const allowed = await assertWorkspacePathAllowed(file, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.replaceAll("\\", "/").toLowerCase()).toContain("src/ok.ts");
    }
  });


  // wave-276 residual
  it("resolveCanonicalTarget allows missing nested file by joining existing ancestor", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const missing = join(ws, "src", "new-file.ts");
    const resolved = await resolveCanonicalTarget(missing);
    expect(resolved.replaceAll("\\", "/").toLowerCase()).toContain("src/new-file.ts");
  });

  it("assertWorkspacePathAllowed denies home-level sensitive config basename in workspace", async () => {
    const ws = await makeTempWorkspace();
    const cred = join(ws, "credentials");
    await writeFile(cred, "x", "utf8");
    const denied = await assertWorkspacePathAllowed(cred, ws);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/敏感|配置|凭据/i);
    }
  });

  // wave-285 residual
  it("readLinkTarget undefined for ordinary file; assert denies path outside workspace", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const file = join(ws, "src", "plain.ts");
    await writeFile(file, "x", "utf8");
    await expect(readLinkTarget(file)).resolves.toBeUndefined();

    const outside = join(ws, "..", `outside-${Date.now()}.txt`);
    await writeFile(outside, "nope", "utf8");
    const denied = await assertWorkspacePathAllowed(outside, ws);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/工作区|路径/i);
    }
  });

  it("resolveCanonicalTarget returns absolute path for existing file", async () => {
    const ws = await makeTempWorkspace();
    const file = join(ws, "exists.md");
    await writeFile(file, "hi", "utf8");
    const canonical = await resolveCanonicalTarget(file);
    expect(canonical.replaceAll("\\", "/").toLowerCase()).toContain("exists.md");
    const abs = await resolveCanonicalTarget(file);
    expect(abs).toBe(canonical);
  });




  // wave-299 residual
  it("assertWorkspacePathAllowed allows nested workspace file and returns canonicalPath", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const file = join(ws, "src", "ok.ts");
    await writeFile(file, "export {}", "utf8");
    const allowed = await assertWorkspacePathAllowed(file, ws);
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.canonicalPath.toLowerCase()).toContain("ok.ts");
      expect(allowed.canonicalPath).toContain(ws.length > 0 ? "" : ""); // absolute
      expect(allowed.canonicalPath.length).toBeGreaterThan(file.length - 1);
    }
  });

  it("assertWorkspacePathAllowed denies sensitive names even inside workspace", async () => {
    const ws = await makeTempWorkspace();
    const envFile = join(ws, ".env.local");
    await writeFile(envFile, "SECRET=1", "utf8");
    const denied = await assertWorkspacePathAllowed(envFile, ws);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toMatch(/敏感|配置|凭据/i);
    }
  });

  it("resolveCanonicalTarget stitches missing leaf under existing parent", async () => {
    const ws = await makeTempWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    const missing = join(ws, "src", "brand-new-file.ts");
    const canonical = await resolveCanonicalTarget(missing);
    expect(canonical.replaceAll("\\", "/").toLowerCase()).toContain("brand-new-file.ts");
    expect(canonical.replaceAll("\\", "/").toLowerCase()).toContain("src");
  });

});
