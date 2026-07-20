import { describe, expect, it } from 'vitest';
import { listScopedDropsByPing } from '../js/atlas/triage.js';
import { formatPingAge, isPingStale, parsePingAt } from '../js/atlas/ping-format.js';
import { buildImportFindings } from '../js/atlas/import/audit.js';

describe('atlas ping format', () => {
    it('parses unix seconds and ISO', () => {
        expect(parsePingAt('1700000000')).toBeInstanceOf(Date);
        expect(parsePingAt('2026-07-20T12:00:00.000Z')).toBeInstanceOf(Date);
        expect(formatPingAge(null)).toBe('no ping yet');
        expect(isPingStale(null)).toBe(true);
        expect(isPingStale(new Date().toISOString(), 24)).toBe(false);
    });
});

describe('atlas unreachable triage', () => {
    it('lists unreachable drops in channel selection', () => {
        const snap = {
            channels: [{ id: 'c1', channelNumber: '12' }],
            drops: [
                { id: 'd1', channelId: 'c1', channelNumber: '12', dropNumber: 1, ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c1', channelNumber: '12', dropNumber: 2, ip: '10.0.0.2' },
                { id: 'd3', channelId: 'c2', channelNumber: '99', dropNumber: 1, ip: '10.0.0.3' }
            ],
            pingResults: {
                '10.0.0.1': { status: 'unreachable', at: new Date().toISOString() },
                '10.0.0.2': { status: 'reachable', at: new Date().toISOString() },
                '10.0.0.3': { status: 'unreachable', at: new Date().toISOString() }
            },
            selection: { kind: 'channel', id: 'c1' }
        };
        const rows = listScopedDropsByPing(snap, { scope: 'selection' });
        expect(rows).toHaveLength(1);
        expect(rows[0].ip).toBe('10.0.0.1');
    });
});

describe('atlas findings entity link', () => {
    it('attaches entityId for missing site id when drops provided', () => {
        const findings = buildImportFindings({
            joined: [{
                tmd: { inventoryName: 'Site A', siteId: null, channel: '1', drop: 1 },
                switchFiber: { inventoryName: 'Site A', ip: '10.0.0.1' },
                coordDisagree: false
            }],
            atmsMatches: [],
            devices: [{ id: 'dev1', ip: '10.0.0.1' }],
            drops: [{ id: 'drop1', inventoryName: 'Site A', ip: '10.0.0.1' }],
            sites: [{ id: 'site1', inventoryName: 'Site A' }],
            channels: []
        });
        const missing = findings.find((f) => f.findingType === 'missing_site_id');
        expect(missing?.entityId).toBe('drop1');
        expect(missing?.entityKind).toBe('drop');
    });
});
