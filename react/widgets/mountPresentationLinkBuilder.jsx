import { mountIsland } from '../mountIsland.jsx';
import { PresentationLinkBuilder } from './PresentationLinkBuilder.jsx';

export function mountPresentationLinkBuilder(element, props = {}) {
    if (!element) throw new Error('mountPresentationLinkBuilder: target element is required');
    return { unmount: mountIsland(element, PresentationLinkBuilder, props) };
}
