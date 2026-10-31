/**
 * Placeholder for node types that are not registered in the catalog (missing plugin, older export, etc.).
 */
import { NodeBase } from './node-base.js';

export const UNKNOWN_PLACEHOLDER_NODE_TYPE = 'unknown-node-type';

/**
 * @param {object} savedNode — serialized node from graph JSON
 */
export function createUnknownPlaceholderNode(savedNode) {
    const originalType = savedNode?.type || 'unknown';
    const node = new UnknownPlaceholderNode(originalType);
    node.id = savedNode.id;
    node.position = savedNode.position || { x: 0, y: 0 };
    node.config = {
        originalType,
        savedConfig: savedNode.config && typeof savedNode.config === 'object'
            ? { ...savedNode.config }
            : {}
    };
    if (savedNode.comment) node.comment = savedNode.comment;
    return node;
}

export class UnknownPlaceholderNode extends NodeBase {
    /** @param {string} originalType */
    constructor(originalType) {
        super(UNKNOWN_PLACEHOLDER_NODE_TYPE, {
            name: 'Missing node',
            icon: '⚠️',
            category: 'transform',
            color: '#b45309'
        });
        this.config = { originalType, savedConfig: {} };
        this.inputPorts = [{ id: 'in', label: 'In', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    getCanvasDetail() {
        return this.config.originalType || 'unknown type';
    }

    validate() {
        return {
            valid: true,
            message: ''
        };
    }

    async execute() {
        const t = this.config.originalType || 'unknown';
        throw new Error(`Unknown node type "${t}" — replace or remove this node.`);
    }

    toJSON() {
        const json = {
            id: this.id,
            type: this.config.originalType || UNKNOWN_PLACEHOLDER_NODE_TYPE,
            position: { ...this.position },
            config: JSON.parse(JSON.stringify(this.config.savedConfig || {}))
        };
        if (this.comment) json.comment = this.comment;
        return json;
    }
}
