import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LOCAL_GLYPH_FONT_STACK,
    LOCAL_GLYPH_RANGES,
    LOCAL_GLYPHS_URL
} from '../js/map/local-glyphs.js';

const require = createRequire(import.meta.url);
const Pbf = require('pbf');

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.svg', '.webmanifest']);
const SOURCE_DIRS = ['js', 'react', 'css', 'public', 'scripts'];
const ROOT_FILES = ['index.html', 'map-window.html', 'vite.config.js'];

const EXTERNAL_GLYPH = [
    /cartocdn\.com\/fonts/gi,
    /demotiles\.maplibre\.org\/font/gi,
    /https?:\/\/[^\s"'`<>]*\{fontstack\}/gi,
    /https?:\/\/[^\s"'`<>]*\/fonts\/[^\s"'`<>]*\.pbf/gi,
    /https?:\/\/[^\s"'`<>]*glyph[^\s"'`<>]*\.pbf/gi
];

function walk(dir, out) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            if (name === 'node_modules' || name === 'dist' || name === 'dist-web') continue;
            walk(path, out);
            continue;
        }
        out.push(path);
    }
}

function glyphHits(text) {
    const normalized = String(text).replace(/\\+/g, '');
    const hits = [];
    for (const pattern of EXTERNAL_GLYPH) {
        pattern.lastIndex = 0;
        const match = pattern.exec(normalized);
        if (match) hits.push(match[0]);
    }
    return hits;
}

function scanFiles(files) {
    const failures = [];
    for (const file of files) {
        if (file.endsWith('.pbf')) continue;
        const ext = extname(file).toLowerCase();
        if (ext && !TEXT_EXT.has(ext)) continue;
        const text = readFileSync(file, 'utf8');
        const hits = glyphHits(text);
        if (hits.length) failures.push(`${file}: ${hits.join(', ')}`);
    }
    return failures;
}

function readGlyphs(buf) {
    const glyphs = [];
    new Pbf(buf).readFields((tag, list, pbf) => {
        if (tag === 1) pbf.readMessage(readStack, list);
    }, glyphs);
    return glyphs;
}

function readStack(tag, glyphs, pbf) {
    if (tag === 3) glyphs.push(pbf.readMessage(readGlyph, {}));
}

function readGlyph(tag, glyph, pbf) {
    if (tag === 1) glyph.id = pbf.readVarint();
    else if (tag === 2) glyph.bitmap = pbf.readBytes();
    else if (tag === 3) glyph.width = pbf.readVarint();
    else if (tag === 4) glyph.height = pbf.readVarint();
    else if (tag === 5) glyph.left = pbf.readSVarint();
    else if (tag === 6) glyph.top = pbf.readSVarint();
    else if (tag === 7) glyph.advance = pbf.readVarint();
}

describe('local glyph bundle', () => {
    it('keeps glyph URLs same-origin in source', () => {
        const files = [];
        for (const dir of SOURCE_DIRS) walk(join(ROOT, dir), files);
        for (const name of ROOT_FILES) files.push(join(ROOT, name));
        expect(scanFiles(files)).toEqual([]);
        expect(LOCAL_GLYPHS_URL.startsWith('http')).toBe(false);
        expect(readFileSync(join(ROOT, 'vite.config.js'), 'utf8')).toMatch(/globPatterns:\s*\[[^\]]*pbf/);
    });

    it('ships the Open Sans / Noto stack for range 0-255', () => {
        expect(LOCAL_GLYPH_FONT_STACK).toEqual(['Open Sans Regular', 'Noto Sans Regular']);
        expect(LOCAL_GLYPH_RANGES).toEqual(['0-255']);
        const stack = LOCAL_GLYPH_FONT_STACK.join(',');
        const file = join(ROOT, 'public', 'fonts', stack, '0-255.pbf');
        expect(existsSync(file)).toBe(true);
        const buf = readFileSync(file);
        expect(buf.length).toBeGreaterThan(1000);
        const glyphs = readGlyphs(buf);
        const byId = new Map(glyphs.map((glyph) => [glyph.id, glyph]));
        const letter = byId.get(65);
        const space = byId.get(32);
        expect(letter.width).toBeGreaterThan(0);
        expect(letter.bitmap.length).toBe((letter.width + 6) * (letter.height + 6));
        expect(space.advance).toBeGreaterThan(0);
        expect(byId.has(0x00B0)).toBe(true);
    });
});
