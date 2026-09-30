import { describe, expect, it } from "vitest";
import { HerdrRuntimeLocator } from "../runtime-locator";
import { resolveIsolatedHerdrExecutable } from "./isolated-runtime";

const executable = resolveIsolatedHerdrExecutable();

describe.skipIf(!executable)("HerdrRuntimeLocator real verification", () => {
    it("finds and version-verifies the real herdr.exe from PI_HERDR_EXECUTABLE_PATH", async () => {
        const locator = new HerdrRuntimeLocator({
            env: {
                PI_HERDR_EXECUTABLE_PATH: executable!,
                PATH: "",
            },
        });
        const result = await locator.locate();
        expect(result).not.toBeNull();
        expect(result!.path).toBe(executable);
        expect(result!.version).toMatch(/^0\.8\.0/);
    }, 15_000);

    it("returns null when the executable is not real (validation fails)", async () => {
        const locator = new HerdrRuntimeLocator({
            env: {
                PI_HERDR_EXECUTABLE_PATH: "C:\\no-such\\herdr.exe",
                PATH: "",
            },
        });
        await expect(locator.locate()).resolves.toBeNull();
    }, 15_000);
});
