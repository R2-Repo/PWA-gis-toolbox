import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectHubIps, dropsInScope, findingsInScope, listScopedDropsByPing } from '../js/atlas/triage.js';
import { formatPingAge, isPingStale, parsePingAt } from '../js/atlas/ping-format.js';
import { buildImportFindings } from '../js/atlas/import/audit.js';
import { queryAtlasInArea, pointInGeometry } from '../js/atlas/area-query.js';
import { getAtlasSnapshot, patchAtlasSnapshot, resetAtlasSnapshot } from '../js/atlas/store.js';
import { buildChannelSchematic } from '../js/atlas/schematic.js';

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

    it('lists stale and untested modes', () => {
        const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        const snap = {
            drops: [
                { id: 'd1', channelId: 'c1', channelNumber: '1', dropNumber: 1, ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c1', channelNumber: '1', dropNumber: 2, ip: '10.0.0.2' },
                { id: 'd3', channelId: 'c1', channelNumber: '1', dropNumber: 3, ip: '10.0.0.3' }
            ],
            pingResults: {
                '10.0.0.1': { status: 'reachable', at: old },
                '10.0.0.2': { status: 'reachable', at: new Date().toISOString() }
            },
            selection: null
        };
        expect(listScopedDropsByPing(snap, { mode: 'stale' }).map((r) => r.ip)).toEqual(['10.0.0.1']);
        expect(listScopedDropsByPing(snap, { mode: 'untested' }).map((r) => r.ip)).toEqual(['10.0.0.3']);
        expect(listScopedDropsByPing(snap, { mode: 'attention' }).map((r) => r.ip).sort())
            .toEqual(['10.0.0.1', '10.0.0.3']);
    });

    it('collects hub switch ips by role', () => {
        const snap = {
            hubs: [{ id: 'h1', hubCode: 'H1' }],
            channels: [
                { id: 'c1', primaryHubId: 'h1', primaryHubCode: 'H1' },
                { id: 'c2', secondaryHubId: 'h1', secondaryHubCode: 'H1' }
            ],
            drops: [
                { id: 'd1', channelId: 'c1', ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c2', ip: '10.0.0.2' }
            ]
        };
        expect(collectHubIps('h1', 'primary', snap)).toEqual(['10.0.0.1']);
        expect(collectHubIps('h1', 'secondary', snap)).toEqual(['10.0.0.2']);
        expect(collectHubIps('h1', 'all', snap).sort()).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    it('entity selection overrides stale areaResults', () => {
        const snap = {
            channels: [{ id: 'c1' }, { id: 'c2' }],
            drops: [
                { id: 'd1', channelId: 'c1', ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c2', ip: '10.0.0.2' }
            ],
            areaResults: { drops: [{ id: 'd2', channelId: 'c2', ip: '10.0.0.2' }] },
            selection: { kind: 'channel', id: 'c1' },
            findings: [
                { id: 'f1', entityId: 'd1', status: 'Open' },
                { id: 'f2', entityId: 'd2', status: 'Open' }
            ]
        };
        expect(dropsInScope(snap, 'selection').map((d) => d.id)).toEqual(['d1']);
        expect(findingsInScope(snap, 'selection').map((f) => f.id)).toEqual(['f1']);
    });
});

describe('atlas area + schematic', () => {
    beforeEach(() => {
        resetAtlasSnapshot();
    });
    afterEach(() => {
        resetAtlasSnapshot();
    });

    it('keeps geometry and IP-linked warnings in area results', () => {
        const geometry = {
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
        };
        expect(pointInGeometry([1, 1], geometry)).toBe(true);
        patchAtlasSnapshot({
            drops: [
                { id: 'd1', channelId: 'c1', lat: 1, lon: 1, ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c1', lat: 9, lon: 9, ip: '10.0.0.2' }
            ],
            hubs: [],
            channels: [{ id: 'c1', channelNumber: '1' }],
            devices: [],
            findings: [
                { id: 'f1', status: 'Open', ip: '10.0.0.1', findingType: 'duplicate_ip' },
                { id: 'f2', status: 'Open', entityId: 'd2', findingType: 'missing_site_id' }
            ]
        });
        const results = queryAtlasInArea(geometry);
        expect(results.geometry).toEqual(geometry);
        expect(results.drops.map((d) => d.id)).toEqual(['d1']);
        expect(results.warnings.map((f) => f.id)).toEqual(['f1']);
    });

    it('attaches open findings to schematic drop nodes', () => {
        patchAtlasSnapshot({
            channels: [{
                id: 'c1',
                channelNumber: '12',
                primaryHubCode: 'H1',
                secondaryHubCode: 'H2'
            }],
            drops: [
                { id: 'd1', channelId: 'c1', dropNumber: 1, ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c1', dropNumber: 2, ip: '10.0.0.2' }
            ],
            pingResults: {},
            findings: [
                { id: 'f1', status: 'Open', entityId: 'd1', findingType: 'missing_site_id' }
            ]
        });
        const schematic = buildChannelSchematic('c1');
        expect(schematic?.openFindings).toBe(1);
        const dropNode = schematic?.nodes.find((n) => n.id === 'd1');
        expect(dropNode?.warnings).toHaveLength(1);
        expect(getAtlasSnapshot().channels).toHaveLength(1);
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
