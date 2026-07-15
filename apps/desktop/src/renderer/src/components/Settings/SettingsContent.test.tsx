// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SettingsContent } from "./SettingsContent";

const { usageTabModuleLoaded, usageTabModulePromise, resolveUsageTabModule } = vi.hoisted(() => {
    let resolveUsageTabModule!: () => void;
    const usageTabModulePromise = new Promise<void>((resolve) => {
        resolveUsageTabModule = resolve;
    });
    return {
        usageTabModuleLoaded: vi.fn(),
        usageTabModulePromise,
        resolveUsageTabModule,
    };
});

vi.mock("./tabs/GeneralTab", () => ({
    GeneralTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-general" aria-labelledby="settings-tab-general">
            <h1>通用设置</h1>
            <div data-settings-anchor="general-language">语言</div>
            <div data-settings-anchor="general-notifications">通知</div>
        </div>
    ),
}));

vi.mock("./tabs/ManagedModelsPanel", () => ({
    ManagedModelsPanel: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-model" aria-labelledby="settings-tab-model">
            <h1>模型设置</h1>
            <div data-settings-anchor="model-defaults">默认模型</div>
            <div data-settings-anchor="model-provider-list">Provider 管理</div>
        </div>
    ),
}));

vi.mock("./tabs/PiAgentTab", () => ({
    PiAgentTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-piagent" aria-labelledby="settings-tab-piagent">
            <h1>Pi Code Agent</h1>
            <div data-settings-anchor="piagent-status">Pi CLI 状态</div>
            <div data-settings-anchor="piagent-defaults">默认 Provider / 模型</div>
        </div>
    ),
}));

vi.mock("./tabs/AppearanceTab", () => ({
    AppearanceTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-appearance" aria-labelledby="settings-tab-appearance">
            <h1>界面</h1>
        </div>
    ),
}));

vi.mock("./tabs/PermissionsTab", () => ({
    PermissionsTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-permissions" aria-labelledby="settings-tab-permissions">
            <h1>权限</h1>
        </div>
    ),
}));

vi.mock("./tabs/UsageTab", async () => {
    await usageTabModulePromise;
    usageTabModuleLoaded();
    return {
        UsageTab: () => (
            <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-usage" aria-labelledby="settings-tab-usage">
                <h1>用量</h1>
                <div data-settings-anchor="usage-overview">Token 用量概览</div>
            </div>
        ),
    };
});

vi.mock("./tabs/LongHorizonTab", () => ({
    LongHorizonTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-longHorizon" aria-labelledby="settings-tab-longHorizon">
            <h1>长程能力</h1>
        </div>
    ),
}));

vi.mock("./ShortcutsSettings/ShortcutsSettings", () => ({
    ShortcutsSettings: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-shortcuts" aria-labelledby="settings-tab-shortcuts">
            <h1>快捷键</h1>
        </div>
    ),
}));

vi.mock("./tabs/PiConfigEditor", () => ({
    PiConfigEditor: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-config" aria-labelledby="settings-tab-config">
            <h1>配置文件</h1>
        </div>
    ),
}));

vi.mock("./tabs/AboutTab", () => ({
    AboutTab: () => (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-about" aria-labelledby="settings-tab-about">
            <h1>关于</h1>
        </div>
    ),
}));

describe("SettingsContent", () => {
    beforeEach(() => {
        window.localStorage.setItem("pi-desktop.locale", "zh-CN");
        Object.defineProperty(window, "piAPI", {
            configurable: true,
            value: {
                setSettings: vi.fn(async () => undefined),
            },
        });
        Object.defineProperty(Element.prototype, "scrollIntoView", {
            configurable: true,
            value: vi.fn(),
        });
        Object.defineProperty(HTMLElement.prototype, "scrollTo", {
            configurable: true,
            value: vi.fn(),
        });
    });

    it("renders a single primary navigation with the redesigned left-nav sections and Pi Code Agent label", () => {
        render(
            <I18nProvider>
                <SettingsContent />
            </I18nProvider>,
        );

        expect(screen.getAllByRole("tablist")).toHaveLength(1);
        expect(screen.getAllByRole("tab", { name: "模型" })).toHaveLength(1);
        expect(screen.getAllByRole("tab", { name: "Pi Code Agent" })).toHaveLength(1);
        expect(screen.getByText("常用")).toBeTruthy();
        expect(screen.getByText("进阶")).toBeTruthy();
        expect(screen.getByText("维护")).toBeTruthy();

        const tabLabels = screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
        expect(tabLabels).toEqual([
            "通用",
            "模型",
            "Pi Code Agent",
            "界面",
            "权限",
            "用量",
            "长程能力",
            "快捷键",
            "配置文件",
            "关于",
        ]);
    });

    it("searches settings metadata locally and jumps to the matched field", async () => {
        render(
            <I18nProvider>
                <SettingsContent />
            </I18nProvider>,
        );

        const searchInput = screen.getByPlaceholderText("搜索设置...");
        fireEvent.change(searchInput, { target: { value: "语言" } });

        expect(screen.queryByText("常用")).toBeNull();
        expect(screen.getByRole("tab", { name: "通用 · 语言" })).toBeTruthy();

        fireEvent.click(screen.getByRole("tab", { name: "通用 · 语言" }));

        await waitFor(() => {
            expect(screen.getByText("通用设置")).toBeTruthy();
        });
        await waitFor(() => {
            expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        });

        fireEvent.change(searchInput, { target: { value: "" } });
        expect(await screen.findByText("常用")).toBeTruthy();
    });

    it("updates settings selection immediately and keys the active panel motion wrapper", () => {
        render(
            <I18nProvider>
                <SettingsContent />
            </I18nProvider>,
        );

        expect(screen.getByTestId("settings-active-panel").getAttribute("data-settings-active-tab")).toBe("general");

        fireEvent.click(screen.getByRole("tab", { name: "模型" }));

        const activePanel = screen.getByTestId("settings-active-panel");
        expect(activePanel.getAttribute("data-settings-active-tab")).toBe("model");
        expect(activePanel.className).toContain("settings-tab-panel-motion");
        expect(screen.getByRole("tab", { name: "模型" }).getAttribute("aria-selected")).toBe("true");
    });

    it("renders the permissions surface immediately on its first selection", () => {
        render(
            <I18nProvider>
                <SettingsContent />
            </I18nProvider>,
        );

        fireEvent.click(screen.getByRole("tab", { name: "权限" }));

        expect(screen.queryByTestId("settings-tab-loading")).toBeNull();
        expect(screen.getByRole("heading", { name: "权限" })).toBeTruthy();
    });

    it("loads non-default settings tabs only after they are selected", async () => {
        render(
            <I18nProvider>
                <SettingsContent />
            </I18nProvider>,
        );

        expect(screen.getByText("通用设置")).toBeTruthy();
        expect(usageTabModuleLoaded).not.toHaveBeenCalled();

        const searchInput = screen.getByPlaceholderText("搜索设置...");
        fireEvent.change(searchInput, { target: { value: "Token" } });
        fireEvent.click(screen.getByRole("tab", { name: "用量 · Token 用量概览" }));

        expect(screen.getByTestId("settings-tab-loading")).toBeTruthy();
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
        resolveUsageTabModule();

        expect(await screen.findByRole("heading", { name: "用量" })).toBeTruthy();
        expect(usageTabModuleLoaded).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        });
    });
});
