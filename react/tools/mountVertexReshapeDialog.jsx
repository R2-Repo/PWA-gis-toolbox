import { mountIsland } from '../mountIsland.jsx';
import { VertexReshapeDialog } from './VertexReshapeDialog.jsx';

export function mountVertexReshapeDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountVertexReshapeDialog: target element is required');
    }

    const unmount = mountIsland(element, VertexReshapeDialog, props);
    return { unmount };
}
