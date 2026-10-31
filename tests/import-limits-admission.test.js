import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS } from '../js/import/import-limits.js';
import {
    decideAdmission,
    ADMISSION_REASON
} from '../js/import/import-admission.js';
import { assessStreamEligibility } from '../js/import/stream/stream-policy.js';
import { guardFilesBeforeImport } from '../js/import/import-guard.js';
import { arcgisShouldUseWorkspace } from '../js/import/import-routing.js';
import { ARCGIS_MAX_FEATURES } from '../js/arcgis/rest-importer.js';
import {
    TEXT_SOFT_BYTES,
    TEXT_STRONG_BYTES,
    MAX_IMPORT_FEATURES
} from '../js/import/import-preflight.js';
import { WORKSPACE_FEATURE_THRESHOLD } from '../js/workspace/workspace-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_ROOT = path.join(__dirname, '../js/import');

const EXPORTED_GATE_CONSTANTS = [
    'TEXT_SOFT_BYTES',
    'TEXT_STRONG_BYTES',
    'TEXT_HARD_BYTES',
    'BINARY_SOFT_BYTES',
    'BINARY_STRONG_BYTES',
    'BINARY_HARD_BYTES',
    'MAX_IMPORT_FEATURES',
    'STREAM_MAX_BYTES',
    'STREAM_MAX_FEATURES',
    'WORKSPACE_FEATURE_THRESHOLD',
    'WORKSPACE_CHUNK_SIZE',
    'MAX_ZIP_UNCOMPRESSED_BYTES',
    'OPTIMIZER_PEAK_BYTES',
    'OPTIMIZER_COORDINATE_THRESHOLD',
    'KML_HEAVY_BYTES',
    'ARCGIS_MAX_FEATURES'
];

function walkJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            out.push(...walkJsFiles(full));
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

