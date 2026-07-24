import { mountIsland } from '../mountIsland.jsx';
import { SpatialJoinDialog } from './SpatialJoinDialog.jsx';

export function mountSpatialJoinDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountSpatialJoinDialog: target element is required');
    }

    const unmount = mountIsland(element, SpatialJoinDialog, props);
    return { unmount };
}
