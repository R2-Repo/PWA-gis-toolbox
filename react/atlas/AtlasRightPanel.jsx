import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { buildChannelSchematic } from '../../js/atlas/schematic.js';
import { getHubChannelSummary } from '../../js/atlas/hierarchy.js';
import { buildDashboardStats, exportDropsCsv, exportFindingsCsv, openPrintableReport } from '../../js/atlas/export.js';
import { findingsInScope, listScopedDropsByPing } from '../../js/atlas/triage.js';
import { formatPingAge, formatPingWhen, isPingStale } from '../../js/atlas/ping-format.js';
import { ChannelSchematic } from './ChannelSchematic.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

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
    const [tick, setTick] = useState(0);
    const [findingFilter, setFindingFilter] = useState('Open');
    const [monitorInterval, setMonitorInterval] = useState(1);
    const [dashScope, setDashScope] = useState('network');
    const [triageMode, setTriageMode] = useState('unreachable');
    const [noteDrafts, setNoteDrafts] = useState({});

    useEffect(() => {
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', (sel) => {
                if (sel) setDashScope('selection');
                else setDashScope('network');
                setTick((t) => t + 1);
            }),
            bus.on('atlas:ping', () => setTick((t) => t + 1))
        ];
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

    const findings = useMemo(() => {
        let list = findingsInScope(snap, dashScope);
        if (findingFilter !== 'all') list = list.filter((f) => f.status === findingFilter);
        return list;
    }, [snap, findingFilter, tick, dashScope]);

    const area = snap.areaResults;

    const triageRows = useMemo(
        () => listScopedDropsByPing(snap, { scope: dashScope, mode: triageMode }),
        [snap, tick, dashScope, triageMode]
    );

    const dropPing = dropDetail?.ip ? snap.pingResults?.[dropDetail.ip] : null;
    const devicePing = deviceDetail?.ip ? snap.pingResults?.[deviceDetail.ip] : null;

    return (
        <div className="atlas-panel atlas-panel-right">
            <CollapsibleSection title="Dashboard" bodyId="atlas-dash">
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'network' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => setDashScope('network')}
                    >
                        Network
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'selection' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => setDashScope('selection')}
                        disabled={!selection && !snap.areaResults}
                        title="Scope to selected hub/channel/drop or area results"
                    >
                        Selection{stats.scopeLabel && stats.scopeLabel !== 'Network' ? ` (${stats.scopeLabel})` : ''}
                    </button>
                </div>
                <div className="atlas-dash-grid">
                    <div className="atlas-dash-card"><span>Hubs</span><strong>{stats.hubs}</strong></div>
                    <div className="atlas-dash-card"><span>Channels</span><strong>{stats.channels}</strong></div>
                    <div className="atlas-dash-card"><span>Drops</span><strong>{stats.drops}</strong></div>
                    <div className="atlas-dash-card"><span>Devices</span><strong>{stats.devices}</strong></div>
                    <div className="atlas-dash-card"><span>Open findings</span><strong>{stats.openFindings}</strong></div>
                    <div className="atlas-dash-card"><span>Missing Site IDs</span><strong>{stats.missingSiteIds}</strong></div>
                    <div className="atlas-dash-card"><span>Duplicate IPs</span><strong>{stats.duplicateIps}</strong></div>
                    <div className="atlas-dash-card"><span>Ping up/down</span><strong>{stats.pingReachable}/{stats.pingUnreachable}</strong></div>
                </div>
                <div className="atlas-toolbar">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportDropsCsv(snap)}>Export drops CSV</button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openPrintableReport({
                            title: 'ITS Network Atlas Report',
                            bodyHtml: `<table><tr><th>Metric</th><th>Value</th></tr>
                              <tr><td>Hubs</td><td>${stats.hubs}</td></tr>
                              <tr><td>Channels</td><td>${stats.channels}</td></tr>
                              <tr><td>Drops</td><td>${stats.drops}</td></tr>
                              <tr><td>Open findings</td><td>${stats.openFindings}</td></tr></table>`
                        })}
                    >
                        Printable report
                    </button>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Details & schematic" bodyId="atlas-details" defaultOpen>
                {!selection && <p className="atlas-muted">Select a hub, channel, drop, device, or site.</p>}
                {dropDetail && (
                    <div className="atlas-detail-block">
                        <h4>{dropDetail.inventoryName || `Drop ${dropDetail.dropNumber}`}</h4>
                        <p>Channel {dropDetail.channelNumber} · Drop {dropDetail.dropNumber ?? '—'}</p>
                        <p>IP: {dropDetail.ip || '—'}</p>
                        <p>{[dropDetail.manufacturer, dropDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        <p className={dropPing && isPingStale(dropPing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {dropPing?.status || 'untested'}
                            {dropPing?.rttMs != null ? ` · ${dropPing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(dropPing?.at)}
                            {dropPing?.at ? ` (${formatPingWhen(dropPing.at)})` : ''}
                        </p>
                        {canPing && dropDetail.ip && (
                            <div className="atlas-toolbar">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingDrop?.(dropDetail.id)}>Ping once</button>
                                <select className="input-sm" value={monitorInterval} onChange={(e) => setMonitorInterval(Number(e.target.value) || e.target.value)}>
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
                            </div>
                        )}
                    </div>
                )}
                {deviceDetail && (
                    <div className="atlas-detail-block">
                        <h4>{deviceDetail.inventoryName || deviceDetail.ip || 'Device'}</h4>
                        <p>{[deviceDetail.deviceType, deviceDetail.manufacturer, deviceDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        <p>IP: {deviceDetail.ip || '—'}</p>
                        <p className={devicePing && isPingStale(devicePing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {devicePing?.status || 'untested'}
                            {devicePing?.rttMs != null ? ` · ${devicePing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(devicePing?.at)}
                        </p>
                        {canPing && deviceDetail.ip && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingSelectedIps?.([deviceDetail.ip])}
                            >
                                Ping device
                            </button>
                        )}
                    </div>
                )}
                {siteDetail && (
                    <div className="atlas-detail-block">
                        <h4>{siteDetail.inventoryName || siteDetail.siteId || 'Site'}</h4>
                        <p>Site ID: {siteDetail.siteId || '—'}</p>
                        <p className="atlas-muted">
                            {[siteDetail.lat, siteDetail.lon].every((n) => n != null)
                                ? `${siteDetail.lat}, ${siteDetail.lon}`
                                : 'No coordinates'}
                        </p>
                    </div>
                )}
                {hubSummary && (
                    <div className="atlas-detail-block">
                        <h4>{hubSummary.hub.name || hubSummary.hub.hubCode}</h4>
                        {canPing && (
                            <div className="atlas-toolbar">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'all')}>
                                    Ping all hub switches
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'primary')}>
                                    Ping primary
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'secondary')}>
                                    Ping secondary
                                </button>
                            </div>
                        )}
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
                    onSelectDrop={(id) => onSelect?.({ kind: 'drop', id })}
                    onPingChannel={onPingChannel}
                    onPingDrop={onPingDrop}
                />
            </CollapsibleSection>

            <CollapsibleSection title="Ping triage" bodyId="atlas-triage" defaultOpen>
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
                            onClick={() => setTriageMode(mode)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <p className="atlas-muted">
                    {triageMode} in {dashScope === 'selection' ? 'current selection/area' : 'full network'} ({triageRows.length}).
                </p>
                {canPing && triageRows.length > 0 && (
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onPingSelectedIps?.(triageRows.map((r) => r.ip))}
                    >
                        Re-ping list ({triageRows.length})
                    </button>
                )}
                <ul className="atlas-simple-list">
                    {triageRows.slice(0, 60).map((row) => (
                        <li key={row.drop.id}>
                            <button
                                type="button"
                                className="atlas-linkish"
                                onClick={() => onSelect?.({ kind: 'drop', id: row.drop.id })}
                            >
                                Ch {row.drop.channelNumber || '?'} · D{row.drop.dropNumber ?? '?'} · {row.ip}
                            </button>
                            <span className={`atlas-muted${row.stale ? ' atlas-stale-warn' : ''}`}>
                                {' '}· {row.status} · {row.age}
                            </span>
                        </li>
                    ))}
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
                        {canPing && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingSelectedIps?.(area.drops.map((d) => d.ip).filter(Boolean))}
                            >
                                Ping area switches
                            </button>
                        )}
                        {!!area.warnings?.length && (
                            <ul className="atlas-simple-list">
                                {area.warnings.slice(0, 20).map((f) => (
                                    <li key={f.id}>
                                        <button type="button" className="atlas-linkish" onClick={() => onSelectFinding?.(f)}>
                                            {f.findingType}: {f.description}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <ul className="atlas-simple-list">
                            {area.drops.slice(0, 40).map((d) => (
                                <li key={d.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'drop', id: d.id })}>
                                        {d.inventoryName || d.ip || d.id}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Monitoring" bodyId="atlas-monitor" defaultOpen={false}>
                {snap.activeSession ? (
                    <div>
                        <p>Session {snap.activeSession.id.slice(0, 8)}… · {snap.activeSession.log?.length || 0} samples</p>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStopMonitor?.(snap.activeSession.id)}>
                            Stop & export CSV
                        </button>
                    </div>
                ) : (
                    <p className="atlas-muted">Start a monitor from a drop detail or after selecting IPs.</p>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Reconciliation" bodyId="atlas-findings" defaultOpen={false}>
                <p className="atlas-muted">
                    {findings.length} finding{findings.length === 1 ? '' : 's'}
                    {dashScope === 'selection'
                        ? ` in ${stats.scopeLabel || 'selection'}`
                        : ' (full network)'}
                </p>
                <div className="atlas-toolbar">
                    <select className="input-sm" value={findingFilter} onChange={(e) => setFindingFilter(e.target.value)}>
                        <option value="Open">Open</option>
                        <option value="Reviewed">Reviewed</option>
                        <option value="Ignored">Ignored</option>
                        <option value="Resolved">Resolved</option>
                        <option value="all">All</option>
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportFindingsCsv(findings)}>Export CSV</button>
                </div>
                <ul className="atlas-findings-list">
                    {findings.slice(0, 100).map((f) => (
                        <li key={f.id}>
                            <span className={statusClass(f.severity)}>{f.severity}</span>
                            <div>
                                <button
                                    type="button"
                                    className="atlas-linkish atlas-finding-title"
                                    onClick={() => onSelectFinding?.(f)}
                                    disabled={!f.entityId && !f.ip}
                                    title={f.entityId || f.ip ? 'Show on map / details' : 'No linked entity'}
                                >
                                    <strong>{f.findingType}</strong>
                                </button>
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
