// ENHANCED: Professional Log Timeline Histogram
const LogHistogram = React.memo(({ results, timeField = 'time', onTimeRangeSelect }) => {
    const [hoveredBucket, setHoveredBucket] = useState(null);
    const [selection, setSelection] = useState(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState(null);
    const containerRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 140 });

    // Responsive sizing
    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDimensions({ width: rect.width, height: 140 });
            }
        };
        
        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // Process results into time buckets with severity breakdown
    const { histogramData, timeRange, maxCount, spikes } = useMemo(() => {
        if (!results || results.length === 0) {
            return { histogramData: [], timeRange: null, maxCount: 0, spikes: [] };
        }

        const timeFields = [timeField, 'timestamp', 'time', '@timestamp', 'created_at'];
        const dataPoints = [];

        results.forEach((r, index) => {
            const parsed = r.match_details?.parsed_fields || {};
            let timestamp = null;

            // Try each time field
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

            // Fallback: extract from content
            if (!timestamp && typeof r.content === 'string') {
                const patterns = [
                    /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
                    /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
                ];
                for (const pattern of patterns) {
                    const match = r.content.match(pattern);
                    if (match) {
                        const time = new Date(match[1]).getTime();
                        if (!isNaN(time) && time > 0) {
                            timestamp = time;
                            break;
                        }
                    }
                }
            }

            if (timestamp) {
                // Determine severity
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

                dataPoints.push({ time: timestamp, severity, index });
            }
        });

        if (dataPoints.length === 0) {
            return { histogramData: [], timeRange: null, maxCount: 0, spikes: [] };
        }

        // Calculate time range
        const times = dataPoints.map(d => d.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const range = maxTime - minTime;

        // Determine bucket count based on width (roughly 4px per bucket minimum)
        const bucketCount = Math.min(
            Math.max(20, Math.floor(dimensions.width / 6)),
            Math.min(200, dataPoints.length)
        );
        
        const bucketSize = range / bucketCount || 1;

        // Create buckets
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

        // Fill buckets
        dataPoints.forEach(({ time, severity }) => {
            const bucketIndex = Math.min(
                Math.floor((time - minTime) / bucketSize),
                bucketCount - 1
            );
            
            if (buckets[bucketIndex]) {
                buckets[bucketIndex].total++;
                buckets[bucketIndex][severity === 'error' ? 'errors' : severity === 'warning' ? 'warnings' : 'info']++;
            }
        });

        // Calculate max for scaling
        const max = Math.max(...buckets.map(b => b.total), 1);

        // Detect spikes (buckets with significantly higher counts)
        const avgCount = buckets.reduce((sum, b) => sum + b.total, 0) / buckets.length;
        const stdDev = Math.sqrt(
            buckets.reduce((sum, b) => sum + Math.pow(b.total - avgCount, 2), 0) / buckets.length
        );
        
        const detectedSpikes = buckets
            .map((b, i) => ({ ...b, index: i }))
            .filter(b => b.total > avgCount + (2 * stdDev) && b.total > 5)
            .slice(0, 3); // Top 3 spikes

        return {
            histogramData: buckets,
            timeRange: { min: minTime, max: maxTime, range },
            maxCount: max,
            spikes: detectedSpikes
        };
    }, [results, timeField, dimensions.width]);

    // Format time based on range
    const formatTime = useCallback((timestamp) => {
        if (!timeRange) return '';
        const date = new Date(timestamp);
        
        const rangeMins = timeRange.range / (1000 * 60);
        
        if (rangeMins < 60) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else if (rangeMins < 1440) { // < 24 hours
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
    }, [timeRange]);

    // Mouse handlers for brush selection
    const handleMouseDown = useCallback((e) => {
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        
        setIsSelecting(true);
        setSelectionStart(percentage);
        setSelection({ start: percentage, end: percentage });
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percentage = x / rect.width;
        
        // Update hovered bucket
        const bucketIndex = Math.floor(percentage * histogramData.length);
        setHoveredBucket(bucketIndex >= 0 && bucketIndex < histogramData.length ? bucketIndex : null);
        
        // Update selection if selecting
        if (isSelecting && selectionStart !== null) {
            setSelection({
                start: Math.min(selectionStart, percentage),
                end: Math.max(selectionStart, percentage)
            });
        }
    }, [isSelecting, selectionStart, histogramData.length]);

    const handleMouseUp = useCallback(() => {
        if (isSelecting && selection && timeRange && onTimeRangeSelect) {
            const startTime = timeRange.min + (selection.start * timeRange.range);
            const endTime = timeRange.min + (selection.end * timeRange.range);
            
            // Only trigger if meaningful selection (> 2% of width)
            if (selection.end - selection.start > 0.02) {
                onTimeRangeSelect({ start: startTime, end: endTime });
            }
        }
        
        setIsSelecting(false);
        setSelectionStart(null);
        // Keep selection visible after release
    }, [isSelecting, selection, timeRange, onTimeRangeSelect]);

    const clearSelection = useCallback(() => {
        setSelection(null);
        if (onTimeRangeSelect) {
            onTimeRangeSelect(null);
        }
    }, [onTimeRangeSelect]);

    // Mouse leave handler
    const handleMouseLeave = useCallback(() => {
        setHoveredBucket(null);
        if (isSelecting) {
            setIsSelecting(false);
            setSelectionStart(null);
        }
    }, [isSelecting]);

    // Global mouseup listener
    useEffect(() => {
        if (isSelecting) {
            const handleGlobalMouseUp = () => handleMouseUp();
            document.addEventListener('mouseup', handleGlobalMouseUp);
            return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
        }
    }, [isSelecting, handleMouseUp]);

    if (histogramData.length === 0) {
        return (
            <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No timestamp data available</div>
                <div className="text-xs mt-1 opacity-75">Logs may not contain parseable timestamps</div>
            </div>
        );
    }

    const chartHeight = 100;
    const chartPadding = { top: 10, bottom: 30, left: 0, right: 0 };

    return (
        <div className="select-none">
            {/* Header with legend and selection info */}
            <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(239, 68, 68, 0.8)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(245, 158, 11, 0.8)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Warnings</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(99, 102, 241, 0.6)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Info</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-3 text-xs">
                    {selection && (
                        <button
                            onClick={clearSelection}
                            className="flex items-center gap-1 px-2 py-1 rounded transition-colors"
                            style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}
                        >
                            <X className="w-3 h-3" />
                            Clear selection
                        </button>
                    )}
                    <span style={{ color: 'var(--text-tertiary)' }}>
                        {formatTime(timeRange.min)} — {formatTime(timeRange.max)}
                    </span>
                </div>
            </div>

            {/* Main Chart */}
            <div
                ref={containerRef}
                className="relative cursor-crosshair"
                style={{ height: chartHeight + chartPadding.top + chartPadding.bottom }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            >
                {/* SVG Chart */}
                <svg
                    width="100%"
                    height={chartHeight + chartPadding.top + chartPadding.bottom}
                    style={{ overflow: 'visible' }}
                >
                    <defs>
                        {/* Gradients for smooth look */}
                        <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(239, 68, 68, 0.9)" />
                            <stop offset="100%" stopColor="rgba(239, 68, 68, 0.3)" />
                        </linearGradient>
                        <linearGradient id="warningGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.9)" />
                            <stop offset="100%" stopColor="rgba(245, 158, 11, 0.3)" />
                        </linearGradient>
                        <linearGradient id="infoGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(99, 102, 241, 0.7)" />
                            <stop offset="100%" stopColor="rgba(99, 102, 241, 0.2)" />
                        </linearGradient>
                        
                        {/* Glow filter for spikes */}
                        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Grid lines */}
                    <g opacity="0.1">
                        {[0.25, 0.5, 0.75].map(ratio => (
                            <line
                                key={ratio}
                                x1="0"
                                y1={chartPadding.top + chartHeight * (1 - ratio)}
                                x2="100%"
                                y2={chartPadding.top + chartHeight * (1 - ratio)}
                                stroke="currentColor"
                                strokeDasharray="4,4"
                            />
                        ))}
                    </g>

                    {/* Stacked area chart */}
                    <g transform={`translate(0, ${chartPadding.top})`}>
                        {/* Info layer (bottom) */}
                        <path
                            d={generateAreaPath(histogramData, 'info', dimensions.width, chartHeight, maxCount)}
                            fill="url(#infoGradient)"
                            style={{ transition: 'd 0.3s ease' }}
                        />
                        
                        {/* Warning layer (middle) */}
                        <path
                            d={generateAreaPath(histogramData, 'warnings', dimensions.width, chartHeight, maxCount, true)}
                            fill="url(#warningGradient)"
                            style={{ transition: 'd 0.3s ease' }}
                        />
                        
                        {/* Error layer (top) */}
                        <path
                            d={generateAreaPath(histogramData, 'errors', dimensions.width, chartHeight, maxCount, true, true)}
                            fill="url(#errorGradient)"
                            style={{ transition: 'd 0.3s ease' }}
                        />

                        {/* Top line for definition */}
                        <path
                            d={generateLinePath(histogramData, dimensions.width, chartHeight, maxCount)}
                            fill="none"
                            stroke="rgba(99, 102, 241, 0.5)"
                            strokeWidth="1.5"
                            style={{ transition: 'd 0.3s ease' }}
                        />
                    </g>

                    {/* Spike markers */}
                    {spikes.map((spike, i) => {
                        const x = (spike.index / histogramData.length) * dimensions.width + (dimensions.width / histogramData.length / 2);
                        return (
                            <g key={i} transform={`translate(${x}, ${chartPadding.top - 5})`}>
                                <circle
                                    r="4"
                                    fill="#ef4444"
                                    filter="url(#glow)"
                                    style={{ animation: 'pulse 2s infinite' }}
                                />
                                <title>Spike: {spike.total} events ({spike.errors} errors)</title>
                            </g>
                        );
                    })}

                    {/* Hover indicator line */}
                    {hoveredBucket !== null && (
                        <line
                            x1={(hoveredBucket / histogramData.length) * dimensions.width + (dimensions.width / histogramData.length / 2)}
                            y1={chartPadding.top}
                            x2={(hoveredBucket / histogramData.length) * dimensions.width + (dimensions.width / histogramData.length / 2)}
                            y2={chartPadding.top + chartHeight}
                            stroke="var(--text-primary)"
                            strokeWidth="1"
                            strokeDasharray="4,2"
                            opacity="0.5"
                        />
                    )}

                    {/* Selection overlay */}
                    {selection && (
                        <rect
                            x={selection.start * dimensions.width}
                            y={chartPadding.top}
                            width={(selection.end - selection.start) * dimensions.width}
                            height={chartHeight}
                            fill="var(--accent)"
                            opacity="0.2"
                            style={{ pointerEvents: 'none' }}
                        />
                    )}

                    {/* Time axis */}
                    <g transform={`translate(0, ${chartPadding.top + chartHeight + 8})`}>
                        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
                            const x = ratio * dimensions.width;
                            const time = timeRange.min + (ratio * timeRange.range);
                            return (
                                <text
                                    key={ratio}
                                    x={x}
                                    y="0"
                                    textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'}
                                    fontSize="10"
                                    fill="var(--text-tertiary)"
                                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                                >
                                    {formatTime(time)}
                                </text>
                            );
                        })}
                    </g>
                </svg>

                {/* Hover tooltip */}
                {hoveredBucket !== null && histogramData[hoveredBucket] && (
                    <div
                        className="absolute z-20 pointer-events-none"
                        style={{
                            left: Math.min(
                                (hoveredBucket / histogramData.length) * dimensions.width,
                                dimensions.width - 160
                            ),
                            top: 0,
                            transform: 'translateX(-50%)'
                        }}
                    >
                        <div
                            className="px-3 py-2 rounded-lg shadow-lg text-xs"
                            style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)',
                                backdropFilter: 'blur(8px)'
                            }}
                        >
                            <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                                {formatTime(histogramData[hoveredBucket].start)}
                            </div>
                            <div className="space-y-0.5">
                                <div className="flex items-center justify-between gap-4">
                                    <span style={{ color: 'var(--text-secondary)' }}>Total</span>
                                    <span className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {histogramData[hoveredBucket].total.toLocaleString()}
                                    </span>
                                </div>
                                {histogramData[hoveredBucket].errors > 0 && (
                                    <div className="flex items-center justify-between gap-4">
                                        <span style={{ color: '#ef4444' }}>Errors</span>
                                        <span className="font-mono" style={{ color: '#ef4444' }}>
                                            {histogramData[hoveredBucket].errors.toLocaleString()}
                                        </span>
                                    </div>
                                )}
                                {histogramData[hoveredBucket].warnings > 0 && (
                                    <div className="flex items-center justify-between gap-4">
                                        <span style={{ color: '#f59e0b' }}>Warnings</span>
                                        <span className="font-mono" style={{ color: '#f59e0b' }}>
                                            {histogramData[hoveredBucket].warnings.toLocaleString()}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Drag hint */}
            <div className="text-center mt-1">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Drag to select time range
                </span>
            </div>
        </div>
    );
});

