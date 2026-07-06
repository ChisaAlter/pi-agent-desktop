import { Type } from "typebox";
import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";

/**
 * Asset-inventory custom tools — Phase E Task 4 SubTask 4.7.
 *
 * Three read-only tools injected into `distill` (and available to `dream`
 * if useful) so the subagent can inventory existing reusable assets before
 * suggesting new ones.
 *
 *  - `skill_list`   — installed skills (`ResourceLoader.getSkills()`)
 *  - `command_list` — registered slash commands (`ResourceLoader.getExtensions().extensions[].commands`)
 *  - `agent_list`   — registered subagent definition files (`ResourceLoader.getAgentsFiles()`)
 *
 * Spec deviation: the spec mentioned `extensionRunner.getRegisteredCommands()`
 * + a separate `agentRegistry`. Pi CLI SDK exposes both via `ResourceLoader`
 * directly (extensions carry their `commands` map; agent files are loaded by
 * the resource loader), so we accept just `ResourceLoader` and source both
 * lists from it.
 */

// ── Schemas ──────────────────────────────────────────────────────

const emptySchema = Type.Object({}, { description: "No arguments." });

interface SkillItem {
    name: string;
    description: string;
    filePath: string;
    disableModelInvocation: boolean;
}
interface CommandItem {
    name: string;
    description?: string;
    sourcePath: string;
}
interface AgentFileItem {
    path: string;
    /** Truncated to first 500 chars to keep subagent budget sane. */
    preview: string;
}

interface SkillListDetails { skills: SkillItem[] }
interface CommandListDetails { commands: CommandItem[] }
interface AgentListDetails { agents: AgentFileItem[] }

const PREVIEW_MAX = 500;

// ── Factory ─────────────────────────────────────────────────────

export function createAssetInventoryTools(resourceLoader: ResourceLoader): ToolDefinition[] {
    const skillListTool = defineTool({
        name: "skill_list",
        label: "Skill List",
        description: "List installed skills (prompt fragments the user can invoke by name).",
        parameters: emptySchema,
        async execute(): Promise<AgentToolResult<SkillListDetails>> {
            const { skills } = resourceLoader.getSkills();
            const items: SkillItem[] = skills.map((s) => ({
                name: s.name,
                description: s.description,
                filePath: s.filePath,
                disableModelInvocation: s.disableModelInvocation,
            }));
            return {
                content: [{ type: "text", text: formatSkills(items) }],
                details: { skills: items },
            };
        },
    });

    const commandListTool = defineTool({
        name: "command_list",
        label: "Command List",
        description: "List registered slash commands exposed by extensions.",
        parameters: emptySchema,
        async execute(): Promise<AgentToolResult<CommandListDetails>> {
            const { extensions } = resourceLoader.getExtensions();
            const items: CommandItem[] = [];
            for (const ext of extensions) {
                for (const [name, cmd] of ext.commands) {
                    items.push({
                        name,
                        description: cmd.description,
                        sourcePath: ext.path,
                    });
                }
            }
            items.sort((a, b) => a.name.localeCompare(b.name));
            return {
                content: [{ type: "text", text: formatCommands(items) }],
                details: { commands: items },
            };
        },
    });

    const agentListTool = defineTool({
        name: "agent_list",
        label: "Agent List",
        description:
            "List subagent definition files (`.pi/agents/*.md`) discovered by the resource loader. " +
            "Returns path + a short content preview.",
        parameters: emptySchema,
        async execute(): Promise<AgentToolResult<AgentListDetails>> {
            const { agentsFiles } = resourceLoader.getAgentsFiles();
            const items: AgentFileItem[] = agentsFiles.map((f) => ({
                path: f.path,
                preview: f.content.length > PREVIEW_MAX
                    ? f.content.slice(0, PREVIEW_MAX) + "..."
                    : f.content,
            }));
            return {
                content: [{ type: "text", text: formatAgentFiles(items) }],
                details: { agents: items },
            };
        },
    });

    return [skillListTool, commandListTool, agentListTool];
}

// ── Formatters ───────────────────────────────────────────────────

function formatSkills(items: SkillItem[]): string {
    if (items.length === 0) return "No skills installed.";
    const lines = items.map((s) =>
        `- ${s.name}${s.disableModelInvocation ? " (no-model-invocation)" : ""}: ${s.description}`,
    );
    return [`Found ${items.length} skill(s):`, ...lines].join("\n");
}

function formatCommands(items: CommandItem[]): string {
    if (items.length === 0) return "No commands registered.";
    const lines = items.map((c) => {
        const desc = c.description ? `: ${c.description}` : "";
        return `- /${c.name}${desc}`;
    });
    return [`Found ${items.length} command(s):`, ...lines].join("\n");
}

function formatAgentFiles(items: AgentFileItem[]): string {
    if (items.length === 0) return "No agent files discovered.";
    const lines = items.map((a) => `- ${a.path}\n  ${a.preview.split("\n").slice(0, 3).join(" / ")}`);
    return [`Found ${items.length} agent file(s):`, ...lines].join("\n");
}
