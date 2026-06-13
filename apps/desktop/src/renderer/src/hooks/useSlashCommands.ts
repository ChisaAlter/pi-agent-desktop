import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isIpcError, type PiSlashCommand } from "@shared";
import { fuzzyScore } from "../utils/fuzzy-match";

export interface SlashCommandMatch {
    start: number;
    end: number;
    query: string;
}

export interface SlashCommandCandidate {
    command: PiSlashCommand;
    score: number;
}

export interface UseSlashCommandsReturn {
    activeCommand: SlashCommandMatch | null;
    candidates: SlashCommandCandidate[];
    highlightIndex: number;
    setHighlightIndex: React.Dispatch<React.SetStateAction<number>>;
    selectCandidate: (candidate: SlashCommandCandidate) => string;
    close: () => void;
}

function findActiveSlashCommand(text: string, cursorPosition: number): SlashCommandMatch | null {
    const cursor = Math.max(0, Math.min(cursorPosition, text.length));
    const match = text.match(/^(\s*)\/([^\s]*)/);
    if (!match) return null;
    const start = match[1]?.length ?? 0;
    const token = match[2] ?? "";
    if (token.includes("/") || token.includes("\\")) return null;
    const end = start + 1 + token.length;
    if (cursor < start + 1 || cursor > end) return null;
    return {
        start,
        end,
        query: text.slice(start + 1, cursor),
    };
}

function displayText(command: PiSlashCommand): string {
    return `${command.name} ${command.description ?? ""} ${command.source}`;
}

export function useSlashCommands(
    text: string,
    cursorPosition: number,
    workspaceId: string | undefined,
    agentId?: string | null,
): UseSlashCommandsReturn {
    const [activeCommand, setActiveCommand] = useState<SlashCommandMatch | null>(null);
    const [commands, setCommands] = useState<PiSlashCommand[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [dismissedText, setDismissedText] = useState<string | null>(null);

    useEffect(() => {
        const match = findActiveSlashCommand(text, cursorPosition);
        setActiveCommand(match && text !== dismissedText ? match : null);
        if (!match) setHighlightIndex(0);
    }, [cursorPosition, dismissedText, text]);

    useEffect(() => {
        if (!workspaceId || !window.piAPI?.listSlashCommands) {
            setCommands([]);
            return;
        }
        let cancelled = false;
        window.piAPI.listSlashCommands(workspaceId, agentId ?? undefined)
            .then((result) => {
                if (cancelled) return;
                setCommands(isIpcError(result) ? [] : result);
            })
            .catch(() => {
                if (!cancelled) setCommands([]);
            });
        return () => {
            cancelled = true;
        };
    }, [agentId, workspaceId]);

    const candidates = useMemo(() => {
        if (!activeCommand) return [];
        return commands
            .map((command) => ({
                command,
                score: Math.max(
                    fuzzyScore(command.name, activeCommand.query),
                    fuzzyScore(displayText(command), activeCommand.query),
                ),
            }))
            .filter((candidate) => candidate.score > 0)
            .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
            .slice(0, 20);
    }, [activeCommand, commands]);

    useEffect(() => {
        setHighlightIndex(0);
    }, [activeCommand?.query]);

    const selectCandidate = useCallback(
        (candidate: SlashCommandCandidate): string => {
            if (!activeCommand) return text;
            const replacement = `/${candidate.command.name}${candidate.command.requiresArgument ? " " : ""}`;
            const nextText = `${text.slice(0, activeCommand.start)}${replacement}${text.slice(activeCommand.end)}`;
            setDismissedText(nextText);
            setActiveCommand(null);
            setHighlightIndex(0);
            return nextText;
        },
        [activeCommand, text],
    );

    const close = useCallback(() => {
        setDismissedText(text);
        setActiveCommand(null);
        setHighlightIndex(0);
    }, [text]);

    return {
        activeCommand,
        candidates,
        highlightIndex,
        setHighlightIndex,
        selectCandidate,
        close,
    };
}
