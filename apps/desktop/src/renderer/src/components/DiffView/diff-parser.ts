// Unified Diff Parser - 纯手写解析器，无外部依赖

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
}

export interface ParsedDiff {
  files: DiffFile[];
}

/**
 * 解析 unified diff 字符串
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测文件头部: diff --git a/... b/...
    if (line.startsWith('diff --git')) {
      // 保存之前的文件
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = {
        oldPath: '',
        newPath: '',
        hunks: [],
        additions: 0,
        deletions: 0,
        isNew: false,
        isDeleted: false,
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    // --- 行
    if (line.startsWith('--- ')) {
      const path = line.slice(4);
      currentFile.oldPath = path === '/dev/null' ? '' : path.replace(/^a\//, '');
      currentFile.isDeleted = path === '/dev/null';
      continue;
    }

    // +++ 行
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      currentFile.newPath = path === '/dev/null' ? '' : path.replace(/^b\//, '');
      currentFile.isNew = path === '/dev/null' || currentFile.oldPath === '/dev/null';
      // 如果 newPath 为空但 oldPath 有值，使用 oldPath
      if (!currentFile.newPath && currentFile.oldPath) {
        currentFile.newPath = currentFile.oldPath;
      }
      if (!currentFile.oldPath && currentFile.newPath) {
        currentFile.oldPath = currentFile.newPath;
      }
      continue;
    }

    // @@ -x,y +x,y @@ header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (hunkMatch) {
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        header: hunkMatch[5] ? hunkMatch[5].trim() : '',
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    // 删除行
    if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'remove',
        oldLine: oldLineNum,
        newLine: null,
        content: line.slice(1),
      });
      oldLineNum++;
      currentFile.deletions++;
      continue;
    }

    // 新增行
    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'add',
        oldLine: null,
        newLine: newLineNum,
        content: line.slice(1),
      });
      newLineNum++;
      currentFile.additions++;
      continue;
    }

    // 上下文行（以空格开头或无前缀）
    if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'context',
        oldLine: oldLineNum,
        newLine: newLineNum,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
      oldLineNum++;
      newLineNum++;
      continue;
    }

    // 跳过其他行（如 git diff 的 index 行、mode 行等）
  }

  // 保存最后一个文件
  if (currentFile) {
    files.push(currentFile);
  }

  return { files };
}

/**
 * 从输出中提取 diff 内容
 * 支持多种格式：纯 diff、JSON 包含 diff 字段等
 */
export function extractDiffFromOutput(output: string): string | null {
  if (!output) return null;

  // 尝试解析为 JSON
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null) {
      if (parsed.diff && typeof parsed.diff === 'string') {
        return parsed.diff;
      }
      if (parsed.patch && typeof parsed.patch === 'string') {
        return parsed.patch;
      }
      // 如果 output 本身就是一个包含 diff 字段的 JSON
      if (typeof parsed === 'string') {
        return extractDiffFromOutput(parsed);
      }
    }
  } catch {
    // 不是 JSON，当作原始 diff 文本
  }

  // 检查是否是 unified diff 格式
  if (output.includes('@@') && (output.includes('---') || output.includes('+++'))) {
    return output;
  }

  return null;
}
