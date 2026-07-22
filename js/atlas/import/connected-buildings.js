/**
 * Connected Buildings CSV mapping (optional Atlas overlay dataset).
 */
import { pickField } from './normalize.js';
import { repairHubValue } from './hub-repair.js';
import { parseHubCoord } from './hub-list.js';

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function trimOrNull(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    return s || null;
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeBuildingHubCode(raw) {
    const repaired = repairHubValue(raw).normalized;
    return repaired || trimOrNull(raw);
}

/**
 * Map one Connected Buildings CSV row (no id yet).
 * @param {Record<string, unknown>} row
 * @returns {{
 *   buildingName: string,
 *   buildingType: string|null,
 *   provider: string|null,
 *   status: string|null,
 *   fromHub: string|null,
 *   toHub: string|null,
 *   address: string|null,
 *   lat: number|null,
 *   lon: number|null,
 *   regionId: string|null,
 *   switch1Ip: string|null,
 *   switch2Ip: string|null,
 *   desktop1Ip: string|null,
 *   desktop2Ip: string|null,
 *   decoder1Ip: string|null,
 *   decoder2Ip: string|null,
 *   decoder3Ip: string|null,
 *   decoder4Ip: string|null,
 *   decoder5Ip: string|null,
 *   decoder6Ip: string|null,
 *   decoder7Ip: string|null,
 *   decoder8Ip: string|null,
 *   decoder9Ip: string|null,
 *   decoder10Ip: string|null
 * }|null}
 */
export function mapConnectedBuildingRow(row) {
    const buildingName = trimOrNull(pickField(row, [
        'Building Name',
        'BuildingName',
        'Building',
        'Name'
    ]));
    if (!buildingName) return null;

    return {
        buildingName,
        buildingType: trimOrNull(pickField(row, ['Building Type', 'BuildingType', 'Type'])),
        provider: trimOrNull(pickField(row, ['Provider'])),
        status: trimOrNull(pickField(row, ['Status'])),
        fromHub: normalizeBuildingHubCode(pickField(row, ['From Hub', 'FromHub', 'From_Hub'])),
        toHub: normalizeBuildingHubCode(pickField(row, ['To Hub', 'ToHub', 'To_Hub'])),
        address: trimOrNull(pickField(row, ['ADDRESS', 'Address', 'Addr'])),
        lat: parseHubCoord(pickField(row, ['latitude', 'Latitude', 'Lat', 'Y'])),
        lon: parseHubCoord(pickField(row, ['longitude', 'Longitude', 'Lon', 'Long', 'X'])),
        regionId: trimOrNull(pickField(row, ['Region_#', 'Region #', 'Region#', 'Region', 'Region Id', 'RegionId'])),
        switch1Ip: trimOrNull(pickField(row, ['Switch_1_IP', 'Switch 1 IP', 'Switch1_IP', 'Switch1IP'])),
        switch2Ip: trimOrNull(pickField(row, ['Switch_2_IP', 'Switch 2 IP', 'Switch2_IP', 'Switch2IP'])),
        desktop1Ip: trimOrNull(pickField(row, ['Desktop_1_IP', 'Desktop 1 IP', 'Desktop1_IP', 'Desktop1IP'])),
        desktop2Ip: trimOrNull(pickField(row, ['Desktop_2_IP', 'Desktop 2 IP', 'Desktop2_IP', 'Desktop2IP'])),
        decoder1Ip: trimOrNull(pickField(row, ['Decoder_1_IP', 'Decoder 1 IP', 'Decoder1_IP', 'Decoder1IP'])),
        decoder2Ip: trimOrNull(pickField(row, ['Decoder_2_IP', 'Decoder 2 IP', 'Decoder2_IP', 'Decoder2IP'])),
        decoder3Ip: trimOrNull(pickField(row, ['Decoder_3_IP', 'Decoder 3 IP', 'Decoder3_IP', 'Decoder3IP'])),
        decoder4Ip: trimOrNull(pickField(row, ['Decoder_4_IP', 'Decoder 4 IP', 'Decoder4_IP', 'Decoder4IP'])),
        decoder5Ip: trimOrNull(pickField(row, ['Decoder_5_IP', 'Decoder 5 IP', 'Decoder5_IP', 'Decoder5IP'])),
        decoder6Ip: trimOrNull(pickField(row, ['Decoder_6_IP', 'Decoder 6 IP', 'Decoder6_IP', 'Decoder6IP'])),
        decoder7Ip: trimOrNull(pickField(row, ['Decoder_7_IP', 'Decoder 7 IP', 'Decoder7_IP', 'Decoder7IP'])),
        decoder8Ip: trimOrNull(pickField(row, ['Decoder_8_IP', 'Decoder 8 IP', 'Decoder8_IP', 'Decoder8IP'])),
        decoder9Ip: trimOrNull(pickField(row, ['Decoder_9_IP', 'Decoder 9 IP', 'Decoder9_IP', 'Decoder9IP'])),
        decoder10Ip: trimOrNull(pickField(row, ['Decoder_10_IP', 'Decoder 10 IP', 'Decoder10_IP', 'Decoder10IP']))
    };
}

/**
 * Deduplicate mapped rows by buildingName (first wins).
 * @param {Record<string, unknown>[]} rows
 * @returns {NonNullable<ReturnType<typeof mapConnectedBuildingRow>>[]}
 */
export function mapConnectedBuildingRows(rows) {
    /** @type {NonNullable<ReturnType<typeof mapConnectedBuildingRow>>[]} */
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
        const mapped = mapConnectedBuildingRow(row);
        if (!mapped || seen.has(mapped.buildingName)) continue;
        seen.add(mapped.buildingName);
        out.push(mapped);
    }
    return out;
}

/**
 * Collect non-empty IP strings from a building entity for search / copy.
 * @param {object} building
 * @returns {string[]}
 */
export function connectedBuildingIps(building) {
    if (!building) return [];
    const keys = [
        'switch1Ip', 'switch2Ip',
        'desktop1Ip', 'desktop2Ip',
        'decoder1Ip', 'decoder2Ip', 'decoder3Ip', 'decoder4Ip', 'decoder5Ip',
        'decoder6Ip', 'decoder7Ip', 'decoder8Ip', 'decoder9Ip', 'decoder10Ip'
    ];
    /** @type {string[]} */
    const out = [];
    for (const key of keys) {
        const v = trimOrNull(building[key]);
        if (v) out.push(v);
    }
    return out;
}
