import { mountIsland } from '../mountIsland.jsx';
import { CalloutBuilderDialog } from './CalloutBuilderDialog.jsx';

export function mountCalloutBuilderDialog(element, props = {}) {
    return { unmount: mountIsland(element, CalloutBuilderDialog, props) };
}
