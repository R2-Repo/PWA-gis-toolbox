import { dismissOpenModals, dismissToasts } from './app.js';

/**
 * Open ArcGIS REST importer and run a custom URL import through the field picker.
 * @param {import('@playwright/test').Page} page
 * @param {string} layerUrl
 * @param {{ timeoutMs?: number }} [options]
 */
export async function importArcgisRestUrl(page, layerUrl, options = {}) {
    const timeoutMs = options.timeoutMs ?? 180_000;
    await dismissToasts(page);
    await dismissOpenModals(page);

    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'ArcGIS REST' }).click();
    await page.locator('#arcgis-custom-url-react').fill(layerUrl);
    const t0 = Date.now();
    await page.locator('#arcgis-custom-import-react').click();

    const fieldModal = page.locator('.modal-header span').filter({ hasText: 'ArcGIS attributes' });
    await fieldModal.waitFor({ state: 'visible', timeout: timeoutMs });
    await page.getByRole('button', { name: 'Continue' }).click();

    await waitForArcgisImportSettled(page, timeoutMs);
    return { startedAtMs: t0, finishedAtMs: Date.now() };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} timeoutMs
 */
async function waitForArcgisImportSettled(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const layers = await page.locator('.layer-list-items .layer-item').count();
        const successToast = page.locator('.toast-container .toast').filter({ hasText: /Imported .* features/i });
        const failToast = page.locator('.toast-container .toast').filter({ hasText: /error|failed|invalid|token|timed out/i });
        const fieldError = page.locator('.import-field-picker').filter({ hasText: /failed/i });

        if (await successToast.isVisible().catch(() => false)) {
            const toastText = await successToast.innerText();
            if (layers > 0 || /Imported 0 features/i.test(toastText)) {
                await page.waitForTimeout(300);
                return { outcome: 'success' };
            }
        }
        if (await failToast.isVisible().catch(() => false)) {
            return { outcome: 'failure' };
        }
        if (await fieldError.isVisible().catch(() => false)) {
            return { outcome: 'failure' };
        }
        await page.waitForTimeout(200);
    }
    throw new Error('ArcGIS import timed out');
}

/** @param {import('@playwright/test').Page} page @param {string} layerUrl */
export async function importArcgisRestUrlExpectFailure(page, layerUrl) {
    await dismissToasts(page);
    await dismissOpenModals(page);
    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'ArcGIS REST' }).click();
    await page.locator('#arcgis-custom-url-react').fill(layerUrl);
    await page.locator('#arcgis-custom-import-react').click();
    const fieldModal = page.locator('.modal-header span').filter({ hasText: 'ArcGIS attributes' });
    await fieldModal.waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectArcgisImportError(page);
}

/** @param {import('@playwright/test').Page} page */
export async function expectArcgisImportError(page) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const message = page.getByText(
            /Invalid query|Import failed|Service returned an error|Server returned HTTP|Invalid token|timed out|Cannot reach|remote server|Server Error|Request Error|rejected the request|Parsing Error|could not be parsed/i
        );
        if (await message.first().isVisible().catch(() => false)) {
            const layers = await page.locator('.layer-list-items .layer-item').count();
            if (layers > 0) {
                throw new Error('Expected ArcGIS error without new layer');
            }
            return;
        }
        await page.waitForTimeout(200);
    }
    throw new Error('Expected ArcGIS import error (toast or modal) did not appear');
}

/**
 * Start import and cancel during slow query progress.
 * @param {import('@playwright/test').Page} page
 * @param {string} layerUrl
 */
export async function startArcgisImportAndCancel(page, layerUrl) {
    await dismissToasts(page);
    await dismissOpenModals(page);
    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'ArcGIS REST' }).click();
    await page.locator('#arcgis-custom-url-react').fill(layerUrl);
    await page.locator('#arcgis-custom-import-react').click();
    await page.locator('.modal-header span').filter({ hasText: 'ArcGIS attributes' }).waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    const cancelBtn = page.locator('.modal-overlay:visible').getByRole('button', { name: 'Cancel' }).first();
    await cancelBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(500);
    await cancelBtn.click();
    await dismissToasts(page);
}

/** @param {import('geojson').FeatureCollection} fc */
export function assertLonLat4326(fc) {
    for (const f of fc.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const coords = JSON.stringify(g.coordinates);
        const nums = coords.match(/-?\d+\.?\d*/g)?.map(Number) || [];
        for (const n of nums) {
            if (Math.abs(n) > 180 && g.type === 'Point') {
                throw new Error(`Coordinate out of lon/lat range: ${n}`);
            }
        }
        if (g.type === 'Point') {
            const [lon, lat] = g.coordinates;
            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                throw new Error(`Invalid lon/lat: ${lon}, ${lat}`);
            }
        }
    }
}

/** @param {import('@playwright/test').Page} page */
export async function readActiveLayerMapStyle(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('gis-toolbox-sessions');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
        });
        try {
            const stylesMeta = await new Promise((resolve, reject) => {
                const tx = db.transaction('meta', 'readonly');
                const req = tx.objectStore('meta').get('layerStyles');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const styles = stylesMeta?.data || {};
            const keys = Object.keys(styles);
            return keys.length ? styles[keys[keys.length - 1]] : null;
        } finally {
            db.close();
        }
    });
}

/** @deprecated use readActiveLayerMapStyle */
export async function readSessionArcgisStyle(page) {
    return readActiveLayerMapStyle(page);
}
