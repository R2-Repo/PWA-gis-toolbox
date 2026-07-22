/**
 * Atlas import pipeline: parse → normalize → match → entities → findings.
 */
import { loadXLSX } from '../../core/libs.js';
import {
    detectWorkbookSheetRole,
    detectSourceFileKind,
    inferWireless,
    pickField
} from './normalize.js';
import {
    mapTmdRow,
    mapSwitchFiberRow,
    mapAtmsSwitchRow,
    joinWorkbookTabs,
    matchAtmsToWorkbook
} from './match.js';
import { buildImportFindings } from './audit.js';
import { mapHubListRows } from './hub-list.js';
import { mapConnectedBuildingRows } from './connected-buildings.js';

function uid() {
    return crypto.randomUUID();
}

/**
 * Parse CSV text to rows.
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
export function parseCsvText(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) return [];
    const parseLine = (line) => {
        const cells = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQ = !inQ;
                }
            } else if (ch === ',' && !inQ) {
                cells.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        cells.push(cur);
        return cells;
    };
    const headers = parseLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cells = parseLine(line);
        /** @type {Record<string, unknown>} */
        const row = {};
        headers.forEach((h, i) => {
            row[h] = cells[i] ?? '';
        });
        return row;
    });
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ sheetName: string, fields: string[], rows: Record<string, unknown>[] }[]>}
 */
export async function readWorkbookSheets(buffer) {
    const xlsx = await loadXLSX();
    if (!xlsx?.read || !xlsx?.utils) {
        throw new Error('SheetJS library not loaded');
    }
    // cellDates: false so hub-like values stay closer to raw text when possible
    const workbook = xlsx.read(buffer, { type: 'array', cellDates: false, raw: false });
    return workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: false });
        const fields = rows[0] ? Object.keys(rows[0]) : [];
        return { sheetName, fields, rows };
    });
}

/**
 * Build a full import payload ready for DatabaseService.applyImport.
 * @param {{
 *   workbookFile?: { name: string, buffer: ArrayBuffer },
 *   atmsFile?: { name: string, text: string },
 *   hubListFile?: { name: string, text: string },
 *   connectedBuildingsFile?: { name: string, text: string },
 *   batchDate?: string
 * }} input
 */
