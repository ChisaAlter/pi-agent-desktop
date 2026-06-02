/**
 * Pi Driver — Pi CLI 生命周期管理
 *
 * 职责：
 *  1. 自动检测本地 Pi CLI 安装（PATH / npm global / 常见路径）
 *  2. 获取本地版本 & 远程最新版本
 *  3. 安装 / 更新 / 卸载 Pi CLI（via npm）
 *  4. 读取 Pi Agent 配置（~/.pi/agent/）
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { EventEmitter } from 'events';

// ── 类型 ────────────────────────────────────────────────────────

export interface PiStatus {
  /** 是否已安装 */
  installed: boolean;
  /** 本地版本号 */
  localVersion: string | null;
  /** npm 远程最新版本 */
  latestVersion: string | null;
  /** 是否可更新 */
  updateAvailable: boolean;
  /** pi 可执行文件路径 */
  executablePath: string | null;
  /** 安装方式：'npm-global' | 'path' | 'unknown' */
  installMethod: string;
  /** ~/.pi/agent/ 配置是否存在 */
  configExists: boolean;
  /** 默认 provider */
  defaultProvider: string | null;
  /** 默认 model */
  defaultModel: string | null;
}

export interface PiInstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error';
  message: string;
  percent?: number;
}

export interface PiAgentModel {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface PiAgentConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    models: PiAgentModel[];
  }>;
}

// ── 常量 ────────────────────────────────────────────────────────

const PI_NPM_PACKAGE = '@earendil-works/pi-coding-agent';
const PI_AGENT_DIR = join(homedir(), '.pi', 'agent');

// Windows 上 npm global bin 的常见位置
const COMMON_PATHS = platform() === 'win32'
  ? [
      join(homedir(), 'AppData', 'Roaming', 'npm'),
      join(homedir(), 'AppData', 'Local', 'npm'),
      'C:\\Program Files\\nodejs',
    ]
  : [
      '/usr/local/bin',
      '/usr/bin',
      join(homedir(), '.npm-global', 'bin'),
      join(homedir(), '.local', 'bin'),
    ];

// ── 主类 ────────────────────────────────────────────────────────

export class PiDriver extends EventEmitter {
  private _cachedStatus: PiStatus | null = null;
  private npmProcess: ChildProcess | null = null;

  /** 获取上次检测的缓存状态 */
  get cachedStatus(): PiStatus | null {
    return this._cachedStatus;
  }

  constructor() {
    super();
  }

  // ── 检测 Pi CLI ──────────────────────────────────────────────

  /**
   * 检测本地 Pi CLI 安装状态
   * 检查顺序：PATH → npm global → 常见安装路径
   */
  async detect(): Promise<PiStatus> {
    const result: PiStatus = {
      installed: false,
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      executablePath: null,
      installMethod: 'unknown',
      configExists: false,
      defaultProvider: null,
      defaultModel: null,
    };

    // 1. 检查配置目录
    result.configExists = existsSync(PI_AGENT_DIR);

    // 2. 读取 Pi Agent 配置
    const config = this.loadConfig();
    if (config) {
      result.defaultProvider = config.defaultProvider;
      result.defaultModel = config.defaultModel;
    }

    // 3. 检测 pi 可执行文件
    const detection = this.findPiExecutable();
    if (detection) {
      result.installed = true;
      result.executablePath = detection.path;
      result.installMethod = detection.method;
      result.localVersion = this.getLocalVersion(detection.path);
    }

    // 4. 获取远程最新版本（异步，不阻塞）
    try {
      result.latestVersion = await this.getLatestVersion();
      if (result.localVersion && result.latestVersion) {
        result.updateAvailable = this.compareVersions(result.localVersion, result.latestVersion) < 0;
      }
    } catch (err) {
      console.warn('[PiDriver] Failed to fetch latest version:', err);
    }

    this._cachedStatus = result;
    return result;
  }

  /**
   * 快速检测（仅本地，不查远程版本）
   */
  detectSync(): PiStatus {
    const result: PiStatus = {
      installed: false,
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      executablePath: null,
      installMethod: 'unknown',
      configExists: existsSync(PI_AGENT_DIR),
      defaultProvider: null,
      defaultModel: null,
    };

    const config = this.loadConfig();
    if (config) {
      result.defaultProvider = config.defaultProvider;
      result.defaultModel = config.defaultModel;
    }

    const detection = this.findPiExecutable();
    if (detection) {
      result.installed = true;
      result.executablePath = detection.path;
      result.installMethod = detection.method;
      result.localVersion = this.getLocalVersion(detection.path);
    }

    this._cachedStatus = result;
    return result;
  }

