import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { buildChannelSchematic } from '../../js/atlas/schematic.js';
import { getHubChannelSummary } from '../../js/atlas/hierarchy.js';
import { buildDashboardStats, exportDropsCsv, exportFindingsCsv, openPrintableReport } from '../../js/atlas/export.js';
import { ChannelSchematic } from './ChannelSchematic.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function statusClass(status) {
    return `atlas-finding-sev atlas-finding-sev--${status || 'info'}`;
}

export function AtlasRightPanel({
    canPing,
    onPingChannel,
    onPingDrop,
    onSelect,
    onPingSelectedIps,
    onStartMonitor,
    onStopMonitor,
    onUpdateFinding,
    onAreaFromDraw
}) {
    const [tick, setTick] = useState(0);
    const [findingFilter, setFindingFilter] = useState('Open');
    const [monitorInterval, setMonitorInterval] = useState(1);
    const [dashScope, setDashScope] = useState('network');

    useEffect(() => {
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', () => {
                setDashScope('selection');
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

    const findings = useMemo(() => {
        let list = snap.findings || [];
        if (findingFilter !== 'all') list = list.filter((f) => f.status === findingFilter);
        return list;
    }, [snap.findings, findingFilter, tick]);

    const area = snap.areaResults;

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
                {!selection && <p className="atlas-muted">Select a hub, channel, or drop.</p>}
                {dropDetail && (
                    <div className="atlas-detail-block">
                        <h4>{dropDetail.inventoryName || `Drop ${dropDetail.dropNumber}`}</h4>
                        <p>Channel {dropDetail.channelNumber} · Drop {dropDetail.dropNumber ?? '—'}</p>
                        <p>IP: {dropDetail.ip || '—'}</p>
                        <p>{[dropDetail.manufacturer, dropDetail.model].filter(Boolean).join(' · ') || '—'}</p>
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
                                    onClick={() => onStartMonitor?.({ targets: [dropDetail.ip], interval: monitorInterval, label: dropDetail.inventoryName })}
                                >
                                    Start monitor
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {hubSummary && (
                    <div className="atlas-detail-block">
                        <h4>{hubSummary.hub.name || hubSummary.hub.hubCode}</h4>
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

            <CollapsibleSection title="Area troubleshooting" bodyId="atlas-area" defaultOpen={false}>
                <p className="atlas-muted">Draw a rectangle or polygon on the map, then run the query.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAreaFromDraw?.()}>
                    Query current draw selection
                </button>
                {area && (
                    <div className="atlas-detail-block">
                        <p>{area.drops.length} drops · {area.channels.length} channels · {area.hubs.length} hubs</p>
                        {canPing && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingSelectedIps?.(area.drops.map((d) => d.ip).filter(Boolean))}
                            >
                                Ping area switches
                            </button>
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
                <div className="atlas-toolbar">
                    <select className="input-sm" value={findingFilter} onChange={(e) => setFindingFilter(e.target.value)}>
                        <option value="Open">Open</option>
                        <option value="Reviewed">Reviewed</option>
                        <option value="Ignored">Ignored</option>
                        <option value="Resolved">Resolved</option>
                        <option value="all">All</option>
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportFindingsCsv(snap.findings)}>Export CSV</button>
                </div>
                <ul className="atlas-findings-list">
                    {findings.slice(0, 100).map((f) => (
                        <li key={f.id}>
                            <span className={statusClass(f.severity)}>{f.severity}</span>
                            <div>
                                <strong>{f.findingType}</strong>
                                <p>{f.description}</p>
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
