import { describe, expect, it } from 'vitest';
import {
    connectedBuildingIps,
    mapConnectedBuildingRow,
    mapConnectedBuildingRows
} from '../js/atlas/import/connected-buildings.js';
import {
    detectInboxSources,
    isConnectedBuildingsFilename,
    isHubListFilename,
    pickNewestAtmsCsv,
    pickNewestConnectedBuildings,
    pickNewestHubList
} from '../js/atlas/import/detect-inbox-files.js';

describe('atlas connected buildings', () => {
    it('maps sample Connected Buildings row', () => {
        const mapped = mapConnectedBuildingRow({
            'Building Name': 'Main Yard Bldg',
            'Building Type': 'Shelter',
            Provider: 'UDOT',
            Status: 'Active',
            'From Hub': 'Hub 1-01',
            'To Hub': 'Hub 1-02',
            ADDRESS: '123 Main St',
            longitude: '-111.91216',
            latitude: '41.13676',
            'Region_#': '1',
            Switch_1_IP: '10.1.1.10',
            Switch_2_IP: '',
            Desktop_1_IP: '10.1.1.20',
            Desktop_2_IP: '',
            Decoder_1_IP: '10.1.1.31',
            Decoder_2_IP: '',
            Decoder_3_IP: '',
            Decoder_4_IP: '',
            Decoder_5_IP: '',
            Decoder_6_IP: '',
            Decoder_7_IP: '',
            Decoder_8_IP: '',
            Decoder_9_IP: '',
            Decoder_10_IP: ''
        });
        expect(mapped).toMatchObject({
            buildingName: 'Main Yard Bldg',
            buildingType: 'Shelter',
            provider: 'UDOT',
            status: 'Active',
            fromHub: '1-01',
            toHub: '1-02',
            address: '123 Main St',
            lat: 41.13676,
            lon: -111.91216,
            regionId: '1',
            switch1Ip: '10.1.1.10',
            desktop1Ip: '10.1.1.20',
            decoder1Ip: '10.1.1.31'
        });
        expect(connectedBuildingIps(mapped)).toEqual(['10.1.1.10', '10.1.1.20', '10.1.1.31']);
    });

    it('skips rows without Building Name and dedupes by name', () => {
        expect(mapConnectedBuildingRow({ ADDRESS: 'No name' })).toBe(null);
        const rows = mapConnectedBuildingRows([
            { 'Building Name': 'A', latitude: '1', longitude: '2' },
            { 'Building Name': 'A', latitude: '3', longitude: '4' },
            { 'Building Name': 'B', latitude: '5', longitude: '6' }
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[0].lat).toBe(1);
        expect(rows[1].buildingName).toBe('B');
    });

    it('detects Connected Buildings filenames and excludes them from ATMS / Hub List', () => {
        expect(isConnectedBuildingsFilename({ name: 'Connected Buildings.csv' })).toBe(true);
        expect(isConnectedBuildingsFilename({ name: 'ATMS Master.csv' })).toBe(false);
        expect(isHubListFilename({ name: 'Connected Buildings Hub List.csv' })).toBe(false);

        const files = [
            { name: 'Connected Buildings.csv', ext: 'csv', path: 'bldg.csv', modifiedMs: 400 },
            { name: 'Hub List Sample.csv', ext: 'csv', path: 'hub.csv', modifiedMs: 300 },
            { name: 'ATMS Master Device List.csv', ext: 'csv', path: 'atms.csv', modifiedMs: 100 },
            { name: 'FiberSwitchLocation 2026-07-18.xlsx', ext: 'xlsx', path: 'wb.xlsx', modifiedMs: 1 }
        ];
        expect(pickNewestConnectedBuildings(files).path).toBe('bldg.csv');
        expect(pickNewestHubList(files).path).toBe('hub.csv');
        expect(pickNewestAtmsCsv(files).path).toBe('atms.csv');
        const src = detectInboxSources(files);
        expect(src.connectedBuildings.path).toBe('bldg.csv');
        expect(src.hubList.path).toBe('hub.csv');
        expect(src.atms.path).toBe('atms.csv');
        expect(src.workbook.path).toBe('wb.xlsx');
    });
});
