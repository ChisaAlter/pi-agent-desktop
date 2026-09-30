// 验证生产打包产物 app.asar 不含激活的 Herdr mock 数据。
const path = require("path");
const { extractFile, listPackage } = require(path.join(
    "C:/Ai/pi-desktop/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar",
));

const ASAR = "C:/Ai/pi-desktop/apps/desktop/dist/win-unpacked/resources/app.asar";
const files = listPackage(ASAR);
const outRenderer = files.filter((f) => f.includes("\\out\\renderer\\assets\\") && /\.js$/.test(f));
const chunk = outRenderer.find((f) => f.includes("herdr-store"));
if (!chunk) {
    console.error("FAIL: herdr-store chunk NOT found in asar");
    process.exit(1);
}

const s = extractFile(ASAR, chunk.replace(/^\\+/, "")).toString("utf8");
const hasActiveMock = /HERDR_MOCK_TAB_DISPLAY/.test(s) && s.includes("任务协调");
console.log("herdr-store chunk:", chunk);
console.log("HERDR_MOCK_TAB_DISPLAY refs:", (s.match(/HERDR_MOCK_TAB_DISPLAY/g) || []).length);
console.log("任务协调 present:", s.includes("任务协调"));
if (hasActiveMock) {
    console.error("FAIL: production asar still contains active Herdr mock data");
    process.exit(1);
}
console.log("PASS: production asar does not contain an active Herdr mock payload");
