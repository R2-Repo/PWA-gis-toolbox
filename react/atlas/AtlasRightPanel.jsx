import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { buildChannelSchematic } from '../../js/atlas/schematic.js';
import { getHubChannelSummary } from '../../js/atlas/hierarchy.js';
import {
    buildAtlasReportHtml,
    buildDashboardStats,
    exportDropsCsv,
    exportFindingsCsv,
    exportPingSessionCsv,
    exportTriageCsv,
    openPrintableReport
} from '../../js/atlas/export.js';
import {
    atlasNotify,
    bulkUpdateFindingStatus,
    deleteAtlasPingSession,
    exportAtlasPingSessionFullCsv,
    listAtlasPingSessions,
    loadAtlasPingSession,
    pruneAtlasPingSessions,
    setAtlasPref
} from '../../js/atlas/controller.js';
import {
    defaultAtlasPrefs,
    PREF_DASHBOARD_SCOPE,
    PREF_MONITOR_INTERVAL,
    PREF_PING_COUNT,
    PREF_SESSIONS_RETENTION_DAYS,
    PREF_TRIAGE_MODE
} from '../../js/atlas/prefs.js';
import { formatSessionEndLabel } from '../../js/atlas/export.js';
import { uniqueIps } from '../../js/atlas/clipboard.js';
import { collectHubIps, findingsInScope, listScopedDropsByPing } from '../../js/atlas/triage.js';
import { formatPingAge, formatPingWhen, getPingEntry, isPingStale } from '../../js/atlas/ping-format.js';
import {
    formatAtlasEntityLines,
    formatChannelPrimary,
    formatDropPrimary,
    formatHubTreeLabel
} from '../../js/atlas/display-label.js';
import { connectedBuildingIps } from '../../js/atlas/import/connected-buildings.js';
import { confirm } from '../../js/ui/modals.js';
import { ChannelSchematic } from './ChannelSchematic.jsx';
import { CopyIp, CopyIpsButton } from './CopyIp.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function DetailHeader({ kind, entity, fallbackPrimary }) {
    const lines = formatAtlasEntityLines(kind, entity);
    const primary = lines.primary || fallbackPrimary || kind;
    const secondary = lines.secondary;
    return (
        <>
            <h4 title={lines.title || primary}>{primary}</h4>
            {secondary ? (
                <p className="atlas-detail-secondary" title={secondary}>{secondary}</p>
            ) : null}
        </>
    );
}

function statusClass(status) {
    return `atlas-finding-sev atlas-finding-sev--${status || 'info'}`;
}

export function AtlasRightPanel({
    canPing,
    onPingChannel,
    onPingDrop,
    onPingHub,
    onSelect,
    onPingSelectedIps,
    onStartMonitor,
    onStopMonitor,
    onUpdateFinding,
    onUpdateFindingNotes,
    onAreaFromDraw,
    onAreaPolygon,
    onClearArea,
    onSelectFinding
}) {
    const initialPrefs = getAtlasSnapshot().prefs || defaultAtlasPrefs();
    const [tick, setTick] = useState(0);
    const [findingFilter, setFindingFilter] = useState('Open');
    const [findingTypeFilter, setFindingTypeFilter] = useState('all');
    const [monitorInterval, setMonitorInterval] = useState(initialPrefs.monitorInterval);
    const [pingCount, setPingCount] = useState(initialPrefs.pingCount ?? 4);
    const [dashScope, setDashScope] = useState(initialPrefs.dashScope);
    const [triageMode, setTriageMode] = useState(initialPrefs.triageMode);
    const [noteDrafts, setNoteDrafts] = useState({});
    const [showAllTriage, setShowAllTriage] = useState(false);
    const [showAllFindings, setShowAllFindings] = useState(false);
    const [showAllArea, setShowAllArea] = useState(false);
    const [focusedFindingId, setFocusedFindingId] = useState(null);
    const [pastSessions, setPastSessions] = useState([]);
    const [historyDetail, setHistoryDetail] = useState(null);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [historyVisible, setHistoryVisible] = useState(40);
    const [historyLoadLimit, setHistoryLoadLimit] = useState(80);

    const openHistorySession = (sessionId, limit = 80) => {
        setHistoryBusy(true);
        setHistoryVisible(40);
        setHistoryLoadLimit(limit);
        void loadAtlasPingSession(sessionId, { limit })
            .then((detail) => setHistoryDetail(detail))
            .catch(() => setHistoryDetail(null))
            .finally(() => setHistoryBusy(false));
    };

    const loadMoreHistory = () => {
        if (!historyDetail?.session?.id) return;
        const loaded = historyDetail.results?.length || 0;
        const total = Number(
            pastSessions.find((s) => s.id === historyDetail.session.id)?.sampleCount
            ?? loaded
        );
        if (historyVisible < loaded) {
            setHistoryVisible((n) => Math.min(n + 40, loaded));
            return;
        }
        if (loaded >= total) return;
        const nextLimit = Math.min(Math.max(historyLoadLimit + 80, loaded + 80), 2000);
        if (nextLimit <= loaded) return;
        setHistoryBusy(true);
        void loadAtlasPingSession(historyDetail.session.id, { limit: nextLimit })
            .then((detail) => {
                setHistoryDetail(detail);
                setHistoryLoadLimit(nextLimit);
                const nextLen = detail.results?.length || 0;
                setHistoryVisible((n) => Math.min(n + 40, nextLen));
            })
            .catch(() => {})
            .finally(() => setHistoryBusy(false));
    };
    /** @type {[Set<string>, function]} */
    const [selectedFindingIds, setSelectedFindingIds] = useState(() => new Set());
    const [bulkBusy, setBulkBusy] = useState(false);

    const changeMonitorInterval = (raw) => {
        const next = Number(raw) || raw;
        setMonitorInterval(next);
        void setAtlasPref(PREF_MONITOR_INTERVAL, next);
    };

    const changePingCount = (raw) => {
        const next = Number(raw) || 4;
        setPingCount(next);
        void setAtlasPref(PREF_PING_COUNT, next);
    };

    const changeDashScope = (scope, { persist = true } = {}) => {
        setDashScope(scope);
        if (persist) void setAtlasPref(PREF_DASHBOARD_SCOPE, scope);
    };

    const changeTriageMode = (mode, { persist = true } = {}) => {
        setTriageMode(mode);
        if (persist) void setAtlasPref(PREF_TRIAGE_MODE, mode);
    };

    const focusFindings = (type = 'all', status = 'Open') => {
        setFindingFilter(status);
        setFindingTypeFilter(type);
        setFocusedFindingId(null);
        requestAnimationFrame(() => {
            document.getElementById('atlas-findings')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
    };

    const focusFinding = (f) => {
        if (!f) return;
        setFindingFilter(f.status || 'Open');
        setFindingTypeFilter(f.findingType || 'all');
        setFocusedFindingId(f.id);
        setShowAllFindings(true);
        onSelectFinding?.(f);
        requestAnimationFrame(() => {
            document.getElementById('atlas-findings')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
            document.getElementById(`atlas-finding-${f.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
    };

    const focusTriage = (mode) => {
        changeTriageMode(mode, { persist: true });
        requestAnimationFrame(() => {
            document.getElementById('atlas-triage')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
    };

    const refreshPastSessions = () => {
        void listAtlasPingSessions({ limit: 40 })
            .then((sessions) => setPastSessions(sessions || []))
            .catch(() => setPastSessions([]));
    };

    useEffect(() => {
        const applyPrefs = (prefs) => {
            if (!prefs) return;
            setMonitorInterval(prefs.monitorInterval);
            setPingCount(prefs.pingCount ?? 4);
            setTriageMode(prefs.triageMode);
            if (!getAtlasSnapshot().selection) {
                setDashScope(prefs.dashScope);
            }
        };
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', (sel) => {
                if (sel) changeDashScope('selection', { persist: false });
                else {
                    const scope = getAtlasSnapshot().prefs?.dashScope || 'network';
                    changeDashScope(scope, { persist: false });
                }
                setTick((t) => t + 1);
            }),
            bus.on('atlas:ping', () => setTick((t) => t + 1)),
            bus.on('atlas:ping-sessions', () => refreshPastSessions()),
            bus.on('atlas:prefs', applyPrefs),
            bus.on('atlas:opened', () => {
                applyPrefs(getAtlasSnapshot().prefs);
                refreshPastSessions();
            })
        ];
        applyPrefs(getAtlasSnapshot().prefs);
        refreshPastSessions();
        return () => unsub.forEach((u) => u?.());
    }, []);

    const snap = useMemo(() => getAtlasSnapshot(), [tick]);
    const stats = useMemo(
        () => buildDashboardStats(snap, { scope: dashScope }),
        [snap, tick, dashScope]
    );
    const selection = snap.selection;

    const schematic = useMemo(() => {
        if (selection?.kind === 'channel') return buildChannelSchematic(selection.id);
        if (selection?.kind === 'drop') {
            const drop = snap.drops.find((d) => d.id === selection.id);
            if (drop?.channelId) return buildChannelSchematic(drop.channelId);
        }
        return null;
    }, [selection, snap, tick]);

    const hubSummary = useMemo(() => {
        if (selection?.kind !== 'hub') return null;
        return getHubChannelSummary(selection.id);
    }, [selection, tick]);

    const dropDetail = useMemo(() => {
        if (selection?.kind !== 'drop') return null;
        return snap.drops.find((d) => d.id === selection.id) || null;
    }, [selection, snap, tick]);

    const deviceDetail = useMemo(() => {
        if (selection?.kind !== 'device') return null;
        return snap.devices.find((d) => d.id === selection.id) || null;
    }, [selection, snap, tick]);

    const siteDetail = useMemo(() => {
        if (selection?.kind !== 'site') return null;
        return snap.sites.find((s) => s.id === selection.id) || null;
    }, [selection, snap, tick]);

    const buildingDetail = useMemo(() => {
        if (selection?.kind !== 'building') return null;
        return (snap.connectedBuildings || []).find((b) => b.id === selection.id) || null;
    }, [selection, snap, tick]);

    const buildingIps = useMemo(
        () => (buildingDetail ? connectedBuildingIps(buildingDetail) : []),
        [buildingDetail]
    );

    const siteDrops = useMemo(() => {
        if (!siteDetail) return [];
        return (snap.drops || []).filter((d) => d.siteId === siteDetail.id);
    }, [siteDetail, snap, tick]);

    const scopedFindings = useMemo(
        () => findingsInScope(snap, dashScope),
        [snap, tick, dashScope]
    );

    const findingTypes = useMemo(() => {
        const set = new Set(scopedFindings.map((f) => f.findingType).filter(Boolean));
        return [...set].sort();
    }, [scopedFindings]);

    const findings = useMemo(() => {
        let list = scopedFindings;
        if (findingFilter !== 'all') list = list.filter((f) => f.status === findingFilter);
        if (findingTypeFilter !== 'all') list = list.filter((f) => f.findingType === findingTypeFilter);
        return list;
    }, [scopedFindings, findingFilter, findingTypeFilter]);

    const visibleFindings = useMemo(
        () => (showAllFindings ? findings : findings.slice(0, 100)),
        [findings, showAllFindings]
    );

    const selectedFindingIps = useMemo(() => {
        const rows = findings.filter((f) => selectedFindingIds.has(f.id));
        return uniqueIps(rows.map((f) => f.ip));
    }, [findings, selectedFindingIds]);

    const toggleFindingSelected = (id) => {
        setSelectedFindingIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllVisibleFindings = () => {
        setSelectedFindingIds(new Set(visibleFindings.map((f) => f.id)));
    };

    const selectAllFilteredFindings = () => {
        setSelectedFindingIds(new Set(findings.map((f) => f.id)));
        if (findings.length > 100) setShowAllFindings(true);
    };

    const clearFindingSelection = () => setSelectedFindingIds(new Set());

    const isEmptyDb = snap.loaded
        && !(snap.hubs?.length || snap.channels?.length || snap.drops?.length);

    const applyBulkFindingStatus = (status) => {
        const ids = [...selectedFindingIds].filter((id) => findings.some((f) => f.id === id));
        if (!ids.length) return;
        const run = () => {
            setBulkBusy(true);
            void bulkUpdateFindingStatus(ids, status)
                .then(() => clearFindingSelection())
                .finally(() => setBulkBusy(false));
        };
        if (ids.length >= 10) {
            void confirm(
                `Mark ${ids.length} findings`,
                `Set status of ${ids.length} selected finding(s) to “${status}”?`
            ).then((ok) => {
                if (ok) run();
            });
            return;
        }
        run();
    };

    const area = snap.areaResults;

    const triageRows = useMemo(
        () => listScopedDropsByPing(snap, { scope: dashScope, mode: triageMode }),
        [snap, tick, dashScope, triageMode]
    );

    const monitorTail = useMemo(() => {
        const log = snap.activeSession?.log || [];
        return log.slice(-8).reverse();
    }, [snap.activeSession, tick]);

    const dropPing = dropDetail?.ip ? snap.pingResults?.[dropDetail.ip] : null;
    const devicePing = deviceDetail?.ip ? snap.pingResults?.[deviceDetail.ip] : null;

    return (
        <div className="atlas-panel atlas-panel-right">
            <CollapsibleSection title="Dashboard" bodyId="atlas-dash" defaultOpen={false}>
                {isEmptyDb ? (
                    <div className="atlas-empty-cta">
                        <p><strong>No network data yet</strong></p>
                        <p className="atlas-muted">Import FiberSwitchLocation + ATMS from the left panel to populate the dashboard.</p>
                    </div>
                ) : null}
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'network' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => changeDashScope('network')}
                        title="Default scope when nothing is selected (saved)"
                    >
                        Network
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'selection' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => changeDashScope('selection')}
                        disabled={!selection && !snap.areaResults}
                        title="Scope to selected hub/channel/drop or area results (saved as default)"
                    >
                        Selection{stats.scopeLabel && stats.scopeLabel !== 'Network' ? ` (${stats.scopeLabel})` : ''}
                    </button>
                </div>
                <div className="atlas-dash-grid">
                    <div className="atlas-dash-card"><span>Hubs</span><strong>{stats.hubs}</strong></div>
                    <div className="atlas-dash-card"><span>Channels</span><strong>{stats.channels}</strong></div>
                    <div className="atlas-dash-card"><span>Drops</span><strong>{stats.drops}</strong></div>
                    <div className="atlas-dash-card"><span>Devices</span><strong>{stats.devices}</strong></div>
                    <div className="atlas-dash-card"><span>Wireless drops</span><strong>{stats.wirelessDrops || 0}</strong></div>
                    <div className="atlas-dash-card"><span>Provisional</span><strong>{stats.provisionalDevices || 0}</strong></div>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('all', 'Open')}
                        title="Show open findings"
                    >
                        <span>Open findings</span><strong>{stats.openFindings}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_site_id', 'Open')}
                        title="Filter missing Site IDs"
                    >
                        <span>Missing Site IDs</span><strong>{stats.missingSiteIds}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('duplicate_ip', 'Open')}
                        title="Filter duplicate IPs"
                    >
                        <span>Duplicate IPs</span><strong>{stats.duplicateIps}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('atms_unmatched', 'Open')}
                        title="Filter unmatched ATMS switches"
                    >
                        <span>ATMS unmatched</span><strong>{stats.atmsUnmatched || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('coordinate_disagreement', 'Open')}
                        title="Filter coordinate disagreements"
                    >
                        <span>Coord disagreement</span><strong>{stats.coordinateDisagreement || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('damaged_hub_value', 'Open')}
                        title="Filter damaged hub values"
                    >
                        <span>Damaged hub</span><strong>{stats.damagedHubValue || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('workbook_not_in_atms', 'Open')}
                        title="Filter workbook IPs missing from ATMS"
                    >
                        <span>Not in ATMS</span><strong>{stats.workbookNotInAtms || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_switchfiber', 'Open')}
                        title="Filter TMD without SwitchFiber"
                    >
                        <span>Missing SwitchFiber</span><strong>{stats.missingSwitchfiber || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_channel', 'Open')}
                        title="Filter missing channel"
                    >
                        <span>Missing channel</span><strong>{stats.missingChannel || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_drop', 'Open')}
                        title="Filter missing drop number"
                    >
                        <span>Missing drop</span><strong>{stats.missingDrop || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_secondary_hub', 'Open')}
                        title="Filter missing secondary hub"
                    >
                        <span>Missing sec hub</span><strong>{stats.missingSecondaryHub || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusTriage('unreachable')}
                        title="Open unreachable triage"
                    >
                        <span>Ping up/down</span><strong>{stats.pingReachable}/{stats.pingUnreachable}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusTriage('stale')}
                        title="Open stale triage"
                    >
                        <span>Stale pings</span><strong>{stats.pingStale || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusTriage('untested')}
                        title="Open untested triage"
                    >
                        <span>Untested</span><strong>{stats.pingUntested || 0}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusTriage('attention')}
                        title="Open needs-attention triage"
                    >
                        <span>Needs attention</span><strong>{stats.pingAttention || 0}</strong>
                    </button>
                </div>
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => exportDropsCsv(snap, { scope: dashScope })}
                    >
                        Export drops CSV ({dashScope === 'selection' ? stats.scopeLabel || 'selection' : 'network'})
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openPrintableReport({
                            title: 'ITS Network Atlas Report',
                            bodyHtml: buildAtlasReportHtml(snap, stats, scopedFindings)
                        })}
                    >
                        Printable report
                    </button>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Details & schematic" bodyId="atlas-details" defaultOpen>
                {isEmptyDb ? (
                    <div className="atlas-empty-cta">
                        <p className="atlas-muted">Import network data to inspect hubs, channels, and schematics.</p>
                    </div>
                ) : null}
                {!isEmptyDb && !selection && <p className="atlas-muted">Select a hub, channel, drop, device, or site.</p>}
                {dropDetail && (
                    <div className="atlas-detail-block">
                        <DetailHeader kind="drop" entity={dropDetail} fallbackPrimary={formatDropPrimary(dropDetail.dropNumber)} />
                        <p>{formatChannelPrimary(dropDetail.channelNumber)} · {formatDropPrimary(dropDetail.dropNumber)}</p>
                        <p>IP: <CopyIp ip={dropDetail.ip} /></p>
                        <p>{[dropDetail.manufacturer, dropDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        {dropDetail.wireless ? <p className="atlas-tag">Wireless</p> : null}
                        <p className={dropPing && isPingStale(dropPing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {dropPing?.status || 'untested'}
                            {dropPing?.rttMs != null ? ` · ${dropPing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(dropPing?.at)}
                            {dropPing?.at ? ` (${formatPingWhen(dropPing.at)})` : ''}
                        </p>
                        {dropDetail.ip ? (
                            <div className="atlas-toolbar">
                                <CopyIpsButton ips={[dropDetail.ip]} label="Copy IP" />
                                {canPing ? (
                                    <>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingDrop?.(dropDetail.id)}>Ping once</button>
                                <select
                                    className="input-sm"
                                    value={pingCount}
                                    onChange={(e) => changePingCount(e.target.value)}
                                    title="ICMP packets per ping"
                                >
                                    <option value={1}>1 pkt</option>
                                    <option value={2}>2 pkt</option>
                                    <option value={4}>4 pkt</option>
                                    <option value={8}>8 pkt</option>
                                </select>
                                <select className="input-sm" value={monitorInterval} onChange={(e) => changeMonitorInterval(e.target.value)}>
                                    <option value="continuous">Continuous (~5s)</option>
                                    <option value={1}>Every 1 min</option>
                                    <option value={2}>Every 2 min</option>
                                    <option value={5}>Every 5 min</option>
                                    <option value={30}>Every 30 min</option>
                                    <option value={60}>Every 60 min</option>
                                </select>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={!!snap.activeSession}
                                    title={snap.activeSession ? 'Stop the active monitor first' : 'Start temporary monitoring'}
                                    onClick={() => onStartMonitor?.({ targets: [dropDetail.ip], interval: monitorInterval, label: dropDetail.inventoryName })}
                                >
                                    Start monitor
                                </button>
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                )}
                {deviceDetail && (
                    <div className="atlas-detail-block">
                        <DetailHeader kind="device" entity={deviceDetail} fallbackPrimary={deviceDetail.ip || 'Device'} />
                        <p>{[deviceDetail.deviceType, deviceDetail.manufacturer, deviceDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        <p>IP: <CopyIp ip={deviceDetail.ip} /></p>
                        {deviceDetail.provisional ? <p className="atlas-tag atlas-tag--warn">Provisional</p> : null}
                        {(deviceDetail.gateway || deviceDetail.subnet || deviceDetail.subnetMask) && (
                            <p className="atlas-muted">
                                {deviceDetail.gateway ? <>GW <CopyIp ip={deviceDetail.gateway} />{' · '}</> : null}
                                {deviceDetail.subnet ? `Subnet ${deviceDetail.subnet}` : null}
                                {deviceDetail.subnet && deviceDetail.subnetMask ? ' · ' : null}
                                {deviceDetail.subnetMask ? `Mask ${deviceDetail.subnetMask}` : null}
                            </p>
                        )}
                        {deviceDetail.status && <p className="atlas-muted">Status: {deviceDetail.status}</p>}
                        <p className={devicePing && isPingStale(devicePing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {devicePing?.status || 'untested'}
                            {devicePing?.rttMs != null ? ` · ${devicePing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(devicePing?.at)}
                        </p>
                        {deviceDetail.ip ? (
                            <div className="atlas-toolbar">
                                <CopyIpsButton ips={[deviceDetail.ip]} label="Copy IP" />
                                {canPing ? (
                                    <>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => onPingSelectedIps?.([deviceDetail.ip])}
                                        >
                                            Ping device
                                        </button>
                                        <select className="input-sm" value={monitorInterval} onChange={(e) => changeMonitorInterval(e.target.value)}>
                                            <option value="continuous">Continuous (~5s)</option>
                                            <option value={1}>Every 1 min</option>
                                            <option value={5}>Every 5 min</option>
                                        </select>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            disabled={!!snap.activeSession}
                                            onClick={() => onStartMonitor?.({
                                                targets: [deviceDetail.ip],
                                                interval: monitorInterval,
                                                label: deviceDetail.inventoryName || deviceDetail.ip
                                            })}
                                        >
                                            Start monitor
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                )}
                {siteDetail && (
                    <div className="atlas-detail-block">
                        <DetailHeader kind="site" entity={siteDetail} fallbackPrimary={siteDetail.siteId || 'Site'} />
                        <p>Site ID: {siteDetail.siteId || '—'}</p>
                        <p className="atlas-muted">
                            {[siteDetail.lat, siteDetail.lon].every((n) => n != null)
                                ? `${siteDetail.lat}, ${siteDetail.lon}`
                                : 'No coordinates'}
                        </p>
                        <p><strong>Drops at site:</strong> {siteDrops.length}</p>
                        <ul className="atlas-simple-list">
                            {siteDrops.map((d) => (
                                <li key={d.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'drop', id: d.id })}>
                                        Ch {d.channelNumber || '?'} · D{d.dropNumber ?? '?'}
                                    </button>
                                    {' · '}
                                    <CopyIp ip={d.ip} />
                                    {canPing && d.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(d.id)}>Ping</button>
                                    )}
                                </li>
                            ))}
                            {!siteDrops.length && <li className="atlas-muted">No linked drops.</li>}
                        </ul>
                        {siteDrops.some((d) => d.ip) && (
                            <div className="atlas-toolbar">
                                <CopyIpsButton ips={siteDrops.map((d) => d.ip)} />
                                {canPing ? (
                                    <>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => onPingSelectedIps?.(siteDrops.map((d) => d.ip).filter(Boolean))}
                                        >
                                            Ping site switches
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            disabled={!!snap.activeSession}
                                            onClick={() => onStartMonitor?.({
                                                targets: siteDrops.map((d) => d.ip).filter(Boolean),
                                                interval: monitorInterval,
                                                label: siteDetail.inventoryName || siteDetail.siteId || 'Site'
                                            })}
                                        >
                                            Start monitor
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>
                )}
                {buildingDetail && (
                    <div className="atlas-detail-block">
                        <DetailHeader
                            kind="building"
                            entity={buildingDetail}
                            fallbackPrimary={buildingDetail.buildingName || 'Building'}
                        />
                        <p className="atlas-muted">Connected building</p>
                        {buildingDetail.buildingType ? <p>Type: {buildingDetail.buildingType}</p> : null}
                        {buildingDetail.provider ? <p>Provider: {buildingDetail.provider}</p> : null}
                        {buildingDetail.status ? <p>Status: {buildingDetail.status}</p> : null}
                        {(buildingDetail.fromHub || buildingDetail.toHub) ? (
                            <p>
                                Hubs:{' '}
                                {[buildingDetail.fromHub, buildingDetail.toHub].filter(Boolean).join(' → ') || '—'}
                            </p>
                        ) : null}
                        {buildingDetail.address ? <p>{buildingDetail.address}</p> : null}
                        {buildingDetail.regionId != null && buildingDetail.regionId !== '' ? (
                            <p className="atlas-muted">Region {buildingDetail.regionId}</p>
                        ) : null}
                        <p className="atlas-muted">
                            {[buildingDetail.lat, buildingDetail.lon].every((n) => n != null)
                                ? `${buildingDetail.lat}, ${buildingDetail.lon}`
                                : 'No coordinates'}
                        </p>
                        <p><strong>IPs</strong></p>
                        <ul className="atlas-simple-list">
                            {[
                                ['Switch 1', buildingDetail.switch1Ip],
                                ['Switch 2', buildingDetail.switch2Ip],
                                ['Desktop 1', buildingDetail.desktop1Ip],
                                ['Desktop 2', buildingDetail.desktop2Ip],
                                ['Decoder 1', buildingDetail.decoder1Ip],
                                ['Decoder 2', buildingDetail.decoder2Ip],
                                ['Decoder 3', buildingDetail.decoder3Ip],
                                ['Decoder 4', buildingDetail.decoder4Ip],
                                ['Decoder 5', buildingDetail.decoder5Ip],
                                ['Decoder 6', buildingDetail.decoder6Ip],
                                ['Decoder 7', buildingDetail.decoder7Ip],
                                ['Decoder 8', buildingDetail.decoder8Ip],
                                ['Decoder 9', buildingDetail.decoder9Ip],
                                ['Decoder 10', buildingDetail.decoder10Ip]
                            ].filter(([, ip]) => ip).map(([label, ip]) => (
                                <li key={`${label}-${ip}`}>
                                    <span className="atlas-muted">{label}: </span>
                                    <CopyIp ip={ip} />
                                </li>
                            ))}
                            {!buildingIps.length && <li className="atlas-muted">No IPs listed.</li>}
                        </ul>
                        {buildingIps.length ? (
                            <div className="atlas-toolbar">
                                <CopyIpsButton ips={buildingIps} />
                            </div>
                        ) : null}
                    </div>
                )}
                {hubSummary && (
                    <div className="atlas-detail-block">
                        <DetailHeader
                            kind="hub"
                            entity={hubSummary.hub}
                            fallbackPrimary={formatHubTreeLabel(hubSummary.hub.hubCode)}
                        />
                        <p className="atlas-muted">
                            Hub {hubSummary.hub.hubCode}
                            {hubSummary.hub.regionId != null && hubSummary.hub.regionId !== ''
                                ? ` · Region ${hubSummary.hub.regionId}`
                                : ''}
                        </p>
                        {hubSummary.hub.hubIp ? (
                            <p>Hub IP: <CopyIp ip={hubSummary.hub.hubIp} /></p>
                        ) : (
                            <p className="atlas-muted">No hub IP (add via Hub List import)</p>
                        )}
                        {(() => {
                            const hubPing = getPingEntry(snap.pingResults, hubSummary.hub.hubIp);
                            if (!hubPing) return null;
                            return (
                                <p className={isPingStale(hubPing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                                    Hub ping: {hubPing.status}
                                    {hubPing.rttMs != null ? ` · ${hubPing.rttMs} ms` : ''}
                                    {' · '}
                                    {formatPingAge(hubPing.at)}
                                </p>
                            );
                        })()}
                        {hubSummary.hub.channelsSubnet ? (
                            <p className="atlas-muted">Channels subnet: {hubSummary.hub.channelsSubnet}</p>
                        ) : null}
                        {hubSummary.hub.isShed ? <p className="atlas-tag atlas-tag--warn">Shed</p> : null}
                        {hubSummary.hub.fromOfficialList === false ? (
                            <p className="atlas-tag atlas-tag--warn">Inferred (not in Hub List)</p>
                        ) : null}
                        {(hubSummary.hub.lat != null && hubSummary.hub.lon != null) ? (
                            <p className="atlas-muted">
                                {hubSummary.hub.lat}, {hubSummary.hub.lon}
                            </p>
                        ) : (
                            <p className="atlas-muted">No map coordinates</p>
                        )}
                        <div className="atlas-toolbar">
                            <CopyIpsButton
                                ips={[
                                    hubSummary.hub.hubIp,
                                    ...collectHubIps(hubSummary.hub.id, 'all', snap)
                                ]}
                            />
                            {canPing ? (
                                <>
                                {hubSummary.hub.hubIp ? (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => onPingHub?.(hubSummary.hub.id, 'hub')}
                                    >
                                        Ping hub IP
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className={`btn btn-sm${hubSummary.hub.hubIp ? ' btn-ghost' : ' btn-secondary'}`}
                                    onClick={() => onPingHub?.(hubSummary.hub.id, 'all')}
                                >
                                    Ping all hub switches
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'primary')}>
                                    Ping primary
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'secondary')}>
                                    Ping secondary
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!!snap.activeSession}
                                    onClick={() => {
                                        const ips = collectHubIps(hubSummary.hub.id, 'all', snap);
                                        onStartMonitor?.({
                                            targets: ips,
                                            interval: monitorInterval,
                                            label: hubSummary.hub.name || hubSummary.hub.hubCode
                                        });
                                    }}
                                >
                                    Start monitor
                                </button>
                                </>
                            ) : null}
                        </div>
                        <p><strong>Primary channels:</strong> {hubSummary.primary.length}</p>
                        <ul className="atlas-simple-list">
                            {hubSummary.primary.map((row) => (
                                <li key={row.channel.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'channel', id: row.channel.id })}>
                                        Ch {row.channel.channelNumber}
                                    </button>
                                    {' '}· {row.dropCount} drops
                                    {canPing && row.firstDrop?.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(row.firstDrop.id)}>Ping first</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <p><strong>Secondary channels:</strong> {hubSummary.secondary.length}</p>
                        <ul className="atlas-simple-list">
                            {hubSummary.secondary.map((row) => (
                                <li key={row.channel.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'channel', id: row.channel.id })}>
                                        Ch {row.channel.channelNumber}
                                    </button>
                                    {' '}· {row.dropCount} drops
                                    {canPing && row.lastDrop?.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(row.lastDrop.id)}>Ping last</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <ChannelSchematic
                    schematic={schematic}
                    canPing={canPing}
                    monitorInterval={monitorInterval}
                    monitorActive={!!snap.activeSession}
                    onSelectDrop={(id) => onSelect?.({ kind: 'drop', id })}
                    onSelectHub={(id, hubCode) => {
                        const hub = (snap.hubs || []).find((h) => h.id === id)
                            || (snap.hubs || []).find((h) => h.hubCode === hubCode);
                        if (hub) onSelect?.({ kind: 'hub', id: hub.id });
                    }}
                    onSelectFinding={focusFinding}
                    onPingChannel={onPingChannel}
                    onPingDrop={onPingDrop}
                    onStartMonitor={onStartMonitor}
                />
            </CollapsibleSection>

            <CollapsibleSection title="Ping triage" bodyId="atlas-triage" defaultOpen>
                {isEmptyDb ? (
                    <div className="atlas-empty-cta">
                        <p className="atlas-muted">No drops to triage until data is imported and pinged.</p>
                    </div>
                ) : null}
                <div className="atlas-toolbar">
                    {[
                        ['unreachable', 'Unreachable'],
                        ['stale', 'Stale'],
                        ['untested', 'Untested'],
                        ['attention', 'Needs attention']
                    ].map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            className={`btn btn-sm${triageMode === mode ? ' btn-secondary' : ' btn-ghost'}`}
                            onClick={() => changeTriageMode(mode)}
                        >
                            {label}
                        </button>
                    ))}
                    {canPing ? (
                        <label className="atlas-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            Ping packets
                            <select
                                className="input-sm"
                                value={pingCount}
                                onChange={(e) => changePingCount(e.target.value)}
                                title="ICMP packets per target (intermittent if success rate &gt;0% and &lt;75%)"
                            >
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                                <option value={4}>4</option>
                                <option value={8}>8</option>
                            </select>
                        </label>
                    ) : null}
                </div>
                <p className="atlas-muted">
                    {triageMode} in {dashScope === 'selection' ? 'current selection/area' : 'full network'} ({triageRows.length}).
                </p>
                {triageRows.length > 0 && (
                    <div className="atlas-toolbar">
                        <CopyIpsButton ips={triageRows.map((r) => r.ip)} />
                        {canPing && (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onPingSelectedIps?.(triageRows.map((r) => r.ip))}
                                >
                                    Re-ping list ({triageRows.length})
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!!snap.activeSession}
                                    title={snap.activeSession ? 'Stop the active monitor first' : 'Monitor triage IPs'}
                                    onClick={() => onStartMonitor?.({
                                        targets: triageRows.map((r) => r.ip),
                                        interval: monitorInterval,
                                        label: `Triage ${triageMode}`
                                    })}
                                >
                                    Start monitor
                                </button>
                                <select className="input-sm" value={monitorInterval} onChange={(e) => changeMonitorInterval(e.target.value)}>
                                    <option value="continuous">Continuous (~5s)</option>
                                    <option value={1}>Every 1 min</option>
                                    <option value={5}>Every 5 min</option>
                                </select>
                            </>
                        )}
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => exportTriageCsv(snap, { scope: dashScope, mode: triageMode })}
                        >
                            Export triage CSV
                        </button>
                        {triageRows.length > 60 && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setShowAllTriage((v) => !v)}
                            >
                                {showAllTriage ? 'Show less' : `Show all (${triageRows.length})`}
                            </button>
                        )}
                    </div>
                )}
                <ul className="atlas-simple-list">
                    {(showAllTriage ? triageRows : triageRows.slice(0, 60)).map((row) => {
                        const name = row.drop.inventoryName || null;
                        const primary = `${formatChannelPrimary(row.drop.channelNumber)} · ${formatDropPrimary(row.drop.dropNumber)}`;
                        return (
                            <li key={row.drop.id}>
                                <button
                                    type="button"
                                    className="atlas-linkish atlas-row-label"
                                    title={[primary, name, row.ip].filter(Boolean).join(' · ')}
                                    onClick={() => onSelect?.({ kind: 'drop', id: row.drop.id })}
                                >
                                    {primary}
                                    {name ? ` · ${name}` : ''}
                                </button>
                                <CopyIp ip={row.ip} />
                                <span className={`atlas-muted${row.stale ? ' atlas-stale-warn' : ''}`}>
                                    {row.status} · {row.age}
                                </span>
                                {canPing && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(row.drop.id)}>
                                        Ping
                                    </button>
                                )}
                            </li>
                        );
                    })}
                    {!triageRows.length && <li className="atlas-muted">No matches in this triage mode.</li>}
                </ul>
            </CollapsibleSection>

            <CollapsibleSection title="Area troubleshooting" bodyId="atlas-area" defaultOpen={false}>
                <p className="atlas-muted">Draw a rectangle or polygon on the map. Results switch the dashboard to Selection scope. Selecting a hub/channel/drop clears the area.</p>
                <div className="atlas-toolbar">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAreaFromDraw?.()}>
                        Draw rectangle
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAreaPolygon?.()}>
                        Draw polygon
                    </button>
                    {area && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClearArea?.()}>
                            Clear area
                        </button>
                    )}
                </div>
                {area && (
                    <div className="atlas-detail-block">
                        <p>{area.drops.length} drops · {area.channels.length} channels · {area.hubs.length} hubs</p>
                        {!!area.warnings?.length && (
                            <p className="atlas-stale-warn">{area.warnings.length} open finding(s) in this area</p>
                        )}
                        <div className="atlas-toolbar">
                            <CopyIpsButton ips={area.drops.map((d) => d.ip)} />
                            {canPing && (
                                <>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => onPingSelectedIps?.(area.drops.map((d) => d.ip).filter(Boolean))}
                                    >
                                        Ping area switches
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={!!snap.activeSession || !area.drops.some((d) => d.ip)}
                                        onClick={() => onStartMonitor?.({
                                            targets: area.drops.map((d) => d.ip).filter(Boolean),
                                            interval: monitorInterval,
                                            label: 'Area monitor'
                                        })}
                                    >
                                        Start monitor
                                    </button>
                                </>
                            )}
                            {!!area.warnings?.length && (
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => {
                                        changeDashScope('selection', { persist: false });
                                        focusFindings('all', 'Open');
                                    }}
                                >
                                    View area findings
                                </button>
                            )}
                            {(area.warnings?.length > 20 || area.drops.length > 40) && (
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setShowAllArea((v) => !v)}
                                >
                                    {showAllArea ? 'Show less' : 'Show all area results'}
                                </button>
                            )}
                        </div>
                        {!!area.warnings?.length && (
                            <ul className="atlas-simple-list">
                                {(showAllArea ? area.warnings : area.warnings.slice(0, 20)).map((f) => (
                                    <li key={f.id}>
                                        <button type="button" className="atlas-linkish" onClick={() => focusFinding(f)}>
                                            {f.findingType}: {f.description}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <ul className="atlas-simple-list">
                            {(showAllArea ? area.drops : area.drops.slice(0, 40)).map((d) => {
                                const lines = formatAtlasEntityLines('drop', d);
                                return (
                                    <li key={d.id}>
                                        <button
                                            type="button"
                                            className="atlas-linkish atlas-row-label"
                                            title={lines.title}
                                            onClick={() => onSelect?.({ kind: 'drop', id: d.id })}
                                        >
                                            <strong>{lines.primary}</strong>
                                            {lines.secondary ? ` · ${lines.secondary}` : ''}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </CollapsibleSection>

            <CollapsibleSection
                title={snap.activeSession ? 'Monitoring · active' : 'Monitoring'}
                bodyId="atlas-monitor"
                defaultOpen={false}
                expandWhen={!!snap.activeSession}
            >
                {snap.activeSession ? (
                    <div>
                        <p className="atlas-stale-warn">Live session — this panel opens when monitoring starts.</p>
                        <p>
                            {snap.activeSession.label || 'Monitor'}
                            {' · '}
                            {(snap.activeSession.targets || []).length} target(s)
                            {' · '}
                            {snap.activeSession.log?.length || 0} samples
                        </p>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStopMonitor?.(snap.activeSession.id)}>
                            Stop & export CSV
                        </button>
                        {!!monitorTail.length && (
                            <ul className="atlas-simple-list atlas-monitor-tail">
                                {monitorTail.map((row, i) => (
                                    <li key={`${row.timestamp || row.at}-${row.ip}-${i}`}>
                                        <CopyIp ip={row.ip} />
                                        {' · '}
                                        {row.status}
                                        {row.rttMs != null ? ` · ${row.rttMs} ms` : ''}
                                        <span className="atlas-muted"> · {formatPingWhen(row.timestamp || row.at)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : (
                    <p className="atlas-muted">
                        No active session. Start from a drop, hub, channel, site, device, triage list, or area results.
                        This section opens automatically when a monitor starts.
                    </p>
                )}

                <div className="atlas-monitor-history">
                    <div className="atlas-toolbar">
                        <strong>Past sessions</strong>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => refreshPastSessions()}
                            disabled={historyBusy}
                        >
                            Refresh
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={historyBusy || !pastSessions.length}
                            title="Delete sessions older than the retention setting"
                            onClick={() => {
                                const days = snap.prefs?.sessionsRetentionDays ?? 30;
                                if (!days) {
                                    void confirm(
                                        'Retention is off',
                                        'Choose Keep 7/30/90 days in the dropdown, then use Prune old again.'
                                    );
                                    return;
                                }
                                void confirm(
                                    'Prune old sessions',
                                    `Delete monitor sessions older than ${days} days? Active session is kept.`
                                ).then((ok) => {
                                    if (!ok) return;
                                    setHistoryBusy(true);
                                    void pruneAtlasPingSessions({ olderThanDays: days })
                                        .then(() => {
                                            if (historyDetail?.session?.id) setHistoryDetail(null);
                                            refreshPastSessions();
                                        })
                                        .finally(() => setHistoryBusy(false));
                                });
                            }}
                        >
                            Prune old
                        </button>
                        <select
                            className="input-sm"
                            title="Auto-delete sessions older than this when Atlas opens (0 = off)"
                            value={String(snap.prefs?.sessionsRetentionDays ?? 30)}
                            onChange={(e) => void setAtlasPref(PREF_SESSIONS_RETENTION_DAYS, e.target.value)}
                        >
                            <option value="0">Keep forever</option>
                            <option value="7">Keep 7 days</option>
                            <option value="30">Keep 30 days</option>
                            <option value="90">Keep 90 days</option>
                        </select>
                    </div>
                    {!pastSessions.length ? (
                        <p className="atlas-muted">No saved monitor sessions yet (one-shot pings are hidden).</p>
                    ) : (
                        <ul className="atlas-session-list">
                            {pastSessions.map((s) => {
                                const selected = historyDetail?.session?.id === s.id;
                                const endLabel = formatSessionEndLabel(s, snap.activeSession?.id);
                                return (
                                    <li key={s.id} className="atlas-session-item">
                                        <button
                                            type="button"
                                            className={`atlas-session-row${selected ? ' atlas-session-row--selected' : ''}`}
                                            disabled={historyBusy}
                                            onClick={() => openHistorySession(s.id, 80)}
                                        >
                                            <strong>{s.label || 'Monitor'}</strong>
                                            <span className="atlas-muted">
                                                {formatPingWhen(s.startedAt)}
                                                {' → '}
                                                {endLabel === 'incomplete' ? (
                                                    <span className="atlas-stale-warn">incomplete</span>
                                                ) : endLabel}
                                            </span>
                                            <span className="atlas-muted">
                                                {s.sampleCount || 0} samples · {s.targetCount || 0} IP(s)
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm atlas-session-delete"
                                            disabled={historyBusy || s.id === snap.activeSession?.id}
                                            title={s.id === snap.activeSession?.id ? 'Stop the active monitor first' : 'Delete session'}
                                            onClick={() => {
                                                void confirm(
                                                    'Delete monitor session',
                                                    `Delete “${s.label || 'Monitor'}” and its samples?`
                                                ).then((ok) => {
                                                    if (!ok) return;
                                                    setHistoryBusy(true);
                                                    void deleteAtlasPingSession(s.id)
                                                        .then((deleted) => {
                                                            if (deleted && historyDetail?.session?.id === s.id) {
                                                                setHistoryDetail(null);
                                                            }
                                                            refreshPastSessions();
                                                        })
                                                        .finally(() => setHistoryBusy(false));
                                                });
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {historyDetail?.results?.length ? (
                        <div className="atlas-session-detail">
                            <div className="atlas-toolbar">
                                <span className="atlas-muted">
                                    Showing {Math.min(historyVisible, historyDetail.results.length)} of {historyDetail.results.length} loaded
                                    {(() => {
                                        const total = pastSessions.find((s) => s.id === historyDetail.session?.id)?.sampleCount;
                                        return total != null && total > historyDetail.results.length
                                            ? ` (${total} in session)`
                                            : '';
                                    })()}
                                </span>
                                <CopyIpsButton
                                    ips={historyDetail.results.map((r) => r.ip)}
                                    disabled={historyBusy}
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={historyBusy || !historyDetail.session?.id}
                                    title="Export every sample for this session from the database"
                                    onClick={() => {
                                        const id = historyDetail.session?.id;
                                        if (!id) return;
                                        setHistoryBusy(true);
                                        void exportAtlasPingSessionFullCsv(id, {
                                            label: historyDetail.session?.label
                                        })
                                            .catch((err) => {
                                                atlasNotify(err?.message || 'Full export failed', 'error');
                                            })
                                            .finally(() => setHistoryBusy(false));
                                    }}
                                >
                                    Export full CSV
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={historyBusy}
                                    title="Export only samples currently loaded in this panel"
                                    onClick={() => exportPingSessionCsv(historyDetail.results, {
                                        label: historyDetail.session?.label,
                                        sessionId: historyDetail.session?.id
                                    })}
                                >
                                    Export loaded ({historyDetail.results.length})
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={historyBusy || historyDetail.session?.id === snap.activeSession?.id}
                                    onClick={() => {
                                        const id = historyDetail.session?.id;
                                        if (!id) return;
                                        void confirm(
                                            'Delete monitor session',
                                            `Delete “${historyDetail.session?.label || 'Monitor'}” and its samples?`
                                        ).then((ok) => {
                                            if (!ok) return;
                                            setHistoryBusy(true);
                                            void deleteAtlasPingSession(id)
                                                .then((deleted) => {
                                                    if (deleted) setHistoryDetail(null);
                                                    refreshPastSessions();
                                                })
                                                .finally(() => setHistoryBusy(false));
                                        });
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                            <ul className="atlas-simple-list atlas-monitor-tail">
                                {historyDetail.results.slice(0, historyVisible).map((row, i) => (
                                    <li key={`${row.at}-${row.ip}-${i}`}>
                                        <CopyIp ip={row.ip} />
                                        {' · '}
                                        {row.status}
                                        {row.rttMs != null ? ` · ${row.rttMs} ms` : ''}
                                        <span className="atlas-muted"> · {formatPingWhen(row.timestamp || row.at)}</span>
                                    </li>
                                ))}
                            </ul>
                            {(() => {
                                const loaded = historyDetail.results.length;
                                const total = Number(
                                    pastSessions.find((s) => s.id === historyDetail.session?.id)?.sampleCount
                                    ?? loaded
                                );
                                const canShowMore = historyVisible < loaded || loaded < total;
                                if (!canShowMore) return null;
                                return (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={historyBusy}
                                        onClick={() => loadMoreHistory()}
                                    >
                                        {historyVisible < loaded
                                            ? `Show more (${Math.min(40, loaded - historyVisible)} more on screen)`
                                            : `Load more from DB (${loaded} / ${total})`}
                                    </button>
                                );
                            })()}
                        </div>
                    ) : null}
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Reconciliation" bodyId="atlas-findings" defaultOpen={false}>
                <p className="atlas-muted">
                    {findings.length} finding{findings.length === 1 ? '' : 's'}
                    {dashScope === 'selection'
                        ? ` in ${stats.scopeLabel || 'selection'}`
                        : ' (full network)'}
                    {selectedFindingIds.size ? ` · ${selectedFindingIds.size} selected` : ''}
                </p>
                <div className="atlas-toolbar">
                    <select
                        className="input-sm"
                        value={findingFilter}
                        onChange={(e) => {
                            setFindingFilter(e.target.value);
                            clearFindingSelection();
                        }}
                    >
                        <option value="Open">Open</option>
                        <option value="Reviewed">Reviewed</option>
                        <option value="Ignored">Ignored</option>
                        <option value="Resolved">Resolved</option>
                        <option value="all">All</option>
                    </select>
                    <select
                        className="input-sm"
                        value={findingTypeFilter}
                        onChange={(e) => {
                            setFindingTypeFilter(e.target.value);
                            clearFindingSelection();
                        }}
                        title="Finding type"
                    >
                        <option value="all">All types</option>
                        {findingTypes.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                    <CopyIpsButton ips={findings.map((f) => f.ip)} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportFindingsCsv(findings)}>Export CSV</button>
                    {findings.length > 100 && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setShowAllFindings((v) => !v)}
                        >
                            {showAllFindings ? 'Show less' : `Show all (${findings.length})`}
                        </button>
                    )}
                </div>
                <div className="atlas-toolbar atlas-findings-bulk">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!visibleFindings.length || bulkBusy}
                        onClick={selectAllVisibleFindings}
                    >
                        Select visible ({visibleFindings.length})
                    </button>
                    {findings.length > visibleFindings.length ? (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!findings.length || bulkBusy}
                            onClick={selectAllFilteredFindings}
                            title="Select every finding matching the current filters"
                        >
                            Select all filtered ({findings.length})
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!selectedFindingIds.size || bulkBusy}
                        onClick={clearFindingSelection}
                    >
                        Clear
                    </button>
                    <CopyIpsButton
                        ips={selectedFindingIps}
                        label="Copy selected IPs"
                        disabled={bulkBusy || !selectedFindingIps.length}
                    />
                    {canPing ? (
                        <>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={bulkBusy || !selectedFindingIps.length}
                                title={
                                    selectedFindingIps.length
                                        ? `Ping ${selectedFindingIps.length} unique IP${selectedFindingIps.length === 1 ? '' : 's'} from selection`
                                        : 'Selected findings have no IPs'
                                }
                                onClick={() => {
                                    setBulkBusy(true);
                                    void Promise.resolve(onPingSelectedIps?.(selectedFindingIps))
                                        .catch(() => {})
                                        .finally(() => setBulkBusy(false));
                                }}
                            >
                                Ping selected ({selectedFindingIps.length})
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={bulkBusy || !selectedFindingIps.length || !!snap.activeSession}
                                title={
                                    snap.activeSession
                                        ? 'Stop the active monitor first'
                                        : selectedFindingIps.length
                                            ? `Monitor ${selectedFindingIps.length} unique IP${selectedFindingIps.length === 1 ? '' : 's'} from selection`
                                            : 'Selected findings have no IPs'
                                }
                                onClick={() => onStartMonitor?.({
                                    targets: selectedFindingIps,
                                    interval: monitorInterval,
                                    label: `Findings (${selectedFindingIps.length} IP${selectedFindingIps.length === 1 ? '' : 's'})`
                                })}
                            >
                                Start monitor
                            </button>
                            <select
                                className="input-sm"
                                value={monitorInterval}
                                disabled={bulkBusy || !selectedFindingIps.length}
                                onChange={(e) => changeMonitorInterval(e.target.value)}
                                title="Monitor interval for selected findings"
                            >
                                <option value="continuous">Continuous (~5s)</option>
                                <option value={1}>Every 1 min</option>
                                <option value={5}>Every 5 min</option>
                            </select>
                        </>
                    ) : null}
                    {['Reviewed', 'Ignored', 'Resolved', 'Open'].map((st) => (
                        <button
                            key={st}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={!selectedFindingIds.size || bulkBusy}
                            onClick={() => applyBulkFindingStatus(st)}
                        >
                            → {st}
                        </button>
                    ))}
                </div>
                <ul className="atlas-findings-list">
                    {visibleFindings.map((f) => (
                        <li
                            key={f.id}
                            id={`atlas-finding-${f.id}`}
                            className={`${focusedFindingId === f.id ? 'atlas-finding--focused' : ''}${selectedFindingIds.has(f.id) ? ' atlas-finding--selected' : ''}`}
                        >
                            <label className="atlas-finding-check">
                                <input
                                    type="checkbox"
                                    checked={selectedFindingIds.has(f.id)}
                                    onChange={() => toggleFindingSelected(f.id)}
                                    aria-label={`Select finding ${f.findingType}`}
                                />
                            </label>
                            <span className={statusClass(f.severity)}>{f.severity}</span>
                            <div>
                                <button
                                    type="button"
                                    className="atlas-linkish atlas-finding-title"
                                    onClick={() => focusFinding(f)}
                                    disabled={!f.entityId && !f.ip}
                                    title={f.entityId || f.ip ? 'Show on map / details' : 'No linked entity'}
                                >
                                    <strong>{f.findingType}</strong>
                                </button>
                                {(f.entityKind || f.entityId || f.ip) ? (
                                    <p className="atlas-finding-entity">
                                        {f.entityKind ? <span className="atlas-tag">{f.entityKind}</span> : null}
                                        {f.ip ? <CopyIp ip={f.ip} /> : null}
                                        {(f.entityId || f.ip) ? (
                                            <button
                                                type="button"
                                                className="atlas-linkish"
                                                onClick={() => focusFinding(f)}
                                            >
                                                Open on map
                                            </button>
                                        ) : null}
                                    </p>
                                ) : null}
                                <p>{f.description}</p>
                                {f.suggestedAction && (
                                    <p className="atlas-muted">Action: {f.suggestedAction}</p>
                                )}
                                <label className="atlas-finding-notes">
                                    <span className="atlas-muted">Notes</span>
                                    <textarea
                                        className="input-sm atlas-finding-notes-input"
                                        rows={2}
                                        value={noteDrafts[f.id] ?? f.notes ?? ''}
                                        onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                                        onBlur={() => {
                                            const next = noteDrafts[f.id];
                                            if (next === undefined || next === (f.notes || '')) return;
                                            onUpdateFindingNotes?.(f.id, next);
                                        }}
                                        placeholder="Operator notes…"
                                    />
                                </label>
                                <div className="atlas-toolbar">
                                    {['Open', 'Reviewed', 'Ignored', 'Resolved'].map((st) => (
                                        <button
                                            key={st}
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            disabled={f.status === st}
                                            onClick={() => onUpdateFinding?.(f.id, st)}
                                        >
                                            {st}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </li>
                    ))}
                    {!findings.length && <li className="atlas-muted">No findings for this filter.</li>}
                </ul>
            </CollapsibleSection>
        </div>
    );
}
