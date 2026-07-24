import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PYTHON_ROOT = join(process.cwd(), 'desktop/sidecar/python');

function runSidecar(request) {
    const candidates = process.platform === 'win32'
        ? ['python', 'py', 'python3']
        : ['python3', 'python'];

    let lastError = null;
    for (const cmd of candidates) {
        const result = spawnSync(
            cmd,
            ['-m', 'gis_sidecar'],
            {
                cwd: PYTHON_ROOT,
                env: {
                    ...process.env,
                    PYTHONPATH: PYTHON_ROOT,
                    PYTHONUTF8: '1'
                },
                input: `${JSON.stringify(request)}\n`,
                encoding: 'utf8'
            }
        );
        if (result.error) {
            lastError = result.error;
            continue;
        }
        return result;
    }
    throw lastError || new Error('No Python interpreter available for sidecar tests');
}

function parseMessages(stdout) {
    return String(stdout || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

describe('python sidecar', () => {
    // Cold import of duckdb/pyogrio can exceed Vitest's default 5s on Windows.
    it('responds to health checks', () => {
        const result = runSidecar({ id: 'h1', op: 'health', input: {} });
        expect(result.status).toBe(0);
        const messages = parseMessages(result.stdout);
        const finalMsg = messages[messages.length - 1];
        expect(finalMsg.type).toBe('result');
        expect(finalMsg.ok).toBe(true);
        expect(finalMsg.output.version).toBeTruthy();
        expect(finalMsg.output.operations).toContain('summarize_geojson');
        expect(finalMsg.output.operations).toContain('inspect_vector');
        expect(finalMsg.output.operations).toContain('sample_vector');
        expect(finalMsg.output.operations).toContain('convert_to_geoparquet');
        expect(finalMsg.output.operations).toContain('file_checksum');
        expect(finalMsg.output.operations).toContain('summarize_vector');
        expect(finalMsg.output.operations).toContain('generate_pmtiles');
        expect(finalMsg.output.operations).toContain('buffer_vector');
        expect(finalMsg.output.operations).toContain('spatial_filter');
        expect(finalMsg.output.operations).toContain('clip_vector');
        expect(finalMsg.output.operations).toContain('nearest_join');
        expect(finalMsg.output.engines).toBeTruthy();
        expect(finalMsg.output.version).toMatch(/^0\./);
    }, 30_000);

    it('summarizes a GeoJSON file by path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
        const filePath = join(dir, 'sample.geojson');
        writeFileSync(filePath, JSON.stringify({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'A' },
                    geometry: { type: 'Point', coordinates: [0, 0] }
                },
                {
                    type: 'Feature',
                    properties: { name: 'B', kind: 'line' },
                    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
                }
            ]
        }));

        try {
            const result = runSidecar({
                id: 's1',
                op: 'summarize_geojson',
                input: { path: filePath }
            });
            expect(result.status).toBe(0);
            const messages = parseMessages(result.stdout);
            const finalMsg = messages[messages.length - 1];
            expect(finalMsg.ok).toBe(true);
            expect(finalMsg.output.featureCount).toBe(2);
            expect(finalMsg.output.geometryTypes.Point).toBe(1);
            expect(finalMsg.output.geometryTypes.LineString).toBe(1);
            expect(finalMsg.output.propertyKeys).toEqual(['kind', 'name']);
            expect(messages.some((m) => m.type === 'progress')).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('inspects and samples a GeoJSON file by path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
        const filePath = join(dir, 'sample.geojson');
        const features = [];
        for (let i = 0; i < 10; i += 1) {
            features.push({
                type: 'Feature',
                properties: { id: i },
                geometry: { type: 'Point', coordinates: [i, i] }
            });
        }
        writeFileSync(filePath, JSON.stringify({ type: 'FeatureCollection', features }));

        try {
            const inspectResult = runSidecar({
                id: 'i1',
                op: 'inspect_vector',
                input: { path: filePath }
            });
            expect(inspectResult.status).toBe(0);
            const inspectMsg = parseMessages(inspectResult.stdout).at(-1);
            expect(inspectMsg.ok).toBe(true);
            expect(inspectMsg.output.featureCount).toBe(10);
            expect(inspectMsg.output.bbox).toEqual([0, 0, 9, 9]);

            const sampleResult = runSidecar({
                id: 'p1',
                op: 'sample_vector',
                input: { path: filePath, maxFeatures: 3 }
            });
            expect(sampleResult.status).toBe(0);
            const sampleMsg = parseMessages(sampleResult.stdout).at(-1);
            expect(sampleMsg.ok).toBe(true);
            expect(sampleMsg.output.sampledFeatureCount).toBe(3);
            expect(sampleMsg.output.previewOnly).toBe(true);
            expect(sampleMsg.output.geojson.features).toHaveLength(3);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('computes file checksum', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
        const filePath = join(dir, 'sample.geojson');
        writeFileSync(filePath, '{"type":"FeatureCollection","features":[]}');
        try {
            const result = runSidecar({
                id: 'c1',
                op: 'file_checksum',
                input: { path: filePath }
            });
            expect(result.status).toBe(0);
            const finalMsg = parseMessages(result.stdout).at(-1);
            expect(finalMsg.ok).toBe(true);
            expect(finalMsg.output.algorithm).toBe('sha256');
            expect(String(finalMsg.output.checksum)).toMatch(/^[a-f0-9]{64}$/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('converts GeoJSON to GeoParquet when engines are installed', () => {
        const health = runSidecar({ id: 'h2', op: 'health', input: {} });
        const healthOut = parseMessages(health.stdout).at(-1)?.output;
        const canConvert = Boolean(healthOut?.duckdb);
        if (!canConvert) {
            const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
            const filePath = join(dir, 'sample.geojson');
            writeFileSync(filePath, JSON.stringify({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Point', coordinates: [0, 0] }
                }]
            }));
            try {
                const result = runSidecar({
                    id: 'g1',
                    op: 'convert_to_geoparquet',
                    input: { path: filePath, outputPath: join(dir, 'out.parquet') }
                });
                const finalMsg = parseMessages(result.stdout).at(-1);
                expect(finalMsg.ok).toBe(false);
                expect(String(finalMsg.message)).toMatch(/duckdb|requirements/i);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
            return;
        }

        const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
        const filePath = join(dir, 'sample.geojson');
        const outPath = join(dir, 'out.parquet');
        writeFileSync(filePath, JSON.stringify({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { name: 'A' },
                geometry: { type: 'Point', coordinates: [1, 2] }
            }]
        }));
        try {
            const result = runSidecar({
                id: 'g2',
                op: 'convert_to_geoparquet',
                input: { path: filePath, outputPath: outPath }
            });
            expect(result.status).toBe(0);
            const finalMsg = parseMessages(result.stdout).at(-1);
            expect(finalMsg.ok).toBe(true);
            expect(finalMsg.output.outputPath).toBeTruthy();
            expect(finalMsg.output.format).toBe('parquet');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);

    it('buffers a GeoJSON file when shapely is installed', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gis-sidecar-'));
        const filePath = join(dir, 'pts.geojson');
        const outPath = join(dir, 'buf.geojson');
        writeFileSync(filePath, JSON.stringify({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { name: 'A' },
                geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
            }]
        }));
        try {
            const result = runSidecar({
                id: 'b1',
                op: 'buffer_vector',
                input: { path: filePath, outputPath: outPath, distance: 50, units: 'meters' }
            });
            expect(result.status).toBe(0);
            const finalMsg = parseMessages(result.stdout).at(-1);
            expect(finalMsg.ok).toBe(true);
            expect(finalMsg.output.featureCount).toBe(1);
            expect(finalMsg.output.outputPath).toBeTruthy();
            expect(finalMsg.output.previewGeojson?.features?.length).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);

    it('rejects unknown operations', () => {
        const result = runSidecar({ id: 'x1', op: 'rm_rf', input: {} });
        expect(result.status).not.toBe(0);
        const messages = parseMessages(result.stdout);
        const finalMsg = messages[messages.length - 1];
        expect(finalMsg.ok).toBe(false);
        expect(String(finalMsg.message)).toMatch(/unknown operation/i);
    });
});
