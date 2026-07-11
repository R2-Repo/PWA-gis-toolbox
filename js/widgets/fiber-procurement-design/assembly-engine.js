/**
 * Design assemblies — reusable conduit/fiber configuration templates.
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { createConduitComponent } from './design-model.js';

/**
 * @param {object} input
 * @returns {object}
 */
export function createDesignAssembly(input = {}) {
    return {
        assemblyId: input.assemblyId || createStableId('asm'),
        assemblyName: input.assemblyName || 'Custom assembly',
        description: input.description || '',
        installationMethod: input.installationMethod || 'directional_bore',
        surfaceType: input.surfaceType || '',
        existingOrProposed: input.existingOrProposed || 'proposed',
        wasteFactor: input.wasteFactor ?? null,
        slackFactor: input.slackFactor ?? null,
        conduitComponents: Array.isArray(input.conduitComponents) ? [...input.conduitComponents] : [],
        catalogItemIds: Array.isArray(input.catalogItemIds) ? [...input.catalogItemIds] : [],
        catalogMatchers: Array.isArray(input.catalogMatchers) ? [...input.catalogMatchers] : [],
        symbolKey: input.symbolKey || 'conduit-proposed',
        isBuiltIn: !!input.isBuiltIn,
        isFavorite: !!input.isFavorite,
        active: input.active !== false,
        notes: input.notes || ''
    };
}

export const BUILT_IN_ASSEMBLIES = [
    createDesignAssembly({
        assemblyId: 'asm-standard-road-bore',
        assemblyName: 'Standard Road Bore',
        description: 'Directional bore with two 2-inch HDPE ducts, tracer wire, and pull tape.',
        installationMethod: 'directional_bore',
        wasteFactor: 0.05,
        isBuiltIn: true,
        catalogMatchers: [
            { pattern: 'directional bore', role: 'installation' },
            { pattern: '2-inch hdpe', role: 'conduit' },
            { pattern: 'tracer wire', role: 'conduit' },
            { pattern: 'pull tape', role: 'conduit' }
        ],
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 2, lengthMultiplier: 1 },
            { productType: 'Tracer Wire', diameter: '', ductCount: 1, lengthMultiplier: 1 },
            { productType: 'Pull Tape', diameter: '', ductCount: 1, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-open-trench-lateral',
        assemblyName: 'Open Trench Lateral',
        description: 'Open trench with one 2-inch HDPE duct.',
        installationMethod: 'open_trench',
        wasteFactor: 0.08,
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 1, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-existing-conduit-pull',
        assemblyName: 'Existing Conduit Fiber Pull',
        description: 'Fiber pull through existing conduit without new bore.',
        installationMethod: 'existing_conduit',
        existingOrProposed: 'existing',
        isBuiltIn: true,
        conduitComponents: []
    }),
    createDesignAssembly({
        assemblyId: 'asm-aerial-installation',
        assemblyName: 'Aerial Installation',
        description: 'Aerial strand with two 1.25-inch ducts.',
        installationMethod: 'aerial',
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '1.25-inch', ductCount: 2, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-building-entrance',
        assemblyName: 'Building Entrance',
        description: 'Short building entrance with one 2-inch duct.',
        installationMethod: 'open_trench',
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 1, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-standard-vault-splice',
        assemblyName: 'Standard Vault with Splice',
        description: 'Vault structure preset for splice locations.',
        installationMethod: 'directional_bore',
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 2, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-emergency-repair',
        assemblyName: 'Emergency Repair',
        description: 'Open trench repair with single duct and higher waste factor.',
        installationMethod: 'open_trench',
        wasteFactor: 0.15,
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 1, lengthMultiplier: 1 }
        ]
    }),
    createDesignAssembly({
        assemblyId: 'asm-temporary-bypass',
        assemblyName: 'Temporary Bypass',
        description: 'Temporary surface-laid conduit bypass.',
        installationMethod: 'temporary',
        wasteFactor: 0.1,
        isBuiltIn: true,
        conduitComponents: [
            { productType: 'HDPE', diameter: '2-inch', ductCount: 1, lengthMultiplier: 1 }
        ]
    })
];

/**
 * @param {object[]} catalogItems
 * @param {object} assembly
 * @returns {object}
 */
export function resolveAssemblyCatalogItems(catalogItems = [], assembly = {}) {
    const resolvedIds = [...(assembly.catalogItemIds || [])];

    for (const matcher of assembly.catalogMatchers || []) {
        const pattern = String(matcher.pattern || '').toLowerCase();
        const item = catalogItems.find((entry) =>
            String(entry.description || '').toLowerCase().includes(pattern) ||
            String(entry.productType || '').toLowerCase().includes(pattern) ||
            String(entry.installationMethod || '').toLowerCase().includes(pattern)
        );
        if (item && !resolvedIds.includes(item.catalogItemId)) {
            resolvedIds.push(item.catalogItemId);
        }
    }

    return {
        ...assembly,
        catalogItemIds: resolvedIds
    };
}

/**
 * @param {object} design
 * @returns {object[]}
 */
