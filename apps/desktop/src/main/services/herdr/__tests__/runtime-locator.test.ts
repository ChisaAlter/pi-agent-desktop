import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
    HerdrRuntimeLocator,
    type HerdrExecFile,
    type HerdrRuntimeCandidate,
} from "../runtime-locator";
import { toHerdrSocketPath } from "../socket-path";

function successfulExec(versions: Readonly<Record<string, string>>): HerdrExecFile {
    return vi.fn(async (file, args) => {
        expect(args).toEqual(["--version"]);
        const version = versions[file];
        if (!version) throw new Error("ENOENT");
        return { stdout: `herdr ${version}\n`, stderr: "" };
    });
}

describe("toHerdrSocketPath", () => {
    it("converts the complete Windows filesystem marker path to an NPFS path", () => {
        expect(toHerdrSocketPath(
            "C:\\Users\\alice\\AppData\\Local\\herdr\\herdr.sock",
            "win32",
        )).toBe("\\\\.\\pipe\\C:\\Users\\alice\\AppData\\Local\\herdr\\herdr.sock");
    });

    it("keeps Unix filesystem socket paths unchanged", () => {
        expect(toHerdrSocketPath("/home/alice/.herdr/herdr.sock", "linux")).toBe(
            "/home/alice/.herdr/herdr.sock",
        );
    });

    it("does not prefix an existing Windows NPFS path twice", () => {
        expect(toHerdrSocketPath("\\\\.\\pipe\\C:\\herdr\\herdr.sock", "win32")).toBe(
            "\\\\.\\pipe\\C:\\herdr\\herdr.sock",
        );
    });
});

describe("HerdrRuntimeLocator", () => {
    it("prefers PI_HERDR_EXECUTABLE_PATH and returns its verified version", async () => {
        const explicit = join("C:\\custom", "herdr.exe");
        const pathBinary = join("C:\\tools", "herdr.exe");
        const execFile = successfulExec({ [explicit]: "1.2.3", [pathBinary]: "9.9.9" });
        const locator = new HerdrRuntimeLocator({
            env: {
                PI_HERDR_EXECUTABLE_PATH: explicit,
                PATH: "C:\\tools",
            },
            execFile,
        });

        await expect(locator.locate()).resolves.toEqual({
            path: explicit,
            source: "env",
            version: "1.2.3",
        });
        expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("falls through invalid candidates in PATH order", async () => {
        const missing = join("C:\\missing", "herdr.exe");
        const installed = join("D:\\bin", "herdr.exe");
        const execFile = successfulExec({ [installed]: "0.8.0" });
        const locator = new HerdrRuntimeLocator({
            env: { PATH: "C:\\missing;D:\\bin" },
            pathDelimiter: ";",
            execFile,
        });

        await expect(locator.locate()).resolves.toEqual({
            path: installed,
            source: "path",
            version: "0.8.0",
        });
        expect(execFile).toHaveBeenNthCalledWith(1, missing, ["--version"], expect.any(Object));
        expect(execFile).toHaveBeenNthCalledWith(2, installed, ["--version"], expect.any(Object));
    });

    it("accepts an injected development candidate without embedding it in production discovery", async () => {
        const development: HerdrRuntimeCandidate = {
            path: join("C:\\dev", "herdr.exe"),
            source: "development",
        };
        const locator = new HerdrRuntimeLocator({
            env: { PATH: "" },
            candidates: [development],
            execFile: successfulExec({ [development.path]: "0.9.0-dev" }),
        });

        await expect(locator.locate()).resolves.toEqual({
            ...development,
            version: "0.9.0-dev",
        });
    });

    it("checks the managed directory after environment, PATH, and injected candidates", async () => {
        const managed = join("C:\\LocalAppData\\Pi Desktop\\herdr", "herdr.exe");
        const execFile = successfulExec({ [managed]: "0.8.1" });
        const locator = new HerdrRuntimeLocator({
            env: { PATH: "" },
            managedDir: "C:\\LocalAppData\\Pi Desktop\\herdr",
            execFile,
        });

        await expect(locator.locate()).resolves.toEqual({
            path: managed,
            source: "managed",
            version: "0.8.1",
        });
    });

    it("returns null when no candidate passes --version validation", async () => {
        const locator = new HerdrRuntimeLocator({
            env: { PI_HERDR_EXECUTABLE_PATH: "C:\\bad\\herdr.exe", PATH: "" },
            execFile: vi.fn(async () => {
                throw new Error("not executable");
            }),
        });

        await expect(locator.locate()).resolves.toBeNull();
    });
});
