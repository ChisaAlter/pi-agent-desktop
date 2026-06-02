// 全局测试设置
process.env.NODE_ENV = "test";

// i18n 模块在 import 时会立即 i18next.init() 并读 navigator.language / localStorage,
// 在 jsdom 里默认是 'en-US' 会拿到英文. 提前在 setup 阶段写 localStorage,
// 保证 i18n 模块第一次加载时拿到 zh-CN, 跟原中文断言兼容
try {
    if (typeof globalThis !== "undefined" && (globalThis as { localStorage?: Storage }).localStorage) {
        (globalThis as { localStorage: Storage }).localStorage.setItem("pi-desktop.locale", "zh-CN");
    }
} catch {
    // localStorage 不可用时 (隐私模式) 静默, 测试 fallback 到 DEFAULT_LOCALE = zh-CN
}
