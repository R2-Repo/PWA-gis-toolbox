/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockedWidgetModal } from '../react/ui/DockedWidgetModal.jsx';

const dual = vi.hoisted(() => ({ active: true }));

vi.mock('../js/dual-screen/coordinator.js', () => ({
    default: {
        get isActive() { return dual.active; },
        set isActive(value) { dual.active = !!value; },
        onStateChange() { return () => {}; }
    }
}));

const originalRect = HTMLElement.prototype.getBoundingClientRect;

function rect(width, height, left = 0, top = 0) {
    return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON() { return {}; }
    };
}

function installLayout() {
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
        if (this.classList.contains('panel-right') || this.classList.contains('panel-right-body')) {
            return rect(420, 700, 860, 48);
        }
        if (this.classList.contains('modal')) return rect(420, 280, 0, 0);
        return rect(100, 40);
    };
}

function mountShell() {
    const panel = document.createElement('div');
    panel.className = 'panel panel-right';
    panel.innerHTML = '<div class="panel-right-body"><div id="widget-panel-dock"></div></div>';
    const modalHost = document.createElement('div');
    modalHost.id = 'modal-host';
    document.body.append(panel, modalHost);
    const container = document.createElement('div');
    document.body.append(container);
    return { panel, modalHost, container, root: createRoot(container) };
}

afterEach(() => {
    dual.active = true;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    document.body.innerHTML = '';
});

describe('widget dialogs while Dual Screen is on', () => {
    it('keeps the dialog in the right-panel dock instead of a hidden float', async () => {
        dual.active = true;
        installLayout();
        const { root } = mountShell();

        await act(async () => {
            root.render(h(DockedWidgetModal, {
                modal: {
                    id: 'find-features',
                    title: 'Find Features',
                    contentHtml: '<p>widget-body</p>',
                    options: { width: '420px' }
                }
            }));
        });

        const dock = document.querySelector('#widget-panel-dock');
        const dialog = dock?.querySelector('.modal');
        expect(dock?.textContent).toContain('Find Features');
        expect(dialog?.classList.contains('modal--panel-dock')).toBe(true);
        expect(dialog?.style.visibility).not.toBe('hidden');
        expect(document.querySelector('#modal-host')?.textContent || '').not.toContain('Find Features');

        await act(async () => { root.unmount(); });
    });
});
