import React, { useState, useEffect, useRef } from 'react';
import {
    Play, RefreshCw, AlertCircle,
    ChevronRight, ChevronDown,
    Zap, Package
} from 'lucide-react';

const AutoAnalysis = ({ sessionId }) => {
    const [analysisState, setAnalysisState] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [expandedBacktraces, setExpandedBacktraces] = useState({});
    const pollIntervalRef = useRef(null);
    const lastSessionRef = useRef(null);

    // Define polling function first
    const startPolling = () => {
        // Clear any existing interval
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
        }

        // Poll every 3 seconds
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

    // Check status whenever sessionId changes (tab switches)
    useEffect(() => {
        if (!sessionId) return;

        // Only check if sessionId actually changed
        if (lastSessionRef.current === sessionId) return;
        lastSessionRef.current = sessionId;

        const checkStatus = async () => {
            try {
                console.log(`Checking auto-analysis status for: ${sessionId}`);
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();

                console.log(`Status for ${sessionId}: ${data.status}`);

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
                console.error('Error checking auto-analysis status:', error);
                setAnalysisState(null);
                setIsRunning(false);
            }
        };

        // Clear any existing polling before checking new session
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        checkStatus();
    }, [sessionId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    const startAnalysis = async () => {
        try {
            setIsRunning(true);
            const response = await fetch(`/api/auto-analysis/${sessionId}`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.status === 'already_completed') {
                setAnalysisState(data.results || data);
                setIsRunning(false);
            } else if (data.status === 'already_running') {
                startPolling();
            } else {
                setAnalysisState({
                    status: 'processing',
                    progress: 0,
                    message: 'Starting analysis...'
                });
                startPolling();
            }
        } catch (error) {
            console.error('Error starting auto-analysis:', error);
            setIsRunning(false);
        }
    };

    const clearAnalysis = async () => {
        try {
            await fetch(`/api/auto-analysis/${sessionId}`, {
                method: 'DELETE'
            });
            setAnalysisState(null);
            setExpandedBacktraces({});
            lastSessionRef.current = null; // Reset to force re-check
        } catch (error) {
            console.error('Error clearing auto-analysis:', error);
        }
    };

    const toggleBacktrace = (problemIndex) => {
        setExpandedBacktraces(prev => ({
            ...prev,
            [problemIndex]: !prev[problemIndex]
        }));
    };

    const formatJsonWithBacktrace = (jsonString, problemIndex) => {
        try {
            const parsed = JSON.parse(jsonString || '{}');

            // Check for backtrace in different locations
            const backtrace = parsed['exception.backtrace'] || parsed.exception?.backtrace;
            const hasBacktrace = backtrace && Array.isArray(backtrace);
            const isExpanded = expandedBacktraces[problemIndex];

            // Create display object
            const displayObj = { ...parsed };

            // Handle backtrace - collapse by default
            if (hasBacktrace && !isExpanded) {
                if (parsed['exception.backtrace']) {
                    displayObj['exception.backtrace'] = `[${backtrace.length} stack frames]`;
                } else if (parsed.exception?.backtrace) {
                    displayObj.exception = {
                        ...parsed.exception,
                        backtrace: `[${backtrace.length} stack frames]`
                    };
                }
            }

            return {
                formatted: JSON.stringify(displayObj, null, 2),
                hasBacktrace,
                originalBacktrace: backtrace
            };
        } catch (e) {
            return {
                formatted: jsonString || 'No sample available',
                hasBacktrace: false,
                originalBacktrace: null
            };
        }
    };

    if (!sessionId) {
        return (
            <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
                <div className="text-center">
                    <Package className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', letterSpacing: '0.01em' }}>No session selected</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <div className="p-6" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-3" style={{
                            color: 'var(--text-primary)',
                            fontSize: '24px',
                            fontWeight: '700',
                            letterSpacing: '-0.02em'
                        }}>
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                                background: 'var(--accent)',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                            }}>
                                <Zap className="w-6 h-6" style={{ color: 'var(--bg-primary)' }} />
                            </div>
                            Auto-Analysis
                        </h2>
                        <p className="text-sm" style={{
                            color: 'var(--text-secondary)',
                            fontSize: '13px',
                            letterSpacing: '0.02em',
                            opacity: 0.9
                        }}>
                            Automated pattern detection using GitLab Pattern Hunter
                        </p>
                    </div>

                    <div className="flex gap-3">
                        {analysisState && analysisState.status === 'completed' && (
                            <button
                                onClick={clearAnalysis}
                                className="px-4 py-2 rounded-xl text-sm font-semibold smooth-transition btn-secondary"
                                style={{
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    letterSpacing: '0.01em'
                                }}
                            >
                                Clear Results
                            </button>
                        )}

                        <button
                            onClick={startAnalysis}
                            disabled={isRunning}
                            className="px-6 py-2 rounded-xl font-semibold smooth-transition btn-primary disabled:opacity-50 flex items-center gap-2"
                            style={{
                                fontSize: '14px',
                                fontWeight: '600',
                                letterSpacing: '0.01em',
                                boxShadow: isRunning ? 'none' : '0 2px 8px rgba(0,0,0,0.1)'
                            }}
                        >
                            {isRunning ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Start Analysis
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Progress Bar */}
                {isRunning && analysisState && (
                    <div className="mb-4">
                        <div className="flex justify-between text-sm mb-2" style={{
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            letterSpacing: '0.02em'
                        }}>
                            <span>
                                {analysisState.message || 'Analyzing patterns and detecting issues...'}
                            </span>
                            <span style={{ fontWeight: '600' }}>{analysisState.progress || 0}%</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{
                            background: 'var(--bg-tertiary)',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
                        }}>
                            <div
                                className="h-full transition-all duration-300"
                                style={{
                                    width: `${analysisState.progress || 0}%`,
                                    background: 'var(--accent)',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {!analysisState || analysisState.status === 'not_started' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Zap className="w-16 h-16 mx-auto mb-4" style={{
                                color: 'var(--text-tertiary)',
                                opacity: 0.3
                            }} />
                            <h3 className="text-lg font-semibold mb-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '18px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                Ready for Auto-Analysis
                            </h3>
                            <p className="text-sm mb-4" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '13px',
                                letterSpacing: '0.01em'
                            }}>
                                Click "Start Analysis" to run automated pattern detection
                            </p>
                            <div className="text-xs space-y-1" style={{
                                color: 'var(--text-tertiary)',
                                fontSize: '11px',
                                letterSpacing: '0.02em',
                                lineHeight: '1.6'
                            }}>
                                <p>• Detects GitLab-specific error patterns</p>
                                <p>• Clusters similar issues</p>
                                <p>• Identifies critical problems</p>
                                <p>• Runs in background without blocking UI</p>
                            </div>
                        </div>
                    </div>
                ) : analysisState.status === 'processing' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="animate-spin w-12 h-12 border-4 border-current border-t-transparent rounded-full mx-auto mb-4"
                                style={{
                                    color: 'var(--accent)',
                                    borderWidth: '3px'
                                }} />
                            <h3 className="text-lg font-semibold mb-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '18px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                Analysis in Progress
                            </h3>
                            <p className="text-sm mb-2" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '13px',
                                letterSpacing: '0.01em'
                            }}>
                                {analysisState.message || 'Analyzing patterns and detecting issues...'}
                            </p>
                            <p className="text-xs" style={{
                                color: 'var(--text-tertiary)',
                                fontSize: '11px',
                                letterSpacing: '0.02em'
                            }}>
                                This may take a few minutes depending on log size
                            </p>
                        </div>
                    </div>
                ) : analysisState.status === 'failed' ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <AlertCircle className="w-16 h-16 mx-auto mb-4" style={{
                                color: 'var(--text-secondary)',
                                opacity: 0.5
                            }} />
                            <h3 className="text-lg font-semibold mb-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '18px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                Analysis Failed
                            </h3>
                            <p className="text-sm mb-4" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '13px',
                                letterSpacing: '0.01em'
                            }}>
                                {analysisState.message}
                            </p>
                            <button
                                onClick={startAnalysis}
                                className="px-4 py-2 rounded-xl text-sm font-semibold btn-primary"
                                style={{
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    letterSpacing: '0.01em'
                                }}
                            >
                                Retry Analysis
                            </button>
                        </div>
                    </div>
                ) : analysisState.status === 'completed' && analysisState.results ? (
                    <div className="p-6">
                        {analysisState.results.problems && analysisState.results.problems.length > 0 && (
                            <div className="space-y-4">
                                {analysisState.results.problems.map((problem, idx) => {
                                    const jsonData = formatJsonWithBacktrace(problem.sample_line, idx);
                                    const isBacktraceExpanded = expandedBacktraces[idx];

                                    return (
                                        <div
                                            key={idx}
                                            className="rounded-xl"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-primary)',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                            }}
                                        >
                                            {/* Header with file info */}
                                            <div className="px-4 py-3" style={{
                                                borderBottom: '1px solid var(--border-primary)',
                                                background: 'rgba(0,0,0,0.02)'
                                            }}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-xs font-medium px-2 py-1 rounded" style={{
                                                            background: 'var(--bg-tertiary)',
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '11px',
                                                            fontWeight: '700',
                                                            letterSpacing: '0.03em',
                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                                                        }}>
                                                            #{problem.rank}
                                                        </span>
                                                        <span className="font-medium" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '14px',
                                                            fontWeight: '600',
                                                            letterSpacing: '-0.01em'
                                                        }}>
                                                            {problem.sample_file}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm px-3 py-1 rounded-full" style={{
                                                        background: 'var(--bg-tertiary)',
                                                        color: 'var(--text-secondary)',
                                                        fontSize: '12px',
                                                        fontWeight: '600',
                                                        letterSpacing: '0.02em',
                                                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                                                    }}>
                                                        {problem.count} {problem.count === 1 ? 'occurrence' : 'occurrences'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* JSON Content */}
                                            <div className="p-4">
                                                <div className="relative">
                                                    {jsonData.hasBacktrace && (
                                                        <button
                                                            onClick={() => toggleBacktrace(idx)}
                                                            className="absolute top-2 right-2 px-3 py-1 text-xs rounded-lg smooth-transition"
                                                            style={{
                                                                background: 'var(--bg-tertiary)',
                                                                color: 'var(--text-secondary)',
                                                                border: '1px solid var(--border-primary)',
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                letterSpacing: '0.02em',
                                                                zIndex: 10,
                                                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                                            }}
                                                        >
                                                            {isBacktraceExpanded ? (
                                                                <>
                                                                    <ChevronDown className="w-3 h-3 inline mr-1" />
                                                                    Collapse Backtrace
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronRight className="w-3 h-3 inline mr-1" />
                                                                    Expand Backtrace
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                    <pre className="text-sm font-mono whitespace-pre-wrap overflow-x-auto p-4 rounded-lg" style={{
                                                        background: 'var(--bg-primary)',
                                                        border: '1px solid var(--border-primary)',
                                                        color: 'var(--text-primary)',
                                                        fontSize: '12px',
                                                        lineHeight: '1.7',
                                                        letterSpacing: '0.02em',
                                                        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                                                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.03)'
                                                    }}>
                                                        {jsonData.formatted}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default AutoAnalysis;