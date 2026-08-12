// 一次性脚本：G1 需求表状态更新（PASS + evidence + 路径修正），逐块精确替换并最终 YAML 校验
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
function loadYaml() {
  try {
    return require('js-yaml');
  } catch {
    return require(path.join(root, 'apps/desktop/node_modules/js-yaml'));
  }
}
const yaml = loadYaml();
const FILE = 'docs/verification/herdr-ui-requirements.yml';
let doc = fs.readFileSync(FILE, 'utf8');

// 1) 路径修正（tests 前缀 + mission-store 引用）
doc = doc.replace(/tests: \[e2e\//g, 'tests: [apps/desktop/e2e/');
doc = doc.replace(
  'apps/desktop/src/renderer/src/stores/herdr-mission-store.ts',
  'apps/desktop/src/renderer/src/stores/herdr-store.ts',
);

const passIds = [
  'UI-REQ-001', 'UI-REQ-002', 'UI-REQ-003', 'UI-REQ-004',
  'UI-REQ-010', 'UI-REQ-011', 'UI-REQ-012', 'UI-REQ-013',
  'UI-REQ-020', 'UI-REQ-021', 'UI-REQ-022', 'UI-REQ-023', 'UI-REQ-024',
  'UI-REQ-025', 'UI-REQ-026', 'UI-REQ-027',
  'UI-REQ-030', 'UI-REQ-031', 'UI-REQ-033', 'UI-REQ-034', 'UI-REQ-035',
  'UI-REQ-040', 'UI-REQ-041', 'UI-REQ-042', 'UI-REQ-043', 'UI-REQ-044',
  'UI-REQ-050', 'UI-REQ-051', 'UI-REQ-052', 'UI-REQ-053',
  'UI-REQ-065', 'UI-REQ-070', 'UI-REQ-071',
];
const evidenceByType = {
  'visual-diff': [
    'docs/verification/baselines/herdr/manifest.json',
    'docs/verification/herdr-shots/studio-fleet.png',
    'apps/desktop/e2e/herdr/prototype-parity/parity-visual.spec.ts',
  ],
  'negative-check': [
    'scripts/verification/check-herdr-ui.cjs',
    'docs/verification/herdr-ui-gates.yml',
  ],
  default: [
    'apps/desktop/e2e/herdr/prototype-parity/parity-flows.spec.ts',
    'docs/verification/herdr-ui-gates.yml',
  ],
};

function yamlList(items) {
  return '[' + items.map((i) => `'${i}'`).join(', ') + ']';
}

// 2) 逐块更新：状态行替换 + evidence 插入（在块内 tests/files 行之后）
for (const id of passIds) {
  const start = doc.indexOf(`  - id: ${id}`);
  if (start === -1) throw new Error(`未找到 ${id}`);
  const end = doc.indexOf('\n  - id:', start + 2);
  const block = doc.slice(start, end === -1 ? undefined : end);

  // 取 evidence_class
  const clsMatch = block.match(/\n    evidence_class: ([a-z-]+)/);
  const evidence = evidenceByType[clsMatch?.[1] ?? ''] ?? evidenceByType.default;

  // 状态 → PASS
  let updated = block.replace(/\n    status: (NOT_RUN|IN_PROGRESS)/, '\n    status: PASS');
  // 插入 evidence：放在 tests 行后（若存在），否则放在 status 行后
  const insertPoint = updated.indexOf('\n    tests:');
  const insert = `\n    evidence: ${yamlList(evidence)}`;
  if (insertPoint !== -1) {
    const lineEnd = updated.indexOf('\n', insertPoint + 1);
    updated = updated.slice(0, lineEnd) + insert + updated.slice(lineEnd);
  } else {
    updated = updated.replace(/\n    status: PASS/, `\n    status: PASS${insert}`);
  }
  doc = doc.slice(0, start) + updated + doc.slice(start + block.length);
}

// 3) 校验
const parsed = yaml.load(doc);
if (!parsed || !Array.isArray(parsed.requirements)) throw new Error('YAML 结构损坏');
const passCount = parsed.requirements.filter((r) => r.status === 'PASS').length;
for (const r of parsed.requirements) {
  if (r.status === 'PASS' && !Array.isArray(r.evidence)) throw new Error(`${r.id} PASS 缺 evidence`);
}
fs.writeFileSync(FILE, doc);
console.log(`更新完成: PASS=${passCount} / 总 ${parsed.requirements.length}`);
