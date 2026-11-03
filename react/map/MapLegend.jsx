function LegendSwatch({ item }) {
    if (!item) return null;
    if (item.swatch === 'line') {
        const thickness = Math.max(2, Math.min(8, Number(item.width) || 2));
        return (
            <span
                className="map-legend-swatch map-legend-swatch--line"
                style={{ background: item.color, height: thickness }}
            />
        );
    }
    if (item.swatch === 'circle') {
        const size = Math.max(6, Math.min(18, Number(item.size) || 8));
        return (
            <span
                className="map-legend-swatch map-legend-swatch--circle"
                style={{ background: item.color, width: size, height: size }}
            />
        );
    }
    return <span className="map-legend-swatch" style={{ background: item.color }} />;
}

function LegendBody({ entry }) {
    if (entry.symbology === 'single') {
        return (
            <div className="map-legend-row">
                <LegendSwatch item={entry.items[0]} />
                <span className="map-legend-label">{entry.name}</span>
            </div>
        );
    }

    return (
        <>
            <h3 className="map-legend-layer-name">{entry.name}</h3>
            {entry.ramp ? (
                <div className="map-legend-ramp-row">
                    <span className="map-legend-stop">{entry.items[0]?.label}</span>
                    <span
                        className="map-legend-ramp"
                        style={{ background: `linear-gradient(90deg, ${entry.ramp.from}, ${entry.ramp.to})` }}
                    />
                    <span className="map-legend-stop">{entry.items[entry.items.length - 1]?.label}</span>
                </div>
            ) : (
                <ul className="map-legend-list">
                    {entry.items.map((item, index) => (
                        <li className="map-legend-row" key={`${item.label}-${index}`}>
                            <LegendSwatch item={item} />
                            <span className="map-legend-label" title={item.label}>{item.label}</span>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

export function MapLegend({ entries }) {
    if (!entries?.length) return null;
    return (
        <aside className="map-legend" aria-label="Legend" data-map-legend="true">
            <div className="map-legend-title">Legend</div>
            {entries.map((entry) => (
                <section
                    key={entry.id}
                    className="map-legend-entry"
                    data-layer-id={entry.id}
                    data-symbology={entry.symbology}
                >
                    <LegendBody entry={entry} />
                </section>
            ))}
        </aside>
    );
}
