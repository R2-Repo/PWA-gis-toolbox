import { useCallback, useEffect, useRef, useState } from 'react';

export function CollapsibleSection({
    title,
    children,
    defaultOpen = true,
    expandWhen = false,
    className = '',
    bodyClassName = '',
    bodyId = null,
    onCollapsedChange = null
}) {
    const [collapsed, setCollapsed] = useState(!defaultOpen);
    const collapsedRef = useRef(collapsed);
    const prevExpandWhen = useRef(expandWhen);
    collapsedRef.current = collapsed;

    useEffect(() => {
        if (expandWhen && !prevExpandWhen.current) {
            collapsedRef.current = false;
            setCollapsed(false);
            onCollapsedChange?.(false);
        }
        prevExpandWhen.current = expandWhen;
    }, [expandWhen, onCollapsedChange]);

    const toggle = useCallback(() => {
        const next = !collapsedRef.current;
        collapsedRef.current = next;
        setCollapsed(next);
        onCollapsedChange?.(next);
    }, [onCollapsedChange]);

    const onKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
    }, [toggle]);

    return (
        <div className={`panel-section${className ? ` ${className}` : ''}`}>
            <div
                className={`panel-section-header${collapsed ? ' collapsed' : ''}`}
                data-collapsible="true"
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={onKeyDown}
            >
                <span>{title}</span>
                <span className="arrow">▼</span>
            </div>
            <div
                id={bodyId || undefined}
                className={`panel-section-body${collapsed ? ' hidden' : ''}${bodyClassName ? ` ${bodyClassName}` : ''}`}
            >
                {children}
            </div>
        </div>
    );
}
