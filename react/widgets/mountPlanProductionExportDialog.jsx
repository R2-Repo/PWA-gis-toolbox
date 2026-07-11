import { mountIsland } from '../mountIsland.jsx';
import { PlanProductionExportDialog } from './PlanProductionExportDialog.jsx';

export function mountPlanProductionExportDialog(element, props = {}) {
    if (!element) {
        throw new Error('mountPlanProductionExportDialog: target element is required');
    }

    const unmount = mountIsland(element, PlanProductionExportDialog, props);
    return { unmount };
}
