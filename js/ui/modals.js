/**
 * Modal + Bottom Sheet helpers
 */

const _modalSubscribers = new Set();
const _modalResolvers = new Map();
const _progressCancelHandlers = new Map();
let _nextModalId = 1;
let _nextProgressId = 1;

function _emitModalEvent(event) {
    _modalSubscribers.forEach((listener) => {
        try {
            listener(event);
        } catch {
            // Keep modal delivery resilient if a subscriber errors.
        }
    });
}

export function subscribeModalEvents(listener) {
    if (typeof listener !== 'function') {
        throw new Error('subscribeModalEvents requires a listener function');
    }
    _modalSubscribers.add(listener);
    return () => _modalSubscribers.delete(listener);
}

export function dismissModal(id, result = null) {
    const resolve = _modalResolvers.get(id);
    if (resolve) {
        _modalResolvers.delete(id);
        resolve(result);
    }
    _emitModalEvent({ type: 'removeModal', id });
}

export function triggerProgressCancel(id) {
    const fn = _progressCancelHandlers.get(id);
    if (typeof fn === 'function') {
        fn();
    }
}

export function dismissProgressModal(id) {
    _progressCancelHandlers.delete(id);
    _emitModalEvent({ type: 'removeProgress', id });
}

export function showModal(title, contentHtml, options = {}) {
    const id = _nextModalId++;
    return new Promise((resolve) => {
        _modalResolvers.set(id, resolve);
        _emitModalEvent({
            type: 'showModal',
            modal: { id, title, contentHtml, options }
        });
    });
}

/**
 * Simple confirm dialog
 */
export function confirm(title, message, options = {}) {
    const { layer, ...rest } = options;
    return showModal(title, `<p>${message}</p>`, {
        ...rest,
        layer,
        footer: `<button class="btn btn-secondary cancel-btn">Cancel</button>
                 <button class="btn btn-primary confirm-btn">Confirm</button>`,
        onMount: (overlay, close) => {
            overlay.querySelector('.cancel-btn').onclick = () => close(false);
            overlay.querySelector('.confirm-btn').onclick = () => close(true);
        }
    });
}

/**
 * Large ArcGIS import: warning + Continue/Cancel, then progress bar in the same modal.
 * @param {number} featureCount
 * @param {string} progressTitle
 * @returns {Promise<{ proceed: boolean, update?: (percent: number, step?: string) => void, close?: () => void, onCancel?: (fn: () => void) => void }>}
 */
export function confirmArcgisLargeImport(featureCount, progressTitle) {
    const countLabel = Number(featureCount).toLocaleString();
    const contentHtml = `
        <div class="arcgis-import-confirm-body">
            <p class="text-xs text-muted" style="margin:0">Layer has ${countLabel} features.</p>
        </div>
        <div class="arcgis-import-progress-body" style="display:none;text-align:center;padding-top:8px">
            <div class="spinner" style="margin:0 auto 12px"></div>
            <div class="arcgis-import-progress-step progress-step" style="margin-bottom:12px;color:var(--text-muted)">Starting download...</div>
            <div class="progress-bar-container">
                <div class="arcgis-import-progress-fill progress-bar-fill" style="width:0%"></div>
                <div class="arcgis-import-progress-pct progress-bar-text">0%</div>
            </div>
        </div>`;
    const footer = `
        <button class="btn btn-secondary arcgis-import-cancel-btn">Cancel</button>
        <button class="btn btn-primary arcgis-import-continue-btn">Continue</button>
        <button class="btn btn-secondary arcgis-import-progress-cancel-btn" style="display:none">Cancel</button>`;

    return new Promise((resolve) => {
        let settled = false;
        let cancelHandler = null;

        const settle = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        showModal('Import ArcGIS layer', contentHtml, {
            footer,
            onMount: (overlay, close) => {
                const confirmBody = overlay.querySelector('.arcgis-import-confirm-body');
                const progressBody = overlay.querySelector('.arcgis-import-progress-body');
                const continueBtn = overlay.querySelector('.arcgis-import-continue-btn');
                const cancelBtn = overlay.querySelector('.arcgis-import-cancel-btn');
                const progressCancelBtn = overlay.querySelector('.arcgis-import-progress-cancel-btn');
                const stepEl = overlay.querySelector('.arcgis-import-progress-step');
                const fillEl = overlay.querySelector('.arcgis-import-progress-fill');
                const pctEl = overlay.querySelector('.arcgis-import-progress-pct');
                const header = overlay.querySelector('.modal-header span');

                const finish = (proceeded) => {
                    close(proceeded);
                };

                cancelBtn.onclick = () => {
                    settle({ proceed: false });
                    finish(false);
                };

                progressCancelBtn.onclick = () => {
                    cancelHandler?.();
                    finish(false);
                };

                continueBtn.onclick = () => {
                    confirmBody.style.display = 'none';
                    progressBody.style.display = 'block';
                    continueBtn.style.display = 'none';
                    cancelBtn.style.display = 'none';
                    progressCancelBtn.style.display = 'inline-block';
                    if (header) header.textContent = progressTitle;

                    settle({
                        proceed: true,
                        update(percent, step) {
                            const pct = Math.max(0, Math.min(100, Number(percent) || 0));
                            fillEl.style.width = `${pct}%`;
                            pctEl.textContent = `${Math.round(pct)}%`;
                            if (step) stepEl.textContent = step;
                        },
                        close() {
                            finish(true);
                        },
                        onCancel(fn) {
                            cancelHandler = fn;
                        }
                    });
                };
            }
        }).catch(() => {
            if (!settled) settle({ proceed: false });
        });
    });
}

/**
 * Show progress modal for long operations
 */
export function showProgressModal(title) {
    const id = _nextProgressId++;
    _emitModalEvent({
        type: 'showProgress',
        progress: { id, title, percent: 0, step: 'Starting...' }
    });
    return {
        update(percent, step, meta = {}) {
            _emitModalEvent({
                type: 'updateProgress',
                id,
                percent,
                step: step || 'Starting...',
                ...meta
            });
        },
        onCancel(fn) {
            _progressCancelHandlers.set(id, fn);
        },
        close() {
            dismissProgressModal(id);
        },
        element: null
    };
}

export default { showModal, confirm, confirmArcgisLargeImport, showProgressModal };
