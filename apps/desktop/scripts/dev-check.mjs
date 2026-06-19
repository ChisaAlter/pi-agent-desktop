import { execSync } from 'node:child_process';

const checks = [
  {
    name: 'Node >= 22.19',
    test: () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      return major > 22 || (major === 22 && minor >= 19);
    },
  },
  {
    name: 'Pi CLI on PATH',
    test: () => {
      try {
        execSync('pi --version', { stdio: 'ignore', shell: process.platform === 'win32' });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    name: 'git installed',
    test: () => {
      try {
        execSync('git --version', { stdio: 'ignore', shell: process.platform === 'win32' });
        return true;
      } catch {
        return false;
      }
    },
  },
];

let failed = false;
for (const c of checks) {
  const ok = c.test();
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\nMissing prerequisites. See README.md');
  process.exit(1);
}
console.log('\nAll prerequisites OK');
