/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetPopoutLayers, replacePopoutLayers } from '../js/dual-screen/popout-layer-catalog.js';
import {
    LEGEND_COLLAPSED_KEY,
    legendEntriesForPanel,
    readLegendCollapsed,
    styleForLegendLayer,
    writeLegendCollapsed
} from '../js/map/legend-panel.js';
import { RightPanel } from '../react/panels/RightPanel.jsx';

const SIMPLE = {
    mode: 'simple',
    strokeColor: '#ff8800',
    fillColor: '#abcdef',
    strokeWidth: 3,
    strokeOpacity: 1,
    fillOpacity: 0.4,
    pointSize: 8,
    pointSymbol: 'circle'
};

const ENTRIES = [{
    id: 'roads',
    name: 'Roads',
    symbology: 'single',
    ramp: null,
    items: [{ label: '', color: '#ff8800', swatch: 'line', width: 3 }]
}];

function lineLayer(id, name, visible = true) {
    return {
        id,
        name,
        type: 'spatial',
        visible,
        schema: { geometryType: 'LineString' },
        style: SIMPLE
    };
}

function codeWithoutComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

async function renderPanel(props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(h(RightPanel, props));
    });
    return {
        container,
        root,
        async unmount() {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        }
    };
}

describe('legend panel', () => {
    beforeEach(() => {
        localStorage.clear();
        resetPopoutLayers();
    });

    it('starts collapsed when no preference is stored', async () => {
        expect(readLegendCollapsed()).toBe(true);
        const view = await renderPanel({ snapshot: { layer: null }, legendEntries: ENTRIES });
        const header = view.container.querySelector('.legend-panel .panel-section-header');
        const body = view.container.querySelector('.legend-panel .panel-section-body');
        expect(header.className).toMatch(/collapsed/);
        expect(body.className).toMatch(/hidden/);
        expect(view.container.querySelector('[data-map-legend="true"]')).toBeTruthy();
        expect(view.container.textContent).toContain('No layer selected');
        await view.unmount();
    });

    it('remembers the expanded and collapsed preference', async () => {
        const first = await renderPanel({ snapshot: { layer: null }, legendEntries: ENTRIES });
        const header = first.container.querySelector('.legend-panel .panel-section-header');
        await act(async () => {
            header.click();
        });
        expect(localStorage.getItem(LEGEND_COLLAPSED_KEY)).toBe('0');
        expect(readLegendCollapsed()).toBe(false);
        expect(header.className).not.toMatch(/collapsed/);
        await first.unmount();

        const second = await renderPanel({ snapshot: { layer: null }, legendEntries: ENTRIES });
        const reopened = second.container.querySelector('.legend-panel .panel-section-header');
        expect(reopened.className).not.toMatch(/collapsed/);
        expect(second.container.querySelector('.legend-panel .panel-section-body').className).not.toMatch(/hidden/);
        await act(async () => {
            reopened.click();
        });
        expect(localStorage.getItem(LEGEND_COLLAPSED_KEY)).toBe('1');
        expect(readLegendCollapsed()).toBe(true);
        expect(reopened.className).toMatch(/collapsed/);
        await second.unmount();
    });

    it('treats a stored expanded value as open and ignores other values', () => {
        writeLegendCollapsed(false);
        expect(readLegendCollapsed()).toBe(false);
        localStorage.setItem(LEGEND_COLLAPSED_KEY, 'false');
        expect(readLegendCollapsed()).toBe(false);
        localStorage.setItem(LEGEND_COLLAPSED_KEY, 'yes');
        expect(readLegendCollapsed()).toBe(true);
    });

    it('keeps the legend out of the map overlay and the pop-out window', () => {
        const app = readFileSync('react/App.jsx', 'utf8');
        const mapStart = app.indexOf('<div id="map-container">');
        const mapEnd = app.indexOf('</main>', mapStart);
        const mapBlock = app.slice(mapStart, mapEnd);
        expect(mapBlock).not.toContain('MapLegend');
        expect(mapBlock).not.toContain('data-map-legend');
        expect(app).toContain('legendEntries={legendEntries}');

        const popout = readFileSync('js/map-window.js', 'utf8');
        expect(popout).not.toContain('mountPopoutLegend');
        expect(popout).not.toContain('map-window-legend-host');
        expect(popout).not.toContain('PopoutLegend');

        const css = readFileSync('css/main.css', 'utf8');
        const rule = css.match(/\.map-legend \{[^}]+\}/)?.[0] || '';
        expect(rule).not.toMatch(/position:\s*absolute/);
        expect(css).not.toContain('#map-container.dual-screen-map-hidden .map-legend');
    });

    it('reads dual-screen entries from the bridge catalog', () => {
        const roads = lineLayer('roads', 'Roads');
        const hidden = lineLayer('hidden', 'Hidden', false);
        replacePopoutLayers([roads, hidden]);

        expect(legendEntriesForPanel({ dualScreen: true }).map((entry) => entry.name)).toEqual(['Roads']);
        expect(legendEntriesForPanel({ dualScreen: true })[0].items[0].swatch).toBe('line');

        const panel = legendEntriesForPanel({
            dualScreen: false,
            layers: [lineLayer('parks', 'Parks')],
            styleFor: (layer) => layer.style
        });
        expect(panel.map((entry) => entry.name)).toEqual(['Parks']);
    });

    it('mirrors workspace layers through the bridge while dual screen is on', () => {
        const roads = lineLayer('roads', 'Roads');
        const hidden = lineLayer('hidden', 'Hidden', false);
        const entries = legendEntriesForPanel({
            dualScreen: true,
            layers: [hidden, roads],
            styleFor: (layer) => styleForLegendLayer(layer, {
                getLayerStyle: (id) => (id === 'roads' ? SIMPLE : null)
            })
        });
        expect(entries.map((entry) => entry.id)).toEqual(['roads']);
        expect(entries[0].items[0].color).toBe('#ff8800');

        const legendSource = codeWithoutComments(readFileSync('js/map/legend-panel.js', 'utf8'));
        const bridgeSource = codeWithoutComments(readFileSync('js/dual-screen/popout-legend.js', 'utf8'));
        expect(legendSource).not.toMatch(/\bgetMap\b/);
        expect(bridgeSource).not.toMatch(/\bgetMap\b/);
    });
});
