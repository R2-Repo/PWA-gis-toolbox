/**
 * Atlas workspace keyboard shortcuts.
 */
import bus from '../core/event-bus.js';

/** @type {((e: KeyboardEvent) => void) | null} */
let keyHandler = null;

function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return !!target.closest?.('[contenteditable="true"]');
}

/**
 * @param {{
 *   onEscape?: () => void,
 *   onFocusSearch?: () => void
 * }} handlers
 */
export function enableAtlasHotkeys(handlers = {}) {
    disableAtlasHotkeys();
    keyHandler = (e) => {
        if (e.defaultPrevented) return;
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (isEditableTarget(e.target)) return;
            e.preventDefault();
            handlers.onFocusSearch?.();
            bus.emit('atlas:focus-search');
            return;
        }
        if (e.key === 'Escape') {
            if (isEditableTarget(e.target)) {
                /** @type {HTMLElement} */ (e.target).blur?.();
                bus.emit('atlas:search-blur');
                return;
            }
            handlers.onEscape?.();
        }
    };
    window.addEventListener('keydown', keyHandler);
}

export function disableAtlasHotkeys() {
    if (keyHandler) {
        window.removeEventListener('keydown', keyHandler);
        keyHandler = null;
    }
}
