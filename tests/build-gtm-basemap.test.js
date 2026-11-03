import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldInjectGtmHtml, GTM_HTML_SNIPPET } from '../scripts/gtm-html-snippet.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Async so the Vitest worker can answer RPC during the build (execSync blocks past the 60s RPC timeout). */
function runBuild(command) {
    return new Promise((resolve, reject) => {
        exec(command, {
            cwd: ROOT,
            env: { ...process.env, CI: '1' },
            maxBuffer: 20 * 1024 * 1024
        }, (error, stdout, stderr) => {
            if (error) {
                error.message = `${error.message}\n${stdout || ''}\n${stderr || ''}`;
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function readDistJsBundle(outDir) {
    const assets = join(ROOT, outDir, 'assets');
    if (!existsSync(assets)) return '';
    return readdirSync(assets)
        .filter((name) => name.endsWith('.js'))
        .map((name) => readFileSync(join(assets, name), 'utf8'))
        .join('\n');
}

function parseTagAttrs(tag) {
    /** @type {Record<string, string>} */
    const attrs = {};
    const re = /([^\s"'=<>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = re.exec(tag))) {
        attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? '';
    }
    return attrs;
}

/** Absolute http(s) or protocol-relative URLs. Relative and root-relative paths are same-origin. */
export function isExternalAssetUrl(url) {
    const value = String(url || '').trim();
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return false;
    if (value.startsWith('//')) return true;
    return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function assetUrlFromTag(tag) {
    const attrs = parseTagAttrs(tag);
    if (/^<script\b/i.test(tag)) return attrs.src || '';
    if (!/^<link\b/i.test(tag)) return '';
    const rel = String(attrs.rel || '').toLowerCase();
    if (rel === 'stylesheet' || rel === 'modulepreload') return attrs.href || '';
    return '';
}

/** Script src, stylesheet href, and modulepreload href values that are not same-origin. */
export function externalScriptAndStylesheetUrls(html) {
    const urls = [];
    const tags = String(html || '').match(/<(?:script|link)\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const url = assetUrlFromTag(tag);
        if (url && isExternalAssetUrl(url)) urls.push(url);
    }
    return urls;
}

function localScriptAndStylesheetUrls(html) {
    const urls = [];
    const tags = String(html || '').match(/<(?:script|link)\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const url = assetUrlFromTag(tag);
        if (url && !isExternalAssetUrl(url)) urls.push(url);
    }
    return urls;
}

function referencedBuiltAssets(jsText) {
    const refs = [];
    const re = /["'](\.\/[^"']+\.(?:js|css))["']/g;
    let match;
    while ((match = re.exec(String(jsText || '')))) refs.push(match[1]);
    return refs;
}

function precacheKey(url) {
    return String(url || '').replace(/^\.\//, '').split(/[?#]/)[0];
}

function assertMapWindowBundledLocally(outDir) {
    const html = readFileSync(join(ROOT, outDir, 'map-window.html'), 'utf8');
    const external = externalScriptAndStylesheetUrls(html);
    expect(external, `${outDir}/map-window.html external script or stylesheet URLs`).toEqual([]);
    expect(html).not.toMatch(/unpkg\.com|cdn\.jsdelivr\.net|cdn\.sheetjs\.com/);
    const sw = readFileSync(join(ROOT, outDir, 'sw.js'), 'utf8');
    expect(sw).toContain('map-window.html');
    const assets = new Set(localScriptAndStylesheetUrls(html).map(precacheKey).filter(Boolean));
    for (const asset of [...assets]) {
        if (!asset.endsWith('.js') || asset === 'registerSW.js') continue;
        const js = readFileSync(join(ROOT, outDir, asset), 'utf8');
        for (const ref of referencedBuiltAssets(js)) {
            const key = precacheKey(ref);
            const fromAssets = key.startsWith('assets/') ? key : `assets/${key.replace(/^\.\//, '')}`;
            assets.add(fromAssets);
        }
    }
    expect(assets.size).toBeGreaterThan(0);
    for (const asset of assets) {
        expect(sw, `precache missing ${asset}`).toContain(asset);
    }
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
    it('production dist includes GTM and CARTO default basemap URL', async () => {
        await runBuild('npx vite build');
        const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
        expect(html).toMatch(/googletagmanager\.com\/gtag\/js/);
        expect(html).toContain('G-ZTHRF9QMPV');
        const js = readDistJsBundle('dist');
        expect(js).toContain('basemaps.cartocdn.com/gl/voyager-gl-style/style.json');
        assertMapWindowBundledLocally('dist');
    }, 240_000);

    it('web/e2e dist-web excludes GTM', async () => {
        await runBuild('npx vite build --mode web');
        const html = readFileSync(join(ROOT, 'dist-web/index.html'), 'utf8');
        expect(html).not.toMatch(/googletagmanager\.com/);
        expect(html).not.toContain('G-ZTHRF9QMPV');
        assertMapWindowBundledLocally('dist-web');
    }, 240_000);
});

describe('map window local libraries', () => {
    it('flags external script and stylesheet URLs', () => {
        const cdn = `<!DOCTYPE html><html><head>
            <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
            <link rel="stylesheet" href="css/map-window.css">
            </head><body>
            <script src="https://cdn.jsdelivr.net/npm/@turf/turf@7.1.0/turf.min.js"></script>
            <script src="//cdn.example.com/lib.js"></script>
            <script type="module" src="./assets/map-window-entry.js"></script>
            </body></html>`;
        expect(externalScriptAndStylesheetUrls(cdn)).toEqual([
            'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
            'https://cdn.jsdelivr.net/npm/@turf/turf@7.1.0/turf.min.js',
            '//cdn.example.com/lib.js'
        ]);
    });

    it('built map-window.html has no external script or stylesheet URLs', () => {
        assertMapWindowBundledLocally('dist');
    });
});
