import { describe, expect, it } from "vitest";
import { projectScriptCommand } from "./project-scripts";

describe("projectScriptCommand", () => {
  it("formats yarn without run", () => {
    expect(projectScriptCommand("yarn", "dev")).toBe("yarn dev");
  });

  it("formats bun with run", () => {
    expect(projectScriptCommand("bun", "test")).toBe("bun run test");
  });

  it("formats pnpm without run", () => {
    expect(projectScriptCommand("pnpm", "lint")).toBe("pnpm lint");
  });

  it("defaults npm with run for npm and unknown managers", () => {
    expect(projectScriptCommand("npm", "build")).toBe("npm run build");
    expect(projectScriptCommand(undefined, "start")).toBe("npm run start");
    expect(projectScriptCommand("unknown" as "npm", "start")).toBe("npm run start");
  });

  // wave-109 residual
  it("preserves script names that include spaces or colons", () => {
    expect(projectScriptCommand("pnpm", "typecheck:watch")).toBe("pnpm typecheck:watch");
    expect(projectScriptCommand("npm", "test:unit")).toBe("npm run test:unit");
    expect(projectScriptCommand("yarn", "build:prod")).toBe("yarn build:prod");
    expect(projectScriptCommand("bun", "e2e:build")).toBe("bun run e2e:build");
  });

  // wave-125 residual
  it("formats empty script names and cargo/go/pip managers as npm run fallback", () => {
    expect(projectScriptCommand("pnpm", "")).toBe("pnpm ");
    expect(projectScriptCommand("yarn", "")).toBe("yarn ");
    expect(projectScriptCommand("bun", "")).toBe("bun run ");
    expect(projectScriptCommand("npm", "")).toBe("npm run ");
    expect(projectScriptCommand("pip" as "npm", "install")).toBe("npm run install");
    expect(projectScriptCommand("cargo" as "npm", "build")).toBe("npm run build");
    expect(projectScriptCommand("go" as "npm", "test")).toBe("npm run test");
  });

  // wave-128 residual
  it("keeps manager-specific prefixes for multi-segment script names", () => {
    expect(projectScriptCommand("pnpm", "test --filter desktop")).toBe("pnpm test --filter desktop");
    expect(projectScriptCommand("yarn", "workspace app build")).toBe("yarn workspace app build");
    expect(projectScriptCommand("bun", "test --bail")).toBe("bun run test --bail");
    expect(projectScriptCommand("npm", "run already")).toBe("npm run run already");
  });

  // wave-143 residual
  it("falls back to npm run for nullish and non-JS package managers", () => {
    expect(projectScriptCommand(null as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("poetry" as never, "serve")).toBe("npm run serve");
  });

  it("preserves special characters and unicode in script names", () => {
    expect(projectScriptCommand("pnpm", "测试:全绿")).toBe("pnpm 测试:全绿");
    expect(projectScriptCommand("npm", "build:win32")).toBe("npm run build:win32");
    expect(projectScriptCommand("yarn", "lint --fix")).toBe("yarn lint --fix");
    expect(projectScriptCommand("bun", "ci:matrix")).toBe("bun run ci:matrix");
  });

  // wave-151 residual
  it("does not quote or escape script names with quotes or shell metacharacters", () => {
    // product is a pure prefix join — quoting is the caller's responsibility
    expect(projectScriptCommand("pnpm", 'echo "hi"')).toBe('pnpm echo "hi"');
    expect(projectScriptCommand("npm", "build && test")).toBe("npm run build && test");
    expect(projectScriptCommand("yarn", "a|b")).toBe("yarn a|b");
    expect(projectScriptCommand("bun", "x;y")).toBe("bun run x;y");
  });

  it("treats only exact yarn/bun/pnpm strings as special managers", () => {
    expect(projectScriptCommand("Yarn" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("PNPM" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("bun " as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("yarn", "dev")).toBe("yarn dev");
  });

  // wave-174 residual
  it("does not trim packageManager tokens (leading/trailing whitespace → npm run)", () => {
    expect(projectScriptCommand(" yarn" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("pnpm\n" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("bun\t" as never, "dev")).toBe("npm run dev");
  });

  it("preserves leading/trailing spaces inside script names without quoting", () => {
    expect(projectScriptCommand("pnpm", "  dev  ")).toBe("pnpm   dev  ");
    expect(projectScriptCommand("npm", "  build  ")).toBe("npm run   build  ");
    expect(projectScriptCommand("bun", "  test  ")).toBe("bun run   test  ");
  });

  it("keeps exact manager matrix for yarn/bun/pnpm/npm only", () => {
    expect(projectScriptCommand("yarn", "x")).toBe("yarn x");
    expect(projectScriptCommand("bun", "x")).toBe("bun run x");
    expect(projectScriptCommand("pnpm", "x")).toBe("pnpm x");
    expect(projectScriptCommand("npm", "x")).toBe("npm run x");
  });

  // wave-187 residual
  it("does not double-prefix when scriptName already starts with run", () => {
    expect(projectScriptCommand("npm", "run build")).toBe("npm run run build");
    expect(projectScriptCommand("bun", "run test")).toBe("bun run run test");
    expect(projectScriptCommand("pnpm", "run lint")).toBe("pnpm run lint");
    expect(projectScriptCommand("yarn", "run dev")).toBe("yarn run dev");
  });

  it("preserves Windows path-looking script names without quoting", () => {
    expect(projectScriptCommand("pnpm", "C:\\scripts\\build.ps1")).toBe("pnpm C:\\scripts\\build.ps1");
    expect(projectScriptCommand("npm", "./scripts/ci.sh")).toBe("npm run ./scripts/ci.sh");
  });

  it("treats undefined scriptName as string undefined via template", () => {
    // product: pure prefix join — no guard on scriptName
    expect(projectScriptCommand("pnpm", undefined as never)).toBe("pnpm undefined");
    expect(projectScriptCommand("npm", null as never)).toBe("npm run null");
  });

  // wave-200 residual
  it("numeric and boolean script names coerce via template join", () => {
    expect(projectScriptCommand("pnpm", 0 as never)).toBe("pnpm 0");
    expect(projectScriptCommand("npm", true as never)).toBe("npm run true");
    expect(projectScriptCommand("bun", false as never)).toBe("bun run false");
  });

  it("manager matrix is exhaustive for yarn/bun/pnpm vs npm-run fallback", () => {
    const matrix: Array<[string, string]> = [
      ["yarn", "yarn build"],
      ["bun", "bun run build"],
      ["pnpm", "pnpm build"],
      ["npm", "npm run build"],
      ["cnpm", "npm run build"],
      ["npx", "npm run build"],
    ];
    for (const [manager, expected] of matrix) {
      expect(projectScriptCommand(manager as never, "build")).toBe(expected);
    }
  });

  // wave-204 residual
  it("preserves script names with spaces and special chars without quoting", () => {
    expect(projectScriptCommand("pnpm", "test:unit")).toBe("pnpm test:unit");
    expect(projectScriptCommand("yarn", "lint --fix")).toBe("yarn lint --fix");
    expect(projectScriptCommand("npm", "build:prod")).toBe("npm run build:prod");
    expect(projectScriptCommand("bun", "ci:e2e")).toBe("bun run ci:e2e");
  });

  it("empty script name yields trailing space for yarn/pnpm and run for npm/bun", () => {
    expect(projectScriptCommand("yarn", "")).toBe("yarn ");
    expect(projectScriptCommand("pnpm", "")).toBe("pnpm ");
    expect(projectScriptCommand("npm", "")).toBe("npm run ");
    expect(projectScriptCommand("bun", "")).toBe("bun run ");
  });

  // wave-210 residual
  it("unknown managers fall through to npm run; null/undefined manager same", () => {
    expect(projectScriptCommand("pip" as never, "install")).toBe("npm run install");
    expect(projectScriptCommand(undefined as never, "test")).toBe("npm run test");
    expect(projectScriptCommand(null as never, "start")).toBe("npm run start");
  });

  it("unicode and path-like script names are not rewritten", () => {
    expect(projectScriptCommand("pnpm", "构建")).toBe("pnpm 构建");
    expect(projectScriptCommand("yarn", "path/to:script")).toBe("yarn path/to:script");
    expect(projectScriptCommand("npm", "prepublishOnly")).toBe("npm run prepublishOnly");
  });

  // wave-256 residual
  it("case-sensitive manager ids; Yarn/PNPM fall through to npm run", () => {
    expect(projectScriptCommand("Yarn" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("PNPM" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("Bun" as never, "dev")).toBe("npm run dev");
    expect(projectScriptCommand("yarn", "dev")).toBe("yarn dev");
  });

  it("scriptName is interpolated raw; no shell quoting/escaping", () => {
    expect(projectScriptCommand("pnpm", 'x && y')).toBe("pnpm x && y");
    expect(projectScriptCommand("npm", 'echo "hi"')).toBe('npm run echo "hi"');
    expect(projectScriptCommand("bun", "a\nb")).toBe("bun run a\nb");
  });

  // wave-267 residual
  it("known managers map to expected prefixes", () => {
    expect(projectScriptCommand("yarn", "build")).toBe("yarn build");
    expect(projectScriptCommand("bun", "build")).toBe("bun run build");
    expect(projectScriptCommand("pnpm", "build")).toBe("pnpm build");
    expect(projectScriptCommand("npm", "build")).toBe("npm run build");
  });

  it("whitespace-only scriptName is preserved after manager prefix", () => {
    expect(projectScriptCommand("pnpm", " ")).toBe("pnpm  ");
    expect(projectScriptCommand("npm", " ")).toBe("npm run  ");
    expect(projectScriptCommand("yarn", "  ")).toBe("yarn   ");
  });

  // wave-280 residual
  it("empty scriptName still prefixes manager; bun uses run", () => {
    expect(projectScriptCommand("pnpm", "")).toBe("pnpm ");
    expect(projectScriptCommand("npm", "")).toBe("npm run ");
    expect(projectScriptCommand("bun", "")).toBe("bun run ");
    expect(projectScriptCommand("yarn", "")).toBe("yarn ");
  });

  it("unknown manager always npm run; empty manager-like string too", () => {
    expect(projectScriptCommand("" as never, "test")).toBe("npm run test");
    expect(projectScriptCommand("cargo" as never, "build")).toBe("npm run build");
  });



  // wave-290 residual
  it("maps yarn/bun/pnpm/npm exactly; non-enum managers fall through to npm run", () => {
    expect(projectScriptCommand("yarn", "dev")).toBe("yarn dev");
    expect(projectScriptCommand("bun", "dev")).toBe("bun run dev");
    expect(projectScriptCommand("pnpm", "dev")).toBe("pnpm dev");
    expect(projectScriptCommand("npm", "dev")).toBe("npm run dev");
    expect(projectScriptCommand("pnpm", "test:unit")).toBe("pnpm test:unit");
    expect(projectScriptCommand("npm", "test:unit")).toBe("npm run test:unit");
    expect(projectScriptCommand("unknown" as never, "x")).toBe("npm run x");
  });

  it("script names with spaces/slashes are not sanitized by product", () => {
    expect(projectScriptCommand("pnpm", "lint --fix")).toBe("pnpm lint --fix");
    expect(projectScriptCommand("npm", "lint --fix")).toBe("npm run lint --fix");
    expect(projectScriptCommand("yarn", "workspace a build")).toBe("yarn workspace a build");
  });



  // wave-302 residual
  it("projectScriptCommand branches yarn/bun/pnpm then npm run default", () => {
    expect(projectScriptCommand("yarn", "start")).toBe("yarn start");
    expect(projectScriptCommand("bun", "start")).toBe("bun run start");
    expect(projectScriptCommand("pnpm", "start")).toBe("pnpm start");
    expect(projectScriptCommand("npm", "start")).toBe("npm run start");
    expect(projectScriptCommand("npm" as never, "prepublishOnly")).toBe("npm run prepublishOnly");
    expect(projectScriptCommand("deno" as never, "task")).toBe("npm run task");
  });

  it("does not quote or escape scriptName; empty remains trailing space after prefix", () => {
    expect(projectScriptCommand("pnpm", 'echo "hi"')).toBe('pnpm echo "hi"');
    expect(projectScriptCommand("bun", "x")).toBe("bun run x");
    expect(projectScriptCommand("yarn", "")).toBe("yarn ");
    expect(projectScriptCommand("npm", "")).toBe("npm run ");
  });


  // wave-317 residual
  it("yarn/pnpm omit run; bun/npm include run; unknown managers npm run", () => {
    expect(projectScriptCommand("yarn", "build")).toBe("yarn build");
    expect(projectScriptCommand("pnpm", "build")).toBe("pnpm build");
    expect(projectScriptCommand("bun", "build")).toBe("bun run build");
    expect(projectScriptCommand("npm", "build")).toBe("npm run build");
    expect(projectScriptCommand("pip" as never, "build")).toBe("npm run build");
    expect(projectScriptCommand("cargo" as never, "build")).toBe("npm run build");
  });

  it("scriptName is raw-interpolated including empty and shell-like strings", () => {
    expect(projectScriptCommand("yarn", "")).toBe("yarn ");
    expect(projectScriptCommand("bun", "")).toBe("bun run ");
    expect(projectScriptCommand("pnpm", "test && lint")).toBe("pnpm test && lint");
    expect(projectScriptCommand("npm", "prepublishOnly")).toBe("npm run prepublishOnly");
  });

  it("manager matching is exact string equality; casing falls through", () => {
    expect(projectScriptCommand("Yarn" as never, "x")).toBe("npm run x");
    expect(projectScriptCommand("PNPM" as never, "x")).toBe("npm run x");
    expect(projectScriptCommand("Bun" as never, "x")).toBe("npm run x");
  });

});
