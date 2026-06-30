import React, { useCallback, useRef } from "react";
import Editor, { loader, type OnMount, type OnChange } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useSettingsStore } from "../../stores/settings-store";
import { getEditorFontSize } from "../../utils/theme";
import { useI18n } from "../../i18n";

loader.config({ monaco });

interface PiDesktopE2EMonacoHandle {
  focus: () => void;
  getValue: () => string;
  replaceAll: (value: string) => void;
  setValue: (value: string) => void;
}

declare global {
  interface Window {
    __PI_DESKTOP_E2E_MONACO__?: PiDesktopE2EMonacoHandle;
  }
}

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  className?: string;
  height?: string;
}

function shouldExposeE2EHandle(): boolean {
  try {
    return window.localStorage.getItem("pi-desktop:e2e") === "true";
  } catch {
    return false;
  }
}

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    ps1: "powershell",
    sql: "sql",
    graphql: "graphql",
    dockerfile: "dockerfile",
  };
  return languageMap[ext ?? ""] ?? "plaintext";
}

export const MonacoEditor = React.memo(function MonacoEditor({
  value,
  language,
  readOnly = false,
  onChange,
  onSave,
  className,
  height = "400px",
}: MonacoEditorProps): React.JSX.Element {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const fontSize = useSettingsStore((state) => state.settings.fontSize);
  const showLineNumbers = useSettingsStore((state) => state.settings.showLineNumbers);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const editorFontSize = getEditorFontSize(fontSize);
  const { t } = useI18n();

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      if (shouldExposeE2EHandle()) {
        window.__PI_DESKTOP_E2E_MONACO__ = {
          focus: () => editor.focus(),
          getValue: () => editor.getValue(),
          replaceAll: (nextValue) => {
            const model = editor.getModel();
            if (!model) {
              editor.setValue(nextValue);
              return;
            }
            editor.executeEdits("pi-desktop-e2e", [{
              range: model.getFullModelRange(),
              text: nextValue,
              forceMoveMarkers: true,
            }]);
            onChange?.(nextValue);
          },
          setValue: (nextValue) => {
            editor.setValue(nextValue);
            onChange?.(nextValue);
          },
        };
      }

      // 添加保存快捷键
      if (onSave) {
        editor.addAction({
          id: "save-file",
          label: t("editor.saveFile"),
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          run: () => {
            onSave();
          },
        });
      }

      // 聚焦编辑器
      editor.focus();
    },
    [onChange, onSave, t],
  );

  const handleChange: OnChange = useCallback(
    (value) => {
      onChange?.(value ?? "");
    },
    [onChange],
  );

  return (
    <div className={className}>
      <Editor
        height={height}
        width="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: editorFontSize,
          lineHeight: Math.round(editorFontSize * 1.55),
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
          editContext: false,
          lineNumbers: showLineNumbers ? "on" : "off",
          wordWrap: wordWrap ? "on" : "off",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
          insertSpaces: true,
        }}
        theme="vs-dark"
        loading={
          <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">
            {t("editor.loading")}
          </div>
        }
      />
    </div>
  );
});

export { getLanguageFromFilename };
