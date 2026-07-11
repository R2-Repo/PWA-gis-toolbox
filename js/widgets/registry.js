import { openSpatialAnalyzer } from './spatial-analyzer/controller.js';
import { openBulkUpdate } from './bulk-update/controller.js';
import { openProximityJoin } from './proximity-join/controller.js';
import { openRouteMilepostSegment } from './route-milepost-segment/controller.js';
import { openProjectStationing } from './project-stationing/controller.js';
import { openLayerMatchAssistant } from './layer-match-assistant/controller.js';
import { openFiberProcurementDesign } from './fiber-procurement-design/controller.js';
import { openPlanSetCallouts } from './plan-set-callouts/controller.js';
import { openSheetCutting } from './sheet-cutting/controller.js';
import { openPlanProductionExport } from './plan-production-export/controller.js';
import { openFiberSlackOtdrHelper } from './fiber-slack-otdr-helper/controller.js';
import { openCrsManager } from './crs-manager/controller.js';
import { openQuery } from './query/controller.js';
import { openWirelessSitePlanning } from './wireless-site-planning/controller.js';
import { openPresentationLinkBuilder } from './presentation-link-builder/controller.js';
import { openCalloutBuilder } from './callout-builder/controller.js';
import logger from '../core/logger.js';

/** @typedef {import('./widget-types.js').WidgetContext} WidgetContext */

/**
 * Widgets shown in the GIS Widgets panel (`react/panels/WidgetPanel.jsx`).
 * To re-enable a hidden widget, move its entry from `GIS_WIDGETS_HIDDEN` into this array.
 */
export const GIS_WIDGETS = [
    {
        type: 'spatial-analyzer',
        action: 'openSpatialAnalyzer',
        label: 'Find Features in Area',
        icon: '🔎',
        tip: 'Search for features from one layer that fall inside a drawn area or polygon layer.',
        open: openSpatialAnalyzer
    },
    {
        type: 'bulk-update',
        action: 'openBulkUpdate',
        label: 'Bulk Update',
        icon: '✏️',
        tip: 'Select multiple features and update their attribute fields in bulk.',
        open: openBulkUpdate
    },
    {
        type: 'proximity-join',
        action: 'openProximityJoin',
        label: 'Proximity Join',
        icon: '↔️',
        tip: 'Copy attributes from the nearest feature in a target layer to each source feature.',
        open: openProximityJoin
    },
    {
        type: 'route-milepost-segment',
        action: 'openRouteMilepostSegment',
        label: 'Route Centerline',
        icon: '🛣️',
        tip: 'Build a road centerline between two UDOT mileposts.',
        open: openRouteMilepostSegment
    },
    {
        type: 'project-stationing',
        action: 'openProjectStationing',
        label: 'Project Stationing',
        icon: '📐',
        tip: 'Generate 100-ft project station segments along a UDOT route centerline.',
        open: openProjectStationing
    },
    {
        type: 'layer-match-assistant',
        action: 'openLayerMatchAssistant',
        label: 'Layer Match Assistant',
        icon: '🔗',
        tip: 'Compare two layers using location and fuzzy name matching; review and export matched and unmatched results.',
        open: openLayerMatchAssistant
    },
    {
        type: 'fiber-procurement-design',
        action: 'openFiberProcurementDesign',
        label: 'Fiber Procurement Design',
        icon: '🧵',
        tip: 'Design fiber infrastructure, generate conduit segments, route fiber, and calculate procurement quantities.',
        open: openFiberProcurementDesign
    },
    {
        type: 'plan-set-callouts',
        action: 'openPlanSetCallouts',
        label: 'Plan Set Callouts',
        icon: '🔺',
        tip: 'Manage callout definitions, rules, and automated feature assignments for plan sets.',
        open: openPlanSetCallouts
    },
    {
        type: 'sheet-cutting',
        action: 'openSheetCutting',
        label: 'Sheet Cutting',
        icon: '📄',
        tip: 'Generate plan sheet frames along a route with match lines and overview layout.',
        open: openSheetCutting
    },
    {
        type: 'callout-builder',
        action: 'openCalloutBuilder',
        label: 'Callout Builder',
        icon: '🔢',
        tip: 'Create numbered callouts, leader lines, and legends from feature attributes.',
        open: openCalloutBuilder
    },
    {
        type: 'plan-production-export',
        action: 'openPlanProductionExport',
        label: 'Plan Production Export',
        icon: '📦',
        tip: 'Run plan readiness checks and export a professional procurement or plan set package.',
        open: openPlanProductionExport
    }
];

/**
 * Implemented but not shown in the UI. See docs/CRS_MANAGER.md.
 * @type {typeof GIS_WIDGETS}
 */
export const GIS_WIDGETS_HIDDEN = [
    {
        type: 'query',
        action: 'openQuery',
        label: 'Query Features',
        icon: '🔍',
        tip: 'Find features by attribute values and highlight, zoom, or select results on the map.',
        open: openQuery
    },
    {
        type: 'crs-manager',
        action: 'openCrsManager',
        label: 'CRS Manager',
        icon: '🌐',
        tip: 'Audit layer coordinate systems, batch reproject to WGS 84, register custom WKT.',
        open: openCrsManager
    },
    {
        type: 'wireless-site-planning',
        action: 'openWirelessSitePlanning',
        label: 'Wireless Site Planning',
        icon: '📡',
        tip: 'Plan wireless pole locations, antenna sectors, and coverage areas.',
        open: openWirelessSitePlanning
    },
    {
        type: 'fiber-slack-otdr-helper',
        action: 'openFiberSlackOtdrHelper',
        label: 'Fiber Slack / OTDR Helper',
        icon: '🔌',
        tip: 'Estimate OTDR distance, fiber slack, and map distance along line routes.',
        open: openFiberSlackOtdrHelper
    },
    {
        type: 'presentation-link-builder',
        action: 'openPresentationLinkBuilder',
        label: 'Presentation Link',
        icon: '🔗',
        tip: 'Build a fullscreen presentation URL from selected map features.',
        open: openPresentationLinkBuilder
    }
];

/** All registered widgets (visible + hidden). */
export const ALL_GIS_WIDGETS = [...GIS_WIDGETS, ...GIS_WIDGETS_HIDDEN];

/**
 * Build APP_ACTIONS entries for visible widgets only.
 * @param {() => WidgetContext} getCtx
 * @returns {Record<string, () => void>}
 */
export function buildWidgetActions(getCtx) {
    const actions = {};
    for (const widget of GIS_WIDGETS) {
        actions[widget.action] = () => {
            logger.info('Widget', 'Open', { type: widget.type, label: widget.label });
            widget.open(getCtx());
        };
    }
    return actions;
}

/**
 * @param {string} type
 * @param {WidgetContext} ctx
 * @param {object} [options]
 */
export function openWidget(type, ctx, options = {}) {
    const widget = ALL_GIS_WIDGETS.find((entry) => entry.type === type);
    if (!widget) {
        logger.warn('Widget', 'Unknown widget type', { type });
        return;
    }
    logger.info('Widget', 'Open', { type: widget.type, label: widget.label });
    widget.open(ctx, options);
}
