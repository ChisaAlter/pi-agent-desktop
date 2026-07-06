// v1.0.10 (smoke): runtime-verify C1 fix — patch a TEMP COPY of out/main to
// neutralize the node:sqlite blocker, stub electron + electron-log, then run
// setupIPC and watch for "second handler" throws.
//
// Patches a copy in a temp dir so the built artifact (out/main/index.js) stays
// pristine. Temp dir is removed in a finally block on every exit path.

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'apps', 'desktop', 'out', 'main');
const DESKTOP_DIR = path.resolve(__dirname, '..', 'apps', 'desktop');
const MAIN_SRC = path.join(OUT_DIR, 'index.js');
const CHUNKS_SRC = path.join(OUT_DIR, 'chunks');

// Create a temp dir for the patched copies — never mutate out/main/index.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-smoke-'));
const MAIN = path.join(tmpDir, 'index.js');
const CHUNKS_DIR = path.join(tmpDir, 'chunks');

try {
    runSmoke();
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runSmoke() {
    // 1) Copy main bundle (and chunks, if present) into the temp dir so we can
    //    patch without touching the built artifact.
    fs.copyFileSync(MAIN_SRC, MAIN);
    fs.copyFileSync(path.join(DESKTOP_DIR, 'package.json'), path.join(tmpDir, 'package.json'));
    const hasChunks = fs.existsSync(CHUNKS_SRC);
    if (hasChunks) {
        fs.mkdirSync(CHUNKS_DIR, { recursive: true });
        for (const f of fs.readdirSync(CHUNKS_SRC)) {
            fs.copyFileSync(path.join(CHUNKS_SRC, f), path.join(CHUNKS_DIR, f));
        }
    }

    // 2) Patch all chunk and main copies: replace `require("node:sqlite")` with
    //    a stub literal. The original v1.0.10 script used `{}` because rollup
    //    emitted node:sqlite as a type-only import that wasn't used at runtime.
    //    The long-horizon runtime (added after the smoke script was committed)
    //    now instantiates `DatabaseSync` at startup, so the stub must expose it.
    //    Keep the `const x = ` prefix, otherwise we get `const x = ;` (syntax error).
    const NODE_SQLITE_STUB =
        '{DatabaseSync:class{constructor(){}exec(){}close(){}' +
        'prepare(){return{get:()=>null,all:()=>[],run:()=>({changes:0,lastInsertRowid:0}),finalize:()=>{}}}}}';
    let patchedCount = 0;
    const patchFile = (p) => {
        const c = fs.readFileSync(p, 'utf-8');
        const next = c.replace(/require\("node:sqlite"\)/g, NODE_SQLITE_STUB);
        if (next !== c) {
            fs.writeFileSync(p, next);
            patchedCount++;
        }
    };
    patchFile(MAIN);
    if (hasChunks) {
        for (const f of fs.readdirSync(CHUNKS_DIR)) {
            patchFile(path.join(CHUNKS_DIR, f));
        }
    }
    console.log(`[smoke] patched node:sqlite in ${patchedCount} files`);

    // 3) Stub electron — track all ipcMain.handle / on calls, throw on dupes
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
            getVersion: () => '0.0.0-smoke',
            isPackaged: false,
        },
        BrowserWindow: class {
            constructor() { }
            on() { return this; }
            show() { }
            loadURL() { }
            loadFile() { }
            setAlwaysOnTop() { }
            setVisibleOnAllWorkspaces() { }
            setSkipTaskbar() { }
            setIgnoreMouseEvents() { }
            setBounds() { }
            getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
            hide() { }
            close() { }
            // Bundle calls webContents.send, .setZoomFactor, .openDevTools, etc.
            // Proxy returns a noop for any property so registration can't throw.
            webContents = new Proxy({}, { get: () => () => { } });
            isDestroyed() { return false; }
            static getAllWindows() { return []; }
        },
        dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
        // protocol.handle is invoked by registerLocalFileProtocol() inside
        // app.whenReady().then(); stub it so registration doesn't throw.
        protocol: { handle: () => { } },
        net: { fetch: async () => new Response('', { status: 404 }) },
    };

    // 4) Stub electron-log main entry — keep it from creating log file IO
    // 5) Stub electron-store — keep it from writing to disk
    // 6) Stub node-pty — native module, Node can't load it
    const noopStub = new Proxy(function () { }, {
        get: () => noopStub,
        apply: () => noopStub,
        construct: () => ({}),
    });

    const origLoad = Module._load;
    Module._load = function (request, parent, ...rest) {
        if (request === 'electron') return stubElectron;
        if (request === 'node:sqlite') return { DatabaseSync: class { constructor() { } exec() { } close() { } prepare() { return { get: () => null, all: () => [], run: () => ({ changes: 0, lastInsertRowid: 0 }), finalize: () => { } }; } } };
        if (request === 'electron-log/main' || request === 'electron-log') return { info: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
        if (request === 'electron-store') return class { constructor() { } get() { return {}; } set() { } };
        if (request === 'node-pty') return { spawn: () => ({ onData: () => { }, onExit: () => { } }) };
        // electron-updater's autoUpdater getter loads native bits and reads
        // electron.app.getVersion(); stub it so setupAutoUpdater's `??` fallback
        // doesn't trigger the real loader.
        if (request === 'electron-updater' || request === 'electron-updater/main') return { autoUpdater: {} };
        try {
            return origLoad.call(this, request, parent, ...rest);
        } catch (e) {
            // The patched copy lives in os.tmpdir(), so Node can't walk up to
            // the project's node_modules. When a bare specifier fails to
            // resolve from the temp copy, re-resolve it from the original
            // out/main location (which is what the original in-place script
            // effectively did).
            if (
                e &&
                e.code === 'MODULE_NOT_FOUND' &&
                parent &&
                parent.filename &&
                parent.filename.startsWith(tmpDir)
            ) {
                const resolved = require.resolve(request, { paths: [OUT_DIR] });
                return origLoad.call(this, resolved, parent, ...rest);
            }
            throw e;
        }
    };

    // 7) Run main bundle
    console.log('[smoke] requiring main bundle...');
    try {
        require(MAIN);
    } catch (e) {
        console.error('[smoke] FAILED during require:', e.message);
        if (e.stack) console.error(e.stack.split('\n').slice(0, 8).join('\n'));
        process.exitCode = 1;
        return;
    }

    // 8) setupIPC is registered inside app.whenReady().then() — our stub whenReady
    //    doesn't auto-invoke .then. Pull from ipcMain.handle list directly.
    //    The stub whenReady above didn't call .then, so setupIPC didn't run.
    //    Fix: replace whenReady so .then fires synchronously, then re-require.
    console.log('[smoke] app.whenReady() chain did not run in stub. Re-requiring with sync chain...');

    // Redo: drop the require cache and re-stub whenReady so .then fires sync.
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
            process.exitCode = 1;
            return;
        }
    }

    // 9) Report
    const handleDupes = calls.handle.filter((ch, i) => calls.handle.indexOf(ch) !== i);
    const onDupes = calls.on.filter((ch, i) => calls.on.indexOf(ch) !== i);

    console.log('\n[smoke] === 结果 ===');
    console.log(`  ipcMain.handle 调用次数: ${calls.handle.length}, unique: ${new Set(calls.handle).size}`);
    console.log(`  ipcMain.on 调用次数:    ${calls.on.length}, unique: ${new Set(calls.on).size}`);

    if (handleDupes.length || onDupes.length) {
        console.error('[smoke] ❌ 发现重复:');
        if (handleDupes.length) console.error('  handle:', handleDupes);
        if (onDupes.length) console.error('  on:', onDupes);
        process.exitCode = 1;
        return;
    }
    console.log('[smoke] ✅ C1 修复 runtime 验证通过 — 无重复 IPC 通道');
    console.log('[smoke]    (handle channels:', calls.handle.join(', '), ')');
    console.log('[smoke]    (on channels:', calls.on.join(', '), ')');
}
