// useFocusTrap — a11y focus trap for modal dialogs.
//
// On activation: records the currently focused element so it can be restored
// when the trap is torn down, then moves focus into the dialog (first
// focusable descendant, or the container itself if none). Tab / Shift+Tab
// cycling keeps focus inside the container. On deactivation, focus is returned
// to the previously focused element.
//
// The `active` flag lets callers enable/disable the trap for conditionally
// rendered dialogs (e.g. a dialog that mounts when `isOpen` flips to true).
// When `active` is false the effect is a no-op; flipping it back to true
// re-runs setup so the trap can engage on the next open.

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(', ');

export function useFocusTrap<T extends HTMLElement>(
    containerRef: RefObject<T | null>,
    active: boolean = true,
): void {
    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        const previouslyFocused = document.activeElement as HTMLElement | null;

        // Move focus into the dialog unless something inside already has focus
        // (lets callers keep their own initial-focus behavior, e.g. focusing a
        // confirm button or a search input).
        if (!container.contains(document.activeElement)) {
            const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
            if (focusables.length > 0) {
                focusables[0].focus();
            } else {
                container.tabIndex = -1;
                container.focus();
            }
        }

        const handleKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== "Tab") return;
            const currentFocusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
            if (currentFocusables.length === 0) {
                e.preventDefault();
                return;
            }
            const first = currentFocusables[0];
            const last = currentFocusables[currentFocusables.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        container.addEventListener("keydown", handleKeyDown);

        return () => {
            container.removeEventListener("keydown", handleKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [containerRef, active]);
}
