import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "jsdom",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        setupFiles: ["./src/test/setup.ts"],
        css: false,
    },
    esbuild: {
        loader: "tsx",
        include: /src\/renderer\/.*\.(ts|tsx)/,
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src/renderer/src"),
            "@shared": resolve(__dirname, "../../packages/shared-types/src"),
        },
        extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
});
