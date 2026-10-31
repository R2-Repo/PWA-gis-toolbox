/** @param {import('@playwright/test').Page} page @param {string} [origin] */
export async function resetAppStorage(page, origin = 'http://127.0.0.1:5175') {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        localStorage.clear();
        sessionStorage.clear();
        const names = [
            'gis-toolbox-sessions',
            'gis-toolbox-workspace',
            'gis-toolbox-import-checkpoints',
            'gis-toolbox-workflow',
            'gis-toolbox-tile-cache'
        ];
        await Promise.all(
            names.map(
                (name) =>
                    new Promise((resolve) => {
                        const req = indexedDB.deleteDatabase(name);
                        req.onsuccess = () => resolve();
                        req.onerror = () => resolve();
                        req.onblocked = () => resolve();
                    })
            )
        );
    });
}

/**
 * Boot app, dismiss splash guide and session-restore prompts.
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 */
export async function bootApp(page, baseURL) {
    await resetAppStorage(page, baseURL);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const closeGuide = page.locator('.modal-overlay--splash .close-modal');
    await closeGuide.first().waitFor({ state: 'visible', timeout: 60_000 });
    await closeGuide.first().click();

    const restoreCancel = page.locator('.modal-footer .cancel-btn').filter({ hasText: 'Cancel' });
    if (await restoreCancel.isVisible({ timeout: 3000 }).catch(() => false)) {
        await restoreCancel.click();
    }

    await page.locator('#btn-import').waitFor({ state: 'visible', timeout: 30_000 });
}

/** Dismiss stacked modal dialogs (import summary, etc.). */
export async function dismissOpenModals(page) {
    for (let i = 0; i < 5; i++) {
        const close = page.locator('.modal-overlay:visible .close-modal').first();
        if (!(await close.isVisible({ timeout: 500 }).catch(() => false))) break;
        await close.click();
        await page.waitForTimeout(150);
    }
}
