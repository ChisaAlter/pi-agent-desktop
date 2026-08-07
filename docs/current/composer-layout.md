# Composer Layout Contract

> **Current product contract for the chat input (composer).** This describes the checked-in reference-frame layout used by the main chat surface, not a historical plan.

## Scope

- Production component: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx` with `referenceFrame`
- Mount point: `#pi-global-composer-root` in `MiniMaxCodeLayout` (portal from `ChatView`)
- Height owner: `useInputText({ autoSize: !referenceFrame })` + composer resize handle
- CSS variables:
  - `--pi-global-composer-height` — outer reserved height for floating overlays (composer shell height + 8px)
  - `--pi-global-composer-left` / `--pi-global-composer-right` — horizontal bounds for overlays anchored above the composer

Non-reference (auto-height) composer remains available for non-global surfaces; attachment rail behavior is shared.

## Layout stack (top → bottom)

```text
┌─ attachment rail (OUTSIDE shell; only when attachments exist) ─┐
│  horizontal chips (images + files), overflow-x auto            │
└────────────────────────────────────────────────────────────────┘
┌─ shell (fixed height, opaque bg-[var(--mm-bg-input)]) ─────────┐
│  light resize handle (absolute top, no divider bar)            │
│  optional running strip (absolute, above shell)                │
│  text body (flex-1, min-h-0; textarea overflow-y auto)         │
│  optional error / model-required notes (shrink + scroll)       │
│  controls row (shrink-0; no border divider; small gap above)   │
└────────────────────────────────────────────────────────────────┘
```

### Vertical ownership rules

1. **Shell is fixed height** in reference mode (`COMPOSER_MIN_HEIGHT` 95px → `COMPOSER_MAX_HEIGHT` 240px). Content never changes shell height; long drafts scroll inside the textarea.
2. **Shell is opaque.** Dialogue must not show through the composer. Outer wrapper and shell use `bg-[var(--mm-bg-input)]` in reference mode.
3. **Text body and controls are vertically separated.**
   - Body is `flex-1 min-h-0` with a small bottom pad (`pb-1.5`).
   - Controls are `shrink-0` with a small top pad (`pt-0.5`).
   - No hard divider line between body and controls.
   - Geometry contract: textarea bottom ≤ controls top (no overlap under long paste).
4. **Resize handle is light, not a heavy strip.**
   - Absolute grip on the top inner edge of the shell.
   - No full-width opaque placeholder band, no `border-b` divider.
5. **Attachments live above the shell, not inside it.**
   - Chips are a horizontal rail outside the fixed shell.
   - Images show a small thumbnail; files show an icon + truncated name.
   - Many attachments scroll horizontally (`overflow-x-auto`); they must not steal vertical space from the textarea.

### Popovers

`@mention` and slash menus use `bottom-full` and must anchor to the **shell** (the positioned ancestor), not to an intermediate padded body wrapper. Result: menus sit just above the shell top with a small gap and are not clipped into the shell padding.

## Interaction with the conversation list

Composer is mounted in `#pi-global-composer-root` as a **flex `shrink-0` sibling under** the center workspace, not a transparent overlay over the message list.

When the user drags the composer taller:

1. The center column flex space for `ChatView` shrinks.
2. The message scroll region shortens with the available height.
3. If the user is near the bottom, `ChatView` listens for `pi:composer-height-change` and re-sticks to the latest message so the conversation is **pushed up**, not left under the composer.

Message list bottom padding (`pb-8`) keeps the last bubble from sitting flush against the composer.

Floating surfaces (permission stack, progress toast, right floating rail bottom offset) use `--pi-global-composer-height` so they stay clear of the composer.

## Height and CSS variables

| Symbol | Value / rule |
| --- | --- |
| Default shell height | 95px |
| Max shell height | 240px |
| `--pi-global-composer-height` | `shellHeight + 8` (px) |
| On unmount / leave chat | remove `--pi-global-composer-height`, left, and right vars |

`commitComposerHeight` clamps, writes the CSS variable, and dispatches `pi:composer-height-change`.

## Content containment (pressure cases)

| Pressure | Expected behavior |
| --- | --- |
| 500-line draft | Textarea scrolls; shell height unchanged; no document scroll |
| Very long unbreakable URL | No horizontal page overflow |
| Many image/file attachments | Horizontal rail above shell; shell height unchanged |
| Oversized paste image / send error | Error region shrinks and scrolls inside shell (`break-all` / `pre-wrap` for long text) |
| Slash / mention open | Menu above shell; not clipped by shell overflow |

## Non-goals

- Do not put attachment chips back inside the fixed shell body.
- Do not reintroduce a hard divider between textarea and controls.
- Do not make the shell transparent again (dialogue would show through).
- Do not treat composer height as free auto-grow without a max in reference mode.

## Implementation map

| Concern | Location |
| --- | --- |
| Composer UI + resize | `ChatInput.tsx` (`referenceFrame`) |
| Textarea auto-size (non-reference) | `hooks/useInputText.ts` |
| Portal + stick-to-bottom on resize | `ChatView.tsx` |
| Mount slot | `MiniMaxCodeLayout.tsx` `#pi-global-composer-root` |
| Overlay bottom offsets | `PermissionRequestStack`, progress toast, App right-floating rail |
| HTML prototype (visual QA) | `ChatView/composer-layout-prototype.html` |
| E2E contract | `apps/desktop/e2e/composer-layout.spec.ts` |
| CDP QA helper | `scripts/electron-composer-qa.mjs` |

## Verification

Unit:

- `ChatInput.test.tsx` — opaque shell, long draft containment, attachment rail outside shell, control pinning
- `useInputText.test.tsx` — auto-size vs fixed mode

E2E (`composer-layout.spec.ts`):

- baseline fixed 95px + light handle + controls flush bottom
- long text: scroll inside textarea, no control overlap
- attachment rail above shell with horizontal scroll
- error containment, resize, slash menu above shell, panel switch cleanup of CSS vars

After product changes to this contract, rebuild before Electron E2E (`pnpm --filter @pi-desktop/desktop build`) and repackage `win-unpacked` when validating the installed desktop shortcut path.
