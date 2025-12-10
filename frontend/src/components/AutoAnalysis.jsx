import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Play, RefreshCw, AlertCircle,
    ChevronRight, ChevronDown, Download,
    Zap, Package, AlertTriangle, XCircle,
    Info, BarChart3, Search,
    FileText, Copy, CheckCircle,
    Link2, Terminal, Code2, Clock, Hash,
    Sparkles, Bot, Loader2, Square, CheckSquare, Minus
} from 'lucide-react';
import AIAnalysisDisplay from './AIAnalysisDisplay';

const AutoAnalysis = ({ sessionId }) => {
    const [analysisState, setAnalysisState] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [expandedProblems, setExpandedProblems] = useState({});
    const [copiedIndex, setCopiedIndex] = useState(null);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const duoPollIntervalRef = useRef(null);

    // NEW: Selection state for AI analysis
    const [selectedProblems, setSelectedProblems] = useState(new Set());

    const [filters, setFilters] = useState({
        severity: 'all',
        component: 'all',
        errorType: 'gitlab',
        searchQuery: '',
        minCount: 1
    });
    const [viewMode, setViewMode] = useState('errors');
    const [activeTab, setActiveTab] = useState('errors');
    const [errorLimit, setErrorLimit] = useState(25);
    const [duoAnalysis, setDuoAnalysis] = useState(null);
    const [isDuoAnalyzing, setIsDuoAnalyzing] = useState(false);

    // WebSocket connection for real-time updates
    const connectWebSocket = useCallback(() => {
        if (!sessionId || wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(`ws://localhost:8000/ws/auto-analysis/${sessionId}`);

        ws.onopen = () => {
            console.log('WebSocket connected for session:', sessionId);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'ping') return;
            setAnalysisState(data);
            setIsRunning(data.status === 'processing');
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            wsRef.current = null;
            reconnectTimeoutRef.current = setTimeout(() => {
                connectWebSocket();
            }, 2000);
        };

        wsRef.current = ws;
    }, [sessionId]);

    // Initial load and WebSocket setup
    useEffect(() => {
        if (!sessionId) {
            setAnalysisState(null);
            setIsRunning(false);
            return;
        }

        const loadState = async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();
                setAnalysisState(data);
                setIsRunning(data.status === 'processing');
                connectWebSocket();
            } catch (error) {
                console.error('Error loading state:', error);
            }
        };

        loadState();

        fetch(`/api/auto-analysis/${sessionId}/duo-status`)
            .then(res => res.json())
            .then(data => {
                if (data.status !== 'not_started' && data.status !== 'not_available') {
                    setDuoAnalysis(data);
                }
            })
            .catch(console.error);

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (duoPollIntervalRef.current) {
                clearInterval(duoPollIntervalRef.current);
                duoPollIntervalRef.current = null;
            }
        };
    }, [sessionId, connectWebSocket]);

    const startAnalysis = async () => {
        try {
            setIsRunning(true);
            const response = await fetch(`/api/auto-analysis/${sessionId}`, { method: 'POST' });
            const data = await response.json();
            setAnalysisState(data);
            connectWebSocket();
        } catch (error) {
            console.error('Error starting analysis:', error);
            setIsRunning(false);
        }
    };

    const clearAnalysis = async () => {
        try {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            await fetch(`/api/auto-analysis/${sessionId}`, { method: 'DELETE' });

            setAnalysisState(null);
            setIsRunning(false);
            setExpandedProblems({});
            setSelectedProblems(new Set());
            setFilters({
                severity: 'all',
                component: 'all',
                errorType: 'gitlab',
                searchQuery: '',
                minCount: 1
            });
            setViewMode('errors');
        } catch (error) {
            console.error('Error clearing analysis:', error);
        }
    };

    const downloadReport = () => {
        if (!analysisState?.results) return;
        const blob = new Blob([JSON.stringify(analysisState.results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gitlab_errors_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const clearDuoRESTAnalysis = async () => {
        try {
            await fetch(`/api/auto-analysis/${sessionId}/duo-rest-clear`, { method: 'DELETE' });
            setDuoAnalysis(null);
            setIsDuoAnalyzing(false);
            if (duoPollIntervalRef.current) {
                clearInterval(duoPollIntervalRef.current);
                duoPollIntervalRef.current = null;
            }
        } catch (error) {
            console.error('Failed to clear analysis:', error);
        }
    };

    // Modified to use selected problems
    const startDuoRESTAnalysis = async () => {
        try {
            setIsDuoAnalyzing(true);
            setActiveTab('ai');

            // Build request with selected problems
            const selectedIndices = Array.from(selectedProblems);

            const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selected_indices: selectedIndices.length > 0 ? selectedIndices : null
                })
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const ws = new WebSocket(`ws://localhost:8000/ws/duo-rest/${sessionId}`);

            ws.onopen = () => console.log('Connected to Duo REST WebSocket');

            ws.onmessage = (event) => {
                const status = JSON.parse(event.data);
                setDuoAnalysis(status);

                if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
                    setIsDuoAnalyzing(false);
                    ws.close();
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsDuoAnalyzing(false);
                startRESTPolling();
            };

            ws.onclose = () => {
                if (isDuoAnalyzing) startRESTPolling();
            };

        } catch (error) {
            console.error('Duo analysis failed:', error);
            setIsDuoAnalyzing(false);
            alert(`Failed to start Duo analysis: ${error.message}`);
        }
    };

    const startRESTPolling = () => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-status`);
                const status = await response.json();
                setDuoAnalysis(status);

                if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
                    clearInterval(pollInterval);
                    setIsDuoAnalyzing(false);
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 2000);

        duoPollIntervalRef.current = pollInterval;
    };

    const copyToClipboard = useCallback((text, idx) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(idx);
        setTimeout(() => setCopiedIndex(null), 2000);
    }, []);

    const extractErrorMessage = (problem) => {
        if (!problem) return 'Unknown error';

        if (problem.clean_message && problem.clean_message.trim()) {
            return problem.clean_message;
        }
        if (problem.message && problem.message.trim()) {
            return problem.message;
        }

        const samples = problem.samples || [];
        for (const sample of samples) {
            if (sample.clean_message && sample.clean_message.trim()) {
                return sample.clean_message;
            }
            if (sample.message && sample.message.trim()) {
                return sample.message;
            }
            if (sample.full_line && sample.full_line.trim()) {
                try {
                    const json = JSON.parse(sample.full_line);
                    if (json.msg) return json.msg;
                    if (json.message) return json.message;
                    if (json.error) return json.error;
                    if (json['exception.message']) return json['exception.message'];
                } catch (e) { }

                return sample.full_line.substring(0, 200);
            }
        }

        if (problem.sample_line) {
            try {
                const json = JSON.parse(problem.sample_line);
                if (json.msg) return json.msg;
                if (json.message) return json.message;
            } catch (e) { }
            return problem.sample_line.substring(0, 200);
        }

        return problem.pattern_id || 'Unknown error pattern';
    };

    const formatFullContext = (problem) => {
        if (!problem) return null;
        const sample = problem.samples?.[0] || problem;
        return {
            message: extractErrorMessage(problem),
            fullLine: sample.full_line || sample.sample_line,
            contextBefore: sample.context_before || [],
            contextAfter: sample.context_after || [],
            stackTrace: sample.stack_trace,
            jsonFields: sample.json_fields || {},
            correlationId: sample.correlation_id,
            requestId: sample.request_id,
            errorCode: sample.error_code
        };
    };

    const processedData = useMemo(() => {
        if (!analysisState?.results) return null;

        const results = analysisState.results;
        let problems = filters.errorType === 'monitoring'
            ? results.monitoring_problems || []
            : results.problems || [];

        if (filters.severity !== 'all') {
            problems = problems.filter(p => p.severity?.toUpperCase() === filters.severity.toUpperCase());
        }
        if (filters.component !== 'all') {
            problems = problems.filter(p => p.component === filters.component);
        }
        if (filters.searchQuery) {
            const query = filters.searchQuery.toLowerCase();
            problems = problems.filter(p => {
                const errorMsg = extractErrorMessage(p).toLowerCase();
                return errorMsg.includes(query) || p.sample_line?.toLowerCase().includes(query) || p.component?.toLowerCase().includes(query);
            });
        }
        if (filters.minCount > 1) {
            problems = problems.filter(p => p.count >= filters.minCount);
        }

        const errorGroups = {};
        problems.forEach(problem => {
            const errorMsg = extractErrorMessage(problem);
            const normalizedMsg = errorMsg
                .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
                .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
                .replace(/\b\d+\b/g, 'N')
                .substring(0, 200);
            const groupKey = `${problem.component}:${problem.severity}:${normalizedMsg}`;

            if (!errorGroups[groupKey]) {
                errorGroups[groupKey] = {
                    message: errorMsg,
                    problems: [],
                    totalCount: 0,
                    severity: problem.severity,
                    component: problem.component,
                    hasCorrelation: problem.has_correlation || problem.correlation_id || false,
                    hasContext: problem.context_before?.length > 0 || false
                };
            }

            errorGroups[groupKey].problems.push(problem);
            errorGroups[groupKey].totalCount += problem.count || 1;
        });

        const sortedGroups = Object.values(errorGroups).sort((a, b) => b.totalCount - a.totalCount);

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

        return {
            problems,
            errorGroups: sortedGroups,
            totalCount: problems.reduce((sum, p) => sum + (p.count || 1), 0),
            uniquePatterns: problems.length,
            severityBreakdown,
            componentBreakdown,
            uniqueComponents
        };
    }, [analysisState, filters]);

    // Selection handlers
    const toggleProblemSelection = (idx) => {
        setSelectedProblems(prev => {
            const next = new Set(prev);
            if (next.has(idx)) {
                next.delete(idx);
            } else {
                next.add(idx);
            }
            return next;
        });
    };

    const selectAllVisible = () => {
        if (!processedData) return;
        const visibleIndices = processedData.errorGroups.slice(0, errorLimit).map((_, idx) => idx);
        setSelectedProblems(new Set(visibleIndices));
    };

    const deselectAll = () => {
        setSelectedProblems(new Set());
    };

    const getSelectionState = () => {
        if (!processedData) return 'none';
        const visibleCount = Math.min(errorLimit, processedData.errorGroups.length);
        if (selectedProblems.size === 0) return 'none';
        if (selectedProblems.size === visibleCount) return 'all';
        return 'partial';
    };

    const getSeverityColor = (severity) => {
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return '#dc2626';
            case 'ERROR': return '#ea580c';
            case 'WARNING': return '#2563eb';
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

    // Render AI Analysis Tab
    const renderAIAnalysisTab = () => (
        <div className="space-y-4">
            {!duoAnalysis || duoAnalysis.status === 'not_started' ? (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                        style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                        <Sparkles className="w-8 h-8" style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                    <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontSize: '15px' }}>
                        AI-Powered Analysis
                    </h3>
                    <p className="text-center max-w-md mb-6" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6' }}>
                        {selectedProblems.size > 0
                            ? `Analyze ${selectedProblems.size} selected error${selectedProblems.size > 1 ? 's' : ''} with GitLab Duo AI for root cause analysis and remediation suggestions.`
                            : 'Select errors from the Errors tab, then analyze them with GitLab Duo AI for root cause analysis and remediation suggestions.'
                        }
                    </p>
                    <button
                        onClick={startDuoRESTAnalysis}
                        disabled={isDuoAnalyzing || analysisState?.status !== 'completed'}
                        className="px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 transition-all hover:scale-[1.02]"
                        style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                        <Sparkles className="w-4 h-4" />
                        {selectedProblems.size > 0
                            ? `Analyze ${selectedProblems.size} Selected`
                            : 'Analyze All Errors'
                        }
                    </button>
                </div>
            ) : duoAnalysis.status === 'processing' ? (
                <div className="rounded-xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
                                Analyzing with GitLab Duo
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '2px' }}>
                                {duoAnalysis.current_pattern || 'Processing errors...'}
                            </p>
                        </div>
                    </div>

                    {duoAnalysis.patterns_total > 0 && (
                        <div className="space-y-3">
                            <div className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span>Progress</span>
                                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    {duoAnalysis.patterns_analyzed || 0} / {duoAnalysis.patterns_total}
                                </span>
                            </div>

                            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                        width: `${((duoAnalysis.patterns_analyzed || 0) / duoAnalysis.patterns_total) * 100}%`,
                                        background: 'var(--accent)'
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 mt-6">
                        {[
                            { label: 'Patterns', value: duoAnalysis.unique_patterns || 0, color: 'var(--text-primary)' },
                            { label: 'Total Errors', value: duoAnalysis.total_errors || 0, color: '#dc2626' },
                            { label: 'Progress', value: `${Math.round(((duoAnalysis.patterns_analyzed || 0) / Math.max(duoAnalysis.patterns_total || 1, 1)) * 100)}%`, color: 'var(--accent)' }
                        ].map((stat, idx) => (
                            <div key={idx} className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                                <div className="font-bold" style={{ color: stat.color, fontSize: '18px' }}>{stat.value}</div>
                                <div className="text-xs uppercase tracking-wider mt-1" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : duoAnalysis.status === 'completed' ? (
                <AIAnalysisDisplay
                    duoAnalysis={duoAnalysis}
                    onExport={() => {
                        const markdown = duoAnalysis.analyses.map((a, idx) => {
                            return `# Pattern ${a.pattern_number}: ${a.error.component}\n\n` +
                                `**Severity:** ${a.error.severity}\n` +
                                `**Occurrences:** ${a.error.count}\n` +
                                `**Error:** ${a.error.message}\n\n` +
                                `## AI Analysis\n\n${a.analysis}\n\n---\n\n`;
                        }).join('\n');

                        const blob = new Blob([markdown], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `duo_analysis_${sessionId}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                    }}
                />
            ) : duoAnalysis.status === 'failed' ? (
                <div className="rounded-xl p-6" style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
                    <div className="flex items-start gap-4">
                        <XCircle className="w-6 h-6 mt-0.5" style={{ color: '#dc2626' }} />
                        <div className="flex-1">
                            <h3 className="font-semibold mb-2" style={{ color: '#dc2626', fontSize: '14px' }}>Analysis Failed</h3>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {duoAnalysis.error || 'An error occurred during analysis'}
                            </p>
                            <div className="flex gap-2 mt-4">
                                <button onClick={startDuoRESTAnalysis}
                                    className="px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                    style={{ background: '#dc2626', color: 'white' }}>
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Retry
                                </button>
                                <button onClick={clearDuoRESTAnalysis}
                                    className="px-4 py-2 rounded-lg text-xs font-medium"
                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );

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
            <div className="px-6 py-4" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                            <Zap className="w-5 h-5" style={{ color: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                            <h2 className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: '16px' }}>
                                Error Analysis
                            </h2>
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '2px' }}>
                                Detect patterns and analyze with AI
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {analysisState?.status === 'completed' && (
                            <>
                                <button onClick={downloadReport}
                                    className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    <Download className="w-3.5 h-3.5" />
                                    Export
                                </button>
                                <button onClick={clearAnalysis}
                                    className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    Clear
                                </button>
                            </>
                        )}
                        <button onClick={startAnalysis} disabled={isRunning}
                            className="px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 disabled:opacity-50 transition-all hover:scale-[1.02]"
                            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                            {isRunning ? (
                                <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Analyzing</>
                            ) : (
                                <><Play className="w-3.5 h-3.5" />Analyze</>
                            )}
                        </button>
                    </div>
                </div>

                {/* Progress Bar during analysis */}
                {isRunning && analysisState && (
                    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                                <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>
                                    {analysisState.message || 'Processing...'}
                                </span>
                            </div>
                            <span className="font-bold text-sm" style={{ color: 'var(--accent)' }}>
                                {analysisState.progress || 0}%
                            </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                            <div className="h-full transition-all duration-300 rounded-full"
                                style={{ width: `${analysisState.progress || 0}%`, background: 'var(--accent)' }} />
                        </div>
                    </div>
                )}

                {/* Stats & Tabs */}
                {analysisState?.status === 'completed' && processedData && (
                    <>
                        {/* Stats Grid */}
                        <div className="grid grid-cols-6 gap-2 mt-4 mb-4">
                            {[
                                { label: 'Total', value: processedData.totalCount.toLocaleString(), color: 'var(--text-primary)' },
                                { label: 'Critical', value: processedData.severityBreakdown.CRITICAL || 0, color: '#dc2626' },
                                { label: 'Errors', value: processedData.severityBreakdown.ERROR || 0, color: '#ea580c' },
                                { label: 'Warnings', value: processedData.severityBreakdown.WARNING || 0, color: '#2563eb' },
                                { label: 'Patterns', value: processedData.uniquePatterns, color: 'var(--text-primary)' },
                                { label: 'Components', value: processedData.uniqueComponents.length, color: 'var(--text-primary)' }
                            ].map((stat, idx) => (
                                <div key={idx} className="text-center py-2.5 px-2 rounded-lg"
                                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                    <p className="font-bold" style={{ fontSize: '15px', color: stat.color }}>{stat.value}</p>
                                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* View Tabs */}
                        <div className="flex gap-1 mb-4">
                            {[
                                { id: 'errors', icon: AlertCircle, label: 'Errors' },
                                { id: 'ai', icon: Sparkles, label: `AI Analysis${selectedProblems.size > 0 ? ` (${selectedProblems.size})` : ''}` },
                                { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
                                { id: 'raw', icon: Code2, label: 'Raw' }
                            ].map(tab => (
                                <button key={tab.id} onClick={() => { setActiveTab(tab.id); setViewMode(tab.id); }}
                                    className="px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                                    style={{
                                        background: activeTab === tab.id ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: activeTab === tab.id ? 'var(--bg-primary)' : 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    <tab.icon className="w-3.5 h-3.5" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Filters (only for errors tab) */}
                        {activeTab === 'errors' && (
                            <div className="flex flex-wrap gap-2 items-center p-3 rounded-xl"
                                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                {/* Error Type Toggle */}
                                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-primary)' }}>
                                    <button onClick={() => setFilters(prev => ({ ...prev, errorType: 'gitlab' }))}
                                        className="px-3 py-1.5 text-xs font-medium transition-colors"
                                        style={{
                                            background: filters.errorType === 'gitlab' ? 'var(--accent)' : 'var(--bg-primary)',
                                            color: filters.errorType === 'gitlab' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                        }}>
                                        GitLab ({analysisState.results.gitlab_problems || 0})
                                    </button>
                                    <button onClick={() => setFilters(prev => ({ ...prev, errorType: 'monitoring' }))}
                                        className="px-3 py-1.5 text-xs font-medium transition-colors"
                                        style={{
                                            background: filters.errorType === 'monitoring' ? 'var(--accent)' : 'var(--bg-primary)',
                                            color: filters.errorType === 'monitoring' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                        }}>
                                        Monitoring ({analysisState.results.monitoring_issues || 0})
                                    </button>
                                </div>

                                <select value={filters.severity} onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
                                    className="px-3 py-1.5 rounded-lg text-xs"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    <option value="all">All Severities</option>
                                    <option value="critical">Critical</option>
                                    <option value="error">Errors</option>
                                    <option value="warning">Warnings</option>
                                </select>

                                {processedData.uniqueComponents.length > 0 && (
                                    <select value={filters.component} onChange={(e) => setFilters(prev => ({ ...prev, component: e.target.value }))}
                                        className="px-3 py-1.5 rounded-lg text-xs"
                                        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                        <option value="all">All Components</option>
                                        {processedData.uniqueComponents.map(comp => (
                                            <option key={comp} value={comp}>{comp}</option>
                                        ))}
                                    </select>
                                )}

                                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                                    <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                                    <input type="text" placeholder="Search errors..." value={filters.searchQuery}
                                        onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                                        className="px-3 py-1.5 rounded-lg text-xs flex-1"
                                        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                                    />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
                {!analysisState || analysisState.status === 'not_started' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Zap className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                            <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontSize: '15px' }}>Ready to Analyze</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Click "Analyze" to detect error patterns in your logs</p>
                        </div>
                    </div>
                ) : analysisState.status === 'processing' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="w-16 h-16 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto mb-4"
                                style={{ borderColor: 'var(--accent)' }} />
                            <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontSize: '15px' }}>
                                Analyzing Patterns...
                            </h3>
                            <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {analysisState.message || 'Processing...'}
                            </p>
                        </div>
                    </div>
                ) : analysisState.status === 'completed' && processedData ? (
                    <>
                        {/* Errors View */}
                        {activeTab === 'errors' && (
                            <div className="space-y-3">
                                {/* Selection Toolbar */}
                                <div className="flex items-center justify-between p-3 rounded-xl"
                                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <div className="flex items-center gap-3">
                                        {/* Select All Checkbox */}
                                        <button
                                            onClick={() => getSelectionState() === 'all' ? deselectAll() : selectAllVisible()}
                                            className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors hover:bg-opacity-50"
                                            style={{ color: 'var(--text-primary)' }}>
                                            {getSelectionState() === 'all' ? (
                                                <CheckSquare className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                                            ) : getSelectionState() === 'partial' ? (
                                                <Minus className="w-4 h-4 p-0.5 rounded" style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }} />
                                            ) : (
                                                <Square className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                                            )}
                                            <span className="text-xs font-medium">
                                                {selectedProblems.size > 0 ? `${selectedProblems.size} selected` : 'Select all'}
                                            </span>
                                        </button>

                                        {selectedProblems.size > 0 && (
                                            <>
                                                <div className="w-px h-4" style={{ background: 'var(--border-primary)' }} />
                                                <button
                                                    onClick={deselectAll}
                                                    className="text-xs font-medium px-2 py-1 rounded-lg transition-colors"
                                                    style={{ color: 'var(--text-secondary)' }}>
                                                    Clear selection
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {selectedProblems.size > 0 && (
                                            <button
                                                onClick={() => { setActiveTab('ai'); startDuoRESTAnalysis(); }}
                                                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-[1.02]"
                                                style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                                                <Sparkles className="w-3.5 h-3.5" />
                                                Analyze {selectedProblems.size} with AI
                                            </button>
                                        )}

                                        <select value={errorLimit} onChange={(e) => setErrorLimit(parseInt(e.target.value))}
                                            className="px-3 py-1.5 rounded-lg text-xs"
                                            style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                            <option value="10">Show 10</option>
                                            <option value="25">Show 25</option>
                                            <option value="50">Show 50</option>
                                            <option value="9999">Show All</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Success Banner */}
                                <div className="flex items-center gap-3 p-3 rounded-xl"
                                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <CheckCircle className="w-5 h-5" style={{ color: '#10b981' }} />
                                    <div className="flex-1">
                                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                                            Analysis Complete
                                        </p>
                                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            Found {processedData.totalCount.toLocaleString()} errors across {processedData.errorGroups.length} patterns
                                        </p>
                                    </div>
                                </div>

                                {/* Error List */}
                                {processedData.errorGroups.slice(0, errorLimit).map((group, idx) => {
                                    const isExpanded = expandedProblems[idx];
                                    const isSelected = selectedProblems.has(idx);
                                    const firstProblem = group.problems[0];
                                    const context = formatFullContext(firstProblem);
                                    const msg = group.message || extractErrorMessage(firstProblem);

                                    return (
                                        <div key={idx} className="rounded-xl overflow-hidden transition-shadow"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border-primary)',
                                                boxShadow: isSelected ? '0 0 0 3px rgba(0,0,0,0.05)' : 'none'
                                            }}>
                                            <div className="p-4" style={{ borderBottom: isExpanded ? '1px solid var(--border-primary)' : 'none' }}>
                                                <div className="flex items-start gap-3">
                                                    {/* Checkbox */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); toggleProblemSelection(idx); }}
                                                        className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110">
                                                        {isSelected ? (
                                                            <CheckSquare className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                                                        ) : (
                                                            <Square className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
                                                        )}
                                                    </button>

                                                    {/* Expand Button */}
                                                    <button onClick={() => setExpandedProblems(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                                        className="mt-0.5 flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                    </button>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded"
                                                                style={{ background: getSeverityColor(group.severity), color: 'white' }}>
                                                                {getSeverityIcon(group.severity)}
                                                                {group.severity}
                                                            </span>
                                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                {group.component}
                                                            </span>
                                                            {group.hasCorrelation && (
                                                                <span className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
                                                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
                                                                    <Link2 className="w-3 h-3" />
                                                                    Correlated
                                                                </span>
                                                            )}
                                                        </div>

                                                        <pre className="p-2.5 rounded-lg font-mono text-xs"
                                                            style={{
                                                                background: 'var(--bg-primary)',
                                                                color: 'var(--text-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-word',
                                                                maxHeight: '80px',
                                                                overflow: 'hidden',
                                                                border: '1px solid var(--border-primary)',
                                                                lineHeight: '1.5'
                                                            }}>
                                                            {msg.length > 300 ? msg.substring(0, 300) + '...' : msg}
                                                        </pre>

                                                        {firstProblem.files && firstProblem.files.length > 0 && (
                                                            <div className="mt-2 flex items-center gap-1.5">
                                                                <FileText className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                                                                <span className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                                                                    {firstProblem.files[0]}
                                                                    {firstProblem.files.length > 1 && ` +${firstProblem.files.length - 1}`}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Count Badge */}
                                                    <div className="text-right flex-shrink-0">
                                                        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold"
                                                            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                                                            {group.totalCount.toLocaleString()}
                                                        </span>
                                                        <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                            occurrences
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded Details */}
                                            {isExpanded && context && (
                                                <div className="p-4 space-y-4" style={{ background: 'var(--bg-primary)' }}>
                                                    {/* Full Error */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                                                Full Error
                                                            </h4>
                                                            <button onClick={() => copyToClipboard(context.fullLine, idx)}
                                                                className="text-xs px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                                                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                                                {copiedIndex === idx ? <><CheckCircle className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                                                            </button>
                                                        </div>
                                                        <pre className="p-3 rounded-lg" style={{
                                                            background: '#1a1a1a',
                                                            color: '#ff6b6b',
                                                            fontSize: '11px',
                                                            lineHeight: '1.6',
                                                            fontFamily: '"SF Mono", Monaco, monospace',
                                                            border: '2px solid #ff6b6b',
                                                            whiteSpace: 'pre-wrap',
                                                            wordBreak: 'break-all',
                                                            maxHeight: '400px',
                                                            overflow: 'auto'
                                                        }}>
                                                            {context.fullLine}
                                                        </pre>
                                                    </div>

                                                    {/* Context Before */}
                                                    {context.contextBefore?.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                                Context Before
                                                            </h4>
                                                            <pre className="p-3 rounded-lg" style={{
                                                                background: '#1a1a1a',
                                                                color: '#888',
                                                                fontSize: '11px',
                                                                lineHeight: '1.5',
                                                                fontFamily: '"SF Mono", Monaco, monospace',
                                                                border: '1px solid var(--border-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-all',
                                                                maxHeight: '200px',
                                                                overflow: 'auto'
                                                            }}>
                                                                {context.contextBefore.join('\n')}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {/* Context After */}
                                                    {context.contextAfter?.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                                Context After
                                                            </h4>
                                                            <pre className="p-3 rounded-lg" style={{
                                                                background: '#1a1a1a',
                                                                color: '#888',
                                                                fontSize: '11px',
                                                                lineHeight: '1.5',
                                                                fontFamily: '"SF Mono", Monaco, monospace',
                                                                border: '1px solid var(--border-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-all',
                                                                maxHeight: '200px',
                                                                overflow: 'auto'
                                                            }}>
                                                                {context.contextAfter.join('\n')}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {/* Correlation IDs */}
                                                    {(context.correlationId || context.requestId) && (
                                                        <div className="flex gap-4">
                                                            {context.correlationId && (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Correlation:</span>
                                                                    <code className="px-2 py-0.5 rounded text-xs font-mono"
                                                                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                                                                        {context.correlationId}
                                                                    </code>
                                                                </div>
                                                            )}
                                                            {context.requestId && (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Request:</span>
                                                                    <code className="px-2 py-0.5 rounded text-xs font-mono"
                                                                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                                                                        {context.requestId}
                                                                    </code>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Files */}
                                                    {firstProblem.files?.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                                Affected Files
                                                            </h4>
                                                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                                                {firstProblem.files.map((file, fidx) => (
                                                                    <span key={fidx} className="px-2 py-1 rounded-lg text-xs"
                                                                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
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

                        {/* Dashboard View */}
                        {activeTab === 'dashboard' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="rounded-xl p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <h3 className="font-semibold mb-4" style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                        Component Distribution
                                    </h3>
                                    <div className="space-y-3">
                                        {Object.entries(processedData.componentBreakdown)
                                            .sort(([, a], [, b]) => b - a)
                                            .slice(0, 8)
                                            .map(([comp, count]) => {
                                                const percentage = (count / processedData.totalCount * 100).toFixed(1);
                                                return (
                                                    <div key={comp}>
                                                        <div className="flex justify-between mb-1">
                                                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{comp}</span>
                                                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                                {count.toLocaleString()} ({percentage}%)
                                                            </span>
                                                        </div>
                                                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                                            <div className="h-full rounded-full transition-all" style={{ width: `${percentage}%`, background: 'var(--accent)' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>

                                <div className="rounded-xl p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <h3 className="font-semibold mb-4" style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                        Most Frequent Errors
                                    </h3>
                                    <div className="space-y-3">
                                        {processedData.errorGroups.slice(0, 5).map((group, idx) => (
                                            <div key={idx} className="p-3 rounded-lg"
                                                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            {getSeverityIcon(group.severity)}
                                                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{group.component}</span>
                                                        </div>
                                                        <p className="text-xs line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                                                            {group.message}
                                                        </p>
                                                    </div>
                                                    <span className="ml-3 font-bold text-sm" style={{ color: getSeverityColor(group.severity) }}>
                                                        {group.totalCount.toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Raw View */}
                        {activeTab === 'raw' && (
                            <div className="rounded-xl p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                <h3 className="font-semibold mb-3" style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                    Raw Analysis Data
                                </h3>
                                <pre className="p-4 rounded-lg" style={{
                                    background: '#1a1a1a',
                                    color: '#e5e5e5',
                                    fontSize: '11px',
                                    fontFamily: '"SF Mono", Monaco, monospace',
                                    maxHeight: '600px',
                                    border: '1px solid var(--border-primary)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                    overflow: 'auto'
                                }}>
                                    {JSON.stringify(analysisState.results, null, 2)}
                                </pre>
                            </div>
                        )}

                        {/* AI Analysis View */}
                        {activeTab === 'ai' && renderAIAnalysisTab()}
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default AutoAnalysis;