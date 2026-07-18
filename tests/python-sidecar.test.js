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
    it('responds to health checks', () => {
        const result = runSidecar({ id: 'h1', op: 'health', input: {} });
        expect(result.status).toBe(0);
        const messages = parseMessages(result.stdout);
        const finalMsg = messages[messages.length - 1];
        expect(finalMsg.type).toBe('result');
        expect(finalMsg.ok).toBe(true);
        expect(finalMsg.output.version).toBeTruthy();
        expect(finalMsg.output.operations).toContain('summarize_geojson');
    });

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

    it('rejects unknown operations', () => {
        const result = runSidecar({ id: 'x1', op: 'rm_rf', input: {} });
        expect(result.status).not.toBe(0);
        const messages = parseMessages(result.stdout);
        const finalMsg = messages[messages.length - 1];
        expect(finalMsg.ok).toBe(false);
        expect(String(finalMsg.message)).toMatch(/unknown operation/i);
    });
});
