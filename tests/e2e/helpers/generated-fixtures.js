import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GEN_DIR = path.join(ROOT, 'tests/fixtures/e2e/generated');
const GEN_SCRIPT = path.join(ROOT, 'scripts/gen-e2e-fixtures.mjs');

/**
 * Ensure a generated e2e fixture exists (gitignored cache under tests/fixtures/e2e/generated).
 * @param {string} fixtureId manifest id, e.g. T3-stream-120k
 * @returns {Promise<{ id: string, file: string, fixturePath: string, meta: object }>}
 */
export async function ensureGeneratedFixture(fixtureId) {
    await fs.mkdir(GEN_DIR, { recursive: true });
    let meta = await readManifestEntry(fixtureId);
    let fixturePath = meta ? path.join(GEN_DIR, meta.file) : null;
    if (meta && (await fileExists(fixturePath))) {
        return { id: fixtureId, file: meta.file, fixturePath, meta };
    }

    const args = ['--generated-only'];
    if (meta && fixturePath && !(await fileExists(fixturePath))) {
        args.push('--force');
    }
    execFileSync(process.execPath, [GEN_SCRIPT, ...args], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    meta = await readManifestEntry(fixtureId);
    if (!meta) {
        throw new Error(`Generated fixture ${fixtureId} missing from manifest after gen-e2e-fixtures`);
    }
    fixturePath = path.join(GEN_DIR, meta.file);
    if (!(await fileExists(fixturePath))) {
        throw new Error(`Generated file missing after gen-e2e-fixtures: ${meta.file}`);
    }
    return { id: fixtureId, file: meta.file, fixturePath, meta };
}

/** @param {string|null} filePath */
async function fileExists(filePath) {
    if (!filePath) return false;
    return !!(await fs.stat(filePath).catch(() => null));
}

/** @param {string} fixtureId */
async function readManifestEntry(fixtureId) {
    const manifestPath = path.join(GEN_DIR, 'manifest.json');
    const raw = await fs.readFile(manifestPath, 'utf8').catch(() => null);
    if (!raw) return null;
    const manifest = JSON.parse(raw);
    return manifest.fixtures?.find((f) => f.id === fixtureId) ?? null;
}
