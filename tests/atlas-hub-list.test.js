import { describe, expect, it } from 'vitest';
import {
    mapHubListRow,
    mapHubListRows,
    normalizeHubListCode,
    parseHubCoord,
    parseIsShed
} from '../js/atlas/import/hub-list.js';
import {
    detectInboxSources,
    isHubListFilename,
    pickNewestAtmsCsv,
    pickNewestHubList
} from '../js/atlas/import/detect-inbox-files.js';
import { buildImportFindings } from '../js/atlas/import/audit.js';

describe('atlas hub list', () => {
    it('normalizes Hub_Number to hubCode', () => {
        expect(normalizeHubListCode('Hub 1-01')).toBe('1-01');
        expect(normalizeHubListCode('2-01')).toBe('2-01');
        expect(normalizeHubListCode('')).toBe(null);
    });

    it('maps sample Hub List row', () => {
        const mapped = mapHubListRow({
            Hub_Number: 'Hub 1-01',
            Hub_AKA: 'US-89/I-84',
            Is_Shed: '',
            Hub_IP: '10.231.255.1',
            Channels_Subnet: '10.231.x.x',
            Lat: '41.13676',
            Lon: '-111.91216',
            'Region #': '1'
        });
        expect(mapped).toMatchObject({
            hubCode: '1-01',
            name: 'US-89/I-84',
            aka: 'US-89/I-84',
            hubIp: '10.231.255.1',
            channelsSubnet: '10.231.x.x',
            lat: 41.13676,
            lon: -111.91216,
            regionId: '1',
            isShed: false,
            fromOfficialList: true
        });
    });

    it('parses coords and shed flags', () => {
        expect(parseHubCoord('40.5')).toBe(40.5);
        expect(parseHubCoord('x')).toBe(null);
        expect(parseIsShed('yes')).toBe(true);
        expect(parseIsShed('')).toBe(false);
    });

    it('dedupes by hubCode', () => {
        const rows = mapHubListRows([
            { Hub_Number: 'Hub 1-01', Hub_AKA: 'First', Lat: '1', Lon: '2' },
            { Hub_Number: 'Hub 1-01', Hub_AKA: 'Second', Lat: '3', Lon: '4' }
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0].aka).toBe('First');
    });

    it('detects hub list filenames and excludes them from ATMS pick', () => {
        expect(isHubListFilename({ name: 'Hub List Sample.csv' })).toBe(true);
        expect(isHubListFilename({ name: 'ATMS Master.csv' })).toBe(false);
        const files = [
            { name: 'Hub List Sample.csv', ext: 'csv', path: 'hub.csv', modifiedMs: 300 },
            { name: 'ATMS Master Device List.csv', ext: 'csv', path: 'atms.csv', modifiedMs: 100 },
            { name: 'FiberSwitchLocation 2026-07-18.xlsx', ext: 'xlsx', path: 'wb.xlsx', modifiedMs: 1 }
        ];
        expect(pickNewestHubList(files).path).toBe('hub.csv');
        expect(pickNewestAtmsCsv(files).path).toBe('atms.csv');
        const src = detectInboxSources(files);
        expect(src.hubList.path).toBe('hub.csv');
        expect(src.atms.path).toBe('atms.csv');
        expect(src.workbook.path).toBe('wb.xlsx');
    });

    it('flags ATMS hubs missing from official list', () => {
        const findings = buildImportFindings({
            hubs: [{ id: 'h1', hubCode: '9-99' }],
            officialHubCodes: new Set(['1-01']),
            inferredHubCodes: new Set(['9-99'])
        });
        expect(findings.some((f) => f.findingType === 'hub_not_in_official_list')).toBe(true);
    });
});
