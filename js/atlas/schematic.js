/**
 * Channel schematic: Primary Hub → D1 → D2 → … → Secondary Hub
 */
import { getAtlasSnapshot } from './store.js';

/**
 * @param {string} channelId
 * @returns {{ channel: object, nodes: Array<object> } | null}
 */
export function buildChannelSchematic(channelId) {
    const snap = getAtlasSnapshot();
    const channel = snap.channels.find((c) => c.id === channelId);
    if (!channel) return null;

    const drops = snap.drops
        .filter((d) => d.channelId === channelId)
        .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));

    /** @type {Array<object>} */
    const nodes = [];

    nodes.push({
        kind: 'hub',
        role: 'primary',
        id: channel.primaryHubId || `pri-${channel.id}`,
        label: channel.primaryHubCode ? `Hub ${channel.primaryHubCode}` : 'Primary Hub',
        hubCode: channel.primaryHubCode,
        ip: null,
        ping: null
    });

    for (const drop of drops) {
        const ping = drop.ip ? snap.pingResults[drop.ip] : null;
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
            ping: ping || { status: 'untested' },
            warnings: []
        });
    }

    nodes.push({
        kind: 'hub',
        role: 'secondary',
        id: channel.secondaryHubId || `sec-${channel.id}`,
        label: channel.secondaryHubCode ? `Hub ${channel.secondaryHubCode}` : 'Secondary Hub',
        hubCode: channel.secondaryHubCode,
        ip: null,
        ping: null
    });

    return { channel, nodes };
}
