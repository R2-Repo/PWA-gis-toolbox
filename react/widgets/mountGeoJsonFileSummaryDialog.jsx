import { mountIsland } from '../mountIsland.jsx';
import { GeoJsonFileSummaryDialog } from './GeoJsonFileSummaryDialog.jsx';

export function mountGeoJsonFileSummaryDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountGeoJsonFileSummaryDialog: target element is required');
    }

    const unmount = mountIsland(element, GeoJsonFileSummaryDialog, props);
    return { unmount };
}
