/**
 * Build reconciliation findings from staged import entities.
 */
import { normalizeInventoryName } from './normalize.js';

function uid() {
    return crypto.randomUUID();
}

/**
 * @param {object} opts
 * @param {Array} opts.joined
 * @param {Array} opts.atmsMatches
 * @param {Array} opts.devices
 * @param {Array} [opts.drops]
 * @param {Array} [opts.sites]
 * @param {Array} [opts.channels]
 * @param {Array} [opts.hubs]
 * @param {Set<string>|string[]} [opts.officialHubCodes]
 * @param {Set<string>|string[]} [opts.inferredHubCodes]
 * @returns {import('../types.js').AtlasFinding[]}
 */
export function buildImportFindings({
    joined = [],
    atmsMatches = [],
    devices = [],
    drops = [],
    sites = [],
    channels = [],
    hubs = [],
    officialHubCodes = new Set(),
    inferredHubCodes = new Set()
}) {
    /** @type {import('../types.js').AtlasFinding[]} */
    const findings = [];
    const now = new Date().toISOString();

    const dropByInv = new Map(
        drops
            .filter((d) => d.inventoryName)
            .map((d) => [normalizeInventoryName(d.inventoryName), d])
    );
    const siteByInv = new Map(
        sites
            .filter((s) => s.inventoryName)
            .map((s) => [normalizeInventoryName(s.inventoryName), s])
    );
    const dropByIp = new Map(drops.filter((d) => d.ip).map((d) => [d.ip, d]));
    const deviceByIp = new Map(devices.filter((d) => d.ip).map((d) => [d.ip, d]));
    const channelByNum = new Map(channels.map((c) => [String(c.channelNumber), c]));

    const add = (findingType, severity, description, extra = {}) => {
        findings.push({
            id: uid(),
            findingType,
            severity,
            description,
            suggestedAction: extra.suggestedAction || 'Review source records',
            status: 'Open',
            notes: '',
            createdAt: now,
            resolvedAt: null,
            sourceRecordIds: extra.sourceRecordIds || [],
            entityId: extra.entityId || null,
            entityKind: extra.entityKind || null,
            ip: extra.ip || null
        });
    };

    for (const row of joined) {
        const inv = row.tmd?.inventoryName || row.switchFiber?.inventoryName || '?';
        const invKey = normalizeInventoryName(inv);
        const drop = dropByInv.get(invKey);
        const site = siteByInv.get(invKey);
        const entityId = drop?.id || site?.id || null;
        const entityKind = drop ? 'drop' : site ? 'site' : null;

        if (!row.tmd?.siteId) {
            add('missing_site_id', 'warning', `Missing Site ID for ${inv}`, {
                suggestedAction: 'Confirm site identity in TMDITSSignalSite',
                entityId,
                entityKind
            });
        }
        if (!row.tmd?.channel) {
            add('missing_channel', 'warning', `Missing channel for ${inv}`, { entityId, entityKind });
        }
        if (row.tmd?.drop == null) {
            add('missing_drop', 'info', `Missing drop number for ${inv}`, {
                suggestedAction: 'Do not auto-create a drop; review source',
                entityId,
                entityKind
            });
        }
        if (row.coordDisagree) {
            add('coordinate_disagreement', 'warning', `Coordinate disagreement for ${inv}`, {
                entityId,
                entityKind
            });
        }
        if (!row.switchFiber) {
            add('missing_switchfiber', 'info', `TMD site without SwitchFiber match: ${inv}`, {
                entityId,
                entityKind
            });
        }
    }

    const ips = new Map();
    for (const d of devices) {
        if (!d.ip) continue;
        if (!ips.has(d.ip)) ips.set(d.ip, []);
        ips.get(d.ip).push(d);
    }
    for (const [ip, list] of ips) {
        if (list.length > 1) {
            const drop = dropByIp.get(ip);
            add('duplicate_ip', 'error', `Duplicate IP ${ip} (${list.length} devices)`, {
                suggestedAction: 'Resolve conflicting switch records',
                entityId: drop?.id || list[0].id,
                entityKind: drop ? 'drop' : 'device',
                ip
            });
        }
    }

    for (const m of atmsMatches) {
        const ip = m.atms.ip || null;
        const drop = ip ? dropByIp.get(ip) : null;
        const device = ip ? deviceByIp.get(ip) : null;
        const entityId = drop?.id || device?.id || null;
        const entityKind = drop ? 'drop' : device ? 'device' : null;

        if (m.matchConfidence === 'unmatched') {
            add('atms_unmatched', 'warning', `ATMS switch not in FiberSwitchLocation: ${ip || m.atms.deviceType}`, {
                suggestedAction: 'Create provisional network record',
                entityId,
                entityKind,
                ip
            });
        }
        if (m.atms.priHubConfidence === 'low' || m.atms.priHubConfidence === 'none') {
            if (m.atms.priHubRaw) {
                const ch = m.atms.channel ? channelByNum.get(String(m.atms.channel)) : null;
                add('damaged_hub_value', 'warning', `Uncertain primary hub "${m.atms.priHubRaw}" → ${m.atms.priHub || '(none)'}`, {
                    entityId: ch?.id || entityId,
                    entityKind: ch ? 'channel' : entityKind,
                    ip
                });
            }
        }
        if (!m.atms.secHub && m.atms.secHubRaw) {
            add('missing_secondary_hub', 'info', `Could not normalize secondary hub: ${m.atms.secHubRaw}`, {
                entityId,
                entityKind,
                ip
            });
        }
    }

    const workbookIps = new Set(devices.filter((d) => d.source !== 'ATMS').map((d) => d.ip).filter(Boolean));
    const atmsIps = new Set(atmsMatches.map((m) => m.atms.ip).filter(Boolean));
    for (const ip of workbookIps) {
        if (!atmsIps.has(ip) && atmsIps.size > 0) {
            const drop = dropByIp.get(ip);
            add('workbook_not_in_atms', 'info', `Switch IP in FiberSwitchLocation but not ATMS: ${ip}`, {
                entityId: drop?.id || deviceByIp.get(ip)?.id || null,
                entityKind: drop ? 'drop' : 'device',
                ip
            });
        }
    }

    const official = officialHubCodes instanceof Set
        ? officialHubCodes
        : new Set(officialHubCodes || []);
    const inferred = inferredHubCodes instanceof Set
        ? inferredHubCodes
        : new Set(inferredHubCodes || []);
    if (official.size > 0) {
        const hubByCode = new Map(hubs.map((h) => [h.hubCode, h]));
        for (const code of inferred) {
            if (official.has(code)) continue;
            const hub = hubByCode.get(code);
            add(
                'hub_not_in_official_list',
                'warning',
                `ATMS references hub ${code} which is not in the official Hub List`,
                {
                    suggestedAction: 'Add hub to Hub List CSV or correct ATMS Pri/Sec Hub',
                    entityId: hub?.id || null,
                    entityKind: hub ? 'hub' : null
                }
            );
        }
    }

    return findings;
}
