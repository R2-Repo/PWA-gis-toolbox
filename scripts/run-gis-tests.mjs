#!/usr/bin/env node
/**
 * GIS test orchestrator — Vitest + Playwright import e2e.
 * Windows-friendly (node only, no bash-isms required).
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'test-results/gis-report');
const PERF_BASELINE_PATH = path.join(ROOT, 'tests/e2e/perf-baseline.json');

function parseArgs(argv) {
    const flags = {
        onlyImport: argv.includes('--only') && argv.includes('import'),
        dev: argv.includes('--dev'),
        holdout: argv.includes('--holdout'),
        full: argv.includes('--full'),
        updateBaseline: argv.includes('--update-baseline')
    };
    return flags;
}

function run(cmd, args, options = {}) {
    const useShell = options.shell ?? process.platform === 'win32';
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: ROOT,
            env: { ...process.env, ...options.env },
            shell: useShell,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
            stdout += d;
            if (options.inherit) process.stdout.write(d);
        });
        child.stderr.on('data', (d) => {
            stderr += d;
            if (options.inherit) process.stderr.write(d);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}

function gitStagingSha() {
    try {
        return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

function summarizeVitest(json) {
    const passed = json.numPassedTests ?? 0;
    const failed = json.numFailedTests ?? 0;
    const time = (json.testResults || []).reduce((s, f) => s + (f.endTime - f.startTime), 0);
    const failures = [];
    for (const file of json.testResults || []) {
        for (const assertion of file.assertionResults || []) {
            if (assertion.status === 'failed') {
                failures.push(`${file.name} › ${assertion.fullName}: ${(assertion.failureMessages || []).join(' ')}`);
            }
        }
    }
    return { passed, failed, time, failures };
}

function summarizePlaywright(json) {
    const stats = json.stats || {};
    const passed = stats.expected ?? 0;
    const failed = (stats.unexpected ?? 0) + (stats.flaky ?? 0);
    const failures = [];
    for (const suite of json.suites || []) {
        collectPwFailures(suite, failures);
    }
    return {
        passed,
        failed,
        time: stats.duration ?? 0,
        failures
    };
}

function collectPwFailures(suite, out) {
    for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
            for (const result of test.results || []) {
                if (result.status !== 'expected' && result.status !== 'passed') {
                    out.push(`${spec.title}: ${result.error?.message || result.status}`);
                }
            }
        }
    }
    for (const child of suite.suites || []) collectPwFailures(child, out);
}

function collectPerfRowsFromSuite(suite, out) {
    for (const spec of suite.specs || []) {
        for (const t of spec.tests || []) {
            for (const result of t.results || []) {
                for (const ann of result.annotations || []) {
                    if (ann.type === 'perf-row' && ann.description) {
                        try {
                            out.push(JSON.parse(ann.description));
                        } catch {
                            // ignore
                        }
                    }
                }
            }
        }
    }
    for (const child of suite.suites || []) collectPerfRowsFromSuite(child, out);
}

function collectPerfRows(playwrightJson) {
    const rows = [];
    for (const suite of playwrightJson.suites || []) {
        collectPerfRowsFromSuite(suite, rows);
    }
    return rows;
}

function loadPerfBaseline() {
    try {
        return JSON.parse(readFileSync(PERF_BASELINE_PATH, 'utf8'));
    } catch {
        return { version: 1, fixtures: {} };
    }
}

function checkPerfRegressions(rows, baseline, fullRun) {
    if (!fullRun) return [];
    const violations = [];
    for (const row of rows) {
        const base = baseline.fixtures?.[row.id];
        if (base?.importMs && row.importMs > base.importMs * 1.25) {
            violations.push(
                `${row.id}: import ms regression ${row.importMs} > 125% of baseline ${base.importMs}`
            );
        }
        if (/15000|threshold.*15000|fc-15000/i.test(row.id) && row.longest > 200) {
            violations.push(`${row.id}: longest task ${row.longest}ms > 200ms`);
        }
        if (/T3-stream|150k/i.test(row.id) && row.longest > 300) {
            violations.push(`${row.id}: longest task ${row.longest}ms > 300ms`);
        }
    }
    return violations;
}

function perfTable(importResults) {
    if (!importResults.length) return '_No import perf rows._';
    const header =
        '| fixture | import ms | TTI ms | TBT ms | longest task ms | heap used |';
    const sep = '|---|---:|---:|---:|---:|---:|';
    const rows = importResults.map((r) =>
        `| ${r.id} | ${r.importMs ?? '—'} | ${r.ttiMs ?? '—'} | ${r.tbt ?? '—'} | ${r.longest ?? '—'} | ${r.heapUsed ?? '—'} |`
    );
    return [header, sep, ...rows].join('\n');
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));
    const started = Date.now();
    await mkdir(REPORT_DIR, { recursive: true });
    const networkLog = path.join(REPORT_DIR, 'network-log.jsonl');
    if (existsSync(networkLog)) {
        await writeFile(networkLog, '');
    }

    if (!existsSync(path.join(ROOT, 'tests/fixtures/e2e/tune/manifest.json'))) {
        const gen = await run(process.execPath, ['scripts/gen-e2e-fixtures.mjs', '--force']);
        if (gen.code !== 0) {
            console.error(gen.stderr || gen.stdout);
            process.exit(2);
        }
    } else if (!existsSync(path.join(ROOT, 'tests/fixtures/e2e/generated/manifest.json'))) {
        const gen = await run(process.execPath, ['scripts/gen-e2e-fixtures.mjs']);
        if (gen.code !== 0) {
            console.error(gen.stderr || gen.stdout);
            process.exit(2);
        }
    }

    /** @type {{ vitest?: object, import?: object, blocked?: string[], basemapBlocked?: string[] }} */
    const summary = {
        sha: gitStagingSha(),
        startedAt: new Date().toISOString(),
        flags,
        vitest: null,
        import: null,
        blockedNetwork: [],
        basemapBlocked: [],
        telemetryBlocked: [],
        perf: []
    };

    let harnessError = false;
    let testFailures = false;

    if (!flags.onlyImport) {
        const vitestOut = path.join(REPORT_DIR, 'vitest.json');
        const vitestArgs = ['vitest', 'run', '--reporter=json', `--outputFile=${vitestOut}`];
        console.log('Running vitest…');
        const vitestRun = await run('npx', vitestArgs, { inherit: true });
        if (vitestRun.code !== 0 && !existsSync(vitestOut)) {
            harnessError = true;
        }
        if (existsSync(vitestOut)) {
            const json = JSON.parse(await readFile(vitestOut, 'utf8'));
            summary.vitest = summarizeVitest(json);
            if (summary.vitest.failed > 0) testFailures = true;
        } else {
            summary.vitest = { passed: 0, failed: 0, time: 0, failures: ['Vitest did not produce JSON output'] };
            harnessError = true;
        }
    } else {
        summary.vitest = { passed: 0, failed: 0, time: 0, failures: [], skipped: true };
    }

    {
        if (flags.dev) {
            process.env.GIS_TEST_DEV_SERVER = '1';
        }
        if (flags.holdout && existsSync(path.join(ROOT, 'tests/fixtures/e2e/holdout/manifest.json'))) {
            // holdout path appended via separate playwright invocation if needed
        }

        console.log('Running Playwright import + REST e2e…');
        const pwJson = path.join(REPORT_DIR, 'playwright.json');
        const grepPattern = flags.full ? '@full|@tune' : '@tune';
        const pwTargets = 'tests/e2e/import tests/e2e/rest';
        let pwRun;
        if (process.platform === 'win32') {
            const workers = flags.full ? ' --workers=1' : '';
            const cmd = `npx playwright test ${pwTargets} --grep "${grepPattern}"${workers}`;
            pwRun = await run(cmd, [], { inherit: true, shell: true });
        } else {
            const pwArgs = ['playwright', 'test', 'tests/e2e/import', 'tests/e2e/rest', '--grep', grepPattern];
            if (flags.full) pwArgs.push('--workers=1');
            pwRun = await run('npx', pwArgs, { inherit: true, shell: false });
        }

        if (existsSync(pwJson)) {
            const json = JSON.parse(await readFile(pwJson, 'utf8'));
            summary.import = summarizePlaywright(json);
            summary.perf = collectPerfRows(json);
            if (summary.import.failed > 0) testFailures = true;
        } else {
            summary.import = {
                passed: 0,
                failed: 0,
                time: 0,
                failures: [pwRun.stderr || 'Playwright JSON report missing']
            };
            if (pwRun.code !== 0) testFailures = true;
        }
    }

    const wallSec = ((Date.now() - started) / 1000).toFixed(1);

    if (existsSync(networkLog)) {
        const lines = (await readFile(networkLog, 'utf8')).trim().split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const row = JSON.parse(line);
                summary.basemapBlocked.push(...(row.basemapBlocked || []));
                summary.telemetryBlocked.push(...(row.telemetryBlocked || []));
                summary.blockedNetwork.push(...(row.unexpectedBlocked || []));
            } catch {
                // ignore
            }
        }
        summary.basemapBlocked = [...new Set(summary.basemapBlocked)];
        summary.telemetryBlocked = [...new Set(summary.telemetryBlocked)];
        summary.blockedNetwork = [...new Set(summary.blockedNetwork)];
    }
    const overall = harnessError ? 'HARNESS ERROR' : testFailures ? 'FAIL' : 'PASS';

    const baseline = loadPerfBaseline();
    const perfViolations = checkPerfRegressions(summary.perf, baseline, flags.full);
    if (perfViolations.length) {
        testFailures = true;
    }

    if (flags.updateBaseline && summary.perf.length) {
        const next = { version: 1, updatedAt: new Date().toISOString(), fixtures: { ...baseline.fixtures } };
        for (const row of summary.perf) {
            next.fixtures[row.id] = {
                importMs: row.importMs,
                ttiMs: row.ttiMs,
                tbt: row.tbt,
                longest: row.longest,
                heapUsed: row.heapUsed
            };
        }
        await writeFile(PERF_BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    }

    const md = [
        `# GIS test report — ${overall}`,
        '',
        `SHA: ${summary.sha} · ${summary.startedAt} · wall ${wallSec}s`,
        '',
        `## Vitest`,
        `- PASS ${summary.vitest.passed} · FAIL ${summary.vitest.failed} · ${Math.round(summary.vitest.time)} ms`,
        ...summary.vitest.failures.map((f) => `- ${f}`),
        '',
        `## Import + REST e2e (@tune / @full)`,
        summary.import
            ? `- PASS ${summary.import.passed} · FAIL ${summary.import.failed} · ${Math.round(summary.import.time)} ms`
            : '- skipped',
        ...(summary.import?.failures || []).map((f) => `- ${f}`),
        '',
        `## Blocked network`,
        ...(summary.blockedNetwork.length
            ? summary.blockedNetwork.map((u) => `- ${u}`)
            : ['- (none logged by harness)']),
        '',
        `## basemap-blocked`,
        ...(summary.basemapBlocked.length
            ? summary.basemapBlocked.map((u) => `- ${u}`)
            : ['- (none logged)']),
        '',
        `## telemetry-blocked`,
        ...(summary.telemetryBlocked.length
            ? summary.telemetryBlocked.map((u) => `- ${u}`)
            : ['- (none logged)']),
        '',
        `## Perf (import)`,
        perfTable(summary.perf),
        ...(perfViolations.length ? ['', '## Perf regressions', ...perfViolations.map((v) => `- ${v}`)] : [])
    ].join('\n');

    await writeFile(path.join(REPORT_DIR, 'summary.md'), md);
    await writeFile(
        path.join(REPORT_DIR, 'summary.json'),
        `${JSON.stringify({ ...summary, overall, wallSec, perfViolations }, null, 2)}\n`
    );

    if (harnessError) process.exit(2);
    if (testFailures) process.exit(1);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
