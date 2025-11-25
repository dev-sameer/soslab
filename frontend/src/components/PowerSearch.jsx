import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import debounce from 'lodash.debounce';
import {
    Zap, Search, Filter, X, ChevronDown, ChevronRight, ChevronLeft,
    Copy, Download, AlertCircle, Info, Clock, Hash,
    FileText, Code, Layers, RefreshCw, Save, Star,
    Sparkles, Bot, TrendingUp, Maximize2, Minimize2,
    BarChart2, Calendar, Eye, EyeOff, Table,
    Package, Plus
} from 'lucide-react';

// Results reducer for batch updates
const resultsReducer = (state, action) => {
    switch (action.type) {
        case 'ADD_BATCH':
            return [...state, ...action.payload];
        case 'RESET':
            return [];
        case 'SET_ALL':
            return action.payload;
        default:
            return state;
    }
};

// Optimized batch settings
const OPTIMIZED_BATCH_SIZE = 200; // Increased from 50
const OPTIMIZED_BATCH_TIMEOUT = 50; // Decreased from 100ms for faster initial render
const MAX_RENDERED_RESULTS = 5000; // Limit DOM nodes for performance
const VIRTUALIZATION_THRESHOLD = 50; // Start virtualizing earlier

// Optimized results reducer with memory management
const optimizedResultsReducer = (state, action) => {
    switch (action.type) {
        case 'ADD_BATCH':
            // Limit total results in memory
            const newResults = [...state, ...action.payload];
            if (newResults.length > MAX_RENDERED_RESULTS) {
                // Keep only the most recent results
                return newResults.slice(-MAX_RENDERED_RESULTS);
            }
            return newResults;
        case 'RESET':
            return [];
        case 'SET_ALL':
            return action.payload.slice(0, MAX_RENDERED_RESULTS);
        default:
            return state;
    }
};

// Cache for parsed JSON content
const parsedContentCache = new WeakMap();