export async function buildAtlasImportPayload(input) {
    const batchId = uid();
    const importedAt = new Date().toISOString();
    const batchDate = input.batchDate || importedAt.slice(0, 10);

    let tmdRows = [];
    let switchRows = [];
    /** @type {object[]} */
    const rawRecords = [];

    if (input.workbookFile?.buffer) {
        const sheets = await readWorkbookSheets(input.workbookFile.buffer);
        for (const sheet of sheets) {
            const role = detectWorkbookSheetRole(sheet.sheetName, sheet.fields);
            for (const row of sheet.rows) {
                rawRecords.push({
                    id: uid(),
                    batchId,
                    source: role === 'tmd' ? 'TMDITSSignalSite' : role === 'switchfiber' ? 'SwitchFiber' : sheet.sheetName,
                    payload: row
                });
            }
            if (role === 'tmd') tmdRows = sheet.rows.map(mapTmdRow);
            else if (role === 'switchfiber') switchRows = sheet.rows.map(mapSwitchFiberRow);
            else if (!tmdRows.length && sheet.rows.some((r) => pickField(r, ['Site ID']))) {
                tmdRows = sheet.rows.map(mapTmdRow);
            } else if (!switchRows.length && sheet.rows.some((r) => pickField(r, ['Network IP Address', 'IP']))) {
                switchRows = sheet.rows.map(mapSwitchFiberRow);
            }
        }
    }

    /** @type {Map<string, object>} */
    const hubsByCode = new Map();
    /** @type {Set<string>} */
    const officialHubCodes = new Set();
    /** @type {Set<string>} */
    const inferredHubCodes = new Set();

    if (input.hubListFile?.text) {
        const hubRows = parseCsvText(input.hubListFile.text);
        for (const row of hubRows) {
            rawRecords.push({ id: uid(), batchId, source: 'HubList', payload: row });
        }
        for (const mapped of mapHubListRows(hubRows)) {
            officialHubCodes.add(mapped.hubCode);
            hubsByCode.set(mapped.hubCode, {
                id: uid(),
                hubCode: mapped.hubCode,
                name: mapped.name,
                aka: mapped.aka,
                hubIp: mapped.hubIp,
                channelsSubnet: mapped.channelsSubnet,
                lat: mapped.lat,
                lon: mapped.lon,
                regionId: mapped.regionId,
                isShed: mapped.isShed,
                fromOfficialList: true
            });
        }
    }

    /** @type {object[]} */
    const connectedBuildings = [];
    if (input.connectedBuildingsFile?.text) {
        const buildingRows = parseCsvText(input.connectedBuildingsFile.text);
        for (const row of buildingRows) {
            rawRecords.push({ id: uid(), batchId, source: 'ConnectedBuildings', payload: row });
        }
        for (const mapped of mapConnectedBuildingRows(buildingRows)) {
            connectedBuildings.push({
                id: uid(),
                ...mapped
            });
        }
    }

    let atmsMapped = [];
    if (input.atmsFile?.text) {
        const rows = parseCsvText(input.atmsFile.text);
        for (const row of rows) {
            rawRecords.push({ id: uid(), batchId, source: 'ATMS', payload: row });
        }
        atmsMapped = rows.map((r) => mapAtmsSwitchRow(r, officialHubCodes));
    }

    const { joined, unmatchedSwitch } = joinWorkbookTabs(tmdRows, switchRows);
    const atmsMatches = matchAtmsToWorkbook(atmsMapped, switchRows, tmdRows);

    const ensureHub = (code) => {
        if (!code) return null;
        if (!hubsByCode.has(code)) {
            inferredHubCodes.add(code);
            hubsByCode.set(code, {
                id: uid(),
                hubCode: code,
                name: `Hub ${code}`,
                aka: null,
                hubIp: null,
                channelsSubnet: null,
                lat: null,
                lon: null,
                regionId: null,
                isShed: false,
                fromOfficialList: false
            });
        }
        return hubsByCode.get(code).id;
    };

    for (const m of atmsMatches) {
        ensureHub(m.atms.priHub);
        ensureHub(m.atms.secHub);
    }

    /** @type {Map<string, object>} */
    const channelsByNum = new Map();
    /** @type {object[]} */
    const sites = [];
    /** @type {object[]} */
    const drops = [];
    /** @type {object[]} */
    const devices = [];

    for (const row of joined) {
        const channelNumber = row.tmd?.channel || '';
        let channel = channelNumber ? channelsByNum.get(channelNumber) : null;
        if (channelNumber && !channel) {
            channel = {
                id: uid(),
                channelNumber,
                primaryHubId: null,
                secondaryHubId: null,
                primaryHubCode: null,
                secondaryHubCode: null
            };
            channelsByNum.set(channelNumber, channel);
        }

        const site = {
            id: uid(),
            inventoryName: row.tmd?.inventoryName || row.switchFiber?.inventoryName || '',
            siteId: row.tmd?.siteId || null,
            lat: row.tmd?.lat ?? row.switchFiber?.lat ?? null,
            lon: row.tmd?.lon ?? row.switchFiber?.lon ?? null
        };
        sites.push(site);

        const atmsForIp = atmsMatches.find((m) => m.atms.ip && m.atms.ip === row.switchFiber?.ip);
        if (channel && atmsForIp) {
            channel.primaryHubCode = atmsForIp.atms.priHub || channel.primaryHubCode;
            channel.secondaryHubCode = atmsForIp.atms.secHub || channel.secondaryHubCode;
            channel.primaryHubId = ensureHub(channel.primaryHubCode);
            channel.secondaryHubId = ensureHub(channel.secondaryHubCode);
        }

        const drop = {
            id: uid(),
            channelId: channel?.id || null,
            channelNumber: channelNumber || null,
            dropNumber: row.tmd?.drop ?? null,
            siteId: site.id,
            inventoryName: site.inventoryName,
            lat: site.lat,
            lon: site.lon,
            ip: row.switchFiber?.ip || null,
            model: row.switchFiber?.model || null,
            manufacturer: row.switchFiber?.manufacturer || null,
            wireless: false
        };
        drops.push(drop);

        if (row.switchFiber?.ip || row.switchFiber) {
            const device = {
                id: uid(),
                dropId: drop.id,
                ip: row.switchFiber?.ip || null,
                deviceType: null,
                manufacturer: row.switchFiber?.manufacturer || null,
                model: row.switchFiber?.model || null,
                status: row.switchFiber?.status || null,
                inventoryName: row.switchFiber?.inventoryName || site.inventoryName,
                gateway: null,
                subnet: null,
                subnetMask: row.switchFiber?.subnetMask || null,
                priHub: channel?.primaryHubCode || null,
                secHub: channel?.secondaryHubCode || null,
                source: 'SwitchFiber',
                lat: site.lat,
                lon: site.lon
            };
            devices.push(device);
            drop.deviceId = device.id;
            drop.wireless = inferWireless({
                model: device.model,
                manufacturer: device.manufacturer,
                inventoryName: device.inventoryName
            });
        }
    }

    for (const sw of unmatchedSwitch) {
        const device = {
            id: uid(),
            dropId: null,
            ip: sw.ip,
            manufacturer: sw.manufacturer,
            model: sw.model,
            status: sw.status,
            inventoryName: sw.inventoryName,
            subnetMask: sw.subnetMask,
            source: 'SwitchFiber',
            lat: sw.lat,
            lon: sw.lon
        };
        devices.push(device);
    }

    for (const m of atmsMatches) {
        if (m.matchConfidence === 'unmatched' || m.provisional) {
            const existing = devices.find((d) => d.ip && d.ip === m.atms.ip);
            if (existing) {
                existing.gateway = m.atms.gateway || existing.gateway;
                existing.subnet = m.atms.subnet || existing.subnet;
                existing.deviceType = m.atms.deviceType || existing.deviceType;
                existing.priHub = m.atms.priHub || existing.priHub;
                existing.secHub = m.atms.secHub || existing.secHub;
                continue;
            }
            devices.push({
                id: uid(),
                dropId: null,
                ip: m.atms.ip,
                deviceType: m.atms.deviceType,
                gateway: m.atms.gateway,
                subnet: m.atms.subnet,
                subnetMask: null,
                priHub: m.atms.priHub,
                secHub: m.atms.secHub,
                source: 'ATMS',
                provisional: true,
                lat: null,
                lon: null,
                inventoryName: null,
                manufacturer: null,
                model: null,
                status: null
            });
        } else if (m.atms.ip) {
            const existing = devices.find((d) => d.ip === m.atms.ip);
            if (existing) {
                existing.gateway = m.atms.gateway || existing.gateway;
                existing.subnet = m.atms.subnet || existing.subnet;
                existing.deviceType = m.atms.deviceType || existing.deviceType;
                existing.priHub = m.atms.priHub || existing.priHub;
                existing.secHub = m.atms.secHub || existing.secHub;
            }
        }
    }

    // Propagate wireless from ATMS device type / model onto matched drops
    for (const drop of drops) {
        const device = devices.find((d) => d.id === drop.deviceId || (drop.ip && d.ip === drop.ip));
        const atms = atmsMatches.find((m) => m.atms.ip && m.atms.ip === drop.ip)?.atms;
        if (inferWireless(atms) || inferWireless(device)) {
            drop.wireless = true;
        }
    }

    const hubs = [...hubsByCode.values()];
    const channels = [...channelsByNum.values()];
    const findings = buildImportFindings({
        joined,
        atmsMatches,
        devices,
        drops,
        sites,
        channels,
        hubs,
        officialHubCodes,
        inferredHubCodes
    });

    const summary = {
        batchId,
        batchDate,
        importedAt,
        workbookName: input.workbookFile?.name || null,
        atmsName: input.atmsFile?.name || null,
        hubListName: input.hubListFile?.name || null,
        connectedBuildingsName: input.connectedBuildingsFile?.name || null,
        counts: {
            tmd: tmdRows.length,
            switchFiber: switchRows.length,
            atmsSwitches: atmsMapped.filter((r) => r.isSwitch).length,
            hubs: hubs.length,
            hubsOfficial: officialHubCodes.size,
            hubsInferred: inferredHubCodes.size,
            channels: channels.length,
            sites: sites.length,
            drops: drops.length,
            devices: devices.length,
            connectedBuildings: connectedBuildings.length,
            findings: findings.length,
            rawRecords: rawRecords.length
        },
        fileKind: {
            workbook: input.workbookFile ? detectSourceFileKind(input.workbookFile.name) : null,
            atms: input.atmsFile ? detectSourceFileKind(input.atmsFile.name) : null,
            hubList: input.hubListFile ? detectSourceFileKind(input.hubListFile.name) : null,
            connectedBuildings: input.connectedBuildingsFile
                ? detectSourceFileKind(input.connectedBuildingsFile.name)
                : null
        }
    };

    return {
        batch: {
            id: batchId,
            batchDate,
            importedAt,
            workbookName: summary.workbookName,
            atmsName: summary.atmsName,
            hubListName: summary.hubListName,
            connectedBuildingsName: summary.connectedBuildingsName
        },
        rawRecords,
        hubs,
        channels,
        sites,
        drops,
        devices,
        connectedBuildings,
        findings,
        summary
    };
}
