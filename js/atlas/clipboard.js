/**
 * Clipboard helpers for Atlas IP lists.
 */

/**
 * @param {Array<string|null|undefined>|string|null|undefined} values
 * @returns {string[]}
 */
export function uniqueIps(values) {
    const list = Array.isArray(values) ? values : values != null ? [values] : [];
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    for (const raw of list) {
        const ip = String(raw || '').trim();
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        out.push(ip);
    }
    return out;
}

/**
 * @param {Array<string|null|undefined>|string|null|undefined} values
 * @param {{ separator?: string }} [opts]
 */
export function formatIpsForClipboard(values, opts = {}) {
    const sep = opts.separator == null ? '\n' : String(opts.separator);
    return uniqueIps(values).join(sep);
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text) {
    const s = String(text || '');
    if (!s) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(s);
            return true;
        }
    } catch {
        /* fall through */
    }
    try {
        if (typeof document === 'undefined') return false;
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch {
        return false;
    }
}

/**
 * @param {Array<string|null|undefined>|string|null|undefined} values
 * @param {{ separator?: string }} [opts]
 * @returns {Promise<{ ok: boolean, count: number, text: string }>}
 */
export async function copyIpsToClipboard(values, opts = {}) {
    const ips = uniqueIps(values);
    const text = formatIpsForClipboard(ips, opts);
    if (!ips.length) return { ok: false, count: 0, text: '' };
    const ok = await copyTextToClipboard(text);
    return { ok, count: ips.length, text };
}
