import { useState } from 'react';
import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';
import { UGRC_DEVELOPER_URL } from '../../js/ugrc/config.js';

export function UgrcKeySettingsDialog({
    initialKey = '',
    hasEnvKey = false,
    onCancel,
    onSave,
    onClear
}) {
    const [apiKey, setApiKey] = useState(initialKey);
    const trimmed = apiKey.trim();

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={() => onSave?.(trimmed)}
            runLabel="Save key"
            disabled={!trimmed}
            footer={(
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => onCancel?.()}>
                        Cancel
                    </button>
                    {(initialKey || trimmed) ? (
                        <button type="button" className="btn btn-secondary" onClick={() => onClear?.()}>
                            Clear
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!trimmed}
                        onClick={() => onSave?.(trimmed)}
                    >
                        Save key
                    </button>
                </div>
            )}
        >
            <p className="text-xs text-muted" style={{ marginBottom: 12, lineHeight: 1.45 }}>
                Reverse route &amp; milepost uses the UGRC API and only works near{' '}
                <strong>UDOT state routes and interstates</strong>, not city streets.
            </p>
            <p className="text-xs text-muted" style={{ marginBottom: 12, lineHeight: 1.45 }}>
                The public PWA uses an app-owned browser key. You can paste a personal key from{' '}
                <a href={UGRC_DEVELOPER_URL} target="_blank" rel="noopener noreferrer">
                    developer.mapserv.utah.gov
                </a>
                .
                {hasEnvKey ? ' An app key is already configured for this build; a saved key overrides it.' : ''}
            </p>
            <div className="form-group">
                <label htmlFor="ugrc-api-key-input">UGRC API key</label>
                <input
                    id="ugrc-api-key-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste API key"
                />
            </div>
        </WidgetPanelShell>
    );
}
