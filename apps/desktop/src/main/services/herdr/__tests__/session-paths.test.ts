import { describe, expect, it } from "vitest";
import {
    DEFAULT_HERDR_SESSION_NAME,
    herdrServerChildEnv,
    resolveHerdrApiSocketMarkerPath,
    resolveHerdrConfigDir,
    resolveHerdrManagedDir,
    resolveHerdrSessionName,
    shouldAutoAttachHerdrRuntime,
    validateHerdrSessionName,
} from "../session-paths";

describe("Herdr session paths", () => {
    it("uses the official default session and APPDATA config dir", () => {
        const env = { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" };
        expect(resolveHerdrSessionName(env)).toBe(DEFAULT_HERDR_SESSION_NAME);
        expect(resolveHerdrConfigDir(env)).toBe("C:\\Users\\alice\\AppData\\Roaming\\herdr");
        expect(resolveHerdrApiSocketMarkerPath(env)).toBe(
            "C:\\Users\\alice\\AppData\\Roaming\\herdr\\herdr.sock",
        );
    });

    it("keeps named sessions under sessions/<name> and honors HERDR_SOCKET_PATH", () => {
        expect(resolveHerdrApiSocketMarkerPath({
            APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
            HERDR_SESSION: "pi-e2e",
        })).toBe("C:\\Users\\alice\\AppData\\Roaming\\herdr\\sessions\\pi-e2e\\herdr.sock");
        expect(resolveHerdrApiSocketMarkerPath({
            HERDR_SOCKET_PATH: "C:\\tmp\\isolated.sock",
            HERDR_SESSION: "ignored",
        })).toBe("C:\\tmp\\isolated.sock");
    });

    it("rejects unsafe session names and falls back to default", () => {
        expect(validateHerdrSessionName("../escape")).toBe(false);
        expect(validateHerdrSessionName("a/b")).toBe(false);
        expect(resolveHerdrSessionName({ HERDR_SESSION: "..\\escape" })).toBe(DEFAULT_HERDR_SESSION_NAME);
    });

    it("places managed binaries under Desktop userData, not the official Herdr config dir", () => {
        expect(resolveHerdrManagedDir("C:\\Users\\alice\\AppData\\Roaming\\pi-desktop"))
            .toBe("C:\\Users\\alice\\AppData\\Roaming\\pi-desktop\\herdr-runtime");
    });

    it("does not auto-attach the user's default session in CI/E2E", () => {
        expect(shouldAutoAttachHerdrRuntime({ CI: "1" })).toBe(false);
        expect(shouldAutoAttachHerdrRuntime({ NODE_ENV: "test" })).toBe(false);
        expect(shouldAutoAttachHerdrRuntime({
            CI: "1",
            HERDR_SESSION: "pi-e2e",
        })).toBe(true);
        expect(shouldAutoAttachHerdrRuntime({
            CI: "1",
            HERDR_SOCKET_PATH: "C:\\tmp\\isolated.sock",
        })).toBe(true);
        expect(shouldAutoAttachHerdrRuntime({
            CI: "1",
            PI_HERDR_ALLOW_DEFAULT_SESSION: "1",
        })).toBe(true);
    });

    it("forwards isolated socket and session into a Desktop-spawned server env", () => {
        expect(herdrServerChildEnv({
            APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
            HERDR_SESSION: "pi-e2e",
        })).toMatchObject({
            HERDR_SESSION: "pi-e2e",
            HERDR_SOCKET_PATH: "C:\\Users\\alice\\AppData\\Roaming\\herdr\\sessions\\pi-e2e\\herdr.sock",
        });
    });
});
