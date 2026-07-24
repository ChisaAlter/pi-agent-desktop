// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { ManagedModelsPanel } from "./ManagedModelsPanel";

describe("ManagedModelsPanel model actions", () => {
    beforeEach(() => {
        Object.assign(window, {
            piAPI: {
                configListManagedModels: vi.fn(async () => ({
                    configDir: "C:/Users/test/.pi/agent",
                    defaultProvider: "minimax",
                    defaultModel: "MiniMax-M3",
                    models: [{
                        providerId: "minimax",
                        providerName: "minimax",
                        modelId: "MiniMax-M3",
                        modelName: "MiniMax-M3",
                        baseUrl: "https://api.minimaxi.com/anthropic",
                        api: "anthropic-messages",
                        source: "json" as const,
                        isDefault: true,
                        hasApiKey: true,
                    }],
                })),
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps test, edit, and delete labels horizontal", async () => {
        render(
            <I18nProvider>
                <ManagedModelsPanel onPiConfigChanged={vi.fn(async () => undefined)} />
            </I18nProvider>,
        );

        await waitFor(() => expect(screen.getByRole("button", { name: "测试 MiniMax-M3" })).toBeTruthy());

        for (const name of ["测试 MiniMax-M3", "编辑 MiniMax-M3", "删除 MiniMax-M3"]) {
            expect(screen.getByRole("button", { name }).className).toContain("whitespace-nowrap");
        }
        expect(screen.getByTestId("managed-model-actions").className).toContain("w-[132px]");
    });

    it("preserves the configured model order before and after testing a model", async () => {
        const configTestProvider = vi.fn(async () => ({
            ok: true,
            status: 200,
            message: "连接成功",
        }));
        Object.defineProperty(window, "piAPI", {
            configurable: true,
            value: {
                configListManagedModels: vi.fn(async () => ({
                    configDir: "C:/Users/test/.pi/agent",
                    defaultProvider: "alpha",
                    defaultModel: "alpha-model",
                    models: [
                        {
                            providerId: "zeta",
                            providerName: "Zeta Provider",
                            modelId: "zeta-model",
                            modelName: "Zeta Model",
                            baseUrl: "https://zeta.example.com/v1",
                            source: "json" as const,
                            isDefault: false,
                            hasApiKey: true,
                        },
                        {
                            providerId: "alpha",
                            providerName: "Alpha Provider",
                            modelId: "alpha-model",
                            modelName: "Alpha Model",
                            baseUrl: "https://alpha.example.com/v1",
                            source: "json" as const,
                            isDefault: true,
                            hasApiKey: true,
                        },
                    ],
                })),
                configGetAuth: vi.fn(async () => ({ raw: "{}", parsed: {} })),
                configTestProvider,
            },
        });

        render(
            <I18nProvider>
                <ManagedModelsPanel onPiConfigChanged={vi.fn(async () => undefined)} />
            </I18nProvider>,
        );

        const testButtonLabels = (): Array<string | null> => screen
            .getAllByRole("button", { name: /^测试 / })
            .map((button) => button.getAttribute("aria-label"));
        await waitFor(() => {
            expect(testButtonLabels()).toEqual(["测试 Zeta Model", "测试 Alpha Model"]);
        });

        fireEvent.click(screen.getByRole("button", { name: "测试 Zeta Model" }));
        await waitFor(() => expect(configTestProvider).toHaveBeenCalledTimes(1));
        expect(testButtonLabels()).toEqual(["测试 Zeta Model", "测试 Alpha Model"]);
    });

    it("offers only OpenAI-compatible, Codex, and Claude Code API formats", async () => {
        render(
            <I18nProvider>
                <ManagedModelsPanel onPiConfigChanged={vi.fn(async () => undefined)} />
            </I18nProvider>,
        );

        await waitFor(() => expect(screen.getByRole("button", { name: "新增模型" })).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "新增模型" }));

        const apiSelect = screen.getByLabelText("API 类型");
        expect(within(apiSelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
            "OpenAI 兼容",
            "Codex",
            "Claude Code",
        ]);
    });

    it("retains the model form only for the bounded dialog exit", async () => {
        render(
            <I18nProvider>
                <ManagedModelsPanel onPiConfigChanged={vi.fn(async () => undefined)} />
            </I18nProvider>,
        );

        await waitFor(() => expect(screen.getByRole("button", { name: "新增模型" })).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "新增模型" }));
        const dialog = screen.getByRole("dialog", { name: "模型编辑" });

        vi.useFakeTimers();
        fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

        expect(dialog.getAttribute("data-motion-state")).toBe("exit");
        act(() => vi.advanceTimersByTime(180));
        expect(screen.queryByRole("dialog", { name: "模型编辑" })).toBeNull();
    });

    it("exposes list and dialog focus-visible rings for keyboard a11y", async () => {
        render(
            <I18nProvider>
                <ManagedModelsPanel onPiConfigChanged={vi.fn(async () => undefined)} />
            </I18nProvider>,
        );

        await waitFor(() => expect(screen.getByRole("button", { name: "新增模型" })).toBeTruthy());
        expect(screen.getByRole("button", { name: "新增模型" }).className).toContain("focus-visible:ring-2");
        expect(screen.getByRole("button", { name: "测试 MiniMax-M3" }).className).toContain("focus-visible:ring-2");
        expect(screen.getByRole("button", { name: "编辑 MiniMax-M3" }).className).toContain("focus-visible:ring-2");
        expect(screen.getByRole("button", { name: "删除 MiniMax-M3" }).className).toContain("focus-visible:ring-2");

        fireEvent.click(screen.getByRole("button", { name: "新增模型" }));
        const editDialog = screen.getByRole("dialog", { name: "模型编辑" });
        expect(within(editDialog).getByRole("button", { name: "关闭" }).className).toContain("focus-visible:ring-2");
        expect(within(editDialog).getByRole("button", { name: "保存模型" }).className).toContain("focus-visible:ring-2");
        fireEvent.click(within(editDialog).getByRole("button", { name: "取消" }));

        fireEvent.click(screen.getByRole("button", { name: "删除 MiniMax-M3" }));
        const deleteDialog = await screen.findByRole("dialog", { name: "删除模型确认" });
        expect(within(deleteDialog).getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
        expect(within(deleteDialog).getByRole("button", { name: "确认删除" }).className).toContain("focus-visible:ring-2");
    });
});
