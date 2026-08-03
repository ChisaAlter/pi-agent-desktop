#!/usr/bin/env node
'use strict';

/**
 * Read-only, offline verification for the current documentation contract.
 * It derives version/runtime counts from checked-in source and never writes files,
 * runs commands, starts Electron, or uses the network.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    failures.push(`${relativePath}: cannot read (${error.message})`);
    return '';
  }
}

function requireText(haystack, needle, label) {
  if (!haystack.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function requireMatch(haystack, pattern, label) {
  if (!pattern.test(haystack)) failures.push(`${label}: missing ${pattern}`);
}

function countIpcModules() {
  const ipcDir = path.join(root, 'apps', 'desktop', 'src', 'main', 'ipc');
  try {
    return fs.readdirSync(ipcDir).filter((name) => name.endsWith('.ipc.ts')).length;
  } catch (error) {
    failures.push(`apps/desktop/src/main/ipc: cannot enumerate (${error.message})`);
    return -1;
  }
}

const rootPackage = JSON.parse(read('package.json') || '{}');
const desktopPackage = JSON.parse(read('apps/desktop/package.json') || '{}');
const ci = read('.github/workflows/ci.yml');
const mainIndex = read('apps/desktop/src/main/index.ts');
const sqliteRepository = read('apps/desktop/src/main/services/sqlite-session-repository.ts');
const composeWorkflow = read('apps/desktop/extensions/compose-mode/compose-workflow.ts');
const composeTool = read('apps/desktop/extensions/compose-mode/workflow-tool.ts');
const isolationRunbook = read('docs/testing/nsis-isolation-runbook.md');

const version = rootPackage.version;
if (version !== desktopPackage.version) {
  failures.push(`package versions differ: root=${version}, desktop=${desktopPackage.version}`);
}
if (version !== '1.0.14') failures.push(`source version is ${version}, expected 1.0.14`);
if (desktopPackage.devDependencies?.electron !== '41.2.0') {
  failures.push(`desktop Electron is ${desktopPackage.devDependencies?.electron}, expected 41.2.0`);
}

const ipcCount = countIpcModules();
if (ipcCount !== 24) failures.push(`IPC module count is ${ipcCount}, expected 24`);
requireText(sqliteRepository, 'from "node:sqlite"', 'SQLite repository');
requireText(sqliteRepository, 'class SqliteSessionRepository', 'SQLite repository');
requireText(mainIndex, 'SqliteSessionRepository', 'main persistence wiring');
requireText(mainIndex, "app.getPath('userData')", 'main userData wiring');
for (const phase of ['Brainstorm', 'Design', 'Implement', 'Verify', 'Review', 'Report', 'Merge']) {
  requireText(composeWorkflow, `"${phase}"`, `Compose phase ${phase}`);
}
requireText(composeTool, 'name: "workflow"', 'Compose workflow tool');
requireText(composeTool, 'Currently only `compose` is supported.', 'Compose built-in workflow boundary');
for (const command of [
  'pnpm -r typecheck',
  'pnpm -r lint',
  'pnpm -r test',
  'pnpm --filter @pi-desktop/desktop test:coverage',
  'pnpm verify:docs',
  'pnpm --filter @pi-desktop/desktop build',
  'node scripts/smoke-main-runtime.cjs',
]) {
  requireText(ci, command, `CI command ${command}`);
}
requireText(isolationRunbook, '**BLOCKED**', 'NSIS isolation status');
requireText(isolationRunbook, 'WindowsSandbox.exe', 'NSIS isolation capability');

const currentPaths = [
  'docs/current/facts.md',
  'docs/current/architecture.md',
  'docs/current/persistence.md',
  'docs/current/testing-and-qa.md',
  'docs/security/PERMISSION-MATRIX.md',
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/RELEASE-AND-AUTO-UPDATE.md',
];
const currentText = currentPaths.map((relativePath) => `${relativePath}\n${read(relativePath)}`).join('\n');
const staleTerms = [
  '1.0.11',
  '1.0.12',
  '1.0.13',
  'Electron 34',
  'Electron 35',
  'better-sqlite3',
  '23 IPC',
  'workflow as unsupported',
  'not a real workflow runtime',
];
for (const term of staleTerms) {
  if (currentText.includes(term)) failures.push(`current documentation contains stale term ${JSON.stringify(term)}`);
}
for (const relativePath of currentPaths) {
  read(relativePath);
}
requireText(read('docs/current/facts.md'), '1.0.14', 'facts version');
requireText(read('docs/current/facts.md'), 'Electron | `41.2.0`', 'facts Electron version');
requireText(read('docs/current/facts.md'), '24', 'facts IPC count');
requireText(read('docs/current/facts.md'), 'node:sqlite', 'facts persistence driver');
requireText(read('docs/current/facts.md'), 'NSIS isolation gate is currently blocked', 'facts NSIS blocker');
requireText(read('docs/current/facts.md'), 'Compose is implemented', 'facts Compose status');
requireText(read('docs/current/architecture.md'), 'Electron', 'architecture runtime boundary');
requireText(read('docs/current/persistence.md'), 'SqliteSessionRepository', 'persistence repository');
requireText(read('docs/current/testing-and-qa.md'), 'CI now runs the repository gate, coverage, documentation facts, desktop build, and main-runtime smoke', 'QA CI boundary');
requireText(read('docs/security/PERMISSION-MATRIX.md'), 'Plan mode', 'permission matrix Plan mode');

// CHANGELOG is intentionally historical below the current release. Verify the
// current Unreleased entry and the latest release header, not old entries.
const changelog = read('CHANGELOG.md');
const latestReleaseIndex = changelog.indexOf('## [1.0.14]');
if (latestReleaseIndex < 0) {
  failures.push('CHANGELOG: missing latest release header 1.0.14');
} else {
  const changelogCurrent = changelog.slice(0, latestReleaseIndex);
  requireText(changelogCurrent, 'Unified current architecture', 'CHANGELOG Unreleased documentation entry');
  if (/Electron 35|Electron 34|1\.0\.1[123]/.test(changelogCurrent)) {
    failures.push('CHANGELOG current section contains a stale version/Electron term');
  }
}

if (failures.length > 0) {
  process.stderr.write(`verify:docs failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`verify:docs passed: version ${version}, Electron ${desktopPackage.devDependencies.electron}, ${ipcCount} IPC modules; current docs are consistent.\n`);
}
