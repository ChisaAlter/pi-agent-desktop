import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
    execFile: vi.fn(),
}));

import { execFile } from "child_process";
import {
    clearPackageCatalogCacheForTest,
    fetchPackageCatalog,
    installPackage,
    parsePackageCatalog,
    parsePiList,
    removePackage,
    searchPackages,
    updatePackage,
} from "../pi-package-adapter";

beforeEach(() => {
    clearPackageCatalogCacheForTest();
    vi.unstubAllGlobals();
});

describe("parsePackageCatalog", () => {
    it("extracts package cards from pi.dev catalog html", () => {
        const html = `
          <a href="/packages/@jdiamond/pi-git" class="x" data-package-link="true" data-package-path="/packages/@jdiamond/pi-git">
            <strong>@jdiamond/pi-git</strong><span>Review-gated git tools.</span>
          </a>
          <a href="/packages/pi-web-access" class="x" data-package-link="true">
            <strong>pi-web-access</strong><span>Web access for Pi.</span>
          </a>
        `;
        const result = parsePackageCatalog(html);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            name: "@jdiamond/pi-git",
            source: "npm:@jdiamond/pi-git",
            description: "Review-gated git tools.",
            installed: false,
        });
    });
});

describe("parsePiList", () => {
    it("returns empty when pi has no packages", () => {
        expect(parsePiList("No packages installed.\n")).toEqual([]);
    });

    it("extracts npm sources from mixed list output", () => {
        expect(parsePiList("Installed packages:\n- npm:@jdiamond/pi-git\n- npm:pi-web-access\n")).toEqual([
            { source: "npm:@jdiamond/pi-git", name: "@jdiamond/pi-git", enabled: true, scope: "global" },
            { source: "npm:pi-web-access", name: "pi-web-access", enabled: true, scope: "global" },
        ]);
    });
});

describe("fetchPackageCatalog", () => {
    it("caches the parsed catalog for repeated calls", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            text: async () => `
              <a href="/packages/pi-web-access" data-package-link="true">
                <strong>pi-web-access</strong><span>Web access.</span>
              </a>
            `,
        }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchPackageCatalog()).resolves.toHaveLength(1);
        await expect(fetchPackageCatalog()).resolves.toHaveLength(1);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reports catalog HTTP failures", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: false,
            status: 503,
            text: async () => "",
        })));

        await expect(fetchPackageCatalog()).rejects.toThrow("HTTP 503");
    });
});

describe("pi package actions", () => {
    it("installs npm sources globally by default", async () => {
        (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
                cb(null, "ok", "");
            },
        );
        await expect(installPackage("pi-web-access")).resolves.toMatchObject({
            success: true,
            requiresRestart: true,
        });
        const [cmd, args] = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) ?? [];
        if (process.platform === "win32") {
            const commandText = `${cmd} ${args.join(" ")}`;
            expect(commandText).not.toContain(" pi install ");
            expect(commandText).toMatch(/(cli\.js|pi\.cmd)/);
            expect(commandText).toContain("install");
            expect(commandText).toContain("npm:pi-web-access");
        } else {
            expect(cmd).toBe("pi");
            expect(args).toEqual(["install", "npm:pi-web-access"]);
        }
    });

    it("removes and updates by source", async () => {
        const calls: string[] = [];
        (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (_cmd: string, args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
                calls.push(args.join(" "));
                cb(null, "ok", "");
            },
        );
        await removePackage("npm:pi-web-access");
        await updatePackage("npm:pi-web-access");
        expect(calls[0]).toContain("remove");
        expect(calls[0]).toContain("npm:pi-web-access");
        expect(calls[1]).toContain("update");
        expect(calls[1]).toContain("npm:pi-web-access");
    });
});

