/**
 * True while the pop-out window owns the map.
 * Kept separate from the coordinator so map widgets can read it
 * without loading the app state module.
 */
let popoutOwnsMap = false;

export function setPopoutOwnsMap(active) {
    popoutOwnsMap = !!active;
}

export function isPopoutMap() {
    return popoutOwnsMap;
}
