import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Search, X, Plus, ChevronDown, ChevronRight, FileText, Database,
    Server, Globe, Zap, Copy, Check, Layers, AlertTriangle, AlertCircle,
    Terminal, Sparkles, Brain, Loader2, RefreshCw, ChevronUp, Play,
    Send, Cpu, HardDrive, Activity, Box, GitBranch, Package, Filter
} from 'lucide-react';

const API_BASE = '/api/loggrep';

const COMPONENT_ICONS = {
    sidekiq: Layers,
    rails: Globe,
    gitaly: Database,
    praefect: Server,
    postgresql: Database,
    redis: Zap,
    nginx: Globe,
    workhorse: Activity,
    registry: Package,
    consul: Box,
    geo: GitBranch,
    kubernetes: Cpu,
    system: Server,
    pages: FileText,
};

const SEVERITY_CONFIG = {
    CRITICAL: { bg: '#dc2626', text: '#fca5a5', bgLight: 'rgba(220, 38, 38, 0.1)', border: 'rgba(220, 38, 38, 0.3)' },
    FATAL: { bg: '#dc2626', text: '#fca5a5', bgLight: 'rgba(220, 38, 38, 0.1)', border: 'rgba(220, 38, 38, 0.3)' },
    ERROR: { bg: '#ea580c', text: '#fdba74', bgLight: 'rgba(234, 88, 12, 0.1)', border: 'rgba(234, 88, 12, 0.3)' },
    WARNING: { bg: '#ca8a04', text: '#fde047', bgLight: 'rgba(202, 138, 4, 0.1)', border: 'rgba(202, 138, 4, 0.3)' },
    WARN: { bg: '#ca8a04', text: '#fde047', bgLight: 'rgba(202, 138, 4, 0.1)', border: 'rgba(202, 138, 4, 0.3)' },
    INFO: { bg: '#2563eb', text: '#93c5fd', bgLight: 'rgba(37, 99, 235, 0.1)', border: 'rgba(37, 99, 235, 0.3)' },
    DEBUG: { bg: '#64748b', text: '#cbd5e1', bgLight: 'rgba(100, 116, 139, 0.1)', border: 'rgba(100, 116, 139, 0.3)' },
    UNKNOWN: { bg: '#64748b', text: '#cbd5e1', bgLight: 'rgba(100, 116, 139, 0.1)', border: 'rgba(100, 116, 139, 0.3)' },
};

const DEFAULT_SMART_PATTERNS = {
    'Critical': [
        { name: 'Failovers', pattern: 'failover|promoted to leader|demoted', desc: 'Database/cluster failovers' },
        { name: 'Out of Memory', pattern: 'Out of memory|OOM killer|Cannot allocate', desc: 'Memory exhaustion' },
    ],
    'Errors': [
        { name: 'All Errors', pattern: 'error|fail|exception', desc: 'General error matching' },
        { name: 'Connection Issues', pattern: 'connection refused|timeout|ECONNREFUSED', desc: 'Network problems' },
    ],
    'Sidekiq': [
        { name: 'Failed Jobs', pattern: '"job_status".*"fail"', desc: 'Sidekiq job failures' },
        { name: 'Exceptions', pattern: '"exception.class"', desc: 'Job exceptions' },
    ],
    'Database': [
        { name: 'Connection Errors', pattern: 'PG::ConnectionBad|could not connect', desc: 'DB connection issues' },
        { name: 'Deadlocks', pattern: 'deadlock detected', desc: 'Database deadlocks' },
    ],
};

const getSeverityConfig = (severity) => SEVERITY_CONFIG[severity?.toUpperCase()] || SEVERITY_CONFIG.UNKNOWN;
const formatNumber = (num) => num >= 1000000 ? (num / 1000000).toFixed(1) + 'M' : num >= 1000 ? (num / 1000).toFixed(1) + 'K' : String(num || 0);
const formatBytes = (bytes) => bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + ' GB' : bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
const getComponentIcon = (component) => {
    const IconComponent = COMPONENT_ICONS[component?.toLowerCase()] || Server;
    return <IconComponent className="w-3 h-3" />;
};

