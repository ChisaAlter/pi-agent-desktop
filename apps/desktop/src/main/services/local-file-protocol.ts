import { protocol, net } from 'electron';
import { pathToFileURL } from 'url';
import log from 'electron-log/main';
import { getProtectedPathReason, isPathInside } from './protected-paths';
import { assertWorkspacePathAllowed } from './path-canonical';

/**
 * Register the `localfile://` custom protocol used by the renderer to load
 * workspace files into <img> / <webview> / fetch() without a file:// URL.
 *
 * audit round 3, Task 3: the protocol now takes a `getCurrentWorkspacePath`
 * dependency and refuses any request that isn't inside the active workspace.
 * Previously it only blocked sensitive-file patterns (.env, .ssh, …), so a
 * renderer compromised via XSS could read arbitrary local files
 * (e.g. `localfile:///c:/Users/secret/config.json`) as long as the name didn't
 * match a sensitive pattern. The workspace-boundary check closes that hole.
 *
 * 安全补强: 词法 `isPathInside` 不能阻挡工作区内的 symlink / Windows
 * junction 指向区外。现在追加 canonical 校验 (`assertWorkspacePathAllowed`),
 * 与 `files:readTextFile` / agent tools 保持同一安全标准。仅在通过校验后
 * 才用 `pathToFileURL(canonicalPath)` 抓取, 确保读到的是真实的工作区内目标。
 */
export function registerLocalFileProtocol(opts: {
    getCurrentWorkspacePath: () => string | null;
}): void {
    const { getCurrentWorkspacePath } = opts;
    protocol.handle('localfile', async (request) => {
        const filePath = decodeURIComponent(request.url.replace('localfile://', ''));

        // No active workspace → refuse. The protocol is only meaningful when a
        // workspace is selected; without one there is no legitimate localfile
        // request the renderer could make.
        const workspacePath = getCurrentWorkspacePath();
        if (!workspacePath) {
            log.warn('[localfile] rejected: no active workspace');
            return new Response('Forbidden: no active workspace', { status: 403 });
        }

        // 快速词法预检: 明显越界或敏感路径直接 403, 避免对每个请求都做 realpath。
        if (!isPathInside(workspacePath, filePath)) {
            log.warn(`[localfile] rejected: path outside workspace (${filePath} not inside ${workspacePath})`);
            return new Response('Forbidden: path outside workspace', { status: 403 });
        }
        const lexicalReason = getProtectedPathReason(filePath, workspacePath);
        if (lexicalReason) {
            log.warn(`[localfile] rejected: ${lexicalReason} (${filePath})`);
            return new Response(`Forbidden: ${lexicalReason}`, { status: 403 });
        }

        // Canonical 校验: 拦截 symlink / junction 逃逸出工作区。
        const guard = await assertWorkspacePathAllowed(filePath, workspacePath);
        if (!guard.allowed) {
            log.warn(`[localfile] rejected: ${guard.reason} (${filePath})`);
            return new Response(`Forbidden: ${guard.reason}`, { status: 403 });
        }

        try {
            return await net.fetch(pathToFileURL(guard.canonicalPath).href);
        } catch (err) {
            log.warn(`[localfile] Failed to serve: ${filePath}`, err);
            return new Response('File not found', { status: 404 });
        }
    });
    log.info('[localfile] Protocol registered: localfile://');
}
