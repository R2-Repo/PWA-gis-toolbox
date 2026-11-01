import { test, expect } from '@playwright/test';
import { bootApp, dismissOpenModals, dismissToasts } from '../helpers/app.js';
import { importLocalFile, cancelImportAtProgress } from '../helpers/import.js';
import { readImportStorageSnapshot, storageLooksEmpty } from '../helpers/storage-probe.js';
import { installLongTaskObserver } from '../helpers/perf.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';
import { ensureGeneratedFixture } from '../helpers/generated-fixtures.js';

/** @type {{ fixturePath: string } | null} */
let t3Ready = null;

test.beforeAll(async () => {
    t3Ready = await ensureGeneratedFixture('T3-stream-120k');
});

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
    const fixturePath = t3Ready?.fixturePath;
    if (!fixturePath) {
        throw new Error('T3-stream-120k fixture was not prepared in beforeAll');
    }
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

    await cancelImportAtProgress(page, 30, 480_000);

    let snap = null;
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(500);
        snap = await readImportStorageSnapshot(page);
        if (storageLooksEmpty(snap)) break;
    }
    expect(storageLooksEmpty(snap), `storage after cancel ${JSON.stringify(snap)}`).toBe(true);
    expect(snap?.layerDom ?? 0).toBe(0);

    await dismissToasts(page);
    await dismissOpenModals(page);
    await page.locator('#btn-import').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#btn-import').click({ trial: true });
    const t0 = Date.now();
    await importLocalFile(page, fixturePath, { timeoutMs: 540_000 });
    expect(Date.now() - t0).toBeLessThan(540_000);

    const layers = await page.locator('.layer-list-items .layer-item').count();
    expect(layers).toBeGreaterThan(0);
});
