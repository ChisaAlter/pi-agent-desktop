/**
 * M7: 接入 a11y 自动化测试 — 占位 spec
 *
 * 计划:
 *   - 用 @axe-core/playwright + Playwright 跑端到端 a11y 扫描
 *   - 扫描基线: axe-core WCAG 2.1 AA / 2.2 A 标准
 *   - 集成到 CI: pnpm e2e (待 Playwright runner 接入后)
 *
 * 当前为占位:
 *   1. 确认 @axe-core/playwright 已经装上 (AxeBuilder 可 import)
 *   2. 不真正启动浏览器, 不强依赖 playwright-core
 *   3. 命名约定: *.spec.ts (Playwright), 与 vitest 的 *.test.ts 区分
 *
 * 真正的 Playwright runner 接入留到后续 slice.
 *
 * @see https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
 */

// @ts-expect-error - vitest globals 仅在 *.test.ts 里声明, 此处用 Playwright describe/it 语义
import { describe, it, expect } from "vitest";
import { AxeBuilder } from "@axe-core/playwright";

describe("a11y (placeholder)", () => {
    it("@axe-core/playwright package is installed and AxeBuilder is importable", () => {
        // AxeBuilder 既是命名导出也是 default 导出
        expect(typeof AxeBuilder).toBe("function");
    });

    it("exposes the standard a11y scan API surface", () => {
        // 不真正实例化 (需要 playwright Page), 只验证 prototype 链上方法存在
        const proto = AxeBuilder.prototype as unknown as Record<string, unknown>;
        expect(typeof proto.analyze).toBe("function");
        expect(typeof proto.include).toBe("function");
        expect(typeof proto.exclude).toBe("function");
        expect(typeof proto.withTags).toBe("function");
    });
});
