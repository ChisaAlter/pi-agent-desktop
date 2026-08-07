# Composer Processing Border Beam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a restrained border beam around the chat composer from user send through assistant completion, with no layout shift and a static reduced-motion fallback.

**Architecture:** Keep `usePiStream().isStreaming` as the only assistant-processing state and continue passing it through `ChatView` as `ChatInput.isProcessing`. Consolidate the composer-local processing expression into one boolean, expose it as a DOM state contract, and refine the existing pure CSS overlay rather than adding the third-party package.

**Tech Stack:** React 19, TypeScript 5, Tailwind CSS 4, CSS masks/gradients, Vitest 4, Testing Library, Playwright Electron.

## Global Constraints

- Do not add the `border-beam` npm package or any other runtime dependency.
- The beam is limited to the chat composer shell.
- The active interval is send start through waiting, thinking, tools, streamed output, completion, cancellation, or error.
- Preserve the 95px to 240px fixed-height composer contract and all existing controls.
- The animated overlay must remain pointer-transparent and `aria-hidden`.
- Under `prefers-reduced-motion: reduce`, show a static accent border instead of continuous animation.
- Keep the existing running status strip and stop button unchanged.
- Follow the repository verification order: typecheck, lint, then test.

---

### Task 1: Lock The Composer Processing DOM Contract

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx:966-980,1128-1163`
- Test: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.test.tsx:937-989`

**Interfaces:**
- Consumes: `ChatInputProps.isProcessing: boolean` and local `isDescribingImages: boolean`.
- Produces: `showProcessingState: boolean`, `data-processing="true" | "false"` on `[data-testid="chat-input-shell"]`, and conditional `[data-testid="chat-input-border-beam"]` mounting.

- [ ] **Step 1: Write the failing processing-state test**

Add this test beside the existing running-strip test in `ChatInput.test.tsx`:

```tsx
it("mounts the decorative border beam only while the composer is processing", () => {
  const renderInput = (isProcessing: boolean) => (
    <I18nProvider>
      <ChatInput
        isConnected
        isProcessing={isProcessing}
        workspaceId="ws1"
        workspacePath="C:/repo"
        onSend={vi.fn(async () => undefined)}
        onStop={vi.fn()}
        referenceFrame
      />
    </I18nProvider>
  );

  const { rerender } = render(renderInput(false));
  const shell = screen.getByTestId("chat-input-shell");
  expect(shell.getAttribute("data-processing")).toBe("false");
  expect(screen.queryByTestId("chat-input-border-beam")).toBeNull();

  rerender(renderInput(true));
  expect(screen.getByTestId("chat-input-shell").getAttribute("data-processing")).toBe("true");
  const beam = screen.getByTestId("chat-input-border-beam");
  expect(beam.getAttribute("aria-hidden")).toBe("true");
  expect(beam.className).toContain("pi-border-beam");

  rerender(renderInput(false));
  expect(screen.getByTestId("chat-input-shell").getAttribute("data-processing")).toBe("false");
  expect(screen.queryByTestId("chat-input-border-beam")).toBeNull();
});
```

The production change that makes this test pass is the explicit `data-processing` shell contract. The existing beam mount is not sufficient because the first assertion currently receives `null`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/ChatView/ChatInput.test.tsx
```

Expected: FAIL in the new test because `chat-input-shell` has no `data-processing` attribute.

- [ ] **Step 3: Implement the minimal state consolidation**

In `ChatInput.tsx`, insert the new boolean immediately before `showStopAction`:

```tsx
const showProcessingState = isProcessing || isDescribingImages;
const showStopAction = isProcessing;
```

Insert the shell attribute immediately after its existing `data-testid`, then replace both duplicated conditions with the new boolean:

```diff
 <div
   ref={shellRef}
   data-testid="chat-input-shell"
+  data-processing={showProcessingState ? "true" : "false"}
   className={`${referenceFrame ? "mx-0 flex min-h-0 w-full max-w-none flex-col bg-[var(--mm-bg-input)]" : "mx-auto max-w-[770px]"} relative overflow-visible rounded-[7px] border border-[var(--mm-border)] shadow-none transition-[border-color,box-shadow] focus-within:border-[var(--mm-border-strong)] ${referenceFrame ? "" : "bg-transparent"}`}

