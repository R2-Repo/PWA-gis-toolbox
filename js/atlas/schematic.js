/**
 * Channel schematic: Primary Hub → D1 → D2 → … → Secondary Hub
 */
import { getAtlasSnapshot } from './store.js';
import { getPingEntry } from './ping-format.js';
import { hubPingRollup } from './triage.js';
import { formatDropPrimary, formatHubTreeLabel } from './display-label.js';

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {string|null|undefined} hubId
 * @param {string|null|undefined} hubCode
 */
function resolveHubPing(snap, hubId, hubCode) {
    let id = hubId;
    if (!id && hubCode) {
        id = (snap.hubs || []).find((h) => h.hubCode === hubCode)?.id;
    }
    if (!id) return { status: 'untested', at: null };
    return { status: hubPingRollup(id, snap), at: null };
}

/**
 * @param {string} channelId
 * @returns {{ channel: object, nodes: Array<object>, dropCount: number, openFindings: number } | null}
 */
export function buildChannelSchematic(channelId) {
    const snap = getAtlasSnapshot();
    const channel = snap.channels.find((c) => c.id === channelId);
    if (!channel) return null;

    const drops = snap.drops
        .filter((d) => d.channelId === channelId)
        .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));

    const dropIds = new Set(drops.map((d) => d.id));
    const dropIps = new Set(drops.map((d) => d.ip).filter(Boolean));
    const openFindings = (snap.findings || []).filter((f) =>
        f.status === 'Open'
        && (
            f.entityId === channelId
            || (f.entityId && dropIds.has(f.entityId))
            || (f.ip && dropIps.has(f.ip))
            || (f.entityKind === 'hub' && (
                f.entityId === channel.primaryHubId
                || f.entityId === channel.secondaryHubId
            ))
        ));

    /** @type {Map<string, object[]>} */
    const findingsByDrop = new Map();
    for (const f of openFindings) {
        let dropId = f.entityId && dropIds.has(f.entityId) ? f.entityId : null;
        if (!dropId && f.ip) {
            const hit = drops.find((d) => d.ip === f.ip);
            dropId = hit?.id || null;
        }
        if (!dropId) continue;
        if (!findingsByDrop.has(dropId)) findingsByDrop.set(dropId, []);
        findingsByDrop.get(dropId).push(f);
    }

    const dropLinkedIds = new Set();
    for (const list of findingsByDrop.values()) {
        for (const f of list) dropLinkedIds.add(f.id);
    }

    const channelLevel = openFindings.filter((f) => !dropLinkedIds.has(f.id));
    const secondaryHubWarnings = channelLevel.filter((f) =>
        f.entityId === channel.secondaryHubId
        || f.findingType === 'missing_secondary_hub');
    const secondaryIds = new Set(secondaryHubWarnings.map((f) => f.id));
    const primaryHubWarnings = channelLevel.filter((f) => !secondaryIds.has(f.id));

    /** @type {Array<object>} */
    const nodes = [];

    nodes.push({
        kind: 'hub',
        role: 'primary',
        id: channel.primaryHubId || `pri-${channel.id}`,
        label: channel.primaryHubCode ? formatHubTreeLabel(channel.primaryHubCode) : 'Primary Hub',
        hubCode: channel.primaryHubCode,
        ip: null,
        ping: resolveHubPing(snap, channel.primaryHubId, channel.primaryHubCode),
        warnings: primaryHubWarnings
    });

    for (const drop of drops) {
        const ping = drop.ip ? getPingEntry(snap.pingResults, drop.ip) : null;
        const warnings = findingsByDrop.get(drop.id) || [];
        nodes.push({
            kind: 'drop',
            role: 'drop',
            id: drop.id,
            label: formatDropPrimary(drop.dropNumber),
            dropNumber: drop.dropNumber,
            inventoryName: drop.inventoryName,
            ip: drop.ip,
            lat: drop.lat ?? null,
            lon: drop.lon ?? null,
            model: drop.model,
            manufacturer: drop.manufacturer,
            wireless: drop.wireless,
            ping: ping || { status: 'untested', at: null },
            warnings
        });
    }

    nodes.push({
        kind: 'hub',
        role: 'secondary',
        id: channel.secondaryHubId || `sec-${channel.id}`,
        label: channel.secondaryHubCode ? formatHubTreeLabel(channel.secondaryHubCode) : 'Secondary Hub',
        hubCode: channel.secondaryHubCode,
        ip: null,
        ping: resolveHubPing(snap, channel.secondaryHubId, channel.secondaryHubCode),
        warnings: secondaryHubWarnings
    });

    return {
        channel,
        nodes,
        dropCount: drops.length,
        openFindings: openFindings.length
    };
}
