/**
 * @vitest-environment jsdom
 */
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import '../js/widgets/registry.js';
import { SendToMenu } from '../react/widgets/shared/SendToMenu.jsx';
import { buildProducedResult } from '../js/tools/tool-result-interop.js';

describe('SendToMenu', () => {
    it('renders only compatible visible targets', async () => {
        const result = buildProducedResult('spatial-join', {
            layerIds: ['layer-1'],
            outputs: [{ name: 'out', type: 'layer' }]
        });
        const onSelectTarget = vi.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(h(SendToMenu, { result, onSelectTarget }));
        });

        const menu = container.querySelector('[data-testid="send-to-menu"]');
        expect(menu).toBeTruthy();
        const toggle = menu.querySelector('button');
        expect(toggle?.textContent).toBe('Send to…');

        await act(async () => {
            toggle?.click();
        });

        const items = [...container.querySelectorAll('[role="menuitem"]')];
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((btn) => btn.textContent?.includes('Bulk Update'))).toBe(true);
        expect(items.some((btn) => btn.textContent?.includes('Plan Set Callouts'))).toBe(false);

        await act(async () => {
            items[0].click();
        });
        expect(onSelectTarget).toHaveBeenCalledTimes(1);
    });

    it('renders nothing when result has no layer ids', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(SendToMenu, {
                result: buildProducedResult('buffer', { layerIds: [], outputs: [] }),
                onSelectTarget: () => {}
            }));
        });
        expect(container.querySelector('[data-testid="send-to-menu"]')).toBeNull();
    });
});