// Visual Query Builder Component
const QueryBuilder = React.memo(({
    onQueryGenerated,
    availableServices,
    commonFields
}) => {
    const [queryParts, setQueryParts] = useState([]);
    const [showBuilder, setShowBuilder] = useState(false);

    const addQueryPart = () => {
        setQueryParts([...queryParts, {
            id: Date.now(),
            field: '',
            operator: '=',
            value: '',
            logicalOp: 'AND'
        }]);
    };

    const updateQueryPart = (id, updates) => {
        setQueryParts(queryParts.map(part =>
            part.id === id ? { ...part, ...updates } : part
        ));
    };

    const removeQueryPart = (id) => {
        setQueryParts(queryParts.filter(part => part.id !== id));
    };

    const generateQuery = () => {
        if (queryParts.length === 0) return;

        let query = '';
        queryParts.forEach((part, index) => {
            if (part.field && part.value) {
                if (index > 0) {
                    query += ` ${part.logicalOp} `;
                }
                query += `${part.field}${part.operator}${part.value}`;
            }
        });

        onQueryGenerated(query);
        setShowBuilder(false);
    };

    // GitLab-specific services based on the log system docs
    const gitlabServices = [
        'rails', 'sidekiq', 'gitaly', 'workhorse', 'shell', 'puma',
        'nginx', 'postgresql', 'redis', 'registry', 'pages', 'prometheus',
        'grafana', 'alertmanager', 'praefect', 'kas', 'mailroom',
        'patroni', 'pgbouncer', 'sentinel', 'mattermost', 'gitlab-exporter'
    ];

    return (
        <div className="mb-2">
            <button
                onClick={() => setShowBuilder(!showBuilder)}
                className="px-3 py-1.5 text-xs rounded smooth-transition btn-secondary flex items-center gap-1.5"
            >
                <Layers className="w-3 h-3" />
                Query Builder
                <ChevronDown className={`w-3 h-3 transform transition-transform ${showBuilder ? 'rotate-180' : ''}`} />
            </button>

            {showBuilder && (
                <div className="mt-2 p-3 rounded" style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)'
                }}>
                    <div className="space-y-2">
                        {queryParts.map((part, index) => (
                            <div key={part.id} className="flex items-center gap-2">
                                {index > 0 && (
                                    <select
                                        value={part.logicalOp}
                                        onChange={(e) => updateQueryPart(part.id, { logicalOp: e.target.value })}
                                        className="px-2 py-1 rounded text-sm"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                    >
                                        <option value="AND">AND</option>
                                        <option value="OR">OR</option>
                                    </select>
                                )}

                                <select
                                    value={part.field}
                                    onChange={(e) => updateQueryPart(part.id, { field: e.target.value })}
                                    className="px-3 py-1 rounded text-sm flex-1"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-primary)',
                                        color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="">Select field...</option>
                                    <optgroup label="Common Fields">
                                        <option value="service">service</option>
                                        <option value="severity">severity</option>
                                        <option value="status">status</option>
                                        <option value="method">method</option>
                                        <option value="path">path</option>
                                        <option value="duration_s">duration_s</option>
                                        <option value="user">user</option>
                                        <option value="correlation_id">correlation_id</option>
                                    </optgroup>
                                    {commonFields && commonFields.length > 0 && (
                                        <optgroup label="Discovered Fields">
                                            {commonFields.slice(0, 10).map(field => (
                                                <option key={field} value={field}>{field}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>

                                <select
                                    value={part.operator}
                                    onChange={(e) => updateQueryPart(part.id, { operator: e.target.value })}
                                    className="px-2 py-1 rounded text-sm"
                                    style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-primary)',
                                        color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="=">equals (=)</option>
                                    <option value="!=">not equals (!=)</option>
                                    <option value={'>'}>greater than (&gt;)</option>
                                    <option value={'>='}>greater or equal (&gt;=)</option>
                                    <option value={'<'}>less than (&lt;)</option>
                                    <option value={'<='}>less or equal (&lt;=)</option>
                                    <option value="~">contains (~)</option>
                                    <option value="!~">not contains (!~)</option>
                                </select>

                                {part.field === 'service' ? (
                                    <select
                                        value={part.value}
                                        onChange={(e) => updateQueryPart(part.id, { value: e.target.value })}
                                        className="px-3 py-1 rounded text-sm flex-1"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                    >
                                        <option value="">Select service...</option>
                                        {gitlabServices.map(service => (
                                            <option key={service} value={service}>{service}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        placeholder="Value..."
                                        value={part.value}
                                        onChange={(e) => updateQueryPart(part.id, { value: e.target.value })}
                                        className="px-3 py-1 rounded text-sm flex-1"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                    />
                                )}

                                <button
                                    onClick={() => removeQueryPart(part.id)}
                                    className="p-1 rounded smooth-transition"
                                    style={{
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-secondary)'
                                    }}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}

                        <div className="flex gap-1.5 pt-1.5">
                            <button
                                onClick={addQueryPart}
                                className="px-2 py-1 text-xs rounded smooth-transition btn-secondary flex items-center gap-1"
                            >
                                <Plus className="w-3 h-3" />
                                Add Condition
                            </button>

                            {queryParts.length > 0 && (
                                <>
                                    <button
                                        onClick={generateQuery}
                                        className="px-3 py-1 text-xs rounded smooth-transition btn-primary flex items-center gap-1"
                                    >
                                        <Zap className="w-3 h-3" />
                                        Generate Query
                                    </button>

                                    <button
                                        onClick={() => setQueryParts([])}
                                        className="px-2 py-1 text-xs rounded smooth-transition"
                                        style={{
                                            background: 'transparent',
                                            color: '#ef4444',
                                            border: '1px solid #ef4444'
                                        }}
                                    >
                                        Clear All
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// Memoized Histogram Component
const LogHistogram = React.memo(({ results, timeField = 'time' }) => {
    const [hoveredBar, setHoveredBar] = useState(null);

    // Process results into time buckets
    const histogramData = useMemo(() => {
        if (!results || results.length === 0) return [];

        // Extract timestamps - try multiple fields
        const timestamps = [];
        const timeFields = [timeField, 'timestamp', 'time', '@timestamp', 'created_at', 'updated_at'];

        results.forEach((r, index) => {
            // Try to get timestamp from parsed fields
            const parsed = r.match_details?.parsed_fields || {};
            let timestamp = null;

            // Try each time field
            for (const field of timeFields) {
                const timeValue = parsed[field];
                if (timeValue) {
                    const time = new Date(timeValue).getTime();
                    if (!isNaN(time)) {
                        timestamp = time;
                        break;
                    }
                }
            }

            // Try to extract from content as fallback
            if (!timestamp && typeof r.content === 'string') {
                // Multiple date formats
                const datePatterns = [
                    /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/,  // ISO format
                    /\d{2}\/\d{2}\/\d{4}[,\s]+\d{2}:\d{2}:\d{2}/,  // DD/MM/YYYY, HH:MM:SS
                    /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,  // Aug 2 05:52:33
                ];

                for (const pattern of datePatterns) {
                    const match = r.content.match(pattern);
                    if (match) {
                        const time = new Date(match[0]).getTime();
                        if (!isNaN(time)) {
                            timestamp = time;
                            break;
                        }
                    }
                }
            }

            if (timestamp) {
                timestamps.push({ time: timestamp, result: r, index });
            }
        });

        if (timestamps.length === 0) return [];

        // Find time range
        const times = timestamps.map(t => t.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const range = maxTime - minTime;

        // If all timestamps are the same (or very close), create a single bucket
        if (range < 1000) { // Less than 1 second
            return [{
                start: minTime,
                end: maxTime + 1,
                count: timestamps.length,
                errors: timestamps.filter(t => {
                    const parsed = t.result.match_details?.parsed_fields || {};
                    const severity = (parsed.severity || parsed.level || '').toLowerCase();
                    return severity.includes('error') || severity.includes('fatal');
                }).length,
                warnings: timestamps.filter(t => {
                    const parsed = t.result.match_details?.parsed_fields || {};
                    const severity = (parsed.severity || parsed.level || '').toLowerCase();
                    return severity.includes('warn');
                }).length
            }];
        }

        // Determine bucket size (aim for ~30 buckets max)
        const bucketCount = Math.min(30, Math.max(5, Math.floor(timestamps.length / 3)));
        const bucketSize = range / bucketCount;

        // Create buckets
        const buckets = new Map();
        for (let i = 0; i < bucketCount; i++) {
            const bucketStart = minTime + (i * bucketSize);
            buckets.set(i, {
                start: bucketStart,
                end: bucketStart + bucketSize,
                count: 0,
                errors: 0,
                warnings: 0
            });
        }

        // Fill buckets
        timestamps.forEach(({ time, result }) => {
            const bucketIndex = Math.floor((time - minTime) / bucketSize);
            const bucket = buckets.get(Math.min(bucketIndex, bucketCount - 1));

            if (bucket) {
                bucket.count++;

                // Count by severity - use same logic as LogEntry component
                const parsed = result.match_details?.parsed_fields || {};

                // Prioritize status codes over severity field
                if (parsed.status) {
                    if (parsed.status >= 500) {
                        bucket.errors++;
                    } else if (parsed.status >= 400) {
                        bucket.warnings++;
                    } else {
                        // Check severity field for non-error status codes
                        const severity = (parsed.severity || parsed.level || '').toLowerCase();
                        if (severity.includes('error') || severity.includes('fatal')) {
                            bucket.errors++;
                        } else if (severity.includes('warn')) {
                            bucket.warnings++;
                        }
                    }
                } else {
                    // No status code, check other indicators
                    if (parsed['exception.class'] || parsed['exception.message']) {
                        bucket.errors++;
                    } else {
                        const severity = (parsed.severity || parsed.level || '').toLowerCase();
                        const content = result.content.toLowerCase();

                        if (severity.includes('error') || severity.includes('fatal') ||
                            content.includes('error') || content.includes('exception')) {
                            bucket.errors++;
                        } else if (severity.includes('warn') || content.includes('warn')) {
                            bucket.warnings++;
                        }
                    }
                }
            }
        });

        return Array.from(buckets.values()).filter(b => b.count > 0);
    }, [results, timeField]);

    const maxCount = Math.max(...histogramData.map(d => d.count), 1);

    if (histogramData.length === 0) {
        return (
            <div className="text-center py-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                <div>No time data available for histogram</div>
                <div className="text-xs mt-1">Logs may not contain parseable timestamps</div>
            </div>
        );
    }

    return (
        <div className="w-full h-32 flex items-end gap-0.5 px-4">
            {histogramData.map((bucket, idx) => {
                const height = (bucket.count / maxCount) * 100;
                const errorPercent = bucket.count > 0 ? (bucket.errors / bucket.count) * 100 : 0;
                const warningPercent = bucket.count > 0 ? (bucket.warnings / bucket.count) * 100 : 0;
                const normalPercent = 100 - errorPercent - warningPercent;

                return (
                    <div
                        key={idx}
                        className="flex-1 flex flex-col justify-end relative cursor-pointer"
                        style={{ minWidth: '3px', maxWidth: '20px', height: '100%' }}
                        onMouseEnter={() => setHoveredBar(idx)}
                        onMouseLeave={() => setHoveredBar(null)}
                    >
                        <div className="relative" style={{ height: `${height}%`, width: '100%' }}>
                            {/* Stacked bars */}
                            <div
                                className="absolute bottom-0 left-0 right-0"
                                style={{
                                    height: `${normalPercent}%`,
                                    background: 'var(--text-tertiary)',
                                    opacity: 0.3
                                }}
                            />
                            <div
                                className="absolute left-0 right-0"
                                style={{
                                    bottom: `${normalPercent}%`,
                                    height: `${warningPercent}%`,
                                    background: '#f59e0b',
                                    opacity: 0.7
                                }}
                            />
                            <div
                                className="absolute left-0 right-0"
                                style={{
                                    bottom: `${normalPercent + warningPercent}%`,
                                    height: `${errorPercent}%`,
                                    background: '#ef4444',
                                    opacity: 0.8
                                }}
                            />
                        </div>

                        {/* Tooltip */}
                        {hoveredBar === idx && (
                            <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 z-10 whitespace-nowrap">
                                <div className="px-3 py-2 rounded-lg shadow-lg text-xs" style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-primary)'
                                }}>
                                    <div style={{ color: 'var(--text-primary)' }}>
                                        {new Date(bucket.start).toLocaleString()}
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)' }}>
                                        Total: {bucket.count}
                                    </div>
                                    {bucket.errors > 0 && (
                                        <div style={{ color: '#ef4444' }}>
                                            Errors: {bucket.errors}
                                        </div>
                                    )}
                                    {bucket.warnings > 0 && (
                                        <div style={{ color: '#f59e0b' }}>
                                            Warnings: {bucket.warnings}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

const ResultsTableView = React.memo(({ results, onCopy }) => {
    const [selectedColumns, setSelectedColumns] = useState([
        'time', 'severity', 'service', 'status', 'message', 'duration_s', 'user'
    ]);
    const [showColumnSelector, setShowColumnSelector] = useState(false);
    const [columnSearch, setColumnSearch] = useState('');

    // Extract all available columns from results
    const availableColumns = useMemo(() => {
        const columns = new Set();
        results.slice(0, 100).forEach(result => {
            const parsed = result.match_details?.parsed_fields || {};
            Object.keys(parsed).forEach(key => columns.add(key));
        });
        return Array.from(columns).sort();
    }, [results]);

    // Filter available columns based on search
    const filteredColumns = useMemo(() => {
        if (!columnSearch) return availableColumns;
        return availableColumns.filter(col =>
            col.toLowerCase().includes(columnSearch.toLowerCase())
        );
    }, [availableColumns, columnSearch]);

    const formatValue = useCallback((value, column) => {
        if (value === null || value === undefined) return '-';

        // Format durations
        if (column.includes('duration') && typeof value === 'number') {
            return `${(value * 1000).toFixed(0)}ms`;
        }

        // Format timestamps
        if (column === 'time' || column === 'timestamp' || column === '@timestamp') {
            return new Date(value).toLocaleString();
        }

        // Format long strings
        if (typeof value === 'string' && value.length > 50) {
            return value.substring(0, 50) + '...';
        }

        return String(value);
    }, []);

    const getSeverityColor = useCallback((severity, status) => {
        // Prioritize status codes
        if (status) {
            if (status >= 500) return '#ef4444';
            if (status >= 400) return '#f59e0b';
        }

        // Then check severity field
        if (!severity) return 'var(--text-tertiary)';
        const sev = severity.toLowerCase();
        if (sev.includes('error') || sev.includes('fatal')) return '#ef4444';
        if (sev.includes('warn')) return '#f59e0b';
        if (sev.includes('info')) return '#3b82f6';
        return 'var(--text-tertiary)';
    }, []);

    const addColumn = useCallback((column) => {
        if (!selectedColumns.includes(column)) {
            setSelectedColumns([...selectedColumns, column]);
        }
        setColumnSearch('');
    }, [selectedColumns]);

    const removeColumn = useCallback((column) => {
        setSelectedColumns(selectedColumns.filter(c => c !== column));
    }, [selectedColumns]);

    return (
        <div className="h-full flex flex-col">
            {/* Column Selector - Fixed header */}
            <div className="mb-4 flex items-center justify-between flex-shrink-0">
                <div className="relative">
                    <button
                        onClick={() => setShowColumnSelector(!showColumnSelector)}
                        className="px-3 py-1.5 text-sm rounded smooth-transition btn-secondary flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Add Column
                        <ChevronDown className={`w-3 h-3 transform transition-transform ${showColumnSelector ? 'rotate-180' : ''}`} />
                    </button>

                    {showColumnSelector && (
                        <div className="absolute top-full mt-1 left-0 z-20 w-80 rounded-lg shadow-lg" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            maxHeight: '400px'
                        }}>
                            <div className="p-3">
                                {/* Search within columns */}
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        placeholder="Search columns..."
                                        value={columnSearch}
                                        onChange={(e) => setColumnSearch(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm rounded"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}
                                        autoFocus
                                    />
                                </div>

                                {/* Column list */}
                                <div className="max-h-64 overflow-y-auto">
                                    {filteredColumns.length === 0 ? (
                                        <div className="text-sm text-center py-2" style={{ color: 'var(--text-tertiary)' }}>
                                            No columns found
                                        </div>
                                    ) : (
                                        filteredColumns.map(col => {
                                            const isSelected = selectedColumns.includes(col);
                                            return (
                                                <button
                                                    key={col}
                                                    onClick={() => !isSelected && addColumn(col)}
                                                    disabled={isSelected}
                                                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-opacity-10 transition-colors flex items-center justify-between"
                                                    style={{
                                                        background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                                                        color: isSelected ? 'var(--text-tertiary)' : 'var(--text-primary)',
                                                        cursor: isSelected ? 'default' : 'pointer'
                                                    }}
                                                >
                                                    <span>{col}</span>
                                                    {isSelected && (
                                                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                            Already added
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {results.length} results | {selectedColumns.length} columns
                </span>
            </div>

            {/* Table - Scrollable content */}
            <div className="flex-1 overflow-auto rounded-lg" style={{
                border: '1px solid var(--border-primary)',
                minHeight: 0
            }}>
                <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-tertiary)' }}>
                        <tr>
                            <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                                <div className="flex items-center justify-between">
                                    <span>File/Line</span>
                                </div>
                            </th>
                            {selectedColumns.map(col => (
                                <th key={col} className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>{col}</span>
                                        <span
                                            onClick={() => removeColumn(col)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '3px',
                                                background: 'rgba(239, 68, 68, 0.15)',
                                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                lineHeight: '1',
                                                fontWeight: 'bold',
                                                userSelect: 'none'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = '#ef4444';
                                                e.currentTarget.style.color = 'white';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                                e.currentTarget.style.color = '#ef4444';
                                            }}
                                            title={`Remove ${col} column`}
                                        >
                                            −
                                        </span>
                                    </div>
                                </th>
                            ))}
                            <th className="px-4 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((result, idx) => {
                            const parsed = result.match_details?.parsed_fields || {};
                            const severity = parsed.severity || parsed.level || '';
                            const status = parsed.status;

                            return (
                                <tr
                                    key={idx}
                                    className="border-t hover:bg-opacity-5 transition-colors"
                                    style={{
                                        borderColor: 'var(--border-primary)'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'var(--bg-tertiary)';
                                        e.currentTarget.style.opacity = '0.5';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'transparent';
                                        e.currentTarget.style.opacity = '1';
                                    }}
                                >
                                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                        <div>{result.file?.split('/').pop()}</div>
                                        <div>Line {result.line_number}</div>
                                    </td>
                                    {selectedColumns.map(col => (
                                        <td key={col} className="px-4 py-2">
                                            <span style={{
                                                color: col === 'severity' || col === 'level'
                                                    ? getSeverityColor(parsed[col], status)
                                                    : 'var(--text-primary)',
                                                fontFamily: '"Roboto Mono", Menlo, Courier, monospace',
                                                fontSize: '12px'
                                            }}>
                                                {formatValue(parsed[col], col)}
                                            </span>
                                        </td>
                                    ))}
                                    <td className="px-4 py-2 text-center">
                                        <button
                                            onClick={() => onCopy(result)}
                                            className="p-1 rounded smooth-transition hover:scale-110"
                                            style={{
                                                background: 'var(--bg-tertiary)',
                                                color: 'var(--text-secondary)'
                                            }}
                                            title="Copy"
                                        >
                                            <Copy className="w-3 h-3" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
});

// Memoized JSON components
// Memoized JSON components with enhanced typography
// Memoized JSON components with enhanced typography
// Memoized JSON components with enhanced typography
const JsonViewer = React.memo(({ data, collapsed = false, hideBacktrace = true }) => {
    const [isCollapsed, setIsCollapsed] = useState(collapsed);

    if (typeof data !== 'object' || data === null) {
        return <span style={{
            fontFamily: '"Roboto Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: '11px',
            color: 'var(--text-primary)'
        }}>{JSON.stringify(data)}</span>;
    }

    const keys = Object.keys(data);
    const hasBacktrace = keys.includes('exception.backtrace');
    const displayKeys = hideBacktrace && hasBacktrace ? keys.filter(k => k !== 'exception.backtrace') : keys;

    const shouldShowCollapsed = isCollapsed && displayKeys.length > 10;

    if (shouldShowCollapsed) {
        return (
            <span>
                <button
                    onClick={() => setIsCollapsed(false)}
                    className="text-xs px-2 py-1 rounded smooth-transition"
                    style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-primary)',
                        fontSize: '11px'
                    }}
                >
                    <ChevronRight className="w-3 h-3 inline mr-1" />
                    Show {displayKeys.length} fields
                </button>
            </span>
        );
    }

    return (
        <div className="json-collapsible">
            {!isCollapsed && displayKeys.length > 10 && (
                <button
                    onClick={() => setIsCollapsed(true)}
                    className="text-xs px-2 py-0.5 rounded mb-1 smooth-transition"
                    style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-primary)',
                        fontSize: '11px'
                    }}
                >
                    <ChevronDown className="w-3 h-3 inline mr-1" />
                    Collapse
                </button>
            )}
            <div className="pl-3">
                {displayKeys.map((key) => (
                    <div key={key} className="py-0" style={{ lineHeight: '1.4' }}>
                        <span style={{
                            fontFamily: '"Roboto Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            fontWeight: '500'
                        }}>{key}:</span>{' '}
                        <JsonValue value={data[key]} />
                    </div>
                ))}
                {hasBacktrace && hideBacktrace && (
                    <BacktraceViewer backtrace={data['exception.backtrace']} />
                )}
            </div>
        </div>
    );
});

const JsonValue = React.memo(({ value }) => {
    if (value === null) return <span className="json-null">null</span>;
    if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
    if (typeof value === 'number') return <span className="json-number">{value}</span>;
    if (typeof value === 'string') {
        if (value.length > 100) {
            return (
                <span className="json-string">
                    "{value.substring(0, 100)}..."
                </span>
            );
        }
        return <span className="json-string">"{value}"</span>;
    }
    if (Array.isArray(value)) {
        return <span className="json-string">[Array of {value.length} items]</span>;
    }
    if (typeof value === 'object') {
        return <span className="json-string">[Object]</span>;
    }
    return <span className="json-string">{String(value)}</span>;
});

const BacktraceViewer = React.memo(({ backtrace }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!backtrace) return null;

    const lines = Array.isArray(backtrace) ? backtrace : backtrace.split('\n');
    const preview = lines.slice(0, 3);

    return (
        <div className="mt-2">
            <div className="flex items-center gap-2">
                <span className="json-key">exception.backtrace:</span>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs px-2 py-1 rounded smooth-transition"
                    style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fecaca'
                    }}
                >
                    {isExpanded ? (
                        <>
                            <ChevronDown className="w-3 h-3 inline mr-1" />
                            Hide backtrace ({lines.length} lines)
                        </>
                    ) : (
                        <>
                            <ChevronRight className="w-3 h-3 inline mr-1" />
                            Show backtrace ({lines.length} lines)
                        </>
                    )}
                </button>
            </div>
            {isExpanded ? (
                <div className="mt-2 p-3 rounded-lg text-xs overflow-x-auto" style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    maxHeight: '300px',
                    overflowY: 'auto'
                }}>
                    {lines.map((line, idx) => (
                        <div key={idx} className="py-0.5 font-mono whitespace-pre" style={{ color: '#ef4444' }}>
                            {line}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-1 text-xs opacity-75" style={{ color: 'var(--text-tertiary)' }}>
                    {preview[0]}...
                </div>
            )}
        </div>
    );
});

// Enhanced Log Entry Component - Memoized
// Enhanced Log Entry Component - Memoized
// Enhanced Log Entry Component - Memoized
const EnhancedLogEntry = React.memo(({ result, onCopy }) => {
    const [expanded, setExpanded] = useState(false);
    const parsed = result.match_details?.parsed_fields || {};

    // Extract key fields
    const severity = parsed.severity || parsed.level || 'info';
    const time = parsed.time || parsed.timestamp || parsed['@timestamp'];
    const status = parsed.status;
    const duration = parsed.duration_s || (parsed.duration_ms ? parsed.duration_ms / 1000 : null);
    const service = result.service || parsed.service || result.file?.split('/')[0];

    const getSeverityColor = useCallback(() => {
        // Prioritize status codes over severity field
        if (status && status >= 500) return '#ef4444'; // Server errors are always red
        if (status && status >= 400) return '#f59e0b'; // Client errors are always warning

        // Check for exceptions
        if (parsed['exception.class'] || parsed['exception.message']) return '#ef4444';

        // Then check severity field
        const sev = severity.toLowerCase();
        if (sev.includes('error') || sev.includes('fatal')) return '#ef4444';
        if (sev.includes('warn')) return '#f59e0b';
        if (sev.includes('info')) return '#3b82f6';
        return 'var(--text-tertiary)';
    }, [severity, status, parsed]);

    return (
        <div className="rounded-lg overflow-hidden" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)'
        }}>
            {/* Header Row */}
            <div className="px-2 py-0.5 flex items-center justify-between" style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '1px solid var(--border-primary)'
            }}>
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    <span className="text-xs font-medium px-1 py-0.5 rounded flex-shrink-0" style={{
                        background: getSeverityColor() + '20',
                        color: getSeverityColor(),
                        fontSize: '10px'
                    }}>
                        {status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : severity.toUpperCase()}
                    </span>

                    {time && (
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                            {new Date(time).toLocaleString()}
                        </span>
                    )}

                    {status && (
                        <span className={`text-xs px-1 py-0.5 rounded font-medium flex-shrink-0 ${status >= 500 ? 'bg-red-100 text-red-700' :
                            status >= 400 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-green-100 text-green-700'
                            }`} style={{ fontSize: '10px' }}>
                            {status}
                        </span>
                    )}

                    {duration && (
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                            {(duration * 1000).toFixed(0)}ms
                        </span>
                    )}

                    <span className="text-xs truncate min-w-0" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                        {service} • {result.file?.split('/').pop()} • Line {result.line_number}
                        {result.nodeName && (
                            <>
                                {' • '}
                                <span className="px-1 py-0.5 rounded font-medium" style={{
                                    background: 'var(--accent)',
                                    color: 'var(--bg-primary)',
                                    fontSize: '10px'
                                }}>
                                    {result.nodeName}
                                </span>
                            </>
                        )}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="p-1 rounded smooth-transition"
                        style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)'
                        }}
                    >
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={() => onCopy(result)}
                        className="p-1 rounded smooth-transition"
                        style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)'
                        }}
                    >
                        <Copy className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Main Content - Kibana-style crisp display */}
            <div className="px-3 py-2">
                {/* Log Line - Shows truncated when collapsed, nothing when expanded (since parsed fields show everything) */}
                {!expanded && (
                    <div style={{
                        fontFamily: '"Roboto Mono", Menlo, Courier, monospace',
                        fontSize: '12px',
                        lineHeight: '19px',
                        fontFeatureSettings: '"tnum"',
                        color: 'var(--text-primary)',
                        wordBreak: 'break-all',
                        overflowWrap: 'break-word',
                        margin: '8px 0'
                    }}>
                        {result.content.length > 390
                            ? result.content.substring(0, 390) + '...'
                            : result.content
                        }
                    </div>
                )}

                {/* Expanded Details - Show ONLY parsed fields, no raw JSON */}
                {expanded && (
                    <div style={{
                        fontFamily: '"Roboto Mono", Menlo, Courier, monospace',
                        fontSize: '11px',
                        lineHeight: '16px',
                        margin: '8px 0'
                    }}>
                        {Object.keys(parsed).length > 0 ? (
                            Object.entries(parsed)
                                .filter(([key]) => {
                                    // Filter out timestamps and backtraces
                                    return !['time', 'timestamp', '@timestamp'].includes(key) &&
                                        !key.toLowerCase().includes('backtrace');
                                })
                                .map(([key, value]) => (
                                    <div key={key} style={{ marginBottom: '4px' }}>
                                        <span style={{
                                            color: '#a1a1aa',
                                            fontWeight: '500'
                                        }}>
                                            {key}
                                        </span>
                                        <span style={{ color: '#71717a' }}>: </span>
                                        <span style={{
                                            color: 'var(--text-primary)'
                                        }}>
                                            {typeof value === 'string' && value.length > 200
                                                ? value.substring(0, 200) + '...'
                                                : typeof value === 'object'
                                                    ? JSON.stringify(value, null, 2)
                                                    : String(value)}
                                        </span>
                                    </div>
                                ))
                        ) : (
                            // Fallback to raw content if no parsed fields
                            <div style={{
                                color: 'var(--text-primary)',
                                wordBreak: 'break-all',
                                overflowWrap: 'break-word'
                            }}>
                                {result.content}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

// Main Log Entry Component - Memoized and optimized
const LogEntry = React.memo(({ result, idx, onCopy, isExpanded, onToggleExpand }) => {
    const [localExpanded, setLocalExpanded] = useState(false);

    // Use prop expansion state if provided, otherwise use local state
    const expanded = isExpanded !== undefined ? isExpanded : localExpanded;
    const toggleExpanded = useCallback(() => {
        if (onToggleExpand) {
            onToggleExpand();
        } else {
            setLocalExpanded(!localExpanded);
        }
    }, [localExpanded, onToggleExpand]);

    // Get cached parsed content or parse and cache it
    const getParsedContent = useCallback(() => {
        if (parsedContentCache.has(result)) {
            return parsedContentCache.get(result);
        }

        let parsed = { content: null, isJson: false };

        if (typeof result.content === 'string' && result.content.trim().startsWith('{')) {
            try {
                parsed = {
                    content: JSON.parse(result.content),
                    isJson: true
                };
            } catch (e) {
                // Not valid JSON
            }
        }

        parsedContentCache.set(result, parsed);
        return parsed;
    }, [result]);

    const { content: parsedContent, isJson } = getParsedContent();

    // Detect severity from content - prioritize status codes over severity field
    const severity = useMemo(() => {
        if (parsedContent) {
            // Check status code FIRST - 5xx and 4xx errors override severity field
            if (parsedContent.status) {
                if (parsedContent.status >= 500) return 'error';
                if (parsedContent.status >= 400) return 'warning';
            }

            // Check for exceptions - these also override severity field
            if (parsedContent['exception.class'] || parsedContent['exception.message']) return 'error';

            // Then check severity field
            if (parsedContent.severity) {
                const sev = parsedContent.severity.toLowerCase();
                if (sev === 'error' || sev === 'critical' || sev === 'fatal') return 'error';
                if (sev === 'warn' || sev === 'warning') return 'warning';
                if (sev === 'info') return 'info';
                if (sev === 'debug') return 'debug';
            }

            return parsedContent.severity ? 'info' : 'debug';
        }

        // Only do string content checking for non-JSON logs
        const content = String(result.content).toLowerCase();
        if (/\berror\b|exception|fail(?:ed|ure)?/i.test(content)) return 'error';
        if (/\bwarn(?:ing)?\b/i.test(content)) return 'warning';
        if (/\binfo\b/i.test(content)) return 'info';
        if (/\bdebug\b/i.test(content)) return 'debug';

        return 'debug';
    }, [parsedContent, result.content]);

    const severityColors = {
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
        debug: 'var(--text-tertiary)'
    };

    // Extract key fields for preview
    const previewInfo = useMemo(() => {
        if (!parsedContent) return null;

        const preview = {
            severity: parsedContent.severity,
            time: parsedContent.time,
            message: parsedContent.message,
            exception: parsedContent['exception.class'],
            exceptionMessage: parsedContent['exception.message'],
            method: parsedContent.method,
            path: parsedContent.path,
            controller: parsedContent.controller,
            action: parsedContent.action,
            status: parsedContent.status,
            duration: parsedContent.duration_s,
            dbDuration: parsedContent.db_duration_s,
            viewDuration: parsedContent.view_duration_s,
            correlationId: parsedContent.correlation_id,
            userId: parsedContent['meta.user'] || parsedContent['user.id'],
            username: parsedContent.username || parsedContent['user.username'],
            remoteIp: parsedContent.remote_ip || parsedContent.ip,
            userAgent: parsedContent.user_agent,
            requestId: parsedContent.request_id,
            queueDuration: parsedContent.queue_duration_s,
            gitlabVersion: parsedContent.gitlab_version,
            featureCategory: parsedContent['meta.feature_category'],
            endpoint: parsedContent['route.path'] || parsedContent.endpoint_id
        };

        // Remove undefined values
        Object.keys(preview).forEach(key => {
            if (preview[key] === undefined) delete preview[key];
        });

        return Object.keys(preview).length > 0 ? preview : null;
    }, [parsedContent]);

    const shouldShowPreview = !expanded && (previewInfo || (isJson && parsedContent));

    return (
        <div className="mb-6 group" style={{
            borderLeft: `3px solid ${severityColors[severity]}`,
            paddingLeft: '1rem'
        }}>
            {/* Header */}
            <div className="flex items-center gap-4 mb-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <span className="font-sans">{result.file?.split('/').pop()}</span>
                <span className="whitespace-nowrap">Line {result.line_number}</span>
                {result.service && <span>{result.service}</span>}
                {result.nodeName && (
                    <span className="px-2 py-0.5 rounded font-medium whitespace-nowrap" style={{
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)'
                    }}>
                        {result.nodeName}
                    </span>
                )}
                <div className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                        onClick={toggleExpanded}
                        className="p-1 rounded smooth-transition"
                        style={{
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)'
                        }}
                        title={expanded ? "Show less" : "Show all fields"}
                    >
                        {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                    </button>
                    <button
                        onClick={() => onCopy(result)}
                        className="p-1 rounded smooth-transition"
                        style={{
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)'
                        }}
                        title="Copy"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Context Before */}
            {result.context?.before?.length > 0 && (
                <div className="text-xs leading-relaxed opacity-50 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {result.context.before.map((line, i) => (
                        <div key={i}>{line || ''}</div>
                    ))}
                </div>
            )}

            {/* Main Content */}
            <div className="py-1">
                {isJson && parsedContent ? (
                    <div className="p-3 rounded-lg" style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-primary)',
                        fontFamily: '"Roboto Mono", Menlo, Courier, monospace',
                        fontSize: '11px',
                        lineHeight: '16px',
                        fontFeatureSettings: '"tnum"'
                    }}>
                        {shouldShowPreview && previewInfo ? (
                            // Preview view - show key fields in a nice layout
                            <div className="space-y-1.5" style={{ padding: '8px 12px' }}>
                                <div className="flex items-start gap-3 flex-wrap">
                                    {previewInfo.severity && (
                                        <span className="text-sm font-medium" style={{
                                            color: parsedContent.status >= 500 ? '#ef4444' :
                                                parsedContent.status >= 400 ? '#f59e0b' :
                                                    severityColors[severity]
                                        }}>
                                            {parsedContent.status >= 500 ? 'ERROR' :
                                                parsedContent.status >= 400 ? 'WARNING' :
                                                    previewInfo.severity.toUpperCase()}
                                        </span>
                                    )}
                                    {previewInfo.time && (
                                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {new Date(previewInfo.time).toLocaleString()}
                                        </span>
                                    )}
                                    {previewInfo.duration && (
                                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {(previewInfo.duration * 1000).toFixed(0)}ms
                                        </span>
                                    )}
                                    {previewInfo.dbDuration && (
                                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                            DB: {(previewInfo.dbDuration * 1000).toFixed(0)}ms
                                        </span>
                                    )}
                                    {previewInfo.viewDuration && (
                                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                            View: {(previewInfo.viewDuration * 1000).toFixed(0)}ms
                                        </span>
                                    )}
                                    {previewInfo.status && (
                                        <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                                            background: previewInfo.status >= 500 ? '#fee2e2' : previewInfo.status >= 400 ? '#fef3c7' : 'var(--bg-secondary)',
                                            color: previewInfo.status >= 500 ? '#991b1b' : previewInfo.status >= 400 ? '#92400e' : 'var(--text-secondary)'
                                        }}>
                                            {previewInfo.status}
                                        </span>
                                    )}
                                </div>

                                {previewInfo.exception && (
                                    <div className="text-sm">
                                        <span className="font-mono" style={{ color: '#ef4444' }}>
                                            {previewInfo.exception}
                                        </span>
                                        {previewInfo.exceptionMessage && (
                                            <span style={{ color: 'var(--text-primary)' }}>: {previewInfo.exceptionMessage}</span>
                                        )}
                                    </div>
                                )}

                                {previewInfo.message && !previewInfo.exception && (
                                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                        {previewInfo.message}
                                    </div>
                                )}

                                {(previewInfo.controller || previewInfo.path || previewInfo.method) && (
                                    <div className="text-xs space-x-3" style={{ color: 'var(--text-secondary)' }}>
                                        {previewInfo.method && <span className="font-medium">{previewInfo.method}</span>}
                                        {previewInfo.path && <span className="font-mono">{previewInfo.path}</span>}
                                        {previewInfo.controller && previewInfo.action && (
                                            <span>{previewInfo.controller}#{previewInfo.action}</span>
                                        )}
                                    </div>
                                )}

                                {(previewInfo.username || previewInfo.userId || previewInfo.remoteIp || previewInfo.userAgent) && (
                                    <div className="text-xs space-x-3" style={{ color: 'var(--text-tertiary)' }}>
                                        {previewInfo.username && <span>User: {previewInfo.username}</span>}
                                        {previewInfo.userId && !previewInfo.username && <span>User ID: {previewInfo.userId}</span>}
                                        {previewInfo.remoteIp && <span>IP: {previewInfo.remoteIp}</span>}
                                        {previewInfo.userAgent && (
                                            <span title={previewInfo.userAgent}>
                                                UA: {previewInfo.userAgent.substring(0, 30)}...
                                            </span>
                                        )}
                                    </div>
                                )}

                                {(previewInfo.correlationId || previewInfo.requestId || previewInfo.featureCategory) && (
                                    <div className="text-xs space-x-3" style={{ color: 'var(--text-tertiary)' }}>
                                        {previewInfo.correlationId && (
                                            <span>Correlation: {previewInfo.correlationId.substring(0, 8)}...</span>
                                        )}
                                        {previewInfo.requestId && (
                                            <span>Request: {previewInfo.requestId.substring(0, 8)}...</span>
                                        )}
                                        {previewInfo.featureCategory && (
                                            <span>Feature: {previewInfo.featureCategory}</span>
                                        )}
                                    </div>
                                )}

                                <button
                                    onClick={toggleExpanded}
                                    className="text-xs px-2 py-1 rounded smooth-transition"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    <ChevronRight className="w-3 h-3 inline mr-1" />
                                    Show all {Object.keys(parsedContent).length} fields
                                </button>
                            </div>
                        ) : shouldShowPreview && !previewInfo ? (
                            // No preview info but should show collapsed button
                            <button
                                onClick={toggleExpanded}
                                className="text-xs px-2 py-1 rounded smooth-transition"
                                style={{
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-primary)'
                                }}
                            >
                                <ChevronRight className="w-3 h-3 inline mr-1" />
                                Show {Object.keys(parsedContent).length} fields
                            </button>
                        ) : (
                            // Expanded view - show full JSON (but still hide backtrace)
                            <JsonViewer data={parsedContent} collapsed={false} hideBacktrace={true} />
                        )}
                    </div>
                ) : (
                    // Plain text content
                    <pre className="whitespace-pre-wrap break-all font-mono text-sm" style={{
                        color: severityColors[severity]
                    }}>
                        {result.content}
                    </pre>
                )}
            </div>

            {/* Context After */}
            {result.context?.after?.length > 0 && (
                <div className="text-xs leading-relaxed opacity-50 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {result.context.after.map((line, i) => (
                        <div key={i}>{line || ''}</div>
                    ))}
                </div>
            )}

            {/* Match Details */}
            {result.match_details?.matched_filters?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {result.match_details.matched_filters.map((filter, i) => (
                        <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}
                        >
                            {filter.field} {filter.operator} {filter.value}
                            {filter.actual_value && (
                                <span className="opacity-75">
                                    {' '}(found: {filter.actual_value})
                                </span>
                            )}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
});

// Error Boundary for PowerSearch components
class PowerSearchErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('PowerSearch Error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center p-8">
                        <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#ef4444' }} />
                        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                            Something went wrong
                        </h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                            The log viewer encountered an error. Your log data is safe.
                        </p>
                        <button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            className="px-4 py-2 rounded btn-primary"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

// Optimized JSON Results Component with proper virtualization for large datasets
const VirtualizedJsonResults = React.memo(({ results, allExpanded, onCopy }) => {
    const [expandedItems, setExpandedItems] = useState(new Set());
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
    const containerRef = useRef(null);
    const ITEM_HEIGHT = 120; // Approximate height per item
    const BUFFER_SIZE = 10; // Items to render outside visible area

    const toggleExpanded = useCallback((index) => {
        setExpandedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    }, []);

    // Reset expanded items when allExpanded changes
    useEffect(() => {
        if (allExpanded) {
            setExpandedItems(new Set(results.map((_, idx) => idx)));
        } else {
            setExpandedItems(new Set());
        }
    }, [allExpanded, results]);

    // Virtual scrolling for large datasets
    useEffect(() => {
        const container = containerRef.current;
        if (!container || results.length < 100) return; // Only virtualize for large datasets

        const handleScroll = () => {
            const scrollTop = container.scrollTop;
            const containerHeight = container.clientHeight;

            const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
            const end = Math.min(results.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_SIZE);

            setVisibleRange({ start, end });
        };

        container.addEventListener('scroll', handleScroll);
        handleScroll(); // Initial calculation

        return () => container.removeEventListener('scroll', handleScroll);
    }, [results.length]);

    // For small datasets, render all items normally
    if (results.length < 100) {
        return (
            <PowerSearchErrorBoundary>
                <div className="space-y-4 overflow-y-auto h-full" ref={containerRef}>
                    {results.map((result, idx) => (
                        <LogEntry
                            key={`${result.file}-${result.line_number}-${idx}`}
                            result={result}
                            idx={idx}
                            onCopy={onCopy}
                            isExpanded={expandedItems.has(idx)}
                            onToggleExpand={() => toggleExpanded(idx)}
                        />
                    ))}
                </div>
            </PowerSearchErrorBoundary>
        );
    }

    // For large datasets, use virtual scrolling
    const visibleItems = results.slice(visibleRange.start, visibleRange.end);
    const totalHeight = results.length * ITEM_HEIGHT;
    const offsetY = visibleRange.start * ITEM_HEIGHT;

    return (
        <PowerSearchErrorBoundary>
            <div className="h-full overflow-y-auto" ref={containerRef}>
                <div style={{ height: totalHeight, position: 'relative' }}>
                    <div style={{ transform: `translateY(${offsetY}px)` }}>
                        <div className="space-y-4">
                            {visibleItems.map((result, idx) => {
                                const actualIndex = visibleRange.start + idx;
                                return (
                                    <LogEntry
                                        key={`${result.file}-${result.line_number}-${actualIndex}`}
                                        result={result}
                                        idx={actualIndex}
                                        onCopy={onCopy}
                                        isExpanded={expandedItems.has(actualIndex)}
                                        onToggleExpand={() => toggleExpanded(actualIndex)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </PowerSearchErrorBoundary>
    );
});

// Memoized log entry renderer for performance
const OptimizedLogEntry = React.memo(({ result, onCopy }) => {
    const [expanded, setExpanded] = useState(false);
    
    // Lazy parse JSON only when expanded
    const parsedContent = useMemo(() => {
        if (!expanded) return null;
        
        try {
            if (typeof result.content === 'string' && result.content.trim().startsWith('{')) {
                return JSON.parse(result.content);
            }
        } catch (e) {
            console.warn('Failed to parse log content as JSON:', e.message, result.content.substring(0, 100));
        }
        return null;
    }, [expanded, result.content]);
    
    const severity = useMemo(() => {
        const content = String(result.content).toLowerCase();
        if (/\berror\b|exception|fail/i.test(content)) return 'error';
        if (/\bwarn/i.test(content)) return 'warning';
        return 'info';
    }, [result.content]);
    
    const severityColor = severity === 'error' ? '#ef4444' : 
                          severity === 'warning' ? '#f59e0b' : '#3b82f6';
    
    return (
        <div className="mb-4 pl-4" style={{ borderLeft: `3px solid ${severityColor}` }}>
            <div className="flex items-center gap-2 mb-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <span>{result.file?.split('/').pop()}</span>
                <span>Line {result.line_number}</span>
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="ml-auto px-2 py-0.5 rounded text-xs"
                    style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)'
                    }}
                >
                    {expanded ? 'Collapse' : 'Expand'}
                </button>
                <button onClick={() => onCopy(result)} className="px-2 py-0.5 rounded text-xs">
                    Copy
                </button>
            </div>
            
            <div className="font-mono text-sm" style={{ color: severityColor }}>
                {expanded && parsedContent ? (
                    <pre className="whitespace-pre-wrap">
                        {JSON.stringify(parsedContent, null, 2)}
                    </pre>
                ) : (
                    <div className="whitespace-pre-wrap break-all">
                        {result.content.length > 500 && !expanded 
                            ? result.content.substring(0, 500) + '...'
                            : result.content
                        }
                    </div>
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for better memoization
    return prevProps.result.file === nextProps.result.file &&
           prevProps.result.line_number === nextProps.result.line_number &&
           prevProps.result.content === nextProps.result.content;
});

// Virtual scroll component for large result sets
const VirtualScrollResults = React.memo(({ results, onCopy }) => {
    const containerRef = useRef(null);
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
    const itemHeight = 100; // Approximate height of each item
    const buffer = 20; // Items to render outside viewport
    
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        
        const handleScroll = () => {
            const scrollTop = container.scrollTop;
            const containerHeight = container.clientHeight;
            
            const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
            const end = Math.min(
                results.length,
                Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer
            );
            
            setVisibleRange({ start, end });
        };
        
        // Debounce scroll handler
        let scrollTimeout;
        const debouncedScroll = () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(handleScroll, 16); // ~60fps
        };
        
        container.addEventListener('scroll', debouncedScroll, { passive: true });
        handleScroll(); // Initial calculation
        
        return () => {
            container.removeEventListener('scroll', debouncedScroll);
            clearTimeout(scrollTimeout);
        };
    }, [results.length, itemHeight, buffer]);
    
    const visibleResults = results.slice(visibleRange.start, visibleRange.end);
    const totalHeight = results.length * itemHeight;
    const offsetY = visibleRange.start * itemHeight;
    
    return (
        <div 
            ref={containerRef}
            className="h-full overflow-y-auto"
            style={{ position: 'relative' }}
        >
            <div style={{ height: totalHeight, position: 'relative' }}>
                <div style={{ transform: `translateY(${offsetY}px)` }}>
                    {visibleResults.map((result, idx) => (
                        <OptimizedLogEntry
                            key={`${result.file}-${result.line_number}-${visibleRange.start + idx}`}
                            result={result}
                            onCopy={onCopy}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
});

// Main PowerSearch Component
const PowerSearch = ({ sessionId, analysisData, nodes, currentNodeId, initialQuery }) => {
    const [query, setQuery] = useState(initialQuery || '');
    const [results, dispatchResults] = useReducer(resultsReducer, []);
    const [loading, setLoading] = useState(false);
    const [fieldAnalysis, setFieldAnalysis] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [savedQueries, setSavedQueries] = useState([]);
    const [showQueryBuilder, setShowQueryBuilder] = useState(false);
    const [filters, setFilters] = useState([]);
    const [searchHistory, setSearchHistory] = useState([]);
    const [contextLines, setContextLines] = useState(0);
    const [resultLimit, setResultLimit] = useState(100);
    const [searchAllNodes, setSearchAllNodes] = useState(false);
    const [gitlabLogsOnly, setGitlabLogsOnly] = useState(false);
    const [allExpanded, setAllExpanded] = useState(false);
    const [viewMode, setViewMode] = useState('enhanced'); // 'enhanced', 'table', 'json'
    const [showHistogram, setShowHistogram] = useState(true);
    const [showQueryHelp, setShowQueryHelp] = useState(false);
    const [showSidebar, setShowSidebar] = useState(true);
    const [useOptimized, setUseOptimized] = useState(false);
    const [totalResultsFound, setTotalResultsFound] = useState(0);
    const abortControllerRef = useRef(null);
    const resultBatchRef = useRef([]);
    const batchTimeoutRef = useRef(null);
    const searchStatsRef = useRef({ startTime: 0, bytesProcessed: 0 });

    // Auto-enable optimization for large searches
    useEffect(() => {
        if (resultLimit > 1000 || (analysisData?.total_lines && analysisData.total_lines > 100000)) {
            setUseOptimized(true);
        }
    }, [resultLimit, analysisData]);

    // Constants - use optimized values when enabled
    const BATCH_SIZE = useOptimized ? OPTIMIZED_BATCH_SIZE : 50;
    const BATCH_TIMEOUT = useOptimized ? OPTIMIZED_BATCH_TIMEOUT : 100; // ms

    // Define GitLab services based on official docs
    const GITLAB_SERVICES = new Set([
        'rails', 'sidekiq', 'gitaly', 'workhorse', 'shell', 'puma',
        'nginx', 'postgresql', 'redis', 'registry', 'pages', 'prometheus',
        'grafana', 'alertmanager', 'praefect', 'kas', 'mailroom',
        'patroni', 'pgbouncer', 'sentinel', 'mattermost', 'gitlab-exporter',
        'logrotate', 'crond', 'reconfigure', 'gitlab-rails', 'gitlab-shell',
        'gitlab-workhorse', 'gitlab-pages', 'gitlab-kas', 'gitlab-config',
        'database', 'search', 'license', 'version', 'config'
    ]);

    // Debounced query setter
    const debouncedSetQuery = useMemo(
        () => debounce((value) => setQuery(value), 300),
        []
    );

    // Set initial query if provided
    useEffect(() => {
        if (initialQuery) {
            setQuery(initialQuery);
        }
    }, [initialQuery]);

    // Load saved queries from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(`powerSearchQueries_${sessionId}`);
        if (saved) {
            setSavedQueries(JSON.parse(saved));
        }

        const history = localStorage.getItem(`powerSearchHistory_${sessionId}`);
        if (history) {
            setSearchHistory(JSON.parse(history).slice(0, 10));
        }
    }, [sessionId]);

    // Analyze log structure on mount
    useEffect(() => {
        if (sessionId && analysisData && !fieldAnalysis) {
            analyzeFields();
        }
    }, [sessionId, analysisData]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            if (batchTimeoutRef.current) {
                clearTimeout(batchTimeoutRef.current);
            }
        };
    }, []);

    const analyzeFields = async () => {
        setAnalyzing(true);
        try {
            const response = await fetch('/api/power-search/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    log_files: analysisData.log_files
                })
            });

            if (!response.ok) {
                console.error('Field analysis failed with status:', response.status);
                return;
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.error('Field analysis returned non-JSON response');
                return;
            }

            const data = await response.json();
            setFieldAnalysis(data);
        } catch (error) {
            console.error('Field analysis failed:', error);
        } finally {
            setAnalyzing(false);
        }
    };

    // Batch results before updating state with data validation
    const addResultBatch = useCallback(() => {
        if (resultBatchRef.current.length > 0) {
            // Validate and sanitize results before adding to state
            const validResults = resultBatchRef.current.filter(result => {
                // Ensure required fields exist and are valid
                return result &&
                    typeof result === 'object' &&
                    result.content !== undefined &&
                    result.file &&
                    typeof result.line_number === 'number' &&
                    result.line_number > 0;
            }).map(result => ({
                // Create immutable copy with guaranteed structure
                ...result,
                content: String(result.content || ''),
                file: String(result.file || 'unknown'),
                line_number: Math.max(1, parseInt(result.line_number) || 1),
                // Preserve original data but ensure it's safe
                match_details: result.match_details ? {
                    ...result.match_details,
                    parsed_fields: result.match_details.parsed_fields || {}
                } : null
            }));

            if (validResults.length > 0) {
                dispatchResults({ type: 'ADD_BATCH', payload: validResults });
            }
            resultBatchRef.current = [];
        }
        batchTimeoutRef.current = null;
    }, []);

    const executeSearch = async () => {
        if (!query.trim() && filters.length === 0) return;

        // Cancel any ongoing search
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setLoading(true);
        dispatchResults({ type: 'RESET' });
        setTotalResultsFound(0);
        resultBatchRef.current = [];
        searchStatsRef.current.startTime = Date.now();

        // Build query from filters and text
        const fullQuery = buildQueryString();

        // Add GitLab filter if enabled
        let enhancedQuery = fullQuery;
        if (gitlabLogsOnly) {
            // Add service filter for GitLab services
            const gitlabServiceFilter = Array.from(GITLAB_SERVICES).join(',');
            enhancedQuery = enhancedQuery
                ? `service:${gitlabServiceFilter} AND (${enhancedQuery})`
                : `service:${gitlabServiceFilter}`;
        }

        // Add to history
        const newHistory = [enhancedQuery, ...searchHistory.filter(h => h !== enhancedQuery)].slice(0, 10);
        setSearchHistory(newHistory);
        localStorage.setItem(`powerSearchHistory_${sessionId}`, JSON.stringify(newHistory));

        try {
            // Determine which nodes to search
            const nodesToSearch = searchAllNodes && nodes
                ? nodes.filter(n => n.status === 'completed')
                : [nodes?.find(n => n.id === currentNodeId)].filter(Boolean);

            for (const node of nodesToSearch) {
                if (!node) continue;

                const response = await fetch('/api/power-search/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: node.sessionId,
                        query: enhancedQuery,
                        limit: resultLimit,
                        context_lines: useOptimized ? 0 : contextLines, // Disabled for performance when optimized
                        stream: true,
                        gitlab_only: gitlabLogsOnly,
                        optimized: useOptimized // Add optimization flag
                    }),
                    signal: abortControllerRef.current.signal
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const result = JSON.parse(line);

                            // Validate result structure before processing
                            if (!result || typeof result !== 'object') {
                                console.warn('PowerSearch: Invalid result structure:', result);
                                continue;
                            }

                            // Add node info to result safely
                            const safeResult = {
                                ...result,
                                nodeId: node.id,
                                nodeName: node.name,
                                // Ensure timestamp for proper ordering
                                _timestamp: Date.now()
                            };

                            // Batch results
                            resultBatchRef.current.push(safeResult);
                            setTotalResultsFound(prev => prev + 1);

                            // Process batch when it reaches size or set timeout
                            if (resultBatchRef.current.length >= BATCH_SIZE) {
                                addResultBatch();
                            } else if (!batchTimeoutRef.current) {
                                batchTimeoutRef.current = setTimeout(addResultBatch, BATCH_TIMEOUT);
                            }
                        } catch (e) {
                            // Log parse errors in development but don't break the flow
                            if (process.env.NODE_ENV === 'development') {
                                console.warn('PowerSearch: Failed to parse result line:', line, e);
                            }
                        }
                    }
                }

                // Process remaining buffer
                if (buffer.trim()) {
                    try {
                        const result = JSON.parse(buffer);
                        resultBatchRef.current.push({
                            ...result,
                            nodeId: node.id,
                            nodeName: node.name,
                            _timestamp: Date.now()
                        });
                        setTotalResultsFound(prev => prev + 1);
                    } catch (e) {
                        console.warn('PowerSearch: Failed to parse final buffer:', e);
                    }
                }
            }

            // Flush any remaining results
            addResultBatch();
            
            const elapsed = Date.now() - searchStatsRef.current.startTime;
            console.log(`Search completed in ${elapsed}ms, found ${totalResultsFound} results`);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Search failed:', error);
            }
        } finally {
            setLoading(false);
        }
    };

    const buildQueryString = useCallback(() => {
        const parts = [];

        // Add filters
        for (const filter of filters) {
            parts.push(`${filter.field}${filter.operator}${filter.value}`);
        }

        // Add text query
        if (query.trim()) {
            parts.push(query);
        }

        return parts.join(' AND ');
    }, [filters, query]);

    const addFilter = useCallback((field, operator, value) => {
        setFilters(prev => [...prev, { field, operator, value, id: Date.now() }]);
    }, []);

    const removeFilter = useCallback((id) => {
        setFilters(prev => prev.filter(f => f.id !== id));
    }, []);

    const saveQuery = useCallback(() => {
        const fullQuery = buildQueryString();
        const name = prompt('Enter a name for this query:');
        if (!name) return;

        const newSaved = [...savedQueries, {
            id: Date.now(),
            name,
            query: fullQuery,
            filters: [...filters],
            textQuery: query
        }];

        setSavedQueries(newSaved);
        localStorage.setItem(`powerSearchQueries_${sessionId}`, JSON.stringify(newSaved));
    }, [buildQueryString, savedQueries, filters, query, sessionId]);

    const loadSavedQuery = useCallback((saved) => {
        setFilters(saved.filters || []);
        setQuery(saved.textQuery || '');
    }, []);

    const exportResults = useCallback(() => {
        const data = results.map(r => ({
            file: r.file,
            line: r.line_number,
            content: r.content,
            ...r.match_details?.parsed_fields || {}
        }));

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `power_search_results_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [results]);

    const copyResult = useCallback((result) => {
        navigator.clipboard.writeText(result.content);
    }, []);

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <div className="px-3 py-1.5" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)'
            }}>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>Power Search</h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {/* View Mode Selector */}
                        <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border-primary)' }}>
                            {[
                                { id: 'enhanced', icon: Layers, label: 'Enhanced' },
                                { id: 'table', icon: Table, label: 'Table' },
                                { id: 'json', icon: Code, label: 'JSON' }
                            ].map(mode => (
                                <button
                                    key={mode.id}
                                    onClick={() => setViewMode(mode.id)}
                                    className={`px-2 py-1 text-xs flex items-center gap-1 smooth-transition ${viewMode === mode.id ? 'btn-primary' : ''
                                        }`}
                                    style={{
                                        background: viewMode === mode.id ? 'var(--accent)' : 'transparent',
                                        color: viewMode === mode.id ? 'var(--bg-primary)' : 'var(--text-secondary)'
                                    }}
                                >
                                    <mode.icon className="w-3 h-3" />
                                    {mode.label}
                                </button>
                            ))}
                        </div>

                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                                <BarChart2 className="w-3 h-3" />
                                Histogram
                            </span>
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={showHistogram}
                                    onChange={(e) => setShowHistogram(e.target.checked)}
                                    className="sr-only"
                                />
                                <div
                                    className="block w-9 h-5 rounded-full transition-colors"
                                    style={{
                                        background: showHistogram ? 'var(--accent)' : 'var(--bg-tertiary)',
                                        border: '1px solid',
                                        borderColor: showHistogram ? 'var(--accent)' : 'var(--border-primary)'
                                    }}
                                />
                                <div
                                    className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform shadow-sm"
                                    style={{
                                        transform: showHistogram ? 'translateX(1rem)' : 'translateX(0)',
                                        background: 'var(--bg-primary)'
                                    }}
                                />
                            </div>
                        </label>


                        <button
                            onClick={saveQuery}
                            disabled={!query && filters.length === 0}
                            className="px-2 py-1 text-xs rounded smooth-transition btn-secondary flex items-center gap-1"
                        >
                            <Save className="w-3 h-3" />
                            Save Query
                        </button>
                        <button
                            onClick={exportResults}
                            disabled={results.length === 0}
                            className="px-2 py-1 text-xs rounded smooth-transition btn-secondary flex items-center gap-1"
                        >
                            <Download className="w-3 h-3" />
                            Export
                        </button>
                    </div>
                </div>

                {/* Query Builder */}
                <div className="space-y-2">
                    {/* Query Builder */}
                    <QueryBuilder
                        onQueryGenerated={(generatedQuery) => {
                            setQuery(generatedQuery);
                        }}
                        availableServices={Array.from(GITLAB_SERVICES)}
                        commonFields={Object.keys(fieldAnalysis?.discovered_fields || {}).filter(f =>
                            fieldAnalysis.discovered_fields[f].is_common
                        )}
                    />

                    {/* Active Filters */}
                    {filters.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {filters.map(filter => (
                                <div key={filter.id} className="flex items-center gap-1 px-3 py-1 rounded text-sm" style={{
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-primary)'
                                }}>
                                    <span className="font-medium">{filter.field}</span>
                                    <span style={{ color: 'var(--text-secondary)' }}>{filter.operator}</span>
                                    <span>{filter.value}</span>
                                    <button
                                        onClick={() => removeFilter(filter.id)}
                                        className="ml-1"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            {filters.length > 0 && query && (
                                <span className="px-2 py-1 text-sm italic" style={{ color: 'var(--text-tertiary)' }}>AND</span>
                            )}
                        </div>
                    )}

                    {/* Main Query Input */}
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                            <input
                                type="text"
                                placeholder="Enter query (e.g., error AND service:rail*, status:500,502,503, NOT debug)"
                                className="w-full pl-9 pr-8 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-current text-sm"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && executeSearch()}
                            />
                            <button
                                onClick={() => setShowQueryHelp(!showQueryHelp)}
                                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-0.5 rounded smooth-transition"
                                style={{
                                    background: 'transparent',
                                    color: 'var(--text-tertiary)'
                                }}
                                title="Query syntax help"
                            >
                                <Info className="w-3 h-3" />
                            </button>
                        </div>
                        <button
                            onClick={executeSearch}
                            disabled={loading || (!query.trim() && filters.length === 0)}
                            className="px-4 py-1.5 rounded font-medium flex items-center gap-1.5 smooth-transition btn-primary disabled:opacity-50 text-sm"
                        >
                            {loading ? (
                                <>
                                    <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                                    Searching... ({totalResultsFound})
                                </>
                            ) : (
                                <>
                                    <Zap className="w-3 h-3" />
                                    Search
                                </>
                            )}
                        </button>
                    </div>
                    
                    {/* Performance warning */}
                    {totalResultsFound > 10000 && (
                        <div className="mt-2 p-2 rounded flex items-center gap-2" style={{
                            background: '#fef3c7',
                            color: '#92400e'
                        }}>
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm">
                                Large dataset detected. Showing first {MAX_RENDERED_RESULTS} results for performance.
                            </span>
                        </div>
                    )}

                    {/* Query Help */}
                    {showQueryHelp && (
                        <div className="p-4 rounded-lg text-sm" style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <h4 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Query Syntax Examples:</h4>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>error</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Find lines containing "error"</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>status:500</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Exact match for status field</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>{'status>=500'}</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Status greater than or equal to 500</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>service:rail*</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Service starting with "rail" (wildcard)</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>service:rails,sidekiq</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Rails OR Sidekiq service</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>status:500,502,503</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Multiple status codes</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>service:rails:prod*</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Rails production logs</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>path:/api/*/users</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Wildcard in path</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>error AND status:500</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Both conditions must match</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>error OR warning</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Either condition matches</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>NOT level:debug</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Exclude debug logs</span>
                                </div>
                                <div>
                                    <code className="block p-2 rounded mb-1" style={{ background: 'var(--bg-secondary)' }}>"exact phrase"</code>
                                    <span style={{ color: 'var(--text-tertiary)' }}>Match exact phrase</span>
                                </div>
                            </div>
                            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
                                <div className="mb-2">
                                    <span style={{ color: 'var(--text-secondary)' }}>Operators: </span>
                                    <code>:</code> <code>=</code> <code>!=</code> <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code> <code>~</code> (contains) <code>=~</code> (regex)
                                </div>
                                <div className="mb-2">
                                    <span style={{ color: 'var(--text-secondary)' }}>Wildcards: </span>
                                    <code>*</code> (any characters) <code>?</code> (single character)
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-secondary)' }}>Multiple values: </span>
                                    Use commas to match any of multiple values (e.g., <code>service:rails,sidekiq,gitaly</code>)
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Filter Templates */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Quick filters:</span>
                        <button
                            onClick={() => setQuery('service:rails,sidekiq AND severity:error')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            Rails/Sidekiq Errors
                        </button>
                        <button
                            onClick={() => setQuery('status:500,502,503,504')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            5xx Errors
                        </button>
                        <button
                            onClick={() => setQuery('path:/api/* AND status>=400')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            API Errors
                        </button>
                        <button
                            onClick={() => setQuery('method:POST,PUT,PATCH,DELETE AND status>=400')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            Write Errors
                        </button>
                        <button
                            onClick={() => setQuery('status:401,403,404')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            4XX Errors
                        </button>
                        <button
                            onClick={() => setQuery('service:postgresql AND (ERROR OR FATAL OR PANIC)')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            DB Errors
                        </button>
                        <button
                            onClick={() => setQuery('service:gitaly AND error')}
                            className="px-2 py-1 text-xs rounded-full smooth-transition hover:opacity-100 hover:bg-opacity-10"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                opacity: 0.7,
                                fontSize: '11px'
                            }}
                        >
                            Gitaly Errors
                        </button>
                    </div>

                    {/* Quick Options */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                        {/* GitLab Logs Only Filter */}
                        <label className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer" style={{
                            background: gitlabLogsOnly ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: gitlabLogsOnly ? 'var(--bg-primary)' : 'var(--text-primary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <input
                                type="checkbox"
                                checked={gitlabLogsOnly}
                                onChange={(e) => setGitlabLogsOnly(e.target.checked)}
                                className="rounded"
                                style={{ borderColor: 'var(--border-primary)' }}
                            />
                            <span className="font-medium flex items-center gap-1">
                                <Package className="w-3 h-3" />
                                GitLab Logs Only
                            </span>
                        </label>

                        {/* Search All Nodes - Always visible if multiple nodes exist */}
                        {nodes && nodes.length > 1 && (
                            <label className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer" style={{
                                background: searchAllNodes ? 'var(--accent)' : 'var(--bg-tertiary)',
                                color: searchAllNodes ? 'var(--bg-primary)' : 'var(--text-primary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={searchAllNodes}
                                    onChange={(e) => setSearchAllNodes(e.target.checked)}
                                    className="rounded"
                                    style={{ borderColor: 'var(--border-primary)' }}
                                />
                                <span className="font-medium">
                                    Search all nodes ({nodes.filter(n => n.status === 'completed').length})
                                </span>
                            </label>
                        )}

                        {/* Show current node if not searching all */}
                        {!searchAllNodes && nodes && (
                            <div className="text-xs px-2 py-1 rounded" style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)'
                            }}>
                                Current: {nodes.find(n => n.id === currentNodeId)?.name || 'Unknown'}
                            </div>
                        )}

                        <label className="flex items-center gap-1.5">
                            <span style={{ color: 'var(--text-secondary)' }}>Context:</span>
                            <select
                                value={contextLines}
                                onChange={(e) => setContextLines(Number(e.target.value))}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <option value="0">No context</option>
                                <option value="2">2 lines</option>
                                <option value="5">5 lines</option>
                                <option value="10">10 lines</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                            <span style={{ color: 'var(--text-secondary)' }}>Limit:</span>
                            <select
                                value={resultLimit}
                                onChange={(e) => setResultLimit(Number(e.target.value))}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <option value="100">100</option>
                                <option value="500">500</option>
                                <option value="1000">1000</option>
                                <option value="5000">5000</option>
                            </select>
                        </label>
                        {loading && (
                            <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                                <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                                Found {results.length} results...
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Histogram */}
            {showHistogram && results.length > 0 && (
                <div className="px-6 py-4" style={{
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-primary)'
                }}>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            Timeline Distribution
                        </h3>
                        <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded" style={{ background: '#ef4444' }} />
                                <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded" style={{ background: '#f59e0b' }} />
                                <span style={{ color: 'var(--text-secondary)' }}>Warnings</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded opacity-30" style={{ background: 'var(--text-tertiary)' }} />
                                <span style={{ color: 'var(--text-secondary)' }}>Normal</span>
                            </span>
                        </div>
                    </div>
                    <LogHistogram results={results} />
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <div className={`${showSidebar ? 'w-64' : 'w-0'} flex flex-col transition-all duration-300 overflow-hidden`} style={{
                    background: 'var(--bg-secondary)',
                    borderRight: showSidebar ? '1px solid var(--border-primary)' : 'none'
                }}>
                    {/* Saved Queries */}
                    <div className="p-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <h3 className="font-medium text-sm mb-2 flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                            <Star className="w-4 h-4" />
                            Saved Queries
                        </h3>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {savedQueries.length === 0 ? (
                                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No saved queries</p>
                            ) : (
                                savedQueries.map(saved => (
                                    <button
                                        key={saved.id}
                                        onClick={() => loadSavedQuery(saved)}
                                        className="w-full text-left px-2 py-1 text-sm rounded truncate smooth-transition"
                                        style={{
                                            color: 'var(--text-secondary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}
                                        title={saved.query}
                                    >
                                        {saved.name}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Search History */}
                    <div className="p-4 flex-1 overflow-y-auto" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <h3 className="font-medium text-sm mb-2 flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                            <Clock className="w-4 h-4" />
                            Recent Searches
                        </h3>
                        <div className="space-y-1">
                            {searchHistory.length === 0 ? (
                                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No recent searches</p>
                            ) : (
                                searchHistory.map((historyQuery, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setQuery(historyQuery)}
                                        className="w-full text-left px-2 py-1 text-sm rounded truncate font-mono text-xs smooth-transition"
                                        style={{
                                            color: 'var(--text-secondary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}
                                        title={historyQuery}
                                    >
                                        {historyQuery}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Sidebar Toggle Button */}
                <div className="relative">
                    <button
                        onClick={() => setShowSidebar(!showSidebar)}
                        className="absolute top-4 -left-3 z-10 p-1.5 rounded-full shadow-lg smooth-transition hover:scale-110"
                        style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-secondary)'
                        }}
                        title={showSidebar ? "Hide sidebar" : "Show sidebar"}
                    >
                        {showSidebar ? (
                            <ChevronLeft className="w-4 h-4" />
                        ) : (
                            <ChevronRight className="w-4 h-4" />
                        )}
                    </button>
                </div>

                {/* Results Area */}
                <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                    {results.length === 0 && !loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" style={{ color: 'var(--text-tertiary)' }} />
                                <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                                    Power Search Ready
                                </h3>
                                <p className="text-sm max-w-md" style={{ color: 'var(--text-tertiary)' }}>
                                    Use precise filters like{' '}
                                    <code className="px-1 rounded" style={{
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)'
                                    }}>{'status>=500'}</code>,{' '}
                                    <code className="px-1 rounded ml-1" style={{
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)'
                                    }}>service:sidekiq</code>, or{' '}
                                    <code className="px-1 rounded ml-1" style={{
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)'
                                    }}>NOT debug</code>
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col">
                            {/* Results Header */}
                            {!loading && results.length > 0 && (
                                <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        Showing {results.length} of {totalResultsFound} results
                                        {results.length >= resultLimit && ' (limit reached)'}
                                        {results.length > VIRTUALIZATION_THRESHOLD && ' (virtualized for performance)'}
                                    </span>
                                    {viewMode === 'json' && (
                                        <button
                                            onClick={() => setAllExpanded(!allExpanded)}
                                            className="px-3 py-1.5 text-sm rounded smooth-transition btn-secondary flex items-center gap-1"
                                        >
                                            {allExpanded ? (
                                                <>
                                                    <Minimize2 className="w-4 h-4" />
                                                    Collapse All
                                                </>
                                            ) : (
                                                <>
                                                    <Maximize2 className="w-4 h-4" />
                                                    Expand All
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Results List - Full height container with proper scrolling */}
                            <div className="flex-1 px-4 pb-4 overflow-hidden" style={{ minHeight: 0 }}>
                                {viewMode === 'table' ? (
                                    <div className="h-full overflow-y-auto">
                                        <ResultsTableView results={results} onCopy={copyResult} />
                                    </div>
                                ) : viewMode === 'json' ? (
                                    <div className="h-full overflow-y-auto">
                                        <VirtualizedJsonResults
                                            results={results}
                                            allExpanded={allExpanded}
                                            onCopy={copyResult}
                                        />
                                    </div>
                                ) : (
                                    // Enhanced view with virtualization for large result sets
                                    (() => {
                                        const shouldVirtualize = results.length > VIRTUALIZATION_THRESHOLD;
                                        return shouldVirtualize ? (
                                            <VirtualScrollResults results={results} onCopy={copyResult} />
                                        ) : (
                                            <div className="space-y-4 overflow-y-auto h-full">
                                                {results.map((result, idx) => (
                                                    <EnhancedLogEntry
                                                        key={`${idx}-${result.line_number}-${result.file}`}
                                                        result={result}
                                                        onCopy={copyResult}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Wrapped PowerSearch with error boundary
const PowerSearchWithErrorBoundary = (props) => (
    <PowerSearchErrorBoundary>
        <PowerSearch {...props} />
    </PowerSearchErrorBoundary>
);

export default PowerSearchWithErrorBoundary;