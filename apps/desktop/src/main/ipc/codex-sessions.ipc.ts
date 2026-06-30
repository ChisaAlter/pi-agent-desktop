import type { CodexSessionImporter } from "../services/codex-session/importer";
import { codexScanSchema, codexImportSchema } from "./schemas";
import { setupSessionImporterIpc } from "./helpers";

export function setupCodexSessionsIpc(importer: CodexSessionImporter): void {
    setupSessionImporterIpc("codex-sessions", importer, codexScanSchema, codexImportSchema);
}
