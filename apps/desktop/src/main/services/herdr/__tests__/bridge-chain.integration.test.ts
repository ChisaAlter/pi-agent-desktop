import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HerdrRuntimeSupervisor } from "../runtime-supervisor";
import { HerdrStateBridge } from "../state-bridge";
import { HerdrRuntimeLocator } from "../runtime-locator";
import { resolveIsolatedHerdrExecutable } from "./isolated-runtime";

const executable = resolveIsolatedHerdrExecutable();

describe.skipIf(!executable)("Herdr bridge full chain (locator + spawn + attach)", () => {
    const cleanup: Array<() => void> = [];

    afterEach(() => {
        for (const fn of cleanup.splice(0)) {
            try { fn(); } catch { /* ignore */ }
        }
    });

    it("starts through the same path the settings button uses (real locator, isolated APPDATA)", async () => {
        const appData = mkdtempSync(join(tmpdir(), "pi-herdr-chain-"));
        cleanup.push(() => { try { rmSync(appData, { recursive: true, force: true }); } catch { /* ignore */ } });

        const socketMarker = join(appData, "herdr", "herdr.sock");
        const childEnv = {
            ...process.env,
            APPDATA: appData,
            HERDR_SOCKET_PATH: socketMarker,
            PI_HERDR_EXECUTABLE_PATH: executable!,
        };
        const supervisor = new HerdrRuntimeSupervisor({
            socketPath: socketMarker,
            locator: new HerdrRuntimeLocator({ env: childEnv }),
            serverEnv: childEnv,
            healthTimeoutMs: 20_000,
            healthPollIntervalMs: 250,
        });
        const bridge = new HerdrStateBridge({
            supervisor,
            sessionName: "default",
        });

        const projection = await bridge.start();
        expect(projection.status.connection).toBe("connected");
        expect(projection.status.version).toMatch(/^0\.8\.0/);
        expect(projection.tree.workspaces).toBeInstanceOf(Array);
    }, 45_000);
});
