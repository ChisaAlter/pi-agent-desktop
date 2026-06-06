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
});
