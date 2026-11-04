import { mountIsland } from '../mountIsland.jsx';
import { PopoutLegend } from './PopoutLegend.jsx';

export function mountPopoutLegend(element) {
    if (!element) throw new Error('mountPopoutLegend: target element is required');
    return { unmount: mountIsland(element, PopoutLegend, {}) };
}
