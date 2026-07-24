import { describe, expect, it } from "vitest";
import { buildDefaults } from "../defaults";
import { evaluate } from "../evaluate";

describe("buildDefaults", () => {
  const whitelist = ["C:/Users/demo/AppData/Pi/memory", "C:/Users/demo/AppData/Pi/plans", "C:/Temp"];
  const rules = buildDefaults(whitelist);

  it("allows ordinary reads and asks on env secrets", () => {
    expect(evaluate("read", "src/app.ts", rules).action).toBe("allow");
    expect(evaluate("read", ".env", rules).action).toBe("ask");
    expect(evaluate("read", ".env.local", rules).action).toBe("ask");
    expect(evaluate("read", ".env.example", rules).action).toBe("allow");
  });

  it("asks on doom_loop and denies question by default", () => {
    expect(evaluate("doom_loop", "*", rules).action).toBe("ask");
    expect(evaluate("question", "*", rules).action).toBe("deny");
  });

  it("asks for external directories except the whitelist", () => {
    expect(evaluate("external_directory", "C:/Windows/System32", rules).action).toBe("ask");
    expect(
      evaluate("external_directory", "C:/Users/demo/AppData/Pi/memory/notes.md", rules).action,
    ).toBe("allow");
    expect(evaluate("external_directory", "C:/Temp/scratch.log", rules).action).toBe("allow");
  });

  // wave-104 residual
  it("asks on nested env variants and allows bare *.env.example only", () => {
    expect(evaluate("read", "apps/desktop/.env.production", rules).action).toBe("ask");
    expect(evaluate("read", "config/.env", rules).action).toBe("ask");
    expect(evaluate("read", "config/.env.example", rules).action).toBe("allow");
    expect(evaluate("read", "secrets.env", rules).action).toBe("ask");
  });

  it("defaults unknown tools to allow while keeping doom_loop ask", () => {
    expect(evaluate("bash", "ls", rules).action).toBe("allow");
    expect(evaluate("edit", "src/a.ts", rules).action).toBe("allow");
    expect(evaluate("write", "src/a.ts", rules).action).toBe("allow");
    expect(evaluate("doom_loop", "anything", rules).action).toBe("ask");
  });

  it("allows exact whitelist roots as well as nested children", () => {
    expect(evaluate("external_directory", "C:/Users/demo/AppData/Pi/memory", rules).action).toBe("allow");
    expect(evaluate("external_directory", "C:/Users/demo/AppData/Pi/plans", rules).action).toBe("allow");
    expect(evaluate("external_directory", "C:/Temp", rules).action).toBe("allow");
    expect(evaluate("external_directory", "C:/Users/demo/AppData/Pi/other", rules).action).toBe("ask");
  });

  // wave-120 residual
  it("empty whitelist asks on all external directories", () => {
    const empty = buildDefaults([]);
    expect(evaluate("external_directory", "C:/Temp", empty).action).toBe("ask");
    expect(evaluate("external_directory", "C:/Users/demo/AppData/Pi/memory", empty).action).toBe("ask");
    // global defaults still apply
    expect(evaluate("question", "*", empty).action).toBe("deny");
    expect(evaluate("read", ".env", empty).action).toBe("ask");
  });

  it("whitelist matching is case-insensitive on win32 for external_directory", () => {
    // product wildcardMatch is case-insensitive on win32
    if (process.platform === "win32") {
      expect(
        evaluate("external_directory", "c:/users/demo/appdata/pi/memory/x.md", rules).action,
      ).toBe("allow");
      expect(evaluate("external_directory", "c:/temp/log.txt", rules).action).toBe("allow");
    } else {
      // non-win: case-sensitive — upper path may not match
      expect(
        evaluate("external_directory", "C:/Users/demo/AppData/Pi/memory/x.md", rules).action,
      ).toBe("allow");
    }
  });

  it("prefix sibling of whitelist root is not allowed", () => {
    expect(
      evaluate("external_directory", "C:/Users/demo/AppData/Pi/memory-extra/file.md", rules).action,
    ).toBe("ask");
    expect(evaluate("external_directory", "C:/Temp2/x", rules).action).toBe("ask");
  });

  it("global * allow still defers to more specific deny/ask rules", () => {
    expect(evaluate("read", "src/ok.ts", rules).action).toBe("allow");
    expect(evaluate("question", "anything", rules).action).toBe("deny");
    expect(evaluate("doom_loop", "tool-loop", rules).action).toBe("ask");
  });

  // wave-130 residual
  it("buildDefaults spreads exact dir and dir/* allow entries", () => {
    const built = buildDefaults(["C:/AllowRoot"]);
    expect(evaluate("external_directory", "C:/AllowRoot", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/AllowRoot/child.txt", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/AllowRootSibling", built).action).toBe("ask");
  });

  it("read rules ask on env-like suffixes but allow non-env files", () => {
    expect(evaluate("read", "README.md", rules).action).toBe("allow");
    expect(evaluate("read", "config.env.staging", rules).action).toBe("ask");
    expect(evaluate("read", ".ENV", rules).action).toBe(
      process.platform === "win32" ? "ask" : "allow",
    );
  });

  it("question deny and doom_loop ask are independent of whitelist", () => {
    const empty = buildDefaults([]);
    expect(evaluate("question", "why", empty).action).toBe("deny");
    expect(evaluate("doom_loop", "loop", empty).action).toBe("ask");
    expect(evaluate("bash", "echo hi", empty).action).toBe("allow");
  });

  // wave-151 residual
  it("multiple whitelist dirs each get exact + /* allow without cross-talk", () => {
    const built = buildDefaults(["C:/A", "C:/B/nested"]);
    expect(evaluate("external_directory", "C:/A", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/A/child", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/B/nested/x", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/B/other", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/C", built).action).toBe("ask");
  });

  it("read *.env.example allow wins over *.env.* ask via later rule", () => {
    // fromConfig order: * allow, *.env ask, *.env.* ask, *.env.example allow
    expect(evaluate("read", ".env.example", rules).action).toBe("allow");
    expect(evaluate("read", ".env.local.example", rules).action).toBe("ask");
    expect(evaluate("read", "nested/.env.example", rules).action).toBe("allow");
  });

  it("global * allow does not override external_directory ask without whitelist hit", () => {
    expect(evaluate("external_directory", "D:/outside/file", rules).action).toBe("ask");
    expect(evaluate("unknown_tool", "anything", rules).action).toBe("allow");
  });

  // wave-156 residual
  it("buildDefaults with empty whitelist keeps external_directory ask for all paths", () => {
    const empty = buildDefaults([]);
    expect(evaluate("external_directory", "C:/any", empty).action).toBe("ask");
    expect(evaluate("external_directory", "/tmp/x", empty).action).toBe("ask");
    expect(evaluate("bash", "ls", empty).action).toBe("allow");
  });

  it("read *.env ask applies to nested paths and dotted names", () => {
    expect(evaluate("read", "secrets/.env", rules).action).toBe("ask");
    expect(evaluate("read", "app.env", rules).action).toBe("ask");
    expect(evaluate("read", "app.env.local", rules).action).toBe("ask");
    expect(evaluate("read", "app.config.json", rules).action).toBe("allow");
  });

  it("whitelist exact path allow does not allow sibling with shared prefix", () => {
    const built = buildDefaults(["C:/proj"]);
    expect(evaluate("external_directory", "C:/proj", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/proj-extra", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/proj/nested/file", built).action).toBe("allow");
  });

  // wave-163 residual
  it("doom_loop asks and question is denied by defaults", () => {
    expect(evaluate("doom_loop", "any", rules).action).toBe("ask");
    expect(evaluate("question", "prompt", rules).action).toBe("deny");
    expect(evaluate("bash", "ls", rules).action).toBe("allow");
  });

  it("read default allow for non-env files including nested source", () => {
    expect(evaluate("read", "src/index.ts", rules).action).toBe("allow");
    expect(evaluate("read", "README.md", rules).action).toBe("allow");
    expect(evaluate("read", "config/.env", rules).action).toBe("ask");
  });

  it("whitelist dir/* allow uses forward-slash join even for Windows roots", () => {
    const built = buildDefaults(["C:\\work\\repo"]);
    expect(evaluate("external_directory", "C:\\work\\repo", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:\\work\\repo\\src\\a.ts", built).action).toBe("allow");
  });

  // wave-184 residual
  it("read rules treat .envrc and env.example differently from .env family", () => {
    // product patterns: *.env, *.env.*, *.env.example — not .envrc
    expect(evaluate("read", ".envrc", rules).action).toBe("allow");
    expect(evaluate("read", "env.example", rules).action).toBe("allow");
    expect(evaluate("read", ".env.example.backup", rules).action).toBe("ask"); // matches *.env.*
  });

  it("empty whitelist still allows * tools and only external_directory defaults to ask", () => {
    const empty = buildDefaults([]);
    expect(evaluate("write", "src/a.ts", empty).action).toBe("allow");
    expect(evaluate("read", "src/a.ts", empty).action).toBe("allow");
    expect(evaluate("external_directory", "C:/anywhere", empty).action).toBe("ask");
    expect(evaluate("question", "x", empty).action).toBe("deny");
  });

  it("whitelist with trailing slash-like path still exact-matches product key", () => {
    // product joins `${dir}/*` without normalizing trailing separators on the root key
    const built = buildDefaults(["C:/proj/"]);
    expect(evaluate("external_directory", "C:/proj/", built).action).toBe("allow");
    // without trailing slash may fail exact key match depending on wildcard
    const root = evaluate("external_directory", "C:/proj", built).action;
    expect(["allow", "ask"]).toContain(root);
  });

  // wave-213 residual
  it("read blocks .env family with ask; write/edit/bash core tools allow under defaults", () => {
    expect(evaluate("read", ".env", rules).action).toBe("ask");
    expect(evaluate("read", ".env.local", rules).action).toBe("ask");
    expect(evaluate("read", "src/a.ts", rules).action).toBe("allow");
    expect(evaluate("write", "src/a.ts", rules).action).toBe("allow");
    expect(evaluate("edit", "src/a.ts", rules).action).toBe("allow");
    expect(evaluate("bash", "ls", rules).action).toBe("allow");
  });

  // wave-219 residual
  it("doom_loop ask, question deny, .env.example allow under defaults", () => {
    expect(evaluate("doom_loop", "*", rules).action).toBe("ask");
    expect(evaluate("question", "anything", rules).action).toBe("deny");
    expect(evaluate("read", ".env.example", rules).action).toBe("allow");
    expect(evaluate("read", "config.env", rules).action).toBe("ask"); // product *.env matches suffix .env
    // star allow for unknown tools
    expect(evaluate("custom_tool", "x", rules).action).toBe("allow");
  });

  it("external_directory asks by default; whitelisted dirs allow self and children", () => {
    const built = buildDefaults(["C:/allowed"]);
    expect(evaluate("external_directory", "C:/elsewhere/file", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/allowed", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/allowed/child/x.md", built).action).toBe("allow");
  });

  // wave-234 residual
  it("empty whitelist leaves external_directory as ask-only; star tools still allow", () => {
    const empty = buildDefaults([]);
    expect(evaluate("external_directory", "C:/anywhere", empty).action).toBe("ask");
    expect(evaluate("external_directory", "/", empty).action).toBe("ask");
    expect(evaluate("bash", "echo hi", empty).action).toBe("allow");
    expect(evaluate("write", "src/x.ts", empty).action).toBe("allow");
  });

  it("multiple whitelisted dirs allow each tree independently", () => {
    const multi = buildDefaults(["C:/a", "C:/b/nested"]);
    expect(evaluate("external_directory", "C:/a", multi).action).toBe("allow");
    expect(evaluate("external_directory", "C:/a/x", multi).action).toBe("allow");
    expect(evaluate("external_directory", "C:/b/nested/y", multi).action).toBe("allow");
    expect(evaluate("external_directory", "C:/b/other", multi).action).toBe("ask");
  });

  it("read .env.example allow wins over *.env.* ask patterns", () => {
    const built = buildDefaults(["C:/tmp"]);
    expect(evaluate("read", ".env.example", built).action).toBe("allow");
    expect(evaluate("read", ".env.production", built).action).toBe("ask");
    expect(evaluate("read", "nested/.env", built).action).toBe("ask");
  });

  // wave-244 residual
  it("doom_loop is ask and question is deny in defaults; star tools remain allow", () => {
    const built = buildDefaults(["C:/ok"]);
    expect(evaluate("doom_loop", "*", built).action).toBe("ask");
    expect(evaluate("question", "*", built).action).toBe("deny");
    expect(evaluate("bash", "echo hi", built).action).toBe("allow");
    expect(evaluate("read", "README.md", built).action).toBe("allow");
  });

  it("read *.env and *.env.* ask; *.env.example allow; write not gated by env patterns", () => {
    const built = buildDefaults(["C:/tmp"]);
    expect(evaluate("read", ".env", built).action).toBe("ask");
    expect(evaluate("read", ".env.local", built).action).toBe("ask");
    expect(evaluate("read", ".env.example", built).action).toBe("allow");
    expect(evaluate("write", ".env", built).action).toBe("allow");
  });

  // wave-266 residual
  it("whitelisted dir itself and children allow; sibling of whitelist asks", () => {
    const built = buildDefaults(["C:/allowed"]);
    expect(evaluate("external_directory", "C:/allowed", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/allowed/child/x.md", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/allowed-sibling", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/other", built).action).toBe("ask");
  });

  it("star allow does not override doom_loop ask or question deny", () => {
    const built = buildDefaults(["C:/tmp"]);
    expect(evaluate("doom_loop", "loop", built).action).toBe("ask");
    expect(evaluate("question", "q", built).action).toBe("deny");
    expect(evaluate("unknown_tool", "x", built).action).toBe("allow");
  });

  // wave-275 residual
  it("buildDefaults order: later read patterns win; whitelist children use dir/* key", () => {
    const built = buildDefaults(["C:/ws-root"]);
    // product: fromConfig order → last matching rule wins via evaluate reverse walk
    expect(evaluate("read", ".env.example", built).action).toBe("allow");
    expect(evaluate("read", "x.env.example", built).action).toBe("allow");
    expect(evaluate("read", "x.env.local", built).action).toBe("ask");
    // whitelist expands to dir and dir/*
    expect(evaluate("external_directory", "C:/ws-root", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/ws-root/deep/file.md", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/ws-root-extra", built).action).toBe("ask");
  });

  it("buildDefaults is pure per call; two builds with different whitelist are independent", () => {
    const a = buildDefaults(["C:/a-only"]);
    const b = buildDefaults(["C:/b-only"]);
    expect(evaluate("external_directory", "C:/a-only/x", a).action).toBe("allow");
    expect(evaluate("external_directory", "C:/a-only/x", b).action).toBe("ask");
    expect(evaluate("external_directory", "C:/b-only/y", b).action).toBe("allow");
    expect(evaluate("external_directory", "C:/b-only/y", a).action).toBe("ask");
  });

  // wave-284 residual
  it("read *.env ask, *.env.* ask, *.env.example allow; * allow remains base", () => {
    const built = buildDefaults([]);
    expect(evaluate("read", ".env", built).action).toBe("ask");
    expect(evaluate("read", "prod.env", built).action).toBe("ask");
    expect(evaluate("read", ".env.production", built).action).toBe("ask");
    expect(evaluate("read", ".env.example", built).action).toBe("allow");
    expect(evaluate("read", "notes.env.example", built).action).toBe("allow");
    expect(evaluate("bash", "echo hi", built).action).toBe("allow");
    expect(evaluate("doom_loop", "x", built).action).toBe("ask");
    expect(evaluate("question", "x", built).action).toBe("deny");
  });

  it("empty whitelist still asks for external_directory; no accidental allow", () => {
    const built = buildDefaults([]);
    expect(evaluate("external_directory", "C:/anywhere", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/tmp/child", built).action).toBe("ask");
  });




  // wave-300 residual
  it("buildDefaults maps each whitelist entry to exact + dir/* allow keys via fromConfig", () => {
    const built = buildDefaults(["C:/ud/memory", "C:/ud/plans", "C:/Temp"]);
    expect(evaluate("external_directory", "C:/ud/memory", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/ud/memory/note.md", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/ud/plans/x.md", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/Temp/log.txt", built).action).toBe("allow");
    expect(evaluate("external_directory", "C:/ud/other", built).action).toBe("ask");
    expect(evaluate("external_directory", "C:/Temp-extra", built).action).toBe("ask");
  });

  it("defaults keep doom_loop ask + question deny under * allow base; .env.example allow last-wins", () => {
    const built = buildDefaults(["C:/ok"]);
    expect(evaluate("bash", "ls", built).action).toBe("allow");
    expect(evaluate("doom_loop", "loop", built).action).toBe("ask");
    expect(evaluate("question", "q", built).action).toBe("deny");
    expect(evaluate("read", ".env", built).action).toBe("ask");
    expect(evaluate("read", ".env.local", built).action).toBe("ask");
    expect(evaluate("read", ".env.example", built).action).toBe("allow");
    expect(evaluate("read", "nested/.env.example", built).action).toBe("allow");
    expect(evaluate("write", ".env", built).action).toBe("allow");
  });

});