const useApi = () => {
    const fetchApi = useCallback(async (endpoint, options = {}) => {
        const response = await fetch(API_BASE + endpoint, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        });
        if (!response.ok) throw new Error('API error: ' + response.status);
        return response.json();
    }, []);
    return { fetchApi };
};

// Sleek Session Selector
function SessionSelector({ sessions, selectedSessions, onSelectionChange, loading }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer" style={{ background: 'var(--bg-tertiary)' }} onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-2">
                    <HardDrive className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>Sessions</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                        {selectedSessions.length}/{sessions.length}
                    </span>
                </div>
                {expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
            </div>

            {expanded && (
                <div className="p-2">
                    <div className="flex gap-1.5 mb-2 pb-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <button onClick={() => onSelectionChange(sessions.map(s => s.session_id))} className="text-xs px-2 py-1 rounded-lg font-medium" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>All</button>
                        <button onClick={() => onSelectionChange([])} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>None</button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-secondary)' }} />
                        </div>
                    ) : (
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                            {sessions.map(session => (
                                <label key={session.session_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer smooth-transition" style={{ background: selectedSessions.includes(session.session_id) ? 'var(--bg-tertiary)' : 'transparent' }}>
                                    <input type="checkbox" checked={selectedSessions.includes(session.session_id)} onChange={() => {
                                        const newSelection = selectedSessions.includes(session.session_id) ? selectedSessions.filter(s => s !== session.session_id) : [...selectedSessions, session.session_id];
                                        onSelectionChange(newSelection);
                                    }} className="w-3 h-3" style={{ accentColor: 'var(--accent)' }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{session.session_id}</div>
                                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{session.file_count} files · {formatBytes(session.total_size)}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Component Selector - Recursive coverage at component level
function ComponentSelector({ components, selectedComponents, onSelectionChange, loading }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer" style={{ background: 'var(--bg-tertiary)' }} onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-2">
                    <Layers className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>Components</span>
                    {selectedComponents.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>{selectedComponents.length}</span>
                    )}
                </div>
                {expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
            </div>

            {expanded && (
                <div className="p-2">
                    <div className="flex gap-1.5 mb-2 pb-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <button onClick={() => onSelectionChange(components.map(c => c.name))} className="text-xs px-2 py-1 rounded-lg font-medium" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>All</button>
                        <button onClick={() => onSelectionChange([])} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>None</button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-secondary)' }} />
                        </div>
                    ) : (
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                            {components.map(component => (
                                <label key={component.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer smooth-transition" style={{ background: selectedComponents.includes(component.name) ? 'var(--bg-tertiary)' : 'transparent' }}>
                                    <input type="checkbox" checked={selectedComponents.includes(component.name)} onChange={() => {
                                        const newSelection = selectedComponents.includes(component.name) ? selectedComponents.filter(c => c !== component.name) : [...selectedComponents, component.name];
                                        onSelectionChange(newSelection);
                                    }} className="w-3 h-3" style={{ accentColor: 'var(--accent)' }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            {getComponentIcon(component.name)}
                                            <span className="text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{component.name}</span>
                                        </div>
                                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{component.file_count} files · {component.session_count} sessions</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Sleek Pipeline Builder
function PipelineBuilder({ pipeline, onChange, smartPatterns, onExecute, isExecuting }) {
    const [showPatterns, setShowPatterns] = useState(false);

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>Pipeline</span>
                </div>
                <button onClick={() => setShowPatterns(!showPatterns)} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium smooth-transition" style={{
                    background: showPatterns ? 'var(--accent)' : 'var(--bg-primary)',
                    color: showPatterns ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-primary)'
                }}>
                    <Sparkles className="w-3 h-3" />
                    Patterns
                </button>
            </div>

            {showPatterns && (
                <div className="p-3" style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)' }}>
                    <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                        {Object.entries(smartPatterns).map(([category, patterns]) => (
                            <div key={category}>
                                <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{category}</div>
                                <div className="space-y-1">
                                    {patterns.map((pattern, idx) => (
                                        <button key={idx} onClick={() => onChange([...pipeline, { id: Date.now(), type: 'include', pattern: pattern.pattern, case_insensitive: true, regex: true }])} className="w-full text-left px-2 py-1.5 rounded-lg smooth-transition" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                                            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{pattern.name}</div>
                                            <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{pattern.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="p-2 space-y-1.5">
                {pipeline.length === 0 ? (
                    <div className="text-xs text-center py-3" style={{ color: 'var(--text-tertiary)' }}>Add patterns to build pipeline</div>
                ) : (
                    pipeline.map((step, idx) => (
                        <div key={step.id} className="flex items-center gap-1.5 p-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                            {idx > 0 && <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>|</span>}
                            <select value={step.type} onChange={(e) => onChange(pipeline.map(s => s.id === step.id ? { ...s, type: e.target.value } : s))} className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{
                                background: step.type === 'include' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: step.type === 'include' ? '#22c55e' : '#ef4444',
                                border: 'none'
                            }}>
                                <option value="include">grep</option>
                                <option value="exclude">grep -v</option>
                            </select>
                            <input type="text" value={step.pattern} onChange={(e) => onChange(pipeline.map(s => s.id === step.id ? { ...s, pattern: e.target.value } : s))} placeholder="pattern..." className="flex-1 px-2 py-1 rounded-lg text-xs font-mono focus:outline-none" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }} />
                            <button onClick={() => onChange(pipeline.map(s => s.id === step.id ? { ...s, case_insensitive: !s.case_insensitive } : s))} className="px-1.5 py-0.5 rounded-full text-xs font-medium" style={{
                                background: step.case_insensitive ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-primary)',
                                color: step.case_insensitive ? '#3b82f6' : 'var(--text-tertiary)',
                                border: '1px solid var(--border-primary)'
                            }} title="Case insensitive">Aa</button>
                            <button onClick={() => onChange(pipeline.filter(s => s.id !== step.id))} className="p-0.5" style={{ color: 'var(--text-tertiary)' }}><X className="w-3 h-3" /></button>
                        </div>
                    ))
                )}

                <div className="flex items-center gap-1.5 pt-1">
                    <button onClick={() => onChange([...pipeline, { id: Date.now(), type: 'include', pattern: '', case_insensitive: true, regex: true }])} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                        <Plus className="w-3 h-3" />Include
                    </button>
                    <button onClick={() => onChange([...pipeline, { id: Date.now(), type: 'exclude', pattern: '', case_insensitive: true, regex: true }])} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        <Plus className="w-3 h-3" />Exclude
                    </button>
                    <div className="flex-1" />
                    <button onClick={onExecute} disabled={pipeline.length === 0 || isExecuting} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full font-semibold text-xs smooth-transition" style={{
                        background: pipeline.length > 0 && !isExecuting ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: pipeline.length > 0 && !isExecuting ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                        cursor: pipeline.length === 0 || isExecuting ? 'not-allowed' : 'pointer'
                    }}>
                        {isExecuting ? <><Loader2 className="w-3 h-3 animate-spin" />Searching...</> : <><Play className="w-3 h-3" />Execute</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Sleek Stats Bar
function ResultsStats({ results, selectedCount, onSelectAll, onAnalyze, isAnalyzing }) {
    if (!results) return null;

    return (
        <div className="rounded-xl px-3 py-2 flex items-center justify-between" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                    <span style={{ color: 'var(--text-tertiary)' }}>Matches:</span>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(results.total_matches)}</span>
                </div>
                <div style={{ width: '1px', height: '12px', background: 'var(--border-primary)' }} />
                <div className="flex items-center gap-1">
                    <span style={{ color: 'var(--text-tertiary)' }}>Patterns:</span>
                    <span className="font-bold" style={{ color: 'var(--accent)' }}>{results.cluster_count}</span>
                </div>
                <div style={{ width: '1px', height: '12px', background: 'var(--border-primary)' }} />
                <div className="flex items-center gap-1.5">
                    {Object.entries(results.statistics?.by_severity || {}).map(([sev, count]) => {
                        const config = getSeverityConfig(sev);
                        return (
                            <span key={sev} className="px-1.5 py-0.5 rounded-full text-xs font-medium" style={{ background: config.bgLight, color: config.text, border: `1px solid ${config.border}` }}>
                                {sev}: {formatNumber(count)}
                            </span>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                <button onClick={onSelectAll} className="px-2 py-1 text-xs rounded-lg font-medium smooth-transition" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
                    Select Errors
                </button>
                <button onClick={onAnalyze} disabled={selectedCount === 0 || isAnalyzing} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold smooth-transition" style={{
                    background: selectedCount > 0 && !isAnalyzing ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: selectedCount > 0 && !isAnalyzing ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                    cursor: selectedCount === 0 || isAnalyzing ? 'not-allowed' : 'pointer'
                }}>
                    {isAnalyzing ? <><Loader2 className="w-3 h-3 animate-spin" />Analyzing...</> : <><Brain className="w-3 h-3" />Analyze ({selectedCount})</>}
                </button>
            </div>
        </div>
    );
}

// Clean Cluster Card - Inspired by RequestChainTracer
function ClusterCard({ cluster, isExpanded, isSelected, onToggleExpand, onToggleSelect }) {
    const config = getSeverityConfig(cluster.severity);
    const [expandedSamples, setExpandedSamples] = useState(new Set());

    return (
        <div className="rounded-lg smooth-transition overflow-hidden" style={{
            background: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            border: isSelected ? `2px solid ${config.bg}` : '1px solid var(--border-primary)',
            borderLeftWidth: isSelected ? '3px' : '1px'
        }}>
            {/* Header Section */}
            <div className="px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity" onClick={onToggleExpand}>
                <div className="flex items-start gap-2.5">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
                        className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
                        style={{ accentColor: config.bg }}
                    />

                    <div className="flex-1 min-w-0">
                        {/* Pattern Header - Badges Row */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-tertiary)', fontSize: '9px' }}>
                                #{cluster.cluster_id}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: config.bgLight, color: config.text, border: `1px solid ${config.border}`, fontSize: '9px' }}>
                                {cluster.severity}
                            </span>
                            {cluster.exception_class && (
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(234, 88, 12, 0.1)', color: '#fb923c', border: '1px solid rgba(234, 88, 12, 0.3)', fontSize: '9px' }}>
                                    {cluster.exception_class}
                                </span>
                            )}
                        </div>

                        {/* Pattern Template */}
                        <code className="text-xs font-mono block mb-2" style={{
                            color: 'var(--text-primary)',
                            lineHeight: '1.4',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                        }}>
                            {cluster.template}
                        </code>

                        {/* Meta Info Row */}
                        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '9px' }}>
                            <span>{Object.keys(cluster.files || {}).length} files</span>
                            <span>·</span>
                            <span>{cluster.samples?.length || 0} samples</span>
                            <div className="flex-1" />
                            <div className="flex items-center gap-2">
                                <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                                    {formatNumber(cluster.count)}
                                </span>
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Expanded Content - Sample Logs */}
            {isExpanded && cluster.samples && cluster.samples.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}>
                    <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                            Sample Logs ({cluster.samples.length})
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setExpandedSamples(new Set(cluster.samples.map((_, i) => i)))}
                                className="px-1.5 py-0.5 rounded text-xs font-medium smooth-transition"
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: '1px solid var(--border-primary)', fontSize: '8px' }}
                            >
                                Expand
                            </button>
                            <button
                                onClick={() => setExpandedSamples(new Set())}
                                className="px-1.5 py-0.5 rounded text-xs font-medium smooth-transition"
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: '1px solid var(--border-primary)', fontSize: '8px' }}
                            >
                                Collapse
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1.5 p-2">
                        {cluster.samples.map((sample, idx) => (
                            <div key={idx} className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                {/* Sample Header - Clickable */}
                                <div
                                    className="px-2.5 py-1 cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1.5"
                                    onClick={() => setExpandedSamples(prev => {
                                        const next = new Set(prev);
                                        next.has(idx) ? next.delete(idx) : next.add(idx);
                                        return next;
                                    })}
                                >
                                    <FileText className="w-2.5 h-2.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-mono truncate" style={{ color: '#06b6d4', fontSize: '10px', lineHeight: '1.2' }}>
                                            {sample.relative_path}
                                            <span style={{ color: '#06b6d4', marginLeft: '4px' }}>L{sample.line_number}</span>
                                        </div>
                                    </div>
                                    {expandedSamples.has(idx) ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                                </div>

                                {/* Sample Content - Expandable */}
                                {expandedSamples.has(idx) && (
                                    <div className="px-2.5 py-2 border-t" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-primary)' }}>
                                        <div className="font-mono text-xs" style={{
                                            color: 'var(--text-primary)',
                                            lineHeight: '1.5',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'anywhere',
                                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                                            fontSize: '11px',
                                            maxHeight: '300px',
                                            overflowY: 'auto'
                                        }}>
                                            {sample.raw}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Main LogGrep Component - CLEAN VERSION
export default function LogGrep() {
    const { fetchApi } = useApi();

    const [sessions, setSessions] = useState([]);
    const [components, setComponents] = useState([]);
    const [smartPatterns, setSmartPatterns] = useState(DEFAULT_SMART_PATTERNS);
    const [selectedSessions, setSelectedSessions] = useState([]);
    const [selectedComponents, setSelectedComponents] = useState([]);
    const [pipeline, setPipeline] = useState([{ id: 1, type: 'include', pattern: 'error|fail|exception', case_insensitive: true, regex: true }]);
    const [results, setResults] = useState(null);
    const [expandedClusters, setExpandedClusters] = useState(new Set());
    const [selectedForAnalysis, setSelectedForAnalysis] = useState(new Set());
    const [duoAnalyses, setDuoAnalyses] = useState({});
    const [showDuoPanel, setShowDuoPanel] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        setIsLoadingData(true);
        setError(null);
        try {
            const [sessionsData, componentsData] = await Promise.all([
                fetchApi('/sessions'),
                fetchApi('/components')
            ]);
            setSessions(sessionsData || []);
            setComponents(componentsData || []);
            if (sessionsData?.length > 0) setSelectedSessions(sessionsData.map(s => s.session_id));
            if (componentsData?.length > 0) setSelectedComponents(componentsData.map(c => c.name));
        } catch (err) {
            setError('Failed to load data');
        } finally {
            setIsLoadingData(false);
        }
    };

    const executeSearch = async () => {
        if (pipeline.length === 0) return;
        setIsSearching(true);
        setError(null);
        setResults(null);
        setExpandedClusters(new Set());
        setSelectedForAnalysis(new Set());

        try {
            const response = await fetchApi('/search', {
                method: 'POST',
                body: JSON.stringify({
                    pipeline: pipeline.map(step => ({ pattern: step.pattern, inverse: step.type === 'exclude', case_insensitive: step.case_insensitive, regex: step.regex })),
                    session_ids: selectedSessions.length > 0 ? selectedSessions : null,
                    components: selectedComponents.length > 0 ? selectedComponents : null,
                    max_results: null,
                    enable_clustering: true,
                })
            });
            setResults(response);
            if (response.clusters?.length > 0) setExpandedClusters(new Set(response.clusters.slice(0, 3).map(c => c.cluster_id)));
        } catch (err) {
            setError('Search failed');
        } finally {
            setIsSearching(false);
        }
    };

    const selectAllErrors = () => {
        if (!results?.clusters) return;
        const errorClusters = results.clusters.filter(c => ['CRITICAL', 'FATAL', 'ERROR'].includes(c.severity?.toUpperCase())).map(c => c.cluster_id);
        setSelectedForAnalysis(new Set(errorClusters));
    };

    const runDuoAnalysis = async () => {
        if (selectedForAnalysis.size === 0) return;
        setIsAnalyzing(true);
        setShowDuoPanel(true);
        setAnalysisProgress({ current: 0, total: selectedForAnalysis.size });

        try {
            const response = await fetchApi('/analyze', { method: 'POST', body: JSON.stringify({ cluster_ids: Array.from(selectedForAnalysis) }) });
            if (response.analyses) {
                const newAnalyses = {};
                response.analyses.forEach(analysis => { newAnalyses[analysis.cluster_id] = analysis; });
                setDuoAnalyses(prev => ({ ...prev, ...newAnalyses }));
            }
            setAnalysisProgress({ current: selectedForAnalysis.size, total: selectedForAnalysis.size });
        } catch (err) {
            setError('Analysis failed');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
            <div className="w-full p-3 space-y-2.5">
                {/* Clean Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            LogGrep
                        </h1>
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                            Multi-algorithm clustering
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={loadInitialData} disabled={isLoadingData} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium smooth-transition" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
                            <RefreshCw className={`w-3 h-3 ${isLoadingData ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        <button onClick={() => setShowDuoPanel(!showDuoPanel)} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold smooth-transition" style={{
                            background: showDuoPanel ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: showDuoPanel ? 'var(--bg-primary)' : 'var(--text-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <Brain className="w-3 h-3" />
                            AI
                            {Object.keys(duoAnalyses).length > 0 && (
                                <span className="px-1 py-0.5 rounded-full text-xs" style={{ background: 'rgba(255,255,255,0.2)' }}>{Object.keys(duoAnalyses).length}</span>
                            )}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl p-2.5 flex items-center gap-2 text-xs" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}>
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="flex-1">{error}</span>
                        <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                    <SessionSelector sessions={sessions} selectedSessions={selectedSessions} onSelectionChange={setSelectedSessions} loading={isLoadingData} />
                    <ComponentSelector components={components} selectedComponents={selectedComponents} onSelectionChange={setSelectedComponents} loading={isLoadingData} />
                </div>

                <PipelineBuilder pipeline={pipeline} onChange={setPipeline} smartPatterns={smartPatterns} onExecute={executeSearch} isExecuting={isSearching} />

                {results && <ResultsStats results={results} selectedCount={selectedForAnalysis.size} onSelectAll={selectAllErrors} onAnalyze={runDuoAnalysis} isAnalyzing={isAnalyzing} />}

                {isSearching && (
                    <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Clustering logs...</div>
                    </div>
                )}

                {results && !isSearching && (
                    <div className="space-y-2">
                        {results.clusters?.length === 0 ? (
                            <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                <Search className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>No matches found</div>
                            </div>
                        ) : (
                            <>
                                {/* Expand/Collapse All Controls */}
                                <div className="flex items-center gap-1.5 px-2 py-1.5">
                                    <button
                                        onClick={() => setExpandedClusters(new Set(results.clusters.map(c => c.cluster_id)))}
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium smooth-transition"
                                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                                    >
                                        <ChevronDown className="w-3 h-3" />
                                        Expand All
                                    </button>
                                    <button
                                        onClick={() => setExpandedClusters(new Set())}
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium smooth-transition"
                                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                                    >
                                        <ChevronRight className="w-3 h-3" />
                                        Collapse All
                                    </button>
                                    <div className="flex-1" />
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                        {results.clusters.length} pattern{results.clusters.length !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                {/* Cluster Cards */}
                                <div className="space-y-2">
                                    {results.clusters?.map(cluster => (
                                        <ClusterCard
                                            key={cluster.cluster_id}
                                            cluster={cluster}
                                            isExpanded={expandedClusters.has(cluster.cluster_id)}
                                            isSelected={selectedForAnalysis.has(cluster.cluster_id)}
                                            onToggleExpand={() => setExpandedClusters(prev => {
                                                const next = new Set(prev);
                                                next.has(cluster.cluster_id) ? next.delete(cluster.cluster_id) : next.add(cluster.cluster_id);
                                                return next;
                                            })}
                                            onToggleSelect={() => setSelectedForAnalysis(prev => {
                                                const next = new Set(prev);
                                                next.has(cluster.cluster_id) ? next.delete(cluster.cluster_id) : next.add(cluster.cluster_id);
                                                return next;
                                            })}
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        {results.truncated && (
                            <div className="rounded-xl p-2 flex items-center gap-2 text-xs" style={{ background: 'rgba(202, 138, 4, 0.1)', border: '1px solid rgba(202, 138, 4, 0.3)', color: '#ca8a04' }}>
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                Truncated at {formatNumber(results.total_matches)}. Refine search.
                            </div>
                        )}
                    </div>
                )}

                {!results && !isSearching && !isLoadingData && (
                    <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <Search className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                        <div className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Ready to Search</div>
                        <div className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                            Build pipeline and execute to analyze logs
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
