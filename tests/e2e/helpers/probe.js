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
        const state = await import('/js/core/state.js');
        const layer = state.getActiveLayer?.() || state.getLayers?.().at(-1);
        if (!layer) return null;
        if (layer.type === 'spatial-chunked' || layer.storage === 'workspace') return 'chunked';
        if (layer._streamImport || layer.source?.streamed) return 'streamed';
        if (layer.type === 'spatial') return 'memory';
        return layer.type || null;
    });
}

/**
 * Export active layer as GeoJSON via UI and parse in Node.
 * @param {import('@playwright/test').Page} page
 * @param {string} downloadDir
 */
export async function exportActiveLayerGeoJSON(page, downloadDir) {
    await fs.mkdir(downloadDir, { recursive: true });

    const exportToggle = page.getByRole('button', { name: /^Export/ });
    const geoBtn = page.getByRole('button', { name: 'GeoJSON', exact: true });
    if (!(await geoBtn.isVisible().catch(() => false))) {
        await exportToggle.scrollIntoViewIfNeeded();
        await exportToggle.click({ force: true });
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await geoBtn.click();
    const download = await downloadPromise;
    const outPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(outPath);
    const text = await fs.readFile(outPath, 'utf8');
    return JSON.parse(text);
}
