// win-unpacked 生产包实机验证 — composer 固定高度布局契约
//
// 对 electron-builder 产出的 dist/win-unpacked/Pi Desktop.exe 用 CDP 直驱,
// 验证核心布局契约在生产包中成立 (计划 5.2: 从生产包复现验证结果).
//
// 用法: node scripts/electron-pkg-verify.mjs
// 产物: apps/desktop/composer-prototype-output/pkg-verify/ (截图 + report.json)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DESKTOP = join(ROOT, "apps", "desktop");
const OUT = join(DESKTOP, "composer-prototype-output", "pkg-verify");
const EXE = join(DESKTOP, "dist", "win-unpacked", "Pi Desktop.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let page = null;
let app = null;

const record = (name, pass, details) => {
  results.push({ name, pass, details });
  console.log(`${pass ? "✓" : "✗"} ${name}${details ? " — " + details : ""}`);
};

const evaluate = (expression) => page.evaluate(expression);

async function waitFor(expression, timeoutMs = 10000, label = expression) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await sleep(150);
  }
  throw new Error(`waitFor 超时: ${label}`);
}

async function clickByText(text) {
  const ok = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
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
  })()`);
}

async function pasteFiles(files) {
  await evaluate(`(() => {
    const dt = new DataTransfer();
    for (const f of ${JSON.stringify(files)}) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: 'image/png' }));
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('textarea not found');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
}

async function geometry() {
  return evaluate(`(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
    const shell = document.querySelector('[data-testid="chat-input-shell"]');
    const controls = document.querySelector('[data-testid="chat-input-reference-controls"]');
    const escapees = [];
    if (shell) {
      const s = shell.getBoundingClientRect();
      for (const child of shell.children) {
        const style = getComputedStyle(child);
        if (style.position === 'absolute' || style.display === 'none') continue;
        const r = child.getBoundingClientRect();
        if (r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5) escapees.push(child.className.split(' ')[0] || child.tagName);
      }
    }
    const scrolling = document.scrollingElement ?? document.documentElement;
    const ta = document.querySelector('textarea');
    const att = document.querySelector('[role="list"][aria-label="已选附件"]');
    return {
      shell: rect(shell), controls: rect(controls), escapees,
      composerVar: document.documentElement.style.getPropertyValue('--pi-global-composer-height'),
      docScrollY: scrolling.scrollHeight - scrolling.clientHeight,
      docOverflowX: scrolling.scrollWidth - scrolling.clientWidth,
      textarea: ta ? { scrollH: ta.scrollHeight, clientH: ta.clientHeight } : null,
      attachment: att ? { scrollH: att.scrollHeight, clientH: att.clientHeight, chips: att.querySelectorAll('[role="listitem"]').length } : null,
    };
  })()`);
}

