import { mountIsland } from '../mountIsland.jsx';
import { UgrcKeySettingsDialog } from './UgrcKeySettingsDialog.jsx';

export function mountUgrcKeySettingsDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountUgrcKeySettingsDialog: target element is required');
    }
    return { unmount: mountIsland(element, UgrcKeySettingsDialog, props) };
}
