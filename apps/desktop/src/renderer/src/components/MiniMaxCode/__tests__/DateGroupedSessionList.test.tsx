// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateGroupedSessionList } from "../DateGroupedSessionList";
import { useSessionStore, type Session } from "../../../stores/session-store";
import { I18nProvider } from "../../../i18n";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function makeSession(overrides: Partial<Session> & { id: string }): Session {
    const now = new Date();
    return {
        title: overrides.id,
        workspaceId: "w1",
        createdAt: now,
        updatedAt: now,
        messages: [],
        ...overrides,
    };
}

function daysAgo(n: number): Date {
    return new Date(Date.now() - n * 86400000);
}

beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
        value: {
            listSessions: async () => [],
            createSession: async () => undefined,
            deleteSession: async () => undefined,
            renameSession: async () => undefined,
            archiveSession: async () => undefined,
        },
        configurable: true,
    });
    useSessionStore.setState({ sessions: [], currentSessionId: null });
});

describe("DateGroupedSessionList", () => {
    it("空态: 无会话时显示空提示", () => {
        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );
        expect(screen.getByText("还没有会话。")).toBeTruthy();
    });

    it("今天分组: updatedAt 为今天的会话归入「今天」", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s1", updatedAt: new Date() })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("今天")).toBeTruthy();
        expect(screen.getByRole("button", { name: "s1" })).toBeTruthy();
    });

    it("昨天分组: updatedAt 为昨天的会话归入「昨天」", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_yesterday", updatedAt: daysAgo(1) })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("昨天")).toBeTruthy();
        fireEvent.click(screen.getByText("昨天"));
        expect(screen.getByRole("button", { name: "s_yesterday" })).toBeTruthy();
    });

    it("本周分组: 2-7天前的会话归入「本周」", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_week", updatedAt: daysAgo(3) })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("本周")).toBeTruthy();
        fireEvent.click(screen.getByText("本周"));
        expect(screen.getByRole("button", { name: "s_week" })).toBeTruthy();
    });

    it("本月分组: 8-30天前的会话归入「本月」", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_month", updatedAt: daysAgo(15) })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("本月")).toBeTruthy();
        fireEvent.click(screen.getByText("本月"));
        expect(screen.getByRole("button", { name: "s_month" })).toBeTruthy();
    });

    it("更早分组: 31+天前的会话归入「更早」", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_old", updatedAt: daysAgo(60) })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("更早")).toBeTruthy();
        fireEvent.click(screen.getByText("更早"));
        expect(screen.getByRole("button", { name: "s_old" })).toBeTruthy();
    });

    it("多分组同时存在: 今天 + 更早", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "s_today", updatedAt: new Date() }),
                makeSession({ id: "s_old", updatedAt: daysAgo(90) }),
            ],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByText("今天")).toBeTruthy();
        expect(screen.getByText("更早")).toBeTruthy();
    });

    it("点击会话触发 onSelectSession 回调", () => {
        const onSelect = vi.fn();
        useSessionStore.setState({
            sessions: [makeSession({ id: "s1", updatedAt: new Date() })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={onSelect}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "s1" }));
        expect(onSelect).toHaveBeenCalledWith("s1");
    });

    it("会话操作按钮悬浮覆盖且标题不为按钮预留右侧空隙", () => {
        const longTitle = "了解一下这个项目并检查所有关键入口";
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_long", title: longTitle, updatedAt: new Date() })],
        });

        const { container } = renderWithI18n(
            <DateGroupedSessionList
                currentSessionId="s_long"
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        const titleButton = screen.getByRole("button", { name: longTitle });
        const actions = container.querySelector('[data-session-actions="s_long"]');
        expect(titleButton.className).toContain("pr-0");
        expect(actions?.className ?? "").toContain("absolute");
        expect(actions?.className ?? "").toContain("right-1");
        expect(actions?.querySelector("button")?.className ?? "").toContain("pointer-events-none");
        expect(actions?.querySelector("button")?.className ?? "").toContain("group-hover:pointer-events-auto");
    });

    it("会话行不显示相对时间", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s_no_time", title: "不显示时间", updatedAt: new Date() })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId="s_no_time"
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: "不显示时间" }).textContent).toBe("不显示时间");
        expect(screen.queryByText(/分钟前|刚刚|小时前/)).toBeNull();
    });

    it("点击归档和删除悬浮按钮不会触发会话选择", () => {
        const onSelect = vi.fn();
        const onArchive = vi.fn();
        useSessionStore.setState({
            sessions: [makeSession({ id: "s1", title: "长标题会话", updatedAt: new Date() })],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={onSelect}
                onArchiveSession={onArchive}
                onDeleteSession={() => undefined}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "归档 长标题会话" }));
        fireEvent.click(screen.getByRole("button", { name: "删除 长标题会话" }));

        expect(onArchive).toHaveBeenCalledWith("s1", true);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("当前选中会话标记 aria-current=page", () => {
        useSessionStore.setState({
            sessions: [makeSession({ id: "s1", updatedAt: new Date() })],
            currentSessionId: "s1",
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId="s1"
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: "s1" }).getAttribute("aria-current")).toBe("page");
        expect(screen.getByRole("button", { name: "s1" }).className).toContain("shadow-");
    });

    it("选择会话不会因为 lastOpenedAt 更新而重排列表", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "older", title: "较早更新", updatedAt: new Date(Date.now() - 120_000), lastOpenedAt: new Date() }),
                makeSession({ id: "newer", title: "较新更新", updatedAt: new Date(Date.now() - 60_000) }),
            ],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId="older"
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        const sessionButtons = screen.getAllByRole("button")
            .filter((button) => ["较新更新", "较早更新"].includes(button.getAttribute("aria-label") ?? ""));
        expect(sessionButtons.map((button) => button.textContent)).toEqual(["较新更新", "较早更新"]);
    });

    it("归档会话不显示在活跃列表中", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "s_active", updatedAt: new Date() }),
                makeSession({ id: "s_archived", updatedAt: new Date(), archived: true }),
            ],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        expect(screen.getByRole("button", { name: "s_active" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "s_archived" })).toBeNull();
    });

    it("已归档区域: 展开后显示归档会话", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "s_archived", updatedAt: new Date(), archived: true }),
            ],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        const archivedBtn = screen.getByRole("button", { name: /已归档/ });
        fireEvent.click(archivedBtn);

        expect(screen.getByRole("button", { name: "s_archived" })).toBeTruthy();
    });

    it("分组计数徽章显示正确数量", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "s1", updatedAt: new Date() }),
                makeSession({ id: "s2", updatedAt: new Date() }),
                makeSession({ id: "s3", updatedAt: daysAgo(60) }),
            ],
        });

        const { container } = renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        const badges = container.querySelectorAll('[class*="rounded bg-"]');
        const badgeTexts = Array.from(badges).map((b) => b.textContent);
        expect(badgeTexts).toContain("2");
        expect(badgeTexts).toContain("1");
    });

    it("分组默认折叠: 非今天分组默认不展开", () => {
        useSessionStore.setState({
            sessions: [
                makeSession({ id: "s_today", updatedAt: new Date() }),
                makeSession({ id: "s_old", updatedAt: daysAgo(60) }),
            ],
        });

        renderWithI18n(
            <DateGroupedSessionList
                currentSessionId={null}
                onSelectSession={() => undefined}
                onArchiveSession={() => undefined}
                onDeleteSession={() => undefined}
            />,
        );

        // Today group is expanded by default
        expect(screen.getByRole("button", { name: "s_today" })).toBeTruthy();
        // Earlier group is collapsed by default — session not visible
        expect(screen.queryByRole("button", { name: "s_old" })).toBeNull();
    });
});
