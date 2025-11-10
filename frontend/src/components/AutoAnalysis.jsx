import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Play, RefreshCw, AlertCircle,
    ChevronRight, ChevronDown, Download,
    Zap, Package, AlertTriangle, XCircle,
    Info, BarChart3, Search,
    FileText, Copy, CheckCircle,
    Link2, Terminal, Code2, Clock, Hash,
    Sparkles, Bot, Loader2
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
            
            if (data.type === 'ping') return; // Ignore pings
            
            // Update state with real-time data
            setAnalysisState(data);
            setIsRunning(data.status === 'processing');
            
            console.log('Real-time update:', data.progress, data.message);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket closed, reconnecting...');
            wsRef.current = null;
            
            // Reconnect after 2 seconds
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

        // Load current state immediately
        const loadState = async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}`);
                const data = await response.json();
                
                setAnalysisState(data);
                setIsRunning(data.status === 'processing');
                
                // Connect WebSocket for updates
                connectWebSocket();
            } catch (error) {
                console.error('Error loading state:', error);
            }
        };

        // Check both auto-analysis and Duo status on mount
        loadState();
        
        // Check for existing Duo analysis
        fetch(`/api/auto-analysis/${sessionId}/duo-status`)
            .then(res => res.json())
            .then(data => {
                if (data.status !== 'not_started' && data.status !== 'not_available') {
                    setDuoAnalysis(data);
                }
            })
            .catch(console.error);

        // Cleanup
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
            
            const response = await fetch(`/api/auto-analysis/${sessionId}`, { 
                method: 'POST' 
            });
            const data = await response.json();
            
            setAnalysisState(data);
            
            // WebSocket will handle real-time updates
            connectWebSocket();
            
        } catch (error) {
            console.error('Error starting analysis:', error);
            setIsRunning(false);
        }
    };

    const clearAnalysis = async () => {
        try {
            // Close WebSocket connection
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
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

    const clearDuoAnalysisEnhanced = async () => {
        try {
            await fetch(`/api/auto-analysis/${sessionId}/duo-clear-enhanced`, {
                method: 'DELETE'
            });
            setDuoAnalysis(null);
            setIsDuoAnalyzing(false);
            
            // Clear any polling intervals
            if (duoPollIntervalRef.current) {
                clearInterval(duoPollIntervalRef.current);
                duoPollIntervalRef.current = null;
            }
        } catch (error) {
            console.error('Failed to clear Duo analysis:', error);
        }
    };

    const startDuoAnalysisEnhanced = async () => {
        try {
            setIsDuoAnalyzing(true);
            setActiveTab('ai'); // Switch to AI tab
            
            // Clear any existing failed analysis
            if (duoAnalysis?.status === 'failed' || duoAnalysis?.status === 'partial') {
                await clearDuoAnalysisEnhanced();
            }
            
            // Start chunked analysis
            const response = await fetch(`/api/auto-analysis/${sessionId}/duo-feed-chunked`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(await response.text());
            }
            
            // Set up WebSocket for real-time updates
            const ws = new WebSocket(`ws://localhost:8000/ws/duo-analysis/${sessionId}`);
            
            ws.onopen = () => {
                console.log('Connected to Duo analysis WebSocket');
            };
            
            ws.onmessage = (event) => {
                const status = JSON.parse(event.data);
                console.log('Duo status update:', status);
                
                // Update state with real-time progress
                setDuoAnalysis(status);
                
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
                    setIsDuoAnalyzing(false);
                    ws.close();
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsDuoAnalyzing(false);
            };
            
            ws.onclose = () => {
                console.log('Duo WebSocket closed');
                // Fallback to polling if WebSocket fails
                if (isDuoAnalyzing) {
                    startPolling();
                }
            };
            
        } catch (error) {
            console.error('Duo analysis failed:', error);
            setIsDuoAnalyzing(false);
            alert(`Failed to start Duo analysis: ${error.message}`);
        }
    };

    const startPolling = () => {
        // Fallback polling mechanism
        const pollInterval = setInterval(async () => {
            try {
                const statusResp = await fetch(`/api/auto-analysis/${sessionId}/duo-status-enhanced`);
                const status = await statusResp.json();
                
                console.log('Duo poll status:', status);
                setDuoAnalysis(status);
                
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
                    clearInterval(pollInterval);
                    setIsDuoAnalyzing(false);
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 2000); // Poll every 2 seconds
        
        // Store interval for cleanup
        duoPollIntervalRef.current = pollInterval;
    };

    const startRESTPolling = () => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-status`);
                const status = await response.json();
                
                console.log('Duo REST poll status:', status);
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

    const clearDuoRESTAnalysis = async () => {
        try {
            const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-clear`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            console.log('Clear result:', result);
            
            // Reset state
            setDuoAnalysis(null);
            setIsDuoAnalyzing(false);
            
            // Clear any polling
            if (duoPollIntervalRef.current) {
                clearInterval(duoPollIntervalRef.current);
                duoPollIntervalRef.current = null;
            }
        } catch (error) {
            console.error('Failed to clear analysis:', error);
        }
    };

    const startDuoRESTAnalysis = async () => {
        try {
            setIsDuoAnalyzing(true);
            setActiveTab('ai'); // Switch to AI tab
            
            // Start REST API analysis
            const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-analyze`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }
            
            // Set up WebSocket for real-time updates
            const ws = new WebSocket(`ws://localhost:8000/ws/duo-rest/${sessionId}`);
            
            ws.onopen = () => {
                console.log('Connected to Duo REST WebSocket');
            };
            
            ws.onmessage = (event) => {
                const status = JSON.parse(event.data);
                console.log('Duo REST status:', status);
                
                // Update state with real-time progress
                setDuoAnalysis(status);
                
                // Stop when complete
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
                    setIsDuoAnalyzing(false);
                    ws.close();
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsDuoAnalyzing(false);
                // Fallback to polling
                startRESTPolling();
            };
            
            ws.onclose = () => {
                console.log('Duo REST WebSocket closed');
                // Fetch final status in case WebSocket closed before last update
                setTimeout(async () => {
                    try {
                        const response = await fetch(`/api/auto-analysis/${sessionId}/duo-rest-status`);
                        const finalStatus = await response.json();
                        console.log('Final status after WS close:', finalStatus);
                        setDuoAnalysis(finalStatus);
                        if (finalStatus.status === 'completed' || finalStatus.status === 'failed') {
                            setIsDuoAnalyzing(false);
                        }
                    } catch (error) {
                        console.error('Error fetching final status:', error);
                    }
                }, 500); // Wait 500ms before fetching
            };
            
        } catch (error) {
            console.error('Failed to start Duo REST analysis:', error);
            setIsDuoAnalyzing(false);
            alert(`Failed to start AI analysis: ${error.message}`);
        }
    };

    // Enhanced AI Analysis UI Component
    const renderAIAnalysisTab = () => (
        <div className="space-y-4">
            {/* Header with Controls */}
            <div className="p-4 rounded-lg" style={{ 
                background: 'var(--bg-secondary)', 
                border: '1px solid var(--border-primary)' 
            }}>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{ 
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)'
                            }}>
                            <Bot className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                                GitLab Duo AI Analysis
                            </h3>
                            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                REST API with intelligent batching
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        {/* Test Connection Button */}
                        <button
                            onClick={async () => {
                                const res = await fetch('/api/duo/test-connection');
                                const data = await res.json();
                                alert(data.connected ? 'Connection successful!' : `Connection failed: ${data.error}`);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                            style={{ 
                                background: 'var(--bg-primary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                            <Link2 className="w-3 h-3" />
                            Test
                        </button>
                        
                        {/* Clear Button */}
                        {duoAnalysis && duoAnalysis.status !== 'not_started' && (
                            <button
                                onClick={clearDuoRESTAnalysis}
                                disabled={isDuoAnalyzing}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                style={{ 
                                    background: '#ef4444',
                                    color: 'white',
                                    opacity: isDuoAnalyzing ? 0.5 : 1
                                }}>
                                <XCircle className="w-3 h-3" />
                                Clear
                            </button>
                        )}
                        
                        {/* Start/Retry Button */}
                        <button
                            onClick={startDuoRESTAnalysis}
                            disabled={isDuoAnalyzing || analysisState?.status !== 'completed'}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                            style={{ 
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                opacity: (isDuoAnalyzing || analysisState?.status !== 'completed') ? 0.5 : 1
                            }}>
                            {isDuoAnalyzing ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Analyzing...
                                </>
                            ) : duoAnalysis?.status === 'failed' ? (
                                <>
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Retry Analysis
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Start AI Analysis
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Status Content */}
            {!duoAnalysis || duoAnalysis.status === 'not_started' ? (
                <div className="text-center py-12">
                    <Bot className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                    <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                        Ready for AI Analysis
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Click "Start AI Analysis" to get comprehensive insights from GitLab Duo
                    </p>
                    <div className="mt-6 space-y-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        <p>✓ REST API integration</p>
                        <p>✓ Intelligent batching for large datasets</p>
                        <p>✓ Comprehensive root cause analysis</p>
                    </div>
                </div>
            ) : duoAnalysis.status === 'processing' ? (
                <div className="rounded-xl p-6" style={{ 
                    background: 'var(--bg-secondary)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                }}>
                    <div className="space-y-4">
                        {/* Progress Header - Monochrome */}
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                            }}>
                                <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold mb-1" style={{ 
                                    color: 'var(--text-primary)',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.01em'
                                }}>
                                    Analyzing Error Patterns
                                </h3>
                                <p className="text-sm" style={{ 
                                    color: 'var(--text-secondary)',
                                    fontSize: '12px',
                                    letterSpacing: '0.01em'
                                }}>
                                    {duoAnalysis.current_message || 'Processing...'}
                                </p>
                            </div>
                        </div>
                        
                        {/* Pattern Progress - Monochrome Style */}
                        {duoAnalysis.patterns_total > 0 && (
                            <div className="space-y-3">
                                <div className="flex justify-between text-xs" style={{ 
                                    color: 'var(--text-secondary)',
                                    fontSize: '11px',
                                    fontWeight: '500',
                                    letterSpacing: '0.02em'
                                }}>
                                    <span>Analyzing Patterns</span>
                                    <span className="font-mono" style={{ fontWeight: '600' }}>
                                        {duoAnalysis.patterns_analyzed || 0} / {duoAnalysis.patterns_total}
                                    </span>
                                </div>
                                
                                {/* Progress Bar - Monochrome */}
                                <div className="h-2 rounded-full overflow-hidden" 
                                    style={{ 
                                        background: 'rgba(0,0,0,0.04)',
                                        border: '1px solid rgba(0,0,0,0.06)'
                                    }}>
                                    <div 
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ 
                                            width: `${((duoAnalysis.patterns_analyzed || 0) / duoAnalysis.patterns_total) * 100}%`,
                                            background: 'var(--accent)',
                                            boxShadow: '0 0 8px rgba(0,0,0,0.1)'
                                        }} 
                                    />
                                </div>
                            </div>
                        )}
                        
                        {/* Stats Grid - Monochrome */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="text-center p-3 rounded-lg" style={{ 
                                background: 'var(--bg-primary)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <div className="text-lg font-bold" style={{ 
                                    color: 'var(--text-primary)',
                                    fontSize: '18px',
                                    fontWeight: '700',
                                    letterSpacing: '-0.02em'
                                }}>
                                    {duoAnalysis.unique_patterns || 0}
                                </div>
                                <div className="text-xs" style={{ 
                                    color: 'var(--text-tertiary)',
                                    fontSize: '10px',
                                    fontWeight: '500',
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    marginTop: '4px'
                                }}>
                                    Patterns
                                </div>
                            </div>
                            <div className="text-center p-3 rounded-lg" style={{ 
                                background: 'var(--bg-primary)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <div className="text-lg font-bold" style={{ 
                                    color: '#ef4444',
                                    fontSize: '18px',
                                    fontWeight: '700',
                                    letterSpacing: '-0.02em'
                                }}>
                                    {duoAnalysis.total_errors || 0}
                                </div>
                                <div className="text-xs" style={{ 
                                    color: 'var(--text-tertiary)',
                                    fontSize: '10px',
                                    fontWeight: '500',
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    marginTop: '4px'
                                }}>
                                    Total Errors
                                </div>
                            </div>
                            <div className="text-center p-3 rounded-lg" style={{ 
                                background: 'var(--bg-primary)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <div className="text-lg font-bold" style={{ 
                                    color: 'var(--accent)',
                                    fontSize: '18px',
                                    fontWeight: '700',
                                    letterSpacing: '-0.02em'
                                }}>
                                    {Math.round(((duoAnalysis.patterns_analyzed || 0) / Math.max(duoAnalysis.patterns_total || 1, 1)) * 100)}%
                                </div>
                                <div className="text-xs" style={{ 
                                    color: 'var(--text-tertiary)',
                                    fontSize: '10px',
                                    fontWeight: '500',
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    marginTop: '4px'
                                }}>
                                    Progress
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : duoAnalysis.status === 'completed' ? (
                <AIAnalysisDisplay 
                    duoAnalysis={duoAnalysis}
                    onExport={() => {
                        // Export all analyses as markdown
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
                <div className="rounded-lg p-6 bg-red-50 border border-red-200">
                    <div className="flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-red-600 mt-1" />
                        <div className="flex-1">
                            <h3 className="font-semibold text-red-900 mb-2">Analysis Failed</h3>
                            <p className="text-sm text-red-700">
                                {duoAnalysis.error || 'An error occurred during analysis'}
                            </p>
                            <button
                                onClick={startDuoRESTAnalysis}
                                className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-medium">
                                <RefreshCw className="w-3 h-3 inline mr-1" />
                                Retry Analysis
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );

    // Replace the existing button with this enhanced version
    const renderAIAnalysisButton = () => (
        <button 
            onClick={startDuoRESTAnalysis}
            disabled={isDuoAnalyzing || analysisState?.status !== 'completed'}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            style={{ 
                background: duoAnalysis?.status === 'failed' || duoAnalysis?.status === 'partial'
                    ? '#ef4444' 
                    : 'var(--accent)',
                color: duoAnalysis?.status === 'failed' || duoAnalysis?.status === 'partial'
                    ? 'white'
                    : 'var(--bg-primary)',
                opacity: isDuoAnalyzing ? 0.7 : 1
            }}
        >
            {isDuoAnalyzing ? (
                <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    AI Analyzing...
                </>
            ) : duoAnalysis?.status === 'failed' || duoAnalysis?.status === 'partial' ? (
                <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry AI Analysis
                </>
            ) : (
                <>
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Analysis
                </>
            )}
        </button>
    );

    // Enhanced status display for partial completion
    const renderAnalysisStatus = () => {
        if (duoAnalysis?.status === 'partial') {
            return (
                <div className="rounded-lg p-4" style={{ 
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid #f59e0b'
                }}>
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <h3 className="font-semibold text-yellow-600 mb-2">Partial Analysis Complete</h3>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {duoAnalysis.chunks_succeeded}/{duoAnalysis.chunks_total} chunks processed successfully.
                            </p>
                            {duoAnalysis.analysis && (
                                <div className="mt-3 p-3 rounded" style={{ background: 'var(--bg-primary)' }}>
                                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                        Partial results available below
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={clearDuoAnalysisEnhanced}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                                style={{ 
                                    background: 'var(--bg-primary)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-primary)'
                                }}
                            >
                                Clear
                            </button>
                            <button 
                                onClick={startDuoAnalysisEnhanced}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                style={{ 
                                    background: 'var(--accent)',
                                    color: 'white'
                                }}
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Retry
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        
        // Return existing status displays for other states
        return null;
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
                                {renderAIAnalysisButton()}
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
                            {['errors', 'dashboard', 'raw', 'ai'].map(mode => (
                                <button key={mode} onClick={() => { setActiveTab(mode); setViewMode(mode); }}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium capitalize"
                                    style={{
                                        background: activeTab === mode ? 'var(--accent)' : 'var(--bg-primary)',
                                        color: activeTab === mode ? 'var(--bg-primary)' : 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)'
                                    }}>
                                    {mode === 'errors' && <AlertCircle className="w-3 h-3 inline mr-1" />}
                                    {mode === 'dashboard' && <BarChart3 className="w-3 h-3 inline mr-1" />}
                                    {mode === 'raw' && <Code2 className="w-3 h-3 inline mr-1" />}
                                    {mode === 'ai' && <Bot className="w-3 h-3 inline mr-1" />}
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
                                                            <pre className="p-2 rounded font-mono" style={{
                                                                background: 'var(--bg-primary)',
                                                                fontSize: '11px',
                                                                color: 'var(--text-primary)',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-all',
                                                                maxHeight: isLongOrTechnical ? '80px' : 'none',
                                                                overflow: isLongOrTechnical ? 'hidden' : 'visible',
                                                                border: '1px solid var(--border-primary)'
                                                            }}>
                                                                {msg.length > 300 ? msg.substring(0, 300) + '...' : msg}
                                                            </pre>

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

                        {/* AI Analysis View */}
                        {activeTab === 'ai' && renderAIAnalysisTab()}
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default AutoAnalysis;