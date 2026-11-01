import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHIM_OUT = path.join(ROOT, 'test-results/e2e-togpx-shim.js');
const SHIM_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'togpx-shim-entry.js');
const BLOB_HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blob-download-hook.js');

/** @type {Promise<void>|null} */
let buildPromise = null;

async function ensureTogpxShimBuilt() {
    if (!buildPromise) {
        buildPromise = (async () => {
            await fs.mkdir(path.dirname(SHIM_OUT), { recursive: true });
            const [outStat, entryStat] = await Promise.all([
                fs.stat(SHIM_OUT).catch(() => null),
                fs.stat(SHIM_ENTRY)
            ]);
            if (!outStat || outStat.mtimeMs < entryStat.mtimeMs) {
                buildSync({
                    entryPoints: [SHIM_ENTRY],
                    bundle: true,
                    format: 'iife',
                    outfile: SHIM_OUT,
                    platform: 'browser',
                    logLevel: 'silent'
                });
            }
        })();
    }
    await buildPromise;
}

/** @param {import('@playwright/test').BrowserContext} context */
export async function installE2eBrowserShims(context) {
    await ensureTogpxShimBuilt();
    await context.addInitScript({ path: SHIM_OUT });
    await context.addInitScript({ path: BLOB_HOOK });
}
