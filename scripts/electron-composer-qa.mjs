// Electron 实机 QA — composer 固定高度布局契约 (CDP 直驱生产应用)
//
// 背景: playwright 1.62.1 的 electron 主进程 evaluate 通道在 Electron 41
// (Node 24) 上挂起/GC (本机确定性复现), 因此本脚本绕开 playwright,
// 用 Electron 官方 --remote-debugging-port + Node 内置 WebSocket (CDP)
// 直接驱动生产构建 (out/main/index.js + out/renderer/index.html + 生产 preload).
//
// 前置: pnpm --filter @pi-desktop/desktop build
// 用法: node scripts/electron-composer-qa.mjs
// 产物: apps/desktop/composer-prototype-output/electron-qa/ (截图 + report.json + report.md)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DESKTOP = join(ROOT, "apps", "desktop");
const OUT = join(DESKTOP, "composer-prototype-output", "electron-qa");
const ELECTRON = join(DESKTOP, "node_modules", "electron", "dist", "electron.exe");
const MAIN_ENTRY = join(DESKTOP, "out", "main", "index.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let page = null; // { evaluate, screenshot }
let app = null;

function record(name, pass, details) {
  results.push({ name, pass, details });
  console.log(`${pass ? "✓" : "✗"} ${name}${details ? " — " + details : ""}`);
}

async function evaluate(expression) {
  return page.evaluate(expression);
}

async function waitFor(expression, timeoutMs = 10000, label = expression) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`Boolean(${expression})`);
    if (last) return true;
    await sleep(150);
  }
  throw new Error(`waitFor 超时: ${label} (last=${last})`);
}

async function clickByText(text, exact = true) {
  const ok = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find((b) => ${exact ? "b.textContent.trim() === " + JSON.stringify(text) : "b.textContent.includes(" + JSON.stringify(text) + ")"});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!ok) throw new Error(`未找到按钮: ${text}`);
}

async function setTextarea(text) {
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('textarea not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value.length;
  })()`);
}

async function pasteFiles(files) {
  await evaluate(`(() => {
    const dt = new DataTransfer();
    for (const f of ${JSON.stringify(files)}) {
      dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: 'image/png' }));
    }
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('textarea not found');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
}

async function composerGeometry() {
  return evaluate(`(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }; };
    const shell = document.querySelector('[data-testid="chat-input-shell"]');
    const controls = document.querySelector('[data-testid="chat-input-reference-controls"]');
    const escapees = [];
    if (shell) {
      const s = shell.getBoundingClientRect();
      for (const child of shell.children) {
        const style = getComputedStyle(child);
        if (style.position === 'absolute' || style.display === 'none') continue;
        const r = child.getBoundingClientRect();
        if (r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5) {
          escapees.push((child.className.split(' ')[0] || child.tagName) + ': ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' vs ' + Math.round(s.top) + '..' + Math.round(s.bottom));
        }
      }
    }
    const scrolling = document.scrollingElement ?? document.documentElement;
    const ta = document.querySelector('textarea');
    const att = document.querySelector('[role="list"][aria-label="已选附件"]');
    return {
      shell: rect(shell),
      controls: rect(controls),
      escapees,
      shellHeightCss: shell ? shell.style.height : null,
      composerVar: document.documentElement.style.getPropertyValue('--pi-global-composer-height'),
      docScrollY: scrolling.scrollHeight - scrolling.clientHeight,
      docOverflowX: scrolling.scrollWidth - scrolling.clientWidth,
      innerHeight: window.innerHeight,
      textarea: ta ? { scrollH: ta.scrollHeight, clientH: ta.clientHeight, overflowY: getComputedStyle(ta).overflowY } : null,
      attachment: att ? { scrollH: att.scrollHeight, clientH: att.clientHeight, chipCount: att.querySelectorAll('[role="listitem"]').length } : null,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => ({ text: a.textContent.slice(0, 60), cls: a.className })),
    };
  })()`);
}

