# Pi Desktop Silky Motion System Design

## Goal

Give every common Pi Desktop interaction a coherent sense of flow without reintroducing input lag. State changes must happen immediately; motion explains the transition after the action has already been accepted.

The target style is restrained and polished: short, interruptible transitions, small travel distances, tactile press feedback, no bounce, and no cinematic delays.

## Motion Principles

1. **Response before animation.** Click handlers update state in the same event turn. No timeout or animation completion may gate navigation, close, save, or command execution.
2. **Interruptible transitions.** Reversible UI state uses CSS transitions so rapid repeated actions can change direction cleanly.
3. **Composite-first properties.** Repeated motion uses `transform` and `opacity`. Width and height animation is limited to existing sidebar and collapse flows where layout interpolation is required.
4. **Exact properties only.** `transition: all` is prohibited. Each rule lists the properties it animates.
5. **No permanent compositor reservation.** `will-change` is allowed only on short, known animation sequences that showed first-frame stutter in Electron. Controls and persistent panels must not keep it permanently.
6. **Reduced-motion parity.** `prefers-reduced-motion: reduce` keeps state changes and visibility behavior while reducing transitions to 1ms and removing transforms.
7. **No first-load spectacle.** Main content does not play a large entrance animation on application startup. Motion begins with user-driven transitions.

## Shared Motion Tokens

The renderer defines one timing and easing vocabulary in `globals.css`:

