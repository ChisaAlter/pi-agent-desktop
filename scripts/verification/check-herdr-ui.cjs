#!/usr/bin/env node
'use strict';

/**
 * Herdr GUI 防降级检查器（只读、离线，不写文件）
 *
 * 依据 docs/verification/herdr-ui-requirements.yml 强制执行：
 *   1. 需求 ID 集合必须与内建 canonical 集合完全一致（增删都 FAIL）
 *   2. status 取值合法；BLOCKED 必须带 blocked_reason
 *   3. PASS 必须提供 evidence 文件且存在、非空
 *   4. 负面清单（negative_list）文本可扫项逐条扫描，命中即 FAIL
 *      —— 语义是防「已实现功能」降级：仅当对应需求 status ∈ IN_PROGRESS/PASS 时扫描
 *   5. i18n en/zh-CN 键集必须一致（NL-012，结构性，始终扫描）
 *   6. PROTOTYPE_MOCK 标记只允许出现在 herdr-mock 文件中（NL-010，始终扫描）
 *   7. real-runtime 证据不得来自 mock 路径（NL-015）
 *
 * 退出码：
 *   0  无硬违规（BLOCKED 存在时报告「未完成」但不视为失败，见下）
 *   1  存在硬违规（负面清单命中 / 结构非法 / PASS 证据缺失 / 需求增删）
 *
 * BLOCKED 语义：存在 BLOCKED 需求时整体报告「未完成」，禁止汇总为 PASS
 * （计划 §3.2）。默认退出码 0 仅表示"无硬违规"，报告必须读文案；
 * --strict 模式将 BLOCKED 视为失败（G5 完成门使用）。
 *
 * 用法：
 *   node scripts/verification/check-herdr-ui.cjs            # 常规检查
 *   node scripts/verification/check-herdr-ui.cjs --strict   # BLOCKED 视为失败
 *   node scripts/verification/check-herdr-ui.cjs --self-test # 内部断言（G0 门）
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const REQUIREMENTS_FILE = path.join(root, 'docs/verification/herdr-ui-requirements.yml');
const RENDERER_SRC = path.join(root, 'apps/desktop/src/renderer/src');

// js-yaml 可能被 pnpm 提升到工作区根或保留在 apps/desktop
function loadYaml() {
  try {
    return require('js-yaml');
  } catch {
    return require(path.join(root, 'apps/desktop/node_modules/js-yaml'));
  }
}
const yaml = loadYaml();

/** canonical 需求 ID 集合（来源：实现计划 A-H 需求表，41 条）。 */
const CANONICAL_IDS = [
  'UI-REQ-001', 'UI-REQ-002', 'UI-REQ-003', 'UI-REQ-004',
  'UI-REQ-010', 'UI-REQ-011', 'UI-REQ-012', 'UI-REQ-013', 'UI-REQ-014',
  'UI-REQ-020', 'UI-REQ-021', 'UI-REQ-022', 'UI-REQ-023', 'UI-REQ-024',
  'UI-REQ-025', 'UI-REQ-026', 'UI-REQ-027',
  'UI-REQ-030', 'UI-REQ-031', 'UI-REQ-032', 'UI-REQ-033', 'UI-REQ-034', 'UI-REQ-035',
  'UI-REQ-040', 'UI-REQ-041', 'UI-REQ-042', 'UI-REQ-043', 'UI-REQ-044', 'UI-REQ-045',
  'UI-REQ-050', 'UI-REQ-051', 'UI-REQ-052', 'UI-REQ-053',
  'UI-REQ-060', 'UI-REQ-061', 'UI-REQ-062', 'UI-REQ-063', 'UI-REQ-064', 'UI-REQ-065',
  'UI-REQ-070', 'UI-REQ-071',
];

/** 负面清单扫描对应的需求门（status ∈ IN_PROGRESS/PASS 才扫描）。 */
const NL_GATES = {
  'NL-002/NL-065': 'UI-REQ-002',
  'NL-003': 'UI-REQ-022',
  'NL-005': 'UI-REQ-001',
  'NL-006': 'UI-REQ-060',
};

