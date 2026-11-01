import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import manifest from '../../fixtures/e2e/tune/manifest.json' with { type: 'json' };
import { bootApp, dismissOpenModals } from '../helpers/app.js';
import { importLocalFile, expectImportFailure } from '../helpers/import.js';
import {
    exportActiveLayerGeoJSON,
    exportActiveLayerGpx,
    countGpxMaterializedFeatures,
    readLayerListFeatureCount
} from '../helpers/probe.js';
import { assertFeatureCollection, assertRoundTrip } from '../helpers/geo-assert.js';
import { installLongTaskObserver, buildPerfRow, importWallMs } from '../helpers/perf.js';
import {
    attachNetworkGuard,
    assertNoUnexpectedBlocks
} from '../helpers/network-guard.js';
import { installE2eBrowserShims } from '../helpers/e2e-browser-shims.js';

const tuneDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/e2e/tune');
const downloadDir = path.join(process.cwd(), 'test-results/e2e-downloads');

/** @type {Map<string, { basemapBlocked: string[], unexpectedBlocked: string[] }>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    await installE2eBrowserShims(context);
    installLongTaskObserver(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (guard) {
        assertNoUnexpectedBlocks(guard);
        const logPath = path.join(process.cwd(), 'test-results/gis-report/network-log.jsonl');
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.appendFile(
            logPath,
            `${JSON.stringify({
                test: testInfo.title,
                basemapBlocked: guard.basemapBlocked,
                telemetryBlocked: guard.telemetryBlocked,
                unexpectedBlocked: guard.unexpectedBlocked
            })}\n`
        );
    }
});

const fixtures = manifest.fixtures.filter((f) => f.tag === '@tune');

for (const fx of fixtures) {
    test(`@tune ${fx.id}`, async ({ page }, testInfo) => {
        if (fx.knownBug) {
            test.skip(true, fx.knownBug);
        }
        test.setTimeout(fx.format === 'gpx' ? 240_000 : fx.tier === 'T1' ? 240_000 : 120_000);
        const fixturePath = path.join(tuneDir, fx.file);
        await bootApp(page, '/');

        if (fx.format === 'gis-toolbox' || fx.file.endsWith('.gis-toolbox') || fx.file.endsWith('.gtbx')) {
            await importLocalFile(page, fixturePath, { projectKit: true, crsPick: fx.crsPick });
        } else if (fx.expectedOutcome === 'failure') {
            await page.locator('#btn-import').click();
            await page.getByRole('button', { name: 'Local Files' }).click();
            await page.getByRole('button', { name: 'Add local file' }).click();
            await page.locator('.modal-body input[type="file"]').first().setInputFiles(fixturePath);
            const importBtn = page.getByRole('button', { name: 'Import selected' });
            if (await importBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await importBtn.click();
                await maybeCrs(page, fx.crsPick);
            }
            await expectImportFailure(page);
            await dismissOpenModals(page);
            const perfRow = await buildPerfRow(page, { fixtureId: fx.id, importMs: 0 });
            testInfo.annotations.push({ type: 'perf-row', description: JSON.stringify(perfRow) });
            return;
        } else {
            const timing = await importLocalFile(page, fixturePath, { crsPick: fx.crsPick });
            testInfo.annotations.push({
                type: 'import-ms',
                description: String(importWallMs(timing))
            });
        }

        await dismissOpenModals(page);

        const listCount = await readLayerListFeatureCount(page, fx.file);
        if (fx.expectedOutcome === 'success' && fx.featureCount > 0) {
            expect(listCount, `layer list count for ${fx.id}`).toBe(fx.featureCount);
        }

        if (fx.format === 'gpx' && fx.expectedOutcome === 'success') {
            const gpxText = await exportActiveLayerGpx(page, path.join(downloadDir, `${fx.id}-gpx`), {
                featureCount: fx.featureCount
            });
            expect(countGpxMaterializedFeatures(gpxText), `GPX export count for ${fx.id}`).toBe(
                fx.featureCount
            );
        }

        if (fx.expectedOutcome === 'success' && fx.featureCount > 0 && fx.format !== 'gpx') {
            const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, fx.id));
            assertFeatureCollection(exported, fx);

            if (fx.roundTrip) {
                const original = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
                assertRoundTrip(exported, original);
            }
        }

        const importAnn = testInfo.annotations.find((a) => a.type === 'import-ms');
        const perfRow = await buildPerfRow(page, {
            fixtureId: fx.id,
            importMs: importAnn ? Number(importAnn.description) : 0
        });
        testInfo.annotations.push({ type: 'perf-row', description: JSON.stringify(perfRow) });
    });
}

/** @param {import('@playwright/test').Page} page @param {string|null|undefined} crsPick */
async function maybeCrs(page, crsPick) {
    const visible = await page
        .locator('.modal-body')
        .filter({ hasText: 'Projected coordinates' })
        .first()
        .isVisible({ timeout: 8000 })
        .catch(() => false);
    if (!visible) return;
    const code = crsPick || 'EPSG:26912';
    const textInput = page.locator('.modal-body input[type="text"]').last();
    await textInput.fill(code);
    await page.getByRole('button', { name: 'Confirm CRS' }).click();
}
