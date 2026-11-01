import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} [layerNameSubstring]
 */
export async function readLayerListFeatureCount(page, layerNameSubstring) {
    const items = page.locator('.layer-list-items .layer-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const name = await item.locator('.layer-name').innerText();
        if (layerNameSubstring && !name.includes(layerNameSubstring.replace(/\.[^.]+$/, ''))) {
            continue;
        }
        const meta = await item.locator('.layer-meta-text').innerText();
        const m = meta.match(/^([\d,]+)\s+features/);
        if (m) return Number(m[1].replace(/,/g, ''));
    }
    if (count > 0) {
        const meta = await items.last().locator('.layer-meta-text').innerText();
        const m = meta.match(/^([\d,]+)\s+features/);
        if (m) return Number(m[1].replace(/,/g, ''));
    }
    return 0;
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<'chunked'|'memory'|'streamed'|string|null>}
 */
export async function readActiveLayerAdmission(page) {
    return page.evaluate(async () => {
        async function openWorkspace() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open('gis-toolbox-workspace');
                req.onerror = () => reject(req.error);
                req.onsuccess = () => resolve(req.result);
            });
        }

        async function getAll(storeName) {
            const db = await openWorkspace();
            try {
                if (!db.objectStoreNames.contains(storeName)) return [];
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, 'readonly');
                    const req = tx.objectStore(storeName).getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
            } finally {
                db.close();
            }
        }

        const layers = await getAll('layers');
        const chunks = await getAll('chunks');
        if (layers.length === 0 && chunks.length === 0) return 'memory';

        const layer = layers[layers.length - 1];
        if (!layer) return chunks.length > 0 ? 'chunked' : 'memory';
        if (layer.type === 'spatial-chunked' || layer.storage === 'workspace') return 'chunked';
        if (layer._streamImport || layer.source?.streamed) return 'streamed';
        if (layer.type === 'spatial') return 'memory';
        return chunks.length > 0 ? 'chunked' : layer.type || 'memory';
    });
}

async function openExportSection(page) {
    const header = page.locator('.panel-section-header').filter({ hasText: 'Export' }).first();
    if (await header.isVisible().catch(() => false)) {
        const collapsed = await header.evaluate((el) => el.classList.contains('collapsed'));
        if (collapsed) await header.click();
    }
}

/**
 * Export active layer as GeoJSON via UI and parse in Node.
 * @param {import('@playwright/test').Page} page
 * @param {string} downloadDir
 */
export async function exportActiveLayerGeoJSON(page, downloadDir) {
    await fs.mkdir(downloadDir, { recursive: true });
    await openExportSection(page);

    const geoBtn = page.getByRole('button', { name: 'GeoJSON', exact: true });
    if (!(await geoBtn.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: /^Export/ }).first().click({ force: true });
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await geoBtn.click();
    const download = await downloadPromise;
    const outPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(outPath);
    const text = await fs.readFile(outPath, 'utf8');
    return JSON.parse(text);
}

/** @param {import('@playwright/test').Page} page @param {number} timeoutMs */
async function pollCapturedBlobText(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const text = await page.evaluate(() => {
            const q = window.__gisE2eBlobTexts;
            return q && q.length ? q.shift() : null;
        });
        if (text) return text;
        await page.waitForTimeout(100);
    }
    return null;
}

/** @param {import('@playwright/test').Page} page @param {number} [targetFeatureCount] */
async function selectLayerForExport(page, targetFeatureCount) {
    const items = page.locator('.layer-list-items .layer-item');
    const count = await items.count();
    /** @type {{ item: import('@playwright/test').Locator, n: number } | null} */
    let best = null;
    for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const meta = await item.locator('.layer-meta-text').innerText().catch(() => '');
        const m = meta.match(/([\d,]+)\s+features/i);
        if (!m) continue;
        const n = Number(m[1].replace(/,/g, ''));
        if (targetFeatureCount != null && n === targetFeatureCount) {
            await item.click();
            return;
        }
        if (!best || n > best.n) best = { item, n };
    }
    if (best) {
        await best.item.click();
    } else if (count > 0) {
        await items.last().click();
    }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} downloadDir
 * @param {{ featureCount?: number }} [options]
 */
export async function exportActiveLayerGpx(page, downloadDir, options = {}) {
    await fs.mkdir(downloadDir, { recursive: true });
    await selectLayerForExport(page, options.featureCount);
    await openExportSection(page);
    const gpxBtn = page.getByRole('button', { name: 'GPX', exact: true });
    if (!(await gpxBtn.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: /^Export/ }).first().click({ force: true });
    }
    await gpxBtn.waitFor({ state: 'visible', timeout: 15_000 });
    const exportTimeout = 60_000;
    const downloadPromise = page.waitForEvent('download', { timeout: exportTimeout }).catch(() => null);
    await gpxBtn.click();
    const download = await downloadPromise;
    if (download) {
        const outPath = path.join(downloadDir, download.suggestedFilename());
        await download.saveAs(outPath);
        return fs.readFile(outPath, 'utf8');
    }
    const captured = await pollCapturedBlobText(page, exportTimeout);
    if (!captured) {
        const toast = await page
            .locator('.toast-container .toast')
            .last()
            .innerText()
            .catch(() => '');
        throw new Error(
            `GPX export produced no download or blob capture${toast ? `: ${toast}` : ''}`
        );
    }
    return captured;
}

/** Materialized map features represented in exported GPX (wpt + trk + rte). */
export function countGpxMaterializedFeatures(gpxText) {
    const wpt = (gpxText.match(/<wpt[\s>]/g) || []).length;
    const trk = (gpxText.match(/<trk[\s>]/g) || []).length;
    const rte = (gpxText.match(/<rte[\s>]/g) || []).length;
    return wpt + trk + rte;
}
