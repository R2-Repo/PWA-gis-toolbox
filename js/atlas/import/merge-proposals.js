/**
 * Golden-record merge proposals (V2): fuzzy / geo matchers beyond strict joinWorkbookTabs.
 */
import { normalizeInventoryName } from './normalize.js';

/** @typedef {'high'|'medium'|'low'} MergeConfidence */

/**
 * Levenshtein distance (small strings only).
 * @param {string} a
 * @param {string} b
 */
function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = i;
        for (let j = 1; j <= b.length; j++) {
            const cur = a[i - 1] === b[j - 1]
                ? row[j - 1]
                : Math.min(row[j - 1], row[j], prev) + 1;
            row[j - 1] = prev;
            prev = cur;
        }
        row[b.length] = prev;
    }
    return row[b.length];
}

/**
 * @param {string} a
 * @param {string} b
 */
function namesNearDuplicate(a, b) {
    const na = normalizeInventoryName(a);
    const nb = normalizeInventoryName(b);
    if (!na || !nb || na === nb) return na === nb && !!na;
    if (na.includes(nb) || nb.includes(na)) return true;
    const maxLen = Math.max(na.length, nb.length);
    if (maxLen < 4) return false;
    return editDistance(na, nb) <= Math.max(2, Math.floor(maxLen * 0.12));
}

/**
 * Haversine distance in meters (approx).
 */
function geoDistanceM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

const GEO_RADIUS_M = 150;

/**
 * @param {object} tmd
 * @param {object} sw
 */
function proposalId(tmd, sw) {
    return `tmd-sw:${tmd.inventoryKey || tmd.inventoryName}:${sw.inventoryKey || sw.inventoryName}`;
}

/**
 * @param {object} tmd
 * @param {object[]} atmsMatches
 * @param {object[]} orphans
 */
function channelDropSwitchCandidate(tmd, atmsMatches, orphans) {
    if (!tmd?.channel || tmd.drop == null) return null;
    const key = `${tmd.channel}|${tmd.drop}`;
    const atmsOnCd = atmsMatches.filter(
        (m) => m.provisional
            && m.atms?.channel === tmd.channel
            && m.atms?.drop === tmd.drop
            && m.atms?.ip
    );
    if (atmsOnCd.length !== 1) return null;
    const ip = atmsOnCd[0].atms.ip;
    const matches = orphans.filter((sw) => sw.ip === ip);
    return matches.length === 1 ? { sw: matches[0], atms: atmsOnCd[0] } : null;
}

/**
 * Build merge proposals for site-only TMD rows and unmatched SwitchFiber rows.
 * @param {{
 *   joined: { tmd: object, switchFiber: object|null, matchConfidence: string }[],
 *   unmatchedSwitch: object[],
 *   atmsMatches: { atms: object, switchFiber?: object|null, matchConfidence: string }[]
 * }} input
 */
