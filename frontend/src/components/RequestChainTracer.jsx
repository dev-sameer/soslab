import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    GitBranch, AlertCircle, CheckCircle, Zap, Database,
    Server, Globe, Layers, Activity, ChevronRight, ChevronDown,
    Search, X, Loader2, AlertTriangle, Info, Target, ZoomIn, ZoomOut
} from 'lucide-react';

const API_BASE = '/api/tracer';

// Component icons mapping
const COMPONENT_ICONS = {
    rails: Globe,
    sidekiq: Layers,
    gitaly: Database,
    praefect: Server,
    postgresql: Database,
    redis: Zap,
    nginx: Globe,
    workhorse: Activity,
    system: Server,
};

// Event type icons
const EVENT_TYPE_ICONS = {
    request_start: GitBranch,
    request_end: CheckCircle,
    job_enqueue: Layers,
    job_start: Activity,
    job_end: CheckCircle,
    job_fail: AlertCircle,
    rpc_call: Database,
    rpc_success: CheckCircle,
    rpc_error: AlertCircle,
    query_execute: Database,
    query_complete: CheckCircle,
    query_error: AlertCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    generic: Info,
};

// Severity colors
const SEVERITY_COLORS = {
    CRITICAL: { bg: '#dc2626', text: '#fca5a5', dot: '#dc2626' },
    FATAL: { bg: '#dc2626', text: '#fca5a5', dot: '#dc2626' },
    ERROR: { bg: '#ea580c', text: '#fdba74', dot: '#ea580c' },
    WARNING: { bg: '#ca8a04', text: '#fde047', dot: '#ca8a04' },
    INFO: { bg: '#2563eb', text: '#93c5fd', dot: '#2563eb' },
    DEBUG: { bg: '#64748b', text: '#cbd5e1', dot: '#64748b' },
};

const getSeverityColor = (severity) => SEVERITY_COLORS[severity?.toUpperCase()] || SEVERITY_COLORS.DEBUG;
const getComponentIcon = (component) => COMPONENT_ICONS[component?.toLowerCase()] || Server;
const getEventTypeIcon = (eventType) => EVENT_TYPE_ICONS[eventType?.toLowerCase()] || Info;

// Format duration
const formatDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
};

// Format timestamp
const formatTime = (isoString) => {
    if (!isoString) return '-';
    try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });
    } catch {
        return isoString;
    }
};

// Copy to clipboard hook
const useCopyToClipboard = () => {
    const [copied, setCopied] = useState(false);

    const copy = useCallback((text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, []);

    return { copied, copy };
};

// ============================================================================
// SWIMLANE VIEW - MASSIVE CANVAS WITH ZOOM
// ============================================================================

function SwimlaneView({ events, criticalPath }) {
    const [zoom, setZoom] = useState(3);
    const [expandedEvent, setExpandedEvent] = useState(null);
    const criticalEventIds = useMemo(() => new Set(criticalPath.map(e => e.event_id)), [criticalPath]);
    const eventsByComponent = useMemo(() => { const g = {}; events.forEach(e => { if (!g[e.component]) g[e.component] = []; g[e.component].push(e); }); return g; }, [events]);
    const timeRange = useMemo(() => { if (!events.length) return { start: 0, end: 1000, duration: 1000 }; const s = new Date(events[0].timestamp).getTime(); const e = new Date(events[events.length - 1].timestamp).getTime(); return { start: s, end: e, duration: e - s }; }, [events]);
    const getPos = (e) => { const t = new Date(e.timestamp).getTime(); return Math.max(0, Math.min(100, ((t - timeRange.start) / timeRange.duration) * 100)); };
    const components = Object.keys(eventsByComponent).sort();

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between px-6 py-3 rounded-full" style={{ border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Zoom</span>
                    <div className="flex items-center gap-2 p-1 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                        <button onClick={() => setZoom(Math.max(1, zoom - 1))} className="px-4 py-2 rounded-full font-semibold flex items-center gap-2 smooth-transition" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><ZoomOut className="w-4 h-4" /> Out</button>
                        <span className="px-5 py-2 rounded-full font-bold text-sm" style={{ background: 'var(--accent)', color: 'var(--bg-primary)', minWidth: '60px', textAlign: 'center' }}>{zoom}x</span>
                        <button onClick={() => setZoom(Math.min(20, zoom + 1))} className="px-4 py-2 rounded-full font-semibold flex items-center gap-2 smooth-transition" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><ZoomIn className="w-4 h-4" /> In</button>
                    </div>
                    <button onClick={() => setZoom(3)} className="px-4 py-2 rounded-full text-sm smooth-transition" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>Reset</button>
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>💡 Scroll horizontally • Zoom up to 20x</div>
            </div>

            <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-primary)', maxHeight: '70vh' }}>
                <div style={{ minWidth: `${100 * zoom}%`, width: `${100 * zoom}%` }}>
                    <div className="relative px-8 py-5 sticky top-0 z-30" style={{ height: '70px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)' }}>
                        <div className="absolute left-8 right-8 top-10 h-px" style={{ background: 'var(--accent)' }} />
                        {Array.from({ length: Math.min(100, Math.ceil(zoom * 10)) }, (_, i) => {
                            const pct = (i / (Math.ceil(zoom * 10) - 1)) * 100;
                            return (
                                <div key={pct} className="absolute flex flex-col items-center" style={{ left: `calc(${pct}% + 2rem)`, top: 0, transform: 'translateX(-50%)' }}>
                                    <div className="w-px h-6" style={{ background: 'var(--accent)' }} />
                                    <span className="text-xs mt-2 font-mono font-semibold px-2 py-1 rounded-full" style={{ color: 'var(--text-primary)', background: 'var(--bg-primary)' }}>+{formatDuration((timeRange.duration * pct) / 100)}</span>
                                </div>
                            );
                        })}
                    </div>

                    {components.map(comp => {
                        const compEvents = eventsByComponent[comp];
                        const fullPath = compEvents[0]?.file_path || comp;
                        const relativePath = fullPath.split('/').slice(-3).join('/');

                        return (
                            <div key={comp} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                <div className="flex items-center gap-3 px-6 py-3 sticky left-0 z-20" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                                    <span className="font-bold font-mono truncate" style={{ color: 'var(--text-primary)', fontSize: '11px' }} title={fullPath}>{relativePath}</span>
                                    <span className="px-2 py-1 rounded-full font-semibold" style={{ background: 'var(--accent)', color: 'var(--bg-primary)', fontSize: '10px' }}>{compEvents.length}</span>
                                </div>
                                <div className="relative px-8" style={{ height: `${Math.max(100, 80 + zoom * 6)}px` }}>
                                    <div className="absolute left-8 right-8 top-1/2 h-px" style={{ background: 'var(--border-primary)', transform: 'translateY(-50%)' }} />
                                    {compEvents.map(evt => {
                                        const pos = getPos(evt);
                                        const isCrit = criticalEventIds.has(evt.event_id);
                                        const isExp = expandedEvent === evt.event_id;
                                        const color = getSeverityColor(evt.severity);
                                        const EvtIcon = getEventTypeIcon(evt.event_type);
                                        const size = Math.max(12, 10 + zoom * 1.5); // SMALLER DOTS
                                        return (
                                            <div key={evt.event_id} className="absolute" style={{ left: `calc(${pos}% + 2rem)`, top: '50%', transform: 'translate(-50%, -50%)', zIndex: isExp ? 100 : (isCrit ? 10 : 5) }}>
                                                <div onClick={() => setExpandedEvent(isExp ? null : evt.event_id)} className="relative cursor-pointer group">
                                                    <div className="rounded-full flex items-center justify-center smooth-transition hover:scale-125" style={{ width: `${size}px`, height: `${size}px`, background: color.dot, border: '2px solid var(--bg-primary)', boxShadow: isCrit ? `0 0 ${Math.max(8, 6 + zoom)}px ${color.dot}` : 'none', transform: isCrit ? 'scale(1.3)' : 'scale(1)' }}>
                                                        <EvtIcon style={{ width: `${size * 0.4}px`, height: `${size * 0.4}px`, color: 'white' }} />
                                                    </div>
                                                    {!isExp && (
                                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 opacity-0 group-hover:opacity-100 pointer-events-none smooth-transition" style={{ zIndex: 50 }}>
                                                            <div className="rounded-xl p-3 shadow-2xl" style={{ background: 'var(--bg-primary)', border: '2px solid var(--border-primary)', minWidth: '240px', maxWidth: '400px', fontSize: '11px' }}>
                                                                <div className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{evt.event_type.replace('_', ' ')}</div>
                                                                <div className="mb-2" style={{ color: 'var(--text-secondary)' }}>{evt.message.slice(0, 90)}</div>
                                                                <div className="truncate" style={{ color: '#06b6d4', fontSize: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }} title={evt.file_path}>{evt.file_path.split('/').slice(-3).join('/')}</div>
                                                                <div className="font-mono" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{formatTime(evt.timestamp)}</div>
                                                                {isCrit && <div className="mt-2 px-2 py-1 rounded-full inline-block font-bold" style={{ background: 'var(--accent)', color: 'var(--bg-primary)', fontSize: '10px' }}>⚡ CRITICAL</div>}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {isExp && (
                                                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-4 rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--bg-primary)', border: `3px solid ${isCrit ? 'var(--accent)' : color.dot}`, zIndex: 100, minWidth: '380px', maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-between mb-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: color.bg + '30', color: color.text }}>{evt.severity}</span>
                                                                    {isCrit && <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>⚡ CRITICAL</span>}
                                                                </div>
                                                                <button onClick={() => setExpandedEvent(null)} className="p-1 rounded-full smooth-transition" style={{ background: 'var(--bg-tertiary)' }}><X className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} /></button>
                                                            </div>
                                                            <div className="text-sm font-mono mb-4 break-all" style={{ color: 'var(--text-primary)' }}>{evt.message}</div>
                                                            <div className="grid grid-cols-2 gap-3 text-xs">
                                                                <div><span className="font-semibold" style={{ color: 'var(--text-tertiary)' }}>Time:</span> <div className="font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{formatTime(evt.timestamp)}</div></div>
                                                                {evt.duration_ms && <div><span className="font-semibold" style={{ color: 'var(--text-tertiary)' }}>Duration:</span> <div className="font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{formatDuration(evt.duration_ms)}</div></div>}
                                                                {evt.job_class && <div className="col-span-2"><span className="font-semibold" style={{ color: 'var(--text-tertiary)' }}>Job:</span> <div className="font-mono mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>{evt.job_class}</div></div>}
                                                                {evt.http_status && <div><span className="font-semibold" style={{ color: 'var(--text-tertiary)' }}>Status:</span> <div className="font-mono mt-1" style={{ color: evt.http_status >= 500 ? '#dc2626' : evt.http_status >= 400 ? '#ea580c' : '#22c55e' }}>{evt.http_status}</div></div>}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// EVENT TIMELINE VISUALIZATION
// ============================================================================

function EventTimeline({ events, criticalPath, onEventClick }) {
    const [expandedEvents, setExpandedEvents] = useState(new Set());

    const toggleEvent = (eventId) => {
        setExpandedEvents(prev => {
            const next = new Set(prev);
            if (next.has(eventId)) {
                next.delete(eventId);
            } else {
                next.add(eventId);
            }
            return next;
        });
    };

    const expandAll = () => {
        setExpandedEvents(new Set(events.map(e => e.event_id)));
    };

    const collapseAll = () => {
        setExpandedEvents(new Set());
    };

    const criticalEventIds = useMemo(() =>
        new Set(criticalPath.map(e => e.event_id)),
        [criticalPath]
    );

    return (
        <div className="space-y-2">
            {/* Expand/Collapse controls */}
            <div className="flex items-center justify-end gap-2 mb-3">
                <div className="flex items-center gap-1 p-0.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                    <button onClick={expandAll} className="px-3 py-1 rounded-full text-xs font-semibold smooth-transition" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Expand All</button>
                    <button onClick={collapseAll} className="px-3 py-1 rounded-full text-xs font-semibold smooth-transition" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Collapse All</button>
                </div>
            </div>

            {events.map((event, idx) => {
                const isCritical = criticalEventIds.has(event.event_id);
                const isExpanded = expandedEvents.has(event.event_id);
                const severityColor = getSeverityColor(event.severity);
                const EventIcon = getEventTypeIcon(event.event_type);
                const ComponentIcon = getComponentIcon(event.component);

                return (
                    <div
                        key={event.event_id}
                        className="relative"
                    >
                        {/* Connecting line */}
                        {idx < events.length - 1 && (
                            <div
                                className="absolute left-4 top-8 w-0.5 h-full"
                                style={{
                                    background: isCritical ? 'var(--accent)' : 'var(--border-primary)',
                                    opacity: isCritical ? 1 : 0.3
                                }}
                            />
                        )}

                        {/* Event card */}
                        <div
                            onClick={() => toggleEvent(event.event_id)}
                            className="relative pl-10 cursor-pointer"
                        >
                            {/* Timeline dot */}
                            <div
                                className="absolute left-2.5 w-3 h-3 rounded-full border-2 z-10"
                                style={{
                                    background: severityColor.dot,
                                    borderColor: 'var(--bg-primary)',
                                    boxShadow: isCritical ? `0 0 8px ${severityColor.dot}` : 'none'
                                }}
                            />

                            {/* Event content - NO BACKGROUND */}
                            <div
                                className="rounded-lg p-3 smooth-transition"
                                style={{
                                    border: `1px solid ${isCritical ? 'var(--accent)' : 'var(--border-primary)'}`,
                                    borderLeftWidth: isCritical ? '3px' : '1px'
                                }}
                            >
                                {/* Header - RELATIVE PATH, TINY TEXT */}
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="truncate" style={{ color: '#06b6d4', fontSize: '10px', lineHeight: '1.2', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }} title={event.file_path}>
                                            {event.file_path.split('/').slice(-3).join('/')}
                                            <span style={{ color: '#06b6d4', marginLeft: '4px' }}>L{event.line_number}</span>
                                        </div>
                                    </div>

                                    <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                                        {formatTime(event.timestamp)}
                                    </span>
                                </div>

                                {/* Message - CLEAN */}
                                <div className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                                    {event.message}
                                </div>

                                {/* Expanded details */}
                                {isExpanded && (
                                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
                                        <div className="text-xs">
                                            <code className="block p-2 rounded-lg font-mono text-xs break-all" style={{
                                                border: '1px solid var(--border-primary)',
                                                color: 'var(--text-primary)'
                                            }}>
                                                {event.raw_line}
                                            </code>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ============================================================================
// CHAIN SUMMARY
// ============================================================================

function ChainSummary({ chain }) {
    const { copied, copy } = useCopyToClipboard();

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="rounded-xl p-4" style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)'
            }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <GitBranch className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                        <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                            Request Chain
                        </h3>
                    </div>

                    <button
                        onClick={() => copy(chain.correlation_id)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs smooth-transition"
                        style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-secondary)'
                        }}
                    >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <code className="font-mono">{chain.correlation_id.slice(0, 8)}...</code>
                    </button>
                </div>

                {/* Key metrics */}
                <div className="grid grid-cols-4 gap-3">
                    <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            {chain.event_count}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Events</div>
                    </div>

                    <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            {formatDuration(chain.total_duration_ms)}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Duration</div>
                    </div>

                    <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="text-2xl font-bold mb-1" style={{ color: chain.error_count > 0 ? '#dc2626' : '#22c55e' }}>
                            {chain.error_count}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Errors</div>
                    </div>

                    <div className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            {Object.keys(chain.by_component).length}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Components</div>
                    </div>
                </div>
            </div>

            {/* Root cause */}
            {chain.root_cause && (
                <div className="rounded-xl p-4" style={{
                    background: '#dc262610',
                    border: '2px solid #dc2626'
                }}>
                    <div className="flex items-start gap-3">
                        <Target className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm mb-1 text-red-500">
                                Root Cause Identified
                            </div>
                            <div className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
                                {chain.root_cause.message}
                            </div>
                            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                <span>{chain.root_cause.component}</span>
                                <span>•</span>
                                <span>{formatTime(chain.root_cause.timestamp)}</span>
                                <span>•</span>
                                <span className="font-mono" style={{ color: '#06b6d4', fontSize: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>{chain.root_cause.file_path.split('/').pop()}:L{chain.root_cause.line_number}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Component breakdown */}
            {Object.keys(chain.component_breakdown).length > 0 && (
                <div className="rounded-xl p-4" style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)'
                }}>
                    <div className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                        Time Distribution
                    </div>
                    <div className="space-y-2">
                        {Object.entries(chain.component_breakdown)
                            .sort((a, b) => b[1] - a[1])
                            .map(([component, time_ms]) => {
                                const percentage = (time_ms / chain.total_duration_ms) * 100;
                                const ComponentIcon = getComponentIcon(component);

                                return (
                                    <div key={component}>
                                        <div className="flex items-center justify-between mb-1 text-xs">
                                            <div className="flex items-center gap-1.5">
                                                <ComponentIcon className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                                                <span style={{ color: 'var(--text-primary)' }}>{component}</span>
                                            </div>
                                            <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                                                {formatDuration(time_ms)} ({percentage.toFixed(1)}%)
                                            </span>
                                        </div>
                                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                            <div
                                                className="h-full smooth-transition"
                                                style={{
                                                    width: `${percentage}%`,
                                                    background: 'var(--accent)'
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RequestChainTracer() {
    const [correlationId, setCorrelationId] = useState('');
    const [chain, setChain] = useState(null);
    const [isTracing, setIsTracing] = useState(false);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('timeline'); // timeline | swimlane

    const handleTrace = async (corrId = correlationId) => {
        if (!corrId.trim()) return;

        setIsTracing(true);
        setError(null);
        setChain(null);

        try {
            const response = await fetch(`${API_BASE}/trace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ correlation_id: corrId.trim() })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Trace failed');
            }

            if (data.success) {
                setChain(data.chain);
            } else {
                throw new Error('Trace failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsTracing(false);
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
            <div className="w-full h-full p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            Request Chain Tracer
                        </h1>
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                            Distributed request tracing with causal analysis
                        </p>
                    </div>

                    {/* View mode toggle */}
                    {chain && (
                        <div className="flex items-center gap-1 p-0.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                            <button onClick={() => setViewMode('timeline')} className="px-3 py-1 rounded-full text-xs font-semibold smooth-transition" style={{ background: viewMode === 'timeline' ? 'var(--accent)' : 'transparent', color: viewMode === 'timeline' ? 'var(--bg-primary)' : 'var(--text-secondary)' }}>Timeline</button>
                            <button onClick={() => setViewMode('swimlane')} className="px-3 py-1 rounded-full text-xs font-semibold smooth-transition" style={{ background: viewMode === 'swimlane' ? 'var(--accent)' : 'transparent', color: viewMode === 'swimlane' ? 'var(--bg-primary)' : 'var(--text-secondary)' }}>Swimlane</button>
                        </div>
                    )}
                </div>

                {/* Error display */}
                {error && (
                    <div className="rounded-xl p-3 flex items-center gap-2" style={{
                        background: '#dc262610',
                        border: '1px solid #dc2626'
                    }}>
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <span className="text-sm text-red-500 flex-1">{error}</span>
                        <button onClick={() => setError(null)}>
                            <X className="w-4 h-4 text-red-500" />
                        </button>
                    </div>
                )}

                {/* Search section - NO BOX, CLEAN */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Enter correlation ID..."
                        value={correlationId}
                        onChange={(e) => setCorrelationId(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleTrace()}
                        className="flex-1 px-4 py-2 rounded-full text-sm font-mono focus:outline-none"
                        style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-primary)'
                        }}
                    />
                    <button
                        onClick={() => handleTrace()}
                        disabled={!correlationId.trim() || isTracing}
                        className="px-5 py-2 rounded-full text-xs font-semibold smooth-transition"
                        style={{
                            background: correlationId.trim() && !isTracing ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: correlationId.trim() && !isTracing ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                            cursor: !correlationId.trim() || isTracing ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isTracing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            'Trace'
                        )}
                    </button>
                </div>

                {/* Loading state */}
                {isTracing && (
                    <div className="rounded-xl p-8 text-center" style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)'
                    }}>
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: 'var(--accent)' }} />
                        <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                            Tracing Request Chain
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            Building DAG and analyzing causality...
                        </div>
                    </div>
                )}

                {/* Results - CLEAN, NO BOXES */}
                {chain && !isTracing && (
                    <div className="space-y-4">
                        {/* Metrics - just text */}
                        <div className="flex items-center gap-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            <span>Events: <strong style={{ color: 'var(--text-primary)' }}>{chain.event_count}</strong></span>
                            <span>Duration: <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(chain.total_duration_ms)}</strong></span>
                            <span>Errors: <strong style={{ color: chain.error_count > 0 ? '#dc2626' : '#22c55e' }}>{chain.error_count}</strong></span>
                            {chain.root_cause && <span>Root: <strong className="text-red-500">{chain.root_cause.component}</strong></span>}
                        </div>

                        {/* Visualization */}
                        {viewMode === 'timeline' ? (
                            <EventTimeline events={chain.events} criticalPath={chain.critical_path} />
                        ) : (
                            <SwimlaneView events={chain.events} criticalPath={chain.critical_path} />
                        )}
                    </div>
                )}

                {/* Empty state - NO BOX */}
                {!chain && !isTracing && !error && (
                    <div className="text-center py-16">
                        <GitBranch className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                        <div className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                            Trace Distributed Requests
                        </div>
                        <div className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                            Enter a correlation ID to trace the complete request chain
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
