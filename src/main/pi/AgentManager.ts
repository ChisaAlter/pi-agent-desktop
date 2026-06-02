import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type {
	AgentRuntimeState,
	AgentTab,
	AvailableModel,
	ChatMessage,
	CreateAgentInput,
	Project,
	SendPromptInput,
} from "../../shared/types";
import { ipcChannels } from "../../shared/ipc";
import { PiProcess } from "./PiProcess";

export class AgentManager {
	private readonly agents = new Map<string, AgentRuntime>();
	private readonly messages = new Map<string, ChatMessage[]>();

	constructor(
		private readonly getProject: (id: string) => Project | undefined,
		private readonly getWindow: () => BrowserWindow | null,
	) {}

	list() {
		return [...this.agents.values()].map((runtime) => runtime.tab);
	}

	getMessages(agentId: string) {
		return this.messages.get(agentId) ?? [];
	}

	async loadMessages(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		const response = await runtime.process.client.request({
			type: "get_messages",
		});
		const messages = this.convertAgentMessages(
			agentId,
			(response.data as { messages?: unknown[] } | undefined)?.messages ?? [],
		);
		this.messages.set(agentId, messages);
		this.emit(ipcChannels.agentsMessage, { agentId, messages });
		return messages;
	}

	async create(input: CreateAgentInput) {
		const project = this.getProject(input.projectId);
		if (!project) throw new Error(`Project not found: ${input.projectId}`);

		const id = randomUUID();
		const existingForSession = input.sessionPath
			? [...this.agents.values()].find(
					(runtime) => runtime.tab.sessionPath === input.sessionPath,
				)
			: undefined;
		if (existingForSession) return existingForSession.tab;

		const tab: AgentTab = {
			id,
			projectId: project.id,
			cwd: project.path,
			title: input.title || `${project.name} agent`,
			status: "starting",
			createdAt: Date.now(),
		};

		const process = new PiProcess(project.path);
		const runtime: AgentRuntime = { tab, process };
		this.agents.set(id, runtime);
		this.messages.set(id, []);
		this.emitState();

		const client = process.start(input.sessionPath);

		process.on("event", (event) => this.handlePiEvent(id, event));
		process.on("stderr", (text) =>
			this.emit(ipcChannels.agentsLog, { agentId: id, text }),
		);
		process.on("protocol-error", (line) =>
			this.emit(ipcChannels.agentsLog, {
				agentId: id,
				text: `Protocol error: ${line}`,
			}),
		);
		process.on("exit", () => {
			tab.status = "closed";
			this.emitState();
		});
		process.on("error", (error) => {
			tab.status = "error";
			this.addMessage(id, "error", error.message);
			this.emitState();
		});

		try {
			const state = await client.request({ type: "get_state" });
			const data = state.data as
				| { sessionId?: string; sessionFile?: string; sessionName?: string }
				| undefined;
			tab.sessionId = data?.sessionId;
			tab.sessionPath = data?.sessionFile ?? input.sessionPath;
			tab.title =
				input.title ||
				data?.sessionName ||
				(input.sessionPath
					? `${project.name} 历史会话`
					: `${project.name} agent`);
			tab.status = "idle";
			await this.loadMessages(id).catch(() => undefined);
		} catch (error) {
			tab.status = "error";
			this.addMessage(
				id,
				"error",
				error instanceof Error ? error.message : String(error),
			);
		}

		this.emitState();
		return tab;
	}

	async sendPrompt(input: SendPromptInput) {
		const runtime = this.requireRuntime(input.agentId);
		const trimmed = input.message.trim();
		if (!trimmed) return;

		// 解析 !/!! 前缀：与 pi 终端行为一致
		// !command  → 执行命令并将输出发送给 LLM（excludeFromContext: false）
		// !!command → 执行命令但不将输出发送给 LLM（excludeFromContext: true）
		const isBashExcluded = trimmed.startsWith("!!");
		const isBashNormal = !isBashExcluded && trimmed.startsWith("!");

		if (isBashExcluded || isBashNormal) {
			const command = isBashExcluded
				? trimmed.slice(2).trim()
				: trimmed.slice(1).trim();
			if (command) {
				await this.executeBashCommand(input.agentId, command, isBashExcluded);
				return;
			}
		}

		this.addMessage(input.agentId, "user", trimmed);
		runtime.tab.status = "running";
		this.emitState();

		// streamingBehavior 只在 agent 忙碌时需要；UI 可以显式传 steer/followUp 以复用 pi 队列语义。
		await runtime.process.client.request({
			type: "prompt",
			message: trimmed,
			...(input.streamingBehavior
				? { streamingBehavior: input.streamingBehavior }
				: {}),
		});
	}