export function buildMergeProposals(input) {
    const { joined, unmatchedSwitch, atmsMatches } = input;
    /** @type {object[]} */
    const proposals = [];
    const usedSwitchKeys = new Set();

    const siteOnly = joined.filter((j) => !j.switchFiber && j.tmd?.inventoryKey);
    const orphans = [...unmatchedSwitch].filter((sw) => sw.inventoryKey);

    for (const row of siteOnly) {
        const tmd = row.tmd;
        /** @type {{ sw: object, confidence: MergeConfidence, reason: string }[]} */
        const candidates = [];

        const cdMatch = channelDropSwitchCandidate(tmd, atmsMatches, orphans);
        if (cdMatch && !usedSwitchKeys.has(cdMatch.sw.inventoryKey)) {
            candidates.push({
                sw: cdMatch.sw,
                confidence: 'high',
                reason: 'channel_drop_atms_ip'
            });
        }

        for (const sw of orphans) {
            if (usedSwitchKeys.has(sw.inventoryKey)) continue;
            if (candidates.some((c) => c.sw.inventoryKey === sw.inventoryKey)) continue;
            if (tmd.inventoryKey === sw.inventoryKey) {
                candidates.push({ sw, confidence: 'high', reason: 'exact_inventory_key' });
                continue;
            }
            if (namesNearDuplicate(tmd.inventoryName, sw.inventoryName)) {
                candidates.push({ sw, confidence: 'medium', reason: 'near_duplicate_name' });
                continue;
            }
            if (
                tmd.lat != null && tmd.lon != null && sw.lat != null && sw.lon != null
                && geoDistanceM(tmd.lat, tmd.lon, sw.lat, sw.lon) <= GEO_RADIUS_M
            ) {
                candidates.push({ sw, confidence: 'low', reason: 'geo_proximity' });
            }
        }

        if (candidates.length === 1) {
            const { sw, confidence, reason } = candidates[0];
            usedSwitchKeys.add(sw.inventoryKey);
            proposals.push({
                id: proposalId(tmd, sw),
                kind: 'tmd_switchfiber',
                confidence,
                reason,
                suggestedAction: confidence === 'high'
                    ? 'Accept to link site with switch IP and device fields'
                    : 'Review — names or location may differ',
                left: {
                    label: tmd.inventoryName,
                    channel: tmd.channel,
                    drop: tmd.drop,
                    lat: tmd.lat,
                    lon: tmd.lon
                },
                right: {
                    label: sw.inventoryName,
                    ip: sw.ip,
                    lat: sw.lat,
                    lon: sw.lon
                },
                tmdInventoryKey: tmd.inventoryKey,
                switchInventoryKey: sw.inventoryKey
            });
        } else if (candidates.length > 1) {
            proposals.push({
                id: `ambiguous:${tmd.inventoryKey}`,
                kind: 'ambiguous',
                confidence: 'low',
                reason: 'multiple_candidates',
                suggestedAction: 'Pick one candidate manually or reject',
                left: { label: tmd.inventoryName, channel: tmd.channel, drop: tmd.drop },
                right: null,
                candidates: candidates.map((c) => ({
                    switchInventoryKey: c.sw.inventoryKey,
                    label: c.sw.inventoryName,
                    ip: c.sw.ip,
                    confidence: c.confidence,
                    reason: c.reason
                })),
                tmdInventoryKey: tmd.inventoryKey
            });
        }
    }

    const provisionalAtms = atmsMatches.filter(
        (m) => m.provisional && m.atms?.ip && !m.switchFiber
    );
    for (const m of provisionalAtms) {
        const near = orphans.filter(
            (sw) => !usedSwitchKeys.has(sw.inventoryKey) && m.atms.ip === sw.ip
        );
        if (near.length === 1) {
            const sw = near[0];
            usedSwitchKeys.add(sw.inventoryKey);
            proposals.push({
                id: `atms-sw:${m.atms.ip}`,
                kind: 'atms_switchfiber',
                confidence: 'high',
                reason: 'exact_ip_orphan_switch',
                suggestedAction: 'Accept to attach orphan switch to ATMS row',
                left: { label: m.atms.deviceType, ip: m.atms.ip, channel: m.atms.channel, drop: m.atms.drop },
                right: { label: sw.inventoryName, ip: sw.ip },
                atmsIp: m.atms.ip,
                switchInventoryKey: sw.inventoryKey
            });
        }
    }

    return proposals;
}

/**
 * Fill missing coords and propagate ATMS linkage after a merge.
 * @param {{ tmd?: object, switchFiber?: object|null }} joinedRow
 * @param {object[]} atmsMatches
 */
export function blankFillMergedRow(joinedRow, atmsMatches) {
    const { tmd, switchFiber: sw } = joinedRow;
    if (!sw) return;

    if (tmd) {
        if (tmd.lat == null && sw.lat != null) {
            tmd.lat = sw.lat;
            tmd.lon = sw.lon;
        }
        if (sw.lat == null && tmd.lat != null) {
            sw.lat = tmd.lat;
            sw.lon = tmd.lon;
        }
    }

    const byIp = sw.ip
        ? atmsMatches.find((m) => m.atms?.ip === sw.ip)
        : null;
    if (byIp) {
        byIp.switchFiber = sw;
        byIp.provisional = false;
        byIp.matchConfidence = byIp.matchConfidence === 'channel-drop' ? 'merged' : 'exact-ip';
    }

    if (tmd?.channel && tmd.drop != null) {
        const byCd = atmsMatches.find(
            (m) => m.atms?.channel === tmd.channel && m.atms?.drop === tmd.drop
        );
        if (byCd) {
            byCd.switchFiber = sw;
            byCd.provisional = false;
            byCd.matchConfidence = 'merged';
            if (byCd.tmd && tmd.lat != null && byCd.tmd.lat == null) {
                byCd.tmd.lat = tmd.lat;
                byCd.tmd.lon = tmd.lon;
            }
        }
    }
}

