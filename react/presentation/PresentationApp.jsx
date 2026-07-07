import { useCallback, useEffect, useRef } from 'react';
import mapService from '../../js/map/map-service.js';
import { getPresentationModeState } from '../../js/presentation/presentation-mode-detector.js';
import { resolvePresentationCameraOverrides } from '../../js/presentation/presentation-scene-schema.js';
import {
    createPresentationOverlay,
    showPresentationError,
    startPresentationRuntime
} from '../../js/presentation/presentation-runtime.js';
import { MapView } from '../map/MapView.jsx';

function waitForMapStyleLoad(map) {
    if (!map) return Promise.resolve();
    if (map.isStyleLoaded()) return Promise.resolve();
    return new Promise((resolve) => {
        map.once('load', resolve);
    });
}

/** Wait until style/terrain/building changes from basemap or 3D setup have settled. */
function waitForMapIdle(map, timeoutMs = 5000) {
    if (!map) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            map.off('idle', done);
            resolve();
        };
        map.once('idle', done);
        window.setTimeout(done, timeoutMs);
    });
}

/** Wait for core 3D tile sources when presentation opens in 3D. */
function waitForPresentation3DTiles(map, timeoutMs = 6000) {
    if (!map) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            map.off('idle', done);
            map.off('sourcedata', onSourceData);
            window.clearTimeout(timer);
            resolve();
        };
        const onSourceData = (event) => {
            if (!event?.isSourceLoaded) return;
            if (event.sourceId === 'terrain-source' || event.sourceId === 'openfreemap') {
                done();
            }
        };
        map.on('sourcedata', onSourceData);
        map.once('idle', done);
        const timer = window.setTimeout(done, timeoutMs);
    });
}

async function applyPresentationMapView(mapService, scene) {
    const mapView = scene.mapView || {};
    const basemap = mapView.basemap || 'voyager';
    const enable3D = mapView.enable3D !== false;
    const cameraOverrides = resolvePresentationCameraOverrides(scene.camera);

    if (enable3D) {
        mapService.set3DEnabled(true);
    }

    if (basemap && basemap !== mapService.getCurrentBasemap()) {
        mapService.setBasemap(basemap);
    }

    if (enable3D) {
        mapService.reconcile3DState({ camera: cameraOverrides, emitEvent: false });
    } else if (cameraOverrides) {
        mapService.getMap()?.jumpTo({
            center: cameraOverrides.center,
            zoom: cameraOverrides.zoom,
            pitch: cameraOverrides.pitch ?? 0,
            bearing: cameraOverrides.bearing ?? 0
        });
    }

    const map = mapService.getMap();
    if (map) {
        await waitForMapIdle(map);
        if (enable3D) {
            await waitForPresentation3DTiles(map);
        }
    }
}

export function PresentationApp() {
    const modeState = getPresentationModeState();
    const containerRef = useRef(null);
    const runtimeRef = useRef(null);

    const onReady = useCallback(async () => {
        const map = mapService.getMap();
        const container = containerRef.current ?? map?.getContainer()?.parentElement ?? null;
        if (!container || !map) return;

        if (!modeState.scene) {
            showPresentationError(container, modeState.errors);
            return;
        }

        await waitForMapStyleLoad(map);
        await applyPresentationMapView(mapService, modeState.scene);
        createPresentationOverlay(container, modeState.scene.layout);
        runtimeRef.current = await startPresentationRuntime({
            map,
            scene: modeState.scene,
            container
        });
    }, [modeState]);

    useEffect(() => () => {
        runtimeRef.current?.cleanup?.();
        runtimeRef.current = null;
    }, []);

    if (!modeState.scene && modeState.errors?.length) {
        return (
            <div className="presentation-root presentation-root--error" ref={containerRef}>
                <div className="presentation-error">
                    <h1>Presentation unavailable</h1>
                    <p>{modeState.errors[0]}</p>
                    <a className="btn btn-primary" href="https://gis-toolbox.com">Go to GIS Toolbox</a>
                </div>
            </div>
        );
    }

    return (
        <div className="presentation-root" ref={containerRef}>
            <MapView mapService={mapService} onReady={onReady} />
            {modeState.scene?.metadata?.title ? (
                <div className="presentation-title-overlay">
                    <h1>{modeState.scene.metadata.title}</h1>
                    {modeState.scene.metadata.subtitle ? <p>{modeState.scene.metadata.subtitle}</p> : null}
                </div>
            ) : null}
        </div>
    );
}
