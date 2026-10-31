import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import bus from '../../js/core/event-bus.js';
import { NODE_CATEGORIES } from '../../js/workflow/node-catalog.js';
import { getTool, isVisible } from '../../js/tools/tool-registry.js';

const TOOLTIP_MARGIN = 8;
const TOOLTIP_GAP = 10;

function computeTooltipPosition(anchorRect, tooltipSize) {
    const { width, height } = tooltipSize;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchorRect.right + TOOLTIP_GAP;
    if (left + width > vw - TOOLTIP_MARGIN) {
        left = anchorRect.left - width - TOOLTIP_GAP;
    }
    left = Math.max(TOOLTIP_MARGIN, Math.min(left, vw - width - TOOLTIP_MARGIN));

    let top = anchorRect.top + anchorRect.height / 2 - height / 2;
    top = Math.max(TOOLTIP_MARGIN, Math.min(top, vh - height - TOOLTIP_MARGIN));

    return { left, top };
}

function PaletteItem({ def, categoryKey, onTooltipShow, onTooltipHide }) {
    const itemRef = useRef(null);
    const description = def.description || '';

    const onDragStart = useCallback((e) => {
        onTooltipHide?.();
        e.dataTransfer.setData('application/x-wf-node', JSON.stringify({ type: def.type, category: categoryKey }));
        e.dataTransfer.effectAllowed = 'copy';
    }, [def.type, categoryKey, onTooltipHide]);

    const onClick = useCallback(() => {
        bus.emit('workflow:palette-add', { type: def.type, category: categoryKey });
    }, [def.type, categoryKey]);

    const showTooltip = useCallback(() => {
        if (!description || !itemRef.current) return;
        onTooltipShow?.(itemRef.current, description);
    }, [description, onTooltipShow]);

    const hideTooltip = useCallback(() => {
        onTooltipHide?.();
    }, [onTooltipHide]);

    return (
        <div
            ref={itemRef}
            className="wf-palette-item"
            draggable
            onDragStart={onDragStart}
            onClick={onClick}
            onMouseEnter={showTooltip}
            onMouseLeave={hideTooltip}
            onFocus={showTooltip}
            onBlur={hideTooltip}
            role="button"
            tabIndex={0}
            aria-label={description ? `${def.label}: ${description}` : def.label}
            onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        >
            <span className="wf-palette-icon">{def.icon}</span>
            <span>{def.label}</span>
        </div>
    );
}

function PaletteTooltip({ anchorEl, text, tooltipRef }) {
    const [position, setPosition] = useState({ left: 0, top: 0 });

    const updatePosition = useCallback(() => {
        if (!anchorEl) return;
        const anchorRect = anchorEl.getBoundingClientRect();
        const tooltipEl = tooltipRef.current;
        const size = tooltipEl
            ? { width: tooltipEl.offsetWidth, height: tooltipEl.offsetHeight }
            : { width: 260, height: 48 };
        setPosition(computeTooltipPosition(anchorRect, size));
    }, [anchorEl, tooltipRef]);

    useLayoutEffect(() => {
        updatePosition();
    }, [updatePosition, text]);

    useEffect(() => {
        const onReposition = () => updatePosition();
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        return () => {
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        };
    }, [updatePosition]);

    return createPortal(
        <div
            ref={tooltipRef}
            className="wf-palette-tooltip-portal"
            style={{ left: position.left, top: position.top }}
            role="tooltip"
        >
            {text}
        </div>,
        document.body
    );
}

export function WorkflowPalette() {
    const [collapsed, setCollapsed] = useState({});
    const [tooltip, setTooltip] = useState(null);
    const paletteRef = useRef(null);
    const tooltipRef = useRef(null);

    const visibleCategories = useMemo(() => {
        return NODE_CATEGORIES.map((cat) => ({
            ...cat,
            visibleNodes: cat.nodes.filter((def) => isVisible(getTool(def.type), 'palette'))
        })).filter((cat) => cat.visibleNodes.length > 0);
    }, []);

    const toggleCategory = useCallback((key) => {
        setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const showTooltip = useCallback((anchorEl, text) => {
        setTooltip({ anchorEl, text });
    }, []);

    const hideTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    useEffect(() => {
        const paletteEl = paletteRef.current;
        if (!paletteEl || !tooltip) return undefined;

        const onPaletteScroll = () => hideTooltip();
        paletteEl.addEventListener('scroll', onPaletteScroll, { passive: true });
        return () => paletteEl.removeEventListener('scroll', onPaletteScroll);
    }, [tooltip, hideTooltip]);

    return (
        <>
            <div className="wf-palette" ref={paletteRef}>
                <div className="wf-palette-title">Nodes</div>
                {visibleCategories.map((cat) => (
                    <div key={cat.key} className="wf-palette-section">
                        <div
                            className="wf-palette-cat-header"
                            onClick={() => toggleCategory(cat.key)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') toggleCategory(cat.key); }}
                        >
                            <span className={`wf-palette-arrow${collapsed[cat.key] ? ' collapsed' : ''}`}>▾</span>
                            <span style={{ color: cat.color, fontWeight: 600 }}>{cat.label}</span>
                        </div>
                        {!collapsed[cat.key] && (
                            <div className="wf-palette-list">
                                {cat.visibleNodes.map((def) => (
                                    <PaletteItem
                                        key={def.type}
                                        def={def}
                                        categoryKey={cat.key}
                                        onTooltipShow={showTooltip}
                                        onTooltipHide={hideTooltip}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {tooltip ? (
                <PaletteTooltip
                    anchorEl={tooltip.anchorEl}
                    text={tooltip.text}
                    tooltipRef={tooltipRef}
                />
            ) : null}
        </>
    );
}
