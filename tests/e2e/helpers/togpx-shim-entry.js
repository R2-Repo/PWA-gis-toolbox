/**
 * Browser IIFE entry — bundled for Playwright init script (sets globalThis.togpx for loadToGpx).
 */
import togpx from 'togpx';

globalThis.togpx = typeof togpx === 'function' ? togpx : togpx.default;
