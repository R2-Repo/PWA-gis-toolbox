/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildReverseMilepostUrl,
    formatRouteMilepostLabel,
    formatRouteMilepostMessage,
    normalizeReverseMilepostResult,
    reverseMilepost
} from '../js/ugrc/client.js';
import {
    clearUserUgrcApiKey,
    getUserUgrcApiKey,
    resolveUgrcApiKey,
    setUserUgrcApiKey
} from '../js/ugrc/keys.js';
import { UGRC_KEY_STORAGE_KEY } from '../js/ugrc/config.js';
import { noStateRouteMessage, runReverseMilepostLookup } from '../js/ugrc/lookup.js';

describe('ugrc client URL + normalize', () => {
    it('builds reverse milepost URL with WGS84 defaults', () => {
        const url = buildReverseMilepostUrl({
            lng: -111.891,
            lat: 40.7608,
            apiKey: 'test-key'
        });
        expect(url).toContain('/api/v1/reverse/milepost/-111.891/40.7608?');
        expect(url).toContain('buffer=100');
        expect(url).toContain('spatialReference=4326');
        expect(url).toContain('apiKey=test-key');
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
    afterEach(() => {
        clearUserUgrcApiKey();
    });

    it('stores and clears user override key', () => {
        expect(getUserUgrcApiKey()).toBe('');
        setUserUgrcApiKey('  abc  ');
        expect(getUserUgrcApiKey()).toBe('abc');
        expect(localStorage.getItem(UGRC_KEY_STORAGE_KEY)).toBe('abc');
        clearUserUgrcApiKey();
        expect(getUserUgrcApiKey()).toBe('');
    });

    it('prefers user key over env in resolveUgrcApiKey', () => {
        setUserUgrcApiKey('user-key');
        expect(resolveUgrcApiKey()).toBe('user-key');
    });
});

describe('runReverseMilepostLookup', () => {
    afterEach(() => {
        clearUserUgrcApiKey();
        vi.restoreAllMocks();
    });

    it('opens settings when no key is available and openSettings is provided', async () => {
        const openSettings = vi.fn();
        const showToast = vi.fn();
        const status = await runReverseMilepostLookup(
            { lat: 40.7, lng: -111.9 },
            { showToast, openSettings }
        );
        expect(status).toBe('missing_key');
        expect(openSettings).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenCalled();
    });

    it('does not open settings on PWA-style missing key (toast only)', async () => {
        const showToast = vi.fn();
        const status = await runReverseMilepostLookup(
            { lat: 40.7, lng: -111.9 },
            { showToast }
        );
        expect(status).toBe('missing_key');
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Cloudflare Pages'),
            'warning'
        );
    });

    it('toasts success and copies label', async () => {
        setUserUgrcApiKey('k');
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
