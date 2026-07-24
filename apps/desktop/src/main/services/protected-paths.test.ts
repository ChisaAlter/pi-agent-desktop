import { join, sep } from "path";
import { homedir } from "os";
import { describe, expect, it } from "vitest";
import { getProtectedPathReason, isPathInside } from "./protected-paths";

describe("protected path policy", () => {
    it("allows ordinary files inside the workspace", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "src", "app.ts"), workspace)).toBeNull();
    });

    it("blocks paths outside the workspace", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(homedir(), "other", "secret.txt"), workspace)).toContain("不在当前工作区");
    });

    it("blocks sensitive credential directories and env files", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ssh", "id_ed25519"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".env.local"), workspace)).toContain("敏感配置");
    });

    it("blocks common token and credential files inside a workspace", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".npmrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".netrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials.json"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secrets.local"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "github-token.json"), workspace)).toContain("敏感配置");
    });

    it("blocks common cloud credential directories", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".aws", "credentials"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".config", "gcloud", "application_default_credentials.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".gcloud", "credentials.db"), workspace)).toContain("敏感凭据目录");
    });

    it("blocks private keys, cert material, and local databases by extension", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "certs", "server.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "keys", "app.key"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "auth.p12"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "data", "sessions.sqlite"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "state.db"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ed25519.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "authorized_keys"), workspace)).toContain("敏感配置");
    });

    it("still applies sensitive-name filters when workspacePath is omitted", () => {
        // shell:open-path / shell:reveal-path may omit workspacePath; sensitive files
        // must still be blocked even without a workspace boundary check.
        expect(getProtectedPathReason(join(homedir(), "Downloads", ".env"))).toContain("敏感配置");
        expect(getProtectedPathReason(join(homedir(), "Downloads", "token.json"))).toContain("敏感配置");
        expect(getProtectedPathReason(join(homedir(), "Downloads", "notes.pem"))).toContain("敏感配置");
        expect(getProtectedPathReason(join(homedir(), "Downloads", "cache.sqlite"))).toContain("敏感配置");
        // Ordinary non-sensitive paths remain allowed when no workspace is supplied
        // (workspace boundary is enforced separately by callers that pass workspacePath).
        expect(getProtectedPathReason(join(homedir(), "Downloads", "readme.txt"))).toBeNull();
    });

    it("blocks the user home root", () => {
        expect(getProtectedPathReason(homedir())).toContain("Home");
        expect(getProtectedPathReason(homedir(), join(homedir(), "project"))).toContain("不在当前工作区");
    });

    it("checks parent/child path boundaries exactly", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, join(workspace, "src", "app.ts"))).toBe(true);
        expect(isPathInside(workspace, `${workspace}-copy`)).toBe(false);
        expect(isPathInside(workspace, workspace)).toBe(true);
        // prefix sibling must not count as inside even when one is a path prefix string
        expect(isPathInside(workspace, join(homedir(), "project-extra", "x.ts"))).toBe(false);
        expect(isPathInside(workspace, join(workspace, "..", "escape.txt"))).toBe(false);
    });

    it("blocks additional credential dirs and keystore/jks material", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".azure", "accessTokens.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".gnupg", "secring.gpg"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "truststore.jks"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "server.keystore"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secret-token.txt"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "api-credentials.yaml"), workspace)).toContain("敏感配置");
    });

    // wave-90 residual
    it("blocks additional sensitive filenames case-insensitively", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ENV"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.production"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".pypirc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_rsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_dsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "known_hosts"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secrets.toml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "oauth-tokens.yml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "cache.sqlite3"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "client.pfx"), workspace)).toContain("敏感配置");
    });

    it("blocks nested sensitive dirs under ordinary workspace folders", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "vendor", ".ssh", "id_ed25519"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "tools", ".aws", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "cfg", ".config", "gcloud", "adc.json"), workspace)).toContain("敏感凭据目录");
    });

    it("allows ordinary workspace-adjacent names that are not exact sensitive matches", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "env.example"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "README.md"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "config.ts"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "ssh-notes.md"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "database.ts"), workspace)).toBeNull();
    });

    // wave-111 residual
    it("blocks bare config name only as file basename (ssh config style)", () => {
        const workspace = join(homedir(), "project");
        // basename `config` matches SENSITIVE_FILE_PATTERNS /^config$/i
        expect(getProtectedPathReason(join(workspace, "config"), workspace)).toContain("敏感配置");
        // extension-bearing config.* ordinary code remains allowed (config.ts covered above)
        expect(getProtectedPathReason(join(workspace, "config.json"), workspace)).toBeNull();
    });

    it("blocks credentials variants with suffixes and credential yaml/toml", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "credentials.prod"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "my-secret.env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "service-credentials.toml"), workspace)).toContain("敏感配置");
    });

    it("isPathInside is true for nested deep paths and false for parent of workspace", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, join(workspace, "a", "b", "c", "d.ts"))).toBe(true);
        expect(isPathInside(workspace, join(workspace, ".."))).toBe(false);
        expect(isPathInside(workspace, join(workspace, "."))).toBe(true);
    });

    // wave-117 residual
    it("blocks .config/gcloud only when the next segment is exactly gcloud", () => {
        const workspace = join(homedir(), "project");
        // non-gcloud under .config is not the special pair (may still be ok unless other rules hit)
        expect(getProtectedPathReason(join(workspace, ".config", "other", "settings.json"), workspace)).toBeNull();
        // gcloud pair still sensitive even when nested deeper under workspace
        expect(
            getProtectedPathReason(join(workspace, "nested", ".config", "gcloud", "adc.json"), workspace),
        ).toContain("敏感凭据目录");
    });

    it("blocks secrets? filename variants and token/secret extension patterns", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "secret"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secrets"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secret_prod"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "my-token.env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "oauth_token.yaml"), workspace)).toContain("敏感配置");
        // ordinary names that only contain the substring without matching patterns
        expect(getProtectedPathReason(join(workspace, "tokenize.ts"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "token-service.ts"), workspace)).toBeNull();
    });

    it("isPathInside treats trailing separator and same-path as inside", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace + (process.platform === "win32" ? "\\" : "/"), workspace)).toBe(true);
        expect(isPathInside(workspace, workspace + (process.platform === "win32" ? "\\" : "/"))).toBe(true);
    });

    it("blocks home root even when workspacePath is omitted", () => {
        expect(getProtectedPathReason(homedir())).toContain("Home");
    });

    // wave-138 residual
    it("blocks remaining sensitive dir names (.kube/.docker/.azure)", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, "ops", ".azure", "token"), workspace)).toContain(
            "敏感凭据目录",
        );
    });

    it("returns outside-workspace reason when path escapes workspace", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(homedir(), "other", "secret.env"), workspace)).toBe(
            "路径不在当前工作区内",
        );
    });

    it("blocks private key basenames and allows ordinary .pub under non-sensitive dirs", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "id_rsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ed25519.pub"), workspace)).toContain("敏感配置");
        // product also matches *.pub? id_*.pub is in id_ pattern — covered above
        expect(getProtectedPathReason(join(workspace, "notes.pub"), workspace)).toBeNull();
    });

    it("blocks .env variants including dotted suffixes", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.local"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.production.local"), workspace)).toContain(
            "敏感配置",
        );
    });

    // wave-165 residual
    it("blocks id_ecdsa variants and allows ordinary config.* code files", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "id_ecdsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ecdsa.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "config.yaml"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "app.config.js"), workspace)).toBeNull();
    });

    it("outside-workspace reason takes precedence over sensitive basename", () => {
        const workspace = join(homedir(), "project");
        // path is outside workspace; product returns outside reason first
        expect(getProtectedPathReason(join(homedir(), "other", ".env"), workspace)).toBe(
            "路径不在当前工作区内",
        );
    });

    it("isPathInside false for empty-like relative escapes that resolve outside", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, join(workspace, "..", "..", "Windows"))).toBe(false);
        expect(isPathInside(workspace, join(workspace, "src", "..", "..", "other"))).toBe(false);
    });

    it("allows ordinary .db-looking names only when extension is not db/sqlite", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "database.md"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "notes.db.bak"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "cache.sqlite3"), workspace)).toContain("敏感配置");
    });

    // wave-177 residual
    it("blocks .config/gcloud chain and allows unrelated .config siblings", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".config", "gcloud", "credentials"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".config", "nvim", "init.lua"), workspace)).toBeNull();
    });

    it("blocks keystore/jks/pem/p12 and token-named text secrets", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "server.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "client.p12"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "app.keystore"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "trust.jks"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "api-token.json"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "user-secrets.yaml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "token.md"), workspace)).toBeNull();
    });

    it("blocks .gcloud sensitive dir and allows non-sensitive nested names", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".gcloud", "adc.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "src", "gcloud", "client.ts"), workspace)).toBeNull();
        expect(isPathInside(workspace, join(workspace, "src", "gcloud", "client.ts"))).toBe(true);
    });

    // wave-187 residual
    it("blocks home root only when workspace check is skipped; outside-workspace wins first", () => {
        const workspace = join(homedir(), "project");
        // product checks workspace membership before home root
        expect(getProtectedPathReason(homedir(), workspace)).toContain("工作区");
        expect(getProtectedPathReason(homedir())).toContain("Home");
        expect(getProtectedPathReason(join(homedir(), "other", "file.ts"), workspace)).toContain("工作区");
        expect(getProtectedPathReason(join(workspace, "src", "a.ts"), workspace)).toBeNull();
    });

    it("blocks .env variants and id_* key basenames case-insensitively", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.local"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".ENV"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_rsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "ID_ED25519.PUB"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "readme.env.md"), workspace)).toBeNull();
    });

    it("isPathInside true for exact root and nested; false for sibling-prefix", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, workspace)).toBe(true);
        expect(isPathInside(workspace, join(workspace, "a", "b.ts"))).toBe(true);
        expect(isPathInside(workspace, `${workspace}-sibling`)).toBe(false);
        expect(isPathInside(workspace, join(`${workspace}-sibling`, "x.ts"))).toBe(false);
    });

    // wave-194 residual
    it("blocks .ssh/.aws/.kube dirs and allows sibling non-sensitive names", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ssh", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".aws", "credentials"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "ssh", "config.ts"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "src", "aws.ts"), workspace)).toBeNull();
    });

    it("blocks token/secret basename patterns and .pem/.p12 material", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "api-token.json"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "my-secret.yaml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "cert.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "store.p12"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "local.sqlite"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "notes.txt"), workspace)).toBeNull();
    });

    it("blocks .config/gcloud nest and allows .config alone", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".config", "gcloud", "adc.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".config", "app", "settings.json"), workspace)).toBeNull();
    });

    // wave-197 residual
    it("blocks secrets.txt / private.key / credentials.yml; allows ordinary notes.md", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "secrets.txt"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "private.key"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials.yml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "notes.md"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "src", "config.ts"), workspace)).toBeNull();
    });

    it("isPathInside false for parent of workspace; true for trailing-separator equivalent root", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, join(workspace, ".."))).toBe(false);
        expect(isPathInside(workspace, `${workspace}${sep}`)).toBe(true);
        expect(isPathInside(workspace, join(workspace, "a"))).toBe(true);
    });

    // wave-201 residual
    it("blocks sensitive dirs .aws/.kube/.docker and pem/sqlite extensions", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".aws", "credentials"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, "cert.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "app.sqlite"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "readme.md"), workspace)).toBeNull();
    });

    it("without workspacePath only checks sensitivity; outside workspace with workspacePath is denied", () => {
        const workspace = join(homedir(), "project");
        const outside = join(homedir(), "other", "notes.md");
        expect(getProtectedPathReason(outside)).toBeNull();
        expect(getProtectedPathReason(outside, workspace)).toContain("不在当前工作区");
    });

    // wave-202 residual
    it("blocks .gnupg/.azure/.gcloud dirs and classic key material names", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".gnupg", "secring.gpg"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".azure", "accessTokens.json"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, ".gcloud", "credentials.db"), workspace)).toContain(
            "敏感凭据目录",
        );
        expect(getProtectedPathReason(join(workspace, "id_rsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "known_hosts"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".pypirc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "auth.pfx"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "store.jks"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "notes.txt"), workspace)).toBeNull();
    });

    it("workspace root itself is inside; sibling with shared prefix is not", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, workspace)).toBe(true);
        expect(isPathInside(workspace, join(homedir(), "project-extra", "a.ts"))).toBe(false);
        expect(getProtectedPathReason(workspace, workspace)).toBeNull();
        // home root still special-cased even when used as target without workspace
        expect(getProtectedPathReason(homedir())).toContain("Home");
    });

    // wave-206 residual
    it("blocks .npmrc/.netrc at workspace root case-insensitively", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".npmrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".NPMRC"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".netrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".NetRC"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "config", "app.json"), workspace)).toBeNull();
    });

    it("isPathInside is false for sibling-prefix and parent-escape paths", () => {
        const workspace = join(homedir(), "ws");
        expect(isPathInside(workspace, join(homedir(), "ws2", "a.ts"))).toBe(false);
        expect(isPathInside(workspace, join(workspace, "src", "a.ts"))).toBe(true);
        expect(isPathInside(workspace, join(workspace, "..", "escape.ts"))).toBe(false);
    });

    // wave-212 residual
    it("blocks .env variants and token/secret filename patterns under workspace", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.local"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.production"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "api-token.json"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "oauth-secrets.yaml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "notes.md"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "src", "ok.ts"), workspace)).toBeNull();
    });

    it("blocks .ssh/.docker/.kube dirs; outside workspace reason when workspace provided", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ssh", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(homedir(), "other", "a.ts"), workspace)).toContain("工作区");
    });

    // wave-217 residual
    it("blocks .pypirc / id_* pub / known_hosts / authorized_keys case-insensitively", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".pypirc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".PYPIRC"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_rsa.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ed25519.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "known_hosts"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "authorized_keys"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "readme.md"), workspace)).toBeNull();
    });

    it("blocks .gnupg/.azure/.gcloud dirs; isPathInside true for equal paths", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".gnupg", "pubring.kbx"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".azure", "accessTokens.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".gcloud", "credentials.db"), workspace)).toContain("敏感凭据目录");
        expect(isPathInside(workspace, workspace)).toBe(true);
        expect(isPathInside(workspace, join(workspace, "a", "b.ts"))).toBe(true);
        expect(isPathInside(workspace, join(workspace, "..", "outside.ts"))).toBe(false);
    });

    // wave-247 residual
    it("blocks bare config basename and credentials variants; allows config.json / env.example", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "config"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials.prod"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "config.json"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "env.example"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, ".env.example"), workspace)).toContain("敏感配置");
    });

    it("home root without workspace is Home; with workspace outside wins; isPathInside trailing sep", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(homedir())).toContain("Home");
        expect(getProtectedPathReason(homedir(), workspace)).toContain("工作区");
        expect(isPathInside(workspace, `${workspace}${sep}`)).toBe(true);
        expect(isPathInside(`${workspace}${sep}`, workspace)).toBe(true);
        expect(getProtectedPathReason(join(workspace, "src", "a.ts"), workspace)).toBeNull();
    });

    // wave-258 residual
    it("blocks cert/key/db extensions and secrets basename variants; allows .git-credentials", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "server.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "app.p12"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "store.sqlite3"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secrets"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secret-prod"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "tokens.json"), workspace)).toContain("敏感配置");
        // product: .git-credentials is NOT a sensitive basename pattern
        expect(getProtectedPathReason(join(workspace, ".git-credentials"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "package.json"), workspace)).toBeNull();
    });

    it("blocks .ssh/.aws/.kube/.docker dir segments and .config/gcloud", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ssh", "id_rsa"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".aws", "credentials"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".config", "gcloud", "x"), workspace)).toContain("敏感凭据目录");
    });

    // wave-271 residual
    it("blocks id_rsa/id_ed25519 and known_hosts/authorized_keys basenames", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "id_rsa"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ed25519"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_rsa.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "known_hosts"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "authorized_keys"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "readme.md"), workspace)).toBeNull();
    });

    it("isPathInside false for sibling prefix path; true for nested child", () => {
        const workspace = join(homedir(), "project");
        expect(isPathInside(workspace, join(homedir(), "project-other", "x"))).toBe(false);
        expect(isPathInside(workspace, join(workspace, "src", "a.ts"))).toBe(true);
        expect(isPathInside(workspace, workspace)).toBe(true);
    });


    // wave-276 residual
    it("blocks .gnupg/.azure/.gcloud dir segments; allows ordinary src files", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".gnupg", "secring.gpg"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".azure", "accessTokens.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".gcloud", "credentials"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, "src", "index.ts"), workspace)).toBeNull();
    });

    it("blocks .env variants and credentials.json; .env alone blocked; package-lock allowed", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".env.local"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials.json"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".npmrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "package-lock.json"), workspace)).toBeNull();
    });

    // wave-284 residual
    it("blocks .ssh/.aws/.kube/.docker segments and home root; allows nested ordinary files", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, ".ssh", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".aws", "credentials"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".kube", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".docker", "config.json"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(homedir())).toContain("Home");
        expect(getProtectedPathReason(join(workspace, "src", "ok.ts"), workspace)).toBeNull();
    });

    it("blocks pem/p12/key/db basenames and secrets* names; allows plain .md", () => {
        const workspace = join(homedir(), "project");
        expect(getProtectedPathReason(join(workspace, "server.pem"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "store.p12"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "app.key"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "local.sqlite"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "secrets.yaml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "README.md"), workspace)).toBeNull();
        expect(isPathInside(workspace, join(workspace, "..", "project", "src"))).toBe(true);
        expect(isPathInside(workspace, join(homedir(), "project-extra"))).toBe(false);
    });




    // wave-297 residual
    it("isPathInside true for same path and nested; false for sibling prefix escape", () => {
        const root = join(homedir(), "ws-proj-297");
        const inside = join(root, "src", "a.ts");
        const sibling = join(homedir(), "ws-proj-297-evil", "x");
        expect(isPathInside(root, root)).toBe(true);
        expect(isPathInside(root, inside)).toBe(true);
        expect(isPathInside(root, sibling)).toBe(false);
    });

    it("getProtectedPathReason flags sensitive dirs and credential-like filenames", () => {
        const workspace = join(homedir(), "project-297");
        expect(getProtectedPathReason(join(workspace, ".ssh", "id_rsa"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "src", "ok.ts"), workspace)).toBeNull();
        expect(getProtectedPathReason(join(workspace, "token.json"), workspace)).toContain("敏感配置");
    });

    it("outside workspace reason is Chinese workspace boundary message", () => {
        const workspace = join(homedir(), "project-297b");
        const outside = join(homedir(), "other-297", "x.ts");
        expect(getProtectedPathReason(outside, workspace)).toBe("路径不在当前工作区内");
    });



    // wave-310 residual
    it("blocks .pypirc/.netrc/id_ed25519/known_hosts/authorized_keys and cert/db extensions", () => {
        const workspace = join(homedir(), "wave310-proj");
        expect(getProtectedPathReason(join(workspace, ".pypirc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, ".netrc"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_ed25519"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "id_rsa.pub"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "known_hosts"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "authorized_keys"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "credentials.yaml"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "my-token.env"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "store.jks"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "data.sqlite3"), workspace)).toContain("敏感配置");
        expect(getProtectedPathReason(join(workspace, "src", "app.ts"), workspace)).toBeNull();
    });

    it("case-insensitive sensitive dirs; .config/gcloud pair; home root Chinese reason", () => {
        const workspace = join(homedir(), "wave310-case");
        expect(getProtectedPathReason(join(workspace, ".SSH", "config"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".azure", "profile"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".gnupg", "pubring"), workspace)).toContain("敏感凭据目录");
        expect(getProtectedPathReason(join(workspace, ".config", "gcloud", "key"), workspace)).toContain("敏感凭据目录");
        // bare .config without gcloud next segment is not sensitive-dir
        expect(getProtectedPathReason(join(workspace, ".config", "app", "settings.json"), workspace)).toBeNull();
        expect(getProtectedPathReason(homedir())).toContain("Home");
        // without workspacePath, outside-workspace check skipped; ordinary file under home project is null
        expect(getProtectedPathReason(join(homedir(), "wave310-case", "ok.md"))).toBeNull();
    });

    it("isPathInside uses resolve equality and trailing-sep prefix; sibling-prefix escape blocked", () => {
        const root = join(homedir(), "wave310-ws");
        expect(isPathInside(root, root)).toBe(true);
        expect(isPathInside(root, join(root, "a", "b"))).toBe(true);
        expect(isPathInside(root, join(homedir(), "wave310-ws-evil", "x"))).toBe(false);
        expect(isPathInside(root, join(homedir(), "other", "x"))).toBe(false);
    });
});