-{(isProcessing || isDescribingImages) && (
+{showProcessingState && (
   <div
     className="pi-border-beam"
     aria-hidden="true"
     data-testid="chat-input-border-beam"
   />
 )}
-{(isProcessing || isDescribingImages) && (
+{showProcessingState && (
   <div
     role="status"
     aria-label={isDescribingImages ? t("chatInput.describingImages") : "任务运行中提醒"}
```

Do not change `ChatView`, `usePiStream`, the status text, or stop-button behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/ChatView/ChatInput.test.tsx
```

Expected: all `ChatInput` tests PASS with no warnings.

- [ ] **Step 5: Review the task diff**

Run:

```bash
git diff --check
git diff -- apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx apps/desktop/src/renderer/src/components/ChatView/ChatInput.test.tsx
```

Confirm the diff only consolidates the processing boolean, adds the shell attribute, and adds the regression test.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx apps/desktop/src/renderer/src/components/ChatView/ChatInput.test.tsx
git commit -m "test(chat): lock composer processing beam state"
```

---

### Task 2: Refine The Beam And Verify The Electron Surface

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/globals.css:1171-1224,1571-1580`
- Test: `apps/desktop/src/renderer/src/styles/globals.test.ts`
- Modify: `apps/desktop/e2e/composer-layout.spec.ts`
- Modify: `docs/current/composer-layout.md`

**Interfaces:**
- Consumes: `.pi-border-beam`, `.pi-border-beam::before`, `[data-processing]`, existing composer geometry helpers, and `agents:event` IPC payloads.
- Produces: a masked animated 1px accent/cyan/violet border, a static reduced-motion border, and an Electron regression test covering active, resized, reduced-motion, and completed states.

- [ ] **Step 1: Write the failing CSS contract test**

Add this test to `globals.test.ts`:

```ts
it("keeps the composer processing beam visible without motion when reduced motion is requested", () => {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

  expect(css).toMatch(/\.pi-border-beam\s*\{[^}]*pointer-events:\s*none/s);
  expect(css).toMatch(/\.pi-border-beam::before\s*\{[^}]*pi-border-beam-spin/s);
  expect(css).toContain("rgba(34, 211, 238, 0.72)");

  const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reducedMotion).not.toMatch(/\.pi-border-beam\s*\{[^}]*display:\s*none/s);
  expect(reducedMotion).toMatch(/\.pi-border-beam\s*\{[^}]*animation:\s*none/s);
  expect(reducedMotion).toMatch(/\.pi-border-beam\s*\{[^}]*border:\s*1px solid/s);
  expect(reducedMotion).toMatch(/\.pi-border-beam::before\s*\{[^}]*display:\s*none/s);
});
```

- [ ] **Step 2: Add the Electron test before changing CSS**

Add a local event helper near `launchComposerApp` in `composer-layout.spec.ts`:

```ts
async function emitCurrentAgentEvents(
    page: Page,
    app: ElectronApplication,
    events: Array<Record<string, unknown>>,
): Promise<void> {
    const agent = await page.evaluate(async () => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId) ?? agents[0] ?? null;
    });
    if (!agent) throw new Error("No agent available for composer processing events");

    await app.evaluate(({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows().find(
            (item) => !item.isDestroyed() && item.webContents.getURL().includes("index.html"),
        );
        if (!win) throw new Error("No main window available for composer processing events");
        for (const event of payload.events) {
            win.webContents.send("agents:event", {
                agentId: payload.agent.id,
                workspaceId: payload.agent.workspaceId,
                event,
            });
        }
    }, { agent, events });
}
```

Add this test to the composer describe block:

```ts
test("处理状态: 光束跟随整个 turn, 适配 resize 与 reduced motion", async () => {
    ({ app, page } = await launchComposerApp());
    await waitForComposer(page);

    const shell = page.getByTestId("chat-input-shell");
    await expect(shell).toHaveAttribute("data-processing", "false");
    await expect(page.getByTestId("chat-input-border-beam")).toHaveCount(0);

    await emitCurrentAgentEvents(page, app, [{ type: "agent_start" }]);
    await expect(shell).toHaveAttribute("data-processing", "true");
    const beam = page.getByTestId("chat-input-border-beam");
    await expect(beam).toBeVisible();

    const activeStyle = await beam.evaluate((element) => {
        const style = getComputedStyle(element);
        const before = getComputedStyle(element, "::before");
        const shellRect = element.parentElement!.getBoundingClientRect();
        const beamRect = element.getBoundingClientRect();
        return {
            pointerEvents: style.pointerEvents,
            beforeAnimation: before.animationName,
            edgeDelta: Math.max(
                Math.abs(shellRect.left - beamRect.left),
                Math.abs(shellRect.top - beamRect.top),
                Math.abs(shellRect.right - beamRect.right),
                Math.abs(shellRect.bottom - beamRect.bottom),
            ),
        };
    });
    expect(activeStyle.pointerEvents).toBe("none");
    expect(activeStyle.beforeAnimation).toContain("pi-border-beam-spin");
    expect(activeStyle.edgeDelta).toBeLessThanOrEqual(1);

    for (const theme of ["light", "dark"] as const) {
        await page.evaluate((nextTheme) => {
            document.documentElement.setAttribute("data-theme", nextTheme);
        }, theme);
        await page.screenshot({ path: test.info().outputPath(`processing-border-beam-${theme}.png`) });
    }

    const handle = page.getByRole("separator", { name: "调整输入框高度" });
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("resize handle not visible");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 80, { steps: 6 });
    await page.mouse.up();
    const resizedGeometry = await composerGeometry(page);
    expect(resizedGeometry.shell!.height).toBeGreaterThan(150);
    expectShellContract(resizedGeometry, resizedGeometry.shell!.height);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedStyle = await beam.evaluate((element) => {
        const style = getComputedStyle(element);
        const before = getComputedStyle(element, "::before");
        return {
            display: style.display,
            animation: style.animationName,
            borderWidth: style.borderTopWidth,
            beforeDisplay: before.display,
        };
    });
    expect(reducedStyle.display).not.toBe("none");
    expect(reducedStyle.animation).toBe("none");
    expect(reducedStyle.borderWidth).toBe("1px");
    expect(reducedStyle.beforeDisplay).toBe("none");
    await page.screenshot({ path: test.info().outputPath("processing-border-beam-reduced.png") });

    await emitCurrentAgentEvents(page, app, [{ type: "turn_end" }, { type: "agent_end" }]);
    await expect(shell).toHaveAttribute("data-processing", "false");
    await expect(page.getByTestId("chat-input-border-beam")).toHaveCount(0);
});
```

- [ ] **Step 3: Run the CSS test and verify RED**

Run:

```bash
pnpm --filter @pi-desktop/desktop test src/renderer/src/styles/globals.test.ts
```

Expected: FAIL because the current gradient has no cyan stop and reduced motion sets `.pi-border-beam { display: none; }`.

Do not run the new Electron test until after rebuilding in Step 6; it targets compiled output.

- [ ] **Step 4: Implement the refined beam CSS**

Keep the existing masked ring structure and replace the gradient with a restrained accent/cyan/violet trail:

```css
.pi-border-beam::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 320%;
  height: 320%;
  transform: translate(-50%, -50%) rotate(0deg);
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    color-mix(in srgb, var(--mm-accent-blue) 92%, transparent) 38deg,
    rgba(34, 211, 238, 0.72) 70deg,
    rgba(139, 92, 246, 0.56) 104deg,
    transparent 138deg
  );
  animation: pi-border-beam-spin 2.6s linear infinite;
}
```

Replace the reduced-motion hide rule with a static border and disable its pseudo-element:

```css
@media (prefers-reduced-motion: reduce) {
  .pi-border-beam {
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--mm-accent-blue) 62%, transparent);
    -webkit-mask: none;
    mask: none;
    animation: none;
  }

  .pi-border-beam::before {
    display: none;
    animation: none;
  }
}
```

Insert these two rules at the beginning of the existing reduced-motion media query. Leave every selector that follows `.pi-border-beam::before` in that media query byte-for-byte unchanged.

Do not add box shadows, filters, outer glow, layout properties, or JavaScript animation state.

- [ ] **Step 5: Update the current composer contract**

Add this item immediately after existing vertical ownership rule 5 in `docs/current/composer-layout.md`:

```markdown
6. **Processing is shown on the shell border.** While `isProcessing` or image preflight is active, a pointer-transparent 1px border beam overlays the shell without changing its geometry. Reduced-motion mode keeps a static accent border instead of rotating the beam.
```

Add `globals.css` to the Implementation Map as the owner of the processing beam and reduced-motion fallback.

- [ ] **Step 6: Run focused unit tests and verify GREEN**

Run:

```bash
pnpm --filter @pi-desktop/desktop test src/renderer/src/styles/globals.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/ChatView/ChatInput.test.tsx
```

Expected: both focused suites PASS with no warnings.

- [ ] **Step 7: Build and run the focused Electron E2E test**

Run:

```bash
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop exec playwright test e2e/composer-layout.spec.ts
```

Expected: build exits 0; the complete composer layout spec passes, including active beam geometry, resize behavior, reduced-motion fallback, and removal after turn completion. Inspect `apps/desktop/e2e-output/` and confirm the light/dark screenshots show a restrained active border without content overlap and `processing-border-beam-reduced.png` shows a static 1px accent border.

- [ ] **Step 8: Run documentation verification**

Run:

```bash
pnpm verify:docs
```

Expected: PASS because the current composer contract matches the implementation.

- [ ] **Step 9: Review the task diff**

Run:

```bash
git diff --check
git diff -- apps/desktop/src/renderer/src/styles/globals.css apps/desktop/src/renderer/src/styles/globals.test.ts apps/desktop/e2e/composer-layout.spec.ts docs/current/composer-layout.md
```

Confirm the diff contains no package changes, no new lifecycle state, and no unrelated visual refactor.

- [ ] **Step 10: Commit Task 2**

```bash
git add apps/desktop/src/renderer/src/styles/globals.css apps/desktop/src/renderer/src/styles/globals.test.ts apps/desktop/e2e/composer-layout.spec.ts docs/current/composer-layout.md
git commit -m "feat(chat): refine composer processing border beam"
```

---

### Task 3: Run The Repository Gate

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: the committed Task 1 and Task 2 changes.
- Produces: fresh repository-wide verification evidence.

- [ ] **Step 1: Confirm the worktree contains only expected state**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: no uncommitted files; the design, implementation-plan, DOM-contract, and visual implementation commits are present in recent history.

- [ ] **Step 2: Run the mandatory gate in order**

Run each command only after the preceding command passes:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

Expected: all three commands exit 0 with zero failures. Fix any failure in the owning task and rerun the gate from `pnpm -r typecheck`.

- [ ] **Step 3: Record final evidence**

Run:

```bash
git status --short
git show --stat --oneline HEAD
```

Expected: clean worktree and a final implementation commit limited to the planned files.
