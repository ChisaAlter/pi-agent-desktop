import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "extensions/**/*.test.ts",
            "extensions/**/*.test.tsx",
            "../../packages/shared-types/**/*.test.ts",
        ],
        setupFiles: ["./src/test/setup.ts"],
        css: false,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            include: ["src/**/*.{ts,tsx}", "extensions/**/*.{ts,tsx}"],
            exclude: ["**/__tests__/**", "**/*.test.*", "**/*.config.*"],
            // TODO: add thresholds after coverage improves
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src/renderer/src"),
            "@shared": resolve(__dirname, "../../packages/shared-types/src"),
            "@pi-desktop/shared-types": resolve(__dirname, "../../packages/shared-types/src"),
            "@pi-desktop/*": resolve(__dirname, "../../packages/*/src"),
        },
    },
});
