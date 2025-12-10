// EnhancedLogViewer.jsx - Clean, Production-Ready Log Viewer with Add Files
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Search, Download, X, Eye, Filter, ChevronLeft, ChevronRight,
    FileText, Trash2, RefreshCw, FilePlus
} from 'lucide-react';

// Custom hook for debouncing
const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => clearTimeout(handler);
    }, [value, delay]);

    return debouncedValue;
};

// =============================================================================
// ADD FILES BUTTON COMPONENT
// =============================================================================
const AddFilesButton = ({ sessionId, onFilesAdded }) => {
    const [showModal, setShowModal] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({});
    const fileInputRef = useRef(null);

    const handleFiles = async (files) => {
        if (files.length === 0) return;

        setUploading(true);

        try {
            const formData = new FormData();
            files.forEach(file => {
                formData.append('files', file);
                setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
            });

            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    const updated = { ...prev };
                    Object.keys(updated).forEach(key => {
                        if (updated[key] < 90) updated[key] += 15;
                    });
                    return updated;
                });
            }, 200);

            const uploadResponse = await fetch(`/api/sessions/${sessionId}/add-files`, {
                method: 'POST',
                body: formData
            });

            clearInterval(progressInterval);

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
            }

            setUploadProgress(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(key => updated[key] = 100);
                return updated;
            });

            await new Promise(r => setTimeout(r, 500));

            if (onFilesAdded) {
                onFilesAdded();
            }

            setShowModal(false);
            setUploadProgress({});

        } catch (error) {
            console.error('Upload error:', error);
            alert('Failed to upload files: ' + error.message);
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        handleFiles(Array.from(e.dataTransfer.files));
    };

    return (
        <>
            <button
                onClick={() => setShowModal(true)}
                className="p-1.5 rounded-lg smooth-transition"
                style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)'
                }}
                title="Add files to this session"
            >
                <FilePlus className="w-3.5 h-3.5" />
            </button>

            {showModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center"
                    style={{ background: 'rgba(0, 0, 0, 0.7)' }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !uploading) {
                            setShowModal(false);
                        }
                    }}
                >
                    <div
                        onDrop={handleDrop}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                        className="w-full max-w-lg m-4 p-8 rounded-2xl relative"
                        style={{
                            background: 'var(--bg-primary)',
                            border: isDragging ? '3px dashed var(--accent)' : '1px solid var(--border-primary)',
                            transform: isDragging ? 'scale(1.02)' : 'scale(1)',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {!uploading && (
                            <button
                                onClick={() => setShowModal(false)}
                                className="absolute top-4 right-4 p-2 rounded-lg"
                                style={{ background: 'var(--bg-tertiary)' }}
                            >
                                <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
                            className="hidden"
                            disabled={uploading}
                        />

                        {uploading ? (
                            <div className="text-center">
                                <div
                                    className="animate-spin w-12 h-12 border-4 border-t-transparent rounded-full mx-auto mb-4"
                                    style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
                                />
                                <p className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                                    Adding files...
                                </p>
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {Object.entries(uploadProgress).map(([filename, progress]) => (
                                        <div key={filename}>
                                            <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                                                <span className="truncate max-w-[300px]">{filename}</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{
                                                        width: `${progress}%`,
                                                        background: progress === 100 ? '#10b981' : 'var(--accent)'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center">
                                <FilePlus
                                    className="w-16 h-16 mx-auto mb-4"
                                    style={{ color: isDragging ? 'var(--accent)' : 'var(--text-tertiary)' }}
                                />

                                <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                    {isDragging ? 'Drop files here' : 'Add Files'}
                                </h3>

                                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                                    Drag & drop or click to browse
                                </p>

                                <div className="flex flex-wrap justify-center gap-2 text-xs mb-4">
                                    {['.log', '.json', '.txt', '.tar.gz', '.zip'].map(ext => (
                                        <span
                                            key={ext}
                                            className="px-2 py-1 rounded-full"
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                                        >
                                            {ext}
                                        </span>
                                    ))}
                                </div>

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-6 py-2 rounded-xl font-semibold"
                                    style={{
                                        background: 'var(--accent)',
                                        color: 'var(--bg-primary)'
                                    }}
                                >
                                    Browse Files
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

// =============================================================================
// MAIN ENHANCED LOG VIEWER COMPONENT
// =============================================================================
const EnhancedLogViewer = ({ sessionId, analysisData, initialFile, initialLine }) => {
    const [selectedFile, setSelectedFile] = useState(initialFile);
    const [fileContent, setFileContent] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentLine, setCurrentLine] = useState(initialLine || 1);
    const [fileSearchTerm, setFileSearchTerm] = useState('');

    // Virtual scrolling state
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
    const scrollContainerRef = useRef(null);
    const rowHeight = 24;
    const overscan = 10;

    // Search and filtering
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [rawLines, setRawLines] = useState([]);
    const [availableFields, setAvailableFields] = useState({});
    const [showFieldHelper, setShowFieldHelper] = useState(false);
    const [isJsonFile, setIsJsonFile] = useState(false);
    const [filterStats, setFilterStats] = useState({ total: 0, filtered: 0 });

    // JSON parsing cache
    const jsonCacheRef = useRef(new Map());

    // Refreshable file list
    const [fileListData, setFileListData] = useState(analysisData?.log_files || {});
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [sidebarWidth, setSidebarWidth] = useState(320);
    const [isResizing, setIsResizing] = useState(false);

    // Sidebar resize handler
    const handleMouseMove = useCallback((e) => {
        if (!isResizing) return;
        const newWidth = Math.min(Math.max(200, e.clientX), 500);
        setSidebarWidth(newWidth);
    }, [isResizing]);

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
    }, []);

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, handleMouseMove, handleMouseUp]);

    // Fetch fresh file list when component mounts or session changes
    useEffect(() => {
        const fetchFresh = async () => {
            try {
                const response = await fetch(`/api/analysis/${sessionId}`);
                if (response.ok) {
                    const data = await response.json();
                    setFileListData(data.log_files || {});
                } else {
                    setFileListData(analysisData?.log_files || {});
                }
            } catch (error) {
                setFileListData(analysisData?.log_files || {});
            }
        };

        fetchFresh();
    }, [sessionId]);

    // Refresh file list from API
    const refreshFileList = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const response = await fetch(`/api/analysis/${sessionId}`);
            if (response.ok) {
                const data = await response.json();
                setFileListData(data.log_files || {});
            }
        } catch (error) {
            console.error('Error refreshing file list:', error);
        } finally {
            setIsRefreshing(false);
        }
    }, [sessionId]);

    // Build filtered file list
    const fileList = useMemo(() => {
        return Object.entries(fileListData).map(([path, info]) => ({
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
        }).sort((a, b) => a.name.localeCompare(b.name));
    }, [fileListData, fileSearchTerm]);

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

    // Delete file handler
    const handleDeleteFile = useCallback(async (filePath, e) => {
        e.stopPropagation(); // Don't select the file

        if (!confirm(`Delete "${filePath.split('/').pop()}"?`)) {
            return;
        }

        try {
            const response = await fetch(
                `/api/sessions/${sessionId}/files/${encodeURIComponent(filePath)}`,
                { method: 'DELETE' }
            );

            if (!response.ok) {
                throw new Error('Failed to delete');
            }

            // If we deleted the selected file, clear selection
            if (selectedFile === filePath) {
                setSelectedFile(null);
                setFileContent(null);
                setRawLines([]);
            }

            // Refresh file list
            refreshFileList();

        } catch (error) {
            console.error('Delete error:', error);
            alert('Failed to delete file');
        }
    }, [sessionId, selectedFile, refreshFileList]);

    // Load file content
    useEffect(() => {
        if (!selectedFile || !sessionId) return;

        const loadFileContent = async () => {
            setLoading(true);
            setSearchQuery('');
            setVisibleRange({ start: 0, end: 100 });
            jsonCacheRef.current.clear();

            try {
                const response = await fetch(`/api/logs/${sessionId}/${selectedFile}`);
                const data = await response.json();

                setRawLines(data.content || []);
                setFileContent(data);
                analyzeFieldsFromSample(data.content);

            } catch (err) {
                console.error('Error loading file:', err);
            } finally {
                setLoading(false);
            }
        };

        loadFileContent();
    }, [selectedFile, sessionId]);

    // Analyze JSON fields from sample
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
                } catch (e) { }
            }
        }

        Object.keys(fields).forEach(key => {
            fields[key].sampleValues = Array.from(fields[key].sampleValues)
                .slice(0, 20)
                .filter(v => v && v !== 'null' && v !== 'undefined');
        });

        setAvailableFields(fields);

        const jsonRatio = jsonCount / sampleSize;
        if ((jsonRatio > 0.1 && Object.keys(fields).length > 3) || jsonRatio > 0.3) {
            setShowFieldHelper(true);
            setIsJsonFile(true);
        } else {
            setIsJsonFile(false);
        }
    };

    // Parse JSON on-demand with caching
    const parseJsonLine = useCallback((line, index) => {
        if (jsonCacheRef.current.has(index)) {
            return jsonCacheRef.current.get(index);
        }

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

        if (query.includes(' OR ')) {
            const parts = query.split(' OR ');
            return {
                type: 'OR',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        if (query.includes(' AND ')) {
            const parts = query.split(' AND ');
            return {
                type: 'AND',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        if (query.startsWith('NOT ')) {
            return {
                type: 'NOT',
                condition: parseSearchQuery(query.substring(4).trim())
            };
        }

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

        return { type: 'TEXT', value: query };
    };

    // Evaluate query against a line
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
                    return query.type === 'FIELD_NEQ';
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

    // Full search
    const filteredIndices = useMemo(() => {
        if (!rawLines.length) return [];

        const query = parseSearchQuery(debouncedSearchQuery);

        if (!query) {
            const allIndices = rawLines.map((_, index) => index);
            setFilterStats({ total: rawLines.length, filtered: rawLines.length });
            return allIndices;
        }

        const matchingIndices = [];
        for (let i = 0; i < rawLines.length; i++) {
            if (evaluateQuery(query, rawLines[i], i)) {
                matchingIndices.push(i);
            }
        }

        setFilterStats({ total: rawLines.length, filtered: matchingIndices.length });
        return matchingIndices;
    }, [rawLines, debouncedSearchQuery, evaluateQuery]);

    // Reset scroll on filter change
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
        setVisibleRange({ start: 0, end: 100 });
    }, [filteredIndices]);

    // Virtual scrolling
    const handleScroll = useCallback((e) => {
        const scrollTop = e.target.scrollTop;
        const containerHeight = e.target.clientHeight;

        const startIndex = Math.floor(scrollTop / rowHeight) - overscan;
        const endIndex = Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan;

        setVisibleRange({
            start: Math.max(0, startIndex),
            end: Math.min(filteredIndices.length, endIndex)
        });
    }, [filteredIndices.length, rowHeight, overscan]);

    // Get visible lines
    const visibleLines = useMemo(() => {
        return filteredIndices
            .slice(visibleRange.start, visibleRange.end)
            .map(index => ({
                line: rawLines[index],
                originalIndex: index
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
            examples.push('severity:error');
        }
        if (availableFields.status) {
            examples.push('status:>=500');
        }
        if (availableFields.method) {
            examples.push('method:POST');
        }
        if (availableFields.duration_s) {
            examples.push('duration_s:>1');
        }
        examples.push('error');
        examples.push('NOT debug');
        return examples.slice(0, 4);
    };

    return (
        <div className="h-full flex" style={{ background: 'var(--bg-primary)' }}>
            {/* Left sidebar - File list */}
            <div className="flex flex-col" style={{
                width: `${sidebarWidth}px`,
                background: 'var(--bg-secondary)',
                borderRight: '1px solid var(--border-primary)'
            }}>
                <div className="p-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            Files ({fileList.length})
                        </span>
                        <div className="flex items-center gap-1.5">
                            <AddFilesButton
                                sessionId={sessionId}
                                onFilesAdded={refreshFileList}
                            />
                            <button
                                onClick={refreshFileList}
                                disabled={isRefreshing}
                                className="p-1.5 rounded-lg smooth-transition disabled:opacity-50"
                                style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-primary)'
                                }}
                                title="Refresh"
                            >
                                <RefreshCw
                                    className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                                    style={{ color: 'var(--text-secondary)' }}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5"
                            style={{ color: 'var(--text-tertiary)' }} />
                        <input
                            type="text"
                            placeholder="Filter files..."
                            value={fileSearchTerm}
                            onChange={(e) => setFileSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 rounded-lg text-sm focus:outline-none"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)'
                            }}
                        />
                        {fileSearchTerm && (
                            <button
                                onClick={() => setFileSearchTerm('')}
                                className="absolute right-2 top-1/2 transform -translate-y-1/2"
                            >
                                <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {fileList.length > 0 ? (
                        fileList.map((file) => (
                            <div
                                key={file.path}
                                className={`group px-3 py-1 cursor-pointer text-sm flex items-center smooth-transition ${selectedFile === file.path ? 'btn-primary rounded-full' : ''}`}
                                style={{
                                    background: selectedFile === file.path ? 'var(--accent)' : 'transparent',
                                    color: selectedFile === file.path ? 'var(--bg-primary)' : 'var(--text-primary)',
                                }}
                                onClick={() => {
                                    setSelectedFile(file.path);
                                    setCurrentLine(1);
                                }}
                                onMouseEnter={(e) => selectedFile !== file.path && (e.currentTarget.style.background = 'var(--hover-bg)')}
                                onMouseLeave={(e) => selectedFile !== file.path && (e.currentTarget.style.background = 'transparent')}
                                title={file.path}
                            >
                                <FileText className="w-4 h-4 mr-3 flex-shrink-0" />
                                <span className="flex-1 truncate">{file.name}</span>
                                <button
                                    onClick={(e) => handleDeleteFile(file.path, e)}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-opacity"
                                    title="Remove file"
                                >
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
                            <p className="text-sm">
                                {fileSearchTerm ? 'No matches' : 'No files'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Resize handle */}
            <div
                className="w-1 cursor-col-resize hover:bg-blue-500 active:bg-blue-500 transition-colors"
                style={{ background: isResizing ? 'var(--accent)' : 'transparent' }}
                onMouseDown={() => setIsResizing(true)}
            />

            {/* Main content area */}
            <div className="flex-1 flex flex-col">
                {selectedFile ? (
                    <>
                        {/* Header */}
                        <div className="p-3" style={{
                            background: 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border-primary)'
                        }}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="min-w-0 flex-1">
                                    <h2 className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                        {selectedFile.split('/').pop()}
                                    </h2>
                                </div>
                                <div className="flex items-center gap-3 ml-4">
                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        {filterStats.filtered !== filterStats.total && (
                                            <span style={{ color: '#f59e0b' }}>
                                                {filterStats.filtered.toLocaleString()} /
                                            </span>
                                        )}
                                        {' '}{filterStats.total.toLocaleString()} lines
                                    </span>
                                    <button
                                        onClick={() => {
                                            window.open(`/api/logs/${sessionId}/${selectedFile}/download`, '_blank');
                                        }}
                                        className="p-1.5 rounded-lg smooth-transition"
                                        style={{ color: 'var(--text-secondary)' }}
                                        title="Download"
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Search */}
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4"
                                        style={{ color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="text"
                                        placeholder={isJsonFile ? "field:value AND/OR/NOT" : "Search..."}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 rounded-lg text-sm focus:outline-none"
                                        style={{
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-primary)',
                                            color: 'var(--text-primary)',
                                            fontFamily: 'monospace'
                                        }}
                                    />
                                </div>
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="px-3 py-1.5 rounded-lg text-sm"
                                        style={{
                                            background: 'var(--bg-tertiary)',
                                            color: 'var(--text-secondary)'
                                        }}
                                    >
                                        Clear
                                    </button>
                                )}
                                {Object.keys(availableFields).length > 0 && (
                                    <button
                                        onClick={() => setShowFieldHelper(!showFieldHelper)}
                                        className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5"
                                        style={{
                                            background: showFieldHelper ? 'var(--accent)' : 'var(--bg-tertiary)',
                                            color: showFieldHelper ? 'var(--bg-primary)' : 'var(--text-secondary)'
                                        }}
                                    >
                                        <Filter className="w-3.5 h-3.5" />
                                        Fields
                                    </button>
                                )}
                            </div>

                            {/* Quick filters */}
                            {!searchQuery && isJsonFile && (
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Try:</span>
                                    {getExampleQueries().map((q, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setSearchQuery(q)}
                                            className="text-xs px-2 py-0.5 rounded"
                                            style={{
                                                background: 'var(--bg-tertiary)',
                                                color: 'var(--text-secondary)',
                                                fontFamily: 'monospace'
                                            }}
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Field helper */}
                            {showFieldHelper && Object.keys(availableFields).length > 0 && (
                                <div className="mt-2 p-2 rounded-lg text-xs overflow-y-auto" style={{
                                    background: 'var(--bg-tertiary)',
                                    maxHeight: '150px'
                                }}>
                                    <div className="grid grid-cols-3 gap-2">
                                        {Object.entries(availableFields)
                                            .sort((a, b) => b[1].count - a[1].count)
                                            .slice(0, 15)
                                            .map(([field, info]) => (
                                                <div key={field}>
                                                    <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                                                        {field}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {info.sampleValues.slice(0, 2).map((value, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => insertFieldFilter(field, value)}
                                                                className="px-1 py-0.5 rounded truncate max-w-[80px]"
                                                                style={{
                                                                    background: 'var(--bg-primary)',
                                                                    color: 'var(--text-primary)',
                                                                    fontFamily: 'monospace'
                                                                }}
                                                            >
                                                                {value}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Log viewer */}
                        <div className="flex-1 overflow-hidden font-mono text-xs" style={{ background: 'var(--bg-primary)' }}>
                            {loading ? (
                                <div className="flex items-center justify-center h-full">
                                    <div className="animate-spin w-6 h-6 border-2 border-current border-t-transparent rounded-full"
                                        style={{ borderColor: 'var(--text-tertiary)' }} />
                                </div>
                            ) : filteredIndices.length === 0 && searchQuery ? (
                                <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
                                    <Search className="w-10 h-10 mb-3 opacity-50" />
                                    <p>No matches for "{searchQuery}"</p>
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="mt-3 px-4 py-1.5 text-sm rounded-lg"
                                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                                    >
                                        Clear
                                    </button>
                                </div>
                            ) : (
                                <div
                                    ref={scrollContainerRef}
                                    className="h-full overflow-y-auto"
                                    onScroll={handleScroll}
                                >
                                    <div style={{
                                        height: `${filteredIndices.length * rowHeight}px`,
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            transform: `translateY(${visibleRange.start * rowHeight}px)`,
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0
                                        }}>
                                            {visibleLines.map((item, idx) => {
                                                const lineNum = item.originalIndex + 1;
                                                const level = getLogLevel(item.line);
                                                const color = level === 'error' ? '#ef4444' :
                                                    level === 'warning' ? '#f59e0b' :
                                                        level === 'info' ? '#3b82f6' :
                                                            level === 'debug' ? '#6b7280' : 'var(--text-primary)';

                                                return (
                                                    <div
                                                        key={`${lineNum}-${idx}`}
                                                        className="flex hover:bg-gray-500/10 py-1"
                                                        style={{ minHeight: `${rowHeight}px` }}
                                                    >
                                                        <span
                                                            className="w-16 flex-shrink-0 select-none text-right pr-3 pt-0.5"
                                                            style={{
                                                                color: 'var(--text-tertiary)',
                                                                borderRight: '1px solid var(--border-primary)'
                                                            }}
                                                        >
                                                            {lineNum}
                                                        </span>
                                                        <pre
                                                            className="flex-1 px-3 whitespace-pre-wrap break-all"
                                                            style={{ color, overflowWrap: 'anywhere', fontSize: '0.75rem' }}
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
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
                        <div className="text-center">
                            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Select a file to view</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnhancedLogViewer;