/**
 * Lightweight catalog unlock (look of security only — hash lives in the client).
 */
const SESSION_PREFIX = 'gis-live-unlock:';

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
export function catalogRequiresUnlock(entry) {
    return entry?.access?.kind === 'password' && typeof entry.access.hash === 'string'
        && entry.access.hash.length > 0;
}

/**
 * @param {string} catalogId
 * @returns {boolean}
 */
export function isCatalogUnlocked(catalogId) {
    if (!catalogId || typeof sessionStorage === 'undefined') return false;
    try {
        return sessionStorage.getItem(`${SESSION_PREFIX}${catalogId}`) === '1';
    } catch {
        return false;
    }
}

/**
 * @param {string} catalogId
 */
export function markCatalogUnlocked(catalogId) {
    if (!catalogId || typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.setItem(`${SESSION_PREFIX}${catalogId}`, '1');
    } catch { /* private mode */ }
}

/**
 * @param {string} text
 * @returns {Promise<string>} lowercase hex SHA-256
 */
export async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object} entry
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function verifyCatalogPassword(entry, password) {
    if (!catalogRequiresUnlock(entry)) return true;
    const hash = await sha256Hex(String(password ?? '').trim());
    return hash === String(entry.access.hash).trim().toLowerCase();
}

/**
 * Prompt for a password when the catalog entry is gated.
 * Remembers success for this browser tab only.
 * @param {object|null|undefined} entry
 * @returns {Promise<boolean>}
 */
export async function ensureCatalogAccess(entry) {
    if (!catalogRequiresUnlock(entry)) return true;
    if (isCatalogUnlocked(entry.id)) return true;

    const { showModal } = await import('../ui/modals.js');
    const ok = await showModal(
        'Restricted live layer',
        `<p class="text-sm mb-8">${escapeHtml(entry.name)} is limited to authorized users.</p>
        <form class="live-layer-password-form" autocomplete="off">
            <label class="text-xs text-muted" for="live-layer-password-input">Password</label>
            <input id="live-layer-password-input" name="password" type="password" autocomplete="off" />
            <p class="live-layer-password-error warning-box text-xs mt-8" hidden>Incorrect password.</p>
        </form>`,
        {
            width: '400px',
            footer: `<button type="button" class="btn btn-secondary live-layer-password-cancel">Cancel</button>
                     <button type="submit" form="unused" class="btn btn-primary live-layer-password-submit">Unlock</button>`,
            onMount: (overlay, close) => {
                const form = overlay.querySelector('.live-layer-password-form');
                const input = overlay.querySelector('#live-layer-password-input');
                const err = overlay.querySelector('.live-layer-password-error');
                const submit = overlay.querySelector('.live-layer-password-submit');
                const cancel = overlay.querySelector('.live-layer-password-cancel');
                input?.focus();

                const tryUnlock = async () => {
                    const passed = await verifyCatalogPassword(entry, input?.value || '');
                    if (!passed) {
                        if (err) err.hidden = false;
                        input?.select();
                        return;
                    }
                    markCatalogUnlocked(entry.id);
                    close(true);
                };

                form?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    void tryUnlock();
                });
                submit?.addEventListener('click', (e) => {
                    e.preventDefault();
                    void tryUnlock();
                });
                if (cancel) cancel.onclick = () => close(false);
                input?.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void tryUnlock();
                    }
                });
            }
        }
    );

    return ok === true;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export default {
    catalogRequiresUnlock,
    isCatalogUnlocked,
    markCatalogUnlocked,
    sha256Hex,
    verifyCatalogPassword,
    ensureCatalogAccess
};
