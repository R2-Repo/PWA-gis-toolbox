import { describe, expect, it } from 'vitest';
import { buildAtlasHoverHtml, escapeAtlasHtml } from '../js/atlas/map-hover.js';

describe('atlas map hover', () => {
    it('escapes html in labels', () => {
        expect(escapeAtlasHtml('<script>')).toBe('&lt;script&gt;');
        const html = buildAtlasHoverHtml({
            atlasKind: 'drop',
            label: '<b>Site</b>',
            channelNumber: '12',
            dropNumber: 3,
            ip: '10.0.0.1',
            pingStatus: 'reachable'
        });
        expect(html).toContain('&lt;b&gt;Site&lt;/b&gt;');
        expect(html).not.toContain('<b>Site</b>');
        expect(html).toContain('12');
        expect(html).toContain('D3');
        expect(html).toContain('10.0.0.1');
        expect(html).toContain('Ping: reachable');
    });

    it('builds hub tooltip', () => {
        const html = buildAtlasHoverHtml({
            atlasKind: 'hub',
            label: 'Hub North',
            hubCode: 'H1',
            pingStatus: 'warning'
        });
        expect(html).toContain('Hub North');
        expect(html).toContain('Hub H1');
        expect(html).toContain('Ping: warning');
    });
});
