# Pi Desktop Silky Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pi Desktop a coherent, interruptible motion system across controls, navigation, settings, overlays, rails, lists, and status feedback without regressing the sub-100ms interaction latency already achieved.

**Architecture:** Keep motion dependency-free. Shared CSS tokens and narrowly scoped classes define timing and easing; small React wrappers provide accessibility-safe panel layering and exit-aware presence where CSS alone cannot keep removed content alive. Business state changes remain synchronous, while only visual removal may wait for the bounded exit duration.

**Tech Stack:** Electron 41, React 19, TypeScript 5, Tailwind CSS 4, Vitest 4, Testing Library, Playwright Electron.

## Global Constraints

- Press/icon feedback uses `70-100ms`; panels/settings use `140-180ms`; larger overlays never exceed `220ms`.
- Click handlers, navigation, settings writes, permission decisions, save actions, and window closing execute immediately without waiting for animation completion.
- Repeated motion uses `transform` and `opacity`; layout interpolation is limited to existing rail/collapse flows.
- `transition: all`, universal animation selectors, animated filters, bounce, overshoot, and permanent `will-change` are prohibited.
- Main panels mount on first visit and remain mounted; inactive panels are non-interactive and accessibility-hidden.
- `prefers-reduced-motion: reduce` removes spatial transforms and reduces transition durations to `1ms`.
- Repeated top-level navigation and returning to Chat must remain below `100ms` in isolated real Electron runs.
- No new runtime dependency is added.

---

### Task 1: Shared Motion Tokens And Source Guardrails

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: existing `--transition-fast` and `--transition-normal` compatibility variables.
- Produces: `--motion-instant`, `--motion-fast`, `--motion-panel`, `--motion-overlay`, `--motion-emphasized`, `--motion-ease`, `--motion-ease-out`, `.pi-motion-control`, and reduced-motion overrides.

- [x] **Step 1: Write the failing source-contract test**

```ts
it("defines the shared motion vocabulary without broad transition or compositor hints", () => {
  const globalsCss = readFileSync(resolve(process.cwd(), "src/renderer/src/styles/globals.css"), "utf8");
  expect(globalsCss).toContain("--motion-instant: 70ms");
  expect(globalsCss).toContain("--motion-fast: 100ms");
  expect(globalsCss).toContain("--motion-panel: 160ms");
  expect(globalsCss).toContain("--motion-overlay: 180ms");
  expect(globalsCss).toContain("--motion-emphasized: 220ms");
  expect(globalsCss).toMatch(/\.pi-motion-control:active[\s\S]*scale\(0\.96\)/);
  expect(globalsCss).not.toContain("transition: all");
  expect(globalsCss).not.toContain("will-change:");
  expect(globalsCss).toMatch(/prefers-reduced-motion:[\s\S]*transition-duration:\s*1ms/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/App.test.tsx`

Expected: FAIL because the `--motion-*` tokens and `.pi-motion-control:active` rule do not exist.

- [x] **Step 3: Add the token vocabulary and scoped control feedback**

```css
:root {
  --motion-instant: 70ms;
  --motion-fast: 100ms;
  --motion-panel: 160ms;
  --motion-overlay: 180ms;
  --motion-emphasized: 220ms;
  --motion-ease: cubic-bezier(0.2, 0, 0, 1);
  --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast: var(--motion-fast);
  --transition-normal: var(--motion-panel);
}

.pi-motion-control,
.settings-pressable {
  transition-property: background-color, border-color, color, opacity, box-shadow, transform;
  transition-duration: var(--motion-fast);
  transition-timing-function: var(--motion-ease);
}

@media (hover: hover) and (pointer: fine) {
  .pi-motion-control:active:not(:disabled):not([aria-disabled="true"]),
  .settings-pressable:active:not(:disabled):not([aria-disabled="true"]) {
    transform: scale(0.96);
    transition-duration: var(--motion-instant);
  }
}
```

Apply the same scoped feedback to enabled pointer buttons, tabs, menu items, options, and switches while excluding inputs, textareas, selects, drag handles, disabled controls, and title-bar drag regions. Remove permanent `will-change` declarations and retain only exact transition properties.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/App.test.tsx`

Expected: PASS.

---

### Task 2: Layered Main Navigation Without Remounts

**Files:**
- Create: `apps/desktop/src/renderer/src/components/common/MotionPanelLayer.tsx`
- Create: `apps/desktop/src/renderer/src/components/common/MotionPanelLayer.test.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`

**Interfaces:**
- Consumes: `active: boolean`, `panelId: string`, `children: React.ReactNode`.
- Produces: `MotionPanelLayer({ active, panelId, children }): React.JSX.Element` with `data-main-panel`, `data-active`, `aria-hidden`, inert behavior, and stable absolute-layer geometry.

- [x] **Step 1: Write failing component and App behavior tests**

```tsx
it("makes inactive panel layers inert and accessibility-hidden", () => {
  render(<MotionPanelLayer active={false} panelId="run"><button>Action</button></MotionPanelLayer>);
  const layer = screen.getByTestId("motion-panel-run");
  expect(layer.getAttribute("data-active")).toBe("false");
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(layer.hasAttribute("inert")).toBe(true);
});

it("keeps visited main panels mounted while activating only the selected panel", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("tab", { name: "运行" }));
  fireEvent.click(screen.getByRole("tab", { name: "对话" }));
  expect(screen.getByTestId("motion-panel-run")).toBeTruthy();
  expect(screen.getByTestId("motion-panel-run").getAttribute("data-active")).toBe("false");
  expect(screen.getByTestId("motion-panel-chat").getAttribute("data-active")).toBe("true");
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/components/common/MotionPanelLayer.test.tsx src/renderer/src/App.test.tsx`

Expected: FAIL because `MotionPanelLayer` and visited-panel caching do not exist.

- [x] **Step 3: Implement the panel layer and visited set**

```tsx
export function MotionPanelLayer({ active, panelId, children }: MotionPanelLayerProps): React.JSX.Element {
  return (
    <section
      className="pi-motion-panel-layer"
      data-testid={`motion-panel-${panelId}`}
      data-main-panel={panelId}
      data-active={active ? "true" : "false"}
      aria-hidden={!active}
      inert={active ? undefined : true}
    >
      {children}
    </section>
  );
}
```

In `AppShell`, track a `Set` of visited canonical panel ids. Render a layer when it is active or visited. Keep `ChatView` mounted and pass `active={activePanel === "chat"}` so the global composer remains absent while Chat is inactive.

- [x] **Step 4: Add interruptible layer CSS**

```css
.pi-motion-panel-stack { position: relative; min-height: 0; flex: 1 1 0%; overflow: hidden; }
.pi-motion-panel-layer {
  position: absolute;
  inset: 0;
  display: flex;
  min-height: 0;
  flex-direction: column;
  opacity: 0;
  transform: translateY(-3px) scale(0.995);
  pointer-events: none;
  transition: opacity 100ms var(--motion-ease), transform var(--motion-panel) var(--motion-ease);
}
.pi-motion-panel-layer[data-active="true"] {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
```

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/components/common/MotionPanelLayer.test.tsx src/renderer/src/App.test.tsx src/renderer/src/components/ChatView/ChatView.test.tsx`

Expected: PASS, including the existing inactive-Chat composer assertion.

---

### Task 3: Settings Window And Category Transitions

**Files:**
- Modify: `apps/desktop/src/renderer/src/SettingsWindow.tsx`
- Modify: `apps/desktop/src/renderer/src/SettingsWindow.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/SettingsContent.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/SettingsContent.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`

**Interfaces:**
- Consumes: existing `SettingsTab` and `settings:select-tab` event.
- Produces: `data-settings-window-motion`, `data-settings-active-tab`, and a keyed `.settings-tab-panel-motion` wrapper.

- [x] **Step 1: Write failing settings motion tests**

```tsx
it("marks the independent settings frame for first-show motion", () => {
  render(<SettingsWindow />);
  expect(screen.getByTestId("settings-window-frame").className).toContain("settings-window-enter");
});

it("changes settings state immediately and remounts the motion wrapper with the selected tab", () => {
  render(<I18nProvider><SettingsContent /></I18nProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "模型" }));
  expect(screen.getByTestId("settings-active-panel").getAttribute("data-settings-active-tab")).toBe("model");
  expect(screen.getByRole("tab", { name: "模型" }).getAttribute("aria-selected")).toBe("true");
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/SettingsWindow.test.tsx src/renderer/src/components/Settings/SettingsContent.test.tsx`

Expected: FAIL because motion markers do not exist.

- [x] **Step 3: Add first-show and category motion**

Wrap the selected tab content with:

```tsx
<div
  key={activeTab}
  data-testid="settings-active-panel"
  data-settings-active-tab={activeTab}
  className="settings-tab-panel-motion min-h-full"
>
  {renderSettingsTab(activeTab)}
</div>
```

Add a `settings-window-enter` class to the independent frame. Keep `handleCloseWindow` unchanged: flush remains fire-and-forget and `windowClose()` is invoked in the same click turn.

- [x] **Step 4: Add 160-180ms CSS and reduced-motion parity**

```css
.settings-window-enter { animation: settings-window-in var(--motion-overlay) var(--motion-ease-out); }
.settings-tab-panel-motion { animation: settings-tab-in var(--motion-panel) var(--motion-ease); }
```

The keyframes use at most `translateY(6px)` and `scale(0.995)`. Reduced motion disables both transforms and uses `1ms` duration.

- [x] **Step 5: Run settings tests and verify GREEN**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/SettingsWindow.test.tsx src/renderer/src/components/Settings/SettingsContent.test.tsx`

Expected: PASS, including the immediate-close regression test.

---

### Task 4: Exit-Aware Popovers, Dialogs, Toasts, And Permission Prompts

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useMotionPresence.ts`
- Create: `apps/desktop/src/renderer/src/hooks/useMotionPresence.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/common/Popover.tsx`
- Modify: `apps/desktop/src/renderer/src/components/common/__tests__/Popover.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/tabs/ManagedModelsPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/tabs/ManagedModelsPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Toast/ToastContainer.tsx`
- Create: `apps/desktop/src/renderer/src/components/Toast/ToastContainer.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/PermissionRequestStack.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/PermissionRequestStack.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`

**Interfaces:**
- Produces: `useMotionPresence(open: boolean, exitMs: number): { rendered: boolean; state: "enter" | "exit" }`.
- Popover close callback changes logical state immediately; the portal remains rendered for `100ms` with `data-motion-state="exit"`.
- Dialog business callbacks and permission responses run before exit presentation begins.

- [x] **Step 1: Write failing presence tests**

```tsx
it("keeps content rendered only for the bounded exit interval", () => {
  vi.useFakeTimers();
  const { rerender } = render(<Probe open />);
  rerender(<Probe open={false} />);
  expect(screen.getByTestId("presence").getAttribute("data-state")).toBe("exit");
  act(() => vi.advanceTimersByTime(100));
  expect(screen.queryByTestId("presence")).toBeNull();
});

it("executes a popover menu action before visual removal", () => {
  vi.useFakeTimers();
  const action = vi.fn();
  render(
    <Popover trigger={<button type="button">Open</button>}>
      {(close) => (
        <button type="button" role="menuitem" onClick={() => { action(); close(); }}>
          Run action
        </button>
      )}
    </Popover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(screen.getByRole("menuitem"));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByRole("menu").getAttribute("data-motion-state")).toBe("exit");
});
```

Add three explicit tests: click model deletion and assert `configDeleteManagedModel` is called before timers advance; click Toast retry and assert `retryAction` is called while the toast remains in `data-motion-state="exit"`; click permission deny and assert the store `respond` spy is called before the retained prompt is removed after `120ms`.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/hooks/useMotionPresence.test.tsx src/renderer/src/components/common/__tests__/Popover.test.tsx src/renderer/src/components/Toast/ToastContainer.test.tsx src/renderer/src/components/ChatView/PermissionRequestStack.test.tsx src/renderer/src/components/Settings/tabs/ManagedModelsPanel.test.tsx`

Expected: FAIL because all four surfaces currently unmount immediately.

- [x] **Step 3: Implement bounded presence and surface state markers**

```ts
export function useMotionPresence(open: boolean, exitMs: number): MotionPresence {
  const [rendered, setRendered] = useState(open);
  const [state, setState] = useState<"enter" | "exit">(open ? "enter" : "exit");
  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setState("enter"));
      return () => cancelAnimationFrame(frame);
    }
    setState("exit");
    const timer = setTimeout(() => setRendered(false), exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, open]);
  return { rendered, state };
}
```

Use `100ms` for popovers, `120ms` for toast/permission exits, and `180ms` for settings dialogs. Do not delay retry, save, delete, permission, or window actions.

- [x] **Step 4: Add exact enter/exit CSS**

```css
.pi-motion-popover,
.pi-motion-toast,
.pi-motion-permission,
.pi-motion-dialog,
.pi-motion-dialog-backdrop {
  transition-property: opacity, transform;
  transition-timing-function: var(--motion-ease);
}
```

Popovers enter from `translateY(4px) scale(0.98)`, dialogs from `translateY(6px) scale(0.985)`, and toast/permission surfaces from `translateY(8px)`. Exit travel is smaller than entry travel.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the same focused command from Step 2.

Expected: PASS with fake timers drained and no act warnings.

---

### Task 5: Rails, Collapses, Lists, Status, And Exact Transition Cleanup

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeLayout.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeLayout.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/AnimatedCollapse.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/SessionRow.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/DiffView/DiffViewer.tsx`
- Modify: `apps/desktop/src/renderer/src/components/PiStatusPanel/PiStatusPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/UsageStats/UsageStatsPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/TaskProgressPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/tabs/AboutTab.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`

**Interfaces:**
- `MiniMaxCodeLayout` exposes `data-resizing="true|false"` on the left rail and uses `RIGHT_FLOATING_MOTION_MS = 180`.
- Session rows receive `.pi-motion-list-item-enter`; ordinary rerenders do not recreate keyed rows, so the one-time keyframe does not replay.

- [x] **Step 1: Write failing source and layout tests**

```ts
function collectRendererSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRendererSources(path);
    return /\.(css|tsx)$/.test(entry.name) ? [path] : [];
  });
}

it("uses only exact transition properties across renderer sources", () => {
  const rendererRoot = resolve(process.cwd(), "src/renderer/src");
  for (const path of collectRendererSources(rendererRoot)) {
    expect(readFileSync(path, "utf8"), path).not.toContain("transition-all");
  }
});

it("disables rail interpolation while resizing", () => {
  render(<MiniMaxCodeLayout {...props} onLeftWidthChange={vi.fn()} />);
  fireEvent.pointerDown(screen.getByRole("separator"), { pointerId: 1, clientX: 190 });
  expect(screen.getByLabelText("primary navigation").getAttribute("data-resizing")).toBe("true");
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @pi-desktop/desktop test src/renderer/src/App.test.tsx src/renderer/src/components/MiniMaxCode/MiniMaxCodeLayout.test.tsx`

