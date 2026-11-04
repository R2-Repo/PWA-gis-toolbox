import { mountIsland } from '../mountIsland.jsx';
import { MapPrintMenu } from './MapPrintMenu.jsx';

export function mountMapPrintMenu(element, props = {}) {
    if (!element) throw new Error('mountMapPrintMenu: target element is required');
    return { unmount: mountIsland(element, MapPrintMenu, props) };
}
