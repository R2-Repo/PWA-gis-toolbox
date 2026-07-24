import { useCallback, useEffect, useRef } from 'react';
import mapServiceSingleton from '../../js/map/map-service.js';

export function MapView({
    mapService = mapServiceSingleton,
    onReady = null,
    onError = null
}) {
    const didInitRef = useRef(false);

    const setContainerRef = useCallback((node) => {
        if (!node) return;
        if (didInitRef.current) {
            return;
        }
        try {
            didInitRef.current = true;
            const map = mapService.init(node);
            onReady?.(map);
        } catch (error) {
            didInitRef.current = false;
            onError?.(error);
        }
    }, [mapService, onError, onReady]);

    useEffect(() => {
        return () => {
            if (!didInitRef.current) return;
            mapService.destroy();
            didInitRef.current = false;
        };
    }, [mapService]);

    return <div className="map-view-root" ref={setContainerRef} style={{ width: '100%', height: '100%' }} />;
}

export default MapView;
