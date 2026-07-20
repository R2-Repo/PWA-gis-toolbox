/**
 * Matching / join logic for workbook tabs + ATMS.
 */
import {
    normalizeInventoryName,
    normalizeIp,
    normalizeChannel,
    normalizeDropNumber,
    normalizeCoord,
    pickField
} from './normalize.js';
import { repairHubValue } from './hub-repair.js';

/**
 * @param {Record<string, unknown>} row
 */
export function mapTmdRow(row) {
    const inventoryName = String(pickField(row, ['Inventory Name', 'InventoryName']) ?? '').trim();
    return {
        source: 'TMDITSSignalSite',
        inventoryName,
        inventoryKey: normalizeInventoryName(inventoryName),
        siteId: String(pickField(row, ['Site ID', 'SiteID']) ?? '').trim() || null,
        lat: normalizeCoord(pickField(row, ['Latitude', 'Lat'])),
        lon: normalizeCoord(pickField(row, ['Longitude', 'Lon', 'Long'])),
        channel: normalizeChannel(pickField(row, ['Fiber Channel', 'FiberChannel', 'Channel', 'ChannelID'])),
        drop: normalizeDropNumber(pickField(row, ['Drop', 'Drop Number', 'DropNumber'])),
        raw: { ...row }
    };
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapSwitchFiberRow(row) {
    const inventoryName = String(pickField(row, ['Inventory Name', 'InventoryName']) ?? '').trim();
    return {
        source: 'SwitchFiber',
        inventoryName,
        inventoryKey: normalizeInventoryName(inventoryName),
        lat: normalizeCoord(pickField(row, ['Latitude', 'Lat'])),
        lon: normalizeCoord(pickField(row, ['Longitude', 'Lon', 'Long'])),
        ip: normalizeIp(pickField(row, ['Network IP Address', 'NetworkIPAddress', 'IP', 'IP Address'])),
        deviceKey: String(pickField(row, ['IP Network Device Key', 'IPNetworkDeviceKey']) ?? '').trim() || null,
        manufacturer: String(pickField(row, ['Manufacturer']) ?? '').trim() || null,
        model: String(pickField(row, ['Model']) ?? '').trim() || null,
        status: String(pickField(row, ['Status']) ?? '').trim() || null,
        subnetMask: String(pickField(row, ['Subnet Mask', 'SubnetMask']) ?? '').trim() || null,
        raw: { ...row }
    };
}

/**
 * @param {Record<string, unknown>} row
 * @param {Set<string>} [knownHubs]
 */
export function mapAtmsSwitchRow(row, knownHubs = new Set()) {
    const deviceType = String(pickField(row, ['Device Type', 'DeviceType']) ?? '').trim();
    const priRaw = pickField(row, ['Pri Hub', 'PriHub', 'Primary Hub']);
    const secRaw = pickField(row, ['Sec Hub', 'SecHub', 'Secondary Hub']);
    const pri = repairHubValue(priRaw, knownHubs);
    const sec = repairHubValue(secRaw, knownHubs);
    return {
        source: 'ATMS',
        deviceType,
        isSwitch: /^SWTN/i.test(deviceType),
        channel: normalizeChannel(pickField(row, ['ChannelID', 'Channel ID', 'Channel', 'Fiber Channel'])),
        drop: normalizeDropNumber(pickField(row, ['Drop', 'Drop Number'])),
        ip: normalizeIp(pickField(row, ['IP', 'IP Address', 'Network IP Address'])),
        subnet: String(pickField(row, ['Subnet']) ?? '').trim() || null,
        gateway: String(pickField(row, ['Gateway']) ?? '').trim() || null,
        priHubRaw: pri.raw,
        priHub: pri.normalized,
        priHubConfidence: pri.confidence,
        secHubRaw: sec.raw,
        secHub: sec.normalized,
        secHubConfidence: sec.confidence,
        raw: { ...row }
    };
}

/**
 * Join TMD + SwitchFiber by inventory key; validate coords.
 * @param {ReturnType<typeof mapTmdRow>[]} tmdRows
 * @param {ReturnType<typeof mapSwitchFiberRow>[]} switchRows
 */
export function joinWorkbookTabs(tmdRows, switchRows) {
    /** @type {Map<string, ReturnType<typeof mapSwitchFiberRow>>} */
    const byInv = new Map();
    for (const row of switchRows) {
        if (row.inventoryKey) byInv.set(row.inventoryKey, row);
    }

    const joined = [];
    const unmatchedSwitch = [];
    const used = new Set();

    for (const tmd of tmdRows) {
        const sw = tmd.inventoryKey ? byInv.get(tmd.inventoryKey) : null;
        if (sw) {
            used.add(tmd.inventoryKey);
            const coordWarn =
                tmd.lat != null && sw.lat != null &&
                (Math.abs(tmd.lat - sw.lat) > 0.0005 || Math.abs((tmd.lon ?? 0) - (sw.lon ?? 0)) > 0.0005);
            joined.push({
                tmd,
                switchFiber: sw,
                matchConfidence: 'high',
                coordDisagree: Boolean(coordWarn)
            });
        } else {
            joined.push({
                tmd,
                switchFiber: null,
                matchConfidence: 'site-only',
                coordDisagree: false
            });
        }
    }

    for (const sw of switchRows) {
        if (sw.inventoryKey && !used.has(sw.inventoryKey)) {
            unmatchedSwitch.push(sw);
        }
    }

    return { joined, unmatchedSwitch };
}

/**
 * Match ATMS switches to SwitchFiber by IP, then channel+drop.
 * @param {ReturnType<typeof mapAtmsSwitchRow>[]} atmsRows
 * @param {ReturnType<typeof mapSwitchFiberRow>[]} switchRows
 * @param {ReturnType<typeof mapTmdRow>[]} tmdRows
 */
export function matchAtmsToWorkbook(atmsRows, switchRows, tmdRows) {
    const byIp = new Map(switchRows.filter((r) => r.ip).map((r) => [r.ip, r]));
    const tmdByChannelDrop = new Map();
    for (const t of tmdRows) {
        if (t.channel && t.drop != null) {
            tmdByChannelDrop.set(`${t.channel}|${t.drop}`, t);
        }
    }

    return atmsRows.filter((r) => r.isSwitch).map((atms) => {
        if (atms.ip && byIp.has(atms.ip)) {
            return { atms, switchFiber: byIp.get(atms.ip), matchConfidence: 'exact-ip', provisional: false };
        }
        const tmd = atms.channel && atms.drop != null
            ? tmdByChannelDrop.get(`${atms.channel}|${atms.drop}`)
            : null;
        if (tmd) {
            return { atms, tmd, switchFiber: null, matchConfidence: 'channel-drop', provisional: true };
        }
        return { atms, switchFiber: null, matchConfidence: 'unmatched', provisional: true };
    });
}
