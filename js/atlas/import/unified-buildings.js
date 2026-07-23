/**
 * Unified buildings import (V2): one CSV/sheet with Building Type column.
 */
import { pickField } from './normalize.js';
import { mapHubListRow, parseHubCoord, parseIsShed, normalizeHubListCode } from './hub-list.js';
import { mapConnectedBuildingRow } from './connected-buildings.js';

/**
 * @param {unknown} raw
 */
function trimOrNull(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    return s || null;
}

/**
 * @param {Record<string, unknown>} row
 */
export function isHubBuildingType(row) {
    const t = trimOrNull(pickField(row, [
        'Building Type', 'BuildingType', 'Site Type', 'SiteType', 'Type'
    ]));
    if (!t) return false;
    const u = t.toUpperCase();
    return u === 'HUB' || u === 'SHED' || u.startsWith('HUB ');
}

/**
 * Map unified buildings rows to hub + connected building entities.
 * @param {Record<string, unknown>[]} rows
 */
export function mapUnifiedBuildingsRows(rows) {
    /** @type {NonNullable<ReturnType<typeof mapHubListRow>>[]} */
    const hubs = [];
    /** @type {NonNullable<ReturnType<typeof mapConnectedBuildingRow>>[]} */
    const buildings = [];
    const seenHub = new Set();
    const seenBuilding = new Set();

    for (const row of rows || []) {
        if (isHubBuildingType(row)) {
            const hubNumber = pickField(row, ['Hub_Number', 'Hub Number', 'HubNumber', 'Hub']);
            const hubCode = normalizeHubListCode(hubNumber)
                || normalizeHubListCode(pickField(row, ['Building Name', 'Name']));
            if (!hubCode || seenHub.has(hubCode)) continue;
            seenHub.add(hubCode);
            const aka = trimOrNull(pickField(row, ['Hub_AKA', 'Hub AKA', 'AKA', 'Building Name', 'Name']));
            hubs.push({
                hubCode,
                name: aka || `Hub ${hubCode}`,
                aka,
                hubIp: trimOrNull(pickField(row, ['Hub_IP', 'Hub IP', 'HubIP', 'Switch_1_IP', 'Switch 1 IP'])),
                channelsSubnet: trimOrNull(pickField(row, ['Channels_Subnet', 'Channels Subnet', 'Subnet'])),
                lat: parseHubCoord(pickField(row, ['Lat', 'Latitude', 'latitude', 'Y'])),
                lon: parseHubCoord(pickField(row, ['Lon', 'Longitude', 'longitude', 'Long', 'X'])),
                regionId: trimOrNull(pickField(row, ['Region #', 'Region#', 'Region', 'Region Id'])),
                isShed: parseIsShed(pickField(row, ['Is_Shed', 'Is Shed', 'Shed']))
                    || String(pickField(row, ['Building Type', 'Type']) || '').toUpperCase() === 'SHED',
                fromOfficialList: true
            });
        } else {
            const mapped = mapConnectedBuildingRow(row);
            if (!mapped || seenBuilding.has(mapped.buildingName)) continue;
            seenBuilding.add(mapped.buildingName);
            buildings.push(mapped);
        }
    }

    return { hubs, buildings };
}

/**
 * @param {{ name?: string }} file
 */
export function isUnifiedBuildingsFilename(file) {
    const n = String(file?.name || '').toLowerCase();
    if (!n.endsWith('.csv') && !n.endsWith('.txt')) return false;
    if (n.includes('connected') && n.includes('building')) return false;
    return (n.includes('building') || n.includes('buildings') || n.includes('sites'))
        && (n.includes('unified') || n.includes('all') || n.includes('master'));
}