function contractProblems(m, expectedHeight) {
  const p = [];
  if (!m.shell || !m.controls) p.push("shell/控制栏不可见");
  if (m.escapees?.length) p.push(`越界: ${m.escapees.join(",")}`);
  if (m.docScrollY > 4) p.push(`文档滚动 ${m.docScrollY}`);
  if (m.docOverflowX > 1) p.push(`横向溢出 ${m.docOverflowX}`);
  if (m.shell && m.controls) {
    const d = m.shell.bottom - m.controls.bottom;
    if (d < 0 || d > 2) p.push(`控制栏贴底 delta=${d}`);
  }
  if (expectedHeight !== undefined && m.shell && Math.abs(m.shell.height - expectedHeight) > 1) p.push(`shell 高 ${Math.round(m.shell.height)}≠${expectedHeight}`);
  return p;
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

async function reloadAndWait() {
  await page.evaluate("location.reload()");
  await sleep(2500);
  await clickByText("pkg-verify-session");
  await waitFor("document.querySelector('[data-testid=\"chat-input-shell\"]')", 15000, "composer 挂载");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const port = 9600 + Math.floor(Math.random() * 100);
  const userDataDir = join(process.env.TEMP || ".", `pkg-verify-${Date.now()}`);
  app = spawn(EXE, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CI: "1" },
    stdio: "ignore",
  });

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
  if (!target) throw new Error("生产包 CDP 目标不可达");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++msgId; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
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
    },
  };

  // 跳过 onboarding + 预置会话
  await evaluate(`(() => {
    const modal = document.querySelector('[data-testid="onboarding-modal"]');
    const btn = modal && [...modal.querySelectorAll('button')].find((b) => b.textContent.includes('跳过引导'));
    btn?.click();
    return true;
  })()`);
  await evaluate(`(async () => {
    localStorage.setItem('pi-desktop:firstLaunchDone', 'true');
    localStorage.setItem('pi-desktop.onboarding.completed', 'true');
    const ws = await window.piAPI.createWorkspace('pkg-verify', ${JSON.stringify(join(userDataDir, "ws"))});
    await window.piAPI.selectWorkspace(ws.path);
    const session = await window.piAPI.createSession(ws.id, 'pkg-verify-session', 'pkg-verify-session');
    await window.piAPI.agentsCreate({ workspaceId: ws.id, title: 'pkg-verify-agent', sessionId: session.id });
  })()`);
  await page.evaluate("location.reload()");
  await sleep(2500);
  await clickByText("pkg-verify-session");
  await waitFor("document.querySelector('[data-testid=\"chat-input-shell\"]')", 15000, "composer 挂载");

  // 1. 基线
  {
    const m = await geometry();
    const p = contractProblems(m, 95);
    p.push(...(m.composerVar === "103px" ? [] : [`变量=${m.composerVar}`]));
    await page.screenshot("pkg-01-baseline.png");
    record("生产包基线: 95px/变量103px/控制栏贴底", p.length === 0, p.join("; ") || `shell=${Math.round(m.shell.height)}px`);
  }

  // 2. 500 行
  {
    await setTextarea(Array.from({ length: 500 }, (_, i) => `行 ${i}`).join("\n"));
    await sleep(300);
    const m = await geometry();
    const p = contractProblems(m, 95);
    p.push(...(m.textarea && m.textarea.scrollH > m.textarea.clientH ? [] : ["textarea 未滚动"]));
    await page.screenshot("pkg-02-long.png");
    record("生产包 500 行: textarea 滚动, shell 不变", p.length === 0, p.join("; ") || `scrollH=${m.textarea?.scrollH}/${m.textarea?.clientH}`);
    await setTextarea("");
    await sleep(200);
  }

  // 3. 20 附件
  {
    await pasteFiles(Array.from({ length: 20 }, (_, i) => ({ name: `p-${i}.png`, bytes: 64 })));
    await waitFor("(document.querySelector('[role=\"list\"][aria-label=\"已选附件\"]')?.querySelectorAll('[role=\"listitem\"]').length ?? 0) === 20", 10000, "20 chips");
    await sleep(400);
    const m = await geometry();
    const p = contractProblems(m, 95);
    p.push(...(m.attachment?.chips === 20 ? [] : [`chips=${m.attachment?.chips}`]));
    p.push(...(m.attachment && m.attachment.scrollH > m.attachment.clientH ? [] : ["附件区未滚动"]));
    await page.screenshot("pkg-03-attachments.png");
    record("生产包 20 附件: chips 在 shell 内, 附件区滚动", p.length === 0, p.join("; ") || `attScroll=${m.attachment?.scrollH}/${m.attachment?.clientH}`);
  }

  // 4. 长 URL
  {
    await setTextarea(`https://example.com/very/long/path/${"x".repeat(500)}?q=${"y".repeat(300)}`);
    await sleep(300);
    const m = await geometry();
    const p = contractProblems(m, 95);
    await page.screenshot("pkg-04-long-url.png");
    record("生产包长 URL: 无横向溢出", p.length === 0, p.join("; ") || "ok");
    await setTextarea("");
    await sleep(200);
  }

  // 5. 超大图片错误
  {
    await pasteFiles([{ name: "too-big.png", bytes: 6 * 1024 * 1024 }]);
    await waitFor("document.querySelectorAll('[role=\"alert\"]').length > 0", 10000, "alert");
    await sleep(300);
    const m = await geometry();
    const p = contractProblems(m, 95);
    const alerts = await evaluate(`[...document.querySelectorAll('[role="alert"]')].map((a) => a.className)`);
    p.push(...(alerts[0]?.includes("break-all") ? [] : ["alert 缺 break-all"]));
    await page.screenshot("pkg-05-attachment-error.png");
    record("生产包大图被拒: 错误受控", p.length === 0, p.join("; ") || "ok");
  }

  // 6. resize 拖拽
  {
    await dragResize(-80);
    await sleep(300);
    const m = await geometry();
    const p = contractProblems(m, m.shell ? Math.round(m.shell.height) : undefined);
    p.push(...(m.shell && m.shell.height > 150 ? [] : [`shell=${m.shell?.height}`]));
    p.push(...(m.shell && m.composerVar === `${Math.round(m.shell.height) + 8}px` ? [] : [`变量=${m.composerVar}`]));
    await page.screenshot("pkg-06-resized.png");
    record("生产包 resize: 契约保持, 变量同步", p.length === 0, p.join("; ") || `shell=${Math.round(m.shell.height)}px var=${m.composerVar}`);
    await dragResize(80);
    await sleep(300);
  }

  // 7. Slash 菜单 (reload 隔离)
  {
    await reloadAndWait();
    await setTextarea("/pla");
    await waitFor("document.querySelector('[role=\"listbox\"]')", 10000, "slash 菜单");
    await sleep(300);
    const menuInfo = await evaluate(`(() => {
      const menu = document.querySelector('[role="listbox"]');
      const r = menu.getBoundingClientRect();
      const shell = document.querySelector('[data-testid="chat-input-shell"]').getBoundingClientRect();
      return { top: r.top, height: r.height, gap: shell.top - r.bottom };
    })()`);
    const p = [];
    if (menuInfo.height <= 0) p.push("菜单高度 0");
    if (menuInfo.top < 0) p.push(`菜单被视口裁剪 top=${Math.round(menuInfo.top)}`);
    if (menuInfo.gap < -12 || menuInfo.gap > -2) p.push(`菜单间隙=${menuInfo.gap.toFixed(1)} (期望≈-8)`);
    await page.screenshot("pkg-07-slash-menu.png");
    record("生产包 Slash 菜单: 可见不被裁剪", p.length === 0, p.join("; ") || `gap=${menuInfo.gap.toFixed(1)}px top=${Math.round(menuInfo.top)}`);
    await setTextarea("");
    await sleep(200);
  }

  // 8. 卸载清理
  {
    await clickByText("运行");
    await waitFor("document.documentElement.style.getPropertyValue('--pi-global-composer-height') === ''", 10000, "变量清空");
    await clickByText("对话");
    await waitFor("document.documentElement.style.getPropertyValue('--pi-global-composer-height') === '103px'", 10000, "变量恢复");
    await sleep(400);
    const m = await geometry();
    const p = contractProblems(m, 95);
    record("生产包卸载清理 + 切回恢复", p.length === 0, p.join("; ") || "ok");
  }

  // 9. 1365×768 宽窗 (reload 隔离)
  {
    await reloadAndWait();
    const resizeOk = await evaluate(`(() => { try { window.resizeTo(1365, 768); return true; } catch (e) { return false; } })()`);
    await sleep(1500);
    const winInfo = await evaluate(`({ outer: window.outerWidth, inner: window.innerWidth })`);
    if (resizeOk && winInfo.inner > 900) {
      await setTextarea(Array.from({ length: 300 }, (_, i) => `行 ${i}`).join("\n"));
      await pasteFiles(Array.from({ length: 12 }, (_, i) => ({ name: `w-${i}.png`, bytes: 64 })));
      await waitFor("(document.querySelector('[role=\"list\"][aria-label=\"已选附件\"]')?.querySelectorAll('[role=\"listitem\"]').length ?? 0) === 12", 10000, "12 chips");
      const m = await geometry();
      const p = contractProblems(m, 95);
      await page.screenshot("pkg-09-wide-1365x768.png");
      record("生产包 1365×768 宽窗: 契约保持", p.length === 0, p.join("; ") || `innerWidth=${winInfo.inner}`);
    } else {
      record("生产包 1365×768 宽窗: resizeTo 不可用, 跳过", true, `resizeTo=${resizeOk} inner=${winInfo.inner}`);
    }
  }

  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), exe: EXE, results }, null, 2));
  console.log(`\n生产包验证: ${results.length - failed.length}/${results.length} 通过 → ${OUT}`);
  app.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("生产包验证失败:", err.message);
  try { app?.kill(); } catch { /* ignore */ }
  process.exit(1);
});
