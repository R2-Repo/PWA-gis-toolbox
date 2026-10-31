import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldInjectGtmHtml, GTM_HTML_SNIPPET } from '../scripts/gtm-html-snippet.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function readDistJsBundle(outDir) {
    const assets = join(ROOT, outDir, 'assets');
    if (!existsSync(assets)) return '';
    return readdirSync(assets)
        .filter((name) => name.endsWith('.js'))
        .map((name) => readFileSync(join(assets, name), 'utf8'))
        .join('\n');
}

describe('gtm build policy', () => {
    it('injects GTM only on production release builds', () => {
        expect(shouldInjectGtmHtml('build', 'production')).toBe(true);
        expect(shouldInjectGtmHtml('build', 'web')).toBe(false);
        expect(shouldInjectGtmHtml('serve', 'production')).toBe(false);
        expect(shouldInjectGtmHtml('serve', 'development')).toBe(false);
    });

    it('keeps the production gtag id in the snippet template', () => {
        expect(GTM_HTML_SNIPPET).toContain('googletagmanager.com/gtag/js');
        expect(GTM_HTML_SNIPPET).toContain('G-ZTHRF9QMPV');
    });
});

describe('release vs e2e HTML bundles', () => {
    it('production dist includes GTM and CARTO default basemap URL', () => {
        execSync('npx vite build', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } });
        const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
        expect(html).toMatch(/googletagmanager\.com\/gtag\/js/);
        expect(html).toContain('G-ZTHRF9QMPV');
        const js = readDistJsBundle('dist');
        expect(js).toContain('basemaps.cartocdn.com/gl/voyager-gl-style/style.json');
    }, 240_000);

    it('web/e2e dist-web excludes GTM', () => {
        execSync('npx vite build --mode web', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } });
        const html = readFileSync(join(ROOT, 'dist-web/index.html'), 'utf8');
        expect(html).not.toMatch(/googletagmanager\.com/);
        expect(html).not.toContain('G-ZTHRF9QMPV');
    }, 240_000);
});
