import { ipcMain } from 'electron';
import type { PiDriver } from '../pi-driver';
import { withPiDriver } from './helpers';

export function setupPiDriverIpc(getPiDriver: () => PiDriver | null): void {
  ipcMain.handle('pi:status', async () => {
    return withPiDriver(getPiDriver, {
      failedErrorKey: 'ipcErrors.pi.detectFailed',
      failedLabel: 'Pi 状态检测失败',
      logTag: '[pi-driver.ipc] pi:status failed:',
    }, async (driver) => driver.detectSync());
  });

  ipcMain.handle('pi:refresh-status', async () => {
    return withPiDriver(getPiDriver, {
      failedErrorKey: 'ipcErrors.pi.detectFailed',
      failedLabel: 'Pi 状态检测失败',
      logTag: '[pi-driver.ipc] pi:refresh-status failed:',
    }, (driver) => driver.detect());
  });

  ipcMain.handle('pi:install', async () => {
    return withPiDriver(getPiDriver, {
      failedErrorKey: 'ipcErrors.pi.installFailed',
      failedLabel: '安装 Pi CLI 失败',
      logTag: '[pi-driver.ipc] pi:install failed:',
    }, async (driver) => {
      await driver.install();
      return driver.detectSync();
    });
  });

  ipcMain.handle('pi:update', async () => {
    return withPiDriver(getPiDriver, {
      failedErrorKey: 'ipcErrors.pi.updateFailed',
      failedLabel: '更新 Pi CLI 失败',
      logTag: '[pi-driver.ipc] pi:update failed:',
    }, async (driver) => {
      await driver.update();
      return driver.detectSync();
    });
  });

  ipcMain.handle('pi:uninstall', async () => {
    return withPiDriver(getPiDriver, {
      failedErrorKey: 'ipcErrors.pi.uninstallFailed',
      failedLabel: '卸载 Pi CLI 失败',
      logTag: '[pi-driver.ipc] pi:uninstall failed:',
    }, async (driver) => {
      await driver.uninstall();
      return driver.detectSync();
    });
  });

  ipcMain.handle('pi:cancel-operation', async () => {
    getPiDriver()?.cancelOperation();
  });
}