const STATUSES = new Set(['NOT_RUN', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED']);
const EVIDENCE_CLASSES = new Set([
  'interaction-test', 'visual-diff', 'negative-check', 'real-runtime', 'package-acceptance',
]);

const failures = [];
const warnings = [];
const scannedDirs = new Set();

function readFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 收集一个目录下所有 ts/tsx 文件内容（带相对路径标签）。 */
function collectSources(dir, label) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const file of walk(dir, [])) {
    out.push({ label: path.relative(root, file).replace(/\\/g, '/'), content: readFile(file) ?? '' });
  }
  scannedDirs.add(label);
  return out;
}

function fail(msg) {
  failures.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function isActive(statusById, reqId) {
  return statusById.get(reqId) === 'IN_PROGRESS' || statusById.get(reqId) === 'PASS';
}

/** 负面清单源码扫描。可注入临时目录与状态表做自测。 */
function scanNegativeList(opts = {}) {
  const statusById = opts.statusById ?? new Map();
  const rendererDir = opts.rendererDir ?? RENDERER_SRC;
  const herdrDir = opts.herdrDir ?? path.join(rendererDir, 'components/Herdr');
  const agentsDir = opts.agentsDir ?? path.join(rendererDir, 'components/Agents');
  const allActive = opts.allActive ?? false;
  const gate = (reqId) => (allActive ? true : isActive(statusById, reqId));

  // NL-002: 状态条不得出现 检查更新/验证/切换 按钮（只扫 HerdrStatusBar ——
  // 裸词「切换」在布局/视图切换语境是合法文案，不在此扫描）。
  // NL-065: 主界面不得出现更新/验证/切换类操作 —— 用 data-action 模式（含
  // switch-update 覆盖「切换」语义）+ 检查更新/验证 两个歧义较低的词。
  // 排除 HerdrLayoutSwitcher（UI-REQ-003 要求的布局切换控件，语义无关）。
  if (gate('UI-REQ-002')) {
    const statusBar = path.join(herdrDir, 'HerdrStatusBar.tsx');
    const sbContent = readFile(statusBar);
    if (sbContent !== null) {
      for (const word of ['检查更新', '验证', '切换']) {
        if (sbContent.includes(word)) {
          fail(`NL-002 命中: HerdrStatusBar.tsx 出现「${word}」（状态条禁止更新/验证/切换按钮）`);
        }
      }
    }
    const herdrSources = collectSources(herdrDir, 'Herdr').filter(({ label }) => !/HerdrLayoutSwitcher\.tsx$/.test(label));
    const actionPattern = /data-action="(check-update|verify-update|switch-update)"/;
    for (const { label, content } of herdrSources) {
      for (const word of ['检查更新', '验证']) {
        if (content.includes(word)) {
          fail(`NL-065 命中: ${label} 出现「${word}」（主界面禁止更新/验证按钮，收敛设置）`);
        }
      }
      const m = content.match(actionPattern);
      if (m) {
        fail(`NL-065 命中: ${label} 出现 data-action="${m[1]}"（等价更新/验证/切换操作，收敛设置）`);
      }
    }
  }

  // NL-003: 卡片彩色侧边框
  if (gate('UI-REQ-022')) {
    const agentsSources = collectSources(agentsDir, 'Agents');
    let cardFound = false;
    for (const { label, content } of agentsSources) {
      if (!/AgentCard\.tsx$/.test(label)) continue;
      cardFound = true;
      if (/border-l-/.test(content) || /borderLeft/.test(content)) {
        fail(`NL-003 命中: ${label} 出现 border-l-*/borderLeft（卡片禁止彩色侧边框）`);
      }
    }
    if (!cardFound) {
      fail(`NL-003: 门已开（UI-REQ-022）但 AgentCard.tsx 不存在（静默放行风险）`);
    }
  }

  // NL-005: 「智能体」与「任务编排」两个 tab 必须都在（TopTabBar 结构扫描）
  if (gate('UI-REQ-001')) {
    const topTabBar = path.join(rendererDir, 'components/TopTabBar/TopTabBar.tsx');
    const topTabContent = readFile(topTabBar);
    if (topTabContent === null) {
      fail(`NL-005: 门已开（UI-REQ-001）但 TopTabBar.tsx 不存在（静默放行风险）`);
    } else if (!/\bmission\b/.test(topTabContent)) {
      fail(`NL-005 命中: TopTabBar.tsx 缺失 mission tab（任务编排）`);
    }
  }

  // NL-006: 设置做成弹窗/对话框（原型 modal 类名不得进入生产）
  if (gate('UI-REQ-060')) {
    const rendererSources = collectSources(rendererDir, 'renderer');
    for (const { label, content } of rendererSources) {
      if (/settings-modal|settings-dialog/.test(content)) {
        fail(`NL-006 命中: ${label} 出现 settings-modal/settings-dialog（设置必须为设置窗口内 tab）`);
      }
    }
  }

  // NL-010: PROTOTYPE_MOCK 只允许在 herdr-mock 文件中（结构性，始终扫描）
  {
    const rendererSources = collectSources(rendererDir, 'renderer');
    for (const { label, content } of rendererSources) {
      if (content.includes('PROTOTYPE_MOCK') && !/herdr-mock/.test(label)) {
        fail(`NL-010 命中: ${label} 含 PROTOTYPE_MOCK 标记但文件名不含 herdr-mock（mock 必须隔离）`);
      }
    }
  }
}

/** i18n 键集同步（NL-012，结构性，始终扫描）：en/zh-CN 扁平键集必须一致。 */
function checkI18nSync(rendererDir = RENDERER_SRC) {
  const localesDir = path.join(rendererDir, 'i18n/locales');
  const enPath = path.join(localesDir, 'en.json');
  const zhPath = path.join(localesDir, 'zh-CN.json');
  const en = readFile(enPath);
  const zh = readFile(zhPath);
  if (en === null || zh === null) {
    fail(`NL-012: i18n locales 缺失（en.json/zh-CN.json 必须成对存在）`);
    return;
  }
  const flatten = (obj, prefix = '') => {
    const keys = [];
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') keys.push(...flatten(v, key));
      else keys.push(key);
    }
    return keys;
  };
  const enKeys = new Set(flatten(JSON.parse(en)));
  const zhKeys = new Set(flatten(JSON.parse(zh)));
  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
  if (missingInZh.length) fail(`NL-012 命中: zh-CN.json 缺 ${missingInZh.length} 个 en.json 键（前 5: ${missingInZh.slice(0, 5).join(', ')}）`);
  if (missingInEn.length) fail(`NL-012 命中: en.json 缺 ${missingInEn.length} 个 zh-CN.json 键（前 5: ${missingInEn.slice(0, 5).join(', ')}）`);
}

