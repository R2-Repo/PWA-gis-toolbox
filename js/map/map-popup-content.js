/** @typedef {'full' | 'minimal' | 'off'} PopupMode */

export const POPUP_MODES = /** @type {const} */ (['full', 'minimal', 'off']);

const TITLE_FIELD_KEYS = ['name', 'Name', 'NAME', 'title', 'Title', 'label', 'Label', 'id', 'ID'];

/**
 * @param {Record<string, unknown>} [properties]
 * @returns {string | null}
 */
export function resolveFeatureTitle(properties = {}) {
    for (const key of TITLE_FIELD_KEYS) {
        const value = properties[key];
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
    }

    for (const [key, value] of Object.entries(properties)) {
        if (key.startsWith('_')) continue;
        if (value == null || typeof value === 'object') continue;
        const text = String(value).trim();
        if (text) return text;
    }

    return null;
}

/**
 * @param {import('geojson').Feature} feature
 * @returns {string}
 */
export function buildFullPopupHtml(feature) {
    const props = feature.properties || {};
    let imgHtml = '';
    const imgSrc = props._thumbnailUrl || props._thumbnailDataUrl;
    if (imgSrc) {
        imgHtml = `<div style="margin-bottom:6px;text-align:center;">
                <img src="${imgSrc}" style="max-width:280px;max-height:200px;border-radius:4px;" />
            </div>`;
    }

    const rows = Object.entries(props)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => {
            if (v && typeof v === 'object' && v._att && v.dataUrl) {
                return `<tr><th>${k}</th><td style="padding:4px 0;">
                        <img src="${v.dataUrl}" style="max-width:240px;max-height:180px;border-radius:4px;display:block;margin-bottom:2px;" />
                        <span style="font-size:10px;color:#888;">${v.name || 'photo'}</span>
                    </td></tr>`;
            }
            let val = v;
            if (val == null) val = '';
            else if (typeof v === 'object') val = JSON.stringify(v);
            if (typeof val === 'string' && val.length > 100) val = val.slice(0, 100) + '…';
            return `<tr><th>${k}</th><td>${val}</td></tr>`;
        }).join('');
    const tableHtml = rows ? `<table>${rows}</table>` : '<em>No attributes</em>';
    return imgHtml + tableHtml;
}

/**
 * @param {import('geojson').Feature} feature
 * @returns {string}
 */
export function buildMinimalPopupHtml(feature) {
    const title = resolveFeatureTitle(feature.properties || {});
    if (title) {
        return `<div class="map-popup-minimal-title">${title}</div>`;
    }
    return '<div class="map-popup-minimal-title map-popup-minimal-empty"><em>No name</em></div>';
}

/**
 * @param {import('geojson').Feature} feature
 * @param {PopupMode} mode
 * @returns {string}
 */
export function buildPopupBodyHtml(feature, mode) {
    return mode === 'minimal' ? buildMinimalPopupHtml(feature) : buildFullPopupHtml(feature);
}
