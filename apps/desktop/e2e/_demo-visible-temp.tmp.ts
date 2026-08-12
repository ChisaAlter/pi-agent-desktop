import { _electron } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { resolveElectronExecutablePath } from './support/electron-launch';
import { getWindowByUrl } from './support/electron-windows';

const userData = join(process.cwd(), 'e2e-output', 'visible-demo-user-data');
const workspacePath = join(process.cwd(), 'e2e-output', 'visible-demo-workspace');
mkdirSync(workspacePath, { recursive: true });
const app = await _electron.launch({
  executablePath: resolveElectronExecutablePath(),
  args: [`--user-data-dir=${userData}`],
  env: { ...process.env, CI: '1' },
});
const page = await getWindowByUrl(app, 'index.html');
await page.waitForLoadState('domcontentloaded');
const onboarding = page.locator('[data-testid="onboarding-modal"]');
if (await onboarding.count()) await page.getByRole('button', { name: '跳过引导' }).click();
await page.evaluate(async (path) => {
  localStorage.setItem('pi-desktop:firstLaunchDone', 'true');
  localStorage.setItem('pi-desktop.onboarding.completed', 'true');
  const ws = await window.piAPI.createWorkspace('herdr 演示项目', path);
  await window.piAPI.selectWorkspace(ws.path);
  await window.piAPI.agentsCreate({ workspaceId: ws.id, title: '分析 Agent' });
  await window.piAPI.agentsCreate({ workspaceId: ws.id, title: '实现 Agent' });
}, workspacePath);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-mmcode-tab="agents"]').click();
console.log('演示已打开：Agents 舰队，已创建两个空闲 Agent。');
await new Promise(() => {});
