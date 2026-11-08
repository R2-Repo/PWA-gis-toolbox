/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { RouteMilepostDialog } from '../react/widgets/RouteMilepostDialog.jsx';
import { isPositiveMilepostRoute } from '../js/widgets/route-milepost/engine.js';
import { searchMilepostRoutes } from '../js/widgets/route-milepost/query.js';

function setNativeValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(container, text) {
    return [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === text);
}

describe('route milepost positive direction', () => {
    it('keeps undivided P and route-id P, and excludes N', async () => {
        const client = {
            searchRoutes: vi.fn(async () => [
                { ROUTE_ID: '0015PM', ROUTE_ALIAS_COMMON: 'I-15', ROUTE_DIRECTION: 'P' },
                { ROUTE_ID: '0015NM', ROUTE_ALIAS_COMMON: 'I-15', ROUTE_DIRECTION: 'N' },
                { ROUTE_ID: '0068PM', ROUTE_ALIAS_COMMON: 'SR-68', ROUTE_DIRECTION: 'P' },
                { ROUTE_ID: '0089PM', ROUTE_ALIAS_COMMON: 'SR-89', ROUTE_DIRECTION: '' },
                { ROUTE_ID: '0092NM', ROUTE_ALIAS_COMMON: 'SR-92', ROUTE_DIRECTION: '' }
            ])
        };

        const groups = await searchMilepostRoutes('I-15', client);
        const ids = groups.flatMap((group) => group.variants.map((variant) => variant.routeId));

        expect(ids).toEqual(expect.arrayContaining(['0015PM', '0068PM', '0089PM']));
        expect(ids).not.toContain('0015NM');
        expect(ids).not.toContain('0092NM');

        const divided = groups.find((group) => group.routeAlias === 'I-15');
        expect(divided.isDivided).toBe(false);
        expect(divided.variants.map((variant) => variant.routeDirection)).toEqual(['P']);

        const undivided = groups.find((group) => group.routeAlias === 'SR-68');
        expect(undivided.variants).toHaveLength(1);
        expect(undivided.variants[0].routeDirection).toBe('P');

        expect(isPositiveMilepostRoute({ routeId: 'I-15P' })).toBe(true);
        expect(isPositiveMilepostRoute({ routeId: 'I-15N' })).toBe(false);
        expect(isPositiveMilepostRoute({ routeId: '0015PM', routeDirection: 'N' })).toBe(false);
    });
});

describe('route milepost dialog range only', () => {
    it('has From and To fields, no point mode, and a Preview on map button', async () => {
        const onSearch = vi.fn(async () => [
            {
                groupKey: 'I-15',
                routeAlias: 'I-15',
                routeLabel: 'I-15',
                isDivided: true,
                variants: [
                    { routeId: '0015PM', routeAlias: 'I-15', routeLabel: 'I-15 (P)', routeDirection: 'P' },
                    { routeId: '0015NM', routeAlias: 'I-15', routeLabel: 'I-15 (N)', routeDirection: 'N' },
                    { routeId: '0015P', routeAlias: 'I-15', routeLabel: 'I-15P', routeDirection: 'P' }
                ]
            },
            {
                groupKey: 'SR-68',
                routeAlias: 'SR-68',
                routeLabel: 'SR-68',
                isDivided: false,
                variants: [
                    { routeId: '0068PM', routeAlias: 'SR-68', routeLabel: 'SR-68', routeDirection: 'P' }
                ]
            },
            {
                groupKey: 'I-80',
                routeAlias: 'I-80',
                routeLabel: 'I-80',
                isDivided: false,
                variants: [
                    { routeId: '0080NM', routeAlias: 'I-80', routeLabel: 'I-80N', routeDirection: 'N' }
                ]
            }
        ]);
        const onPreview = vi.fn(async () => ({ summary: { count: 2, sourceLabel: 'LR Mile' }, features: [] }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(h(RouteMilepostDialog, {
                onCancel: () => {},
                onSearchRoutes: onSearch,
                onPreview,
                onRun: vi.fn()
            }));
        });

        expect(container.querySelector('input[name="route-milepost-mode"]')).toBeNull();
        expect(container.querySelector('#route-milepost-mp')).toBeNull();
        expect(container.textContent).not.toContain('Milepost point');
        expect(container.querySelector('#route-milepost-from')).toBeTruthy();
        expect(container.querySelector('#route-milepost-to')).toBeTruthy();
        expect(buttonByText(container, 'Preview on map')).toBeTruthy();

        await act(async () => {
            setNativeValue(container.querySelector('#route-milepost-search'), 'I-15');
        });
        await act(async () => {
            container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(buttonByText(container, 'SR-68')).toBeTruthy();
        expect(buttonByText(container, 'I-80')).toBeFalsy();
        expect(container.textContent).not.toContain('I-80N');
        expect(container.textContent).not.toContain('I-15 (N)');

        await act(async () => {
            buttonByText(container, 'I-15').click();
        });

        expect(container.textContent).toContain('Choose direction');
        expect(buttonByText(container, 'I-15 (P)')).toBeTruthy();
        expect(buttonByText(container, 'I-15P')).toBeTruthy();
        expect(buttonByText(container, 'I-15 (N)')).toBeFalsy();

        await act(async () => {
            buttonByText(container, 'I-15 (N)')?.click();
            buttonByText(container, 'I-15 (P)').click();
        });

        expect(container.textContent).toContain('I-15 (P)');
        expect(container.textContent).not.toContain('I-15 (N)');
        expect(container.querySelector('#route-milepost-search')).toBeNull();

        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    it('rejects a restored N route, keeps undivided P, and previews a range', async () => {
        const negative = document.createElement('div');
        document.body.appendChild(negative);
        const negativeRoot = createRoot(negative);
        await act(async () => {
            negativeRoot.render(h(RouteMilepostDialog, {
                onCancel: () => {},
                initialInput: {
                    routeId: '0015NM',
                    routeAlias: 'I-15',
                    routeLabel: 'I-15N',
                    routeDirection: 'N'
                }
            }));
        });
        expect(negative.querySelector('#route-milepost-search')).toBeTruthy();
        expect(negative.textContent).not.toContain('I-15N');
        await act(async () => {
            negativeRoot.unmount();
        });
        negative.remove();

        const onPreview = vi.fn(async () => ({ summary: { count: 1, sourceLabel: 'LR Mile' }, features: [] }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(RouteMilepostDialog, {
                onCancel: () => {},
                onPreview,
                initialInput: {
                    routeId: '0068PM',
                    routeAlias: 'SR-68',
                    routeLabel: 'SR-68',
                    routeDirection: 'P'
                }
            }));
        });

        expect(container.textContent).toContain('SR-68');
        expect(container.querySelector('#route-milepost-search')).toBeNull();

        await act(async () => {
            setNativeValue(container.querySelector('#route-milepost-from'), '10');
            setNativeValue(container.querySelector('#route-milepost-to'), '12');
        });
        await act(async () => {
            buttonByText(container, 'Preview on map').click();
        });

        expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
            routeId: '0068PM',
            routeDirection: 'P',
            mode: 'range',
            startMilepost: '10',
            endMilepost: '12'
        }));
        expect(onPreview.mock.calls[0][0].mode).not.toBe('point');

        await act(async () => {
            root.unmount();
        });
        container.remove();
    });
});
