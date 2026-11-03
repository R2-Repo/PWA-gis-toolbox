/**
 * @vitest-environment jsdom
 */
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LabelsSection } from '../react/panels/LabelsSection.jsx';

const polygonLayer = {
    id: 'parcels',
    schema: {
        geometryType: 'Polygon',
        fields: [{ name: 'NAME', type: 'string', selected: true }]
    },
    geojson: {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { NAME: 'Block A' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            }
        }]
    }
};

describe('LabelsSection polygon hint', () => {
    it('says polygon labels sit at an interior point', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(LabelsSection, {
                layer: polygonLayer,
                style: { labels: { enabled: true, field: 'NAME', placement: 'point' } },
                onStyleChange: () => {}
            }));
        });
        expect(container.textContent).toContain('Labels at an interior point');
        expect(container.textContent).not.toContain('Point placement requires point features');
        expect(container.textContent).not.toContain('Min zoom');
        expect(container.textContent).not.toContain('Max zoom');
        const halo = container.querySelector('[aria-label="Halo color"]');
        const width = container.querySelector('[aria-label="Halo width"]');
        expect(halo).toBeTruthy();
        expect(width).toBeTruthy();
        expect(container.querySelector('details')?.contains(halo)).toBe(false);
        expect(container.querySelector('[aria-label="Decimals"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Prefix"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Suffix"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Template"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Second field"]')).toBeTruthy();
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    it('shows a plain note when an ArcGIS expression was simplified', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let next = null;
        await act(async () => {
            root.render(h(LabelsSection, {
                layer: polygonLayer,
                style: {
                    labels: {
                        enabled: true,
                        field: 'NAME',
                        expressionNote: 'The ArcGIS label expression was simplified to the field NAME.'
                    }
                },
                onStyleChange: (style) => { next = style; }
            }));
        });
        expect(container.querySelector('.labels-expression-note')?.textContent)
            .toBe('The ArcGIS label expression was simplified to the field NAME.');
        const decimals = container.querySelector('[aria-label="Decimals"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(decimals, '2');
            decimals.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(next.labels.decimals).toBe(2);
        expect(next.labels.expressionNote).toContain('simplified');
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });
});
