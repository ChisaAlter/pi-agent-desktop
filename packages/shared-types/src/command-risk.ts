export type CommandRiskLevel = "high" | "normal";

const HIGH_RISK_COMMAND_PATTERNS: RegExp[] = [
    /\brm\s+(?:-[^\s]*[rf][^\s]*|-[^\s]*[fr][^\s]*|--recursive\b|--force\b)/i,
    /\bRemove-Item\b.*\s-(Recurse|Force)\b/i,
    /\bdel(?:ete)?\b.*\s\/[sq]\b/i,
    /\brmdir\b.*\s\/s\b/i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bchmod\s+777\b/i,
    /\bcurl\b.*\|\s*(?:sh|bash|powershell|pwsh)\b/i,
    /\biwr\b.*\|\s*(?:powershell|pwsh|iex)\b/i,
    /\birm\b.*\|\s*(?:powershell|pwsh|iex)\b/i,
    /\bgit\s+push\b.*--force(?:-with-lease)?\b/i,
    /\bgit\s+reset\b.*\s--hard\b/i,
    /\bgit\s+clean\b.*\s-[^\s]*f/i,
    /\bgit\s+checkout\b.*\s--\s+\./i,
    /\bnpm\s+uninstall\b.*\s-g\b/i,
    /\breg\s+delete\b/i,
    /\bRemove-Item\b.*(?:\.env|id_rsa|id_ed25519|\.ssh)/i,
    /\bnpm\s+publish\b/i,
    /\bkubectl\s+delete\b/i,
    /\bterraform\s+(?:apply\s+-auto-approve|destroy(?:\s+-auto-approve)?|import)\b/i,
];

export function classifyCommandRisk(command: string): CommandRiskLevel {
    const trimmed = command.trim();
    if (!trimmed) return "normal";
    return HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed)) ? "high" : "normal";
}

export function isHighRiskCommand(command: string): boolean {
    return classifyCommandRisk(command) === "high";
}
