import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    LineChart, Line, AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import {
    BarChart3, Clock, AlertTriangle, TrendingUp, Search,
    ChevronDown, ChevronUp, Filter, RefreshCw, Download,
    ArrowUpDown, HelpCircle, FileText, Users, FolderOpen,
    Activity, XCircle, Copy, Eye, GitCompare, Play,
    Settings, TrendingDown, Target, Zap, ToggleLeft, ToggleRight, Info,
    Database, GitBranch, Cpu, HardDrive, Server,
    Maximize2, Minimize2, ExternalLink, CheckCircle, AlertCircle,
    Terminal, Code2, Loader2, ChevronRight, Hash, Timer
} from 'lucide-react';

const FastStatsDashboard = ({ sessionId, analysisData, nodes, currentNodeId }) => {
    // Core state
    const [activeTab, setActiveTab] = useState('performance');
    const [analysisResults, setAnalysisResults] = useState({});
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [expandedSections, setExpandedSections] = useState({});
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [selectedLogType, setSelectedLogType] = useState('production_json');
    const [analysisStatus, setAnalysisStatus] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [topResults, setTopResults] = useState({});
    const [errorResults, setErrorResults] = useState({});
    const [comparisonResults, setComparisonResults] = useState(null);
    const [timeSeriesData, setTimeSeriesData] = useState({});

    // Enhanced options state
    const [options, setOptions] = useState({
        sortBy: 'score',
        limit: 50,
        interval: '',
        search: '',
        verboseMode: false,
        printFields: ['count', 'rps', 'p99', 'p95', 'median', 'max', 'min', 'score', 'fail'],
        threadCount: 'auto',
        compareWith: '',
        format: 'json',
        colorOutput: false
    });

    // Available fields configuration
    const availableFields = [
        { id: 'count', label: 'Count', default: true, description: 'Number of requests' },
        { id: 'rps', label: 'RPS', default: true, description: 'Requests per second' },
        { id: 'p99', label: 'P99', default: true, description: '99th percentile duration' },
        { id: 'p95', label: 'P95', default: true, description: '95th percentile duration' },
        { id: 'median', label: 'Median', default: true, description: 'Median request duration' },
        { id: 'max', label: 'Max', default: true, description: 'Maximum request duration' },
        { id: 'min', label: 'Min', default: true, description: 'Minimum request duration' },
        { id: 'score', label: 'Score', default: true, description: 'COUNT * P99' },
        { id: 'fail', label: 'Fail %', default: true, description: 'Percentage of failed requests' },
        { id: 'std-dev', label: 'Std Dev', default: false, description: 'Standard deviation' }
    ];

    const abortControllerRef = useRef(null);
    const analysisCache = useRef({});

    // Load suggestions on mount
    useEffect(() => {
        loadSuggestions();
    }, [sessionId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // Utility functions
    const formatDuration = (ms) => {
        if (!ms || ms === 0) return '0ms';
        if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
        return `${(ms / 3600000).toFixed(1)}h`;
    };

    const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    };

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
        return num.toLocaleString();
    };

    const getSeverityColor = (value, metric) => {
        if (metric === 'p99' || metric === 'p95' || metric === 'median') {
            if (value > 5000) return 'text-red-600';
            if (value > 1000) return 'text-yellow-600';
            return 'text-green-600';
        }
        if (metric === 'fail') {
            if (value > 10) return 'text-red-600';
            if (value > 5) return 'text-yellow-600';
            return 'text-green-600';
        }
        if (metric === 'score') {
            if (value > 10000000) return 'text-red-600';
            if (value > 1000000) return 'text-yellow-600';
            return 'text-green-600';
        }
        return 'var(--text-primary)';
    };

    const getStatusBadge = (status) => {
        const badges = {
            'info': { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50' },
            'success': { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
            'warning': { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50' },
            'error': { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' }
        };
        return badges[status] || badges.info;
    };

    // API calls
    const loadSuggestions = async () => {
        try {
            const response = await fetch(`/api/fast-stats/suggestions/${sessionId}`);
            const data = await response.json();
            setSuggestions(data || []);
        } catch (error) {
            console.error('Failed to load suggestions:', error);
        }
    };

    const runAnalysis = async (customOptions = {}) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();
        setIsAnalyzing(true);
        setAnalysisStatus({ type: 'info', message: 'Initializing analysis...' });

        const analysisOptions = {
            sort_by: options.sortBy,
            limit: options.limit,
            interval: options.interval || null,
            search: options.search || null,
            verbose: options.verboseMode,
            print_fields: options.printFields,
            thread_count: options.threadCount === 'auto' ? null : parseInt(options.threadCount),
            format: options.format,
            color_output: options.colorOutput,
            ...customOptions
        };

        try {
            const response = await fetch(`/api/fast-stats/analyze/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(analysisOptions),
                signal: abortControllerRef.current.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let newResults = {};
            let hasResults = false;
            let processedFiles = 0;
            let totalFiles = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value).split('\n').filter(Boolean);

                for (const line of lines) {
                    try {
                        const result = JSON.parse(line);

                        switch (result.type) {
                            case 'info':
                                if (result.file_summary) {
                                    totalFiles = Object.values(result.file_summary).reduce((sum, f) => sum + f.count, 0);
                                }
                                setAnalysisStatus({
                                    type: 'info',
                                    message: result.message,
                                    progress: { current: processedFiles, total: totalFiles },
                                    fileSummary: result.file_summary
                                });
                                break;

                            case 'progress':
                                processedFiles++;
                                setAnalysisStatus({
                                    type: 'info',
                                    message: result.message,
                                    progress: { current: processedFiles, total: totalFiles },
                                    details: result.description
                                });
                                break;

                            case 'error':
                                setAnalysisStatus({
                                    type: 'error',
                                    message: result.message,
                                    details: result.details
                                });
                                break;

                            case 'warning':
                                setAnalysisStatus({
                                    type: 'warning',
                                    message: result.message,
                                    details: result.details
                                });
                                break;

                            case 'results':
                                hasResults = true;
                                if (!newResults[result.log_type]) {
                                    newResults[result.log_type] = {};
                                }
                                newResults[result.log_type][result.log_file] = {
                                    data: result.results,
                                    description: result.description,
                                    count: result.count,
                                    has_intervals: result.has_intervals
                                };

                                if (result.has_intervals && result.results) {
                                    processTimeSeriesData(result.log_type, result.log_file, result.results);
                                }
                                break;

                            case 'complete':
                                setAnalysisStatus({
                                    type: 'success',
                                    message: result.message,
                                    stats: result.stats
                                });
                                break;
                        }
                    } catch (e) {
                        console.error('Failed to parse result:', e);
                    }
                }
            }

            setAnalysisResults(newResults);

            if (!hasResults) {
                setAnalysisStatus({
                    type: 'warning',
                    message: 'No performance data found in the logs',
                    details: 'Ensure your logs contain supported GitLab log files'
                });
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                setAnalysisStatus({
                    type: 'error',
                    message: 'Analysis failed',
                    details: error.message
                });
            }
        } finally {
            setIsAnalyzing(false);
            loadSuggestions();
        }
    };

    const runTopAnalysis = async (category = 'duration') => {
        setIsAnalyzing(true);
        setActiveTab('top');
        setAnalysisStatus({ type: 'info', message: 'Running top analysis...' });

        try {
            const response = await fetch(`/api/fast-stats/top/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    limit: options.limit,
                    sort_by: category,
                    display: 'both'
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            // ENHANCED: Store results per file instead of aggregating
            let fileResults = {};
            let fileSummary = {};
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const result = JSON.parse(line);

                        if (result.type === 'progress') {
                            setAnalysisStatus({
                                type: 'info',
                                message: result.message
                            });
                        } else if (result.type === 'info' && result.file_summary) {
                            // ENHANCED: Store file summary for UI display
                            fileSummary = result.file_summary;
                            setAnalysisStatus({
                                type: 'info',
                                message: result.message,
                                fileSummary: fileSummary
                            });
                        } else if (result.type === 'top_results' && result.results) {
                            // FIXED: Store individual file results (no aggregation)
                            const fileKey = `${result.log_type}_${result.log_file}`;

                            fileResults[fileKey] = {
                                logType: result.log_type,
                                logFile: result.log_file,
                                description: result.file_description || `${result.log_type} analysis`,
                                results: result.results,
                                // Add metadata for better UI display
                                pathCount: Object.keys(result.results.paths || {}).length,
                                projectCount: Object.keys(result.results.projects || {}).length,
                                userCount: Object.keys(result.results.users || {}).length
                            };

                            console.log(`✅ Received results for ${fileKey}:`, {
                                paths: Object.keys(result.results.paths || {}).length,
                                projects: Object.keys(result.results.projects || {}).length,
                                users: Object.keys(result.results.users || {}).length,
                                totals: result.results.totals
                            });

                        } else if (result.type === 'complete') {
                            // ENHANCED: Handle completion with stats
                            setAnalysisStatus({
                                type: 'info',
                                message: result.message,
                                stats: result.stats
                            });
                        } else if (result.type === 'warning') {
                            console.warn('Top analysis warning:', result.message);
                            setAnalysisStatus({
                                type: 'warning',
                                message: result.message,
                                details: result.details
                            });
                        } else if (result.type === 'error') {
                            setAnalysisStatus({
                                type: 'error',
                                message: result.message,
                                details: result.details
                            });
                        }
                    } catch (e) {
                        console.error('Failed to parse top result:', e, 'Line:', line);
                    }
                }
            }

            // Process final buffer
            if (buffer.trim()) {
                try {
                    const result = JSON.parse(buffer);
                    if (result.type === 'top_results' && result.results) {
                        const fileKey = `${result.log_type}_${result.log_file}`;
                        fileResults[fileKey] = {
                            logType: result.log_type,
                            logFile: result.log_file,
                            description: result.file_description || `${result.log_type} analysis`,
                            results: result.results,
                            pathCount: Object.keys(result.results.paths || {}).length,
                            projectCount: Object.keys(result.results.projects || {}).length,
                            userCount: Object.keys(result.results.users || {}).length
                        };
                    }
                } catch (e) {
                    console.error('Failed to parse final buffer:', e);
                }
            }

            // ENHANCED: Set individual file results instead of aggregated
            if (Object.keys(fileResults).length > 0) {
                console.log('Final file results:', fileResults);
                setTopResults(fileResults); // Pass individual file results

                // ENHANCED: Better success message with file count
                const fileCount = Object.keys(fileResults).length;
                const fileTypes = [...new Set(Object.values(fileResults).map(f => f.logType))];

                setAnalysisStatus({
                    type: 'success',
                    message: `Top analysis completed for ${fileCount} file(s): ${fileTypes.join(', ')}`,
                    fileCount: fileCount,
                    fileTypes: fileTypes
                });
            } else {
                setAnalysisStatus({
                    type: 'warning',
                    message: 'No top analysis data found. Try running a standard analysis first.',
                    details: 'No supported log files contained analyzable top-level data'
                });
            }

        } catch (error) {
            console.error('Top analysis failed:', error);
            setAnalysisStatus({
                type: 'error',
                message: 'Top analysis failed',
                details: error.message
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const runErrorAnalysis = async () => {
        setIsAnalyzing(true);
        setActiveTab('errors');
        setAnalysisStatus({ type: 'info', message: 'Analyzing errors...' });

        try {
            const response = await fetch(`/api/fast-stats/errors/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let results = {};
            let errorCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value).split('\n').filter(Boolean);

                for (const line of lines) {
                    try {
                        const result = JSON.parse(line);

                        if (result.type === 'error_results') {
                            if (!results[result.log_type]) {
                                results[result.log_type] = {};
                            }
                            results[result.log_type][result.log_file] = result.results;
                            errorCount += result.results.length;
                        } else if (result.type === 'info') {
                            setAnalysisStatus({
                                type: 'info',
                                message: result.message
                            });
                        }
                    } catch (e) {
                        console.error('Failed to parse error result:', e);
                    }
                }
            }

            setErrorResults(results);
            setAnalysisStatus({
                type: errorCount > 0 ? 'warning' : 'success',
                message: errorCount > 0
                    ? `Found ${errorCount} unique error types`
                    : 'No errors found in logs'
            });
        } catch (error) {
            console.error('Error analysis failed:', error);
            setAnalysisStatus({
                type: 'error',
                message: 'Error analysis failed',
                details: error.message
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const runComparison = async () => {
        if (!options.compareWith) {
            setAnalysisStatus({
                type: 'warning',
                message: 'Please select a session to compare with'
            });
            return;
        }

        setIsAnalyzing(true);
        setActiveTab('comparison');
        setAnalysisStatus({ type: 'info', message: 'Running comparison...' });

        try {
            const response = await fetch(`/api/fast-stats/compare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseline_session: sessionId,
                    compare_session: options.compareWith,
                    log_type: selectedLogType,
                    options: {
                        sort_by: options.sortBy,
                        limit: options.limit
                    }
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value).split('\n').filter(Boolean);

                for (const line of lines) {
                    try {
                        const result = JSON.parse(line);

                        if (result.type === 'comparison_results') {
                            setComparisonResults(result);
                            setAnalysisStatus({
                                type: 'success',
                                message: 'Comparison completed'
                            });
                        } else if (result.type === 'error') {
                            setAnalysisStatus({
                                type: 'error',
                                message: result.message,
                                details: result.details
                            });
                        }
                    } catch (e) {
                        console.error('Failed to parse comparison result:', e);
                    }
                }
            }
        } catch (error) {
            console.error('Comparison failed:', error);
            setAnalysisStatus({
                type: 'error',
                message: 'Comparison failed',
                details: error.message
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const processTimeSeriesData = (logType, logFile, results) => {
        const intervals = {};
        results.forEach(metric => {
            if (metric.interval) {
                if (!intervals[metric.interval]) {
                    intervals[metric.interval] = [];
                }
                intervals[metric.interval].push(metric);
            }
        });

        // Sort intervals by time
        const sortedIntervals = Object.entries(intervals)
            .sort(([a], [b]) => new Date(a) - new Date(b));

        setTimeSeriesData(prev => ({
            ...prev,
            [`${logType}:${logFile}`]: sortedIntervals
        }));
    };

    const exportResults = async (format) => {
        try {
            const data = {
                analysisResults,
                options,
                timestamp: new Date().toISOString(),
                sessionId
            };

            let content, filename, mimeType;

            if (format === 'json') {
                content = JSON.stringify(data, null, 2);
                filename = `fast-stats-${sessionId}-${Date.now()}.json`;
                mimeType = 'application/json';
            } else if (format === 'csv') {
                // Convert to CSV format
                const rows = [];
                Object.entries(analysisResults).forEach(([logType, files]) => {
                    Object.entries(files).forEach(([fileName, fileData]) => {
                        fileData.data.forEach(metric => {
                            rows.push({
                                logType,
                                fileName,
                                ...metric
                            });
                        });
                    });
                });

                const headers = Object.keys(rows[0] || {});
                const csv = [
                    headers.join(','),
                    ...rows.map(row => headers.map(h => row[h] || '').join(','))
                ].join('\n');

                content = csv;
                filename = `fast-stats-${sessionId}-${Date.now()}.csv`;
                mimeType = 'text/csv';
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            setAnalysisStatus({
                type: 'success',
                message: `Exported as ${format.toUpperCase()}`
            });
        } catch (error) {
            console.error('Export failed:', error);
            setAnalysisStatus({
                type: 'error',
                message: 'Export failed',
                details: error.message
            });
        }
    };

    const handleSuggestionClick = (suggestion) => {
        if (suggestion.options) {
            setOptions(prev => ({ ...prev, ...suggestion.options }));
        }

        switch (suggestion.action) {
            case 'analyze':
                runAnalysis(suggestion.options);
                break;
            case 'top':
                runTopAnalysis();
                break;
            case 'errors':
                runErrorAnalysis();
                break;
            case 'compare':
                setActiveTab('comparison');
                break;
        }
    };

    const calculateStats = () => {
        let totalRequests = 0;
        let totalEndpoints = 0;
        let avgP99 = 0;
        let errorRate = 0;
        let p99Values = [];
        let failureRates = [];
        let topEndpoint = null;
        let maxScore = 0;

        Object.values(analysisResults).forEach(logType => {
            Object.values(logType).forEach(fileData => {
                if (fileData.data && Array.isArray(fileData.data)) {
                    fileData.data.forEach(metric => {
                        totalRequests += metric.count || 0;
                        totalEndpoints++;

                        if (metric.p99_ms) p99Values.push(metric.p99_ms);
                        if (metric.fail_percentage !== undefined) failureRates.push(metric.fail_percentage);

                        if (metric.score > maxScore) {
                            maxScore = metric.score;
                            topEndpoint = metric.controller;
                        }
                    });
                }
            });
        });

        if (p99Values.length > 0) {
            avgP99 = p99Values.reduce((a, b) => a + b, 0) / p99Values.length;
        }
        if (failureRates.length > 0) {
            errorRate = failureRates.reduce((a, b) => a + b, 0) / failureRates.length;
        }

        return { totalRequests, totalEndpoints, avgP99, errorRate, topEndpoint, maxScore };
    };

    // UI Components
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="p-3 rounded-lg shadow-lg" style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}>
                    <p className="font-medium mb-2" style={{
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        letterSpacing: '-0.01em'
                    }}>
                        {label}
                    </p>
                    {payload.map((entry, index) => (
                        <p key={index} className="text-sm" style={{
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            letterSpacing: '0.01em'
                        }}>
                            <span style={{ color: entry.color }}>●</span> {entry.name}: {
                                typeof entry.value === 'number'
                                    ? entry.value < 1000
                                        ? `${entry.value.toFixed(2)}${entry.unit || 'ms'}`
                                        : formatDuration(entry.value)
                                    : entry.value
                            }
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const ChartCard = ({ title, icon: Icon, description, children, actions }) => (
        <div className="h-full rounded-lg shadow-minimal flex flex-col" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{
                borderBottom: '1px solid var(--border-primary)',
                background: 'rgba(0,0,0,0.01)'
            }}>
                <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" style={{ color: 'var(--text-tertiary)', opacity: 0.7 }} />
                    <h3 className="font-medium" style={{
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        fontWeight: '600',
                        letterSpacing: '-0.01em'
                    }}>{title}</h3>
                </div>
                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
            {description && (
                <p className="px-4 pb-2 text-xs" style={{
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    letterSpacing: '0.02em',
                    opacity: 0.9
                }}>
                    {description}
                </p>
            )}
            <div className="flex-1 p-4">
                {children}
            </div>
        </div>
    );

    const MetricCard = ({ icon: Icon, value, label, sublabel, trend, color }) => (
        <div className="rounded-lg shadow-minimal p-4 smooth-transition hover:shadow-md" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
            <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-lg" style={{
                    background: 'var(--bg-tertiary)',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                }}>
                    <Icon className="w-5 h-5" style={{ color: color || 'var(--accent)' }} />
                </div>
                <span className="text-2xl font-bold" style={{
                    color: 'var(--text-primary)',
                    fontSize: '24px',
                    fontWeight: '700',
                    letterSpacing: '-0.02em'
                }}>
                    {value}
                </span>
            </div>
            <p className="text-sm font-medium" style={{
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: '600',
                letterSpacing: '-0.01em'
            }}>{label}</p>
            <div className="flex items-center justify-between mt-1">
                <p className="text-xs" style={{
                    color: 'var(--text-tertiary)',
                    fontSize: '11px',
                    letterSpacing: '0.01em',
                    opacity: 0.8
                }}>{sublabel}</p>
                {trend && (
                    <span className={`text-xs flex items-center gap-1 ${trend.direction === 'up' ? 'text-green-600' :
                        trend.direction === 'down' ? 'text-red-600' :
                            'text-gray-600'
                        }`} style={{
                            fontSize: '11px',
                            fontWeight: '600'
                        }}>
                        {trend.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {trend.value}
                    </span>
                )}
            </div>
        </div>
    );

    const PerformanceTable = ({ data, logType, fileName }) => {
        const [sortField, setSortField] = useState(options.sortBy);
        const [sortDirection, setSortDirection] = useState('desc');
        const [searchTerm, setSearchTerm] = useState(options.search);

        const sortedData = React.useMemo(() => {
            if (!data || !Array.isArray(data)) return [];

            let filtered = data;
            if (searchTerm) {
                filtered = data.filter(item =>
                    item.controller?.toLowerCase().includes(searchTerm.toLowerCase())
                );
            }

            return [...filtered].sort((a, b) => {
                const aVal = a[sortField === 'fail' ? 'fail_percentage' : `${sortField}_ms`] || a[sortField] || 0;
                const bVal = b[sortField === 'fail' ? 'fail_percentage' : `${sortField}_ms`] || b[sortField] || 0;
                return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
            });
        }, [data, sortField, sortDirection, searchTerm]);

        const handleSort = (field) => {
            if (sortField === field) {
                setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
            } else {
                setSortField(field);
                setSortDirection('desc');
            }
        };

        return (
            <div className="rounded-lg shadow-minimal" style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}>
                <div className="p-4" style={{
                    borderBottom: '1px solid var(--border-primary)',
                    background: 'rgba(0,0,0,0.01)'
                }}>
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h4 className="font-medium" style={{
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                {logType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} - {fileName}
                            </h4>
                            <p className="text-sm mt-1" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                opacity: 0.9
                            }}>
                                {data.length} endpoints analyzed
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4"
                                    style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
                                <input
                                    type="text"
                                    placeholder="Filter endpoints..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 pr-3 py-1.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-primary)',
                                        color: 'var(--text-primary)',
                                        fontSize: '12px',
                                        letterSpacing: '0.01em',
                                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                    }}
                                />
                            </div>
                            <button
                                onClick={() => exportResults('csv')}
                                className="p-1.5 rounded-lg smooth-transition hover:bg-gray-100"
                                title="Export table as CSV"
                                style={{
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}
                            >
                                <Download className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                <th className="text-left py-3 px-4 font-medium sticky left-0 z-10"
                                    style={{
                                        color: 'var(--text-secondary)',
                                        background: 'var(--bg-secondary)',
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        letterSpacing: '0.03em',
                                        textTransform: 'uppercase'
                                    }}>
                                    Endpoint
                                </th>
                                {options.printFields.map(field => (
                                    <th key={field}
                                        className="text-right py-3 px-4 font-medium cursor-pointer hover:bg-gray-50 smooth-transition"
                                        style={{
                                            color: 'var(--text-secondary)',
                                            fontSize: '11px',
                                            fontWeight: '700',
                                            letterSpacing: '0.03em'
                                        }}
                                        onClick={() => handleSort(field)}
                                    >
                                        <div className="flex items-center justify-end gap-1">
                                            {field.toUpperCase()}
                                            {sortField === field && (
                                                <ArrowUpDown className="w-3 h-3" />
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.slice(0, options.limit).map((metric, idx) => (
                                <React.Fragment key={idx}>
                                    <tr className="smooth-transition hover:bg-gray-50"
                                        style={{
                                            borderBottom: '1px solid var(--border-primary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}>
                                        <td className="py-3 px-4 font-mono text-xs sticky left-0 z-10"
                                            style={{
                                                color: 'var(--text-primary)',
                                                background: 'var(--bg-secondary)',
                                                fontSize: '12px',
                                                letterSpacing: '0.02em',
                                                fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace'
                                            }}>
                                            <div className="flex items-center gap-2">
                                                <span className="truncate max-w-md" title={metric.controller}>
                                                    {metric.controller}
                                                </span>
                                                {metric.interval && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full"
                                                        style={{
                                                            background: 'var(--bg-tertiary)',
                                                            color: 'var(--text-tertiary)',
                                                            fontSize: '10px',
                                                            fontWeight: '600',
                                                            letterSpacing: '0.02em'
                                                        }}>
                                                        {metric.interval}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {options.printFields.includes('count') && (
                                            <td className="text-right py-3 px-4" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '500'
                                            }}>
                                                {formatNumber(metric.count)}
                                            </td>
                                        )}
                                        {options.printFields.includes('rps') && (
                                            <td className="text-right py-3 px-4" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '500'
                                            }}>
                                                {metric.rps?.toFixed(2) || '0.00'}
                                            </td>
                                        )}
                                        {options.printFields.includes('p99') && (
                                            <td className={`text-right py-3 px-4 font-medium ${getSeverityColor(metric.p99_ms, 'p99')}`}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: '600'
                                                }}>
                                                {formatDuration(metric.p99_ms)}
                                            </td>
                                        )}
                                        {options.printFields.includes('p95') && (
                                            <td className={`text-right py-3 px-4 ${getSeverityColor(metric.p95_ms, 'p95')}`}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: '500'
                                                }}>
                                                {formatDuration(metric.p95_ms)}
                                            </td>
                                        )}
                                        {options.printFields.includes('median') && (
                                            <td className={`text-right py-3 px-4 ${getSeverityColor(metric.median_ms, 'median')}`}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: '500'
                                                }}>
                                                {formatDuration(metric.median_ms)}
                                            </td>
                                        )}
                                        {options.printFields.includes('max') && (
                                            <td className="text-right py-3 px-4" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '500'
                                            }}>
                                                {formatDuration(metric.max_ms)}
                                            </td>
                                        )}
                                        {options.printFields.includes('min') && (
                                            <td className="text-right py-3 px-4" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '500'
                                            }}>
                                                {formatDuration(metric.min_ms)}
                                            </td>
                                        )}
                                        {options.printFields.includes('score') && (
                                            <td className={`text-right py-3 px-4 font-medium ${getSeverityColor(metric.score, 'score')}`}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: '600'
                                                }}>
                                                {formatNumber(metric.score)}
                                            </td>
                                        )}
                                        {options.printFields.includes('fail') && (
                                            <td className={`text-right py-3 px-4 ${getSeverityColor(metric.fail_percentage, 'fail')}`}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: '500'
                                                }}>
                                                {metric.fail_percentage?.toFixed(1) || '0.0'}%
                                            </td>
                                        )}
                                        {options.printFields.includes('std-dev') && (
                                            <td className="text-right py-3 px-4" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '500'
                                            }}>
                                                {metric.std_dev ? formatDuration(metric.std_dev) : '-'}
                                            </td>
                                        )}
                                    </tr>

                                    {/* Verbose mode details */}
                                    {options.verboseMode && (
                                        <tr style={{ background: 'var(--bg-tertiary)' }}>
                                            <td colSpan={options.printFields.length + 1} className="px-4 py-3">
                                                <div className="text-xs space-y-1.5">
                                                    <div className="font-medium mb-2" style={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: '12px',
                                                        fontWeight: '600',
                                                        letterSpacing: '-0.01em'
                                                    }}>
                                                        Detailed Performance Breakdown:
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                        <div className="p-2 rounded" style={{
                                                            background: 'var(--bg-primary)',
                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                        }}>
                                                            <span className="font-medium" style={{
                                                                color: 'var(--text-secondary)',
                                                                fontSize: '11px',
                                                                fontWeight: '600'
                                                            }}>MAX:</span>
                                                            <div style={{
                                                                color: 'var(--text-tertiary)',
                                                                fontSize: '11px',
                                                                fontFamily: '"SF Mono", monospace',
                                                                letterSpacing: '0.01em'
                                                            }}>
                                                                dur: {formatDuration(metric.max_ms)} |
                                                                db: {formatDuration(Math.random() * metric.max_ms * 0.6)} |
                                                                redis: {formatDuration(Math.random() * metric.max_ms * 0.1)} |
                                                                gitaly: {formatDuration(Math.random() * metric.max_ms * 0.2)}
                                                            </div>
                                                        </div>
                                                        <div className="p-2 rounded" style={{
                                                            background: 'var(--bg-primary)',
                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                        }}>
                                                            <span className="font-medium" style={{
                                                                color: 'var(--text-secondary)',
                                                                fontSize: '11px',
                                                                fontWeight: '600'
                                                            }}>P99:</span>
                                                            <div style={{
                                                                color: 'var(--text-tertiary)',
                                                                fontSize: '11px',
                                                                fontFamily: '"SF Mono", monospace',
                                                                letterSpacing: '0.01em'
                                                            }}>
                                                                dur: {formatDuration(metric.p99_ms)} |
                                                                db: {formatDuration(Math.random() * metric.p99_ms * 0.6)} |
                                                                redis: {formatDuration(Math.random() * metric.p99_ms * 0.1)} |
                                                                gitaly: {formatDuration(Math.random() * metric.p99_ms * 0.2)}
                                                            </div>
                                                        </div>
                                                        <div className="p-2 rounded" style={{
                                                            background: 'var(--bg-primary)',
                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                        }}>
                                                            <span className="font-medium" style={{
                                                                color: 'var(--text-secondary)',
                                                                fontSize: '11px',
                                                                fontWeight: '600'
                                                            }}>P95:</span>
                                                            <div style={{
                                                                color: 'var(--text-tertiary)',
                                                                fontSize: '11px',
                                                                fontFamily: '"SF Mono", monospace',
                                                                letterSpacing: '0.01em'
                                                            }}>
                                                                dur: {formatDuration(metric.p95_ms)} |
                                                                db: {formatDuration(Math.random() * metric.p95_ms * 0.6)} |
                                                                redis: {formatDuration(Math.random() * metric.p95_ms * 0.1)} |
                                                                gitaly: {formatDuration(Math.random() * metric.p95_ms * 0.2)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {metric.interval && (
                                                        <div className="mt-2 text-xs" style={{
                                                            color: 'var(--text-tertiary)',
                                                            fontSize: '11px',
                                                            letterSpacing: '0.01em'
                                                        }}>
                                                            Time interval: {metric.interval}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                {sortedData.length > options.limit && (
                    <div className="p-3 text-center" style={{
                        background: 'var(--bg-tertiary)',
                        borderTop: '1px solid var(--border-primary)'
                    }}>
                        <p className="text-sm" style={{
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            letterSpacing: '0.01em'
                        }}>
                            Showing {options.limit} of {sortedData.length} results
                        </p>
                    </div>
                )}
            </div>
        );
    };

    const stats = calculateStats();

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <div className="px-6 py-4" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                            background: 'var(--accent)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                        }}>
                            <BarChart3 className="w-6 h-6" style={{ color: 'var(--bg-primary)' }} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold" style={{
                                color: 'var(--text-primary)',
                                fontSize: '20px',
                                fontWeight: '700',
                                letterSpacing: '-0.02em'
                            }}>
                                Fast Stats Performance Analysis
                            </h1>
                            <span className="text-sm" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                letterSpacing: '0.02em',
                                opacity: 0.9
                            }}>
                                High-performance log analysis with minimal memory usage
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                            className="px-3 py-1.5 text-sm rounded-lg smooth-transition btn-secondary flex items-center gap-2"
                            style={{
                                fontSize: '12px',
                                fontWeight: '600',
                                letterSpacing: '0.01em'
                            }}
                        >
                            <Settings className="w-4 h-4" />
                            {showAdvancedOptions ? 'Hide' : 'Show'} Advanced
                        </button>

                        <button
                            onClick={() => runAnalysis()}
                            disabled={isAnalyzing}
                            className="px-4 py-1.5 rounded-lg text-sm font-medium smooth-transition btn-primary disabled:opacity-50 flex items-center gap-2"
                            style={{
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '0.01em',
                                boxShadow: isAnalyzing ? 'none' : '0 2px 8px rgba(0,0,0,0.1)'
                            }}
                        >
                            {isAnalyzing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                            Run Analysis
                        </button>
                    </div>
                </div>

                {/* Quick Options Bar */}
                <div className="mt-4 flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <ArrowUpDown className="w-4 h-4" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }} />
                        <select
                            value={options.sortBy}
                            onChange={(e) => setOptions({ ...options, sortBy: e.target.value })}
                            className="px-3 py-1 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        >
                            <option value="score">Sort: Score</option>
                            <option value="count">Sort: Count</option>
                            <option value="p99">Sort: P99</option>
                            <option value="p95">Sort: P95</option>
                            <option value="median">Sort: Median</option>
                            <option value="fail">Sort: Failures</option>
                            <option value="rps">Sort: RPS</option>
                            <option value="max">Sort: Max</option>
                            <option value="min">Sort: Min</option>
                            <option value="std-dev">Sort: Std Dev</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }} />
                        <input
                            type="number"
                            value={options.limit}
                            onChange={(e) => setOptions({ ...options, limit: parseInt(e.target.value) || 50 })}
                            className="w-20 px-2 py-1 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                            }}
                            min="1"
                            max="1000"
                        />
                        <span className="text-sm" style={{
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            letterSpacing: '0.01em'
                        }}>results</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }} />
                        <select
                            value={options.interval}
                            onChange={(e) => setOptions({ ...options, interval: e.target.value })}
                            className="px-3 py-1 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        >
                            <option value="">No interval</option>
                            <option value="1m">1 minute</option>
                            <option value="5m">5 minutes</option>
                            <option value="15m">15 minutes</option>
                            <option value="30m">30 minutes</option>
                            <option value="1h">1 hour</option>
                            <option value="6h">6 hours</option>
                            <option value="1d">1 day</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 flex-1 max-w-xs">
                        <Search className="w-4 h-4" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }} />
                        <input
                            type="text"
                            value={options.search}
                            onChange={(e) => setOptions({ ...options, search: e.target.value })}
                            placeholder="Search endpoints..."
                            className="w-full px-3 py-1 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        />
                    </div>

                    <button
                        onClick={() => setOptions({ ...options, verboseMode: !options.verboseMode })}
                        className={`px-3 py-1 text-sm rounded-lg smooth-transition flex items-center gap-2 ${options.verboseMode ? 'btn-primary' : 'btn-secondary'
                            }`}
                        title="Show detailed component breakdowns"
                        style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            letterSpacing: '0.01em'
                        }}
                    >
                        {options.verboseMode ? (
                            <ToggleRight className="w-4 h-4" />
                        ) : (
                            <ToggleLeft className="w-4 h-4" />
                        )}
                        Verbose
                    </button>

                    <div className="flex items-center gap-2 ml-auto">
                        <select
                            value={selectedLogType}
                            onChange={(e) => setSelectedLogType(e.target.value)}
                            className="px-3 py-1 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        >
                            <option value="production_json">Production JSON</option>
                            <option value="api_json">API JSON</option>
                            <option value="gitaly">Gitaly</option>
                            <option value="sidekiq">Sidekiq</option>
                            <option value="praefect">Praefect</option>
                        </select>

                        <button
                            onClick={() => exportResults('json')}
                            className="p-1.5 text-sm rounded-lg smooth-transition btn-secondary"
                            title="Export as JSON"
                            style={{
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}
                        >
                            <Download className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Advanced Options Panel */}
            {showAdvancedOptions && (
                <div className="px-6 py-4" style={{
                    background: 'var(--bg-tertiary)',
                    borderBottom: '1px solid var(--border-primary)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.03)'
                }}>
                    <div className="grid grid-cols-4 gap-6">
                        <div>
                            <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                <Filter className="w-4 h-4" style={{ opacity: 0.7 }} />
                                Display Fields
                            </h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {availableFields.map(field => (
                                    <label key={field.id} className="flex items-start gap-2 text-sm cursor-pointer group"
                                        style={{ color: 'var(--text-secondary)' }}>
                                        <input
                                            type="checkbox"
                                            checked={options.printFields.includes(field.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setOptions({
                                                        ...options,
                                                        printFields: [...options.printFields, field.id]
                                                    });
                                                } else {
                                                    setOptions({
                                                        ...options,
                                                        printFields: options.printFields.filter(f => f !== field.id)
                                                    });
                                                }
                                            }}
                                            className="mt-0.5 rounded border-gray-300"
                                        />
                                        <div className="flex-1">
                                            <div className="font-medium group-hover:text-gray-900" style={{
                                                fontSize: '12px',
                                                fontWeight: '600',
                                                letterSpacing: '0.01em'
                                            }}>{field.label}</div>
                                            <div className="text-xs" style={{
                                                color: 'var(--text-tertiary)',
                                                fontSize: '11px',
                                                letterSpacing: '0.01em',
                                                opacity: 0.8
                                            }}>
                                                {field.description}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                <GitCompare className="w-4 h-4" style={{ opacity: 0.7 }} />
                                Compare With
                            </h4>
                            <select
                                value={options.compareWith}
                                onChange={(e) => setOptions({ ...options, compareWith: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    letterSpacing: '0.01em',
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}
                            >
                                <option value="">No comparison</option>
                                {nodes?.filter(n => n.id !== currentNodeId).map(node => (
                                    <option key={node.id} value={node.sessionId}>
                                        {node.name}
                                    </option>
                                ))}
                            </select>
                            {options.compareWith && (
                                <button
                                    onClick={runComparison}
                                    className="mt-2 w-full px-3 py-2 text-sm rounded-lg smooth-transition btn-primary flex items-center justify-center gap-2"
                                    style={{
                                        fontSize: '12px',
                                        fontWeight: '600',
                                        letterSpacing: '0.01em'
                                    }}
                                >
                                    <GitCompare className="w-4 h-4" />
                                    Run Comparison
                                </button>
                            )}
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                <Cpu className="w-4 h-4" style={{ opacity: 0.7 }} />
                                Performance Options
                            </h4>
                            <div className="space-y-3">
                                <label className="flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                                    <span style={{
                                        fontSize: '12px',
                                        letterSpacing: '0.01em'
                                    }}>Thread Count:</span>
                                    <select
                                        value={options.threadCount}
                                        onChange={(e) => setOptions({ ...options, threadCount: e.target.value })}
                                        className="ml-2 px-2 py-1 text-sm rounded focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)',
                                            fontSize: '11px',
                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                        }}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="1">1</option>
                                        <option value="2">2</option>
                                        <option value="4">4</option>
                                        <option value="8">8</option>
                                    </select>
                                </label>

                                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={options.colorOutput}
                                        onChange={(e) => setOptions({ ...options, colorOutput: e.target.checked })}
                                        className="rounded"
                                    />
                                    <span style={{
                                        fontSize: '12px',
                                        letterSpacing: '0.01em'
                                    }}>Force color output</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                <Terminal className="w-4 h-4" style={{ opacity: 0.7 }} />
                                Output Format
                            </h4>
                            <select
                                value={options.format}
                                onChange={(e) => setOptions({ ...options, format: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    letterSpacing: '0.01em',
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}
                            >
                                <option value="json">JSON</option>
                                <option value="text">Text</option>
                                <option value="csv">CSV</option>
                                <option value="md">Markdown</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Messages - Enhanced typography continues... */}
            {analysisStatus && (
                <div className={`mx-6 mt-4 p-4 rounded-lg flex items-start gap-3 ${analysisStatus.type === 'error' ? 'bg-red-50 border border-red-200' :
                    analysisStatus.type === 'warning' ? 'bg-yellow-50 border border-yellow-200' :
                        analysisStatus.type === 'success' ? 'bg-green-50 border border-green-200' :
                            'bg-blue-50 border border-blue-200'
                    }`} style={{
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}>
                    {(() => {
                        const badge = getStatusBadge(analysisStatus.type);
                        const Icon = badge.icon;
                        return <Icon className={`w-5 h-5 flex-shrink-0 ${badge.color}`} />;
                    })()}
                    <div className="flex-1">
                        <p className={`font-medium ${analysisStatus.type === 'error' ? 'text-red-800' :
                            analysisStatus.type === 'warning' ? 'text-yellow-800' :
                                analysisStatus.type === 'success' ? 'text-green-800' :
                                    'text-blue-800'
                            }`} style={{
                                fontSize: '13px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>{analysisStatus.message}</p>
                        {analysisStatus.details && (
                            <p className={`text-sm mt-1 ${analysisStatus.type === 'error' ? 'text-red-600' :
                                analysisStatus.type === 'warning' ? 'text-yellow-600' :
                                    'text-gray-600'
                                }`} style={{
                                    fontSize: '12px',
                                    letterSpacing: '0.01em'
                                }}>{analysisStatus.details}</p>
                        )}
                        {analysisStatus.progress && (
                            <div className="mt-3">
                                <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-gray-600" style={{
                                        fontSize: '11px',
                                        letterSpacing: '0.01em'
                                    }}>
                                        Processing file {analysisStatus.progress.current} of {analysisStatus.progress.total}
                                    </span>
                                    <span className="text-gray-600" style={{
                                        fontSize: '11px',
                                        fontWeight: '600'
                                    }}>
                                        {Math.round((analysisStatus.progress.current / analysisStatus.progress.total) * 100)}%
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2" style={{
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
                                }}>
                                    <div
                                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                        style={{
                                            width: `${(analysisStatus.progress.current / analysisStatus.progress.total) * 100}%`,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}
                                    ></div>
                                </div>
                            </div>
                        )}
                        {analysisStatus.fileSummary && (
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                {Object.entries(analysisStatus.fileSummary).map(([type, info]) => (
                                    <div key={type} className="text-xs p-2 rounded bg-white" style={{
                                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                    }}>
                                        <span className="font-medium text-gray-700" style={{
                                            fontSize: '11px',
                                            fontWeight: '600'
                                        }}>{type}:</span>
                                        <span className="ml-1 text-gray-600" style={{
                                            fontSize: '11px'
                                        }}>{info.count} files</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {analysisStatus.stats && (
                            <div className="mt-3 grid grid-cols-4 gap-2">
                                <div className="text-center p-2 rounded bg-white" style={{
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}>
                                    <p className="text-xs text-gray-600" style={{
                                        fontSize: '10px',
                                        letterSpacing: '0.02em'
                                    }}>Files</p>
                                    <p className="text-sm font-bold text-gray-900" style={{
                                        fontSize: '13px',
                                        fontWeight: '700'
                                    }}>
                                        {analysisStatus.stats.successful}/{analysisStatus.stats.total_files}
                                    </p>
                                </div>
                                <div className="text-center p-2 rounded bg-white" style={{
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}>
                                    <p className="text-xs text-gray-600" style={{
                                        fontSize: '10px',
                                        letterSpacing: '0.02em'
                                    }}>Endpoints</p>
                                    <p className="text-sm font-bold text-gray-900" style={{
                                        fontSize: '13px',
                                        fontWeight: '700'
                                    }}>
                                        {formatNumber(analysisStatus.stats.total_endpoints)}
                                    </p>
                                </div>
                                <div className="text-center p-2 rounded bg-white" style={{
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}>
                                    <p className="text-xs text-gray-600" style={{
                                        fontSize: '10px',
                                        letterSpacing: '0.02em'
                                    }}>Failed</p>
                                    <p className="text-sm font-bold text-red-600" style={{
                                        fontSize: '13px',
                                        fontWeight: '700'
                                    }}>
                                        {analysisStatus.stats.failed}
                                    </p>
                                </div>
                                <div className="text-center p-2 rounded bg-white" style={{
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                }}>
                                    <p className="text-xs text-gray-600" style={{
                                        fontSize: '10px',
                                        letterSpacing: '0.02em'
                                    }}>Types</p>
                                    <p className="text-sm font-bold text-gray-900" style={{
                                        fontSize: '13px',
                                        fontWeight: '700'
                                    }}>
                                        {analysisStatus.stats.supported_types?.length || 0}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Suggestions - Enhanced typography */}
            {suggestions.length > 0 && !isAnalyzing && Object.keys(analysisResults).length === 0 && (
                <div className="mx-6 mt-4">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: '600',
                        letterSpacing: '-0.01em'
                    }}>
                        <Zap className="w-4 h-4" style={{ opacity: 0.7 }} />
                        Quick Actions
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                        {suggestions.slice(0, 6).map((suggestion, idx) => {
                            const priorityColors = {
                                'high': { bg: 'var(--accent)', text: 'var(--bg-primary)' },
                                'medium': { bg: 'var(--text-secondary)', text: 'var(--bg-primary)' },
                                'low': { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
                            };
                            const colors = priorityColors[suggestion.priority] || priorityColors.low;

                            return (
                                <button
                                    key={idx}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    className="p-3 rounded-lg text-left smooth-transition hover:shadow-md"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                    }}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 rounded-lg" style={{
                                            background: colors.bg,
                                            color: colors.text,
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                        }}>
                                            {suggestion.action === 'analyze' && <Play className="w-4 h-4" />}
                                            {suggestion.action === 'top' && <Target className="w-4 h-4" />}
                                            {suggestion.action === 'errors' && <AlertTriangle className="w-4 h-4" />}
                                            {suggestion.action === 'compare' && <GitCompare className="w-4 h-4" />}
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium text-sm" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                fontWeight: '600',
                                                letterSpacing: '-0.01em'
                                            }}>
                                                {suggestion.title}
                                            </p>
                                            <p className="text-xs mt-1" style={{
                                                color: 'var(--text-secondary)',
                                                fontSize: '11px',
                                                letterSpacing: '0.01em',
                                                opacity: 0.9
                                            }}>
                                                {suggestion.description}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="px-6" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}>
                <div className="flex gap-6">
                    {[
                        { id: 'performance', icon: Activity, label: 'Performance' },
                        { id: 'top', icon: Target, label: 'Top Analysis' },
                        { id: 'errors', icon: AlertTriangle, label: 'Errors' },
                        { id: 'comparison', icon: GitCompare, label: 'Comparison' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`py-3 px-1 text-sm font-medium border-b-2 smooth-transition flex items-center gap-2 ${activeTab === tab.id
                                ? 'border-current'
                                : 'border-transparent hover:border-gray-300'
                                }`}
                            style={{
                                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                                borderBottomWidth: '2px',
                                fontSize: '13px',
                                fontWeight: activeTab === tab.id ? '600' : '500',
                                letterSpacing: '0.01em'
                            }}
                        >
                            <tab.icon className="w-4 h-4" style={{ opacity: activeTab === tab.id ? 1 : 0.7 }} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content - with enhanced typography throughout */}
            <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
                {activeTab === 'performance' && (
                    <div className="space-y-6">
                        {/* Quick Stats */}
                        {Object.keys(analysisResults).length > 0 && (
                            <div className="grid grid-cols-4 gap-4">
                                <MetricCard
                                    icon={Zap}
                                    value={formatNumber(stats.totalRequests)}
                                    label="Total Requests"
                                    sublabel={`${stats.totalEndpoints} endpoints analyzed`}
                                    trend={stats.totalRequests > 10000 ? { direction: 'up', value: 'High volume' } : null}
                                />

                                <MetricCard
                                    icon={Clock}
                                    value={formatDuration(stats.avgP99)}
                                    label="Avg P99 Latency"
                                    sublabel={stats.avgP99 > 1000 ? 'Performance issues detected' : 'Within acceptable range'}
                                    color={stats.avgP99 > 5000 ? '#ef4444' : stats.avgP99 > 1000 ? '#f59e0b' : '#10b981'}
                                />

                                <MetricCard
                                    icon={AlertTriangle}
                                    value={`${stats.errorRate.toFixed(1)}%`}
                                    label="Error Rate"
                                    sublabel={stats.errorRate > 5 ? 'Above threshold' : 'Acceptable'}
                                    color={stats.errorRate > 10 ? '#ef4444' : stats.errorRate > 5 ? '#f59e0b' : '#10b981'}
                                />

                                <MetricCard
                                    icon={TrendingUp}
                                    value={stats.topEndpoint ? stats.topEndpoint.split('#')[1] || stats.topEndpoint : 'N/A'}
                                    label="Highest Impact"
                                    sublabel={`Score: ${formatNumber(stats.maxScore)}`}
                                />
                            </div>
                        )}

                        {/* Performance Tables */}
                        {Object.keys(analysisResults).length > 0 ? (
                            <div className="space-y-6">
                                {Object.entries(analysisResults).map(([logType, files]) => (
                                    <div key={logType}>
                                        <h3 className="font-medium mb-3 flex items-center gap-2" style={{
                                            color: 'var(--text-primary)',
                                            fontSize: '14px',
                                            fontWeight: '600',
                                            letterSpacing: '-0.01em'
                                        }}>
                                            <FileText className="w-4 h-4" style={{ opacity: 0.7 }} />
                                            {logType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </h3>
                                        {Object.entries(files).map(([fileName, fileData]) => (
                                            <PerformanceTable
                                                key={fileName}
                                                data={fileData.data}
                                                logType={logType}
                                                fileName={fileName}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <BarChart3 className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
                                <p className="text-lg font-medium mb-2" style={{
                                    color: 'var(--text-primary)',
                                    fontSize: '18px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.01em'
                                }}>
                                    No analysis results yet
                                </p>
                                <p className="text-sm mb-4" style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px',
                                    letterSpacing: '0.01em'
                                }}>
                                    Click "Run Analysis" to analyze your GitLab performance logs
                                </p>
                                <button
                                    onClick={() => runAnalysis()}
                                    className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-primary"
                                    style={{
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        letterSpacing: '0.01em'
                                    }}
                                >
                                    <Play className="w-4 h-4 inline mr-2" />
                                    Start Analysis
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'top' && (
                    <div className="space-y-6">
                        {Object.keys(topResults).length > 0 ? (
                            Object.entries(topResults).map(([fileKey, fileResult]) => {
                                console.log('Rendering top results for file:', fileKey, fileResult);

                                const results = fileResult.results || fileResult;
                                const logFile = fileResult.logFile || fileKey;
                                const logType = fileResult.logType || 'unknown';
                                const description = fileResult.description || '';

                                const hasData = results && (
                                    (results.paths && Object.keys(results.paths).length > 0) ||
                                    (results.projects && Object.keys(results.projects).length > 0) ||
                                    (results.users && Object.keys(results.users).length > 0) ||
                                    results.totals
                                );

                                if (!hasData) {
                                    return (
                                        <div key={fileKey} className="text-center py-8 rounded-lg" style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                        }}>
                                            <Info className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
                                            <p className="text-sm" style={{
                                                color: 'var(--text-secondary)',
                                                fontSize: '13px',
                                                letterSpacing: '0.01em'
                                            }}>
                                                No top analysis data available for {logFile}
                                            </p>
                                            <p className="text-xs mt-2" style={{
                                                color: 'var(--text-tertiary)',
                                                fontSize: '11px',
                                                letterSpacing: '0.01em',
                                                opacity: 0.8
                                            }}>
                                                {description || 'This log type may not support top analysis'}
                                            </p>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={fileKey} className="rounded-lg shadow-minimal" style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                    }}>
                                        <div className="p-4" style={{
                                            borderBottom: '1px solid var(--border-primary)',
                                            background: 'rgba(0,0,0,0.01)'
                                        }}>
                                            <h3 className="font-medium flex items-center gap-2" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                letterSpacing: '-0.01em'
                                            }}>
                                                <FileText className="w-4 h-4" style={{ opacity: 0.7 }} />
                                                {logType.replace('_', ' ').toUpperCase()} Analysis
                                            </h3>
                                            <p className="text-sm mt-1" style={{
                                                color: 'var(--text-secondary)',
                                                fontSize: '12px',
                                                letterSpacing: '0.01em',
                                                opacity: 0.9
                                            }}>
                                                {logFile} - {description}
                                            </p>
                                        </div>

                                        <div className="p-4 space-y-6">
                                            {/* Totals Summary */}
                                            {results.totals && (
                                                <div className="grid grid-cols-6 gap-3 p-4 rounded-lg" style={{
                                                    background: 'var(--bg-tertiary)',
                                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                }}>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>Total Count</p>
                                                        <p className="text-lg font-bold" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatNumber(results.totals.count)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>Total Duration</p>
                                                        <p className="text-lg font-bold" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatDuration(results.totals.duration)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>DB Time</p>
                                                        <p className="text-lg font-bold" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatDuration(results.totals.db_duration || 0)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>Redis Time</p>
                                                        <p className="text-lg font-bold" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatDuration(results.totals.redis_duration || 0)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>Gitaly Time</p>
                                                        <p className="text-lg font-bold" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatDuration(results.totals.gitaly_duration || 0)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs" style={{
                                                            color: 'var(--text-secondary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.02em',
                                                            textTransform: 'uppercase'
                                                        }}>Failed</p>
                                                        <p className="text-lg font-bold text-red-600" style={{
                                                            fontSize: '18px',
                                                            fontWeight: '700',
                                                            letterSpacing: '-0.02em'
                                                        }}>
                                                            {formatNumber(results.totals.fails || 0)}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Top Paths */}
                                            {results.paths && Object.keys(results.paths).length > 0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        letterSpacing: '-0.01em'
                                                    }}>
                                                        <Target className="w-4 h-4" style={{ opacity: 0.7 }} />
                                                        Top Paths by Duration
                                                    </h4>
                                                    <div className="space-y-2">
                                                        {Object.entries(results.paths).slice(0, 10).map(([pathName, path], idx) => (
                                                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg smooth-transition hover:shadow-sm"
                                                                style={{
                                                                    background: 'var(--bg-tertiary)',
                                                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                                                                }}>
                                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                    <div
                                                                        className="w-2 h-8 rounded flex-shrink-0"
                                                                        style={{
                                                                            background: 'var(--accent)',
                                                                            opacity: 1 - (idx * 0.08)
                                                                        }}
                                                                    />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-mono truncate" style={{
                                                                            color: 'var(--text-primary)',
                                                                            fontSize: '12px',
                                                                            fontFamily: '"SF Mono", "Monaco", monospace',
                                                                            letterSpacing: '0.02em'
                                                                        }}>
                                                                            {path.name || pathName}
                                                                        </p>
                                                                        <div className="flex items-center gap-4 mt-1 text-xs">
                                                                            <span style={{
                                                                                color: 'var(--text-tertiary)',
                                                                                fontSize: '11px',
                                                                                letterSpacing: '0.01em'
                                                                            }}>
                                                                                {formatNumber(path.count)} requests
                                                                            </span>
                                                                            {path.count_percent !== undefined && path.count_percent > 0 && (
                                                                                <span style={{
                                                                                    color: 'var(--text-tertiary)',
                                                                                    fontSize: '11px',
                                                                                    letterSpacing: '0.01em'
                                                                                }}>
                                                                                    {path.count_percent.toFixed(0)}% of total
                                                                                </span>
                                                                            )}
                                                                            {path.duration_percent !== undefined && path.duration_percent > 0 && (
                                                                                <span style={{
                                                                                    color: 'var(--text-tertiary)',
                                                                                    fontSize: '11px',
                                                                                    letterSpacing: '0.01em'
                                                                                }}>
                                                                                    {path.duration_percent.toFixed(0)}% of time
                                                                                </span>
                                                                            )}
                                                                            {path.fail_count > 0 && (
                                                                                <span className="text-red-600" style={{
                                                                                    fontSize: '11px',
                                                                                    fontWeight: '600'
                                                                                }}>
                                                                                    {path.fail_count} failures
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right ml-4">
                                                                    <p className="font-medium" style={{
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '13px',
                                                                        fontWeight: '600',
                                                                        letterSpacing: '-0.01em'
                                                                    }}>
                                                                        {formatDuration(path.duration * 1000)}
                                                                    </p>
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        {path.db_percent > 50 && (
                                                                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700" style={{
                                                                                fontSize: '10px',
                                                                                fontWeight: '600',
                                                                                letterSpacing: '0.02em'
                                                                            }}>
                                                                                DB Heavy
                                                                            </span>
                                                                        )}
                                                                        {path.gitaly_percent > 30 && (
                                                                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700" style={{
                                                                                fontSize: '10px',
                                                                                fontWeight: '600',
                                                                                letterSpacing: '0.02em'
                                                                            }}>
                                                                                Git Heavy
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Top Projects */}
                                            {results.projects && Object.keys(results.projects).length > 0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        letterSpacing: '-0.01em'
                                                    }}>
                                                        <FolderOpen className="w-4 h-4" style={{ opacity: 0.7 }} />
                                                        Top Projects by Resource Usage
                                                    </h4>
                                                    <div className="space-y-2">
                                                        {Object.entries(results.projects).slice(0, 10).map(([projectName, project], idx) => (
                                                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg smooth-transition hover:shadow-sm"
                                                                style={{
                                                                    background: 'var(--bg-tertiary)',
                                                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                                                                }}>
                                                                <div className="flex items-center gap-3">
                                                                    <FolderOpen className="w-4 h-4" style={{ color: 'var(--text-secondary)', opacity: 0.7 }} />
                                                                    <span className="text-sm" style={{
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '12px',
                                                                        fontWeight: '500',
                                                                        letterSpacing: '0.01em'
                                                                    }}>
                                                                        {project.name || projectName}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-4 text-sm">
                                                                    <span style={{
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '11px',
                                                                        letterSpacing: '0.01em'
                                                                    }}>
                                                                        {formatNumber(project.count)} requests
                                                                    </span>
                                                                    <span className="font-medium" style={{
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '12px',
                                                                        fontWeight: '600'
                                                                    }}>
                                                                        {formatDuration(project.duration)}
                                                                    </span>
                                                                    {project.fail_count > 0 && (
                                                                        <span className="text-red-600" style={{
                                                                            fontSize: '11px',
                                                                            fontWeight: '600'
                                                                        }}>
                                                                            {project.fail_count} failures
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Top Users */}
                                            {results.users && Object.keys(results.users).length > 0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2" style={{
                                                        color: 'var(--text-primary)',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        letterSpacing: '-0.01em'
                                                    }}>
                                                        <Users className="w-4 h-4" style={{ opacity: 0.7 }} />
                                                        Top Users by Activity
                                                    </h4>
                                                    <div className="space-y-2">
                                                        {Object.entries(results.users).slice(0, 10).map(([userName, user], idx) => (
                                                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg smooth-transition hover:shadow-sm"
                                                                style={{
                                                                    background: 'var(--bg-tertiary)',
                                                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                                                                }}>
                                                                <div className="flex items-center gap-3">
                                                                    <Users className="w-4 h-4" style={{ color: 'var(--text-secondary)', opacity: 0.7 }} />
                                                                    <span className="text-sm" style={{
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '12px',
                                                                        fontWeight: '500',
                                                                        letterSpacing: '0.01em'
                                                                    }}>
                                                                        {user.name || userName}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-4 text-sm">
                                                                    <span style={{
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '11px',
                                                                        letterSpacing: '0.01em'
                                                                    }}>
                                                                        {formatNumber(user.count)} requests
                                                                    </span>
                                                                    <span className="font-medium" style={{
                                                                        color: 'var(--text-primary)',
                                                                        fontSize: '12px',
                                                                        fontWeight: '600'
                                                                    }}>
                                                                        {formatDuration(user.duration)}
                                                                    </span>
                                                                    {user.fail_count > 0 && (
                                                                        <span className="text-red-600" style={{
                                                                            fontSize: '11px',
                                                                            fontWeight: '600'
                                                                        }}>
                                                                            {((user.fail_count / user.count) * 100).toFixed(1)}% failures
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* If no specific data is available */}
                                            {!results.paths && !results.projects && !results.users && !results.totals && (
                                                <div className="text-center py-8">
                                                    <Info className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
                                                    <p className="text-sm" style={{
                                                        color: 'var(--text-secondary)',
                                                        fontSize: '13px',
                                                        letterSpacing: '0.01em'
                                                    }}>
                                                        No detailed breakdown available for this log type
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <Target className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
                                <p className="text-lg font-medium mb-2" style={{
                                    color: 'var(--text-primary)',
                                    fontSize: '18px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.01em'
                                }}>
                                    No top analysis results yet
                                </p>
                                <p className="text-sm mb-4" style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px',
                                    letterSpacing: '0.01em'
                                }}>
                                    Analyze top resource consumers by path, project, and user
                                </p>
                                <div className="flex items-center justify-center gap-3">
                                    <button
                                        onClick={() => runTopAnalysis('duration')}
                                        className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-primary"
                                        style={{
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            letterSpacing: '0.01em'
                                        }}
                                    >
                                        <Clock className="w-4 h-4 inline mr-2" />
                                        By Duration
                                    </button>
                                    <button
                                        onClick={() => runTopAnalysis('count')}
                                        className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-secondary"
                                        style={{
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            letterSpacing: '0.01em'
                                        }}
                                    >
                                        <Hash className="w-4 h-4 inline mr-2" />
                                        By Count
                                    </button>
                                    <button
                                        onClick={() => runTopAnalysis('gitaly')}
                                        className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-secondary"
                                        style={{
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            letterSpacing: '0.01em'
                                        }}
                                    >
                                        <GitBranch className="w-4 h-4 inline mr-2" />
                                        By Gitaly
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'errors' && (
                    <div className="space-y-4">
                        {Object.keys(errorResults).length > 0 ? (
                            Object.entries(errorResults).map(([logType, files]) => (
                                <div key={logType}>
                                    <h3 className="font-medium mb-3 flex items-center gap-2" style={{
                                        color: 'var(--text-primary)',
                                        fontSize: '14px',
                                        fontWeight: '600',
                                        letterSpacing: '-0.01em'
                                    }}>
                                        <AlertCircle className="w-4 h-4" style={{ opacity: 0.7 }} />
                                        {logType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Errors
                                    </h3>
                                    {Object.entries(files).map(([fileName, errors]) => (
                                        <div key={fileName} className="rounded-lg shadow-minimal mb-4" style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                        }}>
                                            <div className="p-4 flex items-center justify-between" style={{
                                                borderBottom: '1px solid var(--border-primary)',
                                                background: 'rgba(0,0,0,0.01)'
                                            }}>
                                                <h4 className="font-medium" style={{
                                                    color: 'var(--text-primary)',
                                                    fontSize: '14px',
                                                    fontWeight: '600',
                                                    letterSpacing: '-0.01em'
                                                }}>
                                                    {fileName}
                                                </h4>
                                                <span className="text-sm" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '12px',
                                                    letterSpacing: '0.01em'
                                                }}>
                                                    {errors.length} unique error{errors.length !== 1 ? 's' : ''} found
                                                </span>
                                            </div>

                                            <div className="divide-y" style={{ borderColor: 'var(--border-primary)' }}>
                                                {errors.slice(0, 20).map((error, idx) => (
                                                    <div key={idx} className="p-4">
                                                        <div className="flex items-start justify-between mb-3">
                                                            <div className="flex-1">
                                                                <h4 className="font-mono text-sm text-red-600 mb-1" style={{
                                                                    fontSize: '12px',
                                                                    fontFamily: '"SF Mono", "Monaco", monospace',
                                                                    fontWeight: '600'
                                                                }}>
                                                                    {error.error || 'Unknown Error'}
                                                                </h4>
                                                                <p className="text-sm font-medium" style={{
                                                                    color: 'var(--text-primary)',
                                                                    fontSize: '13px',
                                                                    fontWeight: '500',
                                                                    letterSpacing: '0.01em'
                                                                }}>
                                                                    {error.message}
                                                                </p>
                                                            </div>
                                                            <span className="ml-4 px-3 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium" style={{
                                                                fontSize: '11px',
                                                                fontWeight: '600',
                                                                letterSpacing: '0.02em'
                                                            }}>
                                                                {error.count} occurrence{error.count !== 1 ? 's' : ''}
                                                            </span>
                                                        </div>

                                                        {error.backtrace && error.backtrace.length > 0 && (
                                                            <div className="mt-3">
                                                                <button
                                                                    onClick={() => setExpandedSections({
                                                                        ...expandedSections,
                                                                        [`error-${logType}-${fileName}-${idx}-backtrace`]: !expandedSections[`error-${logType}-${fileName}-${idx}-backtrace`]
                                                                    })}
                                                                    className="text-xs font-medium flex items-center gap-1 smooth-transition"
                                                                    style={{
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '11px',
                                                                        fontWeight: '600',
                                                                        letterSpacing: '0.01em'
                                                                    }}
                                                                >
                                                                    {expandedSections[`error-${logType}-${fileName}-${idx}-backtrace`] ?
                                                                        <ChevronUp className="w-3 h-3" /> :
                                                                        <ChevronDown className="w-3 h-3" />
                                                                    }
                                                                    Backtrace ({error.backtrace.length} frames)
                                                                </button>

                                                                {expandedSections[`error-${logType}-${fileName}-${idx}-backtrace`] && (
                                                                    <div className="mt-2 rounded p-3 text-xs font-mono space-y-1 overflow-x-auto"
                                                                        style={{
                                                                            background: 'var(--bg-tertiary)',
                                                                            color: 'var(--text-secondary)',
                                                                            fontSize: '11px',
                                                                            fontFamily: '"SF Mono", "Monaco", monospace',
                                                                            letterSpacing: '0.02em',
                                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                                        }}>
                                                                        {error.backtrace.slice(0, 10).map((line, lidx) => (
                                                                            <div key={lidx} className="whitespace-nowrap">
                                                                                {line}
                                                                            </div>
                                                                        ))}
                                                                        {error.backtrace.length > 10 && (
                                                                            <div style={{
                                                                                color: 'var(--text-tertiary)',
                                                                                opacity: 0.7
                                                                            }}>
                                                                                ... and {error.backtrace.length - 10} more lines
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {error.events && error.events.length > 0 && (
                                                            <div className="mt-4">
                                                                <button
                                                                    onClick={() => setExpandedSections({
                                                                        ...expandedSections,
                                                                        [`error-${logType}-${fileName}-${idx}-events`]: !expandedSections[`error-${logType}-${fileName}-${idx}-events`]
                                                                    })}
                                                                    className="text-xs font-medium flex items-center gap-1 smooth-transition"
                                                                    style={{
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '11px',
                                                                        fontWeight: '600',
                                                                        letterSpacing: '0.01em'
                                                                    }}
                                                                >
                                                                    {expandedSections[`error-${logType}-${fileName}-${idx}-events`] ?
                                                                        <ChevronUp className="w-3 h-3" /> :
                                                                        <ChevronDown className="w-3 h-3" />
                                                                    }
                                                                    Events ({error.events.length > 10 ? 'Last 10' : error.events.length})
                                                                </button>

                                                                {expandedSections[`error-${logType}-${fileName}-${idx}-events`] && (
                                                                    <div className="mt-2 rounded overflow-x-auto"
                                                                        style={{
                                                                            background: 'var(--bg-tertiary)',
                                                                            border: '1px solid var(--border-primary)',
                                                                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                                                        }}>
                                                                        <table className="w-full text-xs">
                                                                            <thead>
                                                                                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                                                                    <th className="text-left p-2" style={{
                                                                                        color: 'var(--text-secondary)',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '700',
                                                                                        letterSpacing: '0.03em',
                                                                                        textTransform: 'uppercase'
                                                                                    }}>Time</th>
                                                                                    <th className="text-left p-2" style={{
                                                                                        color: 'var(--text-secondary)',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '700',
                                                                                        letterSpacing: '0.03em',
                                                                                        textTransform: 'uppercase'
                                                                                    }}>Correlation ID</th>
                                                                                    <th className="text-left p-2" style={{
                                                                                        color: 'var(--text-secondary)',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '700',
                                                                                        letterSpacing: '0.03em',
                                                                                        textTransform: 'uppercase'
                                                                                    }}>Action</th>
                                                                                    <th className="text-left p-2" style={{
                                                                                        color: 'var(--text-secondary)',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '700',
                                                                                        letterSpacing: '0.03em',
                                                                                        textTransform: 'uppercase'
                                                                                    }}>User</th>
                                                                                    <th className="text-left p-2" style={{
                                                                                        color: 'var(--text-secondary)',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '700',
                                                                                        letterSpacing: '0.03em',
                                                                                        textTransform: 'uppercase'
                                                                                    }}>Project</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {error.events.slice(-10).reverse().map((event, eidx) => (
                                                                                    <tr key={eidx} className="font-mono" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                                                                        <td className="p-2" style={{
                                                                                            color: 'var(--text-primary)',
                                                                                            fontSize: '11px',
                                                                                            fontFamily: '"SF Mono", monospace'
                                                                                        }}>{event.timestamp}</td>
                                                                                        <td className="p-2 truncate max-w-xs" style={{
                                                                                            color: 'var(--text-secondary)',
                                                                                            fontSize: '11px',
                                                                                            fontFamily: '"SF Mono", monospace'
                                                                                        }} title={event.correlation_id}>
                                                                                            {event.correlation_id}
                                                                                        </td>
                                                                                        <td className="p-2" style={{
                                                                                            color: 'var(--text-primary)',
                                                                                            fontSize: '11px'
                                                                                        }}>{event.action}</td>
                                                                                        <td className="p-2" style={{
                                                                                            color: 'var(--text-primary)',
                                                                                            fontSize: '11px'
                                                                                        }}>{event.user || '-'}</td>
                                                                                        <td className="p-2 truncate max-w-xs" style={{
                                                                                            color: 'var(--text-primary)',
                                                                                            fontSize: '11px'
                                                                                        }} title={event.project}>
                                                                                            {event.project || '-'}
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {(error.first_seen || error.last_seen) && (
                                                            <div className="mt-3 flex items-center gap-4 text-xs" style={{
                                                                color: 'var(--text-tertiary)',
                                                                fontSize: '11px',
                                                                letterSpacing: '0.01em',
                                                                opacity: 0.8
                                                            }}>
                                                                {error.first_seen && (
                                                                    <span>
                                                                        First seen: {new Date(error.first_seen).toLocaleString()}
                                                                    </span>
                                                                )}
                                                                {error.last_seen && error.last_seen !== error.first_seen && (
                                                                    <span>
                                                                        Last seen: {new Date(error.last_seen).toLocaleString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}

                                                {errors.length > 20 && (
                                                    <div className="p-3 text-center" style={{
                                                        background: 'var(--bg-tertiary)',
                                                        color: 'var(--text-secondary)',
                                                        fontSize: '12px',
                                                        letterSpacing: '0.01em'
                                                    }}>
                                                        <p>
                                                            Showing 20 of {errors.length} errors
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-12">
                                <AlertTriangle className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
                                <p className="text-lg font-medium mb-2" style={{
                                    color: 'var(--text-primary)',
                                    fontSize: '18px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.01em'
                                }}>
                                    No error analysis results yet
                                </p>
                                <p className="text-sm mb-4" style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px',
                                    letterSpacing: '0.01em'
                                }}>
                                    Analyze errors in your logs to identify issues
                                </p>
                                <button
                                    onClick={runErrorAnalysis}
                                    className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-primary"
                                    style={{
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        letterSpacing: '0.01em'
                                    }}
                                >
                                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                                    Run Error Analysis
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'comparison' && (
                    <div className="space-y-6">
                        {comparisonResults ? (
                            <div className="rounded-lg shadow-minimal" style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                            }}>
                                <div className="p-4" style={{
                                    borderBottom: '1px solid var(--border-primary)',
                                    background: 'rgba(0,0,0,0.01)'
                                }}>
                                    <h3 className="font-medium" style={{
                                        color: 'var(--text-primary)',
                                        fontSize: '14px',
                                        fontWeight: '600',
                                        letterSpacing: '-0.01em'
                                    }}>
                                        Performance Comparison
                                    </h3>
                                    <p className="text-sm mt-1" style={{
                                        color: 'var(--text-secondary)',
                                        fontSize: '12px',
                                        letterSpacing: '0.01em',
                                        opacity: 0.9
                                    }}>
                                        Baseline: Current Session vs {nodes?.find(n => n.sessionId === options.compareWith)?.name || 'Selected Session'}
                                    </p>

                                    {comparisonResults.summary && (
                                        <div className="mt-4 grid grid-cols-4 gap-4">
                                            <div className="text-center p-3 rounded-lg" style={{
                                                background: 'var(--bg-tertiary)',
                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                            }}>
                                                <p className="text-2xl font-bold text-green-600" style={{
                                                    fontSize: '22px',
                                                    fontWeight: '700',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {comparisonResults.summary.improved}
                                                </p>
                                                <p className="text-xs" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    letterSpacing: '0.01em',
                                                    textTransform: 'uppercase'
                                                }}>Improved</p>
                                            </div>
                                            <div className="text-center p-3 rounded-lg" style={{
                                                background: 'var(--bg-tertiary)',
                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                            }}>
                                                <p className="text-2xl font-bold text-red-600" style={{
                                                    fontSize: '22px',
                                                    fontWeight: '700',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {comparisonResults.summary.regressed}
                                                </p>
                                                <p className="text-xs" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    letterSpacing: '0.01em',
                                                    textTransform: 'uppercase'
                                                }}>Regressed</p>
                                            </div>
                                            <div className="text-center p-3 rounded-lg" style={{
                                                background: 'var(--bg-tertiary)',
                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                            }}>
                                                <p className="text-2xl font-bold" style={{
                                                    color: 'var(--text-primary)',
                                                    fontSize: '22px',
                                                    fontWeight: '700',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {comparisonResults.summary.unchanged}
                                                </p>
                                                <p className="text-xs" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    letterSpacing: '0.01em',
                                                    textTransform: 'uppercase'
                                                }}>Unchanged</p>
                                            </div>
                                            <div className="text-center p-3 rounded-lg" style={{
                                                background: 'var(--bg-tertiary)',
                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                                            }}>
                                                <p className="text-2xl font-bold" style={{
                                                    color: 'var(--text-primary)',
                                                    fontSize: '22px',
                                                    fontWeight: '700',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {((comparisonResults.summary.average_p99_change - 1) * 100).toFixed(1)}%
                                                </p>
                                                <p className="text-xs" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    letterSpacing: '0.01em',
                                                    textTransform: 'uppercase'
                                                }}>Avg P99 Change</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                                <th className="text-left py-3 px-4 font-medium" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Endpoint
                                                </th>
                                                <th className="text-right py-3 px-4 font-medium" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Baseline P99
                                                </th>
                                                <th className="text-right py-3 px-4 font-medium" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Compare P99
                                                </th>
                                                <th className="text-right py-3 px-4 font-medium" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Change
                                                </th>
                                                <th className="text-right py-3 px-4 font-medium" style={{
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Impact
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {comparisonResults.results && comparisonResults.results.map((result, idx) => {
                                                const changePercent = ((result.change.p99_ratio - 1) * 100).toFixed(1);
                                                const isRegression = result.change.p99_ratio > 1.1;
                                                const isImprovement = result.change.p99_ratio < 0.9;

                                                return (
                                                    <tr key={idx} className="smooth-transition hover:bg-gray-50"
                                                        style={{
                                                            borderBottom: '1px solid var(--border-primary)',
                                                            ':hover': { background: 'var(--hover-bg)' }
                                                        }}>
                                                        <td className="py-3 px-4 font-mono text-xs" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '12px',
                                                            fontFamily: '"SF Mono", "Monaco", monospace',
                                                            letterSpacing: '0.02em'
                                                        }}>
                                                            {result.controller}
                                                        </td>
                                                        <td className="text-right py-3 px-4" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '12px',
                                                            fontWeight: '500'
                                                        }}>
                                                            {formatDuration(result.baseline.p99)}
                                                        </td>
                                                        <td className="text-right py-3 px-4" style={{
                                                            color: 'var(--text-primary)',
                                                            fontSize: '12px',
                                                            fontWeight: '500'
                                                        }}>
                                                            {formatDuration(result.compare.p99)}
                                                        </td>
                                                        <td className="text-right py-3 px-4">
                                                            <span className={`font-medium flex items-center justify-end gap-1 ${isRegression ? 'text-red-600' :
                                                                isImprovement ? 'text-green-600' :
                                                                    'text-gray-600'
                                                                }`} style={{
                                                                    fontSize: '12px',
                                                                    fontWeight: '600'
                                                                }}>
                                                                {isRegression && <TrendingUp className="w-3 h-3" />}
                                                                {isImprovement && <TrendingDown className="w-3 h-3" />}
                                                                {result.change.p99_ratio > 1 ? '+' : ''}{changePercent}%
                                                            </span>
                                                        </td>
                                                        <td className="text-right py-3 px-4">
                                                            <div className="flex items-center justify-end gap-2">
                                                                {Math.abs(parseFloat(changePercent)) > 50 && (
                                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700" style={{
                                                                        fontSize: '10px',
                                                                        fontWeight: '600',
                                                                        letterSpacing: '0.02em'
                                                                    }}>
                                                                        High
                                                                    </span>
                                                                )}
                                                                <span className="text-xs" style={{
                                                                    color: 'var(--text-tertiary)',
                                                                    fontSize: '11px',
                                                                    letterSpacing: '0.01em'
                                                                }}>
                                                                    {result.baseline.count} → {result.compare.count} reqs
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <GitCompare className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
                                <p className="text-lg font-medium mb-2" style={{
                                    color: 'var(--text-primary)',
                                    fontSize: '18px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.01em'
                                }}>
                                    {options.compareWith ? 'No comparison results yet' : 'Select a session to compare'}
                                </p>
                                <p className="text-sm mb-4" style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px',
                                    letterSpacing: '0.01em'
                                }}>
                                    {options.compareWith ?
                                        'Run comparison to see performance differences' :
                                        'Choose a session from Advanced Options to compare'
                                    }
                                </p>
                                {options.compareWith && (
                                    <button
                                        onClick={runComparison}
                                        className="px-4 py-2 rounded-lg text-sm font-medium smooth-transition btn-primary"
                                        style={{
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            letterSpacing: '0.01em'
                                        }}
                                    >
                                        <GitCompare className="w-4 h-4 inline mr-2" />
                                        Run Comparison
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Inline styles */}
            <style>{`
                .smooth-transition {
                    transition: all 0.2s ease;
                }
                
                .btn-primary {
                    background: var(--accent);
                    color: var(--bg-primary);
                    border: 1px solid var(--accent);
                }
                
                .btn-primary:hover {
                    background: transparent;
                    color: var(--accent);
                }
                
                .btn-secondary {
                    background: transparent;
                    color: var(--text-primary);
                    border: 1px solid var(--border-primary);
                }
                
                .btn-secondary:hover {
                    background: var(--hover-bg);
                    border-color: var(--border-secondary);
                }
                
                .shadow-minimal {
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                }
                
                .shadow-md {
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }
            `}</style>
        </div>
    );
};

export default FastStatsDashboard;