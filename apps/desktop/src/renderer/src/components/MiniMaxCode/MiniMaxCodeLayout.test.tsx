// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { TopTabBar } from "../TopTabBar/TopTabBar";
import { MINIMAX_CHROME_ICON_BUTTON_CLASSNAME } from "./chromeButton";
import { MiniMaxCodeLayout } from "./MiniMaxCodeLayout";
import { MiniMaxCodeTitleBar } from "./MiniMaxCodeTitleBar";

describe("MiniMaxCode window chrome interactivity", () => {
    it("keeps the restored main window flush while using a contained frame shadow", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div />}
                centerSlot={<div />}
                rightSlot={null}
            />,
        );

        const root = document.querySelector('[data-mmcode-layout="root"]');
        const frame = document.querySelector('[data-mmcode-layout="window-frame"]');

        expect(root?.className ?? "").toContain("p-0");
        expect(root?.className ?? "").not.toContain("p-[6px]");
        expect(frame?.className ?? "").toContain("shadow-[var(--mm-main-window-shadow)]");
    });

    it("keeps titlebar controls non-native while the shared titlebar owns drag handling", () => {
        render(
            <I18nProvider>
                <MiniMaxCodeTitleBar
                    title="Pi Agent"
                    navigationSlot={<TopTabBar activeTab="chat" onTabChange={() => undefined} />}
                />
            </I18nProvider>,
        );

        const chatTab = screen.getByRole("tab", { name: "对话" });
        const tablist = screen.getByRole("tablist", { name: "顶部标签栏" });
        const titlebar = screen.getByRole("banner", { name: "window title bar" });
        const titlebarCenter = chatTab.closest('[data-mmcode-region="titlebar-center"]');
        const dragSurface = document.querySelector('[data-mmcode-region="titlebar-drag-surface"]');
        const closeButton = screen.getByRole("button", { name: "关闭窗口" });
        const titlebarRight = closeButton.closest('[data-mmcode-region="titlebar-right"]');

        expect(titlebarCenter?.className ?? "").not.toContain("app-region-no-drag");
        expect(titlebar.className).not.toContain("app-region-no-drag");
        expect(tablist.className).not.toContain("app-region-no-drag");
        expect(chatTab.className).toContain("app-region-no-drag");
        expect(dragSurface?.className ?? "").toContain("flex-1");
        expect(dragSurface?.className ?? "").toContain("app-region-drag");
        expect(dragSurface?.className ?? "").not.toContain("app-region-no-drag");
        expect(dragSurface?.className ?? "").toContain("touch-none");
        expect(titlebarRight?.className ?? "").toContain("pr-[5px]");
    });

    it("keeps the global composer root in the center workspace layout flow", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div />}
                centerSlot={<div />}
                rightSlot={null}
            />,
        );

        expect(document.getElementById("pi-global-composer-root")?.className ?? "").toContain("pointer-events-auto");
        expect(document.getElementById("pi-global-composer-root")?.className ?? "").toContain("shrink-0");
        expect(document.getElementById("pi-global-composer-root")?.className ?? "").not.toContain("absolute");
        expect(document.getElementById("pi-global-composer-root")?.className ?? "").toContain("bg-[var(--mm-bg-input)]");
        expect(document.querySelector('[data-mmcode-region="center"]')?.querySelector("#pi-global-composer-root")).toBeTruthy();
    });

    it("keeps only the right collapse control floating and stops reserving a fake left gutter when the sidebar is expanded", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div />}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen
                onCollapseLeft={() => undefined}
                onCollapseRight={() => undefined}
            />,
        );

        const rightToggleClassName = screen.getByRole("button", { name: "折叠右侧栏" }).className;

        expect(rightToggleClassName).toContain("top-[calc((42px-1.75rem)/2)]");
        expect(rightToggleClassName).not.toContain("top-4");
        expect(rightToggleClassName).toContain("h-7");
        expect(rightToggleClassName).toContain("w-7");
        expect(rightToggleClassName).not.toContain("h-8");
        expect(rightToggleClassName).toContain("right-3");
        expect(rightToggleClassName).toContain("z-[80]");
        expect(rightToggleClassName).not.toContain("top-1/2");
        expect(rightToggleClassName).not.toContain("-translate-y-1/2");
        for (const className of MINIMAX_CHROME_ICON_BUTTON_CLASSNAME.split(" ")) {
            expect(rightToggleClassName).toContain(className);
        }
        expect(rightToggleClassName).toContain("focus-visible:ring-2");
        expect(rightToggleClassName).toContain("focus-visible:ring-[#2563eb]");
        expect(rightToggleClassName).not.toContain("rounded-md");
        expect(rightToggleClassName).not.toContain("bg-[var(--mm-bg-main)]");
        expect(screen.queryByRole("button", { name: "折叠左侧栏" })).toBeNull();
        expect(document.querySelector('[data-mmcode-region="left"]')?.firstElementChild?.className ?? "").not.toContain("pl-10");
        expect(document.querySelector('[data-mmcode-region="right-floating"]')?.className ?? "").toContain("absolute");
    });

    it("reserves center gutters when a sidebar is collapsed and omits unavailable right toggle", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={null}
                leftCollapsed
                rightCollapsed
                onCollapseLeft={() => undefined}
            />,
        );

        const leftToggleClassName = screen.getByRole("button", { name: "展开左侧栏" }).className;
        expect(leftToggleClassName).toContain("left-3");
        expect(leftToggleClassName).toContain("focus-visible:ring-2");
        expect(leftToggleClassName).toContain("focus-visible:ring-[#2563eb]");
        expect(screen.queryByRole("button", { name: "展开右侧栏" })).toBeNull();
        expect(document.querySelector('[data-mmcode-region="left"]')?.className ?? "").toContain("pi-motion-rail");
        expect(document.querySelector('[data-mmcode-region="left"]')?.getAttribute("data-collapsed")).toBe("true");
        expect(document.querySelector('[data-mmcode-region="left"]')?.firstElementChild?.className ?? "").toContain("pi-motion-rail-content");
        expect(document.querySelector('[data-mmcode-region="center"]')?.className ?? "").toContain("pl-10");
    });

    it("uses the provided sidebar width for both body and titlebar", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={null}
                leftWidth={260}
            />,
        );

        expect((document.querySelector('[data-mmcode-region="left"]') as HTMLElement).style.width).toBe("260px");
        expect((document.querySelector('[data-mmcode-region="titlebar-left"]') as HTMLElement).style.width).toBe("260px");
    });

    it("clamps drag resizing to the supported left sidebar width range", () => {
        const onLeftWidthChange = vi.fn();
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={null}
                leftWidth={190}
                onLeftWidthChange={onLeftWidthChange}
            />,
        );

        const handle = screen.getByRole("separator", { name: "调整左侧栏宽度" });
        fireEvent.pointerDown(handle, { clientX: 190, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 420, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });

        expect(onLeftWidthChange).toHaveBeenCalledWith(320);
        expect(onLeftWidthChange).toHaveBeenCalledTimes(1);
    });

    it("supports precise keyboard resizing for the left sidebar", () => {
        const onLeftWidthChange = vi.fn();
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={null}
                leftWidth={190}
                onLeftWidthChange={onLeftWidthChange}
            />,
        );

        const handle = screen.getByRole("separator", { name: "调整左侧栏宽度" });
        expect(handle.getAttribute("aria-valuenow")).toBe("190");
        fireEvent.keyDown(handle, { key: "ArrowRight" });
        fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
        fireEvent.keyDown(handle, { key: "Home" });
        fireEvent.keyDown(handle, { key: "End" });

        expect(onLeftWidthChange.mock.calls.map(([width]) => width)).toEqual([200, 166, 160, 320]);
    });

    it("disables rail interpolation while resizing", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={null}
                leftWidth={190}
                onLeftWidthChange={vi.fn()}
            />,
        );

        const rail = screen.getByLabelText("primary navigation");
        const handle = screen.getByRole("separator", { name: "调整左侧栏宽度" });
        fireEvent.pointerDown(handle, { clientX: 190, pointerId: 1 });
        expect(rail.getAttribute("data-resizing")).toBe("true");

        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(rail.getAttribute("data-resizing")).toBe("false");
    });

    it("renders the right rail as a floating workspace panel instead of a layout column", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen
                onCollapseRight={() => undefined}
            />,
        );

        expect(document.querySelector('[data-mmcode-region="right"]')).toBeNull();
        expect(document.querySelector('[data-mmcode-region="right-floating"]')?.textContent).toContain("环境信息");
        expect(document.querySelector('[data-mmcode-region="center"]')?.className ?? "").not.toContain("pr-10");
    });

    it("keeps the floating right rail above the global composer layer", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen
            />,
        );

        const composerClass = document.getElementById("pi-global-composer-root")?.className ?? "";
        const rightFloatingClass = document.querySelector('[data-mmcode-region="right-floating"]')?.className ?? "";

        expect(composerClass).toContain("z-30");
        expect(rightFloatingClass).toContain("z-[60]");
    });

    it("keeps the floating right rail mounted for exit motion when it closes", () => {
        const { rerender } = render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen
            />,
        );

        expect(document.querySelector('[data-mmcode-region="right-floating"]')?.className ?? "").toContain("pi-motion-floating-rail");

        rerender(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen={false}
            />,
        );

        const rightFloating = document.querySelector('[data-mmcode-region="right-floating"]');
        expect(rightFloating).toBeTruthy();
        expect(rightFloating?.getAttribute("data-motion-state")).toBe("exit");
        expect(rightFloating?.getAttribute("aria-hidden")).toBe("true");
    });

    it("can position a chrome-less right floating layer between the top strip and composer", () => {
        render(
            <MiniMaxCodeLayout
                leftSlot={<div>对话</div>}
                centerSlot={<div>主内容</div>}
                rightSlot={<div>环境信息</div>}
                rightFloatingOpen
                rightFloatingChrome={false}
                rightFloatingTopOffset="54px"
                rightFloatingBottomOffset="calc(var(--pi-global-composer-height,103px) + 12px)"
            />,
        );

        const rightFloating = document.querySelector('[data-mmcode-region="right-floating"]') as HTMLElement | null;

        expect(rightFloating).toBeTruthy();
        expect(rightFloating?.style.top).toBe("54px");
        expect(rightFloating?.style.bottom).toBe("calc(var(--pi-global-composer-height,103px) + 12px)");
        expect(rightFloating?.className ?? "").not.toContain("border");
        expect(rightFloating?.className ?? "").not.toContain("rounded");
        expect(rightFloating?.className ?? "").not.toContain("shadow");
        expect(rightFloating?.className ?? "").not.toContain("bg-[var(--mm-bg-main)]");
        expect(rightFloating?.className ?? "").toContain("w-[300px]");
    });
});
