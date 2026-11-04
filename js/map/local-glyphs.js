/**
 * Same-origin MapLibre glyphs. The page base is `./`, so this resolves next to
 * index.html and map-window.html. MapLibre joins `text-font` with a comma and
 * substitutes that string for `{fontstack}`.
 *
 * Range 0-255 (Basic Latin and Latin-1 Supplement) covers the characters the
 * app draws: digits, stationing, ASCII names, the degree sign, and Western
 * European accents. No map label string in source uses a code point above U+00FF.
 * Open Sans Regular contains every code point in that block that the face
 * defines, so the Noto Sans Regular name is only the fallback in the stack.
 */
export const LOCAL_GLYPHS_URL = './fonts/{fontstack}/{range}.pbf';

export const LOCAL_GLYPH_FONT_STACK = ['Open Sans Regular', 'Noto Sans Regular'];

export const LOCAL_GLYPH_RANGES = ['0-255'];