/** 校验需求表本体。返回 statusById。 */
function checkRequirements(doc, strict) {
  const statusById = new Map();
  if (!doc || !Array.isArray(doc.requirements)) {
    fail('requirements.yml: 缺少 requirements 数组');
    return statusById;
  }
  const ids = new Set(doc.requirements.map((r) => r.id));
  for (const canonical of CANONICAL_IDS) {
    if (!ids.has(canonical)) fail(`需求缺失: ${canonical}（计划登记的需求被删除，需变更控制）`);
  }
  for (const r of doc.requirements) {
    statusById.set(r.id, r.status);
    if (!CANONICAL_IDS.includes(r.id)) {
      fail(`未知需求 ID: ${r.id}（不在 canonical 集合内）`);
      continue;
    }
    if (!STATUSES.has(r.status)) {
      fail(`${r.id}: 非法 status ${JSON.stringify(r.status)}`);
      continue;
    }
    if (!EVIDENCE_CLASSES.has(r.evidence_class)) {
      fail(`${r.id}: 非法 evidence_class ${JSON.stringify(r.evidence_class)}`);
    }
    if (r.status === 'BLOCKED' && !r.blocked_reason) {
      fail(`${r.id}: BLOCKED 必须提供 blocked_reason`);
    }
    if (r.status === 'PASS') {
      const evidence = Array.isArray(r.evidence) ? r.evidence : [];
      if (evidence.length === 0) {
        fail(`${r.id}: PASS 必须提供 evidence 文件列表`);
        continue;
      }
      for (const ev of evidence) {
        const abs = path.join(root, ev);
        if (!fs.existsSync(abs)) {
          fail(`${r.id}: PASS 证据缺失 ${ev}`);
        } else if (fs.statSync(abs).size < 64) {
          fail(`${r.id}: PASS 证据疑似占位（${fs.statSync(abs).size} bytes < 64）: ${ev}`);
        }
        if (r.evidence_class === 'real-runtime' && /mock|prototype/i.test(ev)) {
          fail(`NL-015 命中: ${r.id} real-runtime 证据来自 mock/原型路径 ${ev}`);
        }
      }
    }
    // F4: IN_PROGRESS/PASS 需求的 files/tests 引用必须真实存在（防幽灵引用）
    if (r.status === 'IN_PROGRESS' || r.status === 'PASS') {
      for (const f of Array.isArray(r.files) ? r.files : []) {
        if (!fs.existsSync(path.join(root, f))) fail(`${r.id}: files 引用不存在 ${f}`);
      }
      for (const t of Array.isArray(r.tests) ? r.tests : []) {
        if (!fs.existsSync(path.join(root, t))) fail(`${r.id}: tests 引用不存在 ${t}`);
      }
    }
  }
  const blocked = doc.requirements.filter((r) => r.status === 'BLOCKED');
  if (blocked.length) {
    const idsBlocked = blocked.map((r) => r.id).join(', ');
    if (strict) fail(`未完成: ${blocked.length} 条 BLOCKED（${idsBlocked}）`);
    else warn(`未完成: ${blocked.length} 条 BLOCKED（${idsBlocked}）— 禁止汇总为 PASS`);
  }
  return statusById;
}

