import { protocol, net } from 'electron';
import { pathToFileURL } from 'url';
import log from 'electron-log/main';
import { getProtectedPathReason } from './protected-paths';

export function registerLocalFileProtocol(): void {
    protocol.handle('localfile', (request) => {
        const filePath = decodeURIComponent(request.url.replace('localfile://', ''));
        const reason = getProtectedPathReason(filePath);
        if (reason) {
            return new Response('Forbidden', { status: 403, statusText: reason });
        }
        try {
            return net.fetch(pathToFileURL(filePath).href);
        } catch (err) {
            log.warn(`[localfile] Failed to serve: ${filePath}`, err);
            return new Response('File not found', { status: 404 });
        }
    });
    log.info('[localfile] Protocol registered: localfile://');
}