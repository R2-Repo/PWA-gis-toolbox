import { mountIsland } from '../mountIsland.jsx';
import { SheetCutterDialog } from './SheetCutterDialog.jsx';

export function mountSheetCutterDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountSheetCutterDialog: target element is required');
    }

    const unmount = mountIsland(element, SheetCutterDialog, props);
    return { unmount };
}
