/**
 * Official Hub List CSV mapping (physical hub registry).
 */
import { pickField } from './normalize.js';
import { repairHubValue } from './hub-repair.js';

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseHubCoord(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
export function parseIsShed(raw) {
    if (raw == null || raw === '') return false;
    const s = String(raw).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'shed';
}

/**
 * Normalize Hub_Number / display code to hubCode (e.g. Hub 1-01 → 1-01).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeHubListCode(raw) {
    return repairHubValue(raw).normalized;
}

/**
 * Map one Hub List CSV row to a hub entity template (no id yet).
 * @param {Record<string, unknown>} row
 * @returns {{ hubCode: string, name: string, aka: string|null, hubIp: string|null, channelsSubnet: string|null, lat: number|null, lon: number|null, regionId: string|null, isShed: boolean, fromOfficialList: true }|null}
 */
export function mapHubListRow(row) {
    const hubNumber = pickField(row, ['Hub_Number', 'Hub Number', 'HubNumber', 'Hub']);
    const hubCode = normalizeHubListCode(hubNumber);
    if (!hubCode) return null;

    const akaRaw = pickField(row, ['Hub_AKA', 'Hub AKA', 'AKA', 'HubAka']);
    const aka = akaRaw != null && String(akaRaw).trim() ? String(akaRaw).trim() : null;
    const hubIpRaw = pickField(row, ['Hub_IP', 'Hub IP', 'HubIP', 'IP']);
    const hubIp = hubIpRaw != null && String(hubIpRaw).trim() ? String(hubIpRaw).trim() : null;
    const subnetRaw = pickField(row, ['Channels_Subnet', 'Channels Subnet', 'Channel Subnet', 'Subnet']);
    const channelsSubnet = subnetRaw != null && String(subnetRaw).trim() ? String(subnetRaw).trim() : null;
    const regionRaw = pickField(row, ['Region #', 'Region#', 'Region', 'Region Id', 'RegionId']);
    const regionId = regionRaw != null && String(regionRaw).trim() !== ''
        ? String(regionRaw).trim()
        : null;

    return {
        hubCode,
        name: aka || `Hub ${hubCode}`,
        aka,
        hubIp,
        channelsSubnet,
        lat: parseHubCoord(pickField(row, ['Lat', 'Latitude', 'Y'])),
        lon: parseHubCoord(pickField(row, ['Lon', 'Longitude', 'Long', 'X'])),
        regionId,
        isShed: parseIsShed(pickField(row, ['Is_Shed', 'Is Shed', 'Shed'])),
        fromOfficialList: true
    };
}

/**
 * Deduplicate mapped hub list rows by hubCode (first wins).
 * @param {Record<string, unknown>[]} rows
 * @returns {NonNullable<ReturnType<typeof mapHubListRow>>[]}
 */
export function mapHubListRows(rows) {
    /** @type {NonNullable<ReturnType<typeof mapHubListRow>>[]} */
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
        const mapped = mapHubListRow(row);
        if (!mapped || seen.has(mapped.hubCode)) continue;
        seen.add(mapped.hubCode);
        out.push(mapped);
    }
    return out;
}
