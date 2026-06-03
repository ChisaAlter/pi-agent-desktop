// v1.0.10 (smoke): 真正 runtime 验证 C1 修复 — patch out/ 干掉 node:sqlite 阻塞,
// stub electron + electron-log, 跑 setupIPC 看会不会抛 "second handler".
//
// 一次性脚本, 跑完即弃. 不入 git.

const Module = require('module');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'apps', 'desktop', 'out', 'main');
const MAIN = path.join(OUT_DIR, 'index.js');

// 1) Patch 所有 chunk 和 main: 把 `require("node:sqlite")` 换成字面量 `{}`
//    (rollup 把 type-only import 编译成 runtime require, 实际没用到, stub 即可)
//    保留 `const x = ` 前缀, 否则会成 `const x = ;` 语法错.
let patchedCount = 0;
const patchFile = (p) => {
    const c = fs.readFileSync(p, 'utf-8');
    const next = c.replace(/require\("node:sqlite"\)/g, '{}');
    if (next !== c) {
        fs.writeFileSync(p, next);
        patchedCount++;
    }
};
patchFile(MAIN);
for (const f of fs.readdirSync(path.join(OUT_DIR, 'chunks'))) {
    patchFile(path.join(OUT_DIR, 'chunks', f));
}
console.log(`[smoke] patched node:sqlite in ${patchedCount} files`);

// 2) Stub electron — 跟踪所有 ipcMain.handle / on 调用, 重复就抛
const calls = { handle: [], on: [] };
const stubElectron = {
    ipcMain: {
        handle: (ch, _fn) => {
            if (calls.handle.includes(ch)) {
                throw new Error(`Attempted to register a second handler for "${ch}"`);
            }
            calls.handle.push(ch);
        },
        on: (ch, _fn) => {
            if (calls.on.includes(ch)) {
                throw new Error(`Attempted to register a second handler for "${ch}" (on)`);
            }
            calls.on.push(ch);
        },
    },
    app: {
        whenReady: () => ({ then: () => { } }),
        on: () => { },
        quit: () => { },
        getPath: () => '/tmp',
    },
    BrowserWindow: class {
        constructor() { }
        on() { return this; }
        show() { }
        loadURL() { }
        loadFile() { }
        webContents = { send: () => { } };
        isDestroyed() { return false; }
        static getAllWindows() { return []; }
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
};

// 3) Stub electron-log main 入口 — 避免它跑去创建 log 文件 IO
// 4) Stub electron-store — 避免真实写盘
// 5) Stub node-pty — native 模块, Node 跑不动
const noopStub = new Proxy(function () { }, {
    get: () => noopStub,
    apply: () => noopStub,
    construct: () => ({}),
});

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
    if (request === 'electron') return stubElectron;
    if (request === 'node:sqlite') return {};
    if (request === 'electron-log/main' || request === 'electron-log') return { info: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
    if (request === 'electron-store') return class { constructor() { } get() { return {}; } set() { } };
    if (request === 'node-pty') return { spawn: () => ({ onData: () => { }, onExit: () => { } }) };
    return origLoad.call(this, request, parent, ...rest);
};

// 6) 跑 main bundle
console.log('[smoke] requiring main bundle...');
try {
    require(MAIN);
} catch (e) {
    console.error('[smoke] FAILED during require:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
}

// 7) 但 setupIPC 是注册在 app.whenReady().then() 里的 — 我们 stub 的 whenReady
//    不会自动调 then. 直接从 ipcMain.handle 列表来算.
// 上面的 stub whenReady 没调 .then, 所以 setupIPC 没跑.
// 用更直接的方式: 我们已经 require 完 main.js, 它顶层只是定义了函数.
// setupIPC 是当 app.whenReady() 时跑的. 我们 stub 的 whenReady 啥也不做.
//
// 改: 替换 whenReady 让 .then 立即同步执行.
console.log('[smoke] app.whenReady() chain did not run in stub. Re-requiring with sync chain...');

// 改方案: 用一个能在 require 时同步触发 then 的 stub.
// 重新做一遍: 删 require cache, 重做 stub 触发 then
delete require.cache[MAIN];

let syncTrigger = null;
stubElectron.app.whenReady = () => {
    const promise = {
        then: (cb) => {
            syncTrigger = cb;
            return promise;
        },
    };
    return promise;
};

console.log('[smoke] re-requiring main with sync whenReady...');
require(MAIN);
if (syncTrigger) {
    console.log('[smoke] firing whenReady.then() to trigger setupIPC...');
    try {
        syncTrigger();
    } catch (e) {
        console.error('[smoke] setupIPC FAILED:', e.message);
        if (e.stack) console.error(e.stack.split('\n').slice(0, 15).join('\n'));
        process.exit(1);
    }
}

// 8) 报告
const handleDupes = calls.handle.filter((ch, i) => calls.handle.indexOf(ch) !== i);
const onDupes = calls.on.filter((ch, i) => calls.on.indexOf(ch) !== i);

console.log('\n[smoke] === 结果 ===');
console.log(`  ipcMain.handle 调用次数: ${calls.handle.length}, unique: ${new Set(calls.handle).size}`);
console.log(`  ipcMain.on 调用次数:    ${calls.on.length}, unique: ${new Set(calls.on).size}`);

if (handleDupes.length || onDupes.length) {
    console.error('[smoke] ❌ 发现重复:');
    if (handleDupes.length) console.error('  handle:', handleDupes);
    if (onDupes.length) console.error('  on:', onDupes);
    process.exit(1);
}
console.log('[smoke] ✅ C1 修复 runtime 验证通过 — 无重复 IPC 通道');
console.log('[smoke]    (handle channels:', calls.handle.join(', '), ')');
console.log('[smoke]    (on channels:', calls.on.join(', '), ')');
