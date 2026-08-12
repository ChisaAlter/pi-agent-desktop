// v1.0.10 (L2): __APP_VERSION__ 在 vite.config.ts 里 define 注入, 从 package.json 读.
// 不要在这里写默认值 — 编译时若 define 漏了, 应该立刻报 undefined, 不会静默用错版本.

declare const __APP_VERSION__: string;

// Herdr GUI mock 运行时开关（electron.vite.config.ts define 注入）:
// "1" 时 herdr-store 使用原型同款模拟数据（见 herdr-mock-data.ts 头部隔离标记）驱动
// parity/开发；"0"（默认）时无真实运行时 → 显示断线/空态，禁止假数据。
declare const __PI_HERDR_MOCK__: '0' | '1';
