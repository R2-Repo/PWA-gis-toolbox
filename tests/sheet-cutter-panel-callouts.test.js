/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    WIDGET_PANEL_DOCK_PAD,
    WIDGET_PANEL_EXPANDED_RATIO,
    WIDGET_PANEL_HALF_RATIO,
    computeWidgetDockHeights
} from '../js/ui/widget-modal-placement.js';
import { ALL_GIS_WIDGETS, GIS_WIDGETS, GIS_WIDGETS_HIDDEN } from '../js/widgets/registry.js';

describe('widget panel dock heights', () => {
    it('uses the expanded ratio by default', () => {
        const heights = computeWidgetDockHeights(800);
        expect(heights.expandedMax).toBe(Math.floor(800 * WIDGET_PANEL_EXPANDED_RATIO));
        expect(heights.halfMax).toBe(Math.floor(800 * WIDGET_PANEL_HALF_RATIO));
    });

    it('fills the right panel minus dock padding when fillPanel is set', () => {
        const heights = computeWidgetDockHeights(800, { fillPanel: true });
        expect(heights.expandedMax).toBe(800 - WIDGET_PANEL_DOCK_PAD * 2);
        expect(heights.halfMax).toBe(Math.floor(800 * WIDGET_PANEL_HALF_RATIO));
    });
});

describe('GIS widget registry', () => {
    it('keeps Sheet Cutter in the left-panel list', () => {
        expect(GIS_WIDGETS.some((widget) => widget.type === 'sheet-cutting')).toBe(true);
    });

    it('hides Plan Set Callouts from the left panel but keeps it registered', () => {
        expect(GIS_WIDGETS.some((widget) => widget.type === 'plan-set-callouts')).toBe(false);
        expect(GIS_WIDGETS_HIDDEN.some((widget) => widget.type === 'plan-set-callouts')).toBe(true);
        expect(ALL_GIS_WIDGETS.some((widget) => widget.type === 'plan-set-callouts')).toBe(true);
    });

    it('does not register the same widget type twice', () => {
        const types = ALL_GIS_WIDGETS.map((widget) => widget.type);
        expect(new Set(types).size).toBe(types.length);
    });
});
