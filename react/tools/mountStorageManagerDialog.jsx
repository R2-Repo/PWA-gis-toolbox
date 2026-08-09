import { mountIsland } from '../mountIsland.jsx';
import { StorageManagerDialog } from './StorageManagerDialog.jsx';

export function mountStorageManagerDialog(element, props = {}) {
    if (!element) throw new Error('mountStorageManagerDialog: target element is required');
    return { unmount: mountIsland(element, StorageManagerDialog, props) };
}
