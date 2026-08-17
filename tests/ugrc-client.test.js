/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildReverseMilepostUrl,
    formatRouteMilepostLabel,
    formatRouteMilepostMessage,
    normalizeReverseMilepostResult,
    reverseMilepost
} from '../js/ugrc/client.js';
import { getEnvUgrcApiKey, resolveUgrcApiKey } from '../js/ugrc/keys.js';
import { noStateRouteMessage, runReverseMilepostLookup } from '../js/ugrc/lookup.js';

const { ugrcKeyTest } = vi.hoisted(() => ({ ugrcKeyTest: { override: null } }));

vi.mock('../js/ugrc/keys.js', async (importOriginal) => {
    const actual = await importOriginal();
    const resolved = () => (ugrcKeyTest.override != null ? ugrcKeyTest.override : actual.getEnvUgrcApiKey());
    return {
        ...actual,
        resolveUgrcApiKey: () => resolved(),
        hasResolvedUgrcApiKey: () => Boolean(resolved())
    };
});

describe('ugrc client URL + normalize', () => {
    it('builds reverse milepost URL with UTM 12N defaults', () => {
        const url = buildReverseMilepostUrl({
            x: 425000.12,
            y: 4510000.34,
            apiKey: 'test-key'
        });
        expect(url).toContain('/api/v1/geocode/reversemilepost/425000.12/4510000.34?');
        expect(url).toContain('buffer=100');
        expect(url).toContain('spatialReference=26912');
        expect(url).toContain('apiKey=test-key');
        expect(url).toContain('suggest=0');
        expect(url).toContain('includeRampSystem=false');
    });

    it('normalizes a successful reverse milepost payload', () => {
        const result = normalizeReverseMilepostResult({
            result: {
                route: '15P',
                offsetMeters: 13.09,
                milepost: 299.312,
                side: 'decreasing',
                dominant: true,
                candidates: [{ route: '15N' }]
            },
            status: 200
        });
        expect(result).toEqual({
            route: '15P',
            milepost: 299.312,
            offsetMeters: 13.09,
            side: 'decreasing',
            dominant: true,
            candidates: [{ route: '15N' }]
        });
        expect(formatRouteMilepostLabel(result)).toBe('Route 15P · MP 299.312');
        expect(formatRouteMilepostMessage(result)).toBe('Route 15P · MP 299.312 (13.1 m from route)');
    });

    it('returns null when route/milepost missing', () => {
        expect(normalizeReverseMilepostResult({ result: {}, status: 200 })).toBeNull();
        expect(normalizeReverseMilepostResult(null)).toBeNull();
    });
});

describe('reverseMilepost fetch', () => {
    it('returns ok result on 200', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                result: { route: '89', milepost: 12.5, offsetMeters: 4 },
                status: 200
            })
        }));
        const outcome = await reverseMilepost({
            lat: 40.5,
            lng: -111.5,
            apiKey: 'k',
            fetchImpl
        });
        expect(outcome.ok).toBe(true);
        expect(outcome.result.route).toBe('89');
        expect(fetchImpl).toHaveBeenCalledOnce();
        const calledUrl = String(fetchImpl.mock.calls[0][0]);
        expect(calledUrl).toContain('/api/v1/geocode/reversemilepost/');
        expect(calledUrl).toContain('spatialReference=26912');
        expect(calledUrl).not.toContain('/-111.5/');
    });

    it('maps empty/404 responses to no_match', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Unable to find route', status: 404 })
        }));
        const outcome = await reverseMilepost({
            lat: 40.5,
            lng: -111.5,
            apiKey: 'k',
            fetchImpl
        });
        expect(outcome).toEqual({ ok: false, reason: 'no_match', status: 404 });
    });
});

describe('ugrc keys', () => {
    it('resolves only the build-time env key', () => {
        expect(resolveUgrcApiKey()).toBe(getEnvUgrcApiKey());
    });
});

describe('runReverseMilepostLookup', () => {
    afterEach(() => {
        ugrcKeyTest.override = null;
        vi.restoreAllMocks();
    });

    it('toasts a generic unavailable message when no env key is configured', async () => {
        ugrcKeyTest.override = '';
        const showToast = vi.fn();
        const status = await runReverseMilepostLookup(
            { lat: 40.7, lng: -111.9 },
            { showToast }
        );
        expect(status).toBe('missing_key');
        expect(showToast).toHaveBeenCalledWith(
            'Route & milepost lookup is unavailable.',
            'warning'
        );
    });

    it('toasts success and copies label', async () => {
        ugrcKeyTest.override = 'k';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                result: { route: '15P', milepost: 100.001, offsetMeters: 2.2 },
                status: 200
            })
        });
        const showToast = vi.fn();
        const copyText = vi.fn(async () => {});
        const status = await runReverseMilepostLookup(
            { lat: 40.7, lng: -111.9 },
            { showToast, copyText }
        );
        expect(status).toBe('success');
        expect(copyText).toHaveBeenCalledWith('Route 15P · MP 100.001');
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Route 15P'),
            'success'
        );
    });

    it('builds a clear no-match message', () => {
        expect(noStateRouteMessage(100)).toContain('UDOT state route');
        expect(noStateRouteMessage(100)).toContain('100 m');
    });
});
