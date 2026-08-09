# Composer Processing Border Beam Design

## Summary

Add a restrained animated border beam to the chat composer while the assistant is processing a user request. The effect begins when the send lifecycle enters the existing streaming state, remains visible through waiting, thinking, tool execution, and streamed output, then disappears on completion, cancellation, or error.

**Status update (2026-08-09):** Production now uses the official npm package [`border-beam`](https://www.npmjs.com/package/border-beam) (Jakub Antalik) mounted from `ChatInput.tsx` while `showProcessingState` is true. The earlier pure-CSS `.pi-border-beam` hand-roll was removed because it did not match the reference effect at https://beam.jakubantalik.com/.

## Goals

- Give immediate visual feedback after the user sends a message.
- Keep one continuous signal throughout the full assistant turn.
- Preserve the composer's fixed-height layout, resize behavior, controls, and input usability.
- Match the existing Pi Desktop theme and motion system.
- Provide a non-animated fallback when reduced motion is requested.

## Non-Goals

- Replacing the existing running status strip or stop control.
- Adding beams to message cards, the right rail, or other panels.
- Creating separate animations for waiting, thinking, tools, and output.
- ~~Adding a third-party runtime dependency.~~ Superseded: production now depends on `border-beam` for the reference visual.

## State And Data Flow

`usePiStream().isStreaming` remains the authoritative assistant-processing state. `ChatView` already passes it to `ChatInput` as `isProcessing`.

The lifecycle is:

1. A successful send starts the stream and sets `isStreaming` to `true` before model output arrives.
2. Waiting, thinking deltas, tool calls, and text deltas keep the same stream active.
3. `turn_end`, `agent_end`, stop, extension error, or send failure sets `isStreaming` to `false`.
4. `ChatInput` mounts the decorative beam only while `isProcessing` is true.

Image description preflight uses the same visual treatment through the existing `isDescribingImages` state because it is also user-visible processing that happens after send. No Zustand state or cross-process event will be added for the effect.

## Visual Behavior

The beam is an absolutely positioned, pointer-transparent overlay on the composer shell. A masked 1px border ring contains a single rotating conic-gradient highlight. The base composer border remains present, so mounting or unmounting the effect does not alter geometry.

The highlight uses the existing accent token as its primary color with a short cyan-to-violet tail. It stays intentionally narrow and low intensity so the composer reads as active without competing with streamed content or approval prompts. Entry uses a short opacity animation from the existing motion tokens; completion removes the overlay immediately so no stale processing signal remains. The shell does not scale, move, glow outward, or change height.

The overlay inherits the shell radius and follows both the default 95px height and user-resized heights up to 240px. It remains behind the resize handle, status strip, textarea, popovers, and controls. It never captures pointer or keyboard input.

## Accessibility And Motion

The beam is decorative and remains `aria-hidden`. The existing live status strip provides the semantic processing announcement, and the existing stop button remains the actionable control.

Under `prefers-reduced-motion: reduce`, rotation and fade animation stop. Processing is represented by a static accent border highlight, so state is still visible without continuous movement.

## Error And Completion Behavior

The effect owns no lifecycle logic. It follows `isProcessing`, so existing completion, stop, and error paths remove it automatically. Send validation failures that never start a stream do not show the beam. Image preflight errors remove the effect when `isDescribingImages` is cleared and continue through the existing error UI.

## Testing

Component tests in `ChatInput.test.tsx` will verify:

- The beam is absent while idle.
- The beam mounts when `isProcessing` is true.
- The beam is removed when the component returns to idle.
- The overlay is decorative and does not replace the running status or stop control.
- The shell keeps the same layout classes and fixed-height contract while processing.

The existing `usePiStream` tests remain the source of truth for start, completion, stop, and error transitions. The composer E2E flow will verify the real Electron surface at default and resized heights, including that controls remain usable and the beam is clipped to the shell border. Visual QA will cover light and dark themes and reduced-motion behavior.

## Acceptance Criteria

- Sending a valid user message shows the border beam before the first assistant token.
- The beam remains visible through thinking, tools, and streamed output.
- Completion, cancellation, and errors remove the beam without leaving stale animation.
- No composer dimension, overlay offset, or control position changes when the effect toggles.
- The effect works in light and dark themes and has a static reduced-motion fallback.
- No new runtime dependency is added.
