import { showModal } from './modals.js';

/** Vite-bundled mount helpers — runtime .jsx URLs are not shipped in dist/. */
const mountModuleLoaders = import.meta.glob('../../react/**/mount*.jsx');

export function normalizeMountSuffix(mountPath) {
    return mountPath.replace(/^(\.\.\/)+/, '');
}

export function resolveMountLoader(mountPath) {
    const suffix = normalizeMountSuffix(mountPath);
    const entry = Object.entries(mountModuleLoaders).find(([key]) => {
        const normalizedKey = normalizeMountSuffix(key);
        return normalizedKey === suffix || key.endsWith(suffix);
    });
    if (!entry) {
        throw new Error(`openReactIsland: mount module not found for ${mountPath}`);
    }
    return entry[1];
}

function watchOverlayUnmount(overlay, onUnmount) {
    const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
            try {
                onUnmount?.();
            } finally {
                observer.disconnect();
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Open a modal hosting a dynamically imported React dialog.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.width]
 * @param {boolean} [options.fillPanel] — docked right-panel widgets fill the panel height
 * @param {string} options.mountPath - path suffix under react/ (resolved via import.meta.glob)
 * @param {string} [options.mountExport] - named export to call
 * @param {(close: () => void) => object | Promise<object>} options.getProps
 * @param {() => void} [options.onOverlayDestroy]
 * @param {() => void} [options.onClose] — alias for onOverlayDestroy
 */
export async function openReactIsland({ title, width, fillPanel, mountPath, mountExport, getProps, onOverlayDestroy, onClose }) {
    const rootId = `react-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    showModal(title, `<div id="${rootId}"></div>`, {
        width,
        docked: true,
        fillPanel: fillPanel === true,
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;

            const mod = await resolveMountLoader(mountPath)();
            const mountFn = mountExport
                ? mod[mountExport]
                : Object.values(mod).find((fn) => typeof fn === 'function' && fn.name.startsWith('mount'));

            if (typeof mountFn !== 'function') {
                throw new Error(`openReactIsland: no mount function found in ${mountPath}`);
            }

            const props = await getProps(close);
            const mounted = mountFn(root, props);
            const teardown = () => {
                mounted?.unmount?.();
                (onOverlayDestroy || onClose)?.();
            };
            watchOverlayUnmount(overlay, teardown);
        }
    });
}

export { watchOverlayUnmount };
