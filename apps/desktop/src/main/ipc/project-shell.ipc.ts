import { ipcMain, shell } from "electron";
import log from "electron-log/main";
import { ipcError, isIpcError } from "@shared";
import { buildFileTree } from "../file-tree";
import { detectProject } from "../project-detector";
import { getProtectedPathReason } from "../services/protected-paths";
import { resolveCanonicalTarget } from "../services/path-canonical";
import { projectDetectSchema, projectFileTreeSchema } from "./schemas";
import { createRegisteredWorkspaceResolver, type RegisteredWorkspacePath } from "./workspace-authorization";

function protectedPathError(path: string, reason: string) {
    return ipcError("ipcErrors.files.protectedPath", reason, { path });
}

function isExternalUrl(target: string): boolean {
    try {
        const url = new URL(target);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Detect targets that look like a URL with a non-http(s) scheme (file://,
 * javascript:, vbscript:, data:text/html, ms-msdt:, etc.) so the IPC handler
 * can reject them before reaching shell.openPath.
 *
 * Requires 2+ chars before the colon (`+` quantifier) so single-letter Windows
 * drive paths (C:\, D:\, C:/foo) are NOT classified as URL schemes and continue
 * to open normally.
 */
function isUrlSchemeButNotHttp(target: string): boolean {
    return /^[a-z][a-z0-9+.-]+:/i.test(target) && !isExternalUrl(target);
}

const BLOCKED_SHELL_EXTENSIONS = /\.(?:appref-ms|application|bat|cmd|com|cpl|exe|gadget|hta|inf|ins|isp|jar|js|jse|lnk|msc|msi|msix|msp|mst|pif|ps1|py|pyw|reg|scr|scf|sh|url|vb|vbe|vbs|ws|wsc|wsf|wsh)(?:[ .:]*)$/i;

function isExecutableShellTarget(target: string): boolean {
    return BLOCKED_SHELL_EXTENSIONS.test(target);
}

export function setupProjectShellIpc(opts: {
    getRegisteredWorkspaces: () => readonly RegisteredWorkspacePath[];
}): void {
    const resolveRegisteredWorkspace = createRegisteredWorkspaceResolver(opts.getRegisteredWorkspaces);

    ipcMain.handle("project:detect", async (_event, workspacePath: string) => {
        try {
            projectDetectSchema.parse([workspacePath]);
        } catch (err) {
            log.warn("[project-shell.ipc] project:detect invalid args:", err);
            return ipcError(
                "ipcErrors.project.detectInvalid",
                `project detect 参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(workspacePath ?? "") },
            );
        }
        const reason = getProtectedPathReason(workspacePath);
        if (reason) return protectedPathError(workspacePath, reason);
        const authorizedWorkspacePath = await resolveRegisteredWorkspace(workspacePath);
        if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
        const canonicalReason = getProtectedPathReason(authorizedWorkspacePath);
        if (canonicalReason) return protectedPathError(workspacePath, canonicalReason);
        return detectProject(authorizedWorkspacePath);
    });

    ipcMain.handle("project:file-tree", async (_event, workspacePath: string, maxDepth?: number) => {
        try {
            const args = maxDepth === undefined ? [workspacePath] : [workspacePath, maxDepth];
            projectFileTreeSchema.parse(args);
        } catch (err) {
            log.warn("[project-shell.ipc] project:file-tree invalid args:", err);
            return ipcError(
                "ipcErrors.project.fileTreeInvalid",
                `project file-tree 参数无效: ${err instanceof Error ? err.message : String(err)}`,
                { path: String(workspacePath ?? "") },
            );
        }
        const reason = getProtectedPathReason(workspacePath);
        if (reason) return protectedPathError(workspacePath, reason);
        const authorizedWorkspacePath = await resolveRegisteredWorkspace(workspacePath);
        if (isIpcError(authorizedWorkspacePath)) return authorizedWorkspacePath;
        const canonicalReason = getProtectedPathReason(authorizedWorkspacePath);
        if (canonicalReason) return protectedPathError(workspacePath, canonicalReason);
        return buildFileTree(authorizedWorkspacePath, { maxDepth: maxDepth || 4 });
    });

    ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
        try {
            if (isExternalUrl(targetPath)) {
                await shell.openExternal(targetPath);
                return "";
            }
            // Security: reject targets that look like a URL scheme (e.g. file://,
            // javascript:, vbscript:, data:text/html, ms-msdt:) but aren't http(s).
            // Without this gate they fall through to shell.openPath, which on
            // Windows can execute arbitrary local HTML / protocol handlers.
            // The scheme regex requires 2+ chars before the colon so single-letter
            // Windows drive paths (C:\, D:\) still open normally.
            if (isUrlSchemeButNotHttp(targetPath)) {
                return ipcError(
                    "ipcErrors.shell.invalidScheme",
                    `不允许打开的 URL scheme: ${targetPath}`,
                    { path: targetPath },
                );
            }
            const reason = getProtectedPathReason(targetPath);
            if (reason) return protectedPathError(targetPath, reason);
            const workspacePath = await resolveRegisteredWorkspace(targetPath, "descendant");
            if (isIpcError(workspacePath)) return workspacePath;
            const canonicalTargetPath = await resolveCanonicalTarget(targetPath);
            const canonicalReason = getProtectedPathReason(canonicalTargetPath, workspacePath);
            if (canonicalReason) return protectedPathError(targetPath, canonicalReason);
            if (isExecutableShellTarget(canonicalTargetPath)) {
                return ipcError(
                    "ipcErrors.shell.executableBlocked",
                    `不允许直接启动可执行文件或脚本: ${targetPath}`,
                    { path: targetPath },
                );
            }
            const result = await shell.openPath(canonicalTargetPath);
            if (result) {
                return ipcError(
                    "ipcErrors.shell.openPathFailed",
                    `打开路径失败: ${result}`,
                    { path: targetPath },
                );
            }
            return "";
        } catch (err) {
            log.error("[project-shell.ipc] shell:open-path failed:", err);
            return ipcError(
                "ipcErrors.shell.openPathFailed",
                `打开路径失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
    });

    ipcMain.handle("shell:reveal-path", async (_event, targetPath: string) => {
        const reason = getProtectedPathReason(targetPath);
        if (reason) return protectedPathError(targetPath, reason);
        try {
            const workspacePath = await resolveRegisteredWorkspace(targetPath, "descendant");
            if (isIpcError(workspacePath)) return workspacePath;
            const canonicalTargetPath = await resolveCanonicalTarget(targetPath);
            const canonicalReason = getProtectedPathReason(canonicalTargetPath, workspacePath);
            if (canonicalReason) return protectedPathError(targetPath, canonicalReason);
            shell.showItemInFolder(canonicalTargetPath);
        } catch (err) {
            log.error("[project-shell.ipc] shell:reveal-path failed:", err);
            return ipcError(
                "ipcErrors.shell.revealPathFailed",
                `定位路径失败: ${err instanceof Error ? err.message : String(err)}`,
                { path: targetPath },
            );
        }
        return undefined;
    });
}
