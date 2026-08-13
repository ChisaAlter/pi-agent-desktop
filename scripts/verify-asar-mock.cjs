// 验证打包产物 app.asar 内 renderer 是否含 Herdr mock 数据（G1 打包验证用）。
// 用法: node scripts/verify-asar-mock.cjs
const path = require('path');
const { extractFile, listPackage } = require(path.join(
  'C:/Ai/pi-desktop/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar'
));

const ASAR = 'C:/Ai/pi-desktop/apps/desktop/dist/win-unpacked/resources/app.asar';

const files = listPackage(ASAR);
const outRenderer = files.filter((f) => f.includes('\\out\\renderer\\assets\\') && /\.js$/.test(f));
console.log('asar out/renderer/assets js files:', outRenderer.length);

const chunk = outRenderer.find((f) => f.includes('herdr-store'));
if (!chunk) {
  console.error('FAIL: herdr-store chunk NOT found in asar');
  process.exit(1);
}
console.log('herdr-store chunk:', chunk);

// listPackage 返回带前导反斜杠的路径; extractFile 需要不带前导反斜杠的形式
const chunkPath = chunk.replace(/^\\+/, '');
const s = extractFile(ASAR, chunkPath).toString('utf8');
const tabDisplay = (s.match(/HERDR_MOCK_TAB_DISPLAY/g) || []).length;
const agents = (s.match(/HERDR_MOCK_AGENTS/g) || []).length;
const coord = s.includes('任务协调');

console.log('HERDR_MOCK_TAB_DISPLAY refs:', tabDisplay);
console.log('HERDR_MOCK_AGENTS refs:', agents);
console.log('任务协调 present:', coord);

if (tabDisplay >= 2 && agents >= 1 && coord) {
  console.log('PASS: packaged app.asar contains active Herdr mock data');
  process.exit(0);
}
console.error('FAIL: mock data incomplete in asar');
process.exit(1);
