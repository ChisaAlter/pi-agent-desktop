// Shortcuts barrel (M7+ 可用度-C)

export {
    SHORTCUTS,
    groupByCategory,
    matchesCombo,
    findMatchingShortcut,
    getShortcutById,
    registerShortcutHandler,
    dispatchShortcut,
    __resetShortcutHandlersForTest,
    type ShortcutDef,
    type ShortcutCategoryKey,
    type ShortcutCombo,
} from "./registry";

export { useShortcuts } from "./useShortcuts";
