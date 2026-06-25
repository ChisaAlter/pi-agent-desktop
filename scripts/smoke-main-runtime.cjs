// Smoke test: read-only verify the built Electron main bundle can register
// IPC handlers and the localfile protocol under Electron stubs.
//
// This script must NOT mutate out/ artifacts. It only loads the compiled
// bundle with minimal runtime stubs and fails fast on duplicate channels or
// missing protocol registration.

const Module = require("module");
const path = require("path");

const OUT_DIR = path.resolve(__dirname, "..", "apps", "desktop", "out", "main");
const MAIN = path.join(OUT_DIR, "index.js");

const calls = {
    handle: [],
    on: [],
    protocol: [],
    fetches: [],
};

let readyPromise = Promise.resolve();

function fail(stage, error, lines = 12) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[smoke] FAILED during ${stage}:`, message);
    if (error && error.stack) {
        console.error(String(error.stack).split("\n").slice(0, lines).join("\n"));
    }
    process.exit(1);
}

function trackUnique(list, value, label) {
    if (list.includes(value)) {
        throw new Error(`Attempted to register a second ${label} for "${value}"`);
    }
    list.push(value);
}

const noopStub = new Proxy(function () { }, {
    get: () => noopStub,
    apply: () => noopStub,
    construct: () => ({}),
});

const storeMemory = new Map();

const stubElectron = {
    ipcMain: {
        handle(channel, _fn) {
            trackUnique(calls.handle, channel, "handler");
        },
        on(channel, _fn) {
            trackUnique(calls.on, channel, "listener");
        },
        removeHandler() { },
        removeAllListeners() { },
    },
    protocol: {
        handle(scheme, _handler) {
            trackUnique(calls.protocol, scheme, "protocol handler");
        },
    },
    net: {
        fetch(url) {
            calls.fetches.push(String(url));
            return Promise.resolve(new Response("ok", { status: 200 }));
        },
    },
    app: {
        whenReady() {
            return {
                then(callback) {
                    readyPromise = Promise.resolve().then(() => callback());
                    return readyPromise;
                },
                catch() {
                    return readyPromise;
                },
            };
        },
        on() { },
        quit() { },
        exit() { },
        getPath(name) {
            return path.join(process.cwd(), ".smoke-runtime", String(name ?? "unknown"));
        },
        setAppUserModelId() { },
        requestSingleInstanceLock() {
            return true;
        },
        releaseSingleInstanceLock() { },
        disableHardwareAcceleration() { },
        isPackaged: false,
        commandLine: {
            appendSwitch() { },
        },
    },
    BrowserWindow: class {
        constructor() {
            this.webContents = {
                send() { },
                setZoomFactor() { },
                getURL() {
                    return "file:///index.html";
                },
            };
        }

        on() {
            return this;
        }

        once() {
            return this;
        }

        show() { }

        loadURL() {
            return Promise.resolve();
        }

        loadFile() {
            return Promise.resolve();
        }

        isDestroyed() {
            return false;
        }

        static getAllWindows() {
            return [];
        }
    },
    dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    },
    shell: {
        openExternal: async () => undefined,
        openPath: async () => "",
    },
    clipboard: {
        writeText() { },
        readText() {
            return "";
        },
    },
    nativeTheme: {
        shouldUseDarkColors: false,
        themeSource: "light",
        on() { },
        removeListener() { },
    },
    Menu: {
        buildFromTemplate() {
            return {};
        },
        setApplicationMenu() { },
    },
    nativeImage: {
        createFromPath() {
            return {};
        },
        createEmpty() {
            return {};
        },
    },
    screen: {
        getPrimaryDisplay() {
            return {
                workAreaSize: { width: 1280, height: 800 },
            };
        },
    },
};

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
    if (request === "electron") return stubElectron;
    if (request === "node:sqlite") return {};
    if (request === "electron-log/main" || request === "electron-log") {
        return {
            initialize() { },
            info() { },
            warn() { },
            error() { },
            debug() { },
            transports: {
                file: {},
            },
        };
    }
    if (request === "electron-store") {
        return class {
            constructor(opts = {}) {
                this.memory = { ...(opts.defaults ?? {}) };
            }

            get(key) {
                if (typeof key === "undefined") return this.memory;
                return this.memory[key];
            }

            set(key, value) {
                if (typeof key === "string") {
                    this.memory[key] = value;
                    return;
                }
                Object.assign(this.memory, key);
            }
        };
    }
    if (request === "node-pty") {
        return {
            spawn: () => ({
                onData() { },
                onExit() { },
                kill() { },
                write() { },
                resize() { },
            }),
        };
    }
    if (request === "better-sqlite3") {
        return class {
            prepare() {
                return {
                    run() { return {}; },
                    get() { return undefined; },
                    all() { return []; },
                };
            }
            exec() { }
            pragma() { }
            close() { }
        };
    }
    if (request === "sharp") return noopStub;
    if (request === "keytar") return { getPassword: async () => null, setPassword: async () => undefined, deletePassword: async () => true };
    if (request === "pi-openplan") return noopStub;
    if (request === "pi-permission-system") return noopStub;
    return origLoad.call(this, request, parent, ...rest);
};

(async () => {
    console.log("[smoke] requiring main bundle (read-only)...");
    try {
        require(MAIN);
        await readyPromise;
    } catch (error) {
        fail("require/whenReady", error);
    } finally {
        Module._load = origLoad;
    }

    const handleDupes = calls.handle.filter((channel, index) => calls.handle.indexOf(channel) !== index);
    const onDupes = calls.on.filter((channel, index) => calls.on.indexOf(channel) !== index);
    const protocolDupes = calls.protocol.filter((scheme, index) => calls.protocol.indexOf(scheme) !== index);

    console.log("\n[smoke] === result ===");
    console.log(`  ipcMain.handle registrations: ${calls.handle.length}`);
    console.log(`  ipcMain.on registrations:      ${calls.on.length}`);
    console.log(`  protocol.handle registrations: ${calls.protocol.length}`);

    if (handleDupes.length || onDupes.length || protocolDupes.length) {
        console.error("[smoke] duplicate registrations detected");
        if (handleDupes.length) console.error("  handle:", handleDupes);
        if (onDupes.length) console.error("  on:", onDupes);
        if (protocolDupes.length) console.error("  protocol:", protocolDupes);
        process.exit(1);
    }

    if (!calls.protocol.includes("localfile")) {
        console.error("[smoke] localfile protocol was not registered");
        process.exit(1);
    }

    console.log("[smoke] OK main runtime registration verified");
    console.log("[smoke] protocol:", calls.protocol.join(", "));
    console.log("[smoke] handle channels:", calls.handle.join(", "));
})();
