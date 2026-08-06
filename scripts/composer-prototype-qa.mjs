// composer-layout-prototype QA 驱动 — 阶段1 视觉审核门
// 用 Playwright chromium 打开 composer-layout-prototype.html,
// 遍历 状态×主题×高度×模式 矩阵, 截图 + 收集 window.__lastMeasure 结构化测量,
// 输出 report.md / report.json 供用户审核.
//
// 用法: node scripts/composer-prototype-qa.mjs [--viewport 896x756|750x225]
// 产物: apps/desktop/composer-prototype-output/

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROTOTYPE = join(ROOT, "apps", "desktop", "src", "renderer", "src", "components", "ChatView", "composer-layout-prototype.html");
const OUT = join(ROOT, "apps", "desktop", "composer-prototype-output");

const argViewport = process.argv.find((a) => a.startsWith("--viewport="))?.split("=")[1];
const VIEWPORTS = argViewport
  ? [{ name: argViewport, width: Number(argViewport.split("x")[0]), height: Number(argViewport.split("x")[1]) }]
  : [
      { name: "main-896x756", width: 896, height: 756 },
      { name: "stress-750x225", width: 750, height: 225 },
    ];

const HEIGHTS = [95, 160, 240];
const STATES = ["empty", "short", "long", "longnowrap", "att20", "att-long", "errors", "combo", "mention", "slash", "running"];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  const results = [];
  let index = 0;

  // 证据对照图: combo 压力态 contract vs current (标注模式), 两个视口
  for (const vp of VIEWPORTS) {
    for (const mode of ["contract", "current"]) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto("file://" + PROTOTYPE.replaceAll("\\", "/"));
      await page.evaluate(({ mode }) => {
        window.__annotate = true;
        document.body.classList.add("annotate");
        document.querySelector('.toolbar [data-state="combo"]').click();
        document.getElementById("heightSel").value = "95";
        document.getElementById("heightSel").dispatchEvent(new Event("change"));
        if (mode === "current" && document.body.classList.contains("mode-contract")) {
          document.getElementById("modeBtn").click();
        }
        document.getElementById("measureBtn").click();
      }, { mode });
      await page.waitForTimeout(80);
      const shotName = `evidence_${vp.name}_combo_${mode}_h95_annotated.png`;
      await page.screenshot({ path: join(OUT, shotName) });
      await page.close();
    }
  }

  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const isKey = new Set(["combo", "att20", "errors", "empty"]);
      const states = theme === "dark" ? [...isKey] : STATES;
      for (const state of states) {
        const modes = theme === "dark" ? ["contract"] : state === "combo" || state === "att20" || state === "errors"
          ? ["contract", "current"]
          : ["contract"];
        for (const mode of modes) {
          for (const h of HEIGHTS) {
            index += 1;
            const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
            await page.goto("file://" + PROTOTYPE.replaceAll("\\", "/"));
            await page.evaluate(({ state, h, theme, mode }) => {
              const apply = (s) => {
                const btn = document.querySelector(`.toolbar [data-state="${s}"]`);
                btn.click();
              };
              apply(state);
              document.getElementById("heightSel").value = String(h);
              document.getElementById("heightSel").dispatchEvent(new Event("change"));
              if (theme === "dark" && !document.documentElement.classList.contains("dark")) {
                document.getElementById("themeBtn").click();
              }
              if (mode === "current" && document.body.classList.contains("mode-contract")) {
                document.getElementById("modeBtn").click();
              }
              if (mode === "contract" && !document.body.classList.contains("mode-contract")) {
                document.getElementById("modeBtn").click();
              }
              document.getElementById("measureBtn").click();
            }, { state, h, theme, mode });
            await page.waitForTimeout(80);
            const m = await page.evaluate(() => window.__lastMeasure);
            const shotName = `p${String(index).padStart(3, "0")}_${vp.name}_${state}_${mode}_${theme}_h${h}.png`;
            await page.screenshot({ path: join(OUT, shotName) });
            results.push({ shot: shotName, ...m });
            await page.close();
          }
        }
      }
    }
  }

  await browser.close();
  writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT, "report.md"), renderMarkdown(results));
  console.log(`完成: ${results.length} 张截图/测量 → ${OUT}`);
  console.log(renderSummary(results));
}

