import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import debounce from 'lodash.debounce';
import {
    Zap, Search, Filter, X, ChevronDown, ChevronRight, ChevronLeft,
    Copy, Download, AlertCircle, Info, Clock, Hash,
    FileText, Code, Layers, RefreshCw, Save, Star,
    Sparkles, Bot, TrendingUp, Maximize2, Minimize2,
    BarChart2, Calendar, Eye, EyeOff, Table,
    Package, Plus, Share2
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

// CLEAN: Simple Stacked Bar Histogram
const LogHistogram = React.memo(({ results, timeField = 'time', onTimeRangeSelect }) => {
    const [hoveredBucket, setHoveredBucket] = useState(null);
    const [selection, setSelection] = useState(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState(null);
    const containerRef = useRef(null);

    // Process results into time buckets
    const { histogramData, timeRange, maxCount } = useMemo(() => {
        if (!results || results.length === 0) {
            return { histogramData: [], timeRange: null, maxCount: 0 };
        }

        const timeFields = [timeField, 'timestamp', 'time', '@timestamp', 'created_at'];
        const dataPoints = [];

        results.forEach((r) => {
            const parsed = r.match_details?.parsed_fields || {};
            let timestamp = null;

            for (const field of timeFields) {
                const timeValue = parsed[field];
                if (timeValue) {
                    const time = new Date(timeValue).getTime();
                    if (!isNaN(time) && time > 0) {
                        timestamp = time;
                        break;
                    }
                }
            }

            if (!timestamp && typeof r.content === 'string') {
                const match = r.content.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
                if (match) {
                    const time = new Date(match[1]).getTime();
                    if (!isNaN(time)) timestamp = time;
                }
            }

            if (timestamp) {
                let severity = 'info';
                const status = parsed.status;

                if (status >= 500 || parsed['exception.class']) {
                    severity = 'error';
                } else if (status >= 400) {
                    severity = 'warning';
                } else {
                    const sev = (parsed.severity || parsed.level || '').toLowerCase();
                    if (sev.includes('error') || sev.includes('fatal')) severity = 'error';
                    else if (sev.includes('warn')) severity = 'warning';
                }

                dataPoints.push({ time: timestamp, severity });
            }
        });

        if (dataPoints.length === 0) {
            return { histogramData: [], timeRange: null, maxCount: 0 };
        }

        const times = dataPoints.map(d => d.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const range = maxTime - minTime;

        // Fixed bucket count for clarity
        const bucketCount = 50;
        const bucketSize = range / bucketCount || 1;

        const buckets = [];
        for (let i = 0; i < bucketCount; i++) {
            buckets.push({
                start: minTime + (i * bucketSize),
                end: minTime + ((i + 1) * bucketSize),
                total: 0,
                errors: 0,
                warnings: 0,
                info: 0
            });
        }

        dataPoints.forEach(({ time, severity }) => {
            const idx = Math.min(Math.floor((time - minTime) / bucketSize), bucketCount - 1);
            if (buckets[idx]) {
                buckets[idx].total++;
                if (severity === 'error') buckets[idx].errors++;
                else if (severity === 'warning') buckets[idx].warnings++;
                else buckets[idx].info++;
            }
        });

        const max = Math.max(...buckets.map(b => b.total), 1);

        return {
            histogramData: buckets,
            timeRange: { min: minTime, max: maxTime, range },
            maxCount: max
        };
    }, [results, timeField]);

    const formatTime = useCallback((timestamp) => {
        if (!timeRange) return '';
        const date = new Date(timestamp);
        const rangeMins = timeRange.range / (1000 * 60);

        if (rangeMins < 60) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else if (rangeMins < 1440) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
    }, [timeRange]);

    // Selection handlers
    const handleMouseDown = (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const pct = (e.clientX - rect.left) / rect.width;
        setIsSelecting(true);
        setSelectionStart(pct);
        setSelection({ start: pct, end: pct });
    };

    const handleMouseMove = (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
        const idx = Math.floor(pct * histogramData.length);
        setHoveredBucket(idx >= 0 && idx < histogramData.length ? idx : null);

        if (isSelecting && selectionStart !== null) {
            setSelection({
                start: Math.min(selectionStart, pct),
                end: Math.max(selectionStart, pct)
            });
        }
    };

    const handleMouseUp = () => {
        if (isSelecting && selection && timeRange && onTimeRangeSelect) {
            if (selection.end - selection.start > 0.02) {
                onTimeRangeSelect({
                    start: timeRange.min + (selection.start * timeRange.range),
                    end: timeRange.min + (selection.end * timeRange.range)
                });
            }
        }
        setIsSelecting(false);
        setSelectionStart(null);
    };

    const clearSelection = () => {
        setSelection(null);
        onTimeRangeSelect?.(null);
    };

    useEffect(() => {
        if (isSelecting) {
            const up = () => handleMouseUp();
            document.addEventListener('mouseup', up);
            return () => document.removeEventListener('mouseup', up);
        }
    }, [isSelecting, selection, timeRange]);

    if (histogramData.length === 0) {
        return (
            <div className="text-center py-6" style={{ color: 'var(--text-tertiary)' }}>
                <BarChart2 className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No timestamp data available</div>
            </div>
        );
    }

    const BAR_HEIGHT = 80;

    return (
        <div className="select-none">
            {/* Legend */}
            <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Warnings</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: '#6366f1' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Info</span>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                    {selection && (
                        <button
                            onClick={clearSelection}
                            className="flex items-center gap-1 px-2 py-1 rounded"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}
                        >
                            <X className="w-3 h-3" />
                            Clear
                        </button>
                    )}
                    <span style={{ color: 'var(--text-tertiary)' }}>
                        {formatTime(timeRange.min)} → {formatTime(timeRange.max)}
                    </span>
                </div>
            </div>

            {/* Chart Container */}
            <div
                ref={containerRef}
                className="relative cursor-crosshair rounded-lg overflow-hidden"
                style={{
                    height: BAR_HEIGHT + 24,
                    background: 'var(--bg-tertiary)'
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoveredBucket(null)}
            >
                {/* Bars */}
                <div
                    className="absolute inset-x-0 top-0 flex items-end gap-px px-1"
                    style={{ height: BAR_HEIGHT }}
                >
                    {histogramData.map((bucket, i) => {
                        const totalHeight = (bucket.total / maxCount) * 100;
                        const errorHeight = bucket.total > 0 ? (bucket.errors / bucket.total) * 100 : 0;
                        const warningHeight = bucket.total > 0 ? (bucket.warnings / bucket.total) * 100 : 0;
                        const infoHeight = 100 - errorHeight - warningHeight;

                        const isHovered = hoveredBucket === i;

                        return (
                            <div
                                key={i}
                                className="flex-1 flex flex-col justify-end transition-opacity"
                                style={{
                                    height: '100%',
                                    opacity: isHovered ? 1 : 0.85,
                                    minWidth: '2px'
                                }}
                            >
                                {bucket.total > 0 && (
                                    <div
                                        className="w-full rounded-t-sm overflow-hidden transition-all"
                                        style={{
                                            height: `${totalHeight}%`,
                                            minHeight: '2px',
                                            boxShadow: isHovered ? '0 0 8px rgba(99, 102, 241, 0.5)' : 'none',
                                            transform: isHovered ? 'scaleX(1.3)' : 'scaleX(1)'
                                        }}
                                    >
                                        {/* Stacked sections - Error on TOP */}
                                        <div className="w-full h-full flex flex-col">
                                            {/* Errors - TOP (red) */}
                                            {bucket.errors > 0 && (
                                                <div
                                                    style={{
                                                        height: `${errorHeight}%`,
                                                        background: '#ef4444',
                                                        minHeight: bucket.errors > 0 ? '2px' : 0
                                                    }}
                                                />
                                            )}
                                            {/* Warnings - MIDDLE (yellow) */}
                                            {bucket.warnings > 0 && (
                                                <div
                                                    style={{
                                                        height: `${warningHeight}%`,
                                                        background: '#f59e0b',
                                                        minHeight: bucket.warnings > 0 ? '2px' : 0
                                                    }}
                                                />
                                            )}
                                            {/* Info - BOTTOM (blue) */}
                                            {bucket.info > 0 && (
                                                <div
                                                    style={{
                                                        height: `${infoHeight}%`,
                                                        background: '#6366f1',
                                                        minHeight: bucket.info > 0 ? '2px' : 0
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Selection overlay */}
                {selection && (
                    <div
                        className="absolute top-0 bottom-6 pointer-events-none"
                        style={{
                            left: `${selection.start * 100}%`,
                            width: `${(selection.end - selection.start) * 100}%`,
                            background: 'rgba(99, 102, 241, 0.2)',
                            borderLeft: '2px solid var(--accent)',
                            borderRight: '2px solid var(--accent)'
                        }}
                    />
                )}

                {/* Time axis */}
                <div
                    className="absolute bottom-0 inset-x-0 flex justify-between px-2 py-1 text-xs"
                    style={{
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: '10px'
                    }}
                >
                    <span>{formatTime(timeRange.min)}</span>
                    <span>{formatTime(timeRange.min + timeRange.range * 0.25)}</span>
                    <span>{formatTime(timeRange.min + timeRange.range * 0.5)}</span>
                    <span>{formatTime(timeRange.min + timeRange.range * 0.75)}</span>
                    <span>{formatTime(timeRange.max)}</span>
                </div>

                {/* Tooltip */}
                {hoveredBucket !== null && histogramData[hoveredBucket] && (
                    <div
                        className="absolute z-30 pointer-events-none transform -translate-x-1/2"
                        style={{
                            left: `${((hoveredBucket + 0.5) / histogramData.length) * 100}%`,
                            top: '-8px'
                        }}
                    >
                        <div
                            className="px-3 py-2 rounded-lg shadow-lg text-xs whitespace-nowrap"
                            style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}
                        >
                            <div className="font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
                                {formatTime(histogramData[hoveredBucket].start)}
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between gap-4">
                                    <span style={{ color: 'var(--text-secondary)' }}>Total:</span>
                                    <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {histogramData[hoveredBucket].total.toLocaleString()}
                                    </span>
                                </div>
                                {histogramData[hoveredBucket].errors > 0 && (
                                    <div className="flex justify-between gap-4">
                                        <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} />
                                            Errors:
                                        </span>
                                        <span className="font-mono font-bold" style={{ color: '#ef4444' }}>
                                            {histogramData[hoveredBucket].errors}
                                        </span>
                                    </div>
                                )}
                                {histogramData[hoveredBucket].warnings > 0 && (
                                    <div className="flex justify-between gap-4">
                                        <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-sm" style={{ background: '#f59e0b' }} />
                                            Warnings:
                                        </span>
                                        <span className="font-mono font-bold" style={{ color: '#f59e0b' }}>
                                            {histogramData[hoveredBucket].warnings}
                                        </span>
                                    </div>
                                )}
                                {histogramData[hoveredBucket].info > 0 && (
                                    <div className="flex justify-between gap-4">
                                        <span className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-sm" style={{ background: '#6366f1' }} />
                                            Info:
                                        </span>
                                        <span className="font-mono font-bold" style={{ color: '#6366f1' }}>
                                            {histogramData[hoveredBucket].info}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Drag hint */}
            <div className="text-center mt-2">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Drag to select time range • Hover for details
                </span>
            </div>
        </div>
    );
});


const ResultsTableView = React.memo(({ results, onCopy, query }) => {
    const [selectedColumns, setSelectedColumns] = useState([
        'time', 'severity', 'service', 'status', 'message', 'duration_s', 'user'
    ]);
    const [showColumnSelector, setShowColumnSelector] = useState(false);
    const [columnSearch, setColumnSearch] = useState('');

    // NEW: Sorting state
    const [sortConfig, setSortConfig] = useState({ column: null, direction: null }); // null, 'asc', 'desc'

    // NEW: Selected row for keyboard navigation
    const [selectedRowIndex, setSelectedRowIndex] = useState(-1);

    // NEW: Context menu state
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, value: '', field: '' });

    // NEW: Column widths for resizing
    const [columnWidths, setColumnWidths] = useState({});
    const [resizingColumn, setResizingColumn] = useState(null);
    const resizeStartX = useRef(0);
    const resizeStartWidth = useRef(0);

    // NEW: Refs for keyboard navigation
    const tableContainerRef = useRef(null);
    const tableBodyRef = useRef(null);

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

    // NEW: Sorted results
    const sortedResults = useMemo(() => {
        if (!sortConfig.column || !sortConfig.direction) {
            return results;
        }

        return [...results].sort((a, b) => {
            const aFields = a.match_details?.parsed_fields || {};
            const bFields = b.match_details?.parsed_fields || {};

            let aVal = aFields[sortConfig.column];
            let bVal = bFields[sortConfig.column];

            // Handle undefined/null
            if (aVal === undefined || aVal === null) aVal = '';
            if (bVal === undefined || bVal === null) bVal = '';

            // Numeric comparison for numbers
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
            }

            // String comparison
            const aStr = String(aVal).toLowerCase();
            const bStr = String(bVal).toLowerCase();
            if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [results, sortConfig]);

    // NEW: Extract search terms for highlighting
    const searchTerms = useMemo(() => {
        if (!query) return [];
        // Extract words, ignoring operators and field names
        const terms = [];
        const regex = /(?:^|\s)(?:NOT\s+)?(?:\w+[:<>=!~]+)?["']?([^"'\s:=<>!~]+)["']?/gi;
        let match;
        while ((match = regex.exec(query)) !== null) {
            const term = match[1];
            if (term && term.length > 1 && !['AND', 'OR', 'NOT'].includes(term.toUpperCase())) {
                terms.push(term.toLowerCase());
            }
        }
        return [...new Set(terms)];
    }, [query]);

    // NEW: Highlight search terms in text
    const highlightText = useCallback((text, maxLength = 100) => {
        if (!text) return '-';
        let displayText = String(text);
        const wasTruncated = displayText.length > maxLength;
        if (wasTruncated) {
            displayText = displayText.substring(0, maxLength);
        }

        if (searchTerms.length === 0) {
            return wasTruncated ? displayText + '...' : displayText;
        }

        // Create regex for all terms
        const escapedTerms = searchTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');

        const parts = displayText.split(regex);

        return (
            <span>
                {parts.map((part, i) => {
                    const isMatch = searchTerms.some(term =>
                        part.toLowerCase() === term.toLowerCase()
                    );
                    return isMatch ? (
                        <mark key={i} style={{
                            background: '#fef08a',
                            color: '#854d0e',
                            padding: '0 2px',
                            borderRadius: '2px'
                        }}>{part}</mark>
                    ) : part;
                })}
                {wasTruncated && '...'}
            </span>
        );
    }, [searchTerms]);

    const formatValue = useCallback((value, column) => {
        if (value === null || value === undefined) return '-';

        // Format durations
        if (column.includes('duration') && typeof value === 'number') {
            return `${(value * 1000).toFixed(0)}ms`;
        }

        // Format timestamps
        if (column === 'time' || column === 'timestamp' || column === '@timestamp') {
            try {
                return new Date(value).toLocaleString();
            } catch {
                return String(value);
            }
        }

        return String(value);
    }, []);

    const getSeverityColor = useCallback((severity, status) => {
        if (status) {
            if (status >= 500) return '#ef4444';
            if (status >= 400) return '#f59e0b';
        }
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

    // NEW: Handle column sort
    const handleSort = useCallback((column) => {
        setSortConfig(prev => {
            if (prev.column !== column) {
                return { column, direction: 'asc' };
            }
            if (prev.direction === 'asc') {
                return { column, direction: 'desc' };
            }
            return { column: null, direction: null }; // Reset
        });
    }, []);

    // NEW: Handle cell click - copy value
    const handleCellClick = useCallback((value, e) => {
        if (value === null || value === undefined || value === '-') return;

        const textToCopy = typeof value === 'object' ? JSON.stringify(value) : String(value);
        navigator.clipboard.writeText(textToCopy);

        // Show brief feedback
        const cell = e.currentTarget;
        const originalBg = cell.style.background;
        cell.style.background = 'rgba(34, 197, 94, 0.2)';
        setTimeout(() => {
            cell.style.background = originalBg;
        }, 200);
    }, []);

    // NEW: Handle right-click context menu
    const handleContextMenu = useCallback((e, value, field) => {
        e.preventDefault();
        if (value === null || value === undefined || value === '-') return;

        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            value: String(value),
            field
        });
    }, []);

    // NEW: Close context menu
    const closeContextMenu = useCallback(() => {
        setContextMenu(prev => ({ ...prev, visible: false }));
    }, []);

    // NEW: Add value as filter (will be passed to parent)
    const addAsFilter = useCallback(() => {
        if (contextMenu.field && contextMenu.value) {
            // Dispatch custom event that parent can listen to
            const event = new CustomEvent('powersearch:addfilter', {
                detail: { field: contextMenu.field, value: contextMenu.value }
            });
            window.dispatchEvent(event);
        }
        closeContextMenu();
    }, [contextMenu, closeContextMenu]);

    // NEW: Copy from context menu
    const copyFromContextMenu = useCallback(() => {
        navigator.clipboard.writeText(contextMenu.value);
        closeContextMenu();
    }, [contextMenu.value, closeContextMenu]);

    // NEW: Keyboard navigation
    const handleKeyDown = useCallback((e) => {
        if (sortedResults.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedRowIndex(prev => Math.min(prev + 1, sortedResults.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedRowIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                if (selectedRowIndex >= 0 && selectedRowIndex < sortedResults.length) {
                    onCopy(sortedResults[selectedRowIndex]);
                }
                break;
            case 'Escape':
                setSelectedRowIndex(-1);
                break;
        }
    }, [sortedResults, selectedRowIndex, onCopy]);

    // NEW: Scroll selected row into view
    useEffect(() => {
        if (selectedRowIndex >= 0 && tableBodyRef.current) {
            const rows = tableBodyRef.current.querySelectorAll('tr');
            if (rows[selectedRowIndex]) {
                rows[selectedRowIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedRowIndex]);

    // NEW: Column resize handlers
    const handleResizeStart = useCallback((e, column) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(column);
        resizeStartX.current = e.clientX;
        resizeStartWidth.current = columnWidths[column] || 150;
    }, [columnWidths]);

    const handleResizeMove = useCallback((e) => {
        if (!resizingColumn) return;

        const diff = e.clientX - resizeStartX.current;
        const newWidth = Math.max(80, resizeStartWidth.current + diff);

        setColumnWidths(prev => ({
            ...prev,
            [resizingColumn]: newWidth
        }));
    }, [resizingColumn]);

    const handleResizeEnd = useCallback(() => {
        setResizingColumn(null);
    }, []);

    // NEW: Global mouse events for resize
    useEffect(() => {
        if (resizingColumn) {
            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeEnd);
            return () => {
                document.removeEventListener('mousemove', handleResizeMove);
                document.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [resizingColumn, handleResizeMove, handleResizeEnd]);

    // NEW: Click outside to close context menu
    useEffect(() => {
        const handleClick = () => closeContextMenu();
        if (contextMenu.visible) {
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
    }, [contextMenu.visible, closeContextMenu]);

    // NEW: Export to CSV
    const exportToCSV = useCallback(() => {
        const headers = ['file', 'line', ...selectedColumns];
        const rows = sortedResults.map(result => {
            const parsed = result.match_details?.parsed_fields || {};
            return [
                result.file?.split('/').pop() || '',
                result.line_number || '',
                ...selectedColumns.map(col => {
                    const val = parsed[col];
                    if (val === null || val === undefined) return '';
                    return String(val).replace(/"/g, '""');
                })
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `log_search_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [sortedResults, selectedColumns]);

    // NEW: Sort indicator component
    const SortIndicator = ({ column }) => {
        if (sortConfig.column !== column) {
            return <span style={{ opacity: 0.3, marginLeft: '4px' }}>↕</span>;
        }
        return (
            <span style={{ marginLeft: '4px', color: 'var(--accent)' }}>
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
        );
    };

    return (
        <div
            className="h-full flex flex-col"
            onKeyDown={handleKeyDown}
            tabIndex={0}
            ref={tableContainerRef}
            style={{ outline: 'none' }}
        >
            {/* Column Selector & Actions - Fixed header */}
            <div className="mb-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
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
                                                                Added
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

                    {/* NEW: CSV Export button */}
                    <button
                        onClick={exportToCSV}
                        className="px-3 py-1.5 text-sm rounded smooth-transition btn-secondary flex items-center gap-2"
                        title="Export to CSV"
                    >
                        <Download className="w-4 h-4" />
                        CSV
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    {/* NEW: Sort indicator */}
                    {sortConfig.column && (
                        <span className="text-xs px-2 py-1 rounded" style={{
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)'
                        }}>
                            Sorted by {sortConfig.column} ({sortConfig.direction})
                            <button
                                onClick={() => setSortConfig({ column: null, direction: null })}
                                className="ml-2 hover:text-red-400"
                            >×</button>
                        </span>
                    )}
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {sortedResults.length} results | {selectedColumns.length} columns
                    </span>
                </div>
            </div>

            {/* NEW: Keyboard hint */}
            <div className="text-xs mb-2 flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
                <span>↑↓ Navigate</span>
                <span>Enter Copy row</span>
                <span>Click cell to copy</span>
                <span>Right-click for options</span>
            </div>

            {/* Table - Scrollable content */}
            <div className="flex-1 overflow-auto rounded-lg" style={{
                border: '1px solid var(--border-primary)',
                minHeight: 0
            }}>
                <table className="w-full text-sm" style={{ minWidth: 'max-content' }}>
                    <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-tertiary)' }}>
                        <tr>
                            {/* Sticky file/line column */}
                            <th
                                className="px-3 py-2 text-left font-medium sticky left-0 z-20"
                                style={{
                                    color: 'var(--text-secondary)',
                                    background: 'var(--bg-tertiary)',
                                    minWidth: '120px',
                                    borderRight: '1px solid var(--border-primary)'
                                }}
                            >
                                File/Line
                            </th>
                            {selectedColumns.map(col => (
                                <th
                                    key={col}
                                    className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:bg-opacity-80 transition-colors relative"
                                    style={{
                                        color: 'var(--text-secondary)',
                                        background: sortConfig.column === col ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                                        width: columnWidths[col] || 'auto',
                                        minWidth: '80px'
                                    }}
                                    onClick={() => handleSort(col)}
                                >
                                    <div className="flex items-center justify-between pr-4">
                                        <span className="flex items-center">
                                            {col}
                                            <SortIndicator column={col} />
                                        </span>
                                        <span
                                            onClick={(e) => { e.stopPropagation(); removeColumn(col); }}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: '16px',
                                                height: '16px',
                                                borderRadius: '3px',
                                                background: 'rgba(239, 68, 68, 0.15)',
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                fontWeight: 'bold'
                                            }}
                                            title={`Remove ${col}`}
                                        >
                                            ×
                                        </span>
                                    </div>

                                    {/* Resize handle */}
                                    <div
                                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500"
                                        style={{
                                            background: resizingColumn === col ? 'var(--accent)' : 'transparent'
                                        }}
                                        onMouseDown={(e) => handleResizeStart(e, col)}
                                    />
                                </th>
                            ))}
                            <th className="px-3 py-2 text-center font-medium" style={{
                                color: 'var(--text-secondary)',
                                minWidth: '60px'
                            }}>
                                Copy
                            </th>
                        </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                        {sortedResults.map((result, idx) => {
                            const parsed = result.match_details?.parsed_fields || {};
                            const severity = parsed.severity || parsed.level || '';
                            const status = parsed.status;
                            const isSelected = idx === selectedRowIndex;

                            return (
                                <tr
                                    key={idx}
                                    className="border-t transition-colors"
                                    style={{
                                        borderColor: 'var(--border-primary)',
                                        background: isSelected ? 'var(--bg-tertiary)' : 'transparent'
                                    }}
                                    onClick={() => setSelectedRowIndex(idx)}
                                >
                                    {/* Sticky file/line cell */}
                                    <td
                                        className="px-3 py-2 text-xs sticky left-0"
                                        style={{
                                            color: 'var(--text-tertiary)',
                                            background: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                                            borderRight: '1px solid var(--border-primary)'
                                        }}
                                    >
                                        <div className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                                            {result.file?.split('/').pop()}
                                        </div>
                                        <div>Line {result.line_number}</div>
                                    </td>

                                    {selectedColumns.map(col => {
                                        const rawValue = parsed[col];
                                        const displayValue = formatValue(rawValue, col);

                                        return (
                                            <td
                                                key={col}
                                                className="px-3 py-2 cursor-pointer transition-colors"
                                                style={{
                                                    maxWidth: '300px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}
                                                onClick={(e) => handleCellClick(rawValue, e)}
                                                onContextMenu={(e) => handleContextMenu(e, rawValue, col)}
                                                title={rawValue != null ? `Click to copy: ${displayValue}` : ''}
                                            >
                                                <span className="font-mono text-xs" style={{
                                                    color: col === 'severity' || col === 'level'
                                                        ? getSeverityColor(parsed[col], status)
                                                        : 'var(--text-primary)',
                                                    lineHeight: '1.4',
                                                    fontFeatureSettings: '"tnum"',
                                                    WebkitFontSmoothing: 'antialiased',
                                                    MozOsxFontSmoothing: 'grayscale'
                                                }}>
                                                    {highlightText(displayValue, col === 'message' ? 150 : 50)}
                                                </span>
                                            </td>
                                        );
                                    })}

                                    <td className="px-3 py-2 text-center">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onCopy(result); }}
                                            className="p-1.5 rounded smooth-transition hover:scale-110"
                                            style={{
                                                background: 'var(--bg-tertiary)',
                                                color: 'var(--text-secondary)'
                                            }}
                                            title="Copy full row"
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

            {/* NEW: Context Menu */}
            {contextMenu.visible && (
                <div
                    className="fixed z-50 rounded-lg shadow-xl py-1"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)',
                        minWidth: '160px'
                    }}
                >
                    <button
                        onClick={copyFromContextMenu}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-opacity-10 transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <Copy className="w-4 h-4" />
                        Copy value
                    </button>
                    <button
                        onClick={addAsFilter}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-opacity-10 transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <Filter className="w-4 h-4" />
                        Add as filter: {contextMenu.field}={contextMenu.value.substring(0, 20)}{contextMenu.value.length > 20 ? '...' : ''}
                    </button>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(`${contextMenu.field}:${contextMenu.value}`);
                            closeContextMenu();
                        }}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-opacity-10 transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <Code className="w-4 h-4" />
                        Copy as query
                    </button>
                </div>
            )}
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
        return <span className="font-mono text-xs" style={{
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
                        border: '1px solid var(--border-primary)'
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
                        border: '1px solid var(--border-primary)'
                    }}
                >
                    <ChevronDown className="w-3 h-3 inline mr-1" />
                    Collapse
                </button>
            )}
            <div className="pl-3">
                {displayKeys.map((key) => (
                    <div key={key} className="py-0 font-mono text-xs" style={{ lineHeight: '1.4' }}>
                        <span style={{
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
                    <div className="whitespace-pre-wrap break-all font-mono text-xs" style={{
                        color: 'var(--text-primary)',
                        lineHeight: '1.4',
                        margin: '4px 0'
                    }}>
                        {result.content.length > 390
                            ? result.content.substring(0, 390) + '...'
                            : result.content
                        }
                    </div>
                )}

                {/* Expanded Details - Show ONLY parsed fields, no raw JSON */}
                {expanded && (
                    <div className="font-mono text-xs" style={{
                        lineHeight: '1.4',
                        margin: '4px 0'
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
                        fontSize: '12px',
                        lineHeight: '1.4',
                        WebkitFontSmoothing: 'antialiased',
                        MozOsxFontSmoothing: 'grayscale'
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
                    // Plain text content - crisp monospace display
                    <div className="font-mono text-xs break-all" style={{
                        color: severityColors[severity],
                        lineHeight: '1.4'
                    }}>
                        {result.content}
                    </div>
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

            <div className="font-mono text-xs break-all" style={{ color: severityColor, lineHeight: '1.4' }}>
                {expanded && parsedContent ? (
                    <div className="whitespace-pre-wrap">
                        {JSON.stringify(parsedContent, null, 2)}
                    </div>
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

// NEW: Query Validator Component with Real-time Feedback
const QueryValidationFeedback = React.memo(({ query, sessionId }) => {
    const [validation, setValidation] = useState(null);
    const [loading, setLoading] = useState(false);

    // Debounced validation
    useEffect(() => {
        if (!query || query.length < 2) {
            setValidation(null);
            return;
        }

        const timeoutId = setTimeout(async () => {
            setLoading(true);
            try {
                const response = await fetch('/api/power-search/validate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, session_id: sessionId })
                });

                if (response.ok) {
                    const data = await response.json();
                    setValidation(data);
                }
            } catch (e) {
                console.warn('Validation request failed:', e);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [query, sessionId]);

    if (!validation || (!validation.errors?.length && !validation.warnings?.length && !validation.suggestions?.length)) {
        return null;
    }

    return (
        <div className="mt-2 space-y-1">
            {/* Errors */}
            {validation.errors?.map((error, idx) => (
                <div key={`err-${idx}`} className="flex items-start gap-2 px-3 py-1.5 rounded text-xs" style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444'
                }}>
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error.message}</span>
                </div>
            ))}

            {/* Warnings */}
            {validation.warnings?.map((warning, idx) => (
                <div key={`warn-${idx}`} className="flex items-start gap-2 px-3 py-1.5 rounded text-xs" style={{
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: '#f59e0b'
                }}>
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div>
                        <span>{warning.message}</span>
                        {warning.suggestions?.length > 0 && (
                            <span className="ml-2 opacity-75">
                                Try: {warning.suggestions.join(', ')}
                            </span>
                        )}
                    </div>
                </div>
            ))}

            {/* Suggestions */}
            {validation.suggestions?.map((suggestion, idx) => (
                <div key={`sug-${idx}`} className="flex items-start gap-2 px-3 py-1.5 rounded text-xs" style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#3b82f6'
                }}>
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{suggestion.message}</span>
                </div>
            ))}
        </div>
    );
});


// NEW: Field Autocomplete Component
const FieldAutocomplete = React.memo(({
    inputRef,
    query,
    cursorPosition,
    onSelect,
    sessionId
}) => {
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    // Extract current word being typed
    const currentWord = useMemo(() => {
        if (!query || cursorPosition === undefined) return { word: '', start: 0, type: null };

        const beforeCursor = query.slice(0, cursorPosition);

        // Check if we're typing a field name (after space or start, before : or =)
        const fieldMatch = beforeCursor.match(/(?:^|\s)(\w*)$/);
        if (fieldMatch) {
            const word = fieldMatch[1];
            const start = beforeCursor.length - word.length;
            return { word, start, type: 'field' };
        }

        // Check if we're typing a value (after : or =)
        const valueMatch = beforeCursor.match(/(\w+)[=:](\w*)$/);
        if (valueMatch) {
            return {
                word: valueMatch[2],
                start: beforeCursor.length - valueMatch[2].length,
                type: 'value',
                field: valueMatch[1]
            };
        }

        return { word: '', start: 0, type: null };
    }, [query, cursorPosition]);

    // Fetch suggestions
    useEffect(() => {
        const fetchSuggestions = async () => {
            if (!currentWord.word || currentWord.word.length < 1) {
                setSuggestions([]);
                setVisible(false);
                return;
            }

            try {
                let endpoint;
                if (currentWord.type === 'field') {
                    endpoint = `/api/power-search/fields?partial=${encodeURIComponent(currentWord.word)}&session_id=${sessionId || ''}`;
                } else if (currentWord.type === 'value' && currentWord.field) {
                    endpoint = `/api/power-search/values?field=${encodeURIComponent(currentWord.field)}&partial=${encodeURIComponent(currentWord.word)}&session_id=${sessionId || ''}`;
                } else {
                    setSuggestions([]);
                    setVisible(false);
                    return;
                }

                const response = await fetch(endpoint);
                if (response.ok) {
                    const data = await response.json();
                    const items = data.suggestions || data.values || [];
                    setSuggestions(items.slice(0, 10));
                    setVisible(items.length > 0);
                    setSelectedIndex(0);
                }
            } catch (e) {
                console.warn('Autocomplete fetch failed:', e);
            }
        };

        const timeoutId = setTimeout(fetchSuggestions, 150);
        return () => clearTimeout(timeoutId);
    }, [currentWord, sessionId]);

    // Position the dropdown
    useEffect(() => {
        if (inputRef?.current && visible) {
            const rect = inputRef.current.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left
            });
        }
    }, [visible, inputRef]);

    // Handle selection
    const handleSelect = useCallback((item) => {
        const value = typeof item === 'string' ? item : item.field;
        onSelect(currentWord.start, cursorPosition, value, currentWord.type);
        setVisible(false);
    }, [currentWord, cursorPosition, onSelect]);

    // Keyboard navigation
    useEffect(() => {
        if (!visible) return;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Tab' || e.key === 'Enter') {
                if (suggestions[selectedIndex]) {
                    e.preventDefault();
                    handleSelect(suggestions[selectedIndex]);
                }
            } else if (e.key === 'Escape') {
                setVisible(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [visible, suggestions, selectedIndex, handleSelect]);

    if (!visible || suggestions.length === 0) return null;

    return (
        <div
            className="fixed z-50 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto"
            style={{
                top: position.top,
                left: position.left,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                minWidth: '250px',
                maxWidth: '400px'
            }}
        >
            {suggestions.map((item, idx) => {
                const isField = typeof item === 'object';
                const displayName = isField ? item.field : item;
                const isSelected = idx === selectedIndex;

                return (
                    <div
                        key={displayName}
                        className="px-3 py-2 cursor-pointer transition-colors"
                        style={{
                            background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent'
                        }}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                    >
                        <div className="flex items-center justify-between">
                            <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                                {displayName}
                            </span>
                            {isField && item.type && (
                                <span className="text-xs px-1.5 py-0.5 rounded" style={{
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-tertiary)'
                                }}>
                                    {item.type}
                                </span>
                            )}
                        </div>
                        {isField && item.description && (
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                {item.description}
                            </div>
                        )}
                        {isField && item.sample_values?.length > 0 && (
                            <div className="text-xs mt-1 flex flex-wrap gap-1">
                                {item.sample_values.slice(0, 3).map((val, i) => (
                                    <span key={i} className="px-1 py-0.5 rounded" style={{
                                        background: 'var(--bg-primary)',
                                        color: 'var(--text-secondary)',
                                        fontSize: '10px'
                                    }}>
                                        {String(val).substring(0, 20)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            <div className="px-3 py-1.5 text-xs border-t" style={{
                borderColor: 'var(--border-primary)',
                color: 'var(--text-tertiary)'
            }}>
                ↑↓ Navigate • Tab/Enter Select • Esc Close
            </div>
        </div>
    );
});

// NEW: Keyboard Shortcuts Help Modal
const KeyboardShortcutsHelp = React.memo(({ onClose }) => {
    const shortcuts = [
        { keys: ['⌘/Ctrl', 'Enter'], description: 'Execute search' },
        { keys: ['⌘/Ctrl', 'K'], description: 'Focus search input' },
        { keys: ['⌘/Ctrl', 'E'], description: 'Export results' },
        { keys: ['⌘/Ctrl', 'Shift', 'C'], description: 'Copy all results as JSON' },
        { keys: ['Escape'], description: 'Clear search / close panels' },
        { keys: ['↑', '↓'], description: 'Navigate autocomplete / table rows' },
        { keys: ['Tab', 'Enter'], description: 'Select autocomplete suggestion' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/50" />
            <div
                className="relative rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
                style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)'
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                        Keyboard Shortcuts
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 rounded hover:bg-opacity-10 transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-3">
                    {shortcuts.map((shortcut, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {shortcut.description}
                            </span>
                            <div className="flex items-center gap-1">
                                {shortcut.keys.map((key, i) => (
                                    <React.Fragment key={i}>
                                        <kbd className="px-2 py-1 rounded text-xs font-mono" style={{
                                            background: 'var(--bg-tertiary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)'
                                        }}>
                                            {key}
                                        </kbd>
                                        {i < shortcut.keys.length - 1 && (
                                            <span style={{ color: 'var(--text-tertiary)' }}>+</span>
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-primary)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Press <kbd className="px-1 rounded" style={{ background: 'var(--bg-tertiary)' }}>?</kbd> anytime to show this help
                    </p>
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

    // NEW: State for enhanced features
    const queryInputRef = useRef(null);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
    const resultCacheRef = useRef(new Map()); // LRU cache for search results
    const [selectedTimeRange, setSelectedTimeRange] = useState(null);

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

    // NEW: Global Keyboard Shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            // Search: Cmd/Ctrl + Enter
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                executeSearch();
            }
            // Focus Search: Cmd/Ctrl + K
            else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                queryInputRef.current?.focus();
            }
            // Clear/Close: Escape
            else if (e.key === 'Escape') {
                if (showAutocomplete) setShowAutocomplete(false);
                else if (showShortcutsHelp) setShowShortcutsHelp(false);
                else if (document.activeElement === queryInputRef.current) {
                    queryInputRef.current.blur();
                }
            }
            // Copy JSON: Cmd/Ctrl + Shift + C
            else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
                e.preventDefault();
                if (results.length > 0) {
                    const json = JSON.stringify(results, null, 2);
                    navigator.clipboard.writeText(json);
                    // Optional: Show toast
                }
            }
            // Export: Cmd/Ctrl + E
            else if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                exportResults();
            }
            // Help: ? (when not typing)
            else if (e.key === '?' && document.activeElement !== queryInputRef.current) {
                e.preventDefault();
                setShowShortcutsHelp(prev => !prev);
            }
        };

        document.addEventListener('keydown', handleGlobalKeyDown);
        return () => document.removeEventListener('keydown', handleGlobalKeyDown);
    }, [results, showAutocomplete, showShortcutsHelp]);

    // NEW: URL-based Query Sharing
    useEffect(() => {
        // Read from URL on mount
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q');
        const limit = params.get('limit');
        const gitlab = params.get('gitlab');

        if (q) setQuery(decodeURIComponent(q));
        if (limit) setResultLimit(Number(limit));
        if (gitlab) setGitlabLogsOnly(gitlab === 'true');
    }, []);

    // Update URL when state changes (debounced)
    useEffect(() => {
        const updateUrl = setTimeout(() => {
            const params = new URLSearchParams(window.location.search);
            if (query) params.set('q', encodeURIComponent(query));
            else params.delete('q');

            if (resultLimit !== 100) params.set('limit', resultLimit);
            else params.delete('limit');

            if (gitlabLogsOnly) params.set('gitlab', 'true');
            else params.delete('gitlab');

            const newUrl = `${window.location.pathname}?${params.toString()}`;
            window.history.replaceState({}, '', newUrl);
        }, 500);

        return () => clearTimeout(updateUrl);
    }, [query, resultLimit, gitlabLogsOnly]);

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

    // Filter results by time range if selected
    const displayResults = useMemo(() => {
        if (!selectedTimeRange) return results;

        return results.filter(r => {
            const parsed = r.match_details?.parsed_fields || {};
            const timeFields = ['time', 'timestamp', '@timestamp', 'created_at'];

            for (const field of timeFields) {
                if (parsed[field]) {
                    const time = new Date(parsed[field]).getTime();
                    if (!isNaN(time)) {
                        return time >= selectedTimeRange.start && time <= selectedTimeRange.end;
                    }
                }
            }
            // Also check content for timestamp if not parsed
            if (typeof r.content === 'string') {
                const patterns = [
                    /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
                    /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
                ];
                for (const pattern of patterns) {
                    const match = r.content.match(pattern);
                    if (match) {
                        const time = new Date(match[1]).getTime();
                        if (!isNaN(time)) {
                            return time >= selectedTimeRange.start && time <= selectedTimeRange.end;
                        }
                    }
                }
            }
            return true; // Include if no timestamp found (safe default)
        });
    }, [results, selectedTimeRange]);

    const executeSearch = async () => {
        if (!query.trim() && filters.length === 0) return;

        // Build query from filters and text
        const fullQuery = buildQueryString();

        // Add GitLab filter if enabled
        let enhancedQuery = fullQuery;
        if (gitlabLogsOnly) {
            const gitlabServiceFilter = Array.from(GITLAB_SERVICES).join(',');
            enhancedQuery = enhancedQuery
                ? `service:${gitlabServiceFilter} AND (${enhancedQuery})`
                : `service:${gitlabServiceFilter}`;
        }

        // NEW: Check cache first
        const cacheKey = `${enhancedQuery}-${resultLimit}-${gitlabLogsOnly}-${searchAllNodes}-${currentNodeId}`;
        const cached = resultCacheRef.current.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) { // 5 min TTL
            console.log('Serving results from cache');
            dispatchResults({ type: 'RESET' });
            // Process cached results in chunks to avoid UI freeze
            const chunks = [];
            for (let i = 0; i < cached.results.length; i += 500) {
                chunks.push(cached.results.slice(i, i + 500));
            }

            chunks.forEach((chunk, i) => {
                setTimeout(() => {
                    dispatchResults({ type: 'ADD_BATCH', payload: chunk });
                }, i * 16);
            });

            setTotalResultsFound(cached.total);
            return;
        }

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

        // Accumulate all results for caching
        const allResults = [];

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
                        context_lines: useOptimized ? 0 : contextLines,
                        stream: true,
                        gitlab_only: gitlabLogsOnly,
                        optimized: useOptimized
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
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const result = JSON.parse(line);

                            if (!result || typeof result !== 'object') continue;

                            const safeResult = {
                                ...result,
                                nodeId: node.id,
                                nodeName: node.name,
                                _timestamp: Date.now()
                            };

                            // Batch results
                            resultBatchRef.current.push(safeResult);
                            allResults.push(safeResult); // Store for cache
                            setTotalResultsFound(prev => prev + 1);

                            if (resultBatchRef.current.length >= BATCH_SIZE) {
                                addResultBatch();
                            } else if (!batchTimeoutRef.current) {
                                batchTimeoutRef.current = setTimeout(addResultBatch, BATCH_TIMEOUT);
                            }
                        } catch (e) {
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
                        const safeResult = {
                            ...result,
                            nodeId: node.id,
                            nodeName: node.name,
                            _timestamp: Date.now()
                        };
                        resultBatchRef.current.push(safeResult);
                        allResults.push(safeResult);
                        setTotalResultsFound(prev => prev + 1);
                    } catch (e) {
                        console.warn('PowerSearch: Failed to parse final buffer:', e);
                    }
                }
            }

            // Flush any remaining results
            addResultBatch();

            // Cache results
            if (allResults.length > 0) {
                // Limit cache size (LRU-ish)
                if (resultCacheRef.current.size > 10) {
                    const firstKey = resultCacheRef.current.keys().next().value;
                    resultCacheRef.current.delete(firstKey);
                }
                resultCacheRef.current.set(cacheKey, {
                    results: allResults,
                    total: totalResultsFound,
                    timestamp: Date.now()
                });
            }

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
            <div className="px-3 py-1" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)'
            }}>
                <style>{`
                    @keyframes shimmer {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(100%); }
                    }
                    @keyframes pulse {
                        0% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.5; transform: scale(1.5); }
                        100% { opacity: 1; transform: scale(1); }
                    }
                `}</style>
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Power Search</h2>
                    </div>
                    <div className="flex items-center gap-1">
                        {/* View Mode Selector */}
                        <div className="flex gap-0.5">
                            {[
                                { id: 'enhanced', icon: Layers, label: 'Enhanced' },
                                { id: 'table', icon: Table, label: 'Table' },
                                { id: 'json', icon: Code, label: 'JSON' }
                            ].map(mode => (
                                <button
                                    key={mode.id}
                                    onClick={() => setViewMode(mode.id)}
                                    className="px-1.5 py-0.5 text-xs flex items-center gap-0.5 rounded-full smooth-transition"
                                    style={{
                                        background: viewMode === mode.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                                        color: viewMode === mode.id ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    <mode.icon className="w-2.5 h-2.5" />
                                    {mode.label}
                                </button>
                            ))}
                        </div>

                        <label className="flex items-center gap-1 cursor-pointer ml-1">
                            <span className="text-xs flex items-center gap-0.5" style={{ color: 'var(--text-secondary)' }}>
                                <BarChart2 className="w-2.5 h-2.5" />
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
                                    className="block w-7 h-4 rounded-full transition-colors"
                                    style={{
                                        background: showHistogram ? 'var(--accent)' : 'var(--bg-tertiary)',
                                        border: '1px solid',
                                        borderColor: showHistogram ? 'var(--accent)' : 'var(--border-primary)'
                                    }}
                                />
                                <div
                                    className="absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform shadow-sm"
                                    style={{
                                        transform: showHistogram ? 'translateX(0.75rem)' : 'translateX(0)',
                                        background: 'var(--bg-primary)'
                                    }}
                                />
                            </div>
                        </label>


                        <button
                            onClick={saveQuery}
                            disabled={!query && filters.length === 0}
                            className="px-1.5 py-0.5 text-xs rounded-full smooth-transition btn-secondary flex items-center gap-0.5"
                        >
                            <Save className="w-2.5 h-2.5" />
                            Save
                        </button>
                        <button
                            onClick={exportResults}
                            disabled={results.length === 0}
                            className="px-1.5 py-0.5 text-xs rounded-full smooth-transition btn-secondary flex items-center gap-0.5"
                        >
                            <Download className="w-2.5 h-2.5" />
                            Export
                        </button>

                        {/* NEW: Share Button */}
                        <button
                            onClick={() => {
                                const url = window.location.href;
                                navigator.clipboard.writeText(url);
                                // Visual feedback could be added here
                            }}
                            className="px-1.5 py-0.5 text-xs rounded-full smooth-transition btn-secondary flex items-center gap-0.5"
                            title="Copy link to current search"
                        >
                            <Share2 className="w-2.5 h-2.5" />
                            Share
                        </button>
                    </div>
                </div>

                {/* Query Builder */}
                <div className="space-y-1">
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
                        <div className="flex flex-wrap gap-1">
                            {filters.map(filter => (
                                <div key={filter.id} className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs" style={{
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-primary)'
                                }}>
                                    <span className="font-medium">{filter.field}</span>
                                    <span style={{ color: 'var(--text-secondary)' }}>{filter.operator}</span>
                                    <span>{filter.value}</span>
                                    <button
                                        onClick={() => removeFilter(filter.id)}
                                        className="ml-0.5"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            ))}
                            {filters.length > 0 && query && (
                                <span className="px-1 py-0.5 text-xs italic" style={{ color: 'var(--text-tertiary)' }}>AND</span>
                            )}
                        </div>
                    )}

                    {/* Main Query Input */}
                    <div className="flex gap-1 relative">
                        <div className="flex-1 relative">
                            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                            <input
                                ref={queryInputRef}
                                type="text"
                                placeholder="Enter query (e.g., error AND service:rail*, status:500,502,503, NOT debug)"
                                className="w-full pl-7 pr-6 py-1 rounded-full focus:outline-none focus:ring-2 focus:ring-current text-xs"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setCursorPosition(e.target.selectionStart);
                                    setShowAutocomplete(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !showAutocomplete) {
                                        executeSearch();
                                    }
                                }}
                                onClick={(e) => {
                                    setCursorPosition(e.target.selectionStart);
                                    setShowAutocomplete(true);
                                }}
                                onBlur={() => {
                                    // Delay hiding to allow click on suggestion
                                    setTimeout(() => setShowAutocomplete(false), 200);
                                }}
                                onFocus={() => setShowAutocomplete(true)}
                            />
                            <button
                                onClick={() => setShowShortcutsHelp(!showShortcutsHelp)}
                                className="absolute right-1.5 top-1/2 transform -translate-y-1/2 p-0.5 rounded smooth-transition"
                                style={{
                                    background: 'transparent',
                                    color: 'var(--text-tertiary)'
                                }}
                                title="Keyboard shortcuts (?)"
                            >
                                <div className="flex items-center gap-0.5">
                                    <span className="text-xs border rounded px-0.5" style={{ borderColor: 'var(--border-primary)' }}>?</span>
                                </div>
                            </button>
                        </div>

                        {/* Autocomplete Dropdown */}
                        {showAutocomplete && (
                            <FieldAutocomplete
                                inputRef={queryInputRef}
                                query={query}
                                cursorPosition={cursorPosition}
                                sessionId={sessionId}
                                onSelect={(start, end, value, type) => {
                                    const before = query.slice(0, start);
                                    const after = query.slice(end);
                                    const newValue = type === 'field' ? `${value}:` : value;
                                    const newQuery = before + newValue + after;
                                    setQuery(newQuery);

                                    // Move cursor after insertion
                                    const newCursorPos = start + newValue.length;
                                    setTimeout(() => {
                                        if (queryInputRef.current) {
                                            queryInputRef.current.focus();
                                            queryInputRef.current.setSelectionRange(newCursorPos, newCursorPos);
                                        }
                                    }, 0);
                                }}
                            />
                        )}

                        <button
                            onClick={executeSearch}
                            disabled={loading || (!query.trim() && filters.length === 0)}
                            className="px-3 py-1 rounded-full font-medium flex items-center gap-1 smooth-transition btn-primary disabled:opacity-50 text-xs relative overflow-hidden"
                        >
                            {loading ? (
                                <>
                                    <div className="absolute inset-0 opacity-20" style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                                        animation: 'shimmer 1.5s infinite'
                                    }} />
                                    <div className="animate-spin w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full" />
                                    <span className="whitespace-nowrap">
                                        {totalResultsFound > 0 ? `${totalResultsFound}...` : 'Searching...'}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-2.5 h-2.5" />
                                    Search
                                </>
                            )}
                        </button>
                    </div>

                    {/* Validation Feedback */}
                    <QueryValidationFeedback query={query} sessionId={sessionId} />

                    {/* Performance warning */}
                    {totalResultsFound > 10000 && (
                        <div className="mt-1 p-1.5 rounded flex items-center gap-1" style={{
                            background: '#fef3c7',
                            color: '#92400e'
                        }}>
                            <AlertCircle className="w-3 h-3" />
                            <span className="text-xs">
                                Large dataset detected. Showing first {MAX_RENDERED_RESULTS} results for performance.
                            </span>
                        </div>
                    )}

                    {/* Query Help */}
                    {showQueryHelp && (
                        <div className="p-2 rounded-lg text-xs" style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <h4 className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Query Syntax Examples:</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <code className="block p-1 rounded mb-0.5" style={{ background: 'var(--bg-secondary)', fontSize: '10px' }}>error</code>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Find lines containing "error"</span>
                                </div>
                                <div>
                                    <code className="block p-1 rounded mb-0.5" style={{ background: 'var(--bg-secondary)', fontSize: '10px' }}>status:500</code>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Exact match for status field</span>
                                </div>
                                <div>
                                    <code className="block p-1 rounded mb-0.5" style={{ background: 'var(--bg-secondary)', fontSize: '10px' }}>{'status>=500'}</code>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Status greater than or equal to 500</span>
                                </div>
                                <div>
                                    <code className="block p-1 rounded mb-0.5" style={{ background: 'var(--bg-secondary)', fontSize: '10px' }}>service:rail*</code>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Service starting with "rail" (wildcard)</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Filter Templates */}
                    <div className="flex flex-wrap items-center gap-0.5 mt-0.5">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Quick filters:</span>
                        <button
                            onClick={() => setQuery('service:rails,sidekiq AND severity:error')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            Rails/Sidekiq Errors
                        </button>
                        <button
                            onClick={() => setQuery('status:500,502,503,504')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            5xx Errors
                        </button>
                        <button
                            onClick={() => setQuery('path:/api/* AND status>=400')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            API Errors
                        </button>
                        <button
                            onClick={() => setQuery('method:POST,PUT,PATCH,DELETE AND status>=400')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            Write Errors
                        </button>
                        <button
                            onClick={() => setQuery('status:401,403,404')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            4XX Errors
                        </button>
                        <button
                            onClick={() => setQuery('service:postgresql AND (ERROR OR FATAL OR PANIC)')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            DB Errors
                        </button>
                        <button
                            onClick={() => setQuery('service:gitaly AND error')}
                            className="px-1 py-0 text-xs rounded-full smooth-transition"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)',
                                fontSize: '10px',
                                lineHeight: '1'
                            }}
                        >
                            Gitaly Errors
                        </button>
                    </div>

                    {/* Quick Options */}
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                        {/* GitLab Logs Only Filter */}
                        <label className="flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-pointer smooth-transition" style={{
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
                            <span className="font-medium flex items-center gap-0.5">
                                <Package className="w-2.5 h-2.5" />
                                GitLab Logs Only
                            </span>
                        </label>

                        {/* Search All Nodes - Always visible if multiple nodes exist */}
                        {nodes && nodes.length > 1 && (
                            <label className="flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-pointer smooth-transition" style={{
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
                            <div className="text-xs px-1.5 py-0.5 rounded-full" style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                Current: {nodes.find(n => n.id === currentNodeId)?.name || 'Unknown'}
                            </div>
                        )}

                        <label className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Context:</span>
                            <select
                                value={contextLines}
                                onChange={(e) => setContextLines(Number(e.target.value))}
                                className="px-0.5 py-0 rounded text-xs"
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
                        <label className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Limit:</span>
                            <select
                                value={resultLimit}
                                onChange={(e) => setResultLimit(Number(e.target.value))}
                                className="px-0.5 py-0 rounded text-xs"
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
                    <LogHistogram
                        results={results}
                        onTimeRangeSelect={setSelectedTimeRange}
                    />
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
                                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)', fontWeight: '500', letterSpacing: '0.3px' }}>
                                        Showing {displayResults.length} of {totalResultsFound} results
                                        {displayResults.length >= resultLimit && ' (limit reached)'}
                                        {displayResults.length > VIRTUALIZATION_THRESHOLD && ' (virtualized for performance)'}
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
                                {(() => {
                                    const shouldVirtualize = displayResults.length > VIRTUALIZATION_THRESHOLD;
                                    return (
                                        <>
                                            {viewMode === 'enhanced' && (
                                                shouldVirtualize ? (
                                                    <VirtualScrollResults results={displayResults} onCopy={copyResult} />
                                                ) : (
                                                    <div className="space-y-4 overflow-y-auto h-full">
                                                        {displayResults.map((result, idx) => (
                                                            <EnhancedLogEntry
                                                                key={`${idx}-${result.line_number}-${result.file}`}
                                                                result={result}
                                                                onCopy={copyResult}
                                                            />
                                                        ))}
                                                    </div>
                                                )
                                            )}

                                            {viewMode === 'table' && (
                                                <ResultsTableView
                                                    results={displayResults}
                                                    onCopy={copyResult}
                                                    query={query}
                                                />
                                            )}

                                            {viewMode === 'json' && (
                                                shouldVirtualize ? (
                                                    <VirtualizedJsonResults
                                                        results={displayResults}
                                                        allExpanded={allExpanded}
                                                        onCopy={copyResult}
                                                    />
                                                ) : (
                                                    <div className="space-y-4 overflow-y-auto h-full">
                                                        {displayResults.map((result, idx) => (
                                                            <JsonViewer
                                                                key={`${idx}-${result.line_number}`}
                                                                data={result}
                                                                collapsed={!allExpanded}
                                                            />
                                                        ))}
                                                    </div>
                                                )
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Keyboard Shortcuts Help Modal */}
            {showShortcutsHelp && (
                <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
            )}
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