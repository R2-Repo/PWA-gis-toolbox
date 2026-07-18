import { useCallback, useEffect, useRef } from 'react';
import mapServiceSingleton from '../../js/map/map-service.js';
import { isTauriShellPresent } from '../../js/platform/create-platform.js';

export function MapView({
    mapService = mapServiceSingleton,
    onReady = null,
    onError = null
}) {
    const didInitRef = useRef(false);
    const disposeDesktopZoomRef = useRef(null);

    const setContainerRef = useCallback((node) => {
        if (!node) return;
        if (didInitRef.current) {
            return;
        }
        try {
            didInitRef.current = true;
            const map = mapService.init(node);
            if (isTauriShellPresent()) {
                void import('../../js/platform/windows/map-wheel-zoom.js').then(({ installDesktopMapZoom }) => {
                    if (!didInitRef.current) return;
                    disposeDesktopZoomRef.current?.();
                    disposeDesktopZoomRef.current = installDesktopMapZoom(map);
                });
            }
            onReady?.(map);
        } catch (error) {
            didInitRef.current = false;
            onError?.(error);
        }
    }, [mapService, onError, onReady]);

    useEffect(() => {
        return () => {
            disposeDesktopZoomRef.current?.();
            disposeDesktopZoomRef.current = null;
            if (!didInitRef.current) return;
            mapService.destroy();
            didInitRef.current = false;
        };
    }, [mapService]);

    return <div className="map-view-root" ref={setContainerRef} style={{ width: '100%', height: '100%' }} />;
}

export default MapView;
