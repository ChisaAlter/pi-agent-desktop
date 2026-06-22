import React, { useCallback, useRef } from "react";
import Editor, { type OnMount, type OnChange } from "@monaco-editor/react";
import { useSettingsStore } from "../../stores/settings-store";
import { getEditorFontSize } from "../../utils/theme";

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  className?: string;
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
}: MonacoEditorProps): React.JSX.Element {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const fontSize = useSettingsStore((state) => state.settings.fontSize);
  const editorFontSize = getEditorFontSize(fontSize);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // 添加保存快捷键
      if (onSave) {
        editor.addAction({
          id: "save-file",
          label: "保存文件",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          run: () => {
            onSave();
          },
        });
      }

      // 聚焦编辑器
      editor.focus();
    },
    [onSave],
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
        height="100%"
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
          wordWrap: "on",
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
            加载编辑器...
          </div>
        }
      />
    </div>
  );
});

export { getLanguageFromFilename };
