import { mountIsland } from '../mountIsland.jsx';
import { SplitPolygonDialog } from './SplitPolygonDialog.jsx';

export function mountSplitPolygonDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountSplitPolygonDialog: target element is required');
    }

    const unmount = mountIsland(element, SplitPolygonDialog, props);
    return { unmount };
}
