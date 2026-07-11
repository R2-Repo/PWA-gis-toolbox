import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { createStableId, resetIdSequence } from '../js/plan-project/id-utils.js';
import { createPlanProject, validatePlanProject } from '../js/plan-project/plan-project-model.js';
import { linkParentChild, validateRelationships } from '../js/plan-project/relationship-model.js';
import { serializePlanProject, restorePlanProject } from '../js/plan-project/serialization.js';
import { createRevisionSnapshot } from '../js/plan-project/revision-snapshot.js';
import { resolveInheritedValue, INHERITANCE_SOURCES } from '../js/plan-project/inheritance.js';
import { renderLabelTemplate } from '../js/plan-project/symbology-registry.js';
import { formatStation } from '../js/plan-project/stationing-adapter.js';

globalThis.turf = turf;

describe('plan project foundation', () => {
    beforeEach(() => resetIdSequence());

    it('creates stable IDs with prefix', () => {
        const id = createStableId('proj');
        expect(id.startsWith('proj_')).toBe(true);
    });

    it('creates and validates a plan project', () => {
        const project = createPlanProject({ projectName: 'Test Project' });
        const validation = validatePlanProject(project);
        expect(validation.valid).toBe(true);
        expect(project.defaultSlackFactor).toBe(0.03);
    });

    it('serializes and restores a project bundle', () => {
        const project = createPlanProject({ projectName: 'Restore Test' });
        const bundle = serializePlanProject(project, { design: { alignments: [] } });
        const restored = restorePlanProject(bundle);
        expect(restored.ok).toBe(true);
        expect(restored.project.projectName).toBe('Restore Test');
    });

    it('tracks parent-child relationships', () => {
        const { relationships, relationship } = linkParentChild([], 'parent', 'child');
        expect(relationship.parentId).toBe('parent');
        expect(relationships).toHaveLength(1);
        const validation = validateRelationships(relationships, { parent: {}, child: {} });
        expect(validation.valid).toBe(true);
    });

    it('creates revision snapshots', () => {
        const project = createPlanProject({ projectName: 'Revision Test', revision: '1' });
        const snapshot = createRevisionSnapshot({ project, design: { alignments: [{ id: 1 }] } });
        expect(snapshot.snapshotId).toBeTruthy();
        expect(snapshot.bundle.project.projectName).toBe('Revision Test');
    });

    it('resolves inheritance with manual override winning', () => {
        const inherited = resolveInheritedValue({
            manualOverride: 'Manual',
            parentValue: 'Parent',
            projectDefault: 'Default'
        });
        expect(inherited.value).toBe('Manual');
        expect(inherited.source).toBe(INHERITANCE_SOURCES.MANUAL_OVERRIDE);
    });

    it('renders label templates without broken placeholders', () => {
        const label = renderLabelTemplate('{ductCount} × {diameter} {productType}', {
            ductCount: 2,
            diameter: '2-inch',
            productType: 'HDPE'
        });
        expect(label).toBe('2 × 2-inch HDPE');
    });

    it('formats station labels', () => {
        expect(formatStation(81715)).toBe('817+15');
    });
});