// wave-141 residual
describe("pi-package-adapter residual (wave-141)", () => {
    beforeEach(() => {
        clearPackageCatalogCacheForTest();
        vi.unstubAllGlobals();
    });

    it("decodes HTML entities and dedupes catalog cards by package name (last wins)", () => {
        const html = `
          <a href="/packages/pi-web-access" data-package-link="true">
            <strong>pi-web-access</strong><span>Web &amp; access &lt;beta&gt;.</span>
          </a>
          <a href="/packages/pi-web-access?v=2" data-package-link="true">
            <strong>pi-web-access</strong><span>Last card wins.</span>
          </a>
          <a href="/packages/@scope/pkg" data-package-link="true">
            <strong>@scope/pkg</strong><span>Scoped &quot;package&quot;.</span>
          </a>
        `;
        const result = parsePackageCatalog(html);
        expect(result).toHaveLength(2);
        const web = result.find((p) => p.name === "pi-web-access");
        // product Map.set last-write-wins on name key
        expect(web?.description).toBe("Last card wins.");
        expect(web?.source).toBe("npm:pi-web-access");
        expect(web?.url).toContain("/packages/pi-web-access");
        // first card's entities still decode when it is the sole entry
        const entitiesOnly = parsePackageCatalog(`
          <a href="/packages/entity-pkg" data-package-link="true">
            <strong>entity-pkg</strong><span>Web &amp; access &lt;beta&gt; &#39;x&#39;.</span>
          </a>
        `);
        expect(entitiesOnly[0]?.description).toBe("Web & access <beta> 'x'.");
        const scoped = result.find((p) => p.name === "@scope/pkg");
        expect(scoped?.description).toBe('Scoped "package".');
        expect(scoped?.source).toBe("npm:@scope/pkg");
    });

    it("parsePiList trims trailing punctuation and accepts git/https sources", () => {
        expect(
            parsePiList("Installed packages:\n- npm:@org/pkg.\n- git:https://github.com/a/b.git\n- https://example.test/p.tgz\n"),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ source: "npm:@org/pkg", name: "@org/pkg" }),
                expect.objectContaining({ source: "git:https://github.com/a/b.git" }),
                expect.objectContaining({ source: "https://example.test/p.tgz" }),
            ]),
        );
    });

    it("parsePiList falls back to first token lines when no scheme sources present", () => {
        expect(parsePiList("packages:\nlocal-tool 1.0.0\n")).toEqual([
            expect.objectContaining({ source: "local-tool", name: "local-tool", scope: "global" }),
        ]);
        expect(parsePiList("   ")).toEqual([]);
        expect(parsePiList("No packages installed.")).toEqual([]);
    });

    it("searchPackages filters case-insensitively and marks installed sources", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            text: async () => `
              <a href="/packages/alpha-kit" data-package-link="true">
                <strong>alpha-kit</strong><span>Alpha helpers</span>
              </a>
              <a href="/packages/beta-tools" data-package-link="true">
                <strong>beta-tools</strong><span>Other utilities</span>
              </a>
            `,
        }));
        vi.stubGlobal("fetch", fetchMock);
        (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (_cmd: string, args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
                if (args.includes("list") || String(args).includes("list")) {
                    cb(null, "Installed packages:\n- npm:alpha-kit\n", "");
                    return;
                }
                cb(null, "", "");
            },
        );

        const hits = await searchPackages("ALPHA");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            name: "alpha-kit",
            source: "npm:alpha-kit",
            installed: true,
        });

        const all = await searchPackages("  ");
        expect(all.map((p) => p.name).sort()).toEqual(["alpha-kit", "beta-tools"]);
        expect(all.find((p) => p.name === "beta-tools")?.installed).toBe(false);
    });

    it("installPackage prefixes bare names with npm: and keeps explicit schemes", async () => {
        const calls: string[] = [];
        (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (_cmd: string, args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
                calls.push(args.join(" "));
                cb(null, "ok", "");
            },
        );
        const bare = await installPackage("my-pkg");
        expect(bare).toMatchObject({
            success: true,
            message: "已安装 npm:my-pkg",
            requiresRestart: true,
        });
        expect(calls.at(-1)).toContain("npm:my-pkg");

        const explicit = await installPackage("git:https://github.com/x/y.git");
        expect(explicit.message).toContain("git:https://github.com/x/y.git");
        expect(calls.at(-1)).toContain("git:https://github.com/x/y.git");
        expect(calls.at(-1)).not.toContain("npm:git:");
    });

    it("propagates exec failures from removePackage", async () => {
        (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
                cb(new Error("spawn pi ENOENT"), "", "not found");
            },
        );
        await expect(removePackage("npm:missing")).rejects.toThrow(/ENOENT|not found/);
    });



// wave-308 residual
describe("pi-package-adapter residual (wave-308)", () => {
  it("parsePackageCatalog dedupes by name; later card wins; skips empty name", () => {
    const html = [
      '<a href="/packages/one" data-package-link="true"><strong>pkg</strong><span>first</span></a>',
      '<a href="/packages/two" data-package-link="true"><strong>pkg</strong><span>second</span></a>',
      '<a href="/packages/empty" data-package-link="true"><strong></strong><span>skip</span></a>',
      '<a href="/packages/other" data-package-link="true"><strong>other</strong><span>ok</span></a>',
    ].join("");
    const result = parsePackageCatalog(html);
    const pkg = result.find((p) => p.name === "pkg");
    expect(pkg?.description).toBe("second");
    expect(pkg?.url).toContain("/packages/two");
    expect(result.some((p) => p.name === "other")).toBe(true);
    // product: empty <strong></strong> yields title "" which is truthy for ?? so stripTags("") => "" and is skipped
    expect(result.some((p) => p.name === "empty")).toBe(false);
  });

  it("parsePiList scheme scan trims trailing punctuation; no-packages empty; line fallback skips header", () => {
    expect(parsePiList("No packages installed")).toEqual([]);
    expect(parsePiList("no packages installed today")).toEqual([]);
    const listed = parsePiList("npm:@scope/a,\nnpm:b)\ngit:https://x.git]\n");
    const sources = listed.map((p) => p.source).sort();
    expect(sources).toContain("npm:@scope/a");
    expect(sources).toContain("npm:b");
    expect(sources).toContain("git:https://x.git");
    for (const item of listed) {
      expect(item.enabled).toBe(true);
      expect(item.scope).toBe("global");
      expect(item.name).toBe(item.source.replace(/^npm:/, ""));
    }
    const fallback = parsePiList("Packages:\nfoo-bar 2.0\n");
    expect(fallback.map((p) => p.source)).toEqual(["foo-bar"]);
  });
});

});
