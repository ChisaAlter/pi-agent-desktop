import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { displayStateOf, useHerdrStore } from "../../stores/herdr-store";
import { useToastStore } from "../../stores/toast-store";

/**
 * HerdrPaneTerminal — 实时终端视图（pane），视觉以原型为准
 * （docs/prototypes/herdr-desktop-ui-prototype.html #paneView）：
 *
 *   - 面包屑 = session / workspace / tab / pane.name（选中 agent 的层级路径）
 *   - 白卡片圆角 + 暗色终端 #101722 + 右侧 250px 身份面板
 *   - blocked 横幅只在选中 agent 显示态为 blocked 时出现；主按钮「进入终端并
 *     批准」是进入真实 pane 处理的入口（store.openPaneForBlocked 在 mock 里
 *     模拟生命周期上报 — 审批必须在真实终端窗格内完成，GUI 内不伪造批准）
 *   - 终端逐行渲染 terminalLog；prompt 行绿色 #65d6a6 / 命令行蓝色 #7cb8ff /
 *     警告行琥珀 #ffcc76；新日志到达自动滚动到底部
 *   - 聚焦/调整尺寸/发送按键/读取历史输出 → toast（操作落在真实 Herdr 接口，
 *     GUI 内不模拟效果；读取历史明确与 live 终端分离）
 *   - 非 mock 或未选中 agent → herdr.pane.empty 空态
 */

type WaitOption = "waitIdle" | "waitBlocked" | "waitNone";

const WAIT_OPTIONS: WaitOption[] = ["waitIdle", "waitBlocked", "waitNone"];

/**
 * 逐行配色 — 与原型 .terminal 的 span 语义逐行对齐（视觉唯一权威）：
 *   - 整行绿:  ✓ 已在终端窗格中批准 / ❯ 通过 agent.prompt 注入指令
 *   - 整行蓝:  Herdr 集成已连接… / ● 正在运行…
 *   - 整行琥珀: ◆ 正在等待审批…
 *   - 仅符号绿: ❯ pi --session… / ● 正在读取… / ● 拟执行命令…
 *   - 其余: 默认 #e2eaf5
 * Phase 3 真实传输接入时由 transport 提供渲染映射（此处 mock 语义保持原型一致）。
 */
type LineStyle = { whole?: "green" | "blue" | "amber"; marker?: "green" };

function lineStyleOf(line: string): LineStyle {
    if (line.startsWith("Herdr 集成已连接") || line.startsWith("● 正在运行")) return { whole: "blue" };
    if (line.startsWith("◆")) return { whole: "amber" };
    if (line.startsWith("✓ 已在终端窗格中批准") || line.startsWith("❯ 通过 agent.prompt")) return { whole: "green" };
    if (line.startsWith("❯") || line.startsWith("●")) return { marker: "green" };
    return {};
}

function Line({ line }: { line: string }): React.JSX.Element {
    const style = lineStyleOf(line);
    if (style.whole === "green") return <span className="text-[#65d6a6]">{line}</span>;
    if (style.whole === "blue") return <span className="text-[#7cb8ff]">{line}</span>;
    if (style.whole === "amber") return <span className="text-[#ffcc76]">{line}</span>;
    if (style.marker === "green" && line.length > 0) {
        return (
            <>
                <span className="text-[#65d6a6]">{line[0]}</span>
                <span>{line.slice(1)}</span>
            </>
        );
    }
    return <span>{line}</span>;
}

