// Shared IPC handler helpers — reduce try/catch + validation duplication.
// Each helper preserves the exact error contract (ipcError code/fallback/params)
// previously inlined in the calling handlers.

import { ipcMain } from "electron";
import log from "electron-log/main";
import type { ZodSchema } from "zod";
import { ipcError, type IpcError } from "@shared";
import type { PiDriver } from "../pi-driver";

type IpcErrorParams = Record<string, string | number | boolean>;

/**
 * packages.ipc.ts style: validate args with a zod schema (safeParse), then run
 * the action inside try/catch. On schema failure returns ipcError(invalidErrorKey);
 * on action failure returns ipcError(failedErrorKey) with the error message appended.
 */
export async function withValidation<TArgs, TResult>(
    schema: ZodSchema<TArgs>,
    args: unknown,
    opts: {
        invalidErrorKey: string;
        invalidFallback: string;
        failedErrorKey: string;
        failedLabel: string;
        logTag: string;
        context?: IpcErrorParams;
    },
    action: (parsed: TArgs) => Promise<TResult>,
): Promise<TResult | IpcError> {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
        return ipcError(opts.invalidErrorKey, opts.invalidFallback);
    }
    try {
        return await action(parsed.data);
    } catch (err) {
        log.error(opts.logTag, err);
        return ipcError(
            opts.failedErrorKey,
            `${opts.failedLabel}: ${err instanceof Error ? err.message : String(err)}`,
            opts.context,
        );
    }
}

/**
 * packages.ipc.ts style without schema (refresh-catalog, list-installed):
 * run the action inside try/catch, return ipcError(failedErrorKey) on failure.
 */
export async function withAction<TResult>(
    action: () => Promise<TResult>,
    opts: {
        failedErrorKey: string;
        failedLabel: string;
        logTag: string;
    },
): Promise<TResult | IpcError> {
    try {
        return await action();
    } catch (err) {
        log.error(opts.logTag, err);
        return ipcError(
            opts.failedErrorKey,
            `${opts.failedLabel}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * pi-driver.ipc.ts style: guard on PiDriver availability, then run the action
 * inside try/catch. Returns ipcError(driverNotInitialized) when the driver is null.
 */
export async function withPiDriver<TResult>(
    getPiDriver: () => PiDriver | null,
    opts: {
        failedErrorKey: string;
        failedLabel: string;
        logTag: string;
    },
    action: (driver: PiDriver) => Promise<TResult>,
): Promise<TResult | IpcError> {
    const driver = getPiDriver();
    if (!driver) {
        return ipcError("ipcErrors.pi.driverNotInitialized", "PiDriver 尚未初始化");
    }
    try {
        return await action(driver);
    } catch (err) {
        log.error(opts.logTag, err);
        return ipcError(
            opts.failedErrorKey,
            `${opts.failedLabel}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * updater.ipc.ts style: run the action inside try/catch, return ipcError(errorKey)
 * on failure. The label is the localized failure prefix (e.g. "检查应用更新失败").
 */
export async function withUpdaterAction<TResult>(
    action: () => Promise<TResult>,
    opts: {
        errorKey: string;
        label: string;
        logTag: string;
    },
): Promise<TResult | IpcError> {
    try {
        return await action();
    } catch (error) {
        log.error(opts.logTag, error);
        return ipcError(
            opts.errorKey,
            `${opts.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

interface SessionImporter {
    scan(workspacePath: string): Promise<unknown>;
    import(workspacePath: string, sourcePaths: string[]): Promise<unknown>;
}

/**
 * claude-sessions.ipc.ts + codex-sessions.ipc.ts share an identical scan/import
 * shape. This wires both handlers for the given prefix. Schemas use .parse()
 * (throws on invalid), matching the prior inlined behavior.
 */
export function setupSessionImporterIpc(
    prefix: "claude-sessions" | "codex-sessions",
    importer: SessionImporter,
    scanSchema: ZodSchema,
    importSchema: ZodSchema,
): void {
    ipcMain.handle(`${prefix}:scan`, async (_event, ...args: unknown[]) => {
        const [workspacePath] = scanSchema.parse(args) as [string];
        return importer.scan(workspacePath);
    });
    ipcMain.handle(`${prefix}:import`, async (_event, ...args: unknown[]) => {
        const [workspacePath, sourcePaths] = importSchema.parse(args) as [string, string[]];
        return importer.import(workspacePath, sourcePaths);
    });
}
