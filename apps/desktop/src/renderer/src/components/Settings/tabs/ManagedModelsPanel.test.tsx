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
});
