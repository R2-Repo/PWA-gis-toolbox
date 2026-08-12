import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { DATAPREP_CHUNK_THRESHOLD } from '../../dataprep/transforms.js';
import {
    markWidgetClosed,
    upsertWidgetState
} from '../widget-state-store.js';
import {
    runAttributeQuery,
    runAttributeQueryAsync
} from './engine.js';
import {
    applyQueryResultEffects,
    clearQueryResultOverlay,
    createQueryResultLayer,
    reapplyQueryResultEffects,
    selectQueryResults
} from './result-effects.js';

function getLayerById(ctx, layerId) {
    return ctx.getLayers().find((layer) => layer.id === layerId) || null;
}

function syncWidgetState(state, open = true) {
    upsertWidgetState('query', { open, state });
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openQuery(ctx, { restoreState = null } = {}) {
    const layerOptions = getSpatialLayerOptions(ctx, { includeFields: true });

    await openReactIsland({
        title: 'Query Features',
        width: '520px',
        mountPath: '../../../react/widgets/mountQueryDialog.jsx',
        mountExport: 'mountQueryDialog',
        getProps: (close) => {
            const handleClose = () => {
                clearQueryResultOverlay(ctx);
                markWidgetClosed('query');
                close();
            };

            return {
                layers: layerOptions,
                initialState: restoreState,
                onCancel: handleClose,
                onStateChange: (state) => syncWidgetState(state, true),
                onClearResults: () => {
                    clearQueryResultOverlay(ctx);
                },
                onRun: async ({ layerId, conditions, logic, resultBehavior, zoomMode }) => {
                    return withActivity('Running query…', async () => {
                        const layer = getLayerById(ctx, layerId);
                        if (!layer?.geojson?.features?.length) {
                            throw new Error('Selected layer has no features.');
                        }

                        const features = layer.geojson.features;
                        let matchingIndices;
                        if (features.length >= DATAPREP_CHUNK_THRESHOLD) {
                            const { TaskRunner } = await import('../../core/task-runner.js');
                            const task = new TaskRunner('Query', 'QueryWidget');
                            const queryResult = await task.run((t) =>
                                runAttributeQueryAsync({ features, conditions, logic, task: t })
                            );
                            matchingIndices = queryResult.matchingIndices;
                        } else {
                            matchingIndices = runAttributeQuery({ features, conditions, logic }).matchingIndices;
                        }

                        const effects = applyQueryResultEffects(ctx, {
                            layerId,
                            layer,
                            matchingIndices,
                            resultBehavior,
                            zoomMode
                        });

                        if (!effects.hasMatches) {
                            ctx.showToast?.('No matching features found', 'info');
                        }

                        const result = {
                            matchingIndices,
                            total: features.length,
                            layerId,
                            layerName: layer.name,
                            message: effects.message,
                            lastResultLayerId: effects.lastResultLayerId
                        };

                        syncWidgetState({
                            selectedLayerIds: [layerId],
                            queryMode: 'attribute',
                            conditions,
                            logic,
                            resultBehavior,
                            zoomMode,
                            lastResultLayerId: effects.lastResultLayerId,
                            lastMatchingIndices: matchingIndices,
                            lastTotal: features.length
                        }, true);

                        return result;
                    });
                },
                onReapplyEffects: async ({ layerId, matchingIndices, resultBehavior, zoomMode }) => {
                    const layer = getLayerById(ctx, layerId);
                    if (!layer) throw new Error('Layer not found.');

                    const effects = reapplyQueryResultEffects(ctx, {
                        layerId,
                        layer,
                        matchingIndices,
                        resultBehavior: { ...resultBehavior, createResultLayer: false },
                        zoomMode
                    });

                    syncWidgetState({
                        selectedLayerIds: [layerId],
                        queryMode: 'attribute',
                        resultBehavior,
                        zoomMode,
                        lastMatchingIndices: matchingIndices,
                        lastTotal: layer.geojson?.features?.length ?? matchingIndices.length,
                        lastResultLayerId: effects.lastResultLayerId
                    }, true);

                    return {
                        message: effects.message,
                        lastResultLayerId: effects.lastResultLayerId
                    };
                },
                onSelectResults: ({ layerId, matchingIndices }) => {
                    selectQueryResults(ctx, { layerId, matchingIndices });
                },
                onCreateResultLayer: async ({ layerId, matchingIndices }) => {
                    const layer = getLayerById(ctx, layerId);
                    if (!layer) {
                        ctx.showToast?.('Layer not found', 'warning');
                        return null;
                    }
                    return createQueryResultLayer(ctx, { layer, matchingIndices });
                }
            };
        }
    });
}
