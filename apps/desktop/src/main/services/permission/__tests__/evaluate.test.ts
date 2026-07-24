import { describe, expect, it } from "vitest";
import { EDIT_TOOLS, disabled, evaluate, fromConfig, merge } from "../evaluate";
import type { PermissionRuleset } from "../types";

describe("permission evaluate engine", () => {
  it("defaults to ask when no rule matches", () => {
    const rule = evaluate("bash", "rm -rf /", []);
    expect(rule.action).toBe("ask");
    expect(rule.permission).toBe("bash");
    expect(rule.pattern).toBe("*");
  });

  it("uses the last matching rule (later wins)", () => {
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*.env", action: "deny" },
      { permission: "edit", pattern: "local.env", action: "ask" },
    ];
    expect(evaluate("edit", "src/a.ts", ruleset).action).toBe("allow");
    expect(evaluate("edit", "prod.env", ruleset).action).toBe("deny");
    expect(evaluate("edit", "local.env", ruleset).action).toBe("ask");
  });

  it("merges rulesets by flattening", () => {
    const a: PermissionRuleset = [{ permission: "read", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [{ permission: "read", pattern: "*.env", action: "deny" }];
    expect(merge(a, b)).toEqual([...a, ...b]);
  });

  it("fromConfig expands string and nested pattern maps", () => {
    const rules = fromConfig({
      edit: "deny",
      read: { "*": "allow", "*.env": "ask" },
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "read", pattern: "*.env", action: "ask" },
      ]),
    );
  });

  it("fromConfig expands ~/ patterns to absolute home paths", () => {
    const rules = fromConfig({ read: { "~/secret": "deny" } });
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).not.toMatch(/^~/);
    expect(rules[0].pattern.length).toBeGreaterThan(1);
    expect(rules[0].action).toBe("deny");
  });

  it("disabled only removes tools denied with pattern *", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*.env", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["bash", "write", "edit", "read"], ruleset);
    expect(removed.has("bash")).toBe(true);
    expect(removed.has("write")).toBe(true);
    // edit-family matches write deny via EDIT_TOOLS alias only when permission is "edit"
    // write deny applies to write tool; edit stays because pattern is not *
    expect(removed.has("edit")).toBe(false);
    expect(removed.has("read")).toBe(false);
  });

  it("disabled treats edit-family tools as matching permission 'edit'", () => {
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["edit", "write", "apply_patch", "multiedit", "read"], ruleset);
    expect(removed.has("edit")).toBe(true);
    expect(removed.has("write")).toBe(true);
    expect(removed.has("apply_patch")).toBe(true);
    expect(removed.has("multiedit")).toBe(true);
    expect(removed.has("read")).toBe(false);
  });


  // wave-88 residual
  it("matches permission wildcards and pattern wildcards independently", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash*", pattern: "rm *", action: "deny" },
      { permission: "read", pattern: "**/*.ts", action: "allow" },
    ];
    expect(evaluate("bash", "rm -rf dist", ruleset).action).toBe("deny");
    expect(evaluate("bash-tool", "rm foo", ruleset).action).toBe("deny");
    expect(evaluate("read", "src/app.ts", ruleset).action).toBe("allow");
    expect(evaluate("read", "src/app.js", ruleset).action).toBe("ask");
  });

  it("fromConfig expands $HOME patterns like ~/", () => {
    const rules = fromConfig({ read: { "$HOME/secret": "deny", "$HOME": "ask" } });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.pattern).not.toMatch(/^\$HOME/);
      expect(rule.pattern.length).toBeGreaterThan(1);
    }
    expect(rules.find((r) => r.action === "deny")?.pattern).toContain("secret");
  });

  it("evaluate accepts multiple rulesets and later ruleset wins", () => {
    const a: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [{ permission: "bash", pattern: "sudo *", action: "deny" }];
    expect(evaluate("bash", "ls", a, b).action).toBe("allow");
    expect(evaluate("bash", "sudo apt update", a, b).action).toBe("deny");
  });

  it("merge preserves order so later rules win in evaluate", () => {
    const merged = merge(
      [{ permission: "edit", pattern: "*", action: "allow" }],
      [{ permission: "edit", pattern: "*.env", action: "deny" }],
    );
    expect(evaluate("edit", "a.ts", merged).action).toBe("allow");
    expect(evaluate("edit", "x.env", merged).action).toBe("deny");
  });

  it("disabled ignores non-deny and non-star patterns", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "read", pattern: "*.env", action: "deny" },
      { permission: "network", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["bash", "read", "network"], ruleset);
    expect(removed.has("bash")).toBe(false);
    expect(removed.has("read")).toBe(false);
    expect(removed.has("network")).toBe(true);
  });

  // wave-113 residual
  it("fromConfig expands bare ~ and $HOME without trailing slash", () => {
    const rules = fromConfig({
      read: { "~": "deny", $HOME: "ask" },
    });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.pattern).not.toMatch(/^~|^\$HOME/);
      expect(rule.pattern.length).toBeGreaterThan(1);
    }
    expect(rules.find((r) => r.action === "deny")?.pattern).toBe(
      rules.find((r) => r.action === "ask")?.pattern,
    );
  });

  it("fromConfig returns empty ruleset for empty config", () => {
    expect(fromConfig({})).toEqual([]);
  });

  it("disabled returns empty set for empty tool list or empty ruleset", () => {
    expect(disabled([], [{ permission: "bash", pattern: "*", action: "deny" }]).size).toBe(0);
    expect(disabled(["bash", "write"], []).size).toBe(0);
  });

  it("disabled later allow rule wins over earlier deny * for same permission", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ];
    const removed = disabled(["bash"], ruleset);
    expect(removed.has("bash")).toBe(false);
  });

  it("merge of zero rulesets is empty and evaluate defaults to ask", () => {
    expect(merge()).toEqual([]);
    expect(evaluate("bash", "ls").action).toBe("ask");
  });

  // wave-131 residual
  it("evaluate uses last matching rule across merged rulesets", () => {
    const early: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "deny" }];
    const late: PermissionRuleset = [{ permission: "bash", pattern: "ls*", action: "allow" }];
    expect(evaluate("bash", "ls -la", early, late).action).toBe("allow");
    expect(evaluate("bash", "rm -rf /", early, late).action).toBe("deny");
  });

  it("fromConfig expands ~/path and $HOME/path to absolute home paths", () => {
    const rules = fromConfig({
      read: { "~/secrets": "deny", "$HOME/docs": "ask" },
    });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.pattern).not.toMatch(/^~|^\$HOME/);
      expect(rule.pattern.includes("secrets") || rule.pattern.includes("docs")).toBe(true);
    }
  });

  it("disabled only removes tools with full * deny, not patterned deny", () => {
    const ruleset: PermissionRuleset = [
      { permission: "read", pattern: "*.env", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["read", "write", "bash"], ruleset);
    expect(removed.has("read")).toBe(false);
    expect(removed.has("write")).toBe(true);
    expect(removed.has("bash")).toBe(false);
  });

  // wave-149 residual
  it("fromConfig expands bare ~ and $HOME without trailing slash", () => {
    const rules = fromConfig({
      read: { "~": "deny", $HOME: "ask" },
    });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.pattern).not.toMatch(/^~|^\$HOME/);
      expect(rule.pattern.length).toBeGreaterThan(0);
    }
    expect(rules.find((r) => r.action === "deny")?.pattern).toBe(rules.find((r) => r.action === "ask")?.pattern);
  });

  it("disabled edit-family can be restored by a later edit * allow", () => {
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "allow" },
    ];
    const removed = disabled(["edit", "write", "apply_patch", "multiedit", "bash"], ruleset);
    expect(removed.size).toBe(0);
  });

  it("evaluate returns synthetic ask rule with original permission when no match", () => {
    const rule = evaluate("custom_perm", "payload", []);
    expect(rule).toEqual({ action: "ask", permission: "custom_perm", pattern: "*" });
  });

  it("merge flattens empty and non-empty rulesets without dropping later rules", () => {
    const a: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [];
    const c: PermissionRuleset = [{ permission: "bash", pattern: "rm *", action: "deny" }];
    const merged = merge(a, b, c);
    expect(merged).toHaveLength(2);
    expect(evaluate("bash", "rm -rf x", merged).action).toBe("deny");
    expect(evaluate("bash", "echo x", merged).action).toBe("allow");
  });

  // wave-155 residual
  it("fromConfig expands string actions to * pattern and preserves order of object patterns", () => {
    const rules = fromConfig({
      bash: "allow",
      read: { "*.ts": "allow", "*.env": "ask", "*": "deny" },
    });
    expect(rules[0]).toEqual({ permission: "bash", pattern: "*", action: "allow" });
    expect(rules.map((r) => r.pattern)).toEqual(["*", "*.ts", "*.env", "*"]);
    // last match for read of x.env is deny from trailing *
    expect(evaluate("read", "x.env", rules).action).toBe("deny");
    // but when only *.env ask is later than *.ts, env still ask if no trailing *
    const ordered = fromConfig({ read: { "*": "allow", "*.env": "ask" } });
    expect(evaluate("read", ".env", ordered).action).toBe("ask");
    expect(evaluate("read", "a.ts", ordered).action).toBe("allow");
  });

  it("evaluate last-match wins across multiple ruleset arguments", () => {
    const early: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const late: PermissionRuleset = [{ permission: "bash", pattern: "rm *", action: "deny" }];
    expect(evaluate("bash", "rm -rf x", early, late).action).toBe("deny");
    expect(evaluate("bash", "echo hi", early, late).action).toBe("allow");
  });

  it("disabled only removes tools with full-star deny as last matching rule", () => {
    // later non-* rule for same permission means tool stays available for runtime ask
    const partially: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "git *", action: "allow" },
    ];
    const partialRemoved = disabled(["bash", "read"], partially);
    // reverse walk hits permission=bash pattern=git * first → not full-star deny
    expect(partialRemoved.has("bash")).toBe(false);
    expect(partialRemoved.has("read")).toBe(false);

    const fullDeny: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
    ];
    expect(disabled(["bash", "read"], fullDeny).has("bash")).toBe(true);
    expect(disabled(["bash", "read"], fullDeny).has("read")).toBe(false);
  });

  it("EDIT_TOOLS list is stable for edit-family denial", () => {
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
    ];
    const removed = disabled([...EDIT_TOOLS, "bash"], ruleset);
    for (const tool of EDIT_TOOLS) {
      expect(removed.has(tool)).toBe(true);
    }
    expect(removed.has("bash")).toBe(false);
  });

  // wave-164 residual
  it("disabled returns empty set for empty tools or empty ruleset", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
    ];
    expect(disabled([], ruleset).size).toBe(0);
    expect(disabled(["bash", "read"], []).size).toBe(0);
  });

  it("disabled does not remove tools when last matching rule is ask or allow", () => {
    const askOnly: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "ask" },
    ];
    expect(disabled(["bash"], askOnly).has("bash")).toBe(false);

    const allowOnly: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "allow" },
    ];
    expect(disabled(["bash"], allowOnly).has("bash")).toBe(false);
  });

  it("disabled matches permission wildcards the same way evaluate does", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash*", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["bash", "bash-tool", "read"], ruleset);
    expect(removed.has("bash")).toBe(true);
    expect(removed.has("bash-tool")).toBe(true);
    expect(removed.has("read")).toBe(false);
  });

  it("evaluate requires both permission and pattern to match", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "rm *", action: "deny" },
    ];
    // permission matches, pattern does not
    expect(evaluate("bash", "echo hi", ruleset).action).toBe("ask");
    // pattern matches, permission does not
    expect(evaluate("read", "rm -rf x", ruleset).action).toBe("ask");
    expect(evaluate("bash", "rm -rf x", ruleset).action).toBe("deny");
  });

  it("merge with no arguments yields empty ruleset and evaluate falls back to ask", () => {
    expect(merge()).toEqual([]);
    expect(evaluate("bash", "ls", merge()).action).toBe("ask");
  });

  // wave-183 residual
  it("fromConfig on empty object yields empty ruleset; string action always pattern *", () => {
    expect(fromConfig({})).toEqual([]);
    expect(fromConfig({ bash: "allow" })).toEqual([
      { permission: "bash", action: "allow", pattern: "*" },
    ]);
  });

  it("disabled ignores non-star deny even when last rule; later * deny removes edit-family", () => {
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*.env", action: "deny" },
      { permission: "edit", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["edit", "write", "read"], ruleset);
    expect(removed.has("edit")).toBe(true);
    expect(removed.has("write")).toBe(true);
    expect(removed.has("read")).toBe(false);
  });

  it("disabled later allow after deny keeps tool; evaluate still uses last match for runtime", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ];
    expect(disabled(["bash"], ruleset).has("bash")).toBe(false);
    expect(evaluate("bash", "rm -rf /", ruleset).action).toBe("allow");
  });

  it("evaluate default ask rule uses the queried permission and pattern *", () => {
    const rule = evaluate("custom_tool", "path/x", []);
    expect(rule).toEqual({ action: "ask", permission: "custom_tool", pattern: "*" });
  });


  // wave-215 residual
  it("evaluate flattens multiple rulesets and last match still wins across sets", () => {
    const a: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "allow" },
    ];
    const b: PermissionRuleset = [
      { permission: "bash", pattern: "rm *", action: "deny" },
    ];
    const c: PermissionRuleset = [
      { permission: "bash", pattern: "rm -rf /tmp", action: "allow" },
    ];
    expect(evaluate("bash", "rm -rf /tmp", a, b, c).action).toBe("allow");
    expect(evaluate("bash", "rm -rf /", a, b).action).toBe("deny");
    expect(evaluate("bash", "ls", a, b).action).toBe("allow");
  });

  it("fromConfig expands ~/ and $HOME patterns via homedir", () => {
    const rules = fromConfig({
      read: {
        "~/.ssh/*": "deny",
        "$HOME/.npmrc": "ask",
        "~": "allow",
      },
    });
    const homeRule = rules.find((r) => r.action === "allow");
    expect(homeRule?.pattern.includes("~")).toBe(false);
    expect(homeRule?.pattern.length).toBeGreaterThan(0);
    const ssh = rules.find((r) => r.action === "deny");
    expect(ssh?.pattern.includes(".ssh")).toBe(true);
    expect(ssh?.pattern.startsWith("~")).toBe(false);
    const npmrc = rules.find((r) => r.action === "ask");
    expect(npmrc?.pattern.endsWith(".npmrc")).toBe(true);
    expect(npmrc?.pattern.includes("$HOME")).toBe(false);
  });

  it("disabled only star-deny; EDIT_TOOLS alias applies write/multiedit via edit permission", () => {
    expect(EDIT_TOOLS).toEqual(expect.arrayContaining(["edit", "write", "apply_patch", "multiedit"]));
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["edit", "write", "apply_patch", "multiedit", "bash", "read"], ruleset);
    expect([...removed].sort()).toEqual(["apply_patch", "edit", "multiedit", "write"].sort());
    expect(removed.has("bash")).toBe(false);
    expect(removed.has("read")).toBe(false);
  });

  it("disabled uses last matching rule only; non-star deny never removes tool", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ];
    expect(disabled(["bash"], ruleset).has("bash")).toBe(false);
    const starLast: PermissionRuleset = [
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ];
    expect(disabled(["bash"], starLast).has("bash")).toBe(true);
  });


  // wave-223 residual
  it("evaluate matches permission wildcards and returns default ask rule object", () => {
    const ruleset: PermissionRuleset = [
      { permission: "bash*", pattern: "rm *", action: "deny" },
      { permission: "read", pattern: "*.env", action: "ask" },
    ];
    expect(evaluate("bash", "rm -rf x", ruleset).action).toBe("deny");
    expect(evaluate("bashx", "rm -rf x", ruleset).action).toBe("deny");
    const fallback = evaluate("network", "https://x", []);
    expect(fallback).toEqual({ action: "ask", permission: "network", pattern: "*" });
  });

  it("fromConfig expands ~ and $HOME patterns; merge flattens left-to-right", async () => {
    const { homedir } = await import("os");
    const home = homedir();
    const rules = fromConfig({
      read: {
        "~/secrets/*": "deny",
        "$HOME/.ssh/*": "deny",
        "~": "ask",
      },
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        { permission: "read", pattern: `${home}/secrets/*`, action: "deny" },
        { permission: "read", pattern: `${home}/.ssh/*`, action: "deny" },
        { permission: "read", pattern: home, action: "ask" },
      ]),
    );
    const a: PermissionRuleset = [{ permission: "a", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [{ permission: "b", pattern: "*", action: "deny" }];
    expect(merge(a, b, a)).toEqual([...a, ...b, ...a]);
  });

  it("disabled treats EDIT_TOOLS under edit deny; tool-specific allow after group deny wins for list", () => {
    const ruleset: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "allow" },
    ];
    const removed = disabled(["edit", "write", "bash"], ruleset);
    expect(removed.has("edit")).toBe(true);
    // last matching for write is allow with * → not disabled
    expect(removed.has("write")).toBe(false);
    expect(removed.has("bash")).toBe(false);
  });

  // wave-236 residual
  it("evaluate last-match across multiple ruleset args; empty permission uses default ask", () => {
    const early: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const late: PermissionRuleset = [{ permission: "bash", pattern: "rm *", action: "deny" }];
    expect(evaluate("bash", "rm -rf x", early, late).action).toBe("deny");
    expect(evaluate("bash", "ls", early, late).action).toBe("allow");
    expect(evaluate("", "*", [])).toEqual({ action: "ask", permission: "", pattern: "*" });
  });

  it("fromConfig string action becomes pattern *; EDIT_TOOLS list is stable", () => {
    expect(fromConfig({ bash: "deny" })).toEqual([
      { permission: "bash", pattern: "*", action: "deny" },
    ]);
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
    const denied = disabled([...EDIT_TOOLS, "bash"], fromConfig({ edit: "deny" }));
    for (const tool of EDIT_TOOLS) {
      expect(denied.has(tool)).toBe(true);
    }
    expect(denied.has("bash")).toBe(false);
  });

  it("disabled ignores non-star deny patterns so tool stays available", () => {
    const ruleset: PermissionRuleset = [
      { permission: "read", pattern: "*.env", action: "deny" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ];
    const removed = disabled(["read", "bash", "write"], ruleset);
    expect(removed.has("read")).toBe(false);
    expect(removed.has("bash")).toBe(false);
    expect(removed.has("write")).toBe(false);
  });

  // wave-247 residual
  it("fromConfig expands ~/ and $HOME patterns; merge flattens in order", () => {
    const rules = fromConfig({
      read: { "~/secret": "deny", "$HOME/docs/*": "ask", "*": "allow" },
    });
    const home = require("os").homedir().replace(/\\/g, "/");
    const patterns = rules.map((r) => r.pattern.replace(/\\/g, "/"));
    expect(patterns.some((p) => p.startsWith(home) && p.endsWith("/secret"))).toBe(true);
    expect(patterns.some((p) => p.startsWith(home) && p.includes("/docs/"))).toBe(true);
    expect(patterns).toContain("*");
    const a: PermissionRuleset = [{ permission: "a", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [{ permission: "b", pattern: "*", action: "deny" }];
    expect(merge(a, b)).toEqual([...a, ...b]);
    expect(merge()).toEqual([]);
  });

  it("evaluate default ask when no match; permission wildcard last-wins; disabled star-deny only", () => {
    expect(evaluate("unknown_tool", "path", []).action).toBe("ask");
    const rules: PermissionRuleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "deny" },
    ];
    expect(evaluate("bash", "ls", rules).action).toBe("deny");
    expect(evaluate("read", "x", rules).action).toBe("allow");
    const removed = disabled(["bash", "read"], rules);
    expect(removed.has("bash")).toBe(true);
    expect(removed.has("read")).toBe(false);
  });

  // wave-264 residual
  it("EDIT_TOOLS is the four edit-class names; disabled star-deny removes them", () => {
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
    const ruleset: PermissionRuleset = [
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "deny" },
    ];
    const removed = disabled(["write", "edit", "bash", "read"], ruleset);
    expect(removed.has("write")).toBe(true);
    expect(removed.has("edit")).toBe(true);
    expect(removed.has("bash")).toBe(false);
    expect(removed.has("read")).toBe(false);
  });

  it("merge concatenates left-to-right; later evaluate last-wins on same permission", () => {
    const early: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const late: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "deny" }];
    const rules = merge(early, late);
    expect(rules).toHaveLength(2);
    expect(evaluate("bash", "ls", rules).action).toBe("deny");
    expect(evaluate("bash", "ls", merge(late, early)).action).toBe("allow");
  });


  // wave-274 residual
  it("EDIT_TOOLS share edit permission for disabled; tool-specific rule after group wins evaluate", () => {
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
    // edit: deny removes all EDIT_TOOLS even when tool name is write
    const groupDeny = fromConfig({ edit: "deny" });
    const removed = disabled(["write", "apply_patch", "multiedit", "bash"], groupDeny);
    expect(removed.has("write")).toBe(true);
    expect(removed.has("apply_patch")).toBe(true);
    expect(removed.has("multiedit")).toBe(true);
    expect(removed.has("bash")).toBe(false);

    // last matching rule wins for evaluate on write path
    const rules: PermissionRuleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "allow" },
    ];
    expect(evaluate("write", "src/a.ts", rules).action).toBe("allow");
    // disabled uses last matching rule for the tool; write-specific allow keeps write
    const rem2 = disabled(["write", "edit"], rules);
    expect(rem2.has("write")).toBe(false);
    expect(rem2.has("edit")).toBe(true);
  });

  it("fromConfig expands bare ~ and $HOME; evaluate accepts varargs rulesets last-wins", () => {
    const rules = fromConfig({
      read: { "~": "deny", "$HOME": "ask" },
    });
    const home = require("os").homedir().replace(/\\/g, "/");
    const patterns = rules.map((r) => r.pattern.replace(/\\/g, "/"));
    expect(patterns).toContain(home);
    // both expand to homedir
    expect(patterns.filter((p) => p === home).length).toBe(2);

    const early: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const mid: PermissionRuleset = [{ permission: "bash", pattern: "rm *", action: "deny" }];
    const late: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "ask" }];
    expect(evaluate("bash", "rm -rf /", early, mid, late).action).toBe("ask");
    expect(evaluate("bash", "rm -rf /", late, mid).action).toBe("deny");
    expect(fromConfig({})).toEqual([]);
  });

  // wave-283 residual
  it("default ask rule when no match; merge flattens preserving order for last-wins", () => {
    const none = evaluate("bash", "echo hi");
    expect(none).toEqual({ action: "ask", permission: "bash", pattern: "*" });

    const a: PermissionRuleset = [{ permission: "bash", pattern: "*", action: "allow" }];
    const b: PermissionRuleset = [{ permission: "bash", pattern: "rm *", action: "deny" }];
    const merged = merge(a, b, a);
    expect(merged).toHaveLength(3);
    expect(evaluate("bash", "rm -rf x", merged).action).toBe("allow");
    expect(evaluate("bash", "rm -rf x", a, b).action).toBe("deny");
  });

  it("disabled requires pattern * deny; non-star deny keeps tool; EDIT_TOOLS exact list", () => {
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
    const rules: PermissionRuleset = [
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "edit", pattern: "*.env", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
    ];
    const rem = disabled(["bash", "edit", "write", "read"], rules);
    expect(rem.has("bash")).toBe(false); // pattern not *
    expect(rem.has("edit")).toBe(false); // pattern not *
    expect(rem.has("write")).toBe(true);
    expect(rem.has("read")).toBe(false);
  });




  // wave-297 residual
  it("evaluate last matching rule wins across permission and pattern wildcards", () => {
    const rules: PermissionRuleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "bash", pattern: "rm -rf *", action: "ask" },
    ];
    expect(evaluate("bash", "rm -rf /tmp/x", rules).action).toBe("ask");
    expect(evaluate("bash", "rm file", rules).action).toBe("deny");
    expect(evaluate("read", "any", rules).action).toBe("allow");
  });

  it("fromConfig string actions become pattern *; nested map expands patterns", () => {
    const rules = fromConfig({
      bash: "deny",
      read: { "*.env": "ask", "src/**": "allow" },
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*.env", action: "ask" },
        { permission: "read", pattern: "src/**", action: "allow" },
      ]),
    );
    expect(evaluate("bash", "echo", fromConfig({ bash: "deny" })).action).toBe("deny");
  });

  it("disabled removes full EDIT_TOOLS family when edit * is deny", () => {
    const rules: PermissionRuleset = [{ permission: "edit", pattern: "*", action: "deny" }];
    const tools = ["edit", "write", "apply_patch", "multiedit", "read", "bash"];
    const rem = disabled(tools, rules);
    expect(rem.has("edit")).toBe(true);
    expect(rem.has("write")).toBe(true);
    expect(rem.has("apply_patch")).toBe(true);
    expect(rem.has("multiedit")).toBe(true);
    expect(rem.has("read")).toBe(false);
    expect(rem.has("bash")).toBe(false);
    expect(EDIT_TOOLS).toEqual(["edit", "write", "apply_patch", "multiedit"]);
  });

});
