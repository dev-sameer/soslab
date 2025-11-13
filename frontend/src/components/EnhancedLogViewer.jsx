// EnhancedLogViewer.jsx - Production-Ready Full Search Implementation
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Search, Download, X, Eye, Filter, ChevronLeft, ChevronRight
} from 'lucide-react';
import { FileText } from 'lucide-react';

// Custom hook for debouncing
const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

const EnhancedLogViewer = ({ sessionId, analysisData, initialFile, initialLine }) => {
    const [selectedFile, setSelectedFile] = useState(initialFile);
    const [fileContent, setFileContent] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentLine, setCurrentLine] = useState(initialLine || 1);
    const [fileSearchTerm, setFileSearchTerm] = useState('');

    // Virtual scrolling state
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
    const [scrollTop, setScrollTop] = useState(0);
    const scrollContainerRef = useRef(null);
    const rowHeight = 24; // Height of each log line in pixels
    const overscan = 10; // Render extra rows for smoother scrolling

    // Performance optimizations
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [fileMetadata, setFileMetadata] = useState(null);

    // Core state for robust search
    const [rawLines, setRawLines] = useState([]);
    const [availableFields, setAvailableFields] = useState({});
    const [showFieldHelper, setShowFieldHelper] = useState(false);
    const [isJsonFile, setIsJsonFile] = useState(false);
    const [filterStats, setFilterStats] = useState({ total: 0, filtered: 0 });
    const [searchInProgress, setSearchInProgress] = useState(false);

    // Cache for parsed JSON lines (lazy parsing)
    const jsonCacheRef = useRef(new Map());

    // Filter fileList based on search
    const fileList = Object.entries(analysisData?.log_files || {}).map(([path, info]) => ({
        path,
        name: path.split('/').pop(),
        ...info
    })).filter(file => {
        if (fileSearchTerm) {
            const searchLower = fileSearchTerm.toLowerCase();
            return file.path.toLowerCase().includes(searchLower) ||
                file.name.toLowerCase().includes(searchLower);
        }
        return true;
    });

    // Load file metadata first
    useEffect(() => {
        if (!selectedFile || !sessionId) return;

        const loadMetadata = async () => {
            try {
                const response = await fetch(`/api/logs/${sessionId}/${selectedFile}/metadata`);
                const data = await response.json();
                setFileMetadata(data);

                // Better JSON detection
                const isJson = data.is_json_log ||
                    selectedFile.includes('json') ||
                    selectedFile.endsWith('.json');
                setIsJsonFile(isJson);
            } catch (err) {
                console.error('Error loading metadata:', err);
            }
        };

        loadMetadata();
    }, [selectedFile, sessionId]);

    // Navigation effects
    useEffect(() => {
        if (initialFile && initialFile !== selectedFile) {
            setSelectedFile(initialFile);
        }
    }, [initialFile]);

    useEffect(() => {
        if (initialLine && rawLines.length > 0) {
            const lineIndex = initialLine - 1;
            const newScrollTop = lineIndex * rowHeight;
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = newScrollTop;
            }
        }
    }, [initialLine, rawLines]);

    // Load file content
    useEffect(() => {
        if (!selectedFile || !sessionId) return;

        const loadFileContent = async () => {
            setLoading(true);
            setSearchQuery('');
            setVisibleRange({ start: 0, end: 100 });
            jsonCacheRef.current.clear(); // Clear JSON cache

            try {
                const response = await fetch(`/api/logs/${sessionId}/${selectedFile}`);
                const data = await response.json();

                // Store raw lines for full search capability
                setRawLines(data.content || []);
                setFileContent(data);

                // Analyze fields from a sample for field helper
                analyzeFieldsFromSample(data.content);

            } catch (err) {
                console.error('Error loading file:', err);
            } finally {
                setLoading(false);
            }
        };

        loadFileContent();
    }, [selectedFile, sessionId]);

    // Analyze fields from sample for the field helper UI
    const analyzeFieldsFromSample = (lines) => {
        if (!lines || lines.length === 0) return;

        const fields = {};
        let jsonCount = 0;
        const sampleSize = Math.min(1000, lines.length);

        for (let i = 0; i < sampleSize; i++) {
            const line = lines[i];
            if (typeof line === 'string' && line.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(line);
                    jsonCount++;

                    Object.entries(json).forEach(([key, value]) => {
                        if (!fields[key]) {
                            fields[key] = {
                                type: typeof value,
                                sampleValues: new Set(),
                                count: 0
                            };
                        }
                        fields[key].count++;

                        if (value !== null && value !== undefined && value !== '') {
                            const valueStr = String(value);
                            if (valueStr.length < 100 && fields[key].sampleValues.size < 20) {
                                fields[key].sampleValues.add(valueStr);
                            }
                        }
                    });
                } catch (e) {
                    // Not JSON, continue
                }
            }
        }

        // Convert sets to arrays
        Object.keys(fields).forEach(key => {
            fields[key].sampleValues = Array.from(fields[key].sampleValues)
                .slice(0, 20)
                .filter(v => v && v !== 'null' && v !== 'undefined');
        });

        setAvailableFields(fields);

        // Auto-show field helper if we found JSON fields
        const jsonRatio = jsonCount / sampleSize;
        if ((jsonRatio > 0.1 && Object.keys(fields).length > 3) || jsonRatio > 0.3) {
            setShowFieldHelper(true);
            if (!isJsonFile) {
                setIsJsonFile(true); // Update local state
            }
        }
    };

    // Parse JSON on-demand with caching
    const parseJsonLine = useCallback((line, index) => {
        // Check cache first
        if (jsonCacheRef.current.has(index)) {
            return jsonCacheRef.current.get(index);
        }

        // Parse if looks like JSON
        if (typeof line === 'string' && line.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(line);
                jsonCacheRef.current.set(index, parsed);
                return parsed;
            } catch (e) {
                jsonCacheRef.current.set(index, null);
                return null;
            }
        }

        jsonCacheRef.current.set(index, null);
        return null;
    }, []);

    // Parse search query
    const parseSearchQuery = (query) => {
        if (!query.trim()) return null;

        // Handle OR conditions
        if (query.includes(' OR ')) {
            const parts = query.split(' OR ');
            return {
                type: 'OR',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        // Handle AND conditions
        if (query.includes(' AND ')) {
            const parts = query.split(' AND ');
            return {
                type: 'AND',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        // Handle NOT conditions
        if (query.startsWith('NOT ')) {
            return {
                type: 'NOT',
                condition: parseSearchQuery(query.substring(4).trim())
            };
        }

        // Handle field queries
        if (query.includes(':')) {
            const match = query.match(/^([^:]+):(.+)$/);
            if (match) {
                const [_, field, value] = match;

                if (value.startsWith('>=')) {
                    return { type: 'FIELD_GTE', field: field.trim(), value: value.substring(2).trim() };
                } else if (value.startsWith('>')) {
                    return { type: 'FIELD_GT', field: field.trim(), value: value.substring(1).trim() };
                } else if (value.startsWith('<=')) {
                    return { type: 'FIELD_LTE', field: field.trim(), value: value.substring(2).trim() };
                } else if (value.startsWith('<')) {
                    return { type: 'FIELD_LT', field: field.trim(), value: value.substring(1).trim() };
                } else if (value.startsWith('!=')) {
                    return { type: 'FIELD_NEQ', field: field.trim(), value: value.substring(2).trim() };
                } else {
                    return { type: 'FIELD_EQ', field: field.trim(), value: value.trim() };
                }
            }
        }

        // Default to text search
        return { type: 'TEXT', value: query };
    };

    // Evaluate query against a line (with on-demand JSON parsing)
    const evaluateQuery = useCallback((query, line, index) => {
        if (!query) return true;

        switch (query.type) {
            case 'OR':
                return query.conditions.some(c => evaluateQuery(c, line, index));

            case 'AND':
                return query.conditions.every(c => evaluateQuery(c, line, index));

            case 'NOT':
                return !evaluateQuery(query.condition, line, index);

            case 'TEXT':
                return line.toLowerCase().includes(query.value.toLowerCase());

            // Field-based queries with on-demand parsing
            case 'FIELD_EQ':
            case 'FIELD_NEQ':
            case 'FIELD_GT':
            case 'FIELD_GTE':
            case 'FIELD_LT':
            case 'FIELD_LTE':
                const parsed = parseJsonLine(line, index);
                if (!parsed) return false;

                const fieldValue = parsed[query.field];
                if (fieldValue === undefined || fieldValue === null) {
                    return query.type === 'FIELD_NEQ'; // undefined != anything is true
                }

                switch (query.type) {
                    case 'FIELD_EQ':
                        return String(fieldValue).toLowerCase() === query.value.toLowerCase();
                    case 'FIELD_NEQ':
                        return String(fieldValue).toLowerCase() !== query.value.toLowerCase();
                    case 'FIELD_GT':
                        return Number(fieldValue) > Number(query.value);
                    case 'FIELD_GTE':
                        return Number(fieldValue) >= Number(query.value);
                    case 'FIELD_LT':
                        return Number(fieldValue) < Number(query.value);
                    case 'FIELD_LTE':
                        return Number(fieldValue) <= Number(query.value);
                    default:
                        return false;
                }

            default:
                return true;
        }
    }, [parseJsonLine]);

    // ROBUST FULL SEARCH - searches ALL lines, not just a sample
    const filteredIndices = useMemo(() => {
        if (!rawLines.length) return [];

        const query = parseSearchQuery(debouncedSearchQuery);

        // No query = show all
        if (!query) {
            const allIndices = rawLines.map((_, index) => index);
            setFilterStats({ total: rawLines.length, filtered: rawLines.length });
            return allIndices;
        }

        setSearchInProgress(true);
        const matchingIndices = [];

        // Search through ALL lines for complete accuracy
        for (let i = 0; i < rawLines.length; i++) {
            if (evaluateQuery(query, rawLines[i], i)) {
                matchingIndices.push(i);
            }
        }

        setFilterStats({ total: rawLines.length, filtered: matchingIndices.length });
        setSearchInProgress(false);

        return matchingIndices;
    }, [rawLines, debouncedSearchQuery, evaluateQuery]);

    // Reset scroll position when filter changes
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
        setVisibleRange({ start: 0, end: 100 });
        setScrollTop(0);
    }, [filteredIndices]);

    // Virtual scrolling handler
    const handleScroll = useCallback((e) => {
        const scrollTop = e.target.scrollTop;
        const containerHeight = e.target.clientHeight;

        const totalHeight = filteredIndices.length * rowHeight;
        const maxScrollTop = Math.max(0, totalHeight - containerHeight);

        const clampedScrollTop = Math.min(scrollTop, maxScrollTop);

        const startIndex = Math.floor(clampedScrollTop / rowHeight) - overscan;
        const endIndex = Math.ceil((clampedScrollTop + containerHeight) / rowHeight) + overscan;

        setVisibleRange({
            start: Math.max(0, startIndex),
            end: Math.min(filteredIndices.length, endIndex)
        });
        setScrollTop(clampedScrollTop);
    }, [filteredIndices.length, rowHeight, overscan]);

    // Get visible lines for rendering
    const visibleLines = useMemo(() => {
        return filteredIndices
            .slice(visibleRange.start, visibleRange.end)
            .map(index => ({
                line: rawLines[index],
                originalIndex: index,
                filteredIndex: visibleRange.start + filteredIndices.slice(visibleRange.start, visibleRange.end).indexOf(index)
            }));
    }, [filteredIndices, visibleRange, rawLines]);

    // Helper functions
    const getLogLevel = (line) => {
        if (typeof line !== 'string') return 'default';
        const lineLower = line.toLowerCase();
        if (lineLower.includes('error') || lineLower.includes('fail')) return 'error';
        if (lineLower.includes('warn')) return 'warning';
        if (lineLower.includes('info')) return 'info';
        if (lineLower.includes('debug')) return 'debug';
        return 'default';
    };

    const insertFieldFilter = (field, value, operator = '') => {
        const filterText = operator ? `${field}:${operator}${value}` : `${field}:${value}`;

        if (searchQuery) {
            setSearchQuery(`${searchQuery} AND ${filterText}`);
        } else {
            setSearchQuery(filterText);
        }
    };

    const getExampleQueries = () => {
        const examples = [];

        if (availableFields.severity || availableFields.level) {
            examples.push('severity:error OR severity:fatal');
        }
        if (availableFields.status) {
            examples.push('status:>=500');
            examples.push('status:404 OR status:403');
        }
        if (availableFields.method) {
            examples.push('method:POST AND status:>=400');
        }
        if (availableFields.duration_s || availableFields.duration || availableFields.response_time) {
            examples.push('duration_s:>1');
        }
        if (availableFields.correlation_id) {
            examples.push('correlation_id:YOUR_ID_HERE');
        }
        examples.push('NOT level:debug');
        examples.push('error AND NOT "connection reset"');

        return examples.slice(0, 5);
    };

    // Jump to line function
    const jumpToLine = (lineNumber) => {
        const targetIndex = lineNumber - 1;
        const filteredPosition = filteredIndices.indexOf(targetIndex);

        if (filteredPosition !== -1) {
            const newScrollTop = filteredPosition * rowHeight;
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = newScrollTop;
            }
            setCurrentLine(lineNumber);
        }
    };

    return (
        <div className="h-full flex" style={{ background: 'var(--bg-primary)' }}>
            {/* Left sidebar */}
            <div className="w-80 flex flex-col" style={{
                background: 'var(--bg-secondary)',
                borderRight: '1px solid var(--border-primary)'
            }}>
                <div className="p-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Log Files</h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {fileList.length} {fileSearchTerm ? `of ${Object.keys(analysisData?.log_files || {}).length}` : ''} files found
                    </p>

                    <div className="mt-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4"
                                style={{ color: 'var(--text-tertiary)' }} />
                            <input
                                type="text"
                                placeholder="Search files..."
                                value={fileSearchTerm}
                                onChange={(e) => setFileSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-8 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-current"
                                style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                            />
                            {fileSearchTerm && (
                                <button
                                    onClick={() => setFileSearchTerm('')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 rounded hover:bg-gray-600/20"
                                    title="Clear search"
                                >
                                    <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {fileList.length > 0 ? (
                        fileList.map((file) => (
                            <div
                                key={file.path}
                                className={`px-4 py-3 cursor-pointer text-sm flex items-center smooth-transition ${selectedFile === file.path ? 'btn-primary' : ''
                                    }`}
                                style={{
                                    background: selectedFile === file.path ? 'var(--accent)' : 'transparent',
                                    color: selectedFile === file.path ? 'var(--bg-primary)' : 'var(--text-primary)',
                                    ':hover': { background: 'var(--hover-bg)' }
                                }}
                                onClick={() => {
                                    setSelectedFile(file.path);
                                    setCurrentLine(1);
                                }}
                                onMouseEnter={(e) => selectedFile !== file.path && (e.currentTarget.style.background = 'var(--hover-bg)')}
                                onMouseLeave={(e) => selectedFile !== file.path && (e.currentTarget.style.background = 'transparent')}
                            >
                                <FileText className="w-4 h-4 mr-3 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{file.name}</div>
                                    <div className="text-xs opacity-70 mt-1">
                                        {file.lines?.toLocaleString()} lines • {file.service}
                                        {file.is_json_log && (
                                            <span className="ml-2 text-green-500" title="JSON formatted logs">JSON</span>
                                        )}
                                        {file.size > 10 * 1024 * 1024 && (
                                            <span className="ml-2 text-blue-500" title="Large file - optimized loading">⚡</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
                            <p className="text-sm">
                                {fileSearchTerm ? `No files match "${fileSearchTerm}"` : 'No files found'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex flex-col">
                {selectedFile ? (
                    <>
                        {/* Header */}
                        <div className="p-4" style={{
                            background: 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border-primary)'
                        }}>
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {selectedFile.split('/').pop()}
                                    </h2>
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{selectedFile}</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        {filterStats.filtered !== filterStats.total && (
                                            <span style={{ color: '#f59e0b' }}>
                                                {filterStats.filtered.toLocaleString()} filtered /
                                            </span>
                                        )}
                                        {' '}{filterStats.total.toLocaleString()} total
                                        {searchInProgress && (
                                            <span className="ml-2" style={{ color: '#f59e0b' }} title="Search in progress">
                                                ⏳
                                            </span>
                                        )}
                                    </span>
                                    <button
                                        onClick={() => {
                                            const url = `/api/logs/${sessionId}/${selectedFile}/download`;
                                            window.open(url, '_blank');
                                        }}
                                        className="p-2 rounded-xl smooth-transition"
                                        style={{
                                            color: 'var(--text-secondary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}
                                        title="Download full file"
                                    >
                                        <Download className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Search bar */}
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5"
                                            style={{ color: 'var(--text-tertiary)' }} />
                                        <input
                                            type="text"
                                            placeholder={isJsonFile
                                                ? "Search with boolean: field:value AND/OR/NOT (e.g., status:>=500 AND method:POST)"
                                                : "Search in file..."}
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-current smooth-transition text-sm"
                                            style={{
                                                background: 'var(--bg-primary)',
                                                border: '1px solid var(--border-primary)',
                                                color: 'var(--text-primary)',
                                                fontFamily: 'monospace'
                                            }}
                                        />
                                        {searchQuery !== debouncedSearchQuery && (
                                            <span className="absolute right-10 top-1/2 transform -translate-y-1/2 text-xs"
                                                style={{ color: '#f59e0b' }}>
                                                ⏳
                                            </span>
                                        )}
                                    </div>
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="px-3 py-2 rounded-xl smooth-transition btn-secondary"
                                        >
                                            Clear
                                        </button>
                                    )}
                                    {(isJsonFile || Object.keys(availableFields).length > 0) && (
                                        <button
                                            onClick={() => setShowFieldHelper(!showFieldHelper)}
                                            className="px-3 py-2 rounded-xl smooth-transition btn-secondary flex items-center gap-2"
                                        >
                                            <Filter className="w-4 h-4" />
                                            Fields
                                        </button>
                                    )}
                                </div>

                                {/* Example queries */}
                                {(isJsonFile || Object.keys(availableFields).length > 0) && !searchQuery && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Try:</span>
                                        {getExampleQueries().map((example, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setSearchQuery(example)}
                                                className="text-xs px-2 py-1 rounded-lg smooth-transition"
                                                style={{
                                                    background: 'var(--bg-tertiary)',
                                                    color: 'var(--text-secondary)',
                                                    border: '1px solid var(--border-primary)',
                                                    fontFamily: 'monospace'
                                                }}
                                            >
                                                {example}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Field helper panel */}
                            {showFieldHelper && Object.keys(availableFields).length > 0 && (
                                <div className="mt-3 p-3 rounded-lg overflow-y-auto" style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-primary)',
                                    maxHeight: '200px'
                                }}>
                                    <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                                        Available Fields (click to filter):
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {Object.entries(availableFields)
                                            .sort((a, b) => b[1].count - a[1].count)
                                            .slice(0, 20) // Show top 20 fields
                                            .map(([field, info]) => (
                                                <div key={field} className="space-y-1">
                                                    <div className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                                                        {field}
                                                        <span style={{ color: 'var(--text-tertiary)' }}> ({info.type})</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {info.sampleValues.slice(0, 3).map((value, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => insertFieldFilter(field, value)}
                                                                className="px-1.5 py-0.5 rounded text-xs smooth-transition truncate max-w-[150px]"
                                                                style={{
                                                                    background: 'var(--bg-primary)',
                                                                    color: 'var(--text-primary)',
                                                                    border: '1px solid var(--border-primary)',
                                                                    fontFamily: 'monospace'
                                                                }}
                                                                title={`Filter: ${field}:${value}`}
                                                            >
                                                                {value}
                                                            </button>
                                                        ))}
                                                        {info.type === 'number' && (
                                                            <>
                                                                <button
                                                                    onClick={() => insertFieldFilter(field, '0', '>')}
                                                                    className="px-1.5 py-0.5 rounded text-xs smooth-transition"
                                                                    style={{
                                                                        background: 'var(--bg-primary)',
                                                                        color: 'var(--text-tertiary)',
                                                                        border: '1px solid var(--border-primary)',
                                                                        fontFamily: 'monospace'
                                                                    }}
                                                                    title={`Filter: ${field}:>0`}
                                                                >
                                                                    {'>'}0
                                                                </button>
                                                                <button
                                                                    onClick={() => insertFieldFilter(field, '100', '<')}
                                                                    className="px-1.5 py-0.5 rounded text-xs smooth-transition"
                                                                    style={{
                                                                        background: 'var(--bg-primary)',
                                                                        color: 'var(--text-tertiary)',
                                                                        border: '1px solid var(--border-primary)',
                                                                        fontFamily: 'monospace'
                                                                    }}
                                                                    title={`Filter: ${field}:<100`}
                                                                >
                                                                    {'<'}100
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
                                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                            💡 Combine with: AND, OR, NOT • Operators: : = != {'>'} {'>='} {'<'} {'<='}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Virtual scrolling log viewer */}
                        <div className="flex-1 overflow-hidden font-mono text-sm" style={{ background: 'var(--bg-primary)' }}>
                            {loading ? (
                                <div className="flex items-center justify-center h-full">
                                    <div className="animate-spin w-8 h-8 border-3 border-current border-t-transparent rounded-full"
                                        style={{ borderColor: 'var(--text-tertiary)' }} />
                                </div>
                            ) : (
                                <div className="h-full relative">
                                    {filteredIndices.length === 0 && searchQuery && (
                                        <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                                            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>No matches found for:</p>
                                            <p className="mt-2 font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                                                {searchQuery}
                                            </p>
                                            <p className="mt-4 text-xs">
                                                Searched {rawLines.length.toLocaleString()} lines
                                            </p>
                                            <button
                                                onClick={() => setSearchQuery('')}
                                                className="mt-4 px-4 py-2 text-sm rounded-lg smooth-transition btn-secondary"
                                            >
                                                Clear Search
                                            </button>
                                        </div>
                                    )}

                                    {filteredIndices.length > 0 && (
                                        <div
                                            ref={scrollContainerRef}
                                            className="h-full overflow-y-auto"
                                            onScroll={handleScroll}
                                            style={{ position: 'relative' }}
                                        >
                                            {/* Virtual scroll container */}
                                            <div style={{
                                                height: `${filteredIndices.length * rowHeight}px`,
                                                position: 'relative'
                                            }}>
                                                {/* Only render visible lines */}
                                                <div style={{
                                                    transform: `translateY(${visibleRange.start * rowHeight}px)`,
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    right: 0
                                                }}>
                                                    {visibleLines.map((item, idx) => {
                                                        const actualLineNumber = item.originalIndex + 1;
                                                        const level = getLogLevel(item.line);
                                                        const color = level === 'error' ? '#ef4444' :
                                                            level === 'warning' ? '#f59e0b' :
                                                                level === 'info' ? '#3b82f6' :
                                                                    level === 'debug' ? '#6b7280' : 'var(--text-primary)';

                                                        return (
                                                            <div
                                                                key={`${actualLineNumber}-${idx}`}
                                                                className="flex hover:bg-gray-800/20"
                                                                style={{
                                                                    minHeight: `${rowHeight}px`,
                                                                    lineHeight: `${rowHeight}px`
                                                                }}
                                                                onMouseEnter={() => setCurrentLine(actualLineNumber)}
                                                            >
                                                                <span
                                                                    className="w-20 flex-shrink-0 select-none text-right pr-4"
                                                                    style={{
                                                                        color: 'var(--text-tertiary)',
                                                                        borderRight: '1px solid var(--border-primary)'
                                                                    }}
                                                                    title={`Line ${actualLineNumber}`}
                                                                >
                                                                    {actualLineNumber}
                                                                </span>
                                                                <pre
                                                                    className="flex-1 px-4 whitespace-pre-wrap break-all"
                                                                    style={{
                                                                        color,
                                                                        overflowWrap: 'anywhere',
                                                                        fontSize: '0.75rem'
                                                                    }}
                                                                >
                                                                    {item.line}
                                                                </pre>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
                        <div className="text-center">
                            <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">Select a log file to view its contents</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnhancedLogViewer;