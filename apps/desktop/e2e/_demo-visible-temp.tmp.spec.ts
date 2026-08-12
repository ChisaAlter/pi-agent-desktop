import { test } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { _electron } from '@playwright/test';
import { getWindowByUrl } from './support/electron-windows';

test('visible herdr GUI demo', async () => {
  test.setTimeout(600000);
  const workspacePath = test.info().outputPath('visible-demo-workspace');
  const userData = test.info().outputPath('visible-demo-user-data');
  mkdirSync(workspacePath, { recursive: true });
  const app = await _electron.launch({
    executablePath: process.env.PI_DESKTOP_ELECTRON_EXECUTABLE_PATH!,
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
  console.log('VISIBLE_DEMO_READY');
  await new Promise<void>(() => {});
});
