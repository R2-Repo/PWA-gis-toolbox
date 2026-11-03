/**
 * Dual Screen map-service proxy.
 * Implementation lives in map-bridge.js so every public method is classified once.
 */
export {
    installDualScreenMapServiceDecorator,
    FORWARDED_MAP_METHODS,
    LOCAL_ONLY_MAP_METHODS,
    classifyMapMethod
} from './map-bridge.js';