// Helper: Generate smooth area path
function generateAreaPath(data, field, width, height, maxCount, stacked = false, topOnly = false) {
    if (data.length === 0) return '';
    
    const bucketWidth = width / data.length;
    const points = [];
    
    data.forEach((bucket, i) => {
        const x = i * bucketWidth + bucketWidth / 2;
        let value = bucket[field];
        
        // For stacked, add lower layers
        if (stacked && !topOnly) {
            value += bucket.info;
        }
        if (topOnly) {
            value += bucket.info + bucket.warnings;
        }
        
        const y = height - (value / maxCount) * height;
        points.push({ x, y });
    });
    
    // Create smooth curve using cardinal spline
    const path = smoothPath(points);
    
    // Close the path for area fill
    return `${path} L ${width} ${height} L 0 ${height} Z`;
}

// Helper: Generate line path for top edge
function generateLinePath(data, width, height, maxCount) {
    if (data.length === 0) return '';
    
    const bucketWidth = width / data.length;
    const points = data.map((bucket, i) => ({
        x: i * bucketWidth + bucketWidth / 2,
        y: height - (bucket.total / maxCount) * height
    }));
    
    return smoothPath(points);
}

// Helper: Create smooth cardinal spline path
function smoothPath(points) {
    if (points.length < 2) return '';
    
    const tension = 0.3;
    let path = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;
        
        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    
    return path;
}
