/**
 * Playwright E2E configuration for Pi Desktop (Electron).
 *
 * Uses the `_electron` API (no browser launch) — Playwright drives the
 * compiled main process at `out/main/index.js` directly via the Electron
 * binary shipped in apps/desktop/node_modules.
 *
 * Prerequisite: `pnpm --filter @pi-desktop/desktop build` (the spec expects
 * the built main process to exist; main is bundled to out/main/index.js and
 * the renderer is loaded from out/renderer/index.html).
 */
import { defineConfig } from '@playwright/test';
import { join } from 'path';

const DESKTOP_DIR = __dirname;
const MAIN_ENTRY = join(DESKTOP_DIR, 'out', 'main', 'index.js');

export default defineConfig({
    testDir: './e2e',
    // Spec files: *.spec.ts under ./e2e
    testMatch: /.*\.spec\.ts$/,
    // Skip any *.spec.ts that is a vitest placeholder (e.g. the
    // `a11y.spec.ts` shipped by the observability task) — they import
    // from "vitest" and are not yet wired to the Playwright runner.
    // Real Playwright e2e specs use `import { test, expect, _electron }`
    // from '@playwright/test'.
    testIgnore: /a11y\.spec\.ts$/,
    // Electron is single-instance by design; do not run specs in parallel.
    fullyParallel: false,
    workers: 1,
    // Electron cold start can take a while on Windows.
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    reporter: process.env.CI
        ? [['list'], ['github']]
        : 'list',
    use: {
        trace: 'retain-on-failure',
    },
    // Output directory for traces / screenshots / videos on failure.
    outputDir: join(DESKTOP_DIR, 'e2e-output'),
});

/**
 * Helper for spec files: returns the absolute path to the compiled main
 * process entry. Kept in the config file so the path is the single source
 * of truth across the suite.
 */
export const electronMainEntry = MAIN_ENTRY;
