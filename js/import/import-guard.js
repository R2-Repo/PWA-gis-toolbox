/**
 * Unified pre-import guard — size checks and memory budget before heavy parse work.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { preflightFiles } from './import-preflight.js';
import { decideAdmission } from './import-admission.js';
import { detectFormat } from './importer.js';
import {
    checkEstimatedMemoryBudget,
    checkExistingLayerMemory,
    IMPORT_GUARD_VERSION
} from './import-memory-budget.js';
import { classifyImportFiles } from './import-policy.js';

/**
 * @param {File[]} files
 * @param {{
 *   getLayers?: () => Array,
 *   source?: string,
 *   skipMemoryBudget?: boolean,
 *   platform?: import('../platform/contracts.js').PlatformInfo|null
 * }} [options]
 * @returns {Promise<{ cancelled: boolean, check: ReturnType<typeof preflightFiles>, guardVersion: string, admission: ReturnType<typeof decideAdmission> }>}
 */
export async function guardFilesBeforeImport(files, options = {}) {
    const { memoryFiles } = classifyImportFiles(files);

    const layerBudget = checkExistingLayerMemory(options.getLayers);
    if (!layerBudget.ok) {
        throw new AppError(
            layerBudget.message,
            ErrorCategory.OUT_OF_MEMORY,
            { source: options.source, guardVersion: IMPORT_GUARD_VERSION }
        );
    }

    if (!memoryFiles.length) {
        return {
            cancelled: false,
            check: { reject: false, messages: [], level: 'ok', files: [] },
            guardVersion: IMPORT_GUARD_VERSION,
            admission: decideAdmission({ entry: 'file', files: [] })
        };
    }

    const check = preflightFiles(memoryFiles);

    const admission = decideAdmission({
        entry: 'file',
        files: memoryFiles.map((file) => ({
            name: file.name,
            format: detectFormat(file),
            bytes: file.size ?? 0
        })),
        overPreflightReject: check.reject
    });

    if (check.reject && admission.route === 'refused') {
        throw new AppError(
            admission.refusedMessage || check.messages.join(' '),
            ErrorCategory.OUT_OF_MEMORY,
            { files: check.files, source: options.source, guardVersion: IMPORT_GUARD_VERSION, admission }
        );
    }

    if (check.reject && admission.route === 'streamed') {
        return { cancelled: false, check, guardVersion: IMPORT_GUARD_VERSION, admission };
    }

    if (!options.skipMemoryBudget) {
        const budget = await checkEstimatedMemoryBudget(memoryFiles);
        if (!budget.ok) {
            throw new AppError(
                budget.message,
                ErrorCategory.OUT_OF_MEMORY,
                { files: check.files, source: options.source, guardVersion: IMPORT_GUARD_VERSION }
            );
        }
    }

    return { cancelled: false, check, guardVersion: IMPORT_GUARD_VERSION, admission };
}

export default { guardFilesBeforeImport };
