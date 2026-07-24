import { describe, expect, it } from "vitest";
import { resolveTrayIconPath } from "../tray-icon";

describe("resolveTrayIconPath", () => {
  it("prefers the packaged extraResources icon before dev fallbacks", () => {
    const existing = new Set([
      "C:\\dist\\resources\\build\\icon.ico",
      "C:\\dist\\build\\icon.ico",
    ]);

    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) => existing.has(candidate),
    });

    expect(result.path).toBe("C:\\dist\\resources\\build\\icon.ico");
    expect(result.checkedPaths[0]).toBe("C:\\dist\\resources\\build\\icon.ico");
  });

  it("returns null when no tray icon asset exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: () => false,
    });

    expect(result.path).toBeNull();
    expect(result.checkedPaths).not.toContain("C:\\dist\\Pi Desktop.exe");
  });

  it("falls back through asar.unpacked then cwd build icons", () => {
    const existing = new Set([
      "C:\\dist\\resources\\app.asar.unpacked\\build\\icon.ico",
      "C:\\dist\\build\\icon.ico",
    ]);

    const unpacked = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) => existing.has(candidate),
    });
    expect(unpacked.path).toBe("C:\\dist\\resources\\app.asar.unpacked\\build\\icon.ico");

    const cwdOnly = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) => candidate === "C:\\dist\\build\\icon.ico",
    });
    expect(cwdOnly.path).toBe("C:\\dist\\build\\icon.ico");
    expect(cwdOnly.checkedPaths).toContain("C:\\dist\\build\\icon.ico");
  });

  // wave-97 residual: checked path order, parent/grandparent, appPath-local, first-match
  it("checks packaged resources before asar and cwd fallbacks", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: () => false,
    });

    expect(result.checkedPaths).toEqual([
      "C:\\dist\\resources\\build\\icon.ico",
      "C:\\dist\\resources\\app.asar.unpacked\\build\\icon.ico",
      "C:\\dist\\resources\\app.asar\\build\\icon.ico",
      "C:\\dist\\resources\\build\\icon.ico",
      "C:\\dist\\build\\icon.ico",
      "C:\\dist\\build\\icon.ico",
    ]);
  });

  it("uses appPath-local build icon when earlier candidates are missing", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\src\\apps\\desktop",
      cwd: "C:\\src",
      resourcesPath: "C:\\missing-resources",
      exists: (candidate) => candidate === "C:\\src\\apps\\desktop\\build\\icon.ico",
    });
    expect(result.path).toBe("C:\\src\\apps\\desktop\\build\\icon.ico");
  });

  it("walks parent and grandparent of appPath before cwd", () => {
    const parentOnly = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\elsewhere",
      resourcesPath: "C:\\nope",
      exists: (candidate) => candidate === "C:\\dist\\resources\\build\\icon.ico",
    });
    // parent of app.asar is resources; join(appPath, "build") is third; resolve(.., build) is fourth
    expect(parentOnly.path).toBe("C:\\dist\\resources\\build\\icon.ico");

    const grandparent = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\elsewhere",
      resourcesPath: "C:\\nope",
      exists: (candidate) => candidate === "C:\\dist\\build\\icon.ico",
    });
    expect(grandparent.path).toBe("C:\\dist\\build\\icon.ico");
  });

  it("returns the first existing candidate and ignores later ones", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) =>
        candidate === "C:\\dist\\resources\\build\\icon.ico" ||
        candidate === "C:\\dist\\build\\icon.ico",
    });
    expect(result.path).toBe("C:\\dist\\resources\\build\\icon.ico");
  });

  // wave-128 residual
  it("lists six candidate paths in packaged-first order when none exist", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[result.checkedPaths.length - 1]).toMatch(/dist[\\/]build[\\/]icon\.ico$/i);
  });

  it("falls back to cwd build icon when resources and asar paths miss", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dev\\pi-desktop",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) => candidate === "C:\\dev\\pi-desktop\\build\\icon.ico",
    });
    expect(result.path).toBe("C:\\dev\\pi-desktop\\build\\icon.ico");
  });

  // wave-139 residual
  it("prefers resources/build over later candidates when multiple exist", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dev\\pi-desktop",
      resourcesPath: "C:\\dist\\resources",
      exists: () => true,
    });
    expect(result.path).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[0]).toBe(result.path);
  });

  it("matches appPath-local build when only that candidate exists", () => {
    const appPath = "C:\\dev\\pi-desktop\\apps\\desktop";
    const local = `${appPath}\\build\\icon.ico`;
    const result = resolveTrayIconPath({
      appPath,
      cwd: "C:\\dev\\pi-desktop",
      resourcesPath: "C:\\missing\\resources",
      exists: (candidate) => candidate === local,
    });
    expect(result.path).toBe(local);
  });

  // wave-147 residual
  it("checks exactly six candidates in documented order", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.path).toBeNull();
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[1]).toMatch(/app\.asar\.unpacked[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[2]).toMatch(/app[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/cwd[\\/]build[\\/]icon\.ico$/i);
  });

  it("selects second candidate when only asar.unpacked exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dev",
      resourcesPath: "C:\\dist\\resources",
      exists: (candidate) => candidate.includes("app.asar.unpacked"),
    });
    expect(result.path).toMatch(/app\.asar\.unpacked[\\/]build[\\/]icon\.ico$/i);
  });

  // wave-156 residual
  it("prefers resources/build over later candidates even if later also exist", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => true,
    });
    expect(result.path).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[0]).toBe(result.path);
  });

  it("falls through to cwd candidate when only cwd icon exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) => /cwd[\\/]build[\\/]icon\.ico$/i.test(candidate),
    });
    expect(result.path).toMatch(/cwd[\\/]build[\\/]icon\.ico$/i);
  });

  it("returns checkedPaths even when none exist (caller diagnostics)", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\a",
      cwd: "C:\\c",
      resourcesPath: "C:\\r",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths.every((p) => p.endsWith("icon.ico") || p.endsWith("icon.ico".replace(/\//g, "\\")))).toBe(true);
    expect(result.checkedPaths.every((p) => /icon\.ico$/i.test(p))).toBe(true);
  });

  // wave-163 residual
  it("always checks exactly six candidates in fixed order", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[1]).toMatch(/app\.asar\.unpacked[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[2]).toMatch(/app[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/cwd[\\/]build[\\/]icon\.ico$/i);
  });

  it("selects parent-of-app candidate when only that exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) => /dist[\\/]build[\\/]icon\.ico$/i.test(candidate),
    });
    expect(result.path).toMatch(/dist[\\/]build[\\/]icon\.ico$/i);
  });

  it("selects grandparent-of-app candidate when only that exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\release\\win-unpacked\\resources\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) => /win-unpacked[\\/]build[\\/]icon\.ico$/i.test(candidate),
    });
    expect(result.path).toMatch(/win-unpacked[\\/]build[\\/]icon\.ico$/i);
  });

  // wave-173 residual
  it("uses fixed candidate order even when resourcesPath equals app parent", () => {
    // appPath under resources → candidate[0] (resources/build) and candidate[3] (parent/build) can collide
    const result = resolveTrayIconPath({
      appPath: "C:\\dist\\resources\\app.asar",
      cwd: "C:\\dist",
      resourcesPath: "C:\\dist\\resources",
      exists: () => false,
    });
    expect(result.checkedPaths).toHaveLength(6);
    // first and fourth may resolve to the same path string when parent(app) === resources
    expect(result.checkedPaths[0]).toBe(result.checkedPaths[3]);
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
  });

  it("selects index-3 parent candidate when only parent build exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\src\\apps\\desktop",
      cwd: "C:\\elsewhere",
      resourcesPath: "C:\\missing-resources",
      exists: (candidate) => candidate === "C:\\src\\apps\\build\\icon.ico",
    });
    expect(result.path).toBe("C:\\src\\apps\\build\\icon.ico");
    expect(result.checkedPaths.indexOf(result.path!)).toBe(3);
  });

  it("does not call exists after the first hit (first-match short-circuit)", () => {
    const seen: string[] = [];
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) => {
        seen.push(candidate);
        return true; // first candidate wins
      },
    });
    expect(result.path).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    // Array.find stops after first truthy exists()
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(result.path);
  });

  // wave-190 residual
  it("returns null path and full checkedPaths when no candidate exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/cwd[\\/]build[\\/]icon\.ico$/i);
  });

  it("selects cwd candidate (index 5) when only cwd build exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) => /cwd[\\/]build[\\/]icon\.ico$/i.test(candidate),
    });
    expect(result.path).toMatch(/cwd[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(5);
  });

  it("selects app.asar.unpacked candidate (index 1) over later appPath", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (candidate) =>
        /app\.asar\.unpacked[\\/]build[\\/]icon\.ico$/i.test(candidate) ||
        /app[\\/]build[\\/]icon\.ico$/i.test(candidate),
    });
    // index 1 wins over later matches
    expect(result.path).toMatch(/app\.asar\.unpacked[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(1);
  });

  // wave-195 residual
  it("prefers resources build (index 0) over all later candidates", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => true,
    });
    expect(result.path).toMatch(/resources[\\/]build[\\/]icon\.ico$/i);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(0);
    expect(result.checkedPaths).toHaveLength(6);
  });

  it("selects parent and grandparent appPath fallbacks at indices 3 and 4", () => {
    // keep resourcesPath distinct from appPath parents so index 0 ≠ 3
    const appPath = "C:\\app\\nested\\leaf";
    const resourcesPath = "C:\\resources-only";
    const probe = resolveTrayIconPath({
      appPath,
      cwd: "C:\\cwd",
      resourcesPath,
      exists: () => false,
    });
    expect(new Set(probe.checkedPaths).size).toBe(6);
    const idx3 = probe.checkedPaths[3]!;
    const idx4 = probe.checkedPaths[4]!;

    const r3 = resolveTrayIconPath({
      appPath,
      cwd: "C:\\cwd",
      resourcesPath,
      exists: (c) => c === idx3,
    });
    expect(r3.path).toBe(idx3);
    expect(r3.checkedPaths.indexOf(r3.path!)).toBe(3);

    const r4 = resolveTrayIconPath({
      appPath,
      cwd: "C:\\cwd",
      resourcesPath,
      exists: (c) => c === idx4,
    });
    expect(r4.path).toBe(idx4);
    expect(r4.checkedPaths.indexOf(r4.path!)).toBe(4);
  });

  it("selects appPath-local build (index 2) when earlier candidates missing", () => {
    const appPath = "C:\\app";
    const probe = resolveTrayIconPath({
      appPath,
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const idx2 = probe.checkedPaths[2]!;
    const result = resolveTrayIconPath({
      appPath,
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (c) => c === idx2,
    });
    expect(result.path).toBe(idx2);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(2);
  });

  // wave-200 residual
  it("returns null path when no candidate exists but still lists six checkedPaths", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths.every((p) => p.includes("icon.ico"))).toBe(true);
  });

  it("prefers first existing candidate even when later ones also exist", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const first = probe.checkedPaths[0]!;
    const last = probe.checkedPaths[5]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (c) => c === first || c === last,
    });
    expect(result.path).toBe(first);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(0);
  });

  // wave-205 residual
  it("checkedPaths order is resources/build, asar.unpacked, appPath, parent, grandparent, cwd", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app\\dist",
      cwd: "C:\\project",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.checkedPaths[0]).toMatch(/resources[/\\]build[/\\]icon\.ico$/i);
    expect(result.checkedPaths[1]).toMatch(/app\.asar\.unpacked[/\\]build[/\\]icon\.ico$/i);
    expect(result.checkedPaths[2]).toMatch(/dist[/\\]build[/\\]icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/project[/\\]build[/\\]icon\.ico$/i);
  });

  it("hits cwd candidate when only the last path exists", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const last = probe.checkedPaths[5]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (c) => c === last,
    });
    expect(result.path).toBe(last);
    expect(result.checkedPaths.indexOf(result.path!)).toBe(5);
  });

  it("custom exists is invoked once per candidate until first hit", () => {
    const seen: string[] = [];
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const target = probe.checkedPaths[3]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (c) => {
        seen.push(c);
        return c === target;
      },
    });
    expect(result.path).toBe(target);
    // Array.find stops after first true
    expect(seen).toEqual(probe.checkedPaths.slice(0, 4));
  });

  // wave-208 residual
  it("returns null path when no candidate exists and still lists all six checks", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources.*build.*icon\.ico$/i);
    expect(result.checkedPaths[1]).toMatch(/app\.asar\.unpacked.*icon\.ico$/i);
    expect(result.checkedPaths[2]).toMatch(/app.*build.*icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/cwd.*build.*icon\.ico$/i);
  });

  it("first candidate wins when every path exists", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => true,
    });
    expect(result.path).toBe(probe.checkedPaths[0]);
  });

  // wave-213 residual
  it("returns null path when all candidates missing; checkedPaths length is 6", () => {
    // use disjoint roots so parent/grandparent resolves do not collide with resources
    const result = resolveTrayIconPath({
      appPath: "C:\\PiDesktop\\resources\\app.asar",
      cwd: "C:\\dev\\pi-desktop",
      resourcesPath: "C:\\PiDesktop\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    // product always returns 6 slots; uniqueness depends on path roots
    expect(result.checkedPaths.every((p) => p.toLowerCase().endsWith("icon.ico"))).toBe(true);
  });

  it("stops at first existing candidate among full checkedPaths list", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const cwdCandidate = probe.checkedPaths[5];
    const onlyCwd = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === cwdCandidate,
    });
    expect(onlyCwd.path).toBe(cwdCandidate);
    expect(onlyCwd.checkedPaths).toHaveLength(6);
  });

  // wave-219 residual
  it("first existing candidate wins in resources/build order; later paths ignored", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(probe.checkedPaths).toHaveLength(6);
    const first = probe.checkedPaths[0];
    const last = probe.checkedPaths[5];
    const onlyFirst = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === first || p === last,
    });
    expect(onlyFirst.path).toBe(first);
    expect(onlyFirst.path).not.toBe(last);
  });

  it("null path when none exist; checkedPaths still lists all six candidates", () => {
    const miss = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(miss.path).toBeNull();
    expect(miss.checkedPaths).toHaveLength(6);
    expect(miss.checkedPaths[0]).toMatch(/resources/);
    expect(miss.checkedPaths[5]).toMatch(/cwd|build/i);
  });

  // wave-248 residual
  it("checkedPaths order is fixed six slots; middle-only hit returns that path", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(probe.checkedPaths).toHaveLength(6);
    // index 2 is appPath/build/icon.ico
    const mid = probe.checkedPaths[2]!;
    const hit = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === mid,
    });
    expect(hit.path).toBe(mid);
    // parent/grandparent slots (3,4) after appPath
    expect(probe.checkedPaths[3]).toMatch(/build/);
    expect(probe.checkedPaths[4]).toMatch(/build/);
  });

  it("custom exists is called for each candidate until first hit; short-circuits", () => {
    const calls: string[] = [];
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const target = probe.checkedPaths[1]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => {
        calls.push(p);
        return p === target;
      },
    });
    expect(result.path).toBe(target);
    expect(calls).toEqual(probe.checkedPaths.slice(0, 2));
  });

  // wave-262 residual
  it("returns null and full candidate list when no icon exists", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources.*build.*icon\.ico/i);
    expect(result.checkedPaths.at(-1)).toMatch(/cwd.*build.*icon\.ico/i);
  });

  it("prefers first existing candidate (resources/build) over later cwd", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const first = probe.checkedPaths[0]!;
    const last = probe.checkedPaths[5]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === first || p === last,
    });
    expect(result.path).toBe(first);
  });


  // wave-273 residual
  it("checkedPaths order is resources, asar.unpacked, appPath, parent, grandparent, cwd", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.checkedPaths).toHaveLength(6);
    expect(result.checkedPaths[0]).toMatch(/resources[\\/]+build[\\/]+icon\.ico$/i);
    expect(result.checkedPaths[1]).toMatch(/app\.asar\.unpacked[\\/]+build[\\/]+icon\.ico$/i);
    expect(result.checkedPaths[2]).toMatch(/app[\\/]+build[\\/]+icon\.ico$/i);
    expect(result.checkedPaths[5]).toMatch(/cwd[\\/]+build[\\/]+icon\.ico$/i);
  });

  it("selects middle candidate when earlier missing and later present", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const mid = probe.checkedPaths[2]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === mid,
    });
    expect(result.path).toBe(mid);
  });


  // wave-277 residual
  it("returns null path when none exist; checkedPaths still length 6", () => {
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(result.path).toBeNull();
    expect(result.checkedPaths).toHaveLength(6);
  });

  it("prefers asar.unpacked over appPath when resources missing", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    const asarUnpacked = probe.checkedPaths[1]!;
    const appPathIcon = probe.checkedPaths[2]!;
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === asarUnpacked || p === appPathIcon,
    });
    expect(result.path).toBe(asarUnpacked);
  });



  // wave-287 residual
  it("selects parent (index 3) over grandparent/cwd; grandparent when earlier missing", () => {
    const probe = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(probe.checkedPaths).toHaveLength(6);
    const parent = probe.checkedPaths[3]!;
    const grandparent = probe.checkedPaths[4]!;
    const cwdIcon = probe.checkedPaths[5]!;

    const preferParent = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === parent || p === grandparent || p === cwdIcon,
    });
    expect(preferParent.path).toBe(parent);

    const preferGrand = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === grandparent || p === cwdIcon,
    });
    expect(preferGrand.path).toBe(grandparent);
  });

  it("custom exists is used; same inputs yield stable checkedPaths; first match only", () => {
    const seen: string[] = [];
    const result = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => {
        seen.push(p);
        return false;
      },
    });
    expect(result.path).toBeNull();
    expect(seen).toEqual(result.checkedPaths);
    expect(seen).toHaveLength(6);

    const again = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: () => false,
    });
    expect(again.checkedPaths).toEqual(result.checkedPaths);

    // first match only — later candidates not preferred even if also true
    const first = result.checkedPaths[0]!;
    const last = result.checkedPaths[5]!;
    const firstOnly = resolveTrayIconPath({
      appPath: "C:\\app",
      cwd: "C:\\cwd",
      resourcesPath: "C:\\resources",
      exists: (p) => p === first || p === last,
    });
    expect(firstOnly.path).toBe(first);
  });

});
