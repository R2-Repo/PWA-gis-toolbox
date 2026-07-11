import { mountIsland } from '../mountIsland.jsx';
import { SheetCuttingDialog } from './SheetCuttingDialog.jsx';

export function mountSheetCuttingDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountSheetCuttingDialog: target element is required');
    }

    const unmount = mountIsland(element, SheetCuttingDialog, props);
    return { unmount };
}
