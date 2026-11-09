/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockedWidgetModal } from '../react/ui/DockedWidgetModal.jsx';
import { mountModalHost } from '../react/ui/mountModalHost.jsx';
import { showModal } from '../js/ui/modals.js';

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
        if (this.classList.contains('panel-center')) return rect(640, 700, 320, 48);
        if (this.classList.contains('panel-right') || this.classList.contains('panel-right-body')) {
            return rect(420, 700, 860, 48);
        }
        if (this.classList.contains('modal')) return rect(420, 280, 0, 0);
        return rect(100, 40);
    };
}

function mountShell() {
    const center = document.createElement('main');
    center.className = 'panel-center';
    const panel = document.createElement('div');
    panel.className = 'panel panel-right';
    panel.innerHTML = '<div class="panel-right-body"><div id="widget-panel-dock"></div></div>';
    const modalHost = document.createElement('div');
    modalHost.id = 'modal-host';
    document.body.append(center, panel, modalHost);
    const container = document.createElement('div');
    document.body.append(container);
    return { center, panel, modalHost, container, root: createRoot(container) };
}

afterEach(() => {
    dual.active = true;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    document.body.innerHTML = '';
});

describe('widget dialogs while Dual Screen is on', () => {
    it('opens the dialog in the primary map column', async () => {
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
        const overlay = document.querySelector('#modal-host .modal-overlay');
        const dialog = overlay?.querySelector('.modal');
        expect(dock?.textContent || '').not.toContain('Find Features');
        expect(overlay?.textContent).toContain('Find Features');
        expect(overlay?.classList.contains('modal-overlay--map-stage')).toBe(true);
        expect(overlay?.style.left).toBe('320px');
        expect(overlay?.style.top).toBe('48px');
        expect(overlay?.style.width).toBe('640px');
        expect(overlay?.style.height).toBe('700px');
        expect(dialog?.classList.contains('modal--panel-dock')).toBe(false);
        expect(dialog?.style.visibility).not.toBe('hidden');

        await act(async () => { root.unmount(); });
    });

    it('still docks the dialog on the right panel when Dual Screen is off', async () => {
        dual.active = false;
        installLayout();
        const { root } = mountShell();

        await act(async () => {
            root.render(h(DockedWidgetModal, {
                modal: {
                    id: 'buffer',
                    title: 'Buffer',
                    contentHtml: '<p>tool-body</p>',
                    options: { width: '420px' }
                }
            }));
        });

        const dialog = document.querySelector('#widget-panel-dock .modal');
        expect(dialog?.classList.contains('modal--panel-dock')).toBe(true);
        expect(document.querySelector('#modal-host')?.textContent || '').not.toContain('Buffer');

        await act(async () => { root.unmount(); });
    });

    it('opens other dialogs over the primary map column', async () => {
        dual.active = true;
        installLayout();
        const { root } = mountShell();
        const host = mountModalHost(document.getElementById('modal-host'));

        await act(async () => {
            showModal('Filter Builder', '<p>filter-body</p>', { width: '650px' });
        });

        const overlay = document.querySelector('#modal-host .modal-overlay');
        expect(overlay?.textContent).toContain('Filter Builder');
        expect(overlay?.classList.contains('modal-overlay--map-stage')).toBe(true);
        expect(overlay?.style.left).toBe('320px');
        expect(overlay?.style.width).toBe('640px');
        expect(document.querySelector('.panel-right')?.textContent || '').not.toContain('Filter Builder');

        await act(async () => {
            document.querySelector('.close-modal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            host.unmount();
            root.unmount();
        });
    });
});
