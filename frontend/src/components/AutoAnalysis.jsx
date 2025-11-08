import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Play, RefreshCw, AlertCircle,
    ChevronRight, ChevronDown, Download,
    Zap, Package, AlertTriangle, XCircle,
    Info, BarChart3, Search,
    FileText, Copy, CheckCircle,
    Link2, Terminal, Code2, Clock, Hash
} from 'lucide-react';

const AutoAnalysis = ({ sessionId }) => {
    const [analysisState, setAnalysisState] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [expandedProblems, setExpandedProblems] = useState({});
    const [copiedIndex, setCopiedIndex] = useState(null);
    const pollIntervalRef = useRef(null);

    const [filters, setFilters] = useState({
        severity: 'all',
        component: 'all',
        errorType: 'gitlab',
        searchQuery: '',
        minCount: 1
    });
    const [viewMode, setViewMode] = useState('errors');
    const [errorLimit, setErrorLimit] = useState(25);

    // Enhanced Polling with detailed progress tracking - useCallback to prevent recreating
    const startPolling = useCallback(() => {
        // Clear any existing interval first
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        console.log('Starting polling for session:', sessionId);
        
        // Set up new polling interval
        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();
                
                console.log('Poll data:', data.status, data.progress);
                
                // Update state with fresh data
                setAnalysisState(data);
                
                // Update running state based on status
                if (data.status === 'processing') {
                    setIsRunning(true);
                } else if (data.status === 'completed' || data.status === 'failed') {
                    setIsRunning(false);
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    console.log('Analysis finished, stopping polling');
                }
            } catch (error) {
                console.error('Error polling:', error);
            }
        }, 500); // Poll every 500ms for smoother updates
    }, [sessionId]);

    // Check status whenever component mounts or sessionId changes
    useEffect(() => {
        if (!sessionId) {
            setAnalysisState(null);
            setIsRunning(false);
            return;
        }

        console.log('AutoAnalysis mounted/updated for session:', sessionId);

        const checkCurrentStatus = async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();
                
                console.log('Current status check:', data.status);
                
                // Update state based on current backend status
                setAnalysisState(data);
                
                if (data.status === 'processing') {
                    // Analysis is running - restart polling to track it
                    setIsRunning(true);
                    startPolling();
                } else if (data.status === 'completed') {
                    // Analysis completed
                    setIsRunning(false);
                } else if (data.status === 'failed') {
                    // Analysis failed
                    setIsRunning(false);
                } else {
                    // Not started or unknown status
                    setAnalysisState(null);
                    setIsRunning(false);
                }
            } catch (error) {
                console.error('Error checking auto-analysis status:', error);
                // On error, assume not running
                setIsRunning(false);
            }
        };

        // Always check current status when mounting
        checkCurrentStatus();

        // Cleanup function - stop polling when unmounting
        return () => {
            console.log('AutoAnalysis unmounting, clearing polling');
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [sessionId, startPolling]);

    const startAnalysis = async () => {
        try {
            console.log('Starting analysis for session:', sessionId);
            setIsRunning(true);
            
            const response = await fetch(`/api/auto-analysis/${sessionId}`, { method: 'POST' });
            const data = await response.json();
            
            console.log('Start analysis response:', data);

            if (data.status === 'already_completed') {
                // Analysis was already done
                setAnalysisState(data.results || data);
                setIsRunning(false);
            } else if (data.status === 'already_running') {
                // Analysis already running - get current state and poll
                const statusResponse = await fetch(`/api/auto-analysis/${sessionId}`);
                const statusData = await statusResponse.json();
                setAnalysisState(statusData);
                setIsRunning(true);
                startPolling();
            } else {
                // New analysis started
                setAnalysisState({ 
                    status: 'processing', 
                    progress: 0, 
                    message: 'Initializing analysis...',
                    started_at: new Date().toISOString()
                });
                setIsRunning(true);
                startPolling();
            }
        } catch (error) {
            console.error('Error starting analysis:', error);
            setIsRunning(false);
        }
    };

    const clearAnalysis = async () => {
        try {
            // Stop any polling first
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            
            await fetch(`/api/auto-analysis/${sessionId}`, { method: 'DELETE' });
            
            // Reset all state
            setAnalysisState(null);
            setIsRunning(false);
            setExpandedProblems({});
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

    const copyToClipboard = async (text, index) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const extractErrorMessage = (problem) => {
        if (!problem) return 'Unknown error';
        if (problem.message && typeof problem.message === 'string') return problem.message;
        if (problem.description && typeof problem.description === 'string') return problem.description;
        if (problem.samples && problem.samples[0]?.message) return problem.samples[0].message;
        return problem.pattern_id || 'Unknown error';
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

        // Apply filters
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

        // Group errors
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
            <div className="p-4" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                            <Zap className="w-4.5 h-4.5" style={{ color: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                            <h2 className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: '15px' }}>
                                Error Analysis
                            </h2>
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '2px' }}>
                                Pattern detection and error clustering
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {analysisState?.status === 'completed' && (
                            <>
                                <button onClick={downloadReport}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    <Download className="w-3.5 h-3.5" />
                                    Export
                                </button>
                                <button onClick={clearAnalysis}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    Clear
                                </button>
                            </>
                        )}
                        <button onClick={startAnalysis} disabled={isRunning}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                            style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}>
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

                {/* Enhanced Real-time Progress */}
                {isRunning && analysisState && (
                    <div className="mt-3 p-3 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                        {/* Progress Header */}
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                                <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                                    Analyzing Files
                                </span>
                            </div>
                            <span className="font-bold text-sm" style={{ color: 'var(--accent)' }}>
                                {analysisState.progress || 0}%
                            </span>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: 'var(--bg-primary)' }}>
                            <div className="h-full transition-all duration-300 rounded-full bg-gradient-to-r from-blue-500 to-green-500"
                                style={{ width: `${analysisState.progress || 0}%` }} />
                        </div>
                        
                        {/* Current File Info */}
                        <div className="space-y-1.5">
                            {analysisState.message && (
                                <div className="flex items-center gap-2">
                                    <FileText className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                                    <span className="font-mono text-[10px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                                        {analysisState.message}
                                    </span>
                                </div>
                            )}
                            
                            {/* Live Stats Grid */}
                            <div className="grid grid-cols-3 gap-2 mt-2">
                                {analysisState.files_processed !== undefined && (
                                    <div className="text-center p-1.5 rounded" style={{ background: 'var(--bg-primary)' }}>
                                        <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                            {analysisState.files_processed || 0}
                                        </div>
                                        <div style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>Files</div>
                                    </div>
                                )}
                                
                                {analysisState.live_error_count !== undefined && (
                                    <div className="text-center p-1.5 rounded" style={{ background: 'var(--bg-primary)' }}>
                                        <div className="text-xs font-bold" style={{ color: '#ef4444' }}>
                                            {analysisState.live_error_count || 0}
                                        </div>
                                        <div style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>Errors</div>
                                    </div>
                                )}
                                
                                {analysisState.lines_processed !== undefined && (
                                    <div className="text-center p-1.5 rounded" style={{ background: 'var(--bg-primary)' }}>
                                        <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                            {Math.round((analysisState.lines_processed || 0) / 1000)}k
                                        </div>
                                        <div style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>Lines</div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Processing Speed Indicator */}
                            {analysisState.errors_per_second !== undefined && (
                                <div className="flex items-center gap-1 mt-2">
                                    <Zap className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                        Processing {Math.round(analysisState.errors_per_second || 0)} errors/sec
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Stats & Controls */}
                {analysisState?.status === 'completed' && processedData && (
                    <>
                        <div className="grid grid-cols-6 gap-2 mt-3 mb-3">
                            {[
                                { label: 'Total', value: processedData.totalCount.toLocaleString(), color: 'var(--text-primary)' },
                                { label: 'Critical', value: processedData.severityBreakdown.CRITICAL || 0, color: '#ef4444' },
                                { label: 'Errors', value: processedData.severityBreakdown.ERROR || 0, color: '#f59e0b' },
                                { label: 'Warnings', value: processedData.severityBreakdown.WARNING || 0, color: '#3b82f6' },
                                { label: 'Patterns', value: processedData.uniquePatterns, color: 'var(--text-primary)' },
                                { label: 'Components', value: processedData.uniqueComponents.length, color: 'var(--text-primary)' }
                            ].map((stat, idx) => (
                                <div key={idx} className="text-center p-2 rounded-lg"
                                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                    <p className="font-bold" style={{ fontSize: '14px', color: stat.color }}>{stat.value}</p>
                                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* View Tabs */}
                        <div className="flex gap-1.5 mb-3">
                            {['errors', 'dashboard', 'raw'].map(mode => (
                                <button key={mode} onClick={() => setViewMode(mode)}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium capitalize"
                                    style={{
                                        background: viewMode === mode ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: viewMode === mode ? 'var(--bg-primary)' : 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    {mode === 'errors' && <AlertCircle className="w-3 h-3 inline mr-1" />}
                                    {mode === 'dashboard' && <BarChart3 className="w-3 h-3 inline mr-1" />}
                                    {mode === 'raw' && <Code2 className="w-3 h-3 inline mr-1" />}
                                    {mode}
                                </button>
                            ))}
                        </div>

                        {/* Filters */}
                        <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-lg"
                            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-primary)' }}>
                                <button onClick={() => setFilters(prev => ({ ...prev, errorType: 'gitlab' }))}
                                    className="px-2.5 py-1 text-[11px] font-medium"
                                    style={{
                                        background: filters.errorType === 'gitlab' ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: filters.errorType === 'gitlab' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                    }}>
                                    GitLab ({analysisState.results.gitlab_problems || 0})
                                </button>
                                <button onClick={() => setFilters(prev => ({ ...prev, errorType: 'monitoring' }))}
                                    className="px-2.5 py-1 text-[11px] font-medium"
                                    style={{
                                        background: filters.errorType === 'monitoring' ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: filters.errorType === 'monitoring' ? 'var(--bg-primary)' : 'var(--text-primary)'
                                    }}>
                                    Monitoring ({analysisState.results.monitoring_issues || 0})
                                </button>
                            </div>

                            <select value={filters.severity} onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
                                className="px-2.5 py-1 rounded-lg text-[11px]"
                                style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                <option value="all">All Severities</option>
                                <option value="critical">Critical</option>
                                <option value="error">Errors</option>
                                <option value="warning">Warnings</option>
                            </select>

                            {processedData.uniqueComponents.length > 0 && (
                                <select value={filters.component} onChange={(e) => setFilters(prev => ({ ...prev, component: e.target.value }))}
                                    className="px-2.5 py-1 rounded-lg text-[11px]"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                    <option value="all">All Components</option>
                                    {processedData.uniqueComponents.map(comp => (
                                        <option key={comp} value={comp}>{comp}</option>
                                    ))}
                                </select>
                            )}

                            <div className="flex items-center gap-1.5 flex-1">
                                <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                                <input type="text" placeholder="Search errors..." value={filters.searchQuery}
                                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                                    className="px-2.5 py-1 rounded-lg text-[11px] flex-1"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                                />
                            </div>

                            <div className="flex items-center gap-1">
                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Min:</span>
                                <input type="number" min="1" value={filters.minCount}
                                    onChange={(e) => setFilters(prev => ({ ...prev, minCount: parseInt(e.target.value) || 1 }))}
                                    className="px-1.5 py-1 rounded-lg text-[11px] w-14"
                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
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
                            <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Click "Analyze" to detect error patterns</p>
                        </div>
                    </div>
                ) : analysisState.status === 'processing' ? (
                    <div className="rounded-lg p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin"
                                style={{ borderColor: 'var(--accent)' }} />
                            <div className="flex-1">
                                <h3 style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>
                                    Analyzing Patterns...
                                </h3>
                                <p className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    {analysisState.message || 'Processing...'}
                                </p>
                            </div>
                        </div>
                        
                        {/* Progress indicators based on message */}
                        <div className="space-y-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            {analysisState.message?.includes('Extracting') && (
                                <div className="flex items-center gap-2">
                                    <Package className="w-3.5 h-3.5" />
                                    <span>Extracting archive files...</span>
                                </div>
                            )}
                            {analysisState.message?.includes('Found') && (
                                <div className="flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5" />
                                    <span>{analysisState.message}</span>
                                </div>
                            )}
                            {analysisState.message?.includes('Processing') && (
                                <div className="flex items-center gap-2">
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>Processing files with parallel workers...</span>
                                </div>
                            )}
                        </div>
                    </div>
                ) : analysisState.status === 'completed' && processedData ? (
                    <>
                        {viewMode === 'errors' && (
                            <div className="space-y-3">
                                {/* Success Animation */}
                                <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-blue-500/10"
                                     style={{ border: '1px solid var(--accent)' }}>
                                    <CheckCircle className="w-5 h-5" style={{ color: '#10b981' }} />
                                    <div className="flex-1">
                                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                            Analysis Complete!
                                        </p>
                                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                            Found {processedData.totalCount} errors in {processedData.errorGroups.length} patterns
                                            {analysisState.results?.metadata?.analysis_duration_seconds && 
                                                ` • Completed in ${analysisState.results.metadata.analysis_duration_seconds.toFixed(1)}s`}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mb-3">
                                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        Found {processedData.errorGroups.length} unique error types
                                    </p>
                                    <select value={errorLimit} onChange={(e) => setErrorLimit(parseInt(e.target.value))}
                                        className="px-2.5 py-1 rounded-lg text-[11px]"
                                        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                        <option value="10">Show 10</option>
                                        <option value="25">Show 25</option>
                                        <option value="50">Show 50</option>
                                        <option value="9999">Show All</option>
                                    </select>
                                </div>

                                {processedData.errorGroups.slice(0, errorLimit).map((group, idx) => {
                                    const isExpanded = expandedProblems[idx];
                                    const firstProblem = group.problems[0];
                                    const context = formatFullContext(firstProblem);
                                    const msg = group.message || extractErrorMessage(firstProblem);
                                    
                                    // Determine if message should be in code block
                                    const isLongOrTechnical = msg.length > 150 || msg.includes('{') || msg.includes('[') || 
                                        msg.includes('::') || msg.includes('exception.backtrace') || msg.includes('"');

                                    return (
                                        <div key={idx} className="rounded-lg overflow-hidden"
                                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                            <div className="p-3" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-start gap-2 flex-1">
                                                        <button onClick={() => setExpandedProblems(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                                            className="mt-0.5 opacity-60 hover:opacity-100">
                                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                        </button>

                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                {getSeverityIcon(group.severity)}
                                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                                                                    style={{ background: getSeverityColor(group.severity), color: 'white' }}>
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
                                                            </div>

                                                            {/* Smart message display */}
                                                            {isLongOrTechnical ? (
                                                                <pre className="p-2 rounded font-mono" style={{
                                                                    background: 'var(--bg-primary)',
                                                                    fontSize: '11px',
                                                                    color: 'var(--text-primary)',
                                                                    whiteSpace: 'pre-wrap',
                                                                    wordBreak: 'break-all',
                                                                    maxHeight: '80px',
                                                                    overflow: 'hidden',
                                                                    border: '1px solid var(--border-primary)'
                                                                }}>
                                                                    {msg.length > 300 ? msg.substring(0, 300) + '...' : msg}
                                                                </pre>
                                                            ) : (
                                                                <p className="font-medium" style={{ fontSize: '12px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                                                                    {msg}
                                                                </p>
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

                                            {/* Expanded Details - ALWAYS WORKS */}
                                            {isExpanded && context && (
                                                <div className="p-4 space-y-3">
                                                    {/* Full Error Line */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)'
                                                            }}>
                                                                Full Error
                                                            </h4>
                                                            <button onClick={() => copyToClipboard(context.fullLine, idx)}
                                                                className="text-[10px] px-2 py-0.5 rounded-lg flex items-center gap-1"
                                                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
                                                                {copiedIndex === idx ? (
                                                                    <><CheckCircle className="w-3 h-3" />Copied</>
                                                                ) : (
                                                                    <><Copy className="w-3 h-3" />Copy</>
                                                                )}
                                                            </button>
                                                        </div>
                                                        <pre className="p-3 rounded-lg" style={{
                                                            background: '#1a1a1a',
                                                            color: '#ff6b6b',
                                                            fontSize: '11px',
                                                            lineHeight: '1.5',
                                                            fontFamily: '"SF Mono", Monaco, monospace',
                                                            border: '2px solid #ff6b6b',
                                                            whiteSpace: 'pre-wrap',
                                                            wordBreak: 'break-all',
                                                            overflowX: 'auto',
                                                            maxHeight: '400px'
                                                        }}>
                                                            {context.fullLine}
                                                        </pre>
                                                    </div>

                                                    {/* Context Before */}
                                                    {context.contextBefore && context.contextBefore.length > 0 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
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
                                                                overflowX: 'auto',
                                                                maxHeight: '200px'
                                                            }}>
                                                                {context.contextBefore.join('\n')}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {/* Context After */}
                                                    {context.contextAfter && context.contextAfter.length > 0 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
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
                                                                overflowX: 'auto',
                                                                maxHeight: '200px'
                                                            }}>
                                                                {context.contextAfter.join('\n')}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {/* Stack Trace */}
                                                    {context.stackTrace && context.stackTrace.length > 0 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
                                                                Stack Trace
                                                            </h4>
                                                            <pre className="p-3 rounded-lg" style={{
                                                                background: '#1a1a1a',
                                                                color: '#ffa500',
                                                                fontSize: '11px',
                                                                lineHeight: '1.5',
                                                                fontFamily: '"SF Mono", Monaco, monospace',
                                                                border: '1px solid var(--border-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-all',
                                                                overflowX: 'auto',
                                                                maxHeight: '300px'
                                                            }}>
                                                                {context.stackTrace.join('\n')}
                                                            </pre>
                                                        </div>
                                                    )}

                                                    {/* Correlation */}
                                                    {(context.correlationId || context.requestId) && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.5px',
                                                                color: 'var(--text-secondary)',
                                                                marginBottom: '8px'
                                                            }}>
                                                                Correlation
                                                            </h4>
                                                            <div className="p-3 rounded-lg space-y-1"
                                                                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                                                {context.correlationId && (
                                                                    <div className="flex items-center gap-2">
                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>ID:</span>
                                                                        <code className="px-2 py-0.5 rounded" style={{
                                                                            fontSize: '11px',
                                                                            background: 'var(--bg-primary)',
                                                                            color: 'var(--text-primary)',
                                                                            fontFamily: 'monospace'
                                                                        }}>
                                                                            {context.correlationId}
                                                                        </code>
                                                                    </div>
                                                                )}
                                                                {context.requestId && (
                                                                    <div className="flex items-center gap-2">
                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Request:</span>
                                                                        <code className="px-2 py-0.5 rounded" style={{
                                                                            fontSize: '11px',
                                                                            background: 'var(--bg-primary)',
                                                                            color: 'var(--text-primary)',
                                                                            fontFamily: 'monospace'
                                                                        }}>
                                                                            {context.requestId}
                                                                        </code>
                                                                    </div>
                                                                )}
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

                        {/* Dashboard View */}
                        {viewMode === 'dashboard' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <h3 className="font-semibold mb-3" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
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
                                                            <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{comp}</span>
                                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                {count.toLocaleString()} ({percentage}%)
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                                            <div className="h-full rounded-full" style={{ width: `${percentage}%`, background: 'var(--accent)' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>

                                <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                    <h3 className="font-semibold mb-3" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                        Most Frequent Errors
                                    </h3>
                                    <div className="space-y-2">
                                        {processedData.errorGroups.slice(0, 5).map((group, idx) => (
                                            <div key={idx} className="p-2.5 rounded-lg"
                                                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            {getSeverityIcon(group.severity)}
                                                            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{group.component}</span>
                                                        </div>
                                                        <p className="line-clamp-2" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                                            {group.message}
                                                        </p>
                                                    </div>
                                                    <span className="ml-2 font-bold" style={{ fontSize: '12px', color: getSeverityColor(group.severity) }}>
                                                        {group.totalCount}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Raw View */}
                        {viewMode === 'raw' && (
                            <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                                <h3 className="font-semibold mb-2" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                    Raw Analysis Data
                                </h3>
                                <pre className="p-3 rounded-lg" style={{
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