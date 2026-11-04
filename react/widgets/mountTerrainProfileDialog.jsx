import { mountIsland } from '../mountIsland.jsx';
import { TerrainProfileDialog } from './TerrainProfileDialog.jsx';

export function mountTerrainProfileDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountTerrainProfileDialog: target element is required');
    }
    const unmount = mountIsland(element, TerrainProfileDialog, props);
    return { unmount };
}
