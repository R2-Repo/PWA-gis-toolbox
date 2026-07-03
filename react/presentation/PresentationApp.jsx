import { useCallback, useEffect, useRef } from 'react';
import mapService from '../../js/map/map-service.js';
import { getPresentationModeState } from '../../js/presentation/presentation-mode-detector.js';
import {
    createPresentationOverlay,
    showPresentationError,
    startPresentationRuntime
} from '../../js/presentation/presentation-runtime.js';
import { MapView } from '../map/MapView.jsx';

export function PresentationApp() {
    const modeState = getPresentationModeState();
    const containerRef = useRef(null);
    const runtimeRef = useRef(null);

    const onReady = useCallback(async () => {
        const container = containerRef.current;
        const map = mapService.getMap();
        if (!container || !map) return;

        if (!modeState.scene) {
            showPresentationError(container, modeState.errors);
            return;
        }

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
