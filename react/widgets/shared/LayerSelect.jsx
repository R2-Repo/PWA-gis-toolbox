export function LayerSelect({
    label = 'Layer',
    value,
    onChange,
    layers = [],
    placeholder = '- select layer -',
    allowEmpty = true,
    formatOption = (layer) => `${layer.name} (${layer.featureCount ?? layer.count ?? 0})`,
    className = '',
    headerExtra = null,
    selectExtra = null
}) {
    const select = (
        <select value={value} onChange={(e) => onChange?.(e.target.value)}>
            {allowEmpty ? <option value="">{placeholder}</option> : null}
            {layers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                    {formatOption(layer)}
                </option>
            ))}
        </select>
    );

    return (
        <div className={['form-group', className].filter(Boolean).join(' ')}>
            {headerExtra ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <label style={{ marginBottom: 0, flex: 1 }}>{label}</label>
                    {headerExtra}
                </div>
            ) : (
                <label>{label}</label>
            )}
            {selectExtra ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>{select}</div>
                    {selectExtra}
                </div>
            ) : (
                select
            )}
        </div>
    );
}
