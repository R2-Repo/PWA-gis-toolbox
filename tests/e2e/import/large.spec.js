import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import generated from '../../fixtures/e2e/generated/manifest.json' with { type: 'json' };
import { bootApp, dismissOpenModals } from '../helpers/app.js';
import { importLocalFile, expectImportFailure } from '../helpers/import.js';
import { readLayerListFeatureCount, readActiveLayerAdmission } from '../helpers/probe.js';
import { installLongTaskObserver, buildPerfRow, importWallMs } from '../helpers/perf.js';
import {
    attachNetworkGuard,
    assertNoUnexpectedBlocks
} from '../helpers/network-guard.js';

const genDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/e2e/generated');

/** @type {Map<string, { basemapBlocked: string[], unexpectedBlocked: string[] }>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    installLongTaskObserver(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (guard) {
        assertNoUnexpectedBlocks(guard);
    }
});

const fixtures = generated.fixtures.filter((f) => f.tag === '@full');

for (const fx of fixtures) {
    test(`@full ${fx.id}`, async ({ page }, testInfo) => {
        test.setTimeout(fx.timeoutMs ?? (fx.tier === 'T3' ? 600_000 : 360_000));
        const fixturePath = path.join(genDir, fx.file);
        await bootApp(page, '/');

        if (fx.expectedOutcome === 'failure') {
            await page.locator('#btn-import').click();
            await page.getByRole('button', { name: 'Local Files' }).click();
            await page.getByRole('button', { name: 'Add local file' }).click();
            await page.locator('.modal-body input[type="file"]').first().setInputFiles(fixturePath);
            const importBtn = page.getByRole('button', { name: 'Import selected' });
            if (await importBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
                await importBtn.click();
            }
            await expectImportFailure(page);
            const layers = await page.locator('.layer-list-items .layer-item').count();
            expect(layers, 'no partial layer on refusal').toBe(0);
        } else {
            const timing = await importLocalFile(page, fixturePath, { timeoutMs: fx.timeoutMs ?? 360_000 });
            testInfo.annotations.push({
                type: 'import-ms',
                description: String(importWallMs(timing))
            });
            await dismissOpenModals(page);

            if (fx.featureCount > 0) {
                const listCount = await readLayerListFeatureCount(page, fx.file);
                expect(listCount, `layer list count for ${fx.id}`).toBe(fx.featureCount);
            }

            if (fx.workspaceExpect) {
                const admission = await readActiveLayerAdmission(page);
                expect(admission, `storage admission for ${fx.id}`).toBe(fx.workspaceExpect);
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
