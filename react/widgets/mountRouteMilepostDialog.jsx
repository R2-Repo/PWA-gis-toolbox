import { mountIsland } from '../mountIsland.jsx';
import { RouteMilepostDialog } from './RouteMilepostDialog.jsx';

export function mountRouteMilepostDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountRouteMilepostDialog: target element is required');
    }
    const unmount = mountIsland(element, RouteMilepostDialog, props);
    return { unmount };
}
