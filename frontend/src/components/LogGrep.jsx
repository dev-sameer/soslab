import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Search, X, Plus, ChevronDown, ChevronRight, FileText, Database,
    Server, Globe, Zap, Filter, Copy, Check, Layers, Clock,
    AlertTriangle, AlertCircle, Terminal, Sparkles,
    Eye, Brain, Loader2, RefreshCw, ChevronUp,
    Play, Send, Cpu, HardDrive, Activity, Box, GitBranch, Package
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
    CRITICAL: { bg: 'bg-red-500', bgLight: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
    FATAL: { bg: 'bg-red-500', bgLight: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' },
    ERROR: { bg: 'bg-orange-500', bgLight: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
    WARNING: { bg: 'bg-yellow-500', bgLight: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
    WARN: { bg: 'bg-yellow-500', bgLight: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
    INFO: { bg: 'bg-blue-500', bgLight: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' },
    DEBUG: { bg: 'bg-gray-500', bgLight: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400' },
    UNKNOWN: { bg: 'bg-gray-500', bgLight: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400' },
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

const getSeverityConfig = (severity) => {
    return SEVERITY_CONFIG[severity?.toUpperCase()] || SEVERITY_CONFIG.UNKNOWN;
};

const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num || 0);
};

const formatBytes = (bytes) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
};

const getComponentIcon = (component) => {
    const IconComponent = COMPONENT_ICONS[component?.toLowerCase()] || Server;
    return <IconComponent className="w-4 h-4" />;
};

// Simple API fetch hook
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

// Session Selector Component - COMPACT VERSION
function SessionSelector({ sessions, selectedSessions, onSelectionChange, loading }) {
    const [expanded, setExpanded] = useState(false);

    const toggleSession = (sessionId) => {
        const newSelection = selectedSessions.includes(sessionId)
            ? selectedSessions.filter(s => s !== sessionId)
            : [...selectedSessions, sessionId];
        onSelectionChange(newSelection);
    };

    return (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                style={{ background: 'var(--bg-tertiary)' }}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <HardDrive className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>Sessions</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>
                        {selectedSessions.length}/{sessions.length}
                    </span>
                </div>
                {expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
            </div>

            {expanded && (
                <div className="p-2">
                    <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <button onClick={() => onSelectionChange(sessions.map(s => s.session_id))} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>All</button>
                        <button onClick={() => onSelectionChange([])} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>None</button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-3">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-secondary)' }} />
                        </div>
                    ) : (
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                            {sessions.map(session => (
                                <label
                                    key={session.session_id}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-opacity-50"
                                    style={{
                                        background: selectedSessions.includes(session.session_id) ? 'var(--accent-dim)' : 'transparent',
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedSessions.includes(session.session_id)}
                                        onChange={() => toggleSession(session.session_id)}
                                        className="w-3 h-3"
                                        style={{ accentColor: 'var(--accent)' }}
                                    />
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

// Component Filter - COMPACT VERSION
function ComponentFilter({ components, selectedComponents, onSelectionChange, loading }) {
    const [expanded, setExpanded] = useState(false);

    const toggleComponent = (name) => {
        const newSelection = selectedComponents.includes(name)
            ? selectedComponents.filter(c => c !== name)
            : [...selectedComponents, name];
        onSelectionChange(newSelection);
    };

    return (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                style={{ background: 'var(--bg-tertiary)' }}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <Box className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>Components</span>
                    {selectedComponents.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>{selectedComponents.length}</span>
                    )}
                </div>
                {expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
            </div>

            {expanded && (
                <div className="p-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-3">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-secondary)' }} />
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {components.map(comp => (
                                <button
                                    key={comp.name}
                                    onClick={() => toggleComponent(comp.name)}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                                    style={{
                                        background: selectedComponents.includes(comp.name) ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: selectedComponents.includes(comp.name) ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    {getComponentIcon(comp.name)}
                                    <span>{comp.name}</span>
                                    <span style={{ opacity: 0.6 }}>({comp.file_count})</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Pipeline Builder
function PipelineBuilder({ pipeline, onChange, smartPatterns, onExecute, isExecuting }) {
    const [showPatterns, setShowPatterns] = useState(false);

    const addStep = (type) => {
        onChange([...pipeline, { id: Date.now(), type: type || 'include', pattern: '', case_insensitive: true, regex: true }]);
    };

    const updateStep = (id, field, value) => {
        onChange(pipeline.map(step => step.id === id ? { ...step, [field]: value } : step));
    };

    const removeStep = (id) => {
        onChange(pipeline.filter(step => step.id !== id));
    };

    const addSmartPattern = (pattern) => {
        onChange([...pipeline, { id: Date.now(), type: 'include', pattern: pattern.pattern, case_insensitive: true, regex: true }]);
        setShowPatterns(false);
    };

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>Search Pipeline</span>
                </div>
                <button
                    onClick={() => setShowPatterns(!showPatterns)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{
                        background: showPatterns ? 'var(--accent)' : 'var(--bg-primary)',
                        color: showPatterns ? 'var(--bg-primary)' : 'var(--text-secondary)',
                        border: '1px solid var(--border-primary)'
                    }}
                >
                    <Sparkles className="w-3 h-3" />
                    Smart Patterns
                </button>
            </div>

            {showPatterns && (
                <div className="p-3" style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)' }}>
                    <div className="grid grid-cols-2 gap-4 max-h-64 overflow-y-auto">
                        {Object.entries(smartPatterns).map(([category, patterns]) => (
                            <div key={category}>
                                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{category}</div>
                                <div className="space-y-1">
                                    {patterns.map((pattern, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => addSmartPattern(pattern)}
                                            className="w-full text-left px-2 py-1.5 rounded"
                                            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
                                        >
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

            <div className="p-3 space-y-2">
                {pipeline.length === 0 ? (
                    <div className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>Add patterns to build your search pipeline</div>
                ) : (
                    pipeline.map((step, idx) => (
                        <div key={step.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                            {idx > 0 && <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>|</span>}

                            <select
                                value={step.type}
                                onChange={(e) => updateStep(step.id, 'type', e.target.value)}
                                className="px-2 py-1 rounded text-xs font-medium"
                                style={{
                                    background: step.type === 'include' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                    color: step.type === 'include' ? '#22c55e' : '#ef4444',
                                    border: 'none'
                                }}
                            >
                                <option value="include">grep</option>
                                <option value="exclude">grep -v</option>
                            </select>

                            <input
                                type="text"
                                value={step.pattern}
                                onChange={(e) => updateStep(step.id, 'pattern', e.target.value)}
                                placeholder="Enter pattern..."
                                className="flex-1 px-3 py-1.5 rounded text-sm font-mono focus:outline-none"
                                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                            />

                            <button
                                onClick={() => updateStep(step.id, 'case_insensitive', !step.case_insensitive)}
                                className="px-2 py-1 rounded text-xs"
                                style={{
                                    background: step.case_insensitive ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-primary)',
                                    color: step.case_insensitive ? '#3b82f6' : 'var(--text-tertiary)',
                                    border: '1px solid var(--border-primary)'
                                }}
                                title="Case insensitive"
                            >
                                Aa
                            </button>

                            <button onClick={() => removeStep(step.id)} className="p-1" style={{ color: 'var(--text-tertiary)' }}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )}

                <div className="flex items-center gap-2 pt-2">
                    <button
                        onClick={() => addStep('include')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
                        style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}
                    >
                        <Plus className="w-3 h-3" />
                        Include
                    </button>
                    <button
                        onClick={() => addStep('exclude')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
                        style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    >
                        <Plus className="w-3 h-3" />
                        Exclude
                    </button>

                    <div className="flex-1" />

                    <button
                        onClick={onExecute}
                        disabled={pipeline.length === 0 || isExecuting}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm"
                        style={{
                            background: pipeline.length > 0 && !isExecuting ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: pipeline.length > 0 && !isExecuting ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                            cursor: pipeline.length === 0 || isExecuting ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isExecuting ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />Searching...</>
                        ) : (
                            <><Play className="w-4 h-4" />Execute Search</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Results Stats Bar - COMPACT VERSION
function ResultsStats({ results, selectedCount, onSelectAll, onAnalyze, isAnalyzing }) {
    if (!results) return null;

    return (
        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <span style={{ color: 'var(--text-tertiary)' }}>Matches:</span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(results.total_matches)}</span>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'var(--border-primary)' }} />
                    <div className="flex items-center gap-1.5">
                        <span style={{ color: 'var(--text-tertiary)' }}>Patterns:</span>
                        <span className="font-bold" style={{ color: 'var(--accent)' }}>{results.cluster_count}</span>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'var(--border-primary)' }} />
                    <div className="flex items-center gap-2">
                        {Object.entries(results.statistics?.by_severity || {}).map(([sev, count]) => {
                            const config = getSeverityConfig(sev);
                            return (
                                <span key={sev} className={`px-1.5 py-0.5 rounded text-xs ${config.bgLight} ${config.border} ${config.text}`}>
                                    {sev}: {formatNumber(count)}
                                </span>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={onSelectAll} className="px-2 py-1 text-xs rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
                        Select Errors
                    </button>
                    <button
                        onClick={onAnalyze}
                        disabled={selectedCount === 0 || isAnalyzing}
                        className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium"
                        style={{
                            background: selectedCount > 0 && !isAnalyzing ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: selectedCount > 0 && !isAnalyzing ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                            cursor: selectedCount === 0 || isAnalyzing ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isAnalyzing ? <><Loader2 className="w-3 h-3 animate-spin" />Analyzing...</> : <><Brain className="w-3 h-3" />Analyze ({selectedCount})</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Cluster Card - COMPACT TROUBLESHOOTING VERSION
function ClusterCard({ cluster, isExpanded, isSelected, onToggleExpand, onToggleSelect, duoAnalysis }) {
    const severityConfig = getSeverityConfig(cluster.severity);

    return (
        <div className="rounded-lg relative" style={{
            background: 'var(--bg-secondary)',
            border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-primary)'
        }}>
            <div className="px-3 py-2 cursor-pointer" onClick={onToggleExpand}>
                <div className="flex items-start gap-2">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
                        className="mt-0.5 w-3 h-3"
                        style={{ accentColor: 'var(--accent)' }}
                    />

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>{cluster.cluster_id}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${severityConfig.bgLight} ${severityConfig.border} ${severityConfig.text}`}>{cluster.severity}</span>
                            {cluster.exception_class && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/30">{cluster.exception_class}</span>
                            )}
                            <div className="flex-1" />
                            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(cluster.count)}</span>
                            {isExpanded ? <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />}
                        </div>

                        <code className="text-xs font-mono block" style={{ color: 'var(--text-primary)', lineHeight: '1.4' }}>
                            {cluster.template}
                        </code>

                        <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            <span>{Object.keys(cluster.files || {}).length} files</span>
                        </div>
                    </div>
                </div>

                {/* Sessions in corner */}
                <div className="absolute top-2 right-2 text-xs font-mono" style={{ color: 'var(--text-tertiary)', fontSize: '9px' }}>
                    {Object.entries(cluster.sessions || {}).slice(0, 3).map(([session, count]) => (
                        <span key={session}>{session.split('_')[2]}×{count} </span>
                    ))}
                </div>
            </div>

            {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border-primary)' }}>
                    {cluster.samples && cluster.samples.length > 0 && (
                        <div className="px-3 py-2">
                            <div className="space-y-2">
                                {cluster.samples.slice(0, 2).map((sample, idx) => (
                                    <div key={idx} className="flex items-start gap-2">
                                        <FileText className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                <span className="truncate">{sample.relative_path?.split('/').pop()}</span>
                                                <span>L{sample.line_number}</span>
                                            </div>
                                            <div className="font-mono text-xs break-all" style={{ color: 'var(--text-primary)', lineHeight: '1.4' }}>
                                                {sample.raw?.length > 300 ? sample.raw.slice(0, 300) + '...' : sample.raw}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Duo Analysis Panel
function DuoAnalysisPanel({ isOpen, onClose, analyses, clusters, isAnalyzing, progress, onAskFollowUp }) {
    const [question, setQuestion] = useState('');

    if (!isOpen) return null;

    const handleAskQuestion = () => {
        if (question.trim()) {
            onAskFollowUp(question);
            setQuestion('');
        }
    };

    return (
        <div className="fixed right-0 top-0 bottom-0 w-[450px] flex flex-col z-50" style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border-primary)', boxShadow: '-4px 0 20px rgba(0,0,0,0.2)' }}>
            <div className="p-4 shrink-0" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                            <Brain className="w-4 h-4" style={{ color: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>GitLab Duo Analysis</div>
                            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{Object.keys(analyses).length} patterns analyzed</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    </button>
                </div>

                {isAnalyzing && (
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span style={{ color: 'var(--text-secondary)' }}>Analyzing patterns...</span>
                            <span style={{ color: 'var(--accent)' }}>{progress.current}/{progress.total}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                            <div className="h-full transition-all duration-300" style={{ width: (progress.current / progress.total) * 100 + '%', background: 'var(--accent)' }} />
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {Object.keys(analyses).length === 0 ? (
                    <div className="p-8 text-center">
                        <Brain className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                        <div style={{ color: 'var(--text-secondary)' }} className="mb-2">No analyses yet</div>
                        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Select error patterns and click Analyze to get AI-powered insights</div>
                    </div>
                ) : (
                    <div>
                        {Object.entries(analyses).map(([clusterId, analysis]) => {
                            const cluster = clusters.find(c => c.cluster_id === clusterId);
                            const severityConfig = getSeverityConfig(cluster?.severity);

                            return (
                                <div key={clusterId} className="p-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                    <div className="flex items-start gap-2 mb-3">
                                        <span className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${severityConfig.bg}`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>{clusterId}</span>
                                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{cluster?.count || 0}x</span>
                                            </div>
                                            <div className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                                {cluster?.template?.length > 50 ? cluster.template.slice(0, 50) + '...' : cluster?.template}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                        {analysis.status === 'failed' ? (
                                            <div className="text-red-400 flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4" />
                                                {analysis.error || 'Analysis failed'}
                                            </div>
                                        ) : (
                                            <div style={{ color: 'var(--text-secondary)' }} className="whitespace-pre-wrap">
                                                {analysis.response}
                                            </div>
                                        )}
                                    </div>

                                    {analysis.status === 'completed' && (
                                        <div className="flex items-center gap-2 mt-3">
                                            <button
                                                onClick={() => navigator.clipboard.writeText(analysis.response || '')}
                                                className="flex items-center gap-1 px-2 py-1 text-xs rounded"
                                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                                            >
                                                <Copy className="w-3 h-3" />Copy
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="p-4 shrink-0" style={{ borderTop: '1px solid var(--border-primary)' }}>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAskQuestion()}
                        placeholder="Ask a follow-up question..."
                        className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                        style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                    />
                    <button
                        onClick={handleAskQuestion}
                        disabled={!question.trim()}
                        className="p-2 rounded-lg"
                        style={{ background: question.trim() ? 'var(--accent)' : 'var(--bg-tertiary)', color: question.trim() ? 'var(--bg-primary)' : 'var(--text-tertiary)' }}
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// Main LogGrep Component
export default function LogGrep() {
    const { fetchApi } = useApi();

    const [sessions, setSessions] = useState([]);
    const [components, setComponents] = useState([]);
    const [smartPatterns, setSmartPatterns] = useState(DEFAULT_SMART_PATTERNS);

    const [selectedSessions, setSelectedSessions] = useState([]);
    const [selectedComponents, setSelectedComponents] = useState([]);

    const [pipeline, setPipeline] = useState([
        { id: 1, type: 'include', pattern: 'error|fail|exception', case_insensitive: true, regex: true }
    ]);

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
            const sessionsData = await fetchApi('/sessions');
            setSessions(sessionsData || []);
            if (sessionsData && sessionsData.length > 0) {
                setSelectedSessions(sessionsData.map(s => s.session_id));
            }

            const componentsData = await fetchApi('/components');
            setComponents(componentsData || []);

            try {
                const patternsData = await fetchApi('/smart-patterns');
                if (patternsData && Object.keys(patternsData).length > 0) {
                    setSmartPatterns(patternsData);
                }
            } catch (e) {
                // Use default patterns
            }
        } catch (err) {
            setError('Failed to load data. Make sure the backend is running.');
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
        setDuoAnalyses({});

        try {
            const searchRequest = {
                pipeline: pipeline.map(step => ({
                    pattern: step.pattern,
                    inverse: step.type === 'exclude',
                    case_insensitive: step.case_insensitive,
                    regex: step.regex,
                })),
                session_ids: selectedSessions.length > 0 ? selectedSessions : null,
                components: selectedComponents.length > 0 ? selectedComponents : null,
                max_results: 10000,
                enable_clustering: true,
            };

            const response = await fetchApi('/search', { method: 'POST', body: JSON.stringify(searchRequest) });
            setResults(response);

            if (response.clusters && response.clusters.length > 0) {
                const firstFew = response.clusters.slice(0, 3).map(c => c.cluster_id);
                setExpandedClusters(new Set(firstFew));
            }
        } catch (err) {
            setError('Search failed. Please try again.');
        } finally {
            setIsSearching(false);
        }
    };

    const toggleClusterExpand = (clusterId) => {
        setExpandedClusters(prev => {
            const next = new Set(prev);
            if (next.has(clusterId)) next.delete(clusterId);
            else next.add(clusterId);
            return next;
        });
    };

    const toggleClusterSelect = (clusterId) => {
        setSelectedForAnalysis(prev => {
            const next = new Set(prev);
            if (next.has(clusterId)) next.delete(clusterId);
            else next.add(clusterId);
            return next;
        });
    };

    const selectAllErrors = () => {
        if (!results?.clusters) return;
        const errorClusters = results.clusters
            .filter(c => ['CRITICAL', 'FATAL', 'ERROR'].includes(c.severity?.toUpperCase()))
            .map(c => c.cluster_id);
        setSelectedForAnalysis(new Set(errorClusters));
    };

    const runDuoAnalysis = async () => {
        if (selectedForAnalysis.size === 0) return;

        setIsAnalyzing(true);
        setShowDuoPanel(true);
        setAnalysisProgress({ current: 0, total: selectedForAnalysis.size });

        try {
            const clusterIds = Array.from(selectedForAnalysis);
            const response = await fetchApi('/analyze', { method: 'POST', body: JSON.stringify({ cluster_ids: clusterIds }) });

            if (response.analyses) {
                const newAnalyses = {};
                response.analyses.forEach(analysis => { newAnalyses[analysis.cluster_id] = analysis; });
                setDuoAnalyses(prev => ({ ...prev, ...newAnalyses }));
            }

            setAnalysisProgress({ current: clusterIds.length, total: clusterIds.length });
        } catch (err) {
            setError('Analysis failed. Please try again.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleFollowUpQuestion = async (question) => {
        if (selectedForAnalysis.size === 0) return;
        setIsAnalyzing(true);

        try {
            const response = await fetchApi('/analyze', {
                method: 'POST',
                body: JSON.stringify({ cluster_ids: Array.from(selectedForAnalysis), user_question: question }),
            });

            if (response.analyses) {
                const newAnalyses = {};
                response.analyses.forEach(analysis => { newAnalyses[analysis.cluster_id] = analysis; });
                setDuoAnalyses(prev => ({ ...prev, ...newAnalyses }));
            }
        } catch (err) {
            console.error('Follow-up error:', err);
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <div style={{ marginRight: showDuoPanel ? '450px' : '0', transition: 'margin-right 0.3s ease' }}>
                <div className="w-full mx-auto p-3 space-y-3">

                    {/* Compact Header */}
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                                <Search className="w-4 h-4" style={{ color: 'var(--bg-primary)' }} />
                            </div>
                            <div>
                                <h1 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>LogGrep</h1>
                                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Multi-algorithm clustering</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button onClick={loadInitialData} disabled={isLoadingData} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
                                <RefreshCw className={`w-3 h-3 ${isLoadingData ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                            <button
                                onClick={() => setShowDuoPanel(!showDuoPanel)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
                                style={{
                                    background: showDuoPanel ? 'var(--accent)' : 'var(--bg-tertiary)',
                                    color: showDuoPanel ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                    border: '1px solid var(--border-primary)'
                                }}
                            >
                                <Brain className="w-3 h-3" />
                                AI
                                {Object.keys(duoAnalyses).length > 0 && (
                                    <span className="px-1 py-0.5 rounded text-xs" style={{ background: 'rgba(255,255,255,0.2)' }}>{Object.keys(duoAnalyses).length}</span>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                            <div className="flex-1 text-xs text-red-400">{error}</div>
                            <button onClick={() => setError(null)} className="text-red-400"><X className="w-3 h-3" /></button>
                        </div>
                    )}

                    {/* Compact Filters Row */}
                    <div className="grid grid-cols-2 gap-2">
                        <SessionSelector sessions={sessions} selectedSessions={selectedSessions} onSelectionChange={setSelectedSessions} loading={isLoadingData} />
                        <ComponentFilter components={components} selectedComponents={selectedComponents} onSelectionChange={setSelectedComponents} loading={isLoadingData} />
                    </div>

                    {/* Pipeline Builder */}
                    <PipelineBuilder pipeline={pipeline} onChange={setPipeline} smartPatterns={smartPatterns} onExecute={executeSearch} isExecuting={isSearching} />

                    {/* Compact Results Stats */}
                    {results && <ResultsStats results={results} selectedCount={selectedForAnalysis.size} onSelectAll={selectAllErrors} onAnalyze={runDuoAnalysis} isAnalyzing={isAnalyzing} />}

                    {/* Search Loading */}
                    {isSearching && (
                        <div className="rounded-lg p-6 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Clustering logs...</div>
                        </div>
                    )}

                    {/* Results - Compact Clustered View */}
                    {results && !isSearching && (
                        <div className="space-y-2">
                            {results.clusters?.length === 0 ? (
                                <div className="rounded-lg p-6 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <Search className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>No matches found</div>
                                </div>
                            ) : (
                                results.clusters?.map(cluster => (
                                    <ClusterCard
                                        key={cluster.cluster_id}
                                        cluster={cluster}
                                        isExpanded={expandedClusters.has(cluster.cluster_id)}
                                        isSelected={selectedForAnalysis.has(cluster.cluster_id)}
                                        onToggleExpand={() => toggleClusterExpand(cluster.cluster_id)}
                                        onToggleSelect={() => toggleClusterSelect(cluster.cluster_id)}
                                        duoAnalysis={duoAnalyses[cluster.cluster_id]}
                                    />
                                ))
                            )}

                            {results.truncated && (
                                <div className="rounded-lg p-2.5 flex items-center gap-2 text-xs" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', color: '#eab308' }}>
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    Results truncated at {formatNumber(results.total_matches)}. Refine search for more.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty State */}
                    {!results && !isSearching && !isLoadingData && (
                        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                            <Search className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                            <div className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Ready to Search</div>
                            <div className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                                Build your pipeline and execute to analyze logs with Drain clustering
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Duo Analysis Panel */}
            <DuoAnalysisPanel
                isOpen={showDuoPanel}
                onClose={() => setShowDuoPanel(false)}
                analyses={duoAnalyses}
                clusters={results?.clusters || []}
                isAnalyzing={isAnalyzing}
                progress={analysisProgress}
                onAskFollowUp={handleFollowUpQuestion}
            />
        </div>
    );
}