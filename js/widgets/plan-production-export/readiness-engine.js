/**
 * Aggregated plan readiness checks across plan-production widgets.
 */

import { validatePlanProject } from '../../plan-project/plan-project-model.js';
import { runDesignReadinessCheck } from '../fiber-procurement-design/validation-engine.js';
import { validateCalloutSession } from '../plan-set-callouts/engine.js';
import { validateSheetSession } from '../sheet-cutting/engine.js';

const WIDGET_LABELS = {
    'fiber-procurement-design': 'Fiber Procurement Design',
    'plan-set-callouts': 'Plan Set Callouts',
    'sheet-cutting': 'Sheet Cutter'
};

/**
 * @param {object} finding
 * @param {string} widget
 * @returns {object}
 */
function tagFinding(finding, widget) {
    return {
        ...finding,
        widget,
        widgetLabel: WIDGET_LABELS[widget] || widget
    };
}

/**
 * @param {object} assembly
 * @returns {object[]}
 */
export function runCrossWidgetConsistencyChecks(assembly = {}) {
    const findings = [];
    const projectNames = new Set();
    const projectNumbers = new Set();

    for (const [key, session] of [
        ['fiber-procurement-design', assembly.fiberSession],
        ['plan-set-callouts', assembly.calloutSession],
        ['sheet-cutting', assembly.sheetSession]
    ]) {
        if (!session?.project) continue;
        if (session.project.projectName) projectNames.add(session.project.projectName);
        if (session.project.projectNumber) projectNumbers.add(session.project.projectNumber);
    }

    if (projectNames.size > 1) {
        findings.push({
            severity: 'warning',
            code: 'project_name_mismatch',
            message: `Project names differ across widgets: ${[...projectNames].join(', ')}`,
            step: 'Project',
            widget: 'plan-production'
        });
    }

    if (projectNumbers.size > 1) {
        findings.push({
            severity: 'warning',
            code: 'project_number_mismatch',
            message: `Project numbers differ across widgets: ${[...projectNumbers].join(', ')}`,
            step: 'Project',
            widget: 'plan-production'
        });
    }

    const calloutPlacements = assembly.calloutSession?.callouts?.sheetPlacements || [];
    const sheetCount = assembly.sheetSession?.sheets?.sheets?.length || 0;
    if (calloutPlacements.length && !sheetCount) {
        findings.push({
            severity: 'error',
            code: 'callouts_without_sheets',
            message: 'Sheet-aware callout placements exist but no sheet set is linked.',
            step: 'Integration',
            widget: 'plan-production'
        });
    }

    const designAlignmentCount = assembly.fiberSession?.design?.alignments?.length || 0;
    if (sheetCount > 0 && !designAlignmentCount) {
        findings.push({
            severity: 'warning',
            code: 'sheets_without_design',
            message: 'Sheet set exists without a fiber design alignment.',
            step: 'Integration',
            widget: 'plan-production'
        });
    }

    const fiberRoute = assembly.fiberSession?.stationingRoute?.layerId || assembly.fiberSession?.project?.stationingRouteLayerId;
    const sheetRoute = assembly.sheetSession?.stationingRoute?.layerId || assembly.sheetSession?.project?.stationingRouteLayerId;
    if (fiberRoute && sheetRoute && fiberRoute !== sheetRoute) {
        findings.push({
            severity: 'warning',
            code: 'route_source_mismatch',
            message: 'Fiber design and sheet cutting use different stationing route layers.',
            step: 'Integration',
            widget: 'plan-production'
        });
    }

    return findings;
}

/**
 * @param {object[]} findings
 * @returns {number}
 */
export function calculateReadinessScore(findings = []) {
    if (!findings.length) return 100;

    let penalty = 0;
    for (const finding of findings) {
        if (finding.severity === 'error') penalty += 15;
        else if (finding.severity === 'warning') penalty += 5;
        else penalty += 1;
    }

    return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * @param {object} assembly
 * @returns {{ valid: boolean, score: number, errors: string[], warnings: string[], findings: object[], summary: object }}
 */
export function runPlanReadinessCheck(assembly = {}) {
    const findings = [];

    const project = assembly.project || assembly.fiberSession?.project || assembly.calloutSession?.project;
    if (project) {
        const projectValidation = validatePlanProject(project);
        for (const message of projectValidation.errors || []) {
            findings.push(tagFinding({
                severity: 'error',
                code: 'invalid_project',
                message,
                step: 'Project'
            }, 'plan-production'));
        }
    } else {
        findings.push(tagFinding({
            severity: 'error',
            code: 'missing_project',
            message: 'No plan project found in linked widget sessions.',
            step: 'Project'
        }, 'plan-production'));
    }

    if (assembly.fiberSession) {
        for (const finding of runDesignReadinessCheck(assembly.fiberSession)) {
            findings.push(tagFinding(finding, 'fiber-procurement-design'));
        }
    } else {
        findings.push(tagFinding({
            severity: 'warning',
            code: 'missing_fiber_session',
            message: 'Fiber Procurement Design session not found.',
            step: 'Design'
        }, 'fiber-procurement-design'));
    }

    if (assembly.calloutSession) {
        const calloutValidation = validateCalloutSession(assembly.calloutSession);
        for (const finding of calloutValidation.findings || []) {
            findings.push(tagFinding(finding, 'plan-set-callouts'));
        }
    } else {
        findings.push(tagFinding({
            severity: 'info',
            code: 'missing_callout_session',
            message: 'Plan Set Callouts session not linked.',
            step: 'Callouts'
        }, 'plan-set-callouts'));
    }

    if (assembly.sheetSession) {
        const sheetValidation = validateSheetSession(assembly.sheetSession);
        for (const finding of sheetValidation.findings || []) {
            findings.push(tagFinding(finding, 'sheet-cutting'));
        }
    } else {
        findings.push(tagFinding({
            severity: 'info',
            code: 'missing_sheet_session',
            message: 'Sheet Cutter session not linked.',
            step: 'Sheets'
        }, 'sheet-cutting'));
    }

    findings.push(...runCrossWidgetConsistencyChecks(assembly));

    const errors = findings.filter((entry) => entry.severity === 'error').map((entry) => entry.message);
    const warnings = findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.message);
    const score = calculateReadinessScore(findings);

    return {
        valid: errors.length === 0,
        score,
        errors,
        warnings,
        findings,
        summary: {
            errorCount: findings.filter((entry) => entry.severity === 'error').length,
            warningCount: findings.filter((entry) => entry.severity === 'warning').length,
            infoCount: findings.filter((entry) => entry.severity === 'info').length,
            widgetsLinked: {
                fiber: Boolean(assembly.fiberSession),
                callouts: Boolean(assembly.calloutSession),
                sheets: Boolean(assembly.sheetSession)
            }
        }
    };
}

/**
 * @param {object[]} findings
 * @returns {string}
 */
export function buildReadinessReportCsv(findings = []) {
    const rows = [['severity', 'widget', 'step', 'code', 'message']];
    for (const finding of findings) {
        rows.push([
            finding.severity || '',
            finding.widgetLabel || finding.widget || '',
            finding.step || '',
            finding.code || '',
            finding.message || ''
        ]);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
