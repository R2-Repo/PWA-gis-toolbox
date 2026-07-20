/**
 * Atlas | GIS Toolbox tabs for left/right panels.
 */
export function WorkspaceTabs({ mode, atlasAvailable, onChange }) {
    if (!atlasAvailable) return null;
    return (
        <div className="atlas-workspace-tabs" role="tablist" aria-label="Workspace">
            <button
                type="button"
                role="tab"
                className={`atlas-workspace-tab${mode === 'atlas' ? ' active' : ''}`}
                aria-selected={mode === 'atlas'}
                onClick={() => onChange?.('atlas')}
            >
                Atlas
            </button>
            <button
                type="button"
                role="tab"
                className={`atlas-workspace-tab${mode === 'gis' ? ' active' : ''}`}
                aria-selected={mode === 'gis'}
                onClick={() => onChange?.('gis')}
            >
                GIS Toolbox
            </button>
        </div>
    );
}