function renderSummary(results) {
  const fail = results.filter((r) => r.escapees?.length > 0 || r.docOverflowX || r.mentionViewportClip || r.slashViewportClip);
  const lines = [];
  lines.push(`越界/横向溢出/弹窗裁剪 问题数: ${fail.length}/${results.length}`);
  for (const f of fail) {
    lines.push(`  ✗ ${f.shot} 越界=[${f.escapees?.join("; ")}] overflowX=${f.docOverflowX} mentionViewportClip=${f.mentionViewportClip} slashViewportClip=${f.slashViewportClip}`);
  }
  const ok = results.length - fail.length;
  lines.push(`干净状态数: ${ok}/${results.length}`);
  return lines.join("\n");
}

function renderMarkdown(results) {
  const L = [];
  L.push("# Composer 布局契约 — HTML 原型测量报告");
  L.push("");
  L.push(`- 生成时间: ${new Date().toISOString()}`);
  L.push(`- 原型: \`apps/desktop/src/renderer/src/components/ChatView/composer-layout-prototype.html\``);
  L.push(`- 矩阵: ${results.length} 个组合 (状态 × 主题 × 高度 × 布局模式 × 视口)`);
  L.push("");
  L.push("## 图例");
  L.push("- `模式=contract`: 目标契约 (附件/错误/提示 min-h-0 + shrink + overflow-y-auto, 错误 break-all)");
  L.push("- `模式=current`: 现状行为 (无约束正常流, 用于对照缺陷)");
  L.push("- `shell 设定高`: CSS height 值; `shell 实际高`: getBoundingClientRect 高度");
  L.push("- `越界`: 正常流子元素 rect 超出 shell rect (top<shell.top 或 bottom>shell.bottom)");
  L.push("");
  L.push("## 逐项结果");
  L.push("");
  L.push("| # | 截图 | 视口 | 状态 | 模式 | 主题 | 设定高 | 实际高 | 越界 | 控制栏delta | 发送按钮 | textarea滚动 | 附件滚动 | mention/slash | doc滚动 | 横向溢出 |");
  L.push("|---|------|------|------|------|------|--------|--------|------|-------------|----------|--------------|----------|---------------|---------|---------|");
  for (const r of results) {
    const pop = [r.mentionViewportClip === undefined ? "" : `mention视口裁剪=${r.mentionViewportClip}`, r.slashViewportClip === undefined ? "" : `slash视口裁剪=${r.slashViewportClip}`].filter(Boolean).join(" ") || "—";
    L.push(`| ${r.shot} | ![](${r.shot}) | ${r.vp} | ${r.state} | ${r.mode} | ${r.theme} | ${r.shellStyleHeight} | ${r.shellActualH} | ${r.escapees?.length ? r.escapees.join("<br>") : "无 ✓"} | ${r.controlsDelta}px | ${r.sendBtnVisible} | ${r.taScrollable ? `是(${r.taScrollH}/${r.taClientH})` : "否"} | ${r.attVisible ? (r.attScrollable ? `是(${r.attScrollH}/${r.attClientH})` : "否") : "—"} | ${pop} | ${r.docScrollY} | ${r.docOverflowX} |`);
  }
  L.push("");
  L.push("## 汇总");
  const fails = results.filter((r) => r.escapees?.length > 0 || r.docOverflowX || r.mentionViewportClip || r.slashViewportClip);
  L.push(`- 无越界/无横向溢出/无弹窗裁剪 的状态: ${results.length - fails.length}/${results.length}`);
  for (const f of fails) {
    L.push(`- **FAIL** ${f.shot}: 越界=[${f.escapees?.join("; ") || ""}] overflowX=${f.docOverflowX} mentionViewportClip=${f.mentionViewportClip} slashViewportClip=${f.slashViewportClip}`);
  }
  return L.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
