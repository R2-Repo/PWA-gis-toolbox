import { dismissOpenModals, dismissToasts } from './app.js';

async function maybeConfirmProjectKit(page) {
    const header = page.locator('.modal-header span').filter({ hasText: /Import .*gis-toolbox/i });
    await header.waitFor({ state: 'visible', timeout: 60_000 });
    const kit = page.locator('.project-kit-dialog');
    await kit.locator('input[type="radio"]').last().check();
    await kit.getByRole('button', { name: 'Import' }).click();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} fixturePath absolute path to file
 * @param {{ crsPick?: string|null, timeoutMs?: number, projectKit?: boolean }} [options]
 */
export async function importLocalFile(page, fixturePath, options = {}) {
    const timeoutMs = options.timeoutMs ?? 120_000;

    await dismissToasts(page);
    await dismissOpenModals(page);

    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'Local Files' }).click();
    await page.getByRole('button', { name: 'Add local file' }).click();

    const fileInput = page.locator('.modal-body input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath);

    const t0 = Date.now();

    const importLabel = options.projectKit ? 'Import Toolbox project' : 'Import selected';
    await page.getByRole('button', { name: importLabel }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: importLabel }).click();

    if (options.projectKit) {
        await maybeConfirmProjectKit(page);
    }

    await maybeConfirmCrs(page, options.crsPick);

    const settled = await waitForImportSettled(page, timeoutMs, options.crsPick);
    if (settled.outcome !== 'success') {
        throw new Error(`Import did not succeed (${settled.outcome})`);
    }

    return { startedAtMs: t0, finishedAtMs: Date.now() };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string|null|undefined} crsPick
 */
async function maybeConfirmCrs(page, crsPick) {
    const crsBody = page.locator('.modal-body').filter({ hasText: /Projected coordinates|coordinate system/i });
    const visible = await crsBody.first().isVisible({ timeout: 15_000 }).catch(() => false);
    if (!visible) return;

    const code = crsPick || 'EPSG:26912';
    await page.locator('.crs-picker-search').fill('26912');
    const select = page.locator('.crs-picker-select');
    await select.selectOption({ label: /26912/i }).catch(async () => {
        await page.locator('.modal-body input[type="text"]').last().fill(code);
    });
    await page.getByRole('button', { name: 'Confirm CRS' }).click();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} timeoutMs
 */
async function waitForImportSettled(page, timeoutMs, crsPick) {
    const failTitle = page.locator('.modal-header span').filter({ hasText: 'Import Failed' });
    const progress = page.locator('.progress-step');
    const importBtn = page.getByRole('button', { name: 'Import selected' });
    const streamProgress = page.locator('.modal-header span').filter({ hasText: 'Importing Large Files' });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await maybeConfirmCrs(page, crsPick);
        if (await failTitle.isVisible().catch(() => false)) {
            return { outcome: 'failure' };
        }
        const layerCount = await page.locator('.layer-list-items .layer-item').count();
        const busyProgress =
            (await progress.first().isVisible().catch(() => false))
            || (await streamProgress.isVisible().catch(() => false));
        const kitProgress = page.locator('.progress-step').filter({ hasText: /Importing Toolbox project/i });
        const kitBusy = await kitProgress.isVisible().catch(() => false);
        if (layerCount > 0 && !busyProgress && !kitBusy) {
            return { outcome: 'success' };
        }
        const importingNow =
            (await streamProgress.isVisible().catch(() => false))
            || (await progress.first().isVisible().catch(() => false));
        const toastError = page.locator('.toast-container .toast').filter({ hasText: /import/i });
        if (!importingNow && (await toastError.isVisible().catch(() => false))) {
            const text = await toastError.innerText();
            if (/failed|error|invalid|cancelled|too large|exceeds/i.test(text)) {
                return { outcome: 'failure' };
            }
        }
        await page.waitForTimeout(250);
    }
    throw new Error('Import timed out');
}

/**
 * Wait until the visible import progress reaches at least minPercent, then click Cancel.
 * @param {import('@playwright/test').Page} page
 * @param {number} minPercent
 * @param {number} timeoutMs
 */
export async function cancelImportAtProgress(page, minPercent, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const pctText = page.locator('.progress-bar-text').first();
        if (await pctText.isVisible().catch(() => false)) {
            const raw = await pctText.innerText();
            const pct = Number.parseInt(raw, 10);
            if (Number.isFinite(pct) && pct >= minPercent) {
                const cancelBtn = page.locator('.modal-overlay:visible').getByRole('button', { name: 'Cancel' }).first();
                await cancelBtn.click();
                await page.waitForTimeout(500);
                await dismissToasts(page);
                await page
                    .locator('.modal-header span')
                    .filter({ hasText: 'Importing Large Files' })
                    .waitFor({ state: 'hidden', timeout: 120_000 })
                    .catch(() => dismissOpenModals(page));
                return;
            }
        }
        await page.waitForTimeout(200);
    }
    throw new Error(`Import did not reach ${minPercent}% before timeout`);
}

/** @param {import('@playwright/test').Page} page */
export async function expectImportFailure(page) {
    const failModal = page.locator('.modal-header span').filter({ hasText: 'Import Failed' });
    const errorBox = page.locator('.import-flow .info-box');
    if (await failModal.isVisible({ timeout: 60_000 }).catch(() => false)) return;
    if (await errorBox.isVisible({ timeout: 5000 }).catch(() => false)) return;
    const layers = await page.locator('.layer-list-items .layer-item').count();
    if (layers === 0) return;
    throw new Error('Expected import failure but a layer was added');
}
