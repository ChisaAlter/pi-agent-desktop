// MiniMaxCode components barrel export
// v1.0.15: 删 MiniMaxCodeInput / WelcomeScreen / MiniMaxCodeUserCard —
//          死代码 (App.tsx 只引 MiniMaxCodeLayout / MiniMaxCodeSidebar / TaskProgressPanel),
//          且包含假 placeholder / 假按钮 ("现在这项目完成度太低了。" / 5 个旧快捷按钮).

export {
    MiniMaxCodeLayout,
    type MiniMaxCodeLayoutProps,
} from "./MiniMaxCodeLayout";

export {
    MiniMaxCodeSidebar,
    type MiniMaxCodeSidebarProps,
} from "./MiniMaxCodeSidebar";

export {
    TaskProgressPanel,
    type TaskProgressPanelProps,
    type TaskProgressItem,
} from "./TaskProgressPanel";

export { RightRail } from "./RightRail";

