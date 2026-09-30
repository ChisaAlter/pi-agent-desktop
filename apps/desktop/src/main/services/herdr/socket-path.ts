const WINDOWS_NPFS_PREFIX = "\\\\.\\pipe\\";

/**
 * Herdr's Windows socket file is only a filesystem marker. The actual local
 * socket is a named pipe whose namespace name is the complete marker path.
 */
export function toHerdrSocketPath(
    markerPath: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (platform !== "win32" || markerPath.startsWith(WINDOWS_NPFS_PREFIX)) {
        return markerPath;
    }
    return `${WINDOWS_NPFS_PREFIX}${markerPath}`;
}
