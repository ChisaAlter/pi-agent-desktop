// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn((element: HTMLElement | null) => {
    if (!element) throw new Error("terminal container missing");
});
const disposeMock = vi.fn();
const writeMock = vi.fn();
const loadAddonMock = vi.fn();
const onDataMock = vi.fn();
const fitMock = vi.fn();
let lastTerminalOptions: { theme?: { background?: string; foreground?: string } } | null = null;

vi.mock("@xterm/xterm", () => ({
    Terminal: vi.fn(function TerminalMock(options: { theme?: { background?: string; foreground?: string } }) {
        lastTerminalOptions = options ?? null;
        return {
        cols: 80,
        rows: 24,
        open: openMock,
        dispose: disposeMock,
        write: writeMock,
        loadAddon: loadAddonMock,
        onData: onDataMock,
        };
    }),
}));

vi.mock("@xterm/addon-fit", () => ({
    FitAddon: vi.fn(function FitAddonMock() {
        return { fit: fitMock };
    }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalPanel } from "./TerminalPanel";

const unsubOut = vi.fn();
const unsubExit = vi.fn();
let outputListener: ((data: string) => void) | null = null;

describe("TerminalPanel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        outputListener = null;
        lastTerminalOptions = null;
        document.documentElement.removeAttribute("data-theme");
        class ResizeObserverStub {
            observe = vi.fn();
            disconnect = vi.fn();
        }
        Object.defineProperty(window, "ResizeObserver", {
            value: ResizeObserverStub,
            configurable: true,
        });
        Object.defineProperty(window, "piAPI", {
            value: {
                createTerminal: vi.fn(async ({ id }: { id: string }) => ({ id, cwd: "C:/demo", cols: 80, rows: 24 })),
                terminalInput: vi.fn(async () => undefined),
                terminalResize: vi.fn(async () => undefined),
                closeTerminal: vi.fn(async () => undefined),
                onTerminalOutput: vi.fn((_id: string, listener: (data: string) => void) => {
                    outputListener = listener;
                    return unsubOut;
                }),
                onTerminalExit: vi.fn(() => unsubExit),
            },
            configurable: true,
        });
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: vi.fn(async () => undefined) },
            configurable: true,
        });
    });

    it("opens the xterm after the container is mounted and cleans subscriptions on close", async () => {
        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole("button", { name: "新建终端" }));

        await waitFor(() => {
            expect(openMock).toHaveBeenCalledWith(expect.any(HTMLElement));
        });
        await waitFor(() => {
            expect(window.piAPI.createTerminal).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByRole("button", { name: "关闭终端 Terminal 1" }));

        expect(unsubOut).toHaveBeenCalledTimes(1);
        expect(unsubExit).toHaveBeenCalledTimes(1);
        expect(disposeMock).toHaveBeenCalledTimes(1);
        expect(window.piAPI.closeTerminal).toHaveBeenCalledTimes(1);
    });

    it("fills the workbench surface and hides the overlay close control when embedded", () => {
        render(
            <TerminalPanel
                isOpen
                workspacePath="C:/demo"
                onClose={vi.fn()}
                displayMode="embedded"
            />,
        );

        const panel = screen.getByTestId("terminal-panel");
        expect(panel.className).toContain("h-full");
        expect(panel.className).not.toContain("h-64");
        expect(screen.queryByTitle("收起终端")).toBeNull();
    });

    it("states that the user-controlled terminal keeps full local access", () => {
        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);

        expect(screen.getByRole("note").textContent).toContain("终端由你直接控制，拥有本机完整权限；Agent 工具权限不会限制此终端");
        expect(screen.getByRole("note").className).not.toContain("hidden");
    });

    it("does not create a terminal for a command while the panel is hidden", async () => {
        render(
            <TerminalPanel
                isOpen={false}
                workspacePath="C:/demo"
                onClose={vi.fn()}
                initialCommand={{ command: "pnpm test", nonce: 1 }}
            />,
        );

        await Promise.resolve();
        expect(window.piAPI.createTerminal).not.toHaveBeenCalled();
        expect(window.piAPI.terminalInput).not.toHaveBeenCalled();
    });

    it("commits terminal output bursts to React state once per animation frame", async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });

        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "新建终端" }));
        await waitFor(() => expect(outputListener).toBeTruthy());

        act(() => {
            outputListener?.("first");
            outputListener?.("second");
        });

        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(screen.getByTitle("当前终端暂无输出").hasAttribute("disabled")).toBe(true);

        act(() => frames[0]?.(16));

        const copyButton = screen.getByTitle("复制当前终端最近输出");
        expect(copyButton.hasAttribute("disabled")).toBe(false);
        fireEvent.click(copyButton);
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith("firstsecond");
        });
    });

    it("isolates multi-tab output and keeps the remaining tab after closing one", async () => {
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });

        const outputById = new Map<string, (data: string) => void>();
        let termSeq = 0;
        Object.defineProperty(window, "piAPI", {
            value: {
                createTerminal: vi.fn(async () => {
                    termSeq += 1;
                    return { id: `term-${termSeq}`, cwd: "C:/demo", cols: 80, rows: 24 };
                }),
                terminalInput: vi.fn(async () => undefined),
                terminalResize: vi.fn(async () => undefined),
                closeTerminal: vi.fn(async () => undefined),
                onTerminalOutput: vi.fn((id: string, listener: (data: string) => void) => {
                    outputById.set(id, listener);
                    return unsubOut;
                }),
                onTerminalExit: vi.fn(() => unsubExit),
            },
            configurable: true,
        });

        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);
        fireEvent.click(screen.getByTitle("新建终端"));
        await waitFor(() => expect(window.piAPI.createTerminal).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTitle("新建终端"));
        await waitFor(() => expect(window.piAPI.createTerminal).toHaveBeenCalledTimes(2));

        expect(screen.getByText("Terminal 1")).toBeTruthy();
        expect(screen.getByText("Terminal 2")).toBeTruthy();

        act(() => {
            outputById.get("term-1")?.("from-tab-1");
            outputById.get("term-2")?.("from-tab-2");
        });
        act(() => {
            for (const frame of frames.splice(0)) frame(16);
        });

        // Active tab is the last created (Terminal 2)
        fireEvent.click(screen.getByTitle("复制当前终端最近输出"));
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith("from-tab-2");
        });

        fireEvent.click(screen.getByTitle("Terminal 1 - C:/demo"));
        fireEvent.click(screen.getByTitle("复制当前终端最近输出"));
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("from-tab-1");
        });

        fireEvent.click(screen.getByRole("button", { name: "关闭终端 Terminal 2" }));
        expect(window.piAPI.closeTerminal).toHaveBeenCalledWith("term-2");
        expect(screen.queryByText("Terminal 2")).toBeNull();
        expect(screen.getByText("Terminal 1")).toBeTruthy();

        fireEvent.click(screen.getByTitle("复制当前终端最近输出"));
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("from-tab-1");
        });
        expect(window.piAPI.closeTerminal).not.toHaveBeenCalledWith("term-1");
    });

    it("uses dark xterm colors when data-theme is dark", async () => {
        document.documentElement.setAttribute("data-theme", "dark");
        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "新建终端" }));
        await waitFor(() => expect(window.piAPI.createTerminal).toHaveBeenCalledTimes(1));
        expect(lastTerminalOptions?.theme?.background).toBe("#1a1a1a");
        expect(lastTerminalOptions?.theme?.foreground).toBe("#e5e5e5");
    });

    it("exposes accessible labels on tab-bar new and collapse controls", () => {
        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);
        expect(screen.getByRole("button", { name: "新建终端" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "收起终端" })).toBeTruthy();
    });

    it("exposes focus-visible rings on tab-bar toolbar controls", async () => {
        render(<TerminalPanel isOpen workspacePath="C:/demo" onClose={vi.fn()} />);
        const createBtn = screen.getByRole("button", { name: "新建终端" });
        expect(createBtn.className).toContain("focus-visible:ring-2");
        expect(screen.getByRole("button", { name: "收起终端" }).className).toContain("focus-visible:ring-2");
        expect(screen.getByTitle("当前终端暂无输出").className).toContain("focus-visible:ring-2");
        expect(screen.getByTitle("清空当前终端屏幕和输出缓存").className).toContain("focus-visible:ring-2");

        fireEvent.click(createBtn);
        await waitFor(() => expect(window.piAPI.createTerminal).toHaveBeenCalledTimes(1));
        expect(screen.getByRole("button", { name: "关闭终端 Terminal 1" }).className).toContain(
            "focus-visible:ring-2",
        );
        expect(screen.getByTitle("Terminal 1 - C:/demo").className).toContain("focus-visible:ring-2");
    });
});
