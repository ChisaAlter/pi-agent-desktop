// @vitest-environment jsdom
//
// 复现用户报告:左侧"任务历史"列表点击没反应
// 验证两件事:
//   1) 点击会话项触发 onSectionChange('session:<id>') —— 行为 1
//   2) App 端路由处理 (if (s.startsWith('session:')) ...) 真的更新 store.currentSessionId —— 行为 2

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MiniMaxCodeSidebar } from "./MiniMaxCodeSidebar";
import { useSessionStore } from "../../stores/session-store";

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

// 复刻 App.tsx 里的路由(只关心 session: 分支 — 这是用户报的 bug)
const appRoute = (s: string): void => {
    if (s.startsWith("session:")) {
        useSessionStore.getState().setCurrentSession(s.slice("session:".length));
    }
};

const seedTwoSessions = (): void => {
    useSessionStore.setState({
        sessions: [
            { id: "s_old", title: "对项目的看法", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T09:00:00Z"), messages: [] },
            { id: "s_new", title: "了解项目", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
        ],
        currentSessionId: "s_old",
    });
};

describe("MiniMaxCodeSidebar — 任务历史点击行为", () => {
    it("草稿态只高亮新建任务", () => {
        seedTwoSessions();
        useSessionStore.setState({ currentSessionId: null });

        render(<MiniMaxCodeSidebar currentSection="new-task" onSectionChange={appRoute} />);

        expect(screen.getByRole("button", { name: "新建任务" }).getAttribute("aria-current")).toBe("page");
        expect(screen.getByRole("button", { name: "了解项目" }).getAttribute("aria-current")).toBeNull();
    });

    it("提供显式搜索入口", () => {
        let selected = "";
        render(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={(section) => { selected = section; }} />);

        fireEvent.click(screen.getByRole("button", { name: "搜索" }));

        expect(selected).toBe("search");
    });

    it("左下角展示 pi-agent 在线状态", () => {
        render(<MiniMaxCodeSidebar currentSection="chat" piAgentStatus="online" onSectionChange={() => undefined} />);

        expect(screen.getByRole("status", { name: "pi-agent 在线" })).toBeTruthy();
    });

    it("左下角展示 pi-agent 不在线状态", () => {
        render(<MiniMaxCodeSidebar currentSection="chat" piAgentStatus="offline" onSectionChange={() => undefined} />);

        expect(screen.getByRole("status", { name: "pi-agent 不在线" })).toBeTruthy();
    });

    it("左侧主导航展示 Git 入口并可切换", () => {
        let selected = "";
        render(<MiniMaxCodeSidebar currentSection="git" onSectionChange={(section) => { selected = section; }} />);

        const git = screen.getByRole("button", { name: "Git" });
        expect(git.getAttribute("data-mmcode-section")).toBe("git");
        expect(git.getAttribute("aria-current")).toBe("page");

        fireEvent.click(git);

        expect(selected).toBe("git");
    });

    it("左侧主导航展示 Files 入口并可切换", () => {
        let selected = "";
        render(<MiniMaxCodeSidebar currentSection="files" onSectionChange={(section) => { selected = section; }} />);

        const files = screen.getByRole("button", { name: "文件" });
        expect(files.getAttribute("data-mmcode-section")).toBe("files");
        expect(files.getAttribute("aria-current")).toBe("page");

        fireEvent.click(files);

        expect(selected).toBe("files");
    });

    it("真实会话态不再高亮新建任务", () => {
        seedTwoSessions();

        render(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={appRoute} />);

        expect(screen.getByRole("button", { name: "新建任务" }).getAttribute("aria-current")).toBeNull();
        expect(screen.getByRole("button", { name: "对项目的看法" }).getAttribute("aria-current")).toBe("page");
    });

    it("点击会话项 → onSectionChange('session:<id>') 被调 + store.currentSessionId 切换", () => {
        seedTwoSessions();
        render(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={appRoute} />);

        const newItem = screen.getByRole("button", { name: "了解项目" });
        // 点之前:新会话不是 active
        expect(newItem.getAttribute("aria-current")).toBeNull();

        fireEvent.click(newItem);

        expect(useSessionStore.getState().currentSessionId).toBe("s_new");
    });

    it("点击后:aria-current 从 'old' 翻转到 'new' (用户视觉信号)", () => {
        seedTwoSessions();
        render(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={appRoute} />);

        const oldItem = screen.getByRole("button", { name: "对项目的看法" });
        const newItem = screen.getByRole("button", { name: "了解项目" });

        // 初始:old active
        expect(oldItem.getAttribute("aria-current")).toBe("page");
        expect(newItem.getAttribute("aria-current")).toBeNull();

        fireEvent.click(newItem);

        // 翻转到 new
        expect(newItem.getAttribute("aria-current")).toBe("page");
        expect(oldItem.getAttribute("aria-current")).toBeNull();
    });

    it("从 'new' 切回 'old' 同样 work (覆盖第二条数据)", () => {
        useSessionStore.setState({
            sessions: [
                { id: "s_old", title: "对项目的看法", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T09:00:00Z"), messages: [] },
                { id: "s_new", title: "了解项目", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
            ],
            currentSessionId: "s_new",
        });
        render(<MiniMaxCodeSidebar currentSection="chat" onSectionChange={appRoute} />);

        const oldItem = screen.getByRole("button", { name: "对项目的看法" });
        fireEvent.click(oldItem);

        expect(useSessionStore.getState().currentSessionId).toBe("s_old");
    });

    it("只显示当前 workspace 的任务历史", () => {
        useSessionStore.setState({
            sessions: [
                { id: "s_w1", title: "当前项目", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T11:00:00Z"), messages: [] },
                { id: "s_w2", title: "其它项目", workspaceId: "w2", createdAt: new Date(), updatedAt: new Date("2026-06-06T12:00:00Z"), messages: [] },
            ],
            currentSessionId: "s_w1",
        });

        render(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} />);

        expect(screen.getByRole("button", { name: "当前项目" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "其它项目" })).toBeNull();
    });

    it("归档会话后从任务历史移到已归档", () => {
        seedTwoSessions();
        render(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} />);

        fireEvent.click(screen.getByRole("button", { name: "归档 了解项目" }));

        expect(screen.getByText("已归档")).toBeTruthy();
        expect(screen.getByRole("button", { name: "了解项目" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "恢复 了解项目" })).toBeTruthy();
        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_new")?.archived).toBe(true);
    });

    it("恢复已归档会话后可重新打开", () => {
        useSessionStore.setState({
            sessions: [
                { id: "s_archived", title: "归档任务", workspaceId: "w1", createdAt: new Date(), updatedAt: new Date("2026-06-06T12:00:00Z"), messages: [], archived: true },
            ],
            currentSessionId: null,
        });
        render(<MiniMaxCodeSidebar currentSection="chat" currentWorkspaceId="w1" onSectionChange={appRoute} />);

        fireEvent.click(screen.getByRole("button", { name: "归档任务" }));

        expect(useSessionStore.getState().sessions.find((s) => s.id === "s_archived")?.archived).toBe(false);
        expect(useSessionStore.getState().currentSessionId).toBe("s_archived");
    });
});
