import { mountIsland } from '../mountIsland.jsx';
import { FiberProcurementDesignDialog } from './FiberProcurementDesignDialog.jsx';

export function mountFiberProcurementDesignDialog(element, props = {}) {
    return { unmount: mountIsland(element, FiberProcurementDesignDialog, props) };
}
