import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        setupFiles: ["./src/test/setup.ts"],
        css: false,
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src/renderer/src"),
            "@shared": resolve(__dirname, "../../packages/shared-types/src"),
        },
    },
});
