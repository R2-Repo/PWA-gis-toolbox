/**
 * Build reconciliation findings from staged import entities.
 */

function uid() {
    return crypto.randomUUID();
}

/**
 * @param {object} opts
 * @param {Array} opts.joined
 * @param {Array} opts.atmsMatches
 * @param {Array} opts.devices
 * @returns {import('../types.js').AtlasFinding[]}
 */
export function buildImportFindings({ joined = [], atmsMatches = [], devices = [] }) {
    /** @type {import('../types.js').AtlasFinding[]} */
    const findings = [];
    const now = new Date().toISOString();

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
            entityId: extra.entityId || null
        });
    };

    for (const row of joined) {
        const inv = row.tmd?.inventoryName || row.switchFiber?.inventoryName || '?';
        if (!row.tmd?.siteId) {
            add('missing_site_id', 'warning', `Missing Site ID for ${inv}`, {
                suggestedAction: 'Confirm site identity in TMDITSSignalSite'
            });
        }
        if (!row.tmd?.channel) {
            add('missing_channel', 'warning', `Missing channel for ${inv}`);
        }
        if (row.tmd?.drop == null) {
            add('missing_drop', 'info', `Missing drop number for ${inv}`, {
                suggestedAction: 'Do not auto-create a drop; review source'
            });
        }
        if (row.coordDisagree) {
            add('coordinate_disagreement', 'warning', `Coordinate disagreement for ${inv}`);
        }
        if (!row.switchFiber) {
            add('missing_switchfiber', 'info', `TMD site without SwitchFiber match: ${inv}`);
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
            add('duplicate_ip', 'error', `Duplicate IP ${ip} (${list.length} devices)`, {
                suggestedAction: 'Resolve conflicting switch records'
            });
        }
    }

    for (const m of atmsMatches) {
        if (m.matchConfidence === 'unmatched') {
            add('atms_unmatched', 'warning', `ATMS switch not in FiberSwitchLocation: ${m.atms.ip || m.atms.deviceType}`, {
                suggestedAction: 'Create provisional network record'
            });
        }
        if (m.atms.priHubConfidence === 'low' || m.atms.priHubConfidence === 'none') {
            if (m.atms.priHubRaw) {
                add('damaged_hub_value', 'warning', `Uncertain primary hub "${m.atms.priHubRaw}" → ${m.atms.priHub || '(none)'}`);
            }
        }
        if (!m.atms.secHub && m.atms.secHubRaw) {
            add('missing_secondary_hub', 'info', `Could not normalize secondary hub: ${m.atms.secHubRaw}`);
        }
    }

    const workbookIps = new Set(devices.filter((d) => d.source !== 'ATMS').map((d) => d.ip).filter(Boolean));
    const atmsIps = new Set(atmsMatches.map((m) => m.atms.ip).filter(Boolean));
    for (const ip of atmsIps) {
        if (!workbookIps.has(ip)) {
            // already covered by unmatched for many; keep one class for reporting
        }
    }
    for (const ip of workbookIps) {
        if (!atmsIps.has(ip) && atmsIps.size > 0) {
            add('workbook_not_in_atms', 'info', `Switch IP in FiberSwitchLocation but not ATMS: ${ip}`);
        }
    }

    return findings;
}
