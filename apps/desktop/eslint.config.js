// ESLint 9 flat config (Pi Desktop)
// 最小可用配置: TS 解析 + 推荐规则 + React hook 警告
// 之前的 .eslintrc.* 已被 ESLint 9 弃用

// TODO: add eslint-plugin-import + eslint-plugin-jsx-a11y (SubTask 34.4 skipped
// to avoid installing new deps mid-config-fix; revisit in a follow-up).

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
    files: ["src/**/*.{ts,tsx}", "extensions/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // v1.0.7: globals list removed - no-undef is off (TS handles undefined
      // identifiers), so the manual globals block was dead code.
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
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-useless-escape": "warn",
      "react-hooks/rules-of-hooks": "error",
      // TODO: promote to "error" once the 8 existing exhaustive-deps violations
      // (App.tsx, ChatInput.tsx, MessageBubble.tsx, FileWorkspace.tsx) are fixed.
      // Kept as "warn" to avoid blocking the lint pipeline (SubTask 34.2).
      "react-hooks/exhaustive-deps": "warn",
      // v1.0.7: 禁止显式 any. 测试文件 (vi.fn / mockImplementation) 在
      // 下面 __tests__ 段单独覆盖
      "@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: true }],
    },
  },
  {
    files: ["src/main/**/*.ts", "extensions/**/*.ts"],
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
  {
    // v1.0.7: 测试文件 (vi.fn / mockImplementation 标准用法) 豁免 no-explicit-any.
    // 后续可逐步替换为 unknown / Mock 包装.
    files: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx", "src/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
