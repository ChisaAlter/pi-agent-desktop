import { ipcMain } from "electron";
import {
    ipcError,
    type HerdrFocusAgentInput,
    type HerdrInstallIntegrationInput,
    type HerdrPromptAgentInput,
    type HerdrReadAgentOutputInput,
    type HerdrSendAgentKeysInput,
    type HerdrStopServerInput,
} from "@shared";
import type { HerdrStateBridge } from "../services/herdr/state-bridge";
import {
    herdrFocusAgentSchema,
    herdrInstallIntegrationSchema,
    herdrPromptAgentSchema,
    herdrReadAgentOutputSchema,
    herdrSendAgentKeysSchema,
    herdrStopServerSchema,
} from "./schemas";

export interface HerdrIpcSupervisor {
    stop(): Promise<boolean>;
}

export interface HerdrIpcOptions {
    bridge: HerdrStateBridge;
    supervisor: HerdrIpcSupervisor;
}

export function setupHerdrIpc(options: HerdrIpcOptions): void {
    const { bridge, supervisor } = options;

    ipcMain.handle("herdr:get-status", () => {
        try {
            return bridge.getProjection().status;
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.statusFailed", error, "读取 Herdr 状态失败");
        }
    });

    ipcMain.handle("herdr:get-snapshot", async () => {
        try {
            return await bridge.refresh();
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.snapshotFailed", error, "读取 Herdr 快照失败");
        }
    });

    ipcMain.handle("herdr:read-agent-output", async (_event, input: HerdrReadAgentOutputInput) => {
        const parsed = herdrReadAgentOutputSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.invalidRead", "无效的历史输出读取参数");
        }
        try {
            return await bridge.readAgentOutput(parsed.data);
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.readFailed", error, "读取 Herdr 历史输出失败");
        }
    });

    ipcMain.handle("herdr:focus-agent", async (_event, input: HerdrFocusAgentInput) => {
        const parsed = herdrFocusAgentSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.invalidFocus", "无效的智能体聚焦参数");
        }
        try {
            return await bridge.focusAgent(parsed.data);
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.focusFailed", error, "聚焦 Herdr 智能体失败");
        }
    });

    ipcMain.handle("herdr:prompt-agent", async (_event, input: HerdrPromptAgentInput) => {
        const parsed = herdrPromptAgentSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.invalidPrompt", "无效的智能体指令参数");
        }
        try {
            return await bridge.promptAgent(parsed.data);
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.promptFailed", error, "向 Herdr 智能体发送指令失败");
        }
    });

    ipcMain.handle("herdr:send-agent-keys", async (_event, input: HerdrSendAgentKeysInput) => {
        const parsed = herdrSendAgentKeysSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.invalidKeys", "无效的按键序列参数");
        }
        try {
            await bridge.sendAgentKeys(parsed.data);
            return undefined;
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.keysFailed", error, "向 Herdr 智能体发送按键失败");
        }
    });

    ipcMain.handle("herdr:start-server", async () => {
        try {
            return await bridge.start();
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.startFailed", error, "启动或连接 Herdr 失败");
        }
    });

    ipcMain.handle("herdr:stop-server", async (_event, input: HerdrStopServerInput) => {
        const parsed = herdrStopServerSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.stopUnconfirmed", "停止 Herdr 服务必须显式确认");
        }
        try {
            bridge.stop();
            await supervisor.stop();
            return undefined;
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.stopFailed", error, "停止 Herdr 服务失败");
        }
    });

    ipcMain.handle("herdr:install-integration", async (_event, input: HerdrInstallIntegrationInput) => {
        const parsed = herdrInstallIntegrationSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.herdr.installUnconfirmed", "安装 Pi 集成必须显式确认且目标只能是 pi");
        }
        try {
            await bridge.installIntegration(parsed.data.target);
            return undefined;
        } catch (error) {
            return herdrIpcError("ipcErrors.herdr.installFailed", error, "安装 Herdr Pi 集成失败");
        }
    });
}

function herdrIpcError(code: string, error: unknown, fallbackPrefix: string) {
    const message = error instanceof Error ? error.message : String(error);
    return ipcError(code, `${fallbackPrefix}: ${message}`, { message });
}