/** --self-test: 用临时 fixture 断言检查器自身会 FAIL（G0 门）。 */
function selfTest() {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-check-'));
  const results = [];
  const record = (label, ok) => results.push(`${ok ? '✓' : '✗'} ${label}`);

  /**
   * 生成包含全部 41 条 canonical ID 的合法 fixture 文档，再覆写目标条目。
   * 关键：fixture 基线与 canonical 一致（否则"需求缺失"本身就会让 failures
   * 增长，导致被测检查即使失效也"通过"——真空演示）。
   */
  const makeFullYml = (override) => {
    const lines = ['requirements:'];
    for (const id of CANONICAL_IDS) {
      if (override && override.id === id) {
        lines.push(`  - id: ${id}`);
        for (const [k, v] of Object.entries(override)) {
          if (k === 'id') continue;
          lines.push(`    ${k}: ${typeof v === 'string' && /[\s:]/.test(v) ? JSON.stringify(v) : v}`);
        }
      } else {
        lines.push(
          `  - id: ${id}`,
          '    status: NOT_RUN',
          '    evidence_class: interaction-test',
        );
      }
    }
    const file = path.join(tmpDir, `requirements-${override?.id ?? 'base'}.yml`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  };
  // 断言：目标违规必须被捕获（failures 增长）；基线条目自身合法。
  const expectCaught = (label, fn) => {
    const before = failures.length;
    fn();
    record(label, failures.length > before);
  };
  // 断言：合法文档（全部 41 条 NOT_RUN + BLOCKED 带理由）不得产生违规。
  const expectClean = (label, fn) => {
    const before = failures.length;
    fn();
    record(label, failures.length === before);
  };

  // T1: 假 PASS（证据文件不存在）必须 FAIL
  const t1 = makeFullYml({
    id: 'UI-REQ-001', status: 'PASS', evidence_class: 'interaction-test',
    evidence: '["no/such/evidence/file.png"]',
  });
  expectCaught('T1 假 PASS（证据缺失）', () => {
    checkRequirements(yaml.load(fs.readFileSync(t1, 'utf8')), false);
  });

  // T2: 删除 canonical 需求 ID 必须 FAIL（从全量文档中移除一条）
  {
    const doc = yaml.load(fs.readFileSync(makeFullYml(null), 'utf8'));
    doc.requirements = doc.requirements.filter((r) => r.id !== 'UI-REQ-044');
    const before = failures.length;
    checkRequirements(doc, false);
    record('T2 需求被删除（UI-REQ-044 移除）', failures.length > before);
  }

  // T3: BLOCKED 无理由必须 FAIL（其余 40 条合法，证明是理由缺失触发）
  const t3 = makeFullYml({
    id: 'UI-REQ-001', status: 'BLOCKED', evidence_class: 'real-runtime',
  });
  expectCaught('T3 BLOCKED 无 blocked_reason', () => {
    checkRequirements(yaml.load(fs.readFileSync(t3, 'utf8')), false);
  });

  // T3b: BLOCKED 带理由且其余合法 → 不得报违规（非 strict 模式）
  const t3b = makeFullYml({
    id: 'UI-REQ-001', status: 'BLOCKED', evidence_class: 'real-runtime',
    blocked_reason: '测试理由',
  });
  expectClean('T3b BLOCKED 带理由（非 strict）不误报', () => {
    checkRequirements(yaml.load(fs.readFileSync(t3b, 'utf8')), false);
  });

  // T4: NL-002 状态条按钮文案
  expectCaught('T4 NL-002 状态条出现「检查更新」', () => {
    const dir = path.join(tmpDir, 's4');
    fs.mkdirSync(path.join(dir, 'components/Herdr'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/Herdr/HerdrStatusBar.tsx'), 'export const b = <button>检查更新</button>;');
    scanNegativeList({ rendererDir: dir, allActive: true });
  });

  // T4b: NL-002 data-action 等价绕过（检查更新 的英文/属性形式）
  expectCaught('T4b NL-002 data-action=check-update 等价命中', () => {
    const dir = path.join(tmpDir, 's4b');
    fs.mkdirSync(path.join(dir, 'components/Herdr'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/Herdr/HerdrStatusBar.tsx'), 'export const b = <button data-action="check-update">Check Update</button>;');
    scanNegativeList({ rendererDir: dir, allActive: true });
  });

  // T5: NL-003 卡片彩边
  expectCaught('T5 NL-003 卡片 border-l 彩边', () => {
    const dir = path.join(tmpDir, 's5');
    fs.mkdirSync(path.join(dir, 'components/Agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/Agents/AgentCard.tsx'), 'className="border-l-2 border-red-500"');
    scanNegativeList({ rendererDir: dir, allActive: true });
  });

  // T6: NL-006 settings-modal
  expectCaught('T6 NL-006 settings-modal 类名', () => {
    const dir = path.join(tmpDir, 's6');
    fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/X.tsx'), 'className="settings-modal"');
    scanNegativeList({ rendererDir: dir, allActive: true });
  });

  // T7: NL-010 PROTOTYPE_MOCK 泄漏到非 mock 文件
  expectCaught('T7 NL-010 mock 标记泄漏', () => {
    const dir = path.join(tmpDir, 's7');
    fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/Real.tsx'), '// PROTOTYPE_MOCK 不能出现在这里');
    scanNegativeList({ rendererDir: dir, allActive: true });
  });

  // T8: 门控 — NOT_RUN 的需求不触发负面扫描（NL-005 在 Phase 1 前不误报）
  {
    const before = failures.length;
    const dir = path.join(tmpDir, 's8');
    fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/TopTabBar.tsx'), 'export const T = 1; // no mission yet');
    const statusById = new Map([['UI-REQ-001', 'NOT_RUN']]);
    scanNegativeList({ rendererDir: dir, statusById });
    record('T8 门控：NOT_RUN 不触发 NL-005', failures.length === before);
  }

  // T9: 门已开（IN_PROGRESS）但目标文件缺失 → 必须 FAIL（防静默放行）
  expectCaught('T9 门开但 TopTabBar.tsx 缺失', () => {
    const dir = path.join(tmpDir, 's9');
    fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
    scanNegativeList({ rendererDir: dir, statusById: new Map([['UI-REQ-001', 'IN_PROGRESS']]) });
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  const failed = results.filter((r) => r.startsWith('✗'));
  for (const r of results) console.log(r);
  if (failed.length) {
    console.error(`--self-test FAILED (${failed.length}/${results.length})`);
    process.exit(1);
  }
  console.log(`--self-test OK (${results.length}/${results.length})`);
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();
  const strict = args.includes('--strict');

  let statusById = new Map();
  const raw = readFile(REQUIREMENTS_FILE);
  if (raw === null) {
    fail(`无法读取 ${path.relative(root, REQUIREMENTS_FILE)}`);
  } else {
    statusById = checkRequirements(yaml.load(raw), strict);
  }

  scanNegativeList({ statusById });
  checkI18nSync();

  if (failures.length) {
    console.error(`✗ Herdr GUI 检查器: ${failures.length} 项硬违规`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (warnings.length) {
    for (const w of warnings) console.warn(`⚠ ${w}`);
  }
  const scanned = [...scannedDirs].join(', ');
  console.log(`✓ Herdr GUI 检查器: 需求表 ${CANONICAL_IDS.length} 条校验通过 · 负面清单 0 命中（扫描: ${scanned}）`);
  process.exit(0);
}

main();
