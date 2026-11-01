#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { LIMITS, preflightByteBands } from '../js/import/import-limits.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN_DIR = path.join(ROOT, 'tests/fixtures/e2e/generated');

function makeRows(count, padLen = 48) {
    const rows = [];
    for (let i = 0; i < count; i++) {
        rows.push({
            latitude: 39 + i * 0.00001,
            longitude: -111 + i * 0.00001,
            id: i,
            name: `pt-${i}-${'n'.repeat(padLen)}`,
            unicode: `u-${'u'.repeat(Math.min(padLen, 32))}`
        });
    }
    return rows;
}

async function writeXlsx(filePath, rows) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'data');
    XLSX.writeFile(wb, filePath);
    return (await fs.stat(filePath)).size;
}

/** Grow row count until size in [target-512, cap) or size > target for over. */
async function sizeToTarget(filePath, targetBytes, over, cap) {
    if (over) {
        let lo = 40;
        let hi = 120_000;
        let best = 0;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const size = await writeXlsx(filePath, makeRows(mid, 64));
            if (size > targetBytes) {
                best = size;
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }
        return best;
    }
    let lo = 40;
    let hi = 120_000;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const size = await writeXlsx(filePath, makeRows(mid, 64));
        if (cap != null && size >= cap) {
            hi = mid - 1;
        } else if (size >= targetBytes - 512) {
            return size;
        } else {
            lo = mid + 1;
        }
    }
    return writeXlsx(filePath, makeRows(lo, 64));
}

const binaryBands = preflightByteBands('zip', LIMITS);
const xlsxBands = preflightByteBands('xlsx', LIMITS);
const labels = [
    ['soft-under', binaryBands.soft - 4096, false],
    ['soft-over', binaryBands.soft + 4096, true],
    ['strong-under', binaryBands.strong - 4096, false],
    ['strong-over', binaryBands.strong + 4096, true],
    ['hard-under', binaryBands.hard - 4096, false],
    ['hard-over', binaryBands.hard + 4096, true]
];

const manifestPath = path.join(GEN_DIR, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

for (const [label, target, over] of labels) {
    const xlsxName = `xlsx-${label}.xlsx`;
    const xlsxPath = path.join(GEN_DIR, xlsxName);
    const cap = over ? null : label.includes('hard-under') ? xlsxBands.hard : xlsxBands.strong;
    const sizeBytes = await sizeToTarget(xlsxPath, target, over, cap);
    const fx = manifest.fixtures.find((f) => f.id === `byte-xlsx-${label}`);
    if (fx) {
        fx.featureCount = 0;
        fx.sizeBytes = sizeBytes;
        fx.expectedOutcome =
            label.includes('hard-under') || label.includes('strong-over') || label.includes('hard-over')
                ? 'failure'
                : 'success';
    }
    console.log(`${xlsxName}: ${sizeBytes} bytes (target ${target}, cap ${cap ?? 'none'})`);
}

const kml14999 = manifest.fixtures.find((f) => f.id === 'threshold-kml-14999');
if (kml14999) delete kml14999.workspaceExpect;

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('manifest updated');