function expectContract(m, expectedHeight) {
  const problems = [];
  if (!m.shell) problems.push("shell 不可见");
  if (!m.controls) problems.push("控制栏不可见");
  if (m.escapees && m.escapees.length) problems.push(`越界: ${m.escapees.join("; ")}`);
  if (m.docScrollY > 4) problems.push(`文档垂直滚动 ${m.docScrollY}px`);
  if (m.docOverflowX > 1) problems.push(`横向溢出 ${m.docOverflowX}px`);
  if (m.shell && m.innerHeight - m.shell.bottom > 32) problems.push("shell 未锚定视口底部");
  if (m.shell && m.controls) {
    const delta = m.shell.bottom - m.controls.bottom;
    if (delta < 0 || delta > 2) problems.push(`控制栏贴底 delta=${delta}`);
  }
  if (expectedHeight !== undefined && m.shell && Math.abs(m.shell.height - expectedHeight) > 1) {
    problems.push(`shell 高度 ${Math.round(m.shell.height)} ≠ ${expectedHeight}`);
  }
  return problems;
}

async function dragResize(dy) {
  const pos = await evaluate(`(() => {
    const handle = document.querySelector('[aria-label="调整输入框高度"]');
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pos) throw new Error("resize handle 不可见");
  await page.cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
  await page.cdpSend("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y + dy, button: "left" });
  await page.cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y + dy, button: "left", clickCount: 1 });
  await sleep(120);
}

async function setupApp() {
  const port = 9300 + Math.floor(Math.random() * 200);
  const userDataDir = join(process.env.TEMP || ".", `composer-qa-${Date.now()}`);
  app = spawn(ELECTRON, [MAIN_ENTRY, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CI: "1" },
    stdio: "ignore",
  });

  // 等 CDP 目标
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page" && t.url.includes("index.html"))) break;
    } catch { /* not up yet */ }
  }
  const target = targets?.find((t) => t.type === "page" && t.url.includes("index.html"));
  if (!target) throw new Error("CDP 目标不可达 (index.html page 未出现)");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++msgId;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  page = {
    async evaluate(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error("evaluate 异常: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result?.result?.value;
    },
    async cdpSend(method, params) { return send(method, params); },
    async screenshot(name) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64"));
      return name;
    },
  };

  // 跳过 onboarding
  await evaluate(`(() => {
    const modal = document.querySelector('[data-testid="onboarding-modal"]');
    if (!modal) return false;
    const btn = [...modal.querySelectorAll('button')].find((b) => b.textContent.includes('跳过引导'));
    btn?.click();
    return true;
  })()`);
  // 预置 workspace + session + agent
  await evaluate(`(async () => {
    localStorage.setItem('pi-desktop:firstLaunchDone', 'true');
    localStorage.setItem('pi-desktop.onboarding.completed', 'true');
    const ws = await window.piAPI.createWorkspace('composer-qa', ${JSON.stringify(join(userDataDir, "ws"))});
    await window.piAPI.selectWorkspace(ws.path);
    const session = await window.piAPI.createSession(ws.id, 'composer-qa-session', 'composer-qa-session');
    await window.piAPI.agentsCreate({ workspaceId: ws.id, title: 'composer-qa-agent', sessionId: session.id });
    return true;
  })()`);
  await page.evaluate("location.reload()");
  await sleep(2500);
  await clickByText("composer-qa-session");
  await waitFor("document.querySelector('[data-testid=\"chat-input-shell\"]')", 15000, "composer shell 挂载");
}

async function reloadAndWait() {
  await page.evaluate("location.reload()");
  await sleep(2500);
  await clickByText("composer-qa-session");
  await waitFor("document.querySelector('[data-testid=\"chat-input-shell\"]')", 15000, "composer shell 挂载");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await setupApp();

  // 1. 基线
  {
    let m = await composerGeometry();
    let problems = expectContract(m, 95);
    problems.push(...(m.composerVar === "103px" ? [] : [`CSS 变量=${m.composerVar}`]));
    problems.push(...(m.textarea?.overflowY === "auto" ? [] : [`textarea overflow=${m.textarea?.overflowY}`]));
    await page.screenshot("01-baseline-empty.png");
    record("基线: 空 composer 95px/变量103px/控制栏贴底", problems.length === 0, problems.join("; ") || `shell=${Math.round(m.shell.height)}px`);
  }

  // 2. 500 行长文本
  {
    const longText = Array.from({ length: 500 }, (_, i) => `第 ${i + 1} 行 — 长草稿 ${i}🚀 中文English`).join("\n");
    await setTextarea(longText);
    await sleep(300);
    const m = await composerGeometry();
    const problems = expectContract(m, 95);
    problems.push(...(m.textarea && m.textarea.scrollH > m.textarea.clientH ? [] : ["textarea 未滚动"]));
    await page.screenshot("02-long-text-500.png");
    record("500 行长文本: textarea 自身滚动, shell 不变", problems.length === 0, problems.join("; ") || `scrollH=${m.textarea?.scrollH}/clientH=${m.textarea?.clientH}`);
    await setTextarea("");
    await sleep(200);
  }

  // 3. 无空格超长 URL
  {
    await setTextarea(`https://example.com/very/long/path/${"x".repeat(500)}?q=${"y".repeat(300)}`);
    await sleep(300);
    const m = await composerGeometry();
    const problems = expectContract(m, 95);
    await page.screenshot("03-long-url.png");
    record("无空格超长 URL: 无横向溢出", problems.length === 0, problems.join("; ") || "ok");
    await setTextarea("");
    await sleep(200);
  }

  // 4. 20 张图片附件
  {
    await pasteFiles(Array.from({ length: 20 }, (_, i) => ({ name: `pasted-${i}.png`, bytes: 64 })));
    await waitFor("(document.querySelector('[role=\"list\"][aria-label=\"已选附件\"]')?.querySelectorAll('[role=\"listitem\"]').length ?? 0) === 20", 10000, "20 chips");
    await sleep(400);
    const m = await composerGeometry();
    const problems = expectContract(m, 95);
    problems.push(...(m.attachment ? [] : ["附件区未渲染"]));
    if (m.attachment) {
      problems.push(...(m.attachment.chipCount === 20 ? [] : [`chips=${m.attachment.chipCount}`]));
      problems.push(...(m.attachment.scrollH > m.attachment.clientH ? [] : [`附件区未滚动 (${m.attachment.scrollH}/${m.attachment.clientH})`]));
    }
    await page.screenshot("04-attachments-20.png");
    record("20 图片附件: chips 在 shell 内, 附件区滚动, 控制栏贴底", problems.length === 0, problems.join("; ") || `attScroll=${m.attachment?.scrollH}/${m.attachment?.clientH}`);
  }

  // 5. 超大图片错误
  {
    await pasteFiles([{ name: "too-big.png", bytes: 6 * 1024 * 1024 }]);
    await waitFor("document.querySelectorAll('[role=\"alert\"]').length > 0", 10000, "alert");
    await sleep(300);
    const m = await composerGeometry();
    const problems = expectContract(m, 95);
    const alert = m.alerts?.[0];
    problems.push(...(alert ? [] : ["alert 未渲染"]));
    if (alert) {
      if (!alert.text.includes("5MB")) problems.push(`错误文案=${alert.text}`);
      if (!alert.cls.includes("break-all")) problems.push("缺 break-all");
      if (!alert.cls.includes("whitespace-pre-wrap")) problems.push("缺 whitespace-pre-wrap");
    }
    await page.screenshot("05-attachment-error.png");
    record("超大图片被拒: 错误受控在 shell 内", problems.length === 0, problems.join("; ") || alert?.text);
  }

  // 6. resize 拖拽
  {
    await dragResize(-80);
    await sleep(300);
    const m = await composerGeometry();
    const problems = expectContract(m, m.shell ? Math.round(m.shell.height) : undefined);
    problems.push(...(m.shell && m.shell.height > 150 ? [] : [`shell=${m.shell?.height}`]));
    problems.push(...(m.shell && m.composerVar === `${Math.round(m.shell.height) + 8}px` ? [] : [`变量=${m.composerVar} 期望=${m.shell ? Math.round(m.shell.height) + 8 : "?"}`]));
    await page.screenshot("06-resized.png");
    record("resize 拖拽: 契约保持, 变量同步", problems.length === 0, problems.join("; ") || `shell=${Math.round(m.shell.height)}px var=${m.composerVar}`);
    // 拖回默认
    await dragResize(80);
    await sleep(300);
  }

  // 7. Slash 菜单 (先 reload 隔离前序用例的附件/错误残留)
  {
    await reloadAndWait();
    await setTextarea("/pla");
    await waitFor("document.querySelector('[role=\"listbox\"]')", 10000, "slash 菜单");
    await sleep(300);
    const menuInfo = await evaluate(`(() => {
      const menu = document.querySelector('[role="listbox"]');
      const r = menu.getBoundingClientRect();
      const shell = document.querySelector('[data-testid="chat-input-shell"]').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, gap: shell.top - r.bottom };
    })()`);
    const problems = [];
    if (menuInfo.height <= 0) problems.push("菜单高度为 0");
    if (menuInfo.top < 0) problems.push(`菜单被视口顶部裁剪 top=${Math.round(menuInfo.top)}`);
    // 契约: 菜单 absolute bottom:100% 相对 shell 内 body-col (pt-3=12px), 底部高于 shell top 约 8px
    if (menuInfo.gap < -12 || menuInfo.gap > -2) problems.push(`菜单间隙=${menuInfo.gap.toFixed(1)}px (期望 ≈-8)`);
    const m = await composerGeometry();
    problems.push(...(m.escapees.length === 0 ? [] : ["shell 越界"]));
    await page.screenshot("07-slash-menu.png");
    record("Slash 菜单: 向上弹出可见, 不被裁剪", problems.length === 0, problems.join("; ") || `gap=${menuInfo.gap.toFixed(1)}px top=${Math.round(menuInfo.top)}`);
    await setTextarea("");
    await sleep(200);
  }

  // 8. 卸载清理 + 切回恢复
  {
    await clickByText("运行", true);
    await waitFor("document.documentElement.style.getPropertyValue('--pi-global-composer-height') === ''", 10000, "变量清空");
    const cleared = await evaluate("document.documentElement.style.getPropertyValue('--pi-global-composer-height')");
    await clickByText("对话", true);
    await waitFor("document.documentElement.style.getPropertyValue('--pi-global-composer-height') === '103px'", 10000, "变量恢复");
    await sleep(400);
    const m = await composerGeometry();
    const problems = [];
    problems.push(...(cleared === "" ? [] : [`卸载后变量=${JSON.stringify(cleared)}`]));
    problems.push(...expectContract(m, 95));
    record("卸载清理变量 + 切回恢复", problems.length === 0, problems.join("; ") || "ok");
  }

  // 9. 1365×768 宽窗 (reload 隔离残留)
  {
    await reloadAndWait();
    const resizeOk = await evaluate(`(() => { try { window.resizeTo(1365, 768); return true; } catch (e) { return false; } })()`);
    await sleep(1500);
    const winInfo = await evaluate(`({ outer: window.outerWidth, inner: window.innerWidth })`);
    if (resizeOk && winInfo.inner > 900) {
      await setTextarea(Array.from({ length: 300 }, (_, i) => `行 ${i}`).join("\n"));
      await pasteFiles(Array.from({ length: 12 }, (_, i) => ({ name: `w-${i}.png`, bytes: 64 })));
      await waitFor("(document.querySelector('[role=\"list\"][aria-label=\"已选附件\"]')?.querySelectorAll('[role=\"listitem\"]').length ?? 0) === 12", 10000, "12 chips");
      const m = await composerGeometry();
      const problems = expectContract(m, 95);
      await page.screenshot("09-wide-1365x768.png");
      record("1365×768 宽窗: 契约保持", problems.length === 0, problems.join("; ") || `innerWidth=${winInfo.inner}`);
    } else {
      record("1365×768 宽窗: window.resizeTo 不可用, 跳过", true, `resizeTo=${resizeOk} inner=${winInfo.inner}`);
    }
  }

  // 汇总
  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  let md = `# Electron 实机 QA — composer 固定高度布局契约\n\n- 时间: ${new Date().toISOString()}\n- 驱动: 生产 build + CDP (绕过 playwright electron 主进程通道)\n- 结果: ${results.length - failed.length}/${results.length} 通过\n\n| 用例 | 结果 | 详情 |\n|---|---|---|\n`;
  for (const r of results) md += `| ${r.name} | ${r.pass ? "✓" : "✗"} | ${r.details || ""} |\n`;
  writeFileSync(join(OUT, "report.md"), md);
  console.log(`\n汇总: ${results.length - failed.length}/${results.length} 通过 → ${OUT}`);
  app.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("QA 失败:", err.message);
  try { app?.kill(); } catch { /* ignore */ }
  process.exit(1);
});
