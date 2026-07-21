/**
 * Atlas workspace keyboard shortcuts.
 */
import bus from '../core/event-bus.js';
import { showModal } from '../ui/modals.js';

/** @type {((e: KeyboardEvent) => void) | null} */
let keyHandler = null;

function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return !!target.closest?.('[contenteditable="true"]');
}

export function showAtlasShortcutsHelp() {
    return showModal(
        'Atlas shortcuts',
        `<ul class="atlas-shortcuts-list">
            <li><kbd>/</kbd> Focus search</li>
            <li><kbd>Esc</kbd> Clear area, then selection (or blur / clear search)</li>
            <li><kbd>?</kbd> Show this help</li>
        </ul>
        <p class="atlas-muted" style="margin:8px 0 0;font-size:12px">Map focus bar and left panel also have Clear.</p>`,
        {
            footer: '<button type="button" class="btn btn-primary confirm-btn">Close</button>',
            onMount: (overlay, close) => {
                overlay.querySelector('.confirm-btn')?.addEventListener('click', () => close(true));
            }
        }
    );
}

/**
 * @param {{
 *   onEscape?: () => void,
 *   onFocusSearch?: () => void,
 *   onHelp?: () => void
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
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (isEditableTarget(e.target)) return;
            e.preventDefault();
            handlers.onHelp?.();
            bus.emit('atlas:shortcuts-help');
            void showAtlasShortcutsHelp();
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
