import { homedir } from "node:os";
import { join } from "node:path";

export const HERDR_SESSION_ENV = "HERDR_SESSION";
export const HERDR_SOCKET_PATH_ENV = "HERDR_SOCKET_PATH";
export const DEFAULT_HERDR_SESSION_NAME = "default";
const MAX_SESSION_NAME_LEN = 64;

/**
 * Official Herdr session names are filesystem-safe and used as subdirectory
 * names under the Herdr config directory. Isolated E2E must set HERDR_SESSION
 * so Desktop never attaches to the user's default session.
 */
export function resolveHerdrSessionName(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
): string {
    const requested = env[HERDR_SESSION_ENV]?.trim();
    if (!requested) return DEFAULT_HERDR_SESSION_NAME;
    return validateHerdrSessionName(requested) ? requested : DEFAULT_HERDR_SESSION_NAME;
}

export function validateHerdrSessionName(name: string): boolean {
    return name.length > 0
        && name.length <= MAX_SESSION_NAME_LEN
        && name !== "."
        && name !== ".."
        && !name.includes("/")
        && !name.includes("\\")
        && !name.includes("\0");
}

/**
 * Official Windows config dir is `%APPDATA%/herdr`. Named sessions live under
 * `sessions/<name>/herdr.sock`; the default session uses the config dir itself.
 */
export function resolveHerdrConfigDir(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
): string {
    const xdg = env.XDG_CONFIG_HOME?.trim();
    if (xdg) return join(xdg, "herdr");
    const appData = env.APPDATA?.trim();
    if (appData) return join(appData, "herdr");
    const profile = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
    return join(profile, "AppData", "Roaming", "herdr");
}

export function resolveHerdrApiSocketMarkerPath(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
    sessionName = resolveHerdrSessionName(env),
): string {
    const explicit = env[HERDR_SOCKET_PATH_ENV]?.trim();
    if (explicit) return explicit;
    const configDir = resolveHerdrConfigDir(env);
    if (sessionName === DEFAULT_HERDR_SESSION_NAME) {
        return join(configDir, "herdr.sock");
    }
    return join(configDir, "sessions", sessionName, "herdr.sock");
}

export function resolveHerdrManagedDir(userDataPath: string): string {
    return join(userDataPath, "herdr-runtime");
}

/**
 * CI / Playwright / unit tests must not attach to the user's default Herdr
 * session. Isolated runs set HERDR_SOCKET_PATH or a non-default HERDR_SESSION.
 */
export function shouldAutoAttachHerdrRuntime(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
): boolean {
    if (env.PI_HERDR_ALLOW_DEFAULT_SESSION === "1") return true;
    const isolated = Boolean(env[HERDR_SOCKET_PATH_ENV]?.trim())
        || resolveHerdrSessionName(env) !== DEFAULT_HERDR_SESSION_NAME;
    const testLike = env.CI === "1"
        || env.NODE_ENV === "test"
        || env.PI_DESKTOP_E2E === "1";
    return !testLike || isolated;
}

export function herdrServerChildEnv(
    env: Readonly<NodeJS.ProcessEnv> = process.env,
    sessionName = resolveHerdrSessionName(env),
    socketMarkerPath = resolveHerdrApiSocketMarkerPath(env, sessionName),
): NodeJS.ProcessEnv {
    const childEnv: NodeJS.ProcessEnv = { ...env, [HERDR_SOCKET_PATH_ENV]: socketMarkerPath };
    if (sessionName !== DEFAULT_HERDR_SESSION_NAME) {
        childEnv[HERDR_SESSION_ENV] = sessionName;
    }
    return childEnv;
}
