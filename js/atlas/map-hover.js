/**
 * Atlas map hover tooltip helpers (pure — no MapLibre import).
 */

/**
 * @param {unknown} value
 */
export function escapeAtlasHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {Record<string, unknown>|null|undefined} props
 * @returns {string}
 */
export function buildAtlasHoverHtml(props) {
    if (!props) return '';
    const kind = String(props.atlasKind || '');
    const label = escapeAtlasHtml(
        props.label || (kind === 'hub' ? 'Hub' : kind === 'building' ? 'Building' : 'Drop')
    );
    const ping = escapeAtlasHtml(props.pingStatus || 'untested');
    const lines = [`<strong>${label}</strong>`];

    if (kind === 'hub') {
        const code = props.hubCode ? escapeAtlasHtml(props.hubCode) : '';
        lines.push(code ? `Hub ${code}` : 'Hub');
        if (props.hubIp) lines.push(`<span class="atlas-mono">${escapeAtlasHtml(props.hubIp)}</span>`);
        lines.push(`Ping: ${ping}`);
    } else if (kind === 'building') {
        lines.push('Connected building');
        if (props.address) lines.push(escapeAtlasHtml(props.address));
        const hubs = [props.fromHub, props.toHub].filter(Boolean).map(escapeAtlasHtml).join(' → ');
        if (hubs) lines.push(hubs);
        if (props.status) lines.push(escapeAtlasHtml(props.status));
    } else {
        const ch = props.channelNumber != null && props.channelNumber !== ''
            ? `Ch ${escapeAtlasHtml(props.channelNumber)}`
            : '';
        const drop = props.dropNumber != null && props.dropNumber !== ''
            ? `D${escapeAtlasHtml(props.dropNumber)}`
            : '';
        const route = [ch, drop].filter(Boolean).join(' · ');
        if (route) lines.push(route);
        if (props.ip) lines.push(`<span class="atlas-mono">${escapeAtlasHtml(props.ip)}</span>`);
        lines.push(`Ping: ${ping}`);
    }

    return `<div class="atlas-map-tooltip">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
}
