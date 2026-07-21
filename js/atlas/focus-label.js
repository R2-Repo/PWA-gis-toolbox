/**
 * Human-readable Atlas map focus (selection or area).
 */

/**
 * @param {import('./types.js').AtlasSnapshot|null|undefined} snap
 * @returns {{
 *   kind: string|null,
 *   title: string,
 *   detail: string,
 *   canClear: boolean
 * }}
 */
export function describeAtlasFocus(snap) {
    if (!snap?.loaded) {
        return {
            kind: null,
            title: 'Network Atlas',
            detail: 'Load or import data to begin',
            canClear: false
        };
    }

    const sel = snap.selection;
    const area = snap.areaResults;

    // Entity selection wins over area for focus label
    if (sel && sel.kind && sel.kind !== 'area') {
        if (sel.kind === 'hub') {
            const hub = (snap.hubs || []).find((h) => h.id === sel.id);
            return {
                kind: 'hub',
                title: hub?.aka || hub?.name || (hub?.hubCode ? `Hub ${hub.hubCode}` : 'Hub'),
                detail: hub?.hubCode ? `Hub ${hub.hubCode}` : 'Selected hub',
                canClear: true
            };
        }
        if (sel.kind === 'channel') {
            const ch = (snap.channels || []).find((c) => c.id === sel.id);
            const drops = (snap.drops || []).filter((d) => d.channelId === sel.id);
            return {
                kind: 'channel',
                title: ch ? `Channel ${ch.channelNumber}` : 'Channel',
                detail: `${drops.length} drop${drops.length === 1 ? '' : 's'}`,
                canClear: true
            };
        }
        if (sel.kind === 'drop') {
            const drop = (snap.drops || []).find((d) => d.id === sel.id);
            return {
                kind: 'drop',
                title: drop?.inventoryName || (drop ? `Drop ${drop.dropNumber ?? '?'}` : 'Drop'),
                detail: [
                    drop?.channelNumber != null ? `Ch ${drop.channelNumber}` : null,
                    drop?.dropNumber != null ? `D${drop.dropNumber}` : null,
                    drop?.ip || null
                ].filter(Boolean).join(' · ') || 'Selected drop',
                canClear: true
            };
        }
        if (sel.kind === 'device') {
            const device = (snap.devices || []).find((d) => d.id === sel.id);
            return {
                kind: 'device',
                title: device?.inventoryName || device?.ip || 'Device',
                detail: [device?.model, device?.ip].filter(Boolean).join(' · ') || 'Selected device',
                canClear: true
            };
        }
        if (sel.kind === 'site') {
            const site = (snap.sites || []).find((s) => s.id === sel.id);
            const drops = (snap.drops || []).filter((d) => d.siteId === sel.id);
            return {
                kind: 'site',
                title: site?.inventoryName || site?.siteId || 'Site',
                detail: site?.siteId
                    ? `${site.siteId} · ${drops.length} drop${drops.length === 1 ? '' : 's'}`
                    : `${drops.length} drop${drops.length === 1 ? '' : 's'}`,
                canClear: true
            };
        }
    }

    if (area) {
        const drops = area.drops?.length || 0;
        const channels = area.channels?.length || 0;
        const hubs = area.hubs?.length || 0;
        return {
            kind: 'area',
            title: 'Area query',
            detail: `${drops} drop${drops === 1 ? '' : 's'} · ${channels} channel${channels === 1 ? '' : 's'} · ${hubs} hub${hubs === 1 ? '' : 's'}`,
            canClear: true
        };
    }

    return {
        kind: null,
        title: 'Network',
        detail: 'No selection — click a hub/drop or draw an area',
        canClear: false
    };
}

/** Ping legend entries matching map-layers colors. */
export const ATLAS_PING_LEGEND = [
    { key: 'reachable', label: 'Reachable', color: '#39ff14' },
    { key: 'unreachable', label: 'Unreachable', color: '#ff2d2d' },
    { key: 'stale_reachable', label: 'Stale up', color: '#4d7c4d' },
    { key: 'stale_unreachable', label: 'Stale down', color: '#7a3a3a' },
    { key: 'intermittent', label: 'Intermittent', color: '#facc15' },
    { key: 'no_ip', label: 'No IP / no channel halo', color: '#0a0a0a' },
    { key: 'mixed', label: 'Hub mixed', color: '#a78bfa' },
    { key: 'pending', label: 'Pending', color: '#ca8a04' },
    { key: 'untested', label: 'Untested', color: '#94a3b8' }
];

export const ATLAS_MAP_LEGEND_EXTRA = [
    { key: 'drop_core', label: 'Drop (has channel)', color: '#2563eb' },
    { key: 'drop_no_ip', label: 'Drop (no IP, blue)', color: '#2563eb' },
    { key: 'drop_no_channel', label: 'Drop (no channel, gray)', color: '#cbd5e1' },
    { key: 'selected', label: 'Selected', color: '#ff2bd6', ring: true },
    { key: 'hub', label: 'Hub (square)', color: '#94a3b8' },
    { key: 'hub_issue', label: 'Hub issue', color: '#ff2d2d' },
    { key: 'channel', label: 'Channel path', color: '#2563eb', line: true }
];
