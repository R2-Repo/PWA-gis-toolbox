import { mountIsland } from '../mountIsland.jsx';
import { GeoreferenceRasterDialog } from './GeoreferenceRasterDialog.jsx';

export function mountGeoreferenceRasterDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountGeoreferenceRasterDialog: target element is required');
    }
    const unmount = mountIsland(element, GeoreferenceRasterDialog, props);
    return { unmount };
}
