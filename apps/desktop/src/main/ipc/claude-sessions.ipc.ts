import type { ClaudeSessionImporter } from "../services/claude-session/importer";
import { claudeScanSchema, claudeImportSchema } from "./schemas";
import { setupSessionImporterIpc } from "./helpers";

export function setupClaudeSessionsIpc(importer: ClaudeSessionImporter): void {
    setupSessionImporterIpc("claude-sessions", importer, claudeScanSchema, claudeImportSchema);
}
