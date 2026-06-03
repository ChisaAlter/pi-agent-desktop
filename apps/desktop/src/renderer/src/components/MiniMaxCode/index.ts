// MiniMaxCode components barrel export
//
// MiniMax Code 风格子组件统一入口. 当前已交付:
//   - M1: layout shell (MiniMaxCodeLayout)
//   - M2: left sidebar + bottom user card (MiniMaxCodeSidebar / MiniMaxCodeUserCard)
// 后续 M3+ 子组件(ChatPanel / ContextPanel 等)在此追加导出.

export {
    MiniMaxCodeLayout,
    type MiniMaxCodeLayoutProps,
} from "./MiniMaxCodeLayout";

export {
    MiniMaxCodeSidebar,
    type MiniMaxCodeSidebarProps,
    type MiniMaxCodeSection,
    type MiniMaxCodeSidebarGroup,
} from "./MiniMaxCodeSidebar";

export {
    MiniMaxCodeUserCard,
    type MiniMaxCodeUserCardProps,
} from "./MiniMaxCodeUserCard";