	/**
	 * 执行 bash 命令并通过 tool 消息展示输出，行为与 pi 终端的 !/!! 前缀一致。
	 * excludeFromContext 控制输出是否作为上下文发送给 LLM。
	 */
	private async executeBashCommand(
		agentId: string,
		command: string,
		excludeFromContext: boolean,
	) {
		this.addMessage(
			agentId,
			"user",
			`${excludeFromContext ? "!!" : "!"}${command}`,
		);
		const runtime = this.requireRuntime(agentId);
		runtime.tab.status = "running";
		this.emitState();

		try {
			const response = await runtime.process.client.request(
				{
					type: "bash",
					command,
					excludeFromContext,
				},
				60_000,
			);

			const data = response.data as
				| {
						output?: string;
						exitCode?: number;
						cancelled?: boolean;
						truncated?: boolean;
				  }
				| undefined;

			const output = data?.output ?? "";
			const exitCode = data?.exitCode ?? 0;
			const cancelled = data?.cancelled ?? false;

			if (cancelled) {
				this.addMessage(agentId, "system", "命令已取消");
			} else {
				// 以 tool 消息展示命令输出，与 pi 终端的 bash 结果展示保持一致
				const statusIcon = exitCode === 0 ? "✓" : "✗";
				const header = `${statusIcon} ${command}`;
				const detailSections = [
					`命令：${command}`,
					`退出码：${exitCode}`,
					output ? `输出：\n${output}` : "(无输出)",
				].filter(Boolean);
				this.addMessage(agentId, "tool", header, {
					status: exitCode === 0 ? "done" : "error",
					toolName: "bash",
					args: { command },
					result: { output, exitCode },
					isError: exitCode !== 0,
					detailText: detailSections.join("\n\n"),
				});
			}
		} catch (error) {
			this.addMessage(
				agentId,
				"error",
				`命令执行失败：${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			runtime.tab.status = "idle";
			this.emitState();
		}
	}

	async abort(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		// pi RPC 原生支持 abort，对应终端里的 Escape：停止当前 LLM/tool 流程并保留会话进程。
		await runtime.process.client
			.request({ type: "abort" }, 10_000)
			.catch((error) => {
				this.addMessage(
					agentId,
					"error",
					error instanceof Error ? error.message : String(error),
				);
			});
		runtime.tab.status = "idle";
		this.addMessage(agentId, "system", "已请求停止当前响应");
		this.emitState();
	}

	/**
	 * 手动触发上下文压缩。pi 会将历史消息摘要化以释放 context 空间，
	 * 适用于长时间对话后 context 占比过高、但不想丢失关键信息的场景。
	 */
	async compact(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		await runtime.process.client.request({ type: "compact" }, 120_000);
		await this.loadMessages(agentId).catch(() => undefined);
		return this.getRuntimeState(agentId);
	}

	async getRuntimeState(agentId: string): Promise<AgentRuntimeState> {
		const runtime = this.requireRuntime(agentId);
		const [stateResponse, statsResponse] = await Promise.all([
			runtime.process.client
				.request({ type: "get_state" })
				.catch(() => ({ data: undefined })),
			runtime.process.client
				.request({ type: "get_session_stats" })
				.catch(() => ({ data: undefined })),
		]);
		const state = stateResponse.data as any;
		const stats = statsResponse.data as any;
		const model = state?.model;
		const tokens = stats?.tokens;
		return {
			modelName: model?.name ?? model?.id,
			provider: model?.provider,
			modelId: model?.id,
			thinkingLevel: state?.thinkingLevel,
			isStreaming: state?.isStreaming,
			isCompacting: state?.isCompacting,
			contextTokens: stats?.contextUsage?.tokens,
			contextWindow: stats?.contextUsage?.contextWindow ?? model?.contextWindow,
			contextPercent: stats?.contextUsage?.percent,
			cacheRead: tokens?.cacheRead,
			cacheWrite: tokens?.cacheWrite,
			cacheTotal: (tokens?.cacheRead ?? 0) + (tokens?.cacheWrite ?? 0),
			cost: stats?.cost,
		};
	}

	async cycleModel(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		await runtime.process.client.request({ type: "cycle_model" }, 60_000);
		return this.getRuntimeState(agentId);
	}

	async getAvailableModels(agentId: string): Promise<AvailableModel[]> {
		const runtime = this.requireRuntime(agentId);
		const response = await runtime.process.client.request(
			{ type: "get_available_models" },
			60_000,
		);
		return ((response.data as any)?.models ?? []) as AvailableModel[];
	}

	async setModel(agentId: string, provider: string, modelId: string) {
		const runtime = this.requireRuntime(agentId);
		await runtime.process.client.request(
			{ type: "set_model", provider, modelId },
			60_000,
		);
		return this.getRuntimeState(agentId);
	}

	async cycleThinking(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		await runtime.process.client.request(
			{ type: "cycle_thinking_level" },
			60_000,
		);
		return this.getRuntimeState(agentId);
	}

	async setThinking(agentId: string, level: string) {
		const runtime = this.requireRuntime(agentId);
		await runtime.process.client.request(
			{ type: "set_thinking_level", level },
			60_000,
		);
		return this.getRuntimeState(agentId);
	}

	async reload(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		// RPC 没有专门的 reload command；pi 文档说明 extension/斜线命令应通过 prompt 入口执行。
		await runtime.process.client.request(
			{ type: "prompt", message: "/reload" },
			60_000,
		);
		await this.loadMessages(agentId).catch(() => undefined);
	}

	/**
	 * 重启 agent 进程：停止当前 pi RPC 子进程，用同一个 session 重新启动。
	 * 适用场景：修改了 provider 配置、切换了 API key、更新了 pi 版本后，
	 * /reload 只重载 extension，不会重新读取配置文件，restart 才能生效。
	 */
	async restart(agentId: string): Promise<AgentTab> {
		const runtime = this.requireRuntime(agentId);
		const { projectId, sessionPath, title } = runtime.tab;

		// 停止旧进程并清理状态
		runtime.process.stop();
		this.agents.delete(agentId);
		this.messages.delete(agentId);
		this.emitState();

		// 用相同的 session 重新创建 agent，新进程会重新加载所有配置
		return this.create({ projectId, sessionPath, title });
	}

	async exportHtml(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		const response = await runtime.process.client.request(
			{ type: "export_html" },
			120_000,
		);
		return response.data;
	}

	async getCommands(agentId: string) {
		const runtime = this.requireRuntime(agentId);
		const response = await runtime.process.client.request({
			type: "get_commands",
		});
		return (
			(response.data as { commands?: unknown[] } | undefined)?.commands ?? []
		);
	}

	async stop(agentId: string) {
		const runtime = this.agents.get(agentId);
		if (!runtime) return;
		runtime.process.stop();
		this.agents.delete(agentId);
		this.messages.delete(agentId);
		this.emitState();
	}

	stopAll() {
		// 应用退出时统一清理所有 pi 子进程，避免后台 agent 残留占用模型或文件句柄。
		for (const runtime of this.agents.values()) {
			runtime.process.stop();
		}
		this.agents.clear();
		this.messages.clear();
		this.emitState();
	}

	private handlePiEvent(agentId: string, event: unknown) {
		this.emit(ipcChannels.agentsEvent, { agentId, event });

		if (!event || typeof event !== "object") return;
		const typed = event as Record<string, any>;
		const runtime = this.agents.get(agentId);

		if (typed.type === "agent_start" && runtime) {
			runtime.tab.status = "running";
			this.emitState();
		}

		if (typed.type === "agent_end" && runtime) {
			runtime.tab.status = "idle";
			this.emitState();
		}

		if (
			typed.type === "message_update" &&
			typed.assistantMessageEvent?.type === "text_delta"
		) {
			this.appendAssistantDelta(
				agentId,
				String(typed.assistantMessageEvent.delta ?? ""),
			);
		}

		if (typed.type === "tool_execution_start") {
			this.addMessage(agentId, "tool", `▶ ${typed.toolName || "tool"}`, {
				status: "running",
				toolName: typed.toolName,
				args: typed.args,
			});
		}

		if (typed.type === "tool_execution_end") {
			const detailText = this.formatToolDetail(
				typed.toolName,
				typed.args,
				typed.result,
				typed.isError,
			);
			this.addMessage(
				agentId,
				"tool",
				`✓ ${typed.toolName || "tool"}${typed.isError ? " failed" : " done"}`,
				{
					status: typed.isError ? "error" : "done",
					toolName: typed.toolName,
					args: typed.args,
					result: typed.result,
					isError: typed.isError,
					detailText,
				},
			);
		}

		if (typed.type === "extension_error") {
			this.addMessage(
				agentId,
				"error",
				String(typed.error ?? "Extension error"),
			);
		}
	}

	private appendAssistantDelta(agentId: string, delta: string) {
		const list = this.messages.get(agentId) ?? [];
		const last = list[list.length - 1];

		if (last?.role === "assistant") {
			last.text += delta;
		} else {
			list.push({
				id: randomUUID(),
				agentId,
				role: "assistant",
				text: delta,
				timestamp: Date.now(),
			});
		}

		this.messages.set(agentId, list);
		this.emit(ipcChannels.agentsMessage, { agentId, messages: list });
	}

	private addMessage(
		agentId: string,
		role: ChatMessage["role"],
		text: string,
		meta?: Record<string, unknown>,
	) {
		const list = this.messages.get(agentId) ?? [];
		list.push({
			id: randomUUID(),
			agentId,
			role,
			text,
			timestamp: Date.now(),
			meta,
		});
		this.messages.set(agentId, list);
		this.emit(ipcChannels.agentsMessage, { agentId, messages: list });
	}

	private convertAgentMessages(
		agentId: string,
		rawMessages: unknown[],
	): ChatMessage[] {
		return rawMessages
			.flatMap<ChatMessage>((message, index) => {
				if (!message || typeof message !== "object") return [];
				const typed = message as any;
				if (typed.role === "user")
					return [
						{
							id: `${agentId}-history-${index}`,
							agentId,
							role: "user" as const,
							text: this.extractText(typed.content),
							timestamp: typed.timestamp ?? Date.now(),
						},
					];
				if (typed.role === "assistant")
					return [
						{
							id: `${agentId}-history-${index}`,
							agentId,
							role: "assistant" as const,
							text: this.extractText(typed.content),
							timestamp: typed.timestamp ?? Date.now(),
						},
					];
				if (typed.role === "toolResult")
					return [
						{
							id: `${agentId}-history-${index}`,
							agentId,
							role: "tool" as const,
							text: `${typed.toolName ?? "tool"} result`,
							timestamp: typed.timestamp ?? Date.now(),
						},
					];
				return [];
			})
			.filter((message: ChatMessage) => message.text.trim());
	}

	private formatToolDetail(
		toolName: string,
		args: unknown,
		result: unknown,
		isError: boolean,
	) {
		const sections = [
			`工具：${toolName ?? "tool"}`,
			`状态：${isError ? "失败" : "完成"}`,
			args ? `参数：\n${this.safeJson(args)}` : "",
			result
				? `结果：\n${this.extractToolResultText(result) || this.safeJson(result)}`
				: "",
		].filter(Boolean);
		return sections.join("\n\n");
	}

	private extractToolResultText(result: unknown) {
		if (!result || typeof result !== "object") return "";
		const content = (result as any).content;
		if (!Array.isArray(content)) return "";
		return content
			.map((item) => (typeof item?.text === "string" ? item.text : ""))
			.filter(Boolean)
			.join("\n");
	}

	private safeJson(value: unknown) {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	private extractText(content: unknown): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content))
			return content
				.map((item) => {
					if (typeof item === "string") return item;
					if (item && typeof item === "object")
						return String((item as any).text ?? (item as any).thinking ?? "");
					return "";
				})
				.filter(Boolean)
				.join("\n");
		return "";
	}

	private requireRuntime(agentId: string) {
		const runtime = this.agents.get(agentId);
		if (!runtime) throw new Error(`Agent not found: ${agentId}`);
		return runtime;
	}

	private emitState() {
		this.emit(ipcChannels.agentsState, this.list());
	}

	private emit(channel: string, payload: unknown) {
		const window = this.getWindow();
		if (!window || window.isDestroyed()) return;
		window.webContents.send(channel, payload);
	}
}

type AgentRuntime = {
	tab: AgentTab;
	process: PiProcess;
};