export function HerdrPaneTerminal({ hideIdentity = false }: { hideIdentity?: boolean }): React.JSX.Element {
    const { t } = useI18n();
    const mock = useHerdrStore((s) => s.mock);
    const selectedAgent = useHerdrStore((s) => s.selectedAgent);
    const agents = useHerdrStore((s) => s.agents);
    const tree = useHerdrStore((s) => s.tree);
    const server = useHerdrStore((s) => s.server);
    const terminalLog = useHerdrStore((s) => s.terminalLog);
    const historyOutput = useHerdrStore((s) => s.historyOutput);
    const attached = useHerdrStore((s) => s.attached);
    const stateSeq = useHerdrStore((s) => s.stateSeq);
    const attach = useHerdrStore((s) => s.attach);
    const prompt = useHerdrStore((s) => s.prompt);
    const openPaneForBlocked = useHerdrStore((s) => s.openPaneForBlocked);
    const markSeen = useHerdrStore((s) => s.markSeen);
    const readRecentOutput = useHerdrStore((s) => s.readRecentOutput);
    const sendKeys = useHerdrStore((s) => s.sendKeys);
    const addToast = useToastStore((s) => s.addToast);

    const [promptText, setPromptText] = useState(useHerdrStore.getState().promptDraft);
    const [waitOption, setWaitOption] = useState<WaitOption>("waitIdle");
    const terminalRef = useRef<HTMLDivElement>(null);

    const agent = selectedAgent ? (agents.find((a) => a.name === selectedAgent) ?? null) : null;
    const displayState = agent ? displayStateOf(agent, server) : null;

    // 新日志到达时自动滚动到底部（实时终端行为）
    useEffect(() => {
        const el = terminalRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [terminalLog.length, historyOutput]);

    if (!agent) {
        return (
            <div
                data-testid="herdr-pane-view"
                className="grid min-h-[320px] place-items-center rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-6 py-10 text-center text-[13px] text-[var(--mm-text-tertiary)]"
            >
                {t("herdr.pane.empty")}
            </div>
        );
    }

    const blocked = displayState === "blocked";

    const handleAttach = (): void => {
        if (!mock) {
            addToast({ message: t("herdr.toast.liveUnavailable"), tone: "info" });
            return;
        }
        const next = !attached;
        attach();
        addToast({ message: t(next ? "herdr.toast.attached" : "herdr.toast.detached"), tone: next ? "success" : "info" });
    };

    const handleResolveBlock = (): void => {
        openPaneForBlocked();
        addToast({
            message: t(mock ? "herdr.toast.resolveBlock" : "herdr.toast.openRealPane"),
            tone: "success",
        });
    };

    const handleSendPrompt = (): void => {
        prompt(promptText, waitOption);
        addToast({ message: t("herdr.toast.promptSent"), tone: "info" });
    };

    const handleFocus = (): void => {
        markSeen(agent.name);
        addToast({ message: t("herdr.toast.focusSent"), tone: "info" });
    };

    const handleSendKeys = (): void => {
        if (mock) {
            addToast({ message: t("herdr.toast.keysSent"), tone: "info" });
            return;
        }
        void sendKeys(agent.name, ["enter"]).then((ok) => {
            addToast({
                message: t(ok ? "herdr.toast.keysSent" : "herdr.toast.keysFailed"),
                tone: ok ? "info" : "error",
            });
        });
    };

    const handleReadHistory = (): void => {
        if (!mock) {
            void readRecentOutput(agent.name);
        }
        addToast({ message: t("herdr.toast.recentOutput"), tone: "info" });
    };

    const infoRows: Array<{ label: string; value: string; testId?: string; strong?: boolean }> = [
        { label: t("herdr.pane.agent"), value: `${agent.displayName} · ${agent.kind}`, strong: true },
        { label: t("herdr.pane.paneTerminal"), value: `${agent.pane} / ${agent.terminalId ?? `term-${agent.name}`}` },
        { label: t("herdr.pane.authoritySource"), value: agent.authority },
        { label: t("herdr.pane.stateSeq"), value: String(stateSeq), testId: "state-seq" },
        { label: t("herdr.pane.nativeSession"), value: agent.session },
        { label: t("herdr.pane.worktree"), value: agent.worktree },
        { label: t("herdr.pane.transport"), value: t(mock ? "herdr.pane.transportLive" : "herdr.pane.transportHistory") },
    ];

    return (
        <div
            data-testid="herdr-pane-view"
            className={`overflow-hidden border bg-[var(--mm-bg-panel)] ${
                hideIdentity
                    ? "rounded border-[#344156]"
                    : "rounded-[12px] border-[var(--mm-border)] shadow-[0_12px_35px_rgba(26,39,66,0.08)]"
            }`}
        >
            {/* 工具栏：面包屑 + 连接状态 + 远端操作（原型描边按钮形态） */}
            <div className={`flex min-h-[45px] items-center gap-2 border-b px-3 py-2 ${hideIdentity ? "border-[#344156]" : "border-[var(--mm-border)]"}`}>
                <span
                    data-testid="pane-crumb"
                    className="mr-auto min-w-0 truncate text-[13px] font-semibold text-[var(--mm-text-primary)]"
                >
                    {tree.session} / {agent.workspace} / {agent.tab} / {agent.name}
                </span>
                <span
                    data-testid="attach-pill"
                    data-attached={attached}
                    className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${
                        attached ? "bg-[#e5f5ed] text-[#14734f]" : "bg-[#fff0d9] text-[#96600f]"
                    }`}
                >
                    {attached ? t("herdr.pane.attached") : t("herdr.pane.detached")}
                </span>
                <button
                    type="button"
                    onClick={handleAttach}
                    className="shrink-0 rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-[7px] text-[12px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {attached ? t("herdr.pane.attach") : t("herdr.pane.reattach")}
                </button>
                <button
                    type="button"
                    onClick={handleFocus}
                    className="shrink-0 rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-[7px] text-[12px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("herdr.pane.focus")}
                </button>
                <button
                    type="button"
                    onClick={() => addToast({ message: t(mock ? "herdr.toast.resizeSent" : "herdr.toast.liveUnavailable"), tone: "info" })}
                    className="shrink-0 rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-[7px] text-[12px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("herdr.pane.resize")}
                </button>
                <button
                    type="button"
                    onClick={handleSendKeys}
                    className="shrink-0 rounded-lg border border-[#dfe4eb] bg-white px-2.5 py-[7px] text-[12px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                >
                    {t("herdr.pane.sendKeys")}
                </button>
            </div>

            {/* blocked 横幅 — 独立一行（原型 .block-banner 全边框） */}
            {blocked ? (
                <div
                    data-testid="block-banner"
                    className="flex min-h-[48px] items-center gap-2.5 border border-[#f2c8cc] bg-[#fff0f1] px-3 py-[11px] text-[#922b36]"
                >
                    <b className="shrink-0 text-[13px]">{t("herdr.pane.blockedTitle")}</b>
                    <span className="min-w-0 flex-1 text-xs">{t("herdr.pane.blockedDesc")}</span>
                    <button
                        type="button"
                        data-testid="resolve-block"
                        onClick={handleResolveBlock}
                        className="shrink-0 rounded bg-[#2563eb] px-3 py-[7px] text-[12px] font-medium text-white transition-colors hover:bg-[#174fc6]"
                    >
                        {t("herdr.pane.resolveBlock")}
                    </button>
                </div>
            ) : null}

            {/* 暗色终端 + 右侧 250px 身份面板（terminal 布局隐藏面板，终端全宽） */}
            <div className={`grid ${hideIdentity ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_250px]"}`}>
                <div
                    ref={terminalRef}
                    data-testid="pane-terminal"
                    className={`overflow-y-auto bg-[#101722] p-[18px] leading-[1.7] text-[#e2eaf5] [font-family:"Cascadia_Code",Consolas,monospace] ${
                        hideIdentity ? "min-h-[calc(100vh-330px)] text-[13px]" : "max-h-[520px] min-h-[450px] text-[12px]"
                    }`}
                >
                    {mock ? terminalLog.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap">
                            <Line line={line} />
                        </div>
                    )) : (
                        <>
                            <div className="whitespace-pre-wrap text-[#ffcc76]">{t("herdr.pane.historyOnly")}</div>
                            {(historyOutput ?? t("herdr.pane.noHistory")).split("\n").map((line, i) => (
                                <div key={i} className="whitespace-pre-wrap">
                                    <Line line={line} />
                                </div>
                            ))}
                        </>
                    )}
                </div>
                {!hideIdentity ? (
                    <aside data-testid="pane-info" className="border-l border-[var(--mm-border)] bg-[#fafbfd] p-3">
                        <div className="mb-2.5 text-[13px] font-bold text-[var(--mm-text-primary)]">
                            {t("herdr.pane.identity")}
                        </div>
                    {infoRows.map((row) => (
                        <div key={row.label} className="my-[9px]">
                            <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-[var(--mm-text-tertiary)]">
                                {row.label}
                            </label>
                            <span
                                data-testid={row.testId}
                                className={`block break-words text-xs ${
                                    row.strong
                                        ? "font-semibold text-[var(--mm-text-primary)]"
                                        : "text-[var(--mm-text-secondary)]"
                                }`}
                            >
                                {row.value}
                            </span>
                        </div>
                    ))}
                    </aside>
                ) : null}
            </div>

            {/* 底部 prompt 输入行（terminal 布局切暗色表面，原型 .prompt-box 语义） */}
            <div
                className={`flex gap-[7px] border-t p-[10px] ${
                    hideIdentity ? "border-[#344156] bg-[#151e2d]" : "border-[var(--mm-border)] bg-[#fafbfd]"
                }`}
            >
                <textarea
                    data-testid="prompt-input"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder={t("herdr.pane.promptPlaceholder")}
                    rows={3}
                    className={`min-h-[58px] flex-1 resize-none rounded-lg border px-2.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563eb] ${
                        hideIdentity
                            ? "border-[#344156] bg-[#101722] text-[#d5dfed] placeholder:text-[#8a96a8]"
                            : "border-[var(--mm-border)] bg-white text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)]"
                    }`}
                />
                <div className="flex shrink-0 flex-col gap-[5px]">
                    <select
                        data-testid="wait-select"
                        value={waitOption}
                        onChange={(e) => setWaitOption(e.target.value as WaitOption)}
                        className={`rounded-[7px] border px-2 py-[5px] text-xs focus:outline-none ${
                            hideIdentity
                                ? "border-[#344156] bg-[#101722] text-[#d5dfed]"
                                : "border-[var(--mm-border)] bg-white text-[var(--mm-text-secondary)]"
                        }`}
                    >
                        {WAIT_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                                {t(`herdr.pane.${option}`)}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        data-testid="send-prompt"
                        onClick={handleSendPrompt}
                        className="rounded-lg bg-[#2563eb] px-3 py-[7px] text-[12px] font-medium text-white transition-colors hover:bg-[#174fc6]"
                    >
                        {t("herdr.pane.sendAndWait")}
                    </button>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            data-testid="read-history"
                            title={t("herdr.pane.readHistoryHint")}
                            onClick={handleReadHistory}
                            className={`shrink-0 rounded border px-2.5 py-[5px] text-xs transition-colors ${
                                hideIdentity
                                    ? "border-[#344156] bg-transparent text-[#c7d2e2] hover:bg-[#243147]"
                                    : "border-[var(--mm-border)] bg-white text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                            }`}
                        >
                            {t("herdr.pane.readHistory")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
