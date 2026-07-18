/**
 * @typedef {Object} WidgetContext
 * @property {() => import('../core/data-model.js').Dataset[]} getLayers
 * @property {(id: string) => import('../core/data-model.js').Dataset | undefined} getLayerById
 * @property {object} mapService
 * @property {(layer: import('../core/data-model.js').Dataset) => void} addLayer
 * @property {(name: string, geojson: object, opts?: object) => import('../core/data-model.js').Dataset} createSpatialDataset
 * @property {() => void} refreshUI
 * @property {(message: string, type?: string) => void} showToast
 * @property {(id: string) => void} [setActiveLayer]
 * @property {(geojson: object) => object} [analyzeSchema]
 * @property {typeof globalThis.turf} [turf]
 * @property {import('../platform/contracts.js').PlatformInfo} [platform]
 * @property {import('../platform/contracts.js').PlatformServices} [services]
 */

/**
 * @typedef {Object} LayerOption
 * @property {string} id
 * @property {string} name
 * @property {number} featureCount
 * @property {boolean} [hasPolygons]
 * @property {string[]} [fields]
 * @property {number} [selectedCount]
 */

/**
 * @typedef {Object} AreaDrawPayload
 * @property {object} analysisArea
 * @property {'draw' | 'layer'} areaSource
 */

export {};
