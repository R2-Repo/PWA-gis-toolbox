import { describe, expect, it } from 'vitest';
import { diffAtlasImport } from '../js/atlas/import/diff.js';
import { buildDashboardStats } from '../js/atlas/export.js';

describe('atlas import diff', () => {
    it('detects new and missing IPs', () => {
        const current = {
            loaded: true,
            devices: [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }],
            channels: [{ channelNumber: '1' }],
            drops: [{ channelNumber: '1', dropNumber: 1, ip: '10.0.0.1' }]
        };
        const payload = {
            devices: [{ ip: '10.0.0.2' }, { ip: '10.0.0.3' }],
            channels: [{ channelNumber: '1' }, { channelNumber: '2' }],
            drops: [
                { channelNumber: '1', dropNumber: 1, ip: '10.0.0.2' },
                { channelNumber: '2', dropNumber: 1, ip: '10.0.0.3' }
            ]
        };
        const diff = diffAtlasImport(payload, current);
        expect(diff.counts.newIps).toBe(1);
        expect(diff.newIps).toContain('10.0.0.3');
        expect(diff.missingIps).toContain('10.0.0.1');
        expect(diff.counts.newChannels).toBe(1);
    });
});

describe('atlas dashboard scope', () => {
    it('scopes stats to selected channel', () => {
        const snap = {
            hubs: [{ id: 'h1', hubCode: '4-01' }],
            channels: [
                { id: 'c1', channelNumber: '1', primaryHubCode: '4-01' },
                { id: 'c2', channelNumber: '2', primaryHubCode: '4-01' }
            ],
            drops: [
                { id: 'd1', channelId: 'c1', ip: '10.0.0.1' },
                { id: 'd2', channelId: 'c2', ip: '10.0.0.2' }
            ],
            devices: [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }],
            sites: [],
            findings: [],
            pingResults: {
                '10.0.0.1': { status: 'reachable' },
                '10.0.0.2': { status: 'unreachable' }
            },
            selection: { kind: 'channel', id: 'c1' }
        };
        const stats = buildDashboardStats(snap, { scope: 'selection' });
        expect(stats.scopeLabel).toBe('Channel');
        expect(stats.channels).toBe(1);
        expect(stats.drops).toBe(1);
        expect(stats.pingReachable).toBe(1);
        expect(stats.pingUnreachable).toBe(0);
    });
});
