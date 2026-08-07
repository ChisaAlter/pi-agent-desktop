import { ipcError, type IpcError } from "@shared";
import { isAbsolute, relative } from "path";
import { resolveCanonicalTarget } from "../services/path-canonical";

export interface RegisteredWorkspacePath {
    path: string;
}

export type RegisteredWorkspaceScope = "root" | "descendant";

export type RegisteredWorkspaceResolver = (
    rendererPath: string,
    scope?: RegisteredWorkspaceScope,
) => Promise<string | IpcError>;

function isPathWithin(parent: string, child: string): boolean {
    const relativePath = relative(parent, child);
    return relativePath === "" || (
        relativePath !== ".." &&
        !relativePath.startsWith(`..\\`) &&
        !relativePath.startsWith("../") &&
        !isAbsolute(relativePath)
    );
}

export function createRegisteredWorkspaceResolver(
    getRegisteredWorkspaces: () => readonly RegisteredWorkspacePath[],
): RegisteredWorkspaceResolver {
    return async (rendererPath, scope = "root") => {
        if (typeof rendererPath !== "string" || rendererPath.trim().length === 0) {
            return ipcError(
                "ipcErrors.workspace.unregisteredPath",
                "工作区路径未注册",
                { path: String(rendererPath ?? "") },
            );
        }

        try {
            const canonicalTarget = await resolveCanonicalTarget(rendererPath);
            const settledRoots = await Promise.allSettled(
                getRegisteredWorkspaces().map(async (workspace) =>
                    resolveCanonicalTarget(workspace.path),
                ),
            );
            const canonicalRoots = settledRoots.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
            );
            const matches = canonicalRoots.filter((root) =>
                scope === "root" ? relative(root, canonicalTarget) === "" : isPathWithin(root, canonicalTarget),
            );
            const canonicalRoot = matches.sort((left, right) => right.length - left.length)[0];
            if (canonicalRoot) return canonicalRoot;
        } catch {
            // Resolution failures are intentionally reported as authorization
            // failures so renderer-controlled paths do not expose host details.
        }

        return ipcError(
            "ipcErrors.workspace.unregisteredPath",
            `工作区路径未注册: ${rendererPath}`,
            { path: rendererPath },
        );
    };
}
