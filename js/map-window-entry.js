/**
 * Dual-screen map window bootstrap.
 * Globals must be installed before map-window.js evaluates: that module and
 * the map engine read maplibregl and turf as browser globals during init.
 */
import { bootstrapGlobals } from './core/bootstrap-globals.js';

bootstrapGlobals();

await import('./map-window.js');
