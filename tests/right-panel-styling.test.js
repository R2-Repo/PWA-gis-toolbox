/**
 * @vitest-environment jsdom
 */
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../react/panels/RightPanel.jsx';

const layer = {
    id: 'roads',
    name: 'Roads',
    type: 'spatial',
    scaleRangeEnabled: true,
    minScale: 500000,
    maxScale: 10000,
    schema: {
        geometryType: 'LineString',
        fields: [{ name: 'name', type: 'string', selected: true, outputName: 'name' }]
    },
    geojson: {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: 'Main' },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
        }]
    }
};

const savedStyle = {
    mode: 'simple',
    strokeColor: '#336699',
    labels: {
        enabled: true,
        field: 'name',
        placement: 'line',
        minZoom: 13,
        maxZoom: 19,
        size: 14,
        color: '#222222'
    }
};

function snapshot(overrides = {}) {
    return {
        layer,
        selectedFields: [{ name: 'name', outputName: 'name', type: 'string' }],
        formats: [{ key: 'geojson', label: 'GeoJSON' }],
        agolMode: false,
        agolCheck: null,
        layerStyle: savedStyle,
        styleDefaultColor: '#2563eb',
        mapZoom: 12,
        mapLatitude: 40,
        ...overrides
    };
}

function headerTitles(container) {
    return [...container.querySelectorAll('.panel-section-header')].map((el) =>
        el.querySelector('span')?.textContent?.trim() || ''
    );
}

describe('right panel styling order', () => {
    it('opens Symbology first and shows saved visibility plus label zoom', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(RightPanel, { snapshot: snapshot() }));
        });

        expect(headerTitles(container)).toEqual([
            'Legend',
            'Symbology',
            'Labels',
            'Visibility',
            'Data Preview',
            'Output Schema (1 fields)',
            'Export'
        ]);
        expect(container.querySelector('.style-panel .panel-section-header').className).not.toMatch(/collapsed/);
        expect(container.querySelector('.labels-panel .panel-section-header').className).toMatch(/collapsed/);
        expect(container.querySelector('.labels-panel').textContent).not.toContain('Min zoom');

        const visibility = container.querySelector('.visibility-panel');
        expect(visibility.textContent).toContain('Layer visible at...');
        expect(visibility.textContent).toContain('Labels visible at...');
        expect(visibility.querySelector('[aria-label="Labels minimum zoom"]').value).toBe('13');
        expect(visibility.querySelector('[aria-label="Labels maximum zoom"]').value).toBe('19');
        const scaleInputs = visibility.querySelectorAll('input[type="text"]');
        expect(scaleInputs[0].value.replace(/,/g, '')).toBe('500000');
        expect(scaleInputs[1].value.replace(/,/g, '')).toBe('10000');

        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    it('writes label zoom onto the existing labels object', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onStyleChange = vi.fn();
        await act(async () => {
            root.render(h(RightPanel, { snapshot: snapshot(), onStyleChange }));
        });

        const input = container.querySelector('[aria-label="Labels minimum zoom"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setter.call(input, '15');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));
        });

        expect(onStyleChange).toHaveBeenCalled();
        const next = onStyleChange.mock.calls.at(-1)[0];
        expect(next.labels.minZoom).toBe(15);
        expect(next.labels.maxZoom).toBe(19);
        expect(next.labels.field).toBe('name');
        expect(next.labels.enabled).toBe(true);
        expect(next.labels.size).toBe(14);
        expect(next.strokeColor).toBe('#336699');
        expect(next.labels.minScale).toBeUndefined();

        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    it('places AGOL after export when compatibility mode is on', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(RightPanel, {
                snapshot: snapshot({ agolMode: true, agolCheck: { issues: [] } })
            }));
        });
        const titles = headerTitles(container);
        expect(titles.indexOf('Export')).toBeGreaterThan(titles.indexOf('Data Preview'));
        expect(titles.indexOf('AGOL Readiness')).toBe(titles.indexOf('Export') + 1);
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });
});
