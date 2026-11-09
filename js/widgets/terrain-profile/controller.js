import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import {
    buildLineOfSight,
    buildLineOfSiteMapLayers,
    buildLineOfSiteOverlayFeatures,
    normalizeTerrainView,
    terrainViewsMatch
} from './engine.js';
import {
    LOS_DOT_FILL,
    LOS_DOT_FILL_RADIUS,
    LOS_DOT_OUTLINE,
    LOS_DOT_RING
} from './preview-layer.js';

function sampleElevationsFromMap(ctx, points) {
    const sampleElevations = ctx.mapService?.sampleElevations;
    if (typeof sampleElevations !== 'function') {
        throw new Error('Elevation sampling is not available on this map.');
    }
    return sampleElevations.call(ctx.mapService, points);
}

async function readTerrainView(ctx) {
    const capture = ctx.mapService?.captureTerrainViewState;
    if (typeof capture !== 'function') return null;
    try {
        return normalizeTerrainView(await capture.call(ctx.mapService));
    } catch {
        return null;
    }
}

function resultToast(result) {
    if (!result?.stats?.validCount) {
        return 'No terrain elevation was returned along this line.';
    }
    return result.visible ? 'Line of Site is visible.' : 'Line of Site is blocked.';
}

const LOS_LINE_STYLE = {
    mode: 'simple',
    strokeOpacity: 1,
    fillOpacity: 1,
    pointSymbol: 'circle'
};

/**
 * Styles match the session graphics: green visible beam, red blocked beam,
 * gold terrain profile, magenta observer and target, red obstruction.
 * @param {string} role
 * @returns {object | null}
 */
function lineOfSiteLayerStyle(role) {
    if (role === 'beam-visible') {
        return { ...LOS_LINE_STYLE, strokeColor: '#00e040', fillColor: '#00e040', strokeWidth: 4 };
    }
    if (role === 'beam-blocked') {
        return { ...LOS_LINE_STYLE, strokeColor: '#ff2d1a', fillColor: '#ff2d1a', strokeWidth: 4 };
    }
    if (role === 'profile') {
        return { ...LOS_LINE_STYLE, strokeColor: '#d4a24e', fillColor: '#d4a24e', strokeWidth: 3 };
    }
    if (role === 'obstruction') {
        return {
            ...LOS_LINE_STYLE,
            strokeColor: LOS_DOT_RING,
            fillColor: '#ff2d1a',
            strokeWidth: 2,
            pointSize: 6
        };
    }
    if (role === 'endpoints') {
        return {
            ...LOS_LINE_STYLE,
            strokeColor: LOS_DOT_RING,
            fillColor: LOS_DOT_FILL,
            strokeWidth: 2,
            pointSize: LOS_DOT_FILL_RADIUS,
            labels: {
                enabled: true,
                field: 'label',
                placement: 'point',
                minZoom: 0,
                size: 13,
                offset: [0, -0.85],
                anchor: 'bottom',
                color: '#ffffff',
                haloColor: LOS_DOT_OUTLINE,
                haloWidth: 2,
                allowOverlap: true,
                ignorePlacement: true
            }
        };
    }
    return null;
}

function addLosLayer(ctx, spec) {
    const dataset = ctx.createSpatialDataset(spec.name, spec.geojson, {
        format: 'derived',
        widget: 'terrain-profile',
        role: spec.role
    });
    const style = lineOfSiteLayerStyle(spec.role);
    if (style) ctx.mapService.setLayerStyle(dataset.id, style);
    ctx.addLayer(dataset);
    const index = ctx.getLayers().indexOf(dataset);
    ctx.mapService.addLayer(dataset, index < 0 ? 0 : index, { fit: false });
    return dataset;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object | null }} [options]
 */
export async function openTerrainProfile(ctx, options = {}) {
    const restoreState = options.restoreState || null;
    const previous = await readTerrainView(ctx);
    if (!previous || !previous.is3d || !previous.terrain) {
        await ctx.mapService.enable3D?.({
            animate: false,
            pitch: previous?.is3d ? previous.pitch : 30,
            bearing: previous?.bearing ?? 0
        });
    }
    const owned = await readTerrainView(ctx);

    const showOverlay = (observer, target, result) => {
        const geojson = buildLineOfSiteOverlayFeatures(observer, target, result);
        if (!geojson.features.length) {
            ctx.mapService.removeLineOfSiteOverlay?.();
            return;
        }
        ctx.mapService.showLineOfSiteOverlay?.(geojson);
    };

    let closed = false;
    /** @type {Promise<void> | null} */
    let closing = null;
    const cleanup = () => {
        if (closed) return closing;
        closed = true;
        closing = (async () => {
            ctx.mapService.cancelInteraction?.();
            ctx.mapService.removeLineOfSiteBeam?.();
            ctx.mapService.removeLineOfSiteOverlay?.();
            const now = await readTerrainView(ctx);
            if (previous && owned && now && terrainViewsMatch(owned, now)) {
                try {
                    await ctx.mapService.restoreTerrainViewState?.(previous);
                } catch {
                    /* leave the view the user changed to */
                }
            }
        })();
        return closing;
    };

    await openReactIsland({
        title: 'Line of Site',
        width: '480px',
        mountPath: '../../../react/widgets/mountTerrainProfileDialog.jsx',
        mountExport: 'mountTerrainProfileDialog',
        onOverlayDestroy: () => cleanup(),
        getProps: (close) => ({
            initialState: restoreState,
            onCancel: async () => {
                await cleanup();
                close();
            },
            onPickPoint: async (role) => {
                ctx.mapService.cancelInteraction?.();
                const prompt = role === 'target'
                    ? 'Click the target location'
                    : 'Click the observer location';
                const coord = await ctx.mapService.startPointPick?.(prompt);
                if (!Array.isArray(coord) || coord.length < 2) return null;
                return [coord[0], coord[1]];
            },
            onPreviewPoints: (observer, target) => {
                showOverlay(observer, target, null);
            },
            onRun: (input) => withActivity('Sampling elevation…', async () => {
                const sampleElevations = (points) => sampleElevationsFromMap(ctx, points);
                try {
                    const result = await buildLineOfSight({ ...input, curvature: true, sampleElevations });
                    showOverlay(input?.observer, input?.target, result);
                    ctx.mapService.showLineOfSiteBeam?.(result.beam);
                    const empty = !result.stats?.validCount;
                    ctx.showToast?.(resultToast(result), empty || !result.visible ? 'warning' : 'success');
                    return result;
                } catch (err) {
                    ctx.mapService.removeLineOfSiteBeam?.();
                    throw err;
                }
            }),
            onAddLayer: (result) => {
                const specs = buildLineOfSiteMapLayers(result);
                if (!specs.length) {
                    ctx.showToast?.('Nothing to add', 'warning');
                    return null;
                }
                const datasets = specs.map((spec) => addLosLayer(ctx, spec));
                ctx.refreshUI();
                ctx.showToast?.(`Added ${datasets.length} Line of Site layers`, 'success');
                return { layers: datasets };
            }
        })
    });
}
