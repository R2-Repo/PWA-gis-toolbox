#!/usr/bin/env node
/**
 * Playwright webServer entry — start preview (or dev) on 127.0.0.1:5175 if not already up.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5175;
const HOST = '127.0.0.1';
const URL = `http://${HOST}:${PORT}/`;

const useDev = process.env.GIS_TEST_DEV_SERVER === '1';

function ping() {
    return new Promise((resolve) => {
        const req = http.get(URL, (res) => {
            res.resume();
            resolve(res.statusCode != null && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function computeAppSourceHash() {
    const SOURCE_DIRS = ['js', 'react', 'css', 'public', 'pipelines'];
    const SOURCE_FILES = ['index.html', 'package.json', 'package-lock.json'];
    const h = createHash('sha256');
    const walk = (dir, out = []) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full, out);
            else out.push(full);
        }
        return out;
    };
    for (const d of SOURCE_DIRS) {
        const base = join(ROOT, d);
        if (!existsSync(base)) continue;
        for (const file of walk(base).sort()) {
            h.update(file.slice(ROOT.length + 1));
            h.update(readFileSync(file));
        }
    }
    for (const f of SOURCE_FILES) {
        const full = join(ROOT, f);
        if (existsSync(full)) {
            h.update(f);
            h.update(readFileSync(full));
        }
    }
    return h.digest('hex');
}

async function main() {
    if (await ping()) {
        // Keep Playwright webServer slot alive while reusing an existing preview.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await new Promise((r) => setTimeout(r, 60_000));
        }
    }

    const distReady = existsSync(join(ROOT, 'dist-web', 'index.html'));
    const cachePath = join(ROOT, 'test-results', 'e2e-build-hash.txt');
    const currentHash = computeAppSourceHash();
    let cached = null;
    try {
        cached = readFileSync(cachePath, 'utf8').trim();
    } catch {
        cached = null;
    }
    const skipBuild = !useDev && cached === currentHash && distReady;

    if (!useDev && !skipBuild) {
        mkdirSync(join(ROOT, 'test-results'), { recursive: true });
        writeFileSync(cachePath, `${currentHash}\n`);
        await run('npx', ['vite', 'build', '--mode', 'web']);
    }

    const args = useDev
        ? ['vite', '--port', String(PORT), '--strictPort', '--host', HOST]
        : ['vite', 'preview', '--mode', 'web', '--port', String(PORT), '--strictPort', '--host', HOST];

    const child = spawn('npx', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => process.exit(code ?? 1));
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
