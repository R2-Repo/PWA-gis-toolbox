/**
 * Widget registry entries (kept out of tool-catalog import graph for Vitest).
 */
import { registerTool, augmentTool, getTool } from '../tools/tool-registry.js';

/**
 * @param {{
 *   allWidgets: {
 *     type: string;
 *     label: string;
 *     icon?: string;
 *     tip?: string;
 *     badge?: string;
 *     requiredCapabilities?: string[];
 *     open: Function;
 *   }[];
 *   visibleWidgets: { type: string }[];
 * }} opts
 */
export function registerWidgetRegistryEntries(opts) {
    const visibleWidgetTypes = new Set(opts.visibleWidgets.map((w) => w.type));

    for (const widget of opts.allWidgets) {
        if (widget.type === 'spatial-join') {
            const nodeEntry = getTool('spatial-join');
            if (nodeEntry) {
                augmentTool('spatial-join', { kind: ['widget'], open: widget.open });
            }
            continue;
        }
        let status = 'hidden';
        if (visibleWidgetTypes.has(widget.type)) {
            status = widget.badge === 'Beta' ? 'beta' : 'ga';
        }
        registerTool({
            version: 1,
            id: widget.type,
            kind: ['widget'],
            label: widget.label,
            icon: widget.icon,
            tip: widget.tip,
            category: 'widget',
            status,
            capabilities: widget.requiredCapabilities ?? [],
            open: widget.open
        });
    }
}
