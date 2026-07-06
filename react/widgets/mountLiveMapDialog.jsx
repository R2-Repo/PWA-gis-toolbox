import { mountIsland } from '../mountIsland.jsx';
import { LiveMapDialog } from './LiveMapDialog.jsx';

export function mountLiveMapDialog(element, props = {}) {
    const unmount = mountIsland(element, LiveMapDialog, props);
    return { unmount };
}