  // ── 安装 / 更新 / 卸载 ──────────────────────────────────────

  /**
   * 安装 Pi CLI（npm install -g）
   */
  install(): Promise<void> {
    return this.npmCommand('install', 'installing');
  }

  /**
   * 更新 Pi CLI（npm update -g）
   */
  update(): Promise<void> {
    return this.npmCommand('update', 'updating');
  }

  /**
   * 卸载 Pi CLI（npm uninstall -g）
   */
  uninstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.emitProgress('downloading', '正在卸载 Pi CLI...');

      const npm = this.getNpmCommand();
      const args = ['uninstall', '-g', PI_NPM_PACKAGE];
      const child = spawn(npm, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: platform() === 'win32',
      });

      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          this._cachedStatus = null;
          this.emitProgress('done', 'Pi CLI 已卸载');
          resolve();
        } else {
          const msg = `卸载失败 (exit ${code}): ${stderr.trim()}`;
          this.emitProgress('error', msg);
          reject(new Error(msg));
        }
      });

      child.on('error', (err) => {
        this.emitProgress('error', `卸载出错: ${err.message}`);
        reject(err);
      });
    });
  }

  // ── 配置读取 ─────────────────────────────────────────────────

  /**
   * 读取 ~/.pi/agent/ 下的 Pi Agent 配置
   */
  loadConfig(): PiAgentConfig | null {
    try {
      if (!existsSync(PI_AGENT_DIR)) return null;

      // 扫描 providers 目录
      const providersDir = join(PI_AGENT_DIR, 'providers');
      const providers: PiAgentConfig['providers'] = [];

      if (existsSync(providersDir)) {
        const files = readdirSync(providersDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const content = readFileSync(join(providersDir, file), 'utf-8');
            const provider = JSON.parse(content);
            providers.push(provider);
          } catch {
            // skip malformed provider files
          }
        }
      }

      // 读取 settings
      const settingsPath = join(PI_AGENT_DIR, 'settings.json');
      let defaultProvider = '';
      let defaultModel = '';

      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          defaultProvider = settings.defaultProvider || settings.provider || '';
          defaultModel = settings.defaultModel || settings.model || '';
        } catch {
          // fallback
        }
      }

      // 如果没有 settings，从第一个 provider 推断
      if (!defaultProvider && providers.length > 0) {
        defaultProvider = providers[0].id || providers[0].name || '';
        const firstModel = providers[0].models?.[0];
        if (firstModel) defaultModel = firstModel.id || '';
      }

      return { defaultProvider, defaultModel, providers };
    } catch (err) {
      console.warn('[PiDriver] Failed to load config:', err);
      return null;
    }
  }

  // ── 内部方法 ─────────────────────────────────────────────────

  /**
   * 在 PATH 和常见路径中查找 pi 可执行文件
   */
  private findPiExecutable(): { path: string; method: string } | null {
    // 1. 用 which/where 检查 PATH
    try {
      const cmd = platform() === 'win32' ? 'where pi' : 'which pi';
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      const firstLine = result.split(/\r?\n/)[0].trim();
      if (firstLine && existsSync(firstLine)) {
        return { path: firstLine, method: 'path' };
      }
    } catch {
      // not in PATH, continue
    }

    // 2. 检查常见安装路径
    const piCmd = platform() === 'win32' ? 'pi.cmd' : 'pi';
    for (const dir of COMMON_PATHS) {
      const candidate = join(dir, piCmd);
      if (existsSync(candidate)) {
        return { path: candidate, method: 'npm-global' };
      }
    }

    // 3. 检查 node_modules/.bin（局部安装）
    const localBin = join(homedir(), 'node_modules', '.bin', piCmd);
    if (existsSync(localBin)) {
      return { path: localBin, method: 'npm-global' };
    }

    return null;
  }

  /**
   * 获取本地 pi 版本
   */
  private getLocalVersion(piPath: string): string | null {
    try {
      const output = execSync(`"${piPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      // 解析版本号（可能带 v 前缀）
      const match = output.match(/v?(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      // fallback: 尝试不带引号
      try {
        const output = execSync(`${piPath} --version`, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        const match = output.match(/v?(\d+\.\d+\.\d+)/);
        return match ? match[1] : output;
      } catch {
        return null;
      }
    }
  }

  /**
   * 从 npm registry 获取最新版本
   */
  private async getLatestVersion(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const npm = this.getNpmCommand();
      const child = spawn(npm, ['show', PI_NPM_PACKAGE, 'version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: platform() === 'win32',
        // @types/node 的 SpawnOptions 没有 timeout, 用 as 扩 (Node 18+ 支持)
        timeout: 15000,
      } as Parameters<typeof spawn>[2]);

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          const version = stdout.trim().match(/v?(\d+\.\d+\.\d+)/);
          resolve(version ? version[1] : stdout.trim());
        } else {
          reject(new Error(stderr.trim() || `npm show failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * 执行 npm install -g 或 npm update -g
   */
  private npmCommand(action: 'install' | 'update', stageLabel: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const npm = this.getNpmCommand();
      const args = action === 'install'
        ? ['install', '-g', PI_NPM_PACKAGE]
        : ['update', '-g', PI_NPM_PACKAGE];

      this.emitProgress(stageLabel === 'installing' ? 'downloading' : 'downloading',
        action === 'install' ? '正在安装 Pi CLI...' : '正在更新 Pi CLI...');

      this.npmProcess = spawn(npm, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: platform() === 'win32',
      });

      let stderr = '';
      let stdout = '';
      this.npmProcess.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
        // 解析 npm 进度
        const line = d.toString().trim();
        if (line.includes('added') || line.includes('updated') || line.includes('changed')) {
          this.emitProgress('installing', line);
        }
      });

      this.npmProcess.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
        const line = d.toString().trim();
        if (line.includes('progress')) {
          this.emitProgress('installing', line);
        }
      });

      this.npmProcess.on('close', (code) => {
        this.npmProcess = null;
        if (code === 0) {
          this.emitProgress('verifying', '验证安装...');
          // 验证安装成功
          const detection = this.findPiExecutable();
          if (detection) {
            const version = this.getLocalVersion(detection.path);
            this.emitProgress('done', action === 'install'
              ? `Pi CLI v${version || '?'} 安装成功`
              : `Pi CLI 已更新至 v${version || '?'}`);
            this._cachedStatus = null; // 清除缓存
            resolve();
          } else {
            const msg = '安装似乎成功但找不到 pi 可执行文件，请检查 npm global bin 是否在 PATH 中';
            this.emitProgress('error', msg);
            reject(new Error(msg));
          }
        } else {
          const msg = `${action === 'install' ? '安装' : '更新'}失败 (exit ${code}): ${stderr.trim()}`;
          this.emitProgress('error', msg);
          reject(new Error(msg));
        }
      });

      this.npmProcess.on('error', (err) => {
        this.npmProcess = null;
        const msg = `${action === 'install' ? '安装' : '更新'}出错: ${err.message}`;
        this.emitProgress('error', msg);
        reject(err);
      });
    });
  }

  /**
   * 取消正在进行的 npm 操作
   */
  cancelOperation(): void {
    if (this.npmProcess) {
      this.npmProcess.kill();
      this.npmProcess = null;
      this.emitProgress('error', '操作已取消');
    }
  }

  /**
   * 获取 npm 命令路径
   */
  private getNpmCommand(): string {
    // Windows 上优先用 npm.cmd
    if (platform() === 'win32') {
      try {
        execSync('where npm.cmd', { stdio: 'ignore' });
        return 'npm.cmd';
      } catch {
        return 'npm';
      }
    }
    return 'npm';
  }

  /**
   * 版本比较：返回 -1 (a<b), 0 (a==b), 1 (a>b)
   */
  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  /**
   * 发送进度事件
   */
  private emitProgress(stage: PiInstallProgress['stage'], message: string, percent?: number): void {
    const progress: PiInstallProgress = { stage, message, percent };
    this.emit('progress', progress);
  }

  /**
   * 销毁，清理资源
   */
  destroy(): void {
    this.cancelOperation();
    this.removeAllListeners();
  }
}

export default PiDriver;