describe('import LIMITS table', () => {
    it('matches the frozen product snapshot', () => {
        expect(LIMITS).toMatchInlineSnapshot(`
          {
            "arcgisMaxFeatures": 250000,
            "binaryHardBytes": 8388608,
            "binarySoftBytes": 3145728,
            "binaryStrongBytes": 5242880,
            "geojsonFeedMaxBytes": 33554432,
            "geojsonFeedTimeoutMs": 30000,
            "kmlHeavyBytes": 4194304,
            "materializeMaxCoordsPerFeature": 500000,
            "materializeVertexLimit": 5000000,
            "maxImportFeatures": 250000,
            "maxZipUncompressedBytes": 83886080,
            "optimizerCoordinateThreshold": 500000,
            "optimizerPeakBytes": 16777216,
            "storedFeatureSoftLimit": 1000000,
            "streamBatchFeatures": 1000,
            "streamBatchMaxBytes": 8388608,
            "streamMaxBytes": 2147483648,
            "textHardBytes": 6291456,
            "textSoftBytes": 2097152,
            "textStrongBytes": 4194304,
            "workspaceChunkSize": 1000,
            "workspaceFeatureThreshold": 15000,
            "xlsxMaxParseBytes": 8388608,
          }
        `);
    });

    it('keeps legacy re-exports aligned with LIMITS', () => {
        expect(TEXT_SOFT_BYTES).toBe(LIMITS.textSoftBytes);
        expect(TEXT_STRONG_BYTES).toBe(LIMITS.textStrongBytes);
        expect(MAX_IMPORT_FEATURES).toBe(LIMITS.maxImportFeatures);
        expect(WORKSPACE_FEATURE_THRESHOLD).toBe(LIMITS.workspaceFeatureThreshold);
        expect(ARCGIS_MAX_FEATURES).toBe(LIMITS.arcgisMaxFeatures);
    });

    it('defines audited gate exports only as LIMITS re-exports', () => {
        const literalExport = (name) => new RegExp(`export const ${name}\\s*=\\s*\\d`);
        const offenders = [];
        for (const file of walkJsFiles(IMPORT_ROOT)) {
            if (file.endsWith(`${path.sep}import-limits.js`)) continue;
            const text = fs.readFileSync(file, 'utf8');
            for (const name of EXPORTED_GATE_CONSTANTS) {
                if (literalExport(name).test(text)) {
                    offenders.push(`${path.relative(IMPORT_ROOT, file)}:${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('decideAdmission', () => {
    it('routes small files to in-memory', () => {
        const d = decideAdmission({
            entry: 'file',
            format: 'geojson',
            files: [{ name: 'a.geojson', format: 'geojson', bytes: 1024, featureEstimate: 100 }]
        });
        expect(d.route).toBe('in-memory');
        expect(d.useWorkspace).toBe(false);
    });

    it('routes over-cap streamable files to streamed workspace import', () => {
        const d = decideAdmission({
            entry: 'file',
            format: 'geojson',
            files: [{ name: 'big.geojson', format: 'geojson', bytes: TEXT_STRONG_BYTES + 1 }],
            overPreflightReject: true,
            streamEligible: true
        });
        expect(d.route).toBe('streamed');
        expect(d.useWorkspace).toBe(true);
    });

    it('refuses over-cap files when streaming is not eligible', () => {
        const d = decideAdmission({
            entry: 'file',
            format: 'xlsx',
            files: [{ name: 'big.xlsx', format: 'xlsx', bytes: TEXT_STRONG_BYTES + 1 }],
            overPreflightReject: true,
            streamEligible: false
        });
        expect(d.route).toBe('refused');
    });

    it('sums multi-file bytes and features', () => {
        const d = decideAdmission({
            entry: 'file',
            files: [
                { format: 'csv', bytes: TEXT_STRONG_BYTES, featureEstimate: 8_000 },
                { format: 'csv', bytes: 1, featureEstimate: 8_000 }
            ],
            overPreflightReject: true,
            streamEligible: true
        });
        expect(d.route).toBe('streamed');
        expect(d.featureCount).toBe(16_000);
    });

    it('uses chunked workspace at the 15k threshold', () => {
        const d = decideAdmission({
            entry: 'file',
            featureCount: WORKSPACE_FEATURE_THRESHOLD
        });
        expect(d.route).toBe('chunked');
        expect(d.useWorkspace).toBe(true);
        expect(d.reasons).toContain(ADMISSION_REASON.FEATURE_COUNT);
    });

    it('fail-closed refuses known stored-feature overflow', () => {
        const d = decideAdmission({
            entry: 'file',
            featureCount: LIMITS.storedFeatureSoftLimit + 1
        });
        expect(d.route).toBe('refused');
        expect(d.reasons).toContain(ADMISSION_REASON.STORED_FEATURE_LIMIT);
    });

    it('ArcGIS REST uses in-memory below workspace threshold', () => {
        const d = decideAdmission({
            entry: 'arcgis-rest',
            featureCount: 10_000,
            returnGeometry: true
        });
        expect(d.route).toBe('in-memory');
        expect(d.useWorkspace).toBe(false);
    });

    it('ArcGIS REST uses chunked workspace at threshold', () => {
        expect(arcgisShouldUseWorkspace(WORKSPACE_FEATURE_THRESHOLD)).toBe(true);
        const d = decideAdmission({
            entry: 'arcgis-rest',
            featureCount: WORKSPACE_FEATURE_THRESHOLD,
            returnGeometry: true
        });
        expect(d.route).toBe('chunked');
    });
});

describe('entry points call decideAdmission', () => {
    it('stream-policy uses admission for large geojson', async () => {
        const file = { name: 'big.geojson', size: TEXT_STRONG_BYTES + 10 };
        const res = await assessStreamEligibility(file, 'geojson');
        expect(res.stream).toBe(true);
    });

    it('import guard defers oversized streamable files to streaming path', async () => {
        const big = new File([new Uint8Array(8)], 'big.geojson', { type: 'application/json' });
        Object.defineProperty(big, 'size', { value: TEXT_STRONG_BYTES + 1 });
        const guard = await guardFilesBeforeImport([big], { skipMemoryBudget: true });
        expect(guard.admission.route).toBe('streamed');
    });
});