Expected: FAIL because renderer sources still contain `transition-all` and the rail lacks `data-resizing`.

- [x] **Step 3: Replace broad transitions and align timings**

Replace every `transition-all` with the smallest matching Tailwind transition list, for example:

```tsx
className="transition-[width,opacity] duration-[var(--motion-panel)]"
className="transition-[background-color,border-color,color,opacity,box-shadow,transform]"
```

Set rail/collapse durations from shared tokens, reduce the floating rail timeout to `180ms`, add `data-resizing`, and disable width/opacity transitions while resizing. Add list-row entrance and fixed-container icon/status cross-fades without animating whole cards continuously.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same focused command from Step 2 plus existing sidebar/collapse tests.

Expected: PASS.

---

### Task 6: Full Verification And Real Electron Acceptance

**Files:**
- Create: `apps/desktop/e2e/motion-system.spec.ts`
- Modify only if acceptance exposes a regression: files from Tasks 1-5.

**Interfaces:**
- Produces: persistent Electron acceptance coverage for panel latency, computed transition properties, settings switching, popover exit, rail toggles, reduced-motion, and screenshots.

- [x] **Step 1: Write the Electron acceptance spec**

```ts
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

async function measureTab(page: Page, name: string): Promise<number> {
  const started = performance.now();
  await page.getByRole("tab", { name }).click();
  await page.getByRole("tab", { name }).waitFor({ state: "visible" });
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  return performance.now() - started;
}

test("keeps navigation immediate while exposing the shared motion contract", async () => {
  const chatSamples: number[] = [];
  for (let pass = 0; pass < 5; pass += 1) {
    await measureTab(page, "运行");
    await measureTab(page, "工作台");
    await measureTab(page, "扩展");
    chatSamples.push(await measureTab(page, "对话"));
  }
  expect(median(chatSamples)).toBeLessThan(100);
  const style = await page.locator('[data-main-panel="chat"]').evaluate((node) => {
    const css = getComputedStyle(node);
    return { transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration };
  });
  expect(style.transitionProperty).toContain("opacity");
  expect(style.transitionProperty).toContain("transform");
});
```

Open Settings, cycle all ten categories, open/close a model dialog, exercise popovers and rails, emulate reduced motion, and save screenshots under the test output directory.

- [x] **Step 2: Build and run the new Electron test**

Run: `pnpm --filter @pi-desktop/desktop build && pnpm --filter @pi-desktop/desktop exec playwright test e2e/motion-system.spec.ts`

Expected: PASS; median return-to-Chat and all top-level state updates remain below `100ms`.

- [x] **Step 3: Run mandatory repository verification in order**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`

Expected: PASS with the full Vitest suite green.

- [x] **Step 4: Rebuild production output and rerun Electron acceptance**

Run: `pnpm --filter @pi-desktop/desktop build && pnpm --filter @pi-desktop/desktop exec playwright test e2e/motion-system.spec.ts e2e/smoke.spec.ts`

Expected: PASS with screenshots showing no overlap, clipping, black corners, stale active layers, or inactive Chat composer.

- [x] **Step 5: Review the final diff without disturbing pre-existing work**

Run: `git diff --check && git status --short --branch && git diff --stat`

Expected: no whitespace errors; implementation and prior performance fixes remain intact; unrelated files are neither reverted nor staged.
