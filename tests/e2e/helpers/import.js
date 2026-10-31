/**
 * @param {import('@playwright/test').Page} page
 * @param {string} fixturePath absolute path to file
 * @param {{ crsPick?: string|null, timeoutMs?: number }} [options]
 */
export async function importLocalFile(page, fixturePath, options = {}) {
    const timeoutMs = options.timeoutMs ?? 120_000;

    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'Local Files' }).click();
    await page.getByRole('button', { name: 'Add local file' }).click();

    const fileInput = page.locator('.modal-body input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath);

    const t0 = Date.now();

    const importLabel = options.projectKit ? 'Import Toolbox project' : 'Import selected';
    await page.getByRole('button', { name: importLabel }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: importLabel }).click();

    await maybeConfirmCrs(page, options.crsPick);

    await waitForImportSettled(page, timeoutMs);

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
async function waitForImportSettled(page, timeoutMs) {
    const failTitle = page.locator('.modal-header span').filter({ hasText: 'Import Failed' });
    const progress = page.locator('.progress-step');
    const importBtn = page.getByRole('button', { name: 'Import selected' });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await failTitle.isVisible().catch(() => false)) {
            return { outcome: 'failure' };
        }
        const layerCount = await page.locator('.layer-list-items .layer-item').count();
        if (layerCount > 0 && !(await progress.first().isVisible().catch(() => false))) {
            if (await importBtn.isVisible().catch(() => false)) {
                // import dialog still open — ok once layer exists
            }
            return { outcome: 'success' };
        }
        const toastError = page.locator('.toast-container .toast').filter({ hasText: /import/i });
        if (await toastError.isVisible().catch(() => false)) {
            const text = await toastError.innerText();
            if (/failed|error|invalid/i.test(text)) {
                return { outcome: 'failure' };
            }
        }
        await page.waitForTimeout(250);
    }
    throw new Error('Import timed out');
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
