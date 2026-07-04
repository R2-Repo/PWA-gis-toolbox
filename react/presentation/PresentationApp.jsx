import { useCallback, useEffect, useRef } from 'react';
import mapService from '../../js/map/map-service.js';
import { getPresentationModeState } from '../../js/presentation/presentation-mode-detector.js';
import {
    createPresentationOverlay,
    showPresentationError,
    startPresentationRuntime
} from '../../js/presentation/presentation-runtime.js';
import { MapView } from '../map/MapView.jsx';

function waitForMapStyleLoad(map) {
    if (map.isStyleLoaded()) return Promise.resolve();
    return new Promise((resolve) => {
        map.once('load', resolve);
    });
}

async function applyPresentationMapView(mapService, scene) {
    const mapView = scene.mapView || {};
    const basemap = mapView.basemap || 'voyager';
    const enable3D = mapView.enable3D !== false;

    if (enable3D) {
        mapService.set3DEnabled(true);
    }

    if (basemap && basemap !== mapService.getCurrentBasemap()) {
        mapService.setBasemap(basemap);
        const map = mapService.getMap();
        if (map) await waitForMapStyleLoad(map);
    }

    if (enable3D) {
        mapService.reconcile3DState({ emitEvent: false });
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

        await applyPresentationMapView(mapService, modeState.scene);
        createPresentationOverlay(container, modeState.scene.layout);
        await waitForMapStyleLoad(map);
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
