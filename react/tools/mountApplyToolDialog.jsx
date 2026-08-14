import { mountIsland } from '../mountIsland.jsx';
import { ApplyToolDialog } from './ApplyToolDialog.jsx';

export function mountApplyToolDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountApplyToolDialog: target element is required');
    }

    const unmount = mountIsland(element, ApplyToolDialog, props);
    return { unmount };
}
