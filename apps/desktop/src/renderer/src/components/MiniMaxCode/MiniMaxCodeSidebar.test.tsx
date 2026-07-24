// @vitest-environment jsdom
//
// 复现用户报告:左侧"任务历史"列表点击没反应
// 验证两件事:
//   1) 点击会话项触发 onSectionChange('session:<id>') —— 行为 1
//   2) App 端路由处理 (if (s.startsWith('session:')) ...) 真的更新 store.currentSessionId —— 行为 2

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MiniMaxCodeSidebar } from "./MiniMaxCodeSidebar";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { I18nProvider } from "../../i18n";
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from "./chromeButton";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
        value: {
            listSessions: async () => [],
            createSession: async () => undefined,
            deleteSession: async () => undefined,
            renameSession: async () => undefined,
            archiveSession: async () => undefined,
            updateSessionMetadata: async () => undefined,
        },
        configurable: true,
    });
    useSessionStore.setState({ sessions: [], currentSessionId: null });
    useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
});

// 复刻 App.tsx 里的路由(只关心 session: 分支 — 这是用户报的 bug)
const appRoute = (s: string): void => {
    if (s.startsWith("session:")) {
        useSessionStore.getState().setCurrentSession(s.slice("session:".length));
    }
};

const seedWorkspaceAndSessions = (): void => {
    useWorkspaceStore.setState({
        workspaces: [
            { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
        ],
        currentWorkspaceId: "w1",
        lastError: null,
    });
    useSessionStore.setState({
        sessions: [
            { id: "s_old", title: "对项目的看法", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T09:00:00Z"), messages: [] },
            { id: "s_new", title: "了解项目", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
        ],
        currentSessionId: "s_old",
    });
};

describe("MiniMaxCodeSidebar — 任务历史点击行为", () => {
    it("草稿态只高亮新建对话", () => {
        seedWorkspaceAndSessions();
        useSessionStore.setState({ currentSessionId: null });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="new-task" currentWorkspaceId="w1" onSectionChange={appRoute} />);

        expect(screen.getByRole("button", { name: "新建对话" }).getAttribute("aria-current")).toBe("page");
    });

    it("提供新建对话入口", () => {
        let selected = "";
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={(section) => { selected = section; }} />);

        fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

        expect(selected).toBe("new-task");
    });

    it("提供按时间/按工作区分组切换控件", () => {
        const onGroupModeChange = vi.fn();
        renderWithI18n(
            <MiniMaxCodeSidebar
                currentSection="chat"
                onSectionChange={() => undefined}
                groupMode="date"
                onGroupModeChange={onGroupModeChange}
            />,
        );

        expect(screen.getByText("分组方式")).toBeTruthy();
        expect(screen.getByText("时间")).toBeTruthy();
        expect(screen.getByText("工作区")).toBeTruthy();
        expect(screen.getByRole("button", { name: "按时间分组" }).getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(screen.getByRole("button", { name: "按工作区分组" }));

        expect(onGroupModeChange).toHaveBeenCalledWith("workspace");
    });

    it("将置顶区放在分组切换上方，并使用软分段切换样式", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s_pin", title: "置顶任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [], favorite: true },
                { id: "s_plain", title: "普通任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [] },
            ],
            currentSessionId: "s_pin",
        });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="date" />);

        const pinnedRegion = screen.getByRole("region", { name: "置顶" });
        const groupSwitch = screen.getByRole("group", { name: "会话分组方式" });
        const dateButton = screen.getByRole("button", { name: "按时间分组" });
        const workspaceButton = screen.getByRole("button", { name: "按工作区分组" });

        expect(groupSwitch.getAttribute("data-mmcode-group-switch")).toBe("soft-segmented");
        expect(pinnedRegion.compareDocumentPosition(groupSwitch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(groupSwitch.className).toContain("p-0.5");
        expect(groupSwitch.className).not.toContain("p-1");
        expect(dateButton.className).toContain("rounded-[6px]");
        expect(dateButton.className).toContain("h-7");
        expect(dateButton.className).not.toContain("h-8");
        expect(dateButton.className).toContain("focus-visible:!outline-none");
        expect(workspaceButton.className).toContain("focus-visible:!outline-none");
        expect(dateButton.className).toContain("shadow-");
    });

    it("reserves a 42px top strip so the sidebar header aligns with the workspace strip", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={() => undefined} />);

        const nav = screen.getByRole("navigation", { name: "会话列表" });
        const headerStrip = nav.firstElementChild as HTMLElement | null;
        const newTaskRow = screen.getByRole("button", { name: "新建对话" }).parentElement;
        const quickCreate = screen.getByRole("button", { name: "快速新建对话" });

        expect(nav.className).not.toContain("pt-5");
        expect(headerStrip?.className ?? "").toContain("min-h-[42px]");
        expect(headerStrip?.className ?? "").toContain("items-center");
        expect(newTaskRow?.className ?? "").toContain("h-7");
        expect(quickCreate.className).toContain("h-7");
        expect(screen.getByRole("button", { name: "新建对话" }).className).toContain("h-7");
    });

    it("merges the collapse button into the sidebar header so it shares the list's left edge", () => {
        renderWithI18n(
            <MiniMaxCodeSidebar
                {...({
                    currentSection: "chat",
                    onSectionChange: () => undefined,
                    onToggleCollapse: () => undefined,
                } as unknown as React.ComponentProps<typeof MiniMaxCodeSidebar>)}
            />,
        );

        const nav = screen.getByRole("navigation", { name: "会话列表" });
        const headerStrip = nav.firstElementChild as HTMLElement | null;
        const headerRow = headerStrip?.firstElementChild as HTMLElement | null;
        const collapseButton = screen.getByRole("button", { name: "折叠左侧栏" });
        const quickCreateButton = screen.getByRole("button", { name: "快速新建对话" });

        expect(headerRow?.className ?? "").not.toContain("mx-[11px]");
        expect(collapseButton.className).toContain("h-7");
        expect(collapseButton.className).toContain("w-7");
        expect(collapseButton.className).toContain("shrink-0");
        expect(collapseButton.className).toBe(MINIMAX_CHROME_ICON_BUTTON_CLASSNAME);
        expect(quickCreateButton.className).toBe(MINIMAX_CHROME_ICON_BUTTON_CLASSNAME);
    });

    it("不在会话侧栏展示 pi-agent 在线状态", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" piAgentStatus="online" onSectionChange={() => undefined} />);

        expect(screen.queryByRole("status", { name: "pi-agent 在线" })).toBeNull();
    });

    it("不在会话侧栏展示 pi-agent 不在线状态", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" piAgentStatus="offline" onSectionChange={() => undefined} />);

        expect(screen.queryByRole("status", { name: "pi-agent 不在线" })).toBeNull();
    });

    it("exposes new conversation control focus-visible ring for keyboard a11y", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={() => undefined} />);
        expect(screen.getByRole("button", { name: "新建对话" }).className).toContain(
            "focus-visible:ring-2",
        );
    });

    it("不再把设置作为会话侧栏入口", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={() => undefined} />);

        expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
    });

    it("按项目分组会话 — 当前工作区展开显示会话", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s_w1", title: "当前项目任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
            ],
            currentSessionId: "s_w1",
        });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        expect(screen.getByRole("button", { name: "当前项目任务" })).toBeTruthy();
    });

    it("点击会话项 → onSectionChange('session:<id>') 被调 + store.currentSessionId 切换", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        const newItem = screen.getByRole("button", { name: "了解项目" });
        expect(newItem.getAttribute("aria-current")).toBeNull();

        fireEvent.click(newItem);

        expect(useSessionStore.getState().currentSessionId).toBe("s_new");
    });

    it("点击后:aria-current 从 'old' 翻转到 'new' (用户视觉信号)", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        const oldItem = screen.getByRole("button", { name: "对项目的看法" });
        const newItem = screen.getByRole("button", { name: "了解项目" });

        expect(oldItem.getAttribute("aria-current")).toBe("page");
        expect(newItem.getAttribute("aria-current")).toBeNull();

        fireEvent.click(newItem);

        expect(newItem.getAttribute("aria-current")).toBe("page");
        expect(oldItem.getAttribute("aria-current")).toBeNull();
    });

    it("从 'new' 切回 'old' 同样 work (覆盖第二条数据)", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s_old", title: "对项目的看法", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T09:00:00Z"), messages: [] },
                { id: "s_new", title: "了解项目", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
            ],
            currentSessionId: "s_new",
        });
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        const oldItem = screen.getByRole("button", { name: "对项目的看法" });
        fireEvent.click(oldItem);

        expect(useSessionStore.getState().currentSessionId).toBe("s_old");
    });

    it("归档会话后从任务历史移到已归档", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.click(screen.getByRole("button", { name: "归档 了解项目" }));

        const archivedGroup = screen.getByRole("button", { name: /已归档/ });
        fireEvent.click(archivedGroup);
        expect(screen.getByRole("button", { name: "了解项目" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "恢复 了解项目" })).toBeTruthy();
        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_new")?.archived).toBe(true);
    });

    it("恢复已归档会话后可重新打开", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s_archived", title: "归档任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T12:00:00Z"), messages: [], archived: true },
            ],
            currentSessionId: null,
        });
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} />);

        fireEvent.click(screen.getByRole("button", { name: /已归档/ }));
        fireEvent.click(screen.getByRole("button", { name: "归档任务" }));

        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_archived")?.archived).toBe(false);
        expect(useSessionStore.getState().currentSessionId).toBe("s_archived");
    });

    it("currentSection='settings' 不会在会话侧栏产生高亮入口", () => {
        renderWithI18n(<MiniMaxCodeSidebar currentSection="settings" onSectionChange={() => undefined} />);

        expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
    });

    it("置顶会话显示在独立置顶区，并且不会在日期列表重复出现", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s_pin", title: "置顶任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [], favorite: true },
                { id: "s_plain", title: "普通任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [] },
            ],
            currentSessionId: "s_pin",
        });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="date" />);

        const pinnedRegion = screen.getByRole("region", { name: "置顶" });
        expect(within(pinnedRegion).getByRole("button", { name: "置顶任务" })).toBeTruthy();
        expect(screen.getAllByRole("button", { name: "置顶任务" })).toHaveLength(1);
        expect(screen.getByRole("button", { name: "普通任务" })).toBeTruthy();
    });

    it("hover 行动区只提供置顶和归档，不再提供删除", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        expect(screen.getByRole("button", { name: "置顶 了解项目" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "归档 了解项目" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "删除 了解项目" })).toBeNull();
    });

    it("点击右键菜单外部会关闭菜单", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.contextMenu(screen.getByRole("button", { name: "了解项目" }));
        expect(screen.getByRole("menu")).toBeTruthy();

        fireEvent.mouseDown(screen.getByRole("button", { name: "了解项目" }));

        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("右键菜单可以重命名会话", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.contextMenu(screen.getByRole("button", { name: "了解项目" }));
        const menu = screen.getByRole("menu");
        expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["重命名", "删除"]);
        fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
        const input = screen.getByRole("textbox", { name: "重命名会话 了解项目" });
        fireEvent.change(input, { target: { value: "已重命名项目" } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_new")?.title).toBe("已重命名项目");
    });

    it("右键删除 → 显示确认对话框，取消后不删除", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.contextMenu(screen.getByRole("button", { name: "了解项目" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));

        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeTruthy();
        expect(within(dialog).getByText(/确定删除/)).toBeTruthy();

        fireEvent.click(within(dialog).getByText("取消"));

        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_new")).toBeTruthy();
    });

    it("右键删除 → 确认后真正删除", () => {
        seedWorkspaceAndSessions();
        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.contextMenu(screen.getByRole("button", { name: "了解项目" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));

        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByText("确认"));

        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_new")).toBeUndefined();
    });

    it("空态展示「还没有会话」", () => {
        useWorkspaceStore.setState({ workspaces: [], currentWorkspaceId: null, lastError: null });
        useSessionStore.setState({ sessions: [], currentSessionId: null });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={() => undefined} />);

        expect(screen.getByText("还没有会话。")).toBeTruthy();
    });

    it("GroupHeader 单击只折叠不切换 workspace，点击名称才切换", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
                { id: "w2", name: "项目二", path: "/p2", createdAt: new Date(), lastActiveAt: new Date("2026-06-05T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s1", title: "任务1", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [] },
                { id: "s2", title: "任务2", workspaceId: "w2", createdAt: new Date(), updatedAt: new Date(), messages: [] },
            ],
            currentSessionId: "s1",
        });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        fireEvent.click(screen.getByText("项目二"));

        expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("w2");
    });

    it("多 workspace 分组 — 两个分组都渲染", () => {
        useWorkspaceStore.setState({
            workspaces: [
                { id: "w1", name: "项目一", path: "/p1", createdAt: new Date(), lastActiveAt: new Date("2026-06-06T12:00:00Z") },
                { id: "w2", name: "项目二", path: "/p2", createdAt: new Date(), lastActiveAt: new Date("2026-06-05T12:00:00Z") },
            ],
            currentWorkspaceId: "w1",
            lastError: null,
        });
        useSessionStore.setState({
            sessions: [
                { id: "s1", title: "任务一", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date(), messages: [] },
                { id: "s2", title: "任务二", workspaceId: "w2", createdAt: new Date(), updatedAt: new Date(), messages: [] },
            ],
            currentSessionId: "s1",
        });

        renderWithI18n(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} groupMode="workspace" />);

        expect(screen.getByText("项目一")).toBeTruthy();
        expect(screen.getByText("项目二")).toBeTruthy();
        expect(screen.getByRole("button", { name: "任务一" })).toBeTruthy();
    });
});
