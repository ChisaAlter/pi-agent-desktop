// MiniMaxCode components barrel export
//
// MiniMax Code 风格子组件统一入口. 后续 M2+ 子组件 (Sidebar / ChatPanel /
// ContextPanel 等) 在此追加导出.

export {
    MiniMaxCodeLayout,
    type MiniMaxCodeLayoutProps,
} from "./MiniMaxCodeLayout";

export {
    MiniMaxCodeInput,
    type MiniMaxCodeInputProps,
} from "./MiniMaxCodeInput";

export {
    WelcomeScreen,
    type WelcomeScreenProps,
    type WelcomeQuickAction,
} from "./WelcomeScreen";
