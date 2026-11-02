import { describe, expect, it } from 'vitest';
import {
    assertGisVerdictAgrees,
    formatGisVerdict,
    resolveGisTestVerdict
} from '../scripts/gis-test-verdict.mjs';

const passInput = {
    harnessError: false,
    vitestSkipped: false,
    vitestFailed: 0,
    vitestExitCode: 0,
    playwrightMissing: false,
    playwrightFailed: 0,
    playwrightExitCode: 0,
    perfViolationCount: 0,
    unexpectedNetworkCount: 0
};

describe('resolveGisTestVerdict', () => {
    it('passes only when every step passed', () => {
        const verdict = resolveGisTestVerdict(passInput);
        expect(verdict).toEqual({ overall: 'PASS', exitCode: 0, failingSteps: [] });
        assertGisVerdictAgrees(verdict);
        expect(formatGisVerdict(verdict)).toBe(
            'GIS test report — PASS (exit 0); failing steps: (none)'
        );
    });

    it('fails on perf gates when vitest and playwright passed', () => {
        const verdict = resolveGisTestVerdict({ ...passInput, perfViolationCount: 5 });
        expect(verdict.overall).toBe('FAIL');
        expect(verdict.exitCode).toBe(1);
        expect(verdict.failingSteps).toEqual(['perf-gates']);
        assertGisVerdictAgrees(verdict);
        expect(formatGisVerdict(verdict)).toContain('FAIL');
        expect(formatGisVerdict(verdict)).toContain('exit 1');
        expect(formatGisVerdict(verdict)).toContain('perf-gates');
    });

    it('lists each failing step and keeps exit 0 only for a clean run', () => {
        const verdict = resolveGisTestVerdict({
            ...passInput,
            vitestFailed: 2,
            vitestExitCode: 1,
            playwrightFailed: 1,
            playwrightExitCode: 1,
            perfViolationCount: 1,
            unexpectedNetworkCount: 3
        });
        expect(verdict.failingSteps).toEqual([
            'vitest',
            'playwright',
            'perf-gates',
            'network-guard'
        ]);
        expect(verdict.exitCode).toBe(1);
        expect(verdict.overall).toBe('FAIL');
        assertGisVerdictAgrees(verdict);
    });

    it('treats a playwright exit mismatch as failure even when the JSON count is zero', () => {
        const verdict = resolveGisTestVerdict({ ...passInput, playwrightExitCode: 1 });
        expect(verdict.overall).toBe('FAIL');
        expect(verdict.exitCode).toBe(1);
        expect(verdict.failingSteps).toEqual(['playwright']);
    });

    it('uses exit 2 for harness errors and still reports FAIL', () => {
        const verdict = resolveGisTestVerdict({
            ...passInput,
            harnessError: true,
            vitestExitCode: 1,
            playwrightMissing: true,
            playwrightExitCode: 1
        });
        expect(verdict.overall).toBe('FAIL');
        expect(verdict.exitCode).toBe(2);
        expect(verdict.failingSteps).toContain('harness');
        assertGisVerdictAgrees(verdict);
    });

    it('does not fail a skipped vitest step', () => {
        const verdict = resolveGisTestVerdict({
            ...passInput,
            vitestSkipped: true,
            vitestExitCode: null,
            vitestFailed: 0
        });
        expect(verdict.overall).toBe('PASS');
        expect(verdict.exitCode).toBe(0);
    });

    it('fails when the network guard saw unexpected blocks', () => {
        const verdict = resolveGisTestVerdict({ ...passInput, unexpectedNetworkCount: 1 });
        expect(verdict.failingSteps).toEqual(['network-guard']);
        expect(verdict.exitCode).toBe(1);
        expect(verdict.overall).toBe('FAIL');
    });
});
