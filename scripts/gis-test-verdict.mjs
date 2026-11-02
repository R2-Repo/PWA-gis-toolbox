/**
 * Single source for the GIS harness verdict.
 * summary.md and the process exit code both come from this object.
 */

/**
 * @param {{
 *   harnessError?: boolean,
 *   vitestSkipped?: boolean,
 *   vitestFailed?: number,
 *   vitestExitCode?: number | null,
 *   playwrightMissing?: boolean,
 *   playwrightFailed?: number,
 *   playwrightExitCode?: number | null,
 *   perfViolationCount?: number,
 *   unexpectedNetworkCount?: number
 * }} input
 */
export function resolveGisTestVerdict(input) {
    const failingSteps = [];
    if (input.harnessError) failingSteps.push('harness');

    if (!input.vitestSkipped) {
        const vitestFailed =
            (input.vitestFailed ?? 0) > 0
            || input.vitestExitCode == null
            || input.vitestExitCode !== 0;
        if (vitestFailed) failingSteps.push('vitest');
    }

    const playwrightFailed =
        input.playwrightMissing
        || (input.playwrightFailed ?? 0) > 0
        || input.playwrightExitCode == null
        || input.playwrightExitCode !== 0;
    if (playwrightFailed) failingSteps.push('playwright');

    if ((input.perfViolationCount ?? 0) > 0) failingSteps.push('perf-gates');
    if ((input.unexpectedNetworkCount ?? 0) > 0) failingSteps.push('network-guard');

    const exitCode = input.harnessError ? 2 : failingSteps.length ? 1 : 0;
    const overall = exitCode === 0 ? 'PASS' : 'FAIL';
    return { overall, exitCode, failingSteps };
}

/** @param {{ overall: string, exitCode: number, failingSteps: string[] }} verdict */
export function formatGisVerdict(verdict) {
    const steps = verdict.failingSteps.length ? verdict.failingSteps.join(', ') : '(none)';
    return `GIS test report — ${verdict.overall} (exit ${verdict.exitCode}); failing steps: ${steps}`;
}

/** Throws if a PASS line could be written for a non-zero exit, or the reverse. */
export function assertGisVerdictAgrees(verdict) {
    const pass = verdict.overall === 'PASS';
    if (pass !== (verdict.exitCode === 0)) {
        throw new Error(`exit/summary disagree: ${verdict.overall} exit ${verdict.exitCode}`);
    }
    if (pass && verdict.failingSteps.length > 0) {
        throw new Error('PASS verdict includes failing steps');
    }
    if (!pass && verdict.failingSteps.length === 0) {
        throw new Error('FAIL verdict has no failing steps');
    }
}
