import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import generated from '../../fixtures/e2e/generated/manifest.json' with { type: 'json' };
import { bootApp } from '../helpers/app.js';
import { importLocalFile, cancelImportAtProgress } from '../helpers/import.js';
import { readImportStorageSnapshot, storageLooksEmpty } from '../helpers/storage-probe.js';
import { installLongTaskObserver } from '../helpers/perf.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';

const genDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/e2e/generated');
const t3 = generated.fixtures.find((f) => f.id === 'T3-stream-120k');

/** @type {Map<string, { basemapBlocked: string[], unexpectedBlocked: string[] }>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    installLongTaskObserver(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (guard) assertNoUnexpectedBlocks(guard);
});

test('@full cancel T3 stream import at ~30%', async ({ page }) => {
    test.setTimeout(600_000);
    if (!t3) {
        test.skip(true, 'T3-stream-120k fixture missing — run gen-e2e-fixtures');
    }
    const fixturePath = path.join(genDir, t3.file);
    await bootApp(page, '/');

    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'Local Files' }).click();
    await page.getByRole('button', { name: 'Add local file' }).click();
    await page.locator('.modal-body input[type="file"]').first().setInputFiles(fixturePath);

    const importBtn = page.getByRole('button', { name: 'Import selected' });
    await importBtn.waitFor({ state: 'visible', timeout: 120_000 });
    await importBtn.click();

    await page
        .locator('.modal-header span')
        .filter({ hasText: 'Importing Large Files' })
        .waitFor({ state: 'visible', timeout: 120_000 });

    await cancelImportAtProgress(page, 28, 480_000);

    await page.waitForTimeout(1500);
    let snap = await readImportStorageSnapshot(page);
    expect(storageLooksEmpty(snap), 'storage after cancel').toBe(true);

    await page.locator('#btn-import').waitFor({ state: 'visible', timeout: 30_000 });
    const t0 = Date.now();
    await importLocalFile(page, fixturePath, { timeoutMs: 540_000 });
    expect(Date.now() - t0).toBeLessThan(540_000);

    const layers = await page.locator('.layer-list-items .layer-item').count();
    expect(layers).toBeGreaterThan(0);
});
