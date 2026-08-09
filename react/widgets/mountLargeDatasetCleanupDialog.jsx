import { mountIsland } from '../mountIsland.jsx';
import { LargeDatasetCleanupDialog } from './LargeDatasetCleanupDialog.jsx';

export function mountLargeDatasetCleanupDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountLargeDatasetCleanupDialog: target element is required');
    }
    const unmount = mountIsland(element, LargeDatasetCleanupDialog, props);
    return { unmount };
}
