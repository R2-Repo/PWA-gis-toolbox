#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { LIMITS, preflightByteBands } from '../js/import/import-limits.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN_DIR = path.join(ROOT, 'tests/fixtures/e2e/generated');

function baseRows(n = 40) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        rows.push({
            latitude: 39 + i * 0.00001,
            longitude: -111 + i * 0.00001,
            id: i,
            name: `pt-${i}`,
            unicode: 'café'
        });
    }
    return rows;
}

async function writeXlsxNearBytes(filePath, targetBytes, over, maxBytes) {
    let rows = baseRows();
    let padLen = 64;
    for (let guard = 0; guard < 200; guard++) {
        const sheetRows = rows.map((r) => ({
            latitude: r.latitude,
            longitude: r.longitude,
            id: r.id,
            name: `pt-${r.id}-${'n'.repeat(padLen)}`,
            unicode: `u-${'u'.repeat(Math.min(padLen, 4000))}`
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'data');
        XLSX.writeFile(wb, filePath);
        const size = (await fs.stat(filePath)).size;
        if (over) {
            if (size > targetBytes) return size;
            padLen = Math.min(8000, padLen + 128);
            if (rows.length < 8000) {
                const start = rows.length;
                for (let i = 0; i < 300; i++) {
                    rows.push({
                        latitude: 39 + (start + i) * 0.00001,
                        longitude: -111 + (start + i) * 0.00001,
                        id: start + i
                    });
                }
            }
            continue;
        }
        if (maxBytes != null && size >= maxBytes) {
            padLen = Math.max(32, padLen - 64);
            if (rows.length > 50) rows = rows.slice(0, -100);
            continue;
        }
        if (size >= targetBytes - 512) return size;
        padLen = Math.min(8000, padLen + (size < targetBytes * 0.5 ? 512 : 128));
        if (rows.length < 15000) {
            const start = rows.length;
            const add = size < targetBytes * 0.7 ? 800 : 150;
            for (let i = 0; i < add; i++) {
                rows.push({
                    latitude: 39 + (start + i) * 0.00001,
                    longitude: -111 + (start + i) * 0.00001,
                    id: start + i
                });
            }
        }
    }
    return (await fs.stat(filePath)).size;
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
    const xlsxCap = over ? null : label.includes('hard-under') ? xlsxBands.hard : xlsxBands.strong;
    const sizeBytes = await writeXlsxNearBytes(xlsxPath, target, over, xlsxCap);
    const fx = manifest.fixtures.find((f) => f.id === `byte-xlsx-${label}`);
    if (fx) {
        fx.featureCount = 0;
        fx.sizeBytes = sizeBytes;
    }
    console.log(`${xlsxName}: ${sizeBytes} bytes (target ${target}, cap ${xlsxCap ?? 'none'})`);
}

const kml14999 = manifest.fixtures.find((f) => f.id === 'threshold-kml-14999');
if (kml14999) delete kml14999.workspaceExpect;

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('manifest updated');