export function listAvailableAssemblies(design = {}) {
    const custom = (design.assemblies || []).filter((assembly) => !assembly.isBuiltIn);
    const builtIn = BUILT_IN_ASSEMBLIES.map((assembly) => {
        const saved = (design.assemblies || []).find((entry) => entry.assemblyId === assembly.assemblyId);
        return {
            ...assembly,
            isFavorite: saved?.isFavorite ?? assembly.isFavorite
        };
    });
    return [...builtIn, ...custom];
}

/**
 * @param {object} design
 * @param {string} assemblyId
 * @returns {object|null}
 */
export function getAssemblyById(design, assemblyId) {
    if (!assemblyId) return null;
    return listAvailableAssemblies(design).find((assembly) => assembly.assemblyId === assemblyId) || null;
}

/**
 * @param {object} project
 * @param {object} design
 * @returns {object|null}
 */
export function getActiveAssembly(project, design) {
    return getAssemblyById(design, project?.activeAssemblyId);
}

/**
 * @param {object} assembly
 * @param {object} project
 * @param {object[]} [catalogItems]
 * @returns {object}
 */
export function expandAssemblyToSegmentDefaults(assembly, project = {}, catalogItems = []) {
    if (!assembly) {
        return {
            installationMethod: project.defaultInstallationMethod || 'directional_bore',
            existingOrProposed: project.defaultStatus || 'proposed',
            conduitComponents: [
                createConduitComponent({ productType: 'HDPE', diameter: '2-inch', ductCount: 2 })
            ],
            procurementItemIds: [],
            assemblyId: ''
        };
    }

    const resolved = resolveAssemblyCatalogItems(catalogItems, assembly);
    const components = (assembly.conduitComponents || []).map((component) => {
        const catalogItem = catalogItems.find((item) =>
            component.catalogItemId && item.catalogItemId === component.catalogItemId
        ) || catalogItems.find((item) =>
            component.productType &&
            String(item.description || '').toLowerCase().includes(String(component.productType).toLowerCase())
        );

        return createConduitComponent({
            ...component,
            catalogItemId: catalogItem?.catalogItemId || component.catalogItemId || '',
            wasteFactor: component.wasteFactor ?? assembly.wasteFactor ?? project.defaultWasteFactor
        });
    });

    return {
        installationMethod: assembly.installationMethod || project.defaultInstallationMethod,
        surfaceType: assembly.surfaceType || '',
        existingOrProposed: assembly.existingOrProposed || project.defaultStatus || 'proposed',
        conduitComponents: components,
        procurementItemIds: resolved.catalogItemIds,
        assemblyId: assembly.assemblyId,
        symbolKey: assembly.symbolKey || 'conduit-proposed'
    };
}

/**
 * @param {object} segment
 * @param {object} defaults
 * @returns {object}
 */
export function applyAssemblyDefaultsToSegment(segment, defaults = {}) {
    return {
        ...segment,
        installationMethod: defaults.installationMethod ?? segment.installationMethod,
        surfaceType: defaults.surfaceType ?? segment.surfaceType,
        existingOrProposed: defaults.existingOrProposed ?? segment.existingOrProposed,
        assemblyId: defaults.assemblyId || segment.assemblyId || '',
        procurementItemIds: defaults.procurementItemIds?.length
            ? [...defaults.procurementItemIds]
            : [...(segment.procurementItemIds || [])],
        conduitComponents: (defaults.conduitComponents || segment.conduitComponents || []).map((component) =>
            createConduitComponent({
                ...component,
                parentSegmentId: segment.segmentId
            })
        ),
        symbolKey: defaults.symbolKey || segment.symbolKey
    };
}

/**
 * @param {object} design
 * @param {object} assemblyInput
 * @returns {object[]}
 */
export function saveProjectAssembly(design, assemblyInput = {}) {
    const assembly = createDesignAssembly({
        ...assemblyInput,
        isBuiltIn: false
    });
    const assemblies = [
        ...(design.assemblies || []).filter((entry) => entry.assemblyId !== assembly.assemblyId),
        assembly
    ];
    return assemblies;
}

/**
 * @param {object} design
 * @param {string} assemblyId
 * @param {boolean} favorite
 * @returns {object[]}
 */
export function toggleAssemblyFavorite(design, assemblyId, favorite = true) {
    const builtIn = BUILT_IN_ASSEMBLIES.some((assembly) => assembly.assemblyId === assemblyId);
    const assemblies = [...(design.assemblies || [])];
    const index = assemblies.findIndex((entry) => entry.assemblyId === assemblyId);

    if (index >= 0) {
        assemblies[index] = { ...assemblies[index], isFavorite: favorite };
    } else if (builtIn) {
        const template = BUILT_IN_ASSEMBLIES.find((assembly) => assembly.assemblyId === assemblyId);
        assemblies.push({ ...template, isFavorite: favorite });
    }

    return assemblies;
}

/**
 * @param {object} design
 * @returns {object[]}
 */
export function listFavoriteAssemblies(design = {}) {
    return listAvailableAssemblies(design).filter((assembly) => assembly.isFavorite);
}
