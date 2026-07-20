import { describe, expect, it } from 'vitest';
import { repairHubValue } from '../js/atlas/import/hub-repair.js';
import { normalizeInventoryName, normalizeDropNumber } from '../js/atlas/import/normalize.js';
import { joinWorkbookTabs, mapTmdRow, mapSwitchFiberRow, mapAtmsSwitchRow } from '../js/atlas/import/match.js';
import { buildImportFindings } from '../js/atlas/import/audit.js';
import { pointInGeometry } from '../js/atlas/area-query.js';
import { createWebPlatform } from '../js/platform/web/web-platform.js';
import { hasCapability } from '../js/platform/contracts.js';

describe('atlas hub repair', () => {
    it('normalizes date-slash hub values', () => {
        const known = new Set(['4-01']);
        const r = repairHubValue('4/1/2026', known);
        expect(r.normalized).toBe('4-01');
        expect(r.confidence).toBe('high');
        expect(r.raw).toBe('4/1/2026');
    });

    it('normalizes day-month-name hub values', () => {
        const r = repairHubValue('1-Apr');
        expect(r.normalized).toBe('4-01');
        expect(r.raw).toBe('1-Apr');
    });
});

describe('atlas normalize + match', () => {
    it('joins workbook tabs by inventory name', () => {
        expect(normalizeInventoryName('  Site  A ')).toBe('SITE A');
        expect(normalizeDropNumber('D12')).toBe(12);

        const tmd = [mapTmdRow({
            'Inventory Name': 'Site A',
            'Site ID': 'S1',
            Latitude: 40.1,
            Longitude: -105.1,
            'Fiber Channel': '12',
            Drop: 3
        })];
        const sw = [mapSwitchFiberRow({
            'Inventory Name': 'Site A',
            Latitude: 40.1,
            Longitude: -105.1,
            'Network IP Address': '10.0.0.1',
            Manufacturer: 'Cisco',
            Model: 'IE-3000'
        })];
        const { joined } = joinWorkbookTabs(tmd, sw);
        expect(joined).toHaveLength(1);
        expect(joined[0].switchFiber.ip).toBe('10.0.0.1');
        expect(joined[0].matchConfidence).toBe('high');
    });

    it('maps ATMS switches and flags findings', () => {
        const atms = mapAtmsSwitchRow({
            'Device Type': 'SWTN1',
            ChannelID: '12',
            Drop: 3,
            IP: '10.0.0.9',
            'Pri Hub': '4/1/2026',
            'Sec Hub': '5-02',
            Subnet: '10.0.0.0',
            Gateway: '10.0.0.1'
        });
        expect(atms.isSwitch).toBe(true);
        expect(atms.priHub).toBe('4-01');
        expect(atms.subnet).toBe('10.0.0.0');

        const findings = buildImportFindings({
            joined: [{ tmd: { inventoryName: 'X', siteId: null, channel: '1', drop: null }, switchFiber: null, coordDisagree: false }],
            atmsMatches: [{ atms, matchConfidence: 'unmatched', provisional: true }],
            devices: [{ ip: '1.1.1.1' }, { ip: '1.1.1.1' }]
        });
        expect(findings.some((f) => f.findingType === 'missing_site_id')).toBe(true);
        expect(findings.some((f) => f.findingType === 'duplicate_ip')).toBe(true);
        expect(findings.some((f) => f.findingType === 'atms_unmatched')).toBe(true);
    });
});

describe('atlas area query', () => {
    it('detects points inside a polygon', () => {
        const poly = {
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
        };
        expect(pointInGeometry([1, 1], poly)).toBe(true);
        expect(pointInGeometry([3, 3], poly)).toBe(false);
    });
});

describe('atlas web gating', () => {
    it('marks localSqlite and icmpPing unavailable on web', () => {
        const { platform, services } = createWebPlatform();
        expect(hasCapability(platform, 'localSqlite')).toBe(false);
        expect(hasCapability(platform, 'icmpPing')).toBe(false);
        expect(services.atlasDb).toBeTruthy();
        expect(services.ping).toBeTruthy();
    });
});
