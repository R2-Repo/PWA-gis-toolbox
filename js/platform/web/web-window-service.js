/**
 * Browser Dual Screen window opener (window.open).
 * Keeps the existing PWA popup path unchanged.
 */

/**
 * @param {Window} win
 * @returns {import('../contracts.js').MapWindowHandle}
 */
function wrapBrowserWindow(win) {
    return {
        get closed() {
            try {
                return Boolean(win.closed);
            } catch {
                return true;
            }
        },
        focus() {
            try {
                win.focus();
            } catch {
                /* ignore */
            }
        },
        close() {
            try {
                win.close();
            } catch {
                /* ignore */
            }
        }
    };
}

/**
 * @returns {import('../contracts.js').WindowService}
 */
export function createWebWindowService() {
    return {
        /**
         * @param {import('../contracts.js').OpenMapWindowOptions} opts
         * @returns {Promise<import('../contracts.js').MapWindowHandle | null>}
         */
        async openMapWindow(opts = {}) {
            const url = opts.url || 'map-window.html';
            const name = opts.name || 'gis-toolbox-map';
            const features = opts.features || '';
            const win = window.open(url, name, features);
            if (!win) return null;
            try {
                win.opener = null;
            } catch {
                /* ignore */
            }
            return wrapBrowserWindow(win);
        }
    };
}
