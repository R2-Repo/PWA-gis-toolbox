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
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });
});
