import { PresentationAnimationEngine } from './animation-engine.js';
import { PRESENTATION_HOME_URL } from './presentation-scene-schema.js';
import { PRESENTATION_LAYER_SUFFIXES, PRESENTATION_SOURCE_ID } from './presentation-constants.js';
import { hasBakedPresentationStyles } from './presentation-style-capture.js';

export { PRESENTATION_SOURCE_ID } from './presentation-constants.js';

function geomTypesFilter(types) {
    return ['any', ...types.map((type) => ['==', ['geometry-type'], type])];
}

function psField(key) {
    return ['get', key, ['get', '_ps']];
}

function coalescePs(key, fallback) {
    return ['coalesce', psField(key), fallback];
}

/**
 * @param {import('geojson').FeatureCollection} geojson
 * @param {import('./presentation-scene-schema.js').PresentationStyle} style
 */
function buildPresentationPaint(geojson, style = {}) {
    const lineColor = style.lineColor || '#007aff';
    const lineWidth = style.lineWidth ?? 5;
    const pointRadius = style.pointRadius ?? 7;
    const polygonOpacity = style.polygonOpacity ?? 0.35;
    const baked = hasBakedPresentationStyles(geojson);

    if (!baked) {
        return {
            fill: {
                'fill-color': lineColor,
                'fill-opacity': polygonOpacity
            },
            outline: {
                'line-color': lineColor,
                'line-width': lineWidth
            },
            line: {
                'line-color': lineColor,
                'line-width': lineWidth
            },
            circle: {
                'circle-radius': pointRadius,
                'circle-color': lineColor,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        };
    }

    return {
        fill: {
            'fill-color': coalescePs('f', lineColor),
            'fill-opacity': coalescePs('fo', polygonOpacity)
        },
        outline: {
            'line-color': coalescePs('s', lineColor),
            'line-width': coalescePs('sw', lineWidth),
            'line-opacity': coalescePs('so', 1)
        },
        line: {
            'line-color': coalescePs('s', lineColor),
            'line-width': coalescePs('sw', lineWidth),
            'line-opacity': coalescePs('so', 1)
        },
        circle: {
            'circle-radius': coalescePs('r', pointRadius),
            'circle-color': coalescePs('f', coalescePs('s', lineColor)),
            'circle-stroke-color': coalescePs('s', '#ffffff'),
            'circle-stroke-width': 2,
            'circle-opacity': coalescePs('so', 1)
        }
    };
}

function applyPaintProperties(map, layerId, paint) {
    if (!map.getLayer(layerId)) return;
    for (const [key, value] of Object.entries(paint)) {
        map.setPaintProperty(layerId, key, value);
    }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function removePresentationFeatureLayers(map) {
    if (!map) return;
    for (const suffix of PRESENTATION_LAYER_SUFFIXES) {
        const layerId = `${PRESENTATION_SOURCE_ID}${suffix}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    if (map.getSource(PRESENTATION_SOURCE_ID)) map.removeSource(PRESENTATION_SOURCE_ID);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {import('geojson').FeatureCollection} geojson
 * @param {import('./presentation-scene-schema.js').PresentationStyle} style
 */
export function addPresentationFeatureLayers(map, geojson, style = {}) {
    const paint = buildPresentationPaint(geojson, style);

    if (!map.getSource(PRESENTATION_SOURCE_ID)) {
        map.addSource(PRESENTATION_SOURCE_ID, { type: 'geojson', data: geojson });
    } else {
        map.getSource(PRESENTATION_SOURCE_ID).setData(geojson);
    }

    const layerIds = [];

    const fillId = `${PRESENTATION_SOURCE_ID}-fill`;
    if (!map.getLayer(fillId)) {
        map.addLayer({
            id: fillId,
            type: 'fill',
            source: PRESENTATION_SOURCE_ID,
            filter: geomTypesFilter(['Polygon', 'MultiPolygon']),
            paint: paint.fill
        });
    } else {
        applyPaintProperties(map, fillId, paint.fill);
    }
    layerIds.push(fillId);

    const outlineId = `${PRESENTATION_SOURCE_ID}-outline`;
    if (!map.getLayer(outlineId)) {
        map.addLayer({
            id: outlineId,
            type: 'line',
            source: PRESENTATION_SOURCE_ID,
            filter: geomTypesFilter(['Polygon', 'MultiPolygon']),
            paint: paint.outline
        });
    } else {
        applyPaintProperties(map, outlineId, paint.outline);
    }
    layerIds.push(outlineId);

    const lineId = `${PRESENTATION_SOURCE_ID}-line`;
    if (!map.getLayer(lineId)) {
        map.addLayer({
            id: lineId,
            type: 'line',
            source: PRESENTATION_SOURCE_ID,
            filter: geomTypesFilter(['LineString', 'MultiLineString']),
            paint: paint.line
        });
    } else {
        applyPaintProperties(map, lineId, paint.line);
    }
    layerIds.push(lineId);

    const circleId = `${PRESENTATION_SOURCE_ID}-circle`;
    if (!map.getLayer(circleId)) {
        map.addLayer({
            id: circleId,
            type: 'circle',
            source: PRESENTATION_SOURCE_ID,
            filter: geomTypesFilter(['Point', 'MultiPoint']),
            paint: paint.circle
        });
    } else {
        applyPaintProperties(map, circleId, paint.circle);
    }
    layerIds.push(circleId);

    return layerIds;
}

/**
 * @param {HTMLElement} container
 * @param {import('./presentation-scene-schema.js').PresentationLayout} layout
 */
export function createPresentationOverlay(container, layout) {
    const faviconUrl = `${import.meta.env.BASE_URL}icons/favicon.png`;
    const overlay = document.createElement('div');
    overlay.className = 'presentation-overlay';

    const brandHtml = layout.showLogo ? `
        <a class="presentation-overlay__brand-link" href="#" aria-label="GIS-Toolbox.com">
            <span class="presentation-overlay__logo-icon">
                <img src="${faviconUrl}" alt="GIS-Toolbox.com" width="36" height="36" />
            </span>
            <span class="presentation-overlay__title">
                GIS-Toolbox<span class="title-com">.com</span>
            </span>
        </a>
    ` : '';

    const homeHtml = layout.showHomeButton ? `
        <button type="button" class="presentation-overlay__home" aria-label="Home">⌂</button>
    ` : '';

    overlay.innerHTML = `
        <div class="presentation-overlay__brand">${brandHtml}</div>
        ${homeHtml}
    `;

    const homeUrl = layout.homeUrl || PRESENTATION_HOME_URL;
    const goHome = (event) => {
        event.preventDefault();
        window.location.href = homeUrl;
    };

    const homeBtn = overlay.querySelector('.presentation-overlay__home');
    const brandLink = overlay.querySelector('.presentation-overlay__brand-link');

    homeBtn?.addEventListener('click', goHome);
    brandLink?.addEventListener('click', goHome);

    container.appendChild(overlay);
    return overlay;
}

/**
 * @param {HTMLElement} container
 * @param {string[]} errors
 */
export function showPresentationError(container, errors = []) {
    container.className = 'presentation-root presentation-root--error';
    container.innerHTML = `
        <div class="presentation-error">
            <h1>Presentation unavailable</h1>
            <p>${(errors[0] || 'This presentation link is invalid or expired.').replace(/</g, '&lt;')}</p>
            <a class="btn btn-primary" href="${PRESENTATION_HOME_URL}">Go to GIS Toolbox</a>
        </div>
    `;
}

/**
 * @param {object} options
 * @param {import('maplibre-gl').Map} options.map
 * @param {import('./presentation-scene-schema.js').PresentationScene} options.scene
 * @param {HTMLElement} options.container
 */
export async function startPresentationRuntime({ map, scene, container }) {
    addPresentationFeatureLayers(map, scene.features, scene.style);

    const engine = new PresentationAnimationEngine({
        map,
        features: scene.features,
        style: scene.style
    });

    await engine.applyCamera(scene.camera);
    if (scene.animations?.length) {
        await engine.playSequence(scene.animations);
    }

    return {
        engine,
        cleanup: () => engine.cleanup()
    };
}
