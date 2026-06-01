// ESLint 9 flat config (Pi Desktop)
// 最小可用配置: TS 解析 + 推荐规则 + React hook 警告
// 之前的 .eslintrc.* 已被 ESLint 9 弃用

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "out/**",
      "node_modules/**",
      "dist/**",
      "release/**",
      "*.config.js",
      "*.config.ts",
      "vitest.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        // Node/Electron renderer
        process: "readonly",
        global: "readonly",
        // DOM types
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLDivElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        FormData: "readonly",
        URL: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        File: "readonly",
        FileList: "readonly",
        DataTransfer: "readonly",
        DragEvent: "readonly",
        ClipboardEvent: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        // React
        React: "readonly",
        // Electron
        electron: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "no-unused-vars": "off", // TypeScript handles this
      "no-undef": "off", // TypeScript handles this
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-useless-escape": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/main/**/*.ts"],
    languageOptions: {
      globals: {
        // Node main process
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
  },
  {
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
    languageOptions: {
      globals: {
        // Renderer only - exposed by preload
        piAPI: "readonly",
        nodeAPI: "readonly",
        api: "readonly",
        store: "readonly",
      },
    },
  },
];