/**
 * Link TMD joined row to switch and remove from orphan list.
 * @param {object[]} joined
 * @param {object[]} unmatchedSwitch
 * @param {string} tmdInventoryKey
 * @param {string} switchInventoryKey
 * @param {MergeConfidence|string} confidence
 * @param {object[]} atmsMatches
 */
function linkTmdToSwitch(joined, unmatchedSwitch, tmdInventoryKey, switchInventoryKey, confidence, atmsMatches) {
    const j = joined.find((r) => r.tmd?.inventoryKey === tmdInventoryKey && !r.switchFiber);
    const sw = unmatchedSwitch.find((s) => s.inventoryKey === switchInventoryKey);
    if (!j || !sw) return false;

    j.switchFiber = sw;
    j.matchConfidence = confidence === 'high' ? 'high' : 'merged';
    j.coordDisagree = j.tmd.lat != null && sw.lat != null
        && (Math.abs(j.tmd.lat - sw.lat) > 0.0005
            || Math.abs((j.tmd.lon ?? 0) - (sw.lon ?? 0)) > 0.0005);
    blankFillMergedRow(j, atmsMatches);

    const idx = unmatchedSwitch.indexOf(sw);
    if (idx >= 0) unmatchedSwitch.splice(idx, 1);
    return true;
}

/**
 * Apply accepted merge decisions onto joined rows (blank-fill path uses rebuilt entities).
 * @param {{
 *   joined: object[],
 *   unmatchedSwitch: object[],
 *   decisions: Record<string, 'accept'|'reject'>,
 *   proposals: object[],
 *   candidatePicks?: Record<string, string>,
 *   atmsMatches?: object[]
 * }} input
 */
export function applyAcceptedMerges(input) {
    const {
        joined,
        unmatchedSwitch,
        decisions,
        proposals,
        candidatePicks = {},
        atmsMatches = []
    } = input;

    for (const prop of proposals) {
        if (decisions[prop.id] !== 'accept') continue;

        if (prop.kind === 'tmd_switchfiber') {
            linkTmdToSwitch(
                joined,
                unmatchedSwitch,
                prop.tmdInventoryKey,
                prop.switchInventoryKey,
                prop.confidence,
                atmsMatches
            );
            continue;
        }

        if (prop.kind === 'ambiguous') {
            const pick = candidatePicks[prop.id];
            if (!pick) continue;
            linkTmdToSwitch(
                joined,
                unmatchedSwitch,
                prop.tmdInventoryKey,
                pick,
                'medium',
                atmsMatches
            );
            continue;
        }

        if (prop.kind === 'atms_switchfiber') {
            const sw = unmatchedSwitch.find((s) => s.inventoryKey === prop.switchInventoryKey);
            const m = atmsMatches.find((row) => row.atms?.ip === prop.atmsIp);
            if (!sw || !m) continue;

            m.switchFiber = sw;
            m.provisional = false;
            m.matchConfidence = 'exact-ip';

            if (m.tmd) {
                const j = joined.find(
                    (r) => r.tmd?.inventoryKey === m.tmd.inventoryKey && !r.switchFiber
                );
                if (j) {
                    j.switchFiber = sw;
                    j.matchConfidence = 'high';
                    blankFillMergedRow(j, atmsMatches);
                }
            } else if (m.atms?.channel && m.atms.drop != null) {
                const j = joined.find(
                    (r) => !r.switchFiber
                        && r.tmd?.channel === m.atms.channel
                        && r.tmd?.drop === m.atms.drop
                );
                if (j) {
                    j.switchFiber = sw;
                    j.matchConfidence = 'high';
                    blankFillMergedRow(j, atmsMatches);
                }
            }

            const idx = unmatchedSwitch.indexOf(sw);
            if (idx >= 0) unmatchedSwitch.splice(idx, 1);
        }
    }

    return { joined, unmatchedSwitch };
}

/**
 * @param {object[]} proposals
 * @param {boolean} autoAcceptHigh
 */
export function defaultMergeDecisions(proposals, autoAcceptHigh = true) {
    /** @type {Record<string, 'accept'|'reject'>} */
    const out = {};
    for (const p of proposals) {
        if (p.kind === 'ambiguous') {
            out[p.id] = 'reject';
        } else if (autoAcceptHigh && p.confidence === 'high') {
            out[p.id] = 'accept';
        } else {
            out[p.id] = 'reject';
        }
    }
    return out;
}
