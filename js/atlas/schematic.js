/**
 * Channel schematic: Primary Hub → D1 → D2 → … → Secondary Hub
 */
import { getAtlasSnapshot } from './store.js';

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

    /** @type {Array<object>} */
    const nodes = [];

    nodes.push({
        kind: 'hub',
        role: 'primary',
        id: channel.primaryHubId || `pri-${channel.id}`,
        label: channel.primaryHubCode ? `Hub ${channel.primaryHubCode}` : 'Primary Hub',
        hubCode: channel.primaryHubCode,
        ip: null,
        ping: null,
        warnings: []
    });

    for (const drop of drops) {
        const ping = drop.ip ? snap.pingResults[drop.ip] : null;
        const warnings = findingsByDrop.get(drop.id) || [];
        nodes.push({
            kind: 'drop',
            role: 'drop',
            id: drop.id,
            label: `D${drop.dropNumber ?? '?'}`,
            dropNumber: drop.dropNumber,
            inventoryName: drop.inventoryName,
            ip: drop.ip,
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
        label: channel.secondaryHubCode ? `Hub ${channel.secondaryHubCode}` : 'Secondary Hub',
        hubCode: channel.secondaryHubCode,
        ip: null,
        ping: null,
        warnings: []
    });

    return {
        channel,
        nodes,
        dropCount: drops.length,
        openFindings: openFindings.length
    };
}
