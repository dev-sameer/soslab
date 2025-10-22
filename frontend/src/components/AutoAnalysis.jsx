import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Play, RefreshCw, AlertCircle, Filter,
    ChevronRight, ChevronDown, Download,
    Zap, Package, AlertTriangle, XCircle,
    Info, BarChart3, Layers, Search,
    Eye, EyeOff, FileText, Copy, CheckCircle,
    Link2, Terminal, Code2, Clock, Hash,
    X, ChevronUp
} from 'lucide-react';

const AutoAnalysis = ({ sessionId }) => {
    const [analysisState, setAnalysisState] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [expandedProblems, setExpandedProblems] = useState({});
    const [expandedComponents, setExpandedComponents] = useState({});
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [showCorrelations, setShowCorrelations] = useState(true);
    const pollIntervalRef = useRef(null);
    const lastSessionRef = useRef(null);

    // Enhanced state
    const [filters, setFilters] = useState({
        severity: 'all',
        component: 'all',
        errorType: 'gitlab',
        searchQuery: '',
        minCount: 1,
        hasContext: 'all',
        hasCorrelation: 'all'
    });
    const [viewMode, setViewMode] = useState('errors');
    const [errorLimit, setErrorLimit] = useState(25);

    // Polling functions
    const startPolling = () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();
                setAnalysisState(data);

                if (data.status === 'completed' || data.status === 'failed') {
                    setIsRunning(false);
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
            } catch (error) {
                console.error('Error polling:', error);
            }
        }, 3000);
    };

    useEffect(() => {
        if (!sessionId) return;
        if (lastSessionRef.current === sessionId) return;
        lastSessionRef.current = sessionId;

        const checkStatus = async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();

                if (data.status === 'completed') {
                    setAnalysisState(data);
                    setIsRunning(false);
                } else if (data.status === 'processing') {
                    setAnalysisState(data);
                    setIsRunning(true);
                    startPolling();
                } else {
                    setAnalysisState(null);
                    setIsRunning(false);
                }
            } catch (error) {
                console.error('Error:', error);
                setAnalysisState(null);
                setIsRunning(false);
            }
        };

        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        checkStatus();
    }, [sessionId]);

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, []);

    const startAnalysis = async () => {
        try {
            setIsRunning(true);
            const response = await fetch(`/api/auto-analysis/${sessionId}`, { method: 'POST' });
            const data = await response.json();

            if (data.status === 'already_completed') {
                setAnalysisState(data.results || data);
                setIsRunning(false);
            } else if (data.status === 'already_running') {
                startPolling();
            } else {
                setAnalysisState({ status: 'processing', progress: 0, message: 'Starting...' });
                startPolling();
            }
        } catch (error) {
            console.error('Error:', error);
            setIsRunning(false);
        }
    };

    const clearAnalysis = async () => {
        try {
            await fetch(`/api/auto-analysis/${sessionId}`, { method: 'DELETE' });
            setAnalysisState(null);
            setExpandedProblems({});
            setExpandedComponents({});
            lastSessionRef.current = null;
            setFilters({
                severity: 'all',
                component: 'all',
                errorType: 'gitlab',
                searchQuery: '',
                minCount: 1,
                hasContext: 'all',
                hasCorrelation: 'all'
            });
            setViewMode('errors');
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const downloadReport = () => {
        if (!analysisState?.results) return;

        const blob = new Blob([JSON.stringify(analysisState.results, null, 2)],
            { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gitlab_errors_enhanced_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyToClipboard = async (text, index) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Extract meaningful error message from sample
    const extractErrorMessage = (problem) => {
        if (!problem?.sample_line) return 'Unknown error';

        const sample = problem.sample_line;

        if (sample.startsWith('{')) {
            try {
                const parsed = JSON.parse(sample);
                return parsed.error || parsed.message || parsed.msg ||
                    parsed.description || parsed.error_message ||
                    'Error details in log';
            } catch {
                // Not JSON
            }
        }

        const patterns = [
            /error[:\s]+([^,\n]+)/i,
            /failed[:\s]+([^,\n]+)/i,
            /fatal[:\s]+([^,\n]+)/i,
            /exception[:\s]+([^,\n]+)/i,
            /message[:\s]+["']([^"']+)/i,
            /msg[:\s]+["']([^"']+)/i
        ];

        for (const pattern of patterns) {
            const match = sample.match(pattern);
            if (match) return match[1].trim();
        }

        return sample.substring(0, 100).trim() + (sample.length > 100 ? '...' : '');
    };

    // Format log for display - FIXED to handle proper formatting
    const formatLogForDisplay = (logLine, hasFullContext = false) => {
        if (!logLine) return { type: 'text', content: 'No log data', hasContext: false };

        // Try to parse as JSON first
        if (logLine.trim().startsWith('{') || logLine.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(logLine);

                const summary = {
                    time: parsed.time || parsed.timestamp || parsed['@timestamp'],
                    level: parsed.level || parsed.severity,
                    message: parsed.message || parsed.msg || parsed.error,
                    error: parsed.error,
                    correlation_id: parsed.correlation_id,
                    request_id: parsed.request_id,
                    job_id: parsed.job_id,
                    file: parsed.file || parsed.path,
                    component: parsed.component || parsed.service,
                    code: parsed.code || parsed.status || parsed['grpc.code'],
                    ...((parsed.meta || parsed.metadata) && { metadata: parsed.meta || parsed.metadata })
                };

                Object.keys(summary).forEach(key =>
                    summary[key] === undefined && delete summary[key]
                );

                return {
                    type: 'json',
                    content: JSON.stringify(summary, null, 2),
                    original: JSON.stringify(parsed, null, 2),
                    hasContext: hasFullContext,
                    correlationId: summary.correlation_id || summary.request_id
                };
            } catch {
                // If JSON parsing fails, treat as text
            }
        }

        // For text logs, return as-is without modification
        return {
            type: 'text',
            content: logLine,
            hasContext: hasFullContext
        };
    };

    // Process and group errors
    const processedData = useMemo(() => {
        if (!analysisState?.results) return null;

        const results = analysisState.results;

        let problems = filters.errorType === 'monitoring'
            ? results.monitoring_problems || []
            : results.problems || [];

        // Apply filters
        if (filters.severity !== 'all') {
            problems = problems.filter(p =>
                p.severity?.toUpperCase() === filters.severity.toUpperCase()
            );
        }

        if (filters.component !== 'all') {
            problems = problems.filter(p => p.component === filters.component);
        }

        if (filters.searchQuery) {
            const query = filters.searchQuery.toLowerCase();
            problems = problems.filter(p => {
                const errorMsg = extractErrorMessage(p).toLowerCase();
                return errorMsg.includes(query) ||
                    p.sample_line?.toLowerCase().includes(query) ||
                    p.component?.toLowerCase().includes(query);
            });
        }

        if (filters.minCount > 1) {
            problems = problems.filter(p => p.count >= filters.minCount);
        }

        if (filters.hasContext !== 'all') {
            problems = problems.filter(p =>
                filters.hasContext === 'yes' ? p.has_full_context : !p.has_full_context
            );
        }

        if (filters.hasCorrelation !== 'all') {
            problems = problems.filter(p =>
                filters.hasCorrelation === 'yes' ? p.has_correlation : !p.has_correlation
            );
        }

        // Group similar errors
        const errorGroups = {};
        problems.forEach(problem => {
            const errorMsg = extractErrorMessage(problem);
            const groupKey = errorMsg.substring(0, 50);

            if (!errorGroups[groupKey]) {
                errorGroups[groupKey] = {
                    message: errorMsg,
                    problems: [],
                    totalCount: 0,
                    severity: problem.severity,
                    component: problem.component,
                    hasCorrelation: problem.has_correlation || false,
                    hasContext: problem.has_full_context || false,
                    errorCodes: []
                };
            }

            errorGroups[groupKey].problems.push(problem);
            errorGroups[groupKey].totalCount += problem.count;

            if (problem.error_codes && problem.error_codes.length > 0) {
                errorGroups[groupKey].errorCodes.push(...problem.error_codes);
            }

            if (problem.severity === 'CRITICAL') {
                errorGroups[groupKey].severity = 'CRITICAL';
            } else if (problem.severity === 'ERROR' && errorGroups[groupKey].severity !== 'CRITICAL') {
                errorGroups[groupKey].severity = 'ERROR';
            }

            if (problem.has_correlation) {
                errorGroups[groupKey].hasCorrelation = true;
            }
            if (problem.has_full_context) {
                errorGroups[groupKey].hasContext = true;
            }
        });

        const sortedGroups = Object.values(errorGroups)
            .sort((a, b) => b.totalCount - a.totalCount);

        const severityBreakdown = { CRITICAL: 0, ERROR: 0, WARNING: 0 };
        const componentBreakdown = {};

        problems.forEach(p => {
            const sev = p.severity?.toUpperCase() || 'ERROR';
            if (severityBreakdown[sev] !== undefined) {
                severityBreakdown[sev] += p.count || 1;
            }

            const comp = p.component || 'Unknown';
            componentBreakdown[comp] = (componentBreakdown[comp] || 0) + (p.count || 1);
        });

        const uniqueComponents = [...new Set(problems.map(p => p.component))].filter(Boolean).sort();
        const correlationGroups = results.correlation_groups || [];

        return {
            problems,
            errorGroups: sortedGroups,
            totalCount: problems.reduce((sum, p) => sum + (p.count || 1), 0),
            uniquePatterns: problems.length,
            severityBreakdown,
            componentBreakdown,
            uniqueComponents,
            correlationGroups,
            hasEnhancedContext: results.summary?.enhanced_context || false
        };
    }, [analysisState, filters]);

    const getSeverityColor = (severity) => {
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return '#ef4444';
            case 'ERROR': return '#f59e0b';
            case 'WARNING': return '#3b82f6';
            default: return 'var(--text-secondary)';
        }
    };

    const getSeverityIcon = (severity) => {
        const size = "w-3.5 h-3.5";
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return <XCircle className={size} />;
            case 'ERROR': return <AlertCircle className={size} />;
            case 'WARNING': return <AlertTriangle className={size} />;
            default: return <Info className={size} />;
        }
    };

    if (!sessionId) {
        return (
            <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="text-center">
                    <Package className="w-14 h-14 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No session selected</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <div className="p-4" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)'
            }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: 'var(--accent)' }}>
                            <Zap className="w-4.5 h-4.5" style={{ color: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                            <h2 className="font-semibold flex items-center gap-2"
                                style={{ color: 'var(--text-primary)', fontSize: '15px' }}>
                                Error Analysis
                                {processedData?.hasEnhancedContext && (
                                    <span className="px-2 py-0.5 rounded text-[11px]"
                                        style={{
                                            background: 'var(--accent)',
                                            color: 'var(--bg-primary)'
                                        }}>
                                        ENHANCED
                                    </span>
                                )}
                            </h2>
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '2px' }}>
                                {processedData?.hasEnhancedContext
                                    ? 'Pattern detection with full context and correlation'
                                    : 'Pattern detection and error clustering'}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {analysisState?.status === 'completed' && (
                            <>
                                <button onClick={downloadReport}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 smooth-transition"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    <Download className="w-3.5 h-3.5" />
                                    Export
                                </button>
                                <button onClick={clearAnalysis}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium smooth-transition"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    Clear
                                </button>
                            </>
                        )}
                        <button onClick={startAnalysis} disabled={isRunning}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 smooth-transition"
                            style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)'
                            }}>
                            {isRunning ? (
                                <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    Analyzing
                                </>
                            ) : (
                                <>
                                    <Play className="w-3.5 h-3.5" />
                                    Analyze
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Progress */}
                {isRunning && analysisState && (
                    <div className="mt-2">
                        <div className="flex justify-between mb-1" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            <span>{analysisState.message}</span>
                            <span>{analysisState.progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                            <div className="h-full transition-all rounded-full"
                                style={{ width: `${analysisState.progress}%`, background: 'var(--accent)' }} />
                        </div>
                    </div>
                )}

                {/* Controls */}
                {analysisState?.status === 'completed' && processedData && (
                    <>
                        {/* Stats Bar */}
                        <div className="grid grid-cols-6 gap-2 mt-3 mb-3">
                            {[
                                { label: 'Total', value: processedData.totalCount.toLocaleString(), color: 'var(--text-primary)' },
                                { label: 'Critical', value: processedData.severityBreakdown.CRITICAL || 0, color: '#ef4444' },
                                { label: 'Errors', value: processedData.severityBreakdown.ERROR || 0, color: '#f59e0b' },
                                { label: 'Warnings', value: processedData.severityBreakdown.WARNING || 0, color: '#3b82f6' },
                                { label: 'Patterns', value: processedData.uniquePatterns, color: 'var(--text-primary)' },
                                { label: 'Correlations', value: processedData.correlationGroups.length, color: 'var(--text-primary)' }
                            ].map((stat, idx) => (
                                <div key={idx} className="text-center p-2 rounded-lg"
                                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                    <p className="font-bold" style={{ fontSize: '14px', color: stat.color }}>
                                        {stat.value}
                                    </p>
                                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                        {stat.label}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {/* View Tabs */}
                        <div className="flex gap-1.5 mb-3">
                            {['errors', 'correlations', 'dashboard', 'raw'].map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => setViewMode(mode)}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium smooth-transition capitalize"
                                    style={{
                                        background: viewMode === mode ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: viewMode === mode ? 'var(--bg-primary)' : 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    {mode === 'errors' && <AlertCircle className="w-3 h-3 inline mr-1" />}
                                    {mode === 'correlations' && <Link2 className="w-3 h-3 inline mr-1" />}
                                    {mode === 'dashboard' && <BarChart3 className="w-3 h-3 inline mr-1" />}
                                    {mode === 'raw' && <Code2 className="w-3 h-3 inline mr-1" />}
                                    {mode}
                                </button>
                            ))}
                        </div>

                        {/* Filters */}
                        <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-lg"
                            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>

                            <div className="flex rounded-lg overflow-hidden"
                                style={{ border: '1px solid var(--border-primary)' }}>
                                <button
                                    onClick={() => setFilters(prev => ({ ...prev, errorType: 'gitlab' }))}
                                    className="px-2.5 py-1 text-[11px] font-medium smooth-transition"
                                    style={{
                                        background: filters.errorType === 'gitlab' ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: filters.errorType === 'gitlab' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                    }}>
                                    GitLab ({analysisState.results.gitlab_problems || 0})
                                </button>
                                <button
                                    onClick={() => setFilters(prev => ({ ...prev, errorType: 'monitoring' }))}
                                    className="px-2.5 py-1 text-[11px] font-medium smooth-transition"
                                    style={{
                                        background: filters.errorType === 'monitoring' ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: filters.errorType === 'monitoring' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                    }}>
                                    Monitoring ({analysisState.results.monitoring_issues || 0})
                                </button>
                            </div>

                            <select value={filters.severity}
                                onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
                                className="px-2.5 py-1 rounded-lg text-[11px]"
                                style={{
                                    background: 'var(--bg-primary)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-primary)'
                                }}>
                                <option value="all">All Severities</option>
                                <option value="critical">Critical</option>
                                <option value="error">Errors</option>
                                <option value="warning">Warnings</option>
                            </select>

                            {processedData.uniqueComponents.length > 0 && (
                                <select value={filters.component}
                                    onChange={(e) => setFilters(prev => ({ ...prev, component: e.target.value }))}
                                    className="px-2.5 py-1 rounded-lg text-[11px]"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    <option value="all">All Components</option>
                                    {processedData.uniqueComponents.map(comp => (
                                        <option key={comp} value={comp}>{comp}</option>
                                    ))}
                                </select>
                            )}

                            <div className="flex items-center gap-1.5 flex-1">
                                <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                                <input
                                    type="text"
                                    placeholder="Search errors..."
                                    value={filters.searchQuery}
                                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                                    className="px-2.5 py-1 rounded-lg text-[11px] flex-1"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                />
                            </div>

                            <div className="flex items-center gap-1">
                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Min:</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={filters.minCount}
                                    onChange={(e) => setFilters(prev => ({ ...prev, minCount: parseInt(e.target.value) || 1 }))}
                                    className="px-1.5 py-1 rounded-lg text-[11px] w-14"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4" style={{ background: 'var(--bg-primary)' }}>
                {!analysisState || analysisState.status === 'not_started' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Zap className="w-14 h-14 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                            <h3 style={{ color: 'var(--text-primary)', fontSize: '14px' }}>Ready to Analyze</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                Click "Analyze" to detect error patterns
                            </p>
                        </div>
                    </div>
                ) : analysisState.status === 'processing' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto mb-3"
                                style={{ borderColor: 'var(--text-tertiary)' }} />
                            <h3 style={{ color: 'var(--text-primary)', fontSize: '14px' }}>Analyzing Patterns...</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{analysisState.message}</p>
                        </div>
                    </div>
                ) : analysisState.status === 'completed' && processedData ? (
                    <>
                        {/* Errors View */}
                        {viewMode === 'errors' && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between mb-3">
                                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        Found {processedData.errorGroups.length} unique error types
                                    </p>
                                    <select value={errorLimit}
                                        onChange={(e) => setErrorLimit(parseInt(e.target.value))}
                                        className="px-2.5 py-1 rounded-lg text-[11px]"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            color: 'var(--text-primary)',
                                            border: '1px solid var(--border-primary)'
                                        }}>
                                        <option value="10">Show 10</option>
                                        <option value="25">Show 25</option>
                                        <option value="50">Show 50</option>
                                        <option value="9999">Show All</option>
                                    </select>
                                </div>

                                {processedData.errorGroups.slice(0, errorLimit).map((group, idx) => {
                                    const isExpanded = expandedProblems[idx];
                                    const firstProblem = group.problems[0];
                                    const logData = formatLogForDisplay(firstProblem.sample_line, firstProblem.has_full_context);
                                    const uniqueErrorCodes = [...new Set(group.errorCodes)].slice(0, 5);

                                    return (
                                        <div key={idx} className="rounded-lg overflow-hidden"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-primary)'
                                            }}>
                                            {/* Error Header */}
                                            <div className="p-3" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-start gap-2 flex-1">
                                                        <button
                                                            onClick={() => setExpandedProblems(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                                            className="mt-0.5 opacity-60 hover:opacity-100 smooth-transition">
                                                            {isExpanded ?
                                                                <ChevronDown className="w-4 h-4" /> :
                                                                <ChevronRight className="w-4 h-4" />}
                                                        </button>

                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                {getSeverityIcon(group.severity)}
                                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                                                                    style={{
                                                                        background: getSeverityColor(group.severity),
                                                                        color: 'white'
                                                                    }}>
                                                                    {group.severity}
                                                                </span>
                                                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                    {group.component}
                                                                </span>
                                                                {group.hasCorrelation && (
                                                                    <span className="text-[10px] px-2 py-0.5 rounded"
                                                                        style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                                                                        <Link2 className="w-3 h-3 inline mr-0.5" />
                                                                        Correlated
                                                                    </span>
                                                                )}
                                                                {group.hasContext && (
                                                                    <span className="text-[10px] px-2 py-0.5 rounded"
                                                                        style={{ background: 'var(--text-secondary)', color: 'var(--bg-primary)' }}>
                                                                        <Terminal className="w-3 h-3 inline mr-0.5" />
                                                                        Context
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <p className="font-medium" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                                                                {group.message}
                                                            </p>

                                                            {uniqueErrorCodes.length > 0 && (
                                                                <div className="mt-1.5 flex items-center gap-1.5">
                                                                    <Hash className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                                                                    <div className="flex gap-1">
                                                                        {uniqueErrorCodes.map((code, cidx) => (
                                                                            <span key={cidx} className="text-[10px] px-1.5 py-0.5 rounded"
                                                                                style={{
                                                                                    background: 'var(--bg-primary)',
                                                                                    color: 'var(--text-secondary)'
                                                                                }}>
                                                                                {code}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {firstProblem.files && firstProblem.files.length > 0 && (
                                                                <div className="mt-1.5 flex items-center gap-1.5">
                                                                    <FileText className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                                                                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                                        {firstProblem.files[0]}
                                                                        {firstProblem.files.length > 1 && ` +${firstProblem.files.length - 1} more`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="text-right">
                                                        <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold"
                                                            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                                                            {group.totalCount.toLocaleString()}
                                                        </span>
                                                        <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                            occurrences
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded Details */}
                                            {isExpanded && (
                                                <div className="p-4 space-y-3">
                                                    {/* Full Log Sample */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)'
                                                            }}>
                                                                Full Log Sample
                                                                {logData.hasContext && (
                                                                    <span className="ml-1.5" style={{ color: 'var(--accent)' }}>(with context)</span>
                                                                )}
                                                            </h4>
                                                            <button
                                                                onClick={() => copyToClipboard(logData.original || logData.content, idx)}
                                                                className="text-[10px] px-2 py-0.5 rounded-lg flex items-center gap-1 smooth-transition"
                                                                style={{
                                                                    background: 'var(--bg-tertiary)',
                                                                    color: 'var(--text-primary)',
                                                                    border: '1px solid var(--border-primary)'
                                                                }}>
                                                                {copiedIndex === idx ? (
                                                                    <>
                                                                        <CheckCircle className="w-3 h-3" />
                                                                        Copied
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Copy className="w-3 h-3" />
                                                                        Copy
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>

                                                        {logData.correlationId && (
                                                            <div className="mb-2 flex items-center gap-1.5"
                                                                style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                                <Link2 className="w-3 h-3" />
                                                                Correlation ID:
                                                                <code className="px-1.5 py-0.5 rounded"
                                                                    style={{
                                                                        background: 'var(--bg-tertiary)',
                                                                        fontFamily: 'monospace'
                                                                    }}>
                                                                    {logData.correlationId}
                                                                </code>
                                                            </div>
                                                        )}

                                                        <pre className="p-3 rounded-lg"
                                                            style={{
                                                                background: '#1a1a1a',
                                                                color: '#e5e5e5',
                                                                fontSize: '12px',
                                                                lineHeight: '1.5',
                                                                fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
                                                                border: '1px solid var(--border-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-all',
                                                                overflowX: 'auto',
                                                                maxHeight: '400px'
                                                            }}>
                                                            <code>{logData.type === 'json' ? logData.content : logData.content}</code>
                                                        </pre>

                                                        {logData.original && logData.original !== logData.content && (
                                                            <details className="mt-2">
                                                                <summary className="cursor-pointer"
                                                                    style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                                    Show complete JSON
                                                                </summary>
                                                                <pre className="mt-2 p-3 rounded-lg"
                                                                    style={{
                                                                        background: 'var(--bg-tertiary)',
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '11px',
                                                                        fontFamily: 'monospace',
                                                                        whiteSpace: 'pre-wrap',
                                                                        wordBreak: 'break-all',
                                                                        overflowX: 'auto',
                                                                        maxHeight: '300px'
                                                                    }}>
                                                                    {logData.original}
                                                                </pre>
                                                            </details>
                                                        )}
                                                    </div>

                                                    {/* Pattern Variants */}
                                                    {group.problems.length > 1 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
                                                                Similar Patterns ({group.problems.length})
                                                            </h4>
                                                            <div className="space-y-1.5">
                                                                {group.problems.slice(0, 3).map((prob, pidx) => (
                                                                    <div key={pidx} className="p-2 rounded-lg"
                                                                        style={{
                                                                            background: 'var(--bg-tertiary)',
                                                                            border: '1px solid var(--border-primary)'
                                                                        }}>
                                                                        <div className="flex items-center justify-between">
                                                                            <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                                                {extractErrorMessage(prob).substring(0, 80)}...
                                                                            </span>
                                                                            <span className="font-semibold"
                                                                                style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                                {prob.count}x
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Affected Files */}
                                                    {firstProblem.files && firstProblem.files.length > 0 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
                                                                Affected Files
                                                            </h4>
                                                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                                                {firstProblem.files.map((file, fidx) => (
                                                                    <span key={fidx} className="px-2 py-1 rounded-lg"
                                                                        style={{
                                                                            fontSize: '11px',
                                                                            background: 'var(--bg-tertiary)',
                                                                            color: 'var(--text-secondary)',
                                                                            border: '1px solid var(--border-primary)'
                                                                        }}>
                                                                        {file}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Correlations View */}
                        {viewMode === 'correlations' && processedData.hasEnhancedContext && (
                            <div className="space-y-3">
                                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                    Found {processedData.correlationGroups.length} correlation groups
                                </p>

                                {processedData.correlationGroups.map((group, idx) => (
                                    <div key={idx} className="rounded-lg overflow-hidden"
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)'
                                        }}>
                                        <div className="p-3" style={{
                                            background: 'var(--bg-tertiary)',
                                            borderBottom: '1px solid var(--border-primary)'
                                        }}>
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <Link2 className="w-3.5 h-3.5" />
                                                        <code className="text-[11px] px-2 py-0.5 rounded"
                                                            style={{
                                                                background: 'var(--accent)',
                                                                color: 'var(--bg-primary)',
                                                                fontFamily: 'monospace'
                                                            }}>
                                                            {group.correlation_id}
                                                        </code>
                                                        {group.time_span && (
                                                            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                                                <Clock className="w-3 h-3 inline mr-0.5" />
                                                                {group.time_span}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Components:</span>
                                                        {group.components.map((comp, cidx) => (
                                                            <span key={cidx} className="text-[10px] px-1.5 py-0.5 rounded"
                                                                style={{
                                                                    background: 'var(--bg-primary)',
                                                                    color: 'var(--text-secondary)'
                                                                }}>
                                                                {comp}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Severities:</span>
                                                        {group.severities.map((sev, sidx) => (
                                                            <span key={sidx} className="text-[10px] px-1.5 py-0.5 rounded"
                                                                style={{
                                                                    background: getSeverityColor(sev),
                                                                    color: 'white'
                                                                }}>
                                                                {sev}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold"
                                                        style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                                                        {group.error_count}
                                                    </span>
                                                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                        related errors
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Dashboard View */}
                        {viewMode === 'dashboard' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Component Distribution */}
                                <div className="rounded-lg p-4"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    <h3 className="font-semibold mb-3"
                                        style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                        Component Distribution
                                    </h3>
                                    <div className="space-y-2">
                                        {Object.entries(processedData.componentBreakdown)
                                            .sort(([, a], [, b]) => b - a)
                                            .slice(0, 8)
                                            .map(([comp, count]) => {
                                                const percentage = (count / processedData.totalCount * 100).toFixed(1);
                                                return (
                                                    <div key={comp}>
                                                        <div className="flex justify-between mb-0.5">
                                                            <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                                {comp}
                                                            </span>
                                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                {count.toLocaleString()} ({percentage}%)
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 rounded-full overflow-hidden"
                                                            style={{ background: 'var(--bg-tertiary)' }}>
                                                            <div className="h-full rounded-full smooth-transition"
                                                                style={{ width: `${percentage}%`, background: 'var(--accent)' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>

                                {/* Top Errors */}
                                <div className="rounded-lg p-4"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    <h3 className="font-semibold mb-3"
                                        style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                        Most Frequent Errors
                                    </h3>
                                    <div className="space-y-2">
                                        {processedData.errorGroups.slice(0, 5).map((group, idx) => (
                                            <div key={idx} className="p-2.5 rounded-lg"
                                                style={{
                                                    background: 'var(--bg-tertiary)',
                                                    border: '1px solid var(--border-primary)'
                                                }}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            {getSeverityIcon(group.severity)}
                                                            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                                {group.component}
                                                            </span>
                                                        </div>
                                                        <p className="line-clamp-2"
                                                            style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                            {group.message}
                                                        </p>
                                                    </div>
                                                    <span className="ml-2 font-bold"
                                                        style={{ fontSize: '12px', color: getSeverityColor(group.severity) }}>
                                                        {group.totalCount}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Enhanced Context Stats */}
                                {processedData.hasEnhancedContext && (
                                    <div className="rounded-lg p-4"
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)'
                                        }}>
                                        <h3 className="font-semibold mb-3"
                                            style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                            Context Analysis
                                        </h3>
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center p-2.5 rounded-lg"
                                                style={{ background: 'var(--bg-tertiary)' }}>
                                                <span className="flex items-center gap-1.5"
                                                    style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                    <Terminal className="w-3.5 h-3.5" />
                                                    Errors with Full Context
                                                </span>
                                                <span className="font-bold"
                                                    style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                                                    {processedData.problems.filter(p => p.has_full_context).length}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center p-2.5 rounded-lg"
                                                style={{ background: 'var(--bg-tertiary)' }}>
                                                <span className="flex items-center gap-1.5"
                                                    style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                    <Link2 className="w-3.5 h-3.5" />
                                                    Errors with Correlation
                                                </span>
                                                <span className="font-bold"
                                                    style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                                                    {processedData.problems.filter(p => p.has_correlation).length}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center p-2.5 rounded-lg"
                                                style={{ background: 'var(--bg-tertiary)' }}>
                                                <span className="flex items-center gap-1.5"
                                                    style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                    <Code2 className="w-3.5 h-3.5" />
                                                    Errors with Stack Trace
                                                </span>
                                                <span className="font-bold"
                                                    style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                                                    {processedData.problems.filter(p => p.has_stack_trace).length}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Raw View */}
                        {viewMode === 'raw' && (
                            <div className="rounded-lg p-4"
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)'
                                }}>
                                <h3 className="font-semibold mb-2"
                                    style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                    Raw Analysis Data
                                </h3>
                                <pre className="p-3 rounded-lg"
                                    style={{
                                        background: '#1a1a1a',
                                        color: '#e5e5e5',
                                        fontSize: '11px',
                                        fontFamily: 'monospace',
                                        maxHeight: '500px',
                                        border: '1px solid var(--border-primary)',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                        overflowX: 'auto',
                                        overflowY: 'auto'
                                    }}>
                                    {JSON.stringify(analysisState.results, null, 2)}
                                </pre>
                            </div>
                        )}
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default AutoAnalysis;