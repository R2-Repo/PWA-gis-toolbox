import { mountIsland } from '../mountIsland.jsx';
import { LayerSummaryDialog } from './LayerSummaryDialog.jsx';

export function mountLayerSummaryDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountLayerSummaryDialog: target element is required');
    }

    const unmount = mountIsland(element, LayerSummaryDialog, props);
    return { unmount };
}