| Token | Value | Use |
| --- | ---: | --- |
| `--motion-instant` | `70ms` | Press and icon feedback |
| `--motion-fast` | `100ms` | Hover, focus, selected state |
| `--motion-panel` | `160ms` | Main panel and settings tab transitions |
| `--motion-overlay` | `180ms` | Popovers, dialogs, right rail |
| `--motion-emphasized` | `220ms` | Larger one-time content entrances |
| `--motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` | Standard movement |
| `--motion-ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Larger entrances |

Existing transition tokens remain as compatibility aliases until component usage is migrated.

## Interaction Surfaces

### Controls

- Buttons, tabs, menu items, options, and switches transition background, border, color, opacity, shadow, and transform with explicit properties.
- Enabled pointer controls use `scale(0.96)` while pressed. Inputs, textareas, selects, disabled controls, drag handles, and title-bar drag regions do not scale.
- Hover and press motion never changes layout dimensions.
- Checkbox, switch, disclosure, and status icons cross-fade or translate within stable containers so labels and surrounding controls do not move.

### Main Navigation Panels

The center router uses layered motion panels instead of conditionally destroying every panel:

1. `activeSection` resolves to the existing canonical panel id.
2. A panel mounts on its first visit and remains mounted afterward.
3. The active layer receives `data-active="true"`; inactive layers remain non-interactive and accessibility-hidden.
4. Active layers transition from `opacity: 0`, `translateY(6px)`, and `scale(0.995)` to their resting state over 160ms.
5. Exits use a smaller `translateY(-3px)` and a 100ms opacity transition.

This preserves chat streaming subscriptions, drafts, scroll state, workbench editor state, and terminal state while avoiding repeated heavy React mounts. The Chat composer renders only when the chat panel is active.

The Workbench lazy chunks may be prefetched during renderer idle time after the main screen is interactive. Prefetching must not block startup or create terminal sessions.

### Sidebars And Lists

- Left and right rails retain their current width/opacity transitions using the shared tokens.
- Session groups and workspace groups use the existing measured-height collapse implementation with opacity and a small vertical offset.
- Newly inserted session rows receive a one-time 160ms fade/translate entrance; ordinary rerenders do not replay it.
- Resize drag operations disable transitions until pointer release.

### Settings

- The settings renderer receives a restrained 180ms first-show entrance after its DOM is ready.
- Settings navigation changes cross-fade and translate the content panel over 160ms.
- Theme cards, switches, model actions, and configuration controls use the shared control feedback.
- Subdialogs use an 180ms backdrop fade and a 180ms dialog opacity/translate/scale transition. Exit motion is supported rather than disappearing immediately.
- Closing the settings window remains immediate and continues to fire pending persistence without waiting for animation or disk completion.

### Popovers, Toasts, And Status

- Popovers enter from `opacity: 0`, `translateY(4px)`, and `scale(0.98)` over 140ms and exit over 100ms.
- Toasts and permission prompts use a 180ms fade/translate entrance and a softer 120ms exit.
- Running indicators may loop, but only their icon/dot animates. Whole cards and text blocks do not pulse continuously.
- Completion and error states cross-fade icons inside fixed-size containers to avoid layout shifts.

## Architecture

### CSS Layer

`globals.css` owns tokens and reusable motion classes:

- `.pi-motion-control`
- `.pi-motion-panel-layer`
- `.pi-motion-popover`
- `.pi-motion-dialog`
- `.pi-motion-toast`
- existing rail, message, thinking, and settings classes migrated to shared tokens

Selectors remain narrowly scoped. No universal `*` animation rule is introduced.

### React Layer

A small reusable panel-layer component owns only visibility semantics:

- `active: boolean`
- `panelId: string`
- `children: ReactNode`

It renders `data-active`, `aria-hidden`, and pointer/inert behavior. App routing remains the source of truth; the motion component does not own navigation state or timers.

App tracks which panels have been visited. A panel is rendered when active or previously visited. This keeps expensive surfaces alive without loading every surface during startup.

### Exit-Aware Overlays

Existing popover and dialog owners keep a short `closing` state so exit transitions can complete. The maximum exit window is 180ms. Business actions such as save, close-window, abort, or permission decisions execute immediately; only visual removal waits.

## Performance Guardrails

- Repeated top-level navigation median must remain below 100ms in an isolated real Electron run.
- Returning to Chat after visiting another panel must remain below 100ms and must never rebuild the streaming hook.
- A control press must update `aria-selected`, `aria-checked`, or equivalent state before its visual transition completes.
- No idle renderer CPU loop may be introduced.
- No repeated interaction uses backdrop blur or animated filter effects.
- No persistent control uses `will-change: transform`.
- Settings close and main close-to-tray remain below 100ms under an idle diagnostic run.

## Testing

### Unit And Source Tests

- Assert shared motion tokens and exact transition properties exist.
- Reject `transition: all`, universal animation selectors, and permanent control `will-change`.
- Verify pressed controls have motion while inputs and disabled controls are excluded.
- Verify visited main panels remain mounted, only one panel is active, inactive panels are accessibility-hidden, and Chat removes its composer while inactive.
- Verify reduced-motion rules disable transforms and shorten durations.
- Verify overlay exit state does not delay its associated business action.

### Real Electron Acceptance

Run against the production build with isolated user data:

1. Repeatedly cycle Chat, Run, Workbench, and Extensions.
2. Open Settings, cycle all settings categories, open and close model dialogs, and close with a pending settings write.
3. Toggle left and right rails, collapse session groups, open popovers, and trigger a toast or permission prompt.
4. Measure interaction latency and computed transition properties.
5. Capture main and settings screenshots to check overlap, clipping, black corners, stale hidden panels, and composer leakage.
6. Repeat rapid clicks during transitions to confirm they remain interruptible and converge on the final requested state.

## Acceptance Criteria

- Common controls have visible hover, focus, press, and selected-state transitions.
- Main panels cross-fade and move subtly in both directions without remounting after first visit.
- Settings categories, popovers, dialogs, rails, collapses, toasts, and status changes follow the shared motion vocabulary.
- No animation blocks an action or delays window close.
- Real Electron latency budgets remain satisfied.
- Reduced-motion users retain complete functionality without spatial animation.
- Typecheck, lint, full unit tests, production build, and real Electron acceptance all pass.

## Non-Goals

- Spring physics, bounce, overshoot, large parallax, or long stagger sequences.
- Animating every text rerender or streaming token.
- Replacing the existing visual design, color system, or navigation model.
- Adding a motion dependency when CSS transitions and the current React structure are sufficient.
