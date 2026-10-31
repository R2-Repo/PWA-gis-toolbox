import { describe, it, expect } from 'vitest';
import { shouldInjectGtmHtml } from '../scripts/gtm-html-snippet.js';

describe('scripts/gtm-html-snippet.js', () => {
    it('documents preview and dev as non-GTM surfaces', () => {
        expect(shouldInjectGtmHtml('serve', 'production')).toBe(false);
        expect(shouldInjectGtmHtml('build', 'web')).toBe(false);
    });
});
