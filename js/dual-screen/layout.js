/**
 * Dual Screen Mode — primary layout helpers
 */
import { refreshWidgetPanelDockReserve } from '../ui/widget-modal-placement.js';

/** @returns {string} innerHTML for center-panel placeholder */
export function buildDualScreenPlaceholderMarkup() {
    return [
        '<p>Map is open in <strong>Dual Screen</strong> window.</p>',
        '<p class="text-sm text-muted">Close the map window, or return the map to this panel:</p>',
        '<button type="button" class="btn btn-primary btn-sm" id="btn-return-map-primary">Return map to this window</button>'
    ].join('');
}

/**
 * @param {boolean} active
 * @param {Document} [doc]
 */
export function applyDualScreenDocumentLayout(active, doc = document) {
    doc.querySelector('.app-layout')?.classList.toggle('dual-screen-active', active);
    doc.body?.classList.toggle('dual-screen-active', active);
    doc.getElementById('basemap-toggle')?.classList.toggle('hidden', active);
    doc.getElementById('dimension-toggle')?.classList.toggle('hidden', active);

    const container = doc.getElementById('map-container');
    if (!container) return;

    let placeholder = container.querySelector('.dual-screen-placeholder');
    if (active) {
        container.classList.add('dual-screen-map-hidden');
        if (!placeholder) {
            placeholder = doc.createElement('div');
            placeholder.className = 'dual-screen-placeholder';
            placeholder.innerHTML = buildDualScreenPlaceholderMarkup();
            container.appendChild(placeholder);
        }
    } else {
        container.classList.remove('dual-screen-map-hidden');
        placeholder?.remove();
    }
}

/**
 * @param {HTMLButtonElement | null} btn
 * @param {boolean} active
 */
/**
 * Re-measure the map after flex layout changes (panel widths, dual-screen toggle).
 * @param {{ resize?: () => void, getMap?: () => any }} mapApi
 */
export function scheduleMapResizeAfterLayout(mapApi) {
    if (!mapApi || typeof mapApi.resize !== 'function') return;

    const run = () => mapApi.resize();
    const map = typeof mapApi.getMap === 'function' ? mapApi.getMap() : null;
    if (map && typeof map.loaded === 'function' && typeof map.once === 'function' && !map.loaded()) {
        map.once('load', run);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            run();
            setTimeout(run, 100);
            setTimeout(run, 250);
        });
    });
}

export function syncDualScreenHeaderButton(btn, active) {
    if (!btn) return;
    btn.classList.toggle('active', active);
    btn.title = active
        ? 'Exit Dual Screen Mode'
        : 'Open map in a second window (Dual Screen)';
    const label = btn.querySelector('.btn-label') || btn.querySelector('span:last-child');
    if (label) {
        label.textContent = active ? 'Exit Dual Screen' : 'Dual Screen';
    }
}

/**
 * Reset primary-window chrome when dual-screen toggles (layout, header, panel widths).
 * @param {boolean} active
 * @param {Document} [doc]
 */
export function syncDualScreenPrimaryUi(active, doc = document) {
    applyDualScreenDocumentLayout(active, doc);
    syncDualScreenHeaderButton(doc.getElementById('btn-dual-screen'), active);
    doc.querySelectorAll('[data-dual-screen-toggle]').forEach((el) => {
        el.classList.toggle('active', active);
        if (el.id === 'wf-dual-screen') {
            el.textContent = active ? '🖥️ Exit Dual Screen' : '🖥️ Dual Screen';
        }
    });
    if (!active) {
        refreshWidgetPanelDockReserve(doc);
    }
}
