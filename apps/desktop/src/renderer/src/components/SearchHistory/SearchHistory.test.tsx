// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareSearchResults, SearchHistory, sliceMatchWindow } from "./SearchHistory";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

describe("sliceMatchWindow", () => {
    it("windows before/match/after around the hit", () => {
        const text = "abcdefghijklmnopqrstuvwxyz";
        expect(sliceMatchWindow(text, 10, 3, 2)).toEqual({
            before: "ij",
            match: "klm",
            after: "no",
        });
    });

    it("clamps the start of the before window", () => {
        expect(sliceMatchWindow("hello world", 0, 5, 30)).toEqual({
            before: "",
            match: "hello",
            after: " world",
        });
    });
});

describe("compareSearchResults", () => {
    it("prefers the current workspace then newer timestamps", () => {
        const olderLocal = { workspaceId: "ws1", timestamp: new Date(1) };
        const newerOther = { workspaceId: "ws2", timestamp: new Date(99) };
        const newerLocal = { workspaceId: "ws1", timestamp: new Date(50) };
        expect(compareSearchResults(olderLocal, newerOther, "ws1")).toBeLessThan(0);
        expect(compareSearchResults(newerOther, olderLocal, "ws1")).toBeGreaterThan(0);
        expect(compareSearchResults(olderLocal, newerLocal, "ws1")).toBeGreaterThan(0);
    });
});

describe("SearchHistory", () => {
    beforeEach(() => {
        Object.defineProperty(window, "piAPI", {
            value: undefined,
            configurable: true,
        });

        useWorkspaceStore.setState({
            workspaces: [
                {
                    id: "ws1",
                    name: "repo",
                    path: "C:/repo",
                    createdAt: new Date(0),
                    lastActiveAt: new Date(0),
                },
                {
                    id: "ws2",
                    name: "other-repo",
                    path: "C:/other",
                    createdAt: new Date(0),
                    lastActiveAt: new Date(0),
                },
            ],
            currentWorkspaceId: "ws1",
            loaded: true,
            lastError: null,
        });

        useSessionStore.setState({
            sessions: [
                {
                    id: "active-session",
                    title: "Active Session",
                    workspaceId: "ws1",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    archived: false,
                    messages: [
                        {
                            id: "msg-active",
                            role: "user",
                            content: "alpha visible result",
                            timestamp: new Date(0),
                        },
                        {
                            id: "msg-generated-ui",
                            role: "assistant",
                            content: "",
                            timestamp: new Date(1),
                            generatedUi: {
                                version: "v1",
                                id: "ui-search",
                                title: "交付结果",
                                sections: [
                                    {
                                        id: "files",
                                        kind: "file_list",
                                        items: [{ id: "file-1", label: "report.md", path: "docs/report.md" }],
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    id: "archived-session",
                    title: "Archived Session",
                    workspaceId: "ws2",
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    archived: true,
                    messages: [
                        {
                            id: "msg-archived",
                            role: "assistant",
                            content: "omega archived only",
                            timestamp: new Date(0),
                        },
                    ],
                },
            ],
            currentSessionId: null,
            sessionsLoading: false,
            persistErrorCount: 0,
            lastPersistError: null,
        } as Partial<ReturnType<typeof useSessionStore.getState>>);
    });

    it("includes archived workspace sessions in history search results", () => {
        const onNavigate = vi.fn();
        render(<SearchHistory isOpen onClose={vi.fn()} onNavigate={onNavigate} />);

        fireEvent.change(screen.getByRole("textbox", { name: "搜索对话历史" }), {
            target: { value: "omega" },
        });

        expect(screen.getByRole("button", { name: /Archived Session/ })).toBeTruthy();
        expect(screen.getByText("other-repo")).toBeTruthy();
    });

    it("searches generated ui text when the persisted message content is empty", () => {
        render(<SearchHistory isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);

        fireEvent.change(screen.getByRole("textbox", { name: "搜索对话历史" }), {
            target: { value: "report.md" },
        });

        expect(screen.getAllByRole("button", { name: /Active Session/ }).length).toBeGreaterThan(0);
        expect(screen.getByText(/docs\/report\.md/)).toBeTruthy();
    });

    it("exposes close and result focus-visible rings and empty query hint", () => {
        const onClose = vi.fn();
        render(<SearchHistory isOpen onClose={onClose} onNavigate={vi.fn()} />);

        expect(screen.getByText("输入关键词搜索所有对话")).toBeTruthy();
        const close = screen.getByRole("button", { name: "关闭搜索" });
        expect(close.className).toContain("focus-visible:ring-2");
        fireEvent.click(close);
        expect(onClose).toHaveBeenCalled();

        fireEvent.change(screen.getByRole("textbox", { name: "搜索对话历史" }), {
            target: { value: "alpha" },
        });
        const result = screen.getByRole("button", { name: /Active Session/ });
        expect(result.className).toContain("focus-visible:ring-2");
    });

    it("shows no-match empty state for unknown phrases", () => {
        render(<SearchHistory isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);
        fireEvent.change(screen.getByRole("textbox", { name: "搜索对话历史" }), {
            target: { value: "zzz-not-present" },
        });
        expect(screen.getByText("没有找到匹配的对话")).toBeTruthy();
    });


    it("wave-88 residual: search input keeps focus-visible ring", () => {
        render(<SearchHistory isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);
        const input = screen.getByRole("textbox", { name: "搜索对话历史" });
        expect(input.className).toContain("focus-visible:ring-2");
    });

});
