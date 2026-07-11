import { mountIsland } from '../mountIsland.jsx';
import { PlanSetCalloutsDialog } from './PlanSetCalloutsDialog.jsx';

export function mountPlanSetCalloutsDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountPlanSetCalloutsDialog: target element is required');
    }

    const unmount = mountIsland(element, PlanSetCalloutsDialog, props);
    return { unmount };
}
