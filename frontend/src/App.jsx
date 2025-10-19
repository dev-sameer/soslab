import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
    Search, Upload, FileText, AlertCircle, CheckCircle, Trash2,
    Download, Filter, ChevronRight, ChevronDown, Activity, Package,
    AlertTriangle, BarChart3, Clock, TrendingUp, Zap, Eye,
    ChevronLeft, ChevronUp, X, Maximize2, Minimize2, Plus, Server,
    Sparkles, Bot, Layers, Hash, Info, MessageCircle, Sun, Moon
} from 'lucide-react';
import PowerSearch from './components/PowerSearch';
import DuoChatWidget from './components/DuoChatWidget';
import FastStatsDashboard from './components/FastStatsDashboard';
import AutoAnalysis from './components/AutoAnalysis';
import SystemMetrics from './components/SystemMetrics';
import EnhancedLogViewer from './components/EnhancedLogViewer';





// Theme Context
const ThemeContext = React.createContext();

// Add custom styles for monochrome theme
const injectCustomStyles = () => {
    if (typeof document !== 'undefined' && !document.getElementById('monochrome-styles')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'monochrome-styles';
        styleSheet.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            
            * {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            }
            
            /* Theme colors */
            :root {
                --bg-primary: #ffffff;
                --bg-secondary: #f9fafb;
                --bg-tertiary: #f3f4f6;
                --text-primary: #111827;
                --text-secondary: #4b5563;
                --text-tertiary: #6b7280;
                --border-primary: #e5e7eb;
                --border-secondary: #d1d5db;
                --hover-bg: #f3f4f6;
                --accent: #111827;
            }
            
            [data-theme="dark"] {
                --bg-primary: #000000;
                --bg-secondary: #0a0a0a;
                --bg-tertiary: #141414;
                --text-primary: #ffffff;
                --text-secondary: #a1a1aa;
                --text-tertiary: #71717a;
                --border-primary: #27272a;
                --border-secondary: #3f3f46;
                --hover-bg: #18181b;
                --accent: #ffffff;
            }
            
            /* Scrollbar */
            ::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }
            
            ::-webkit-scrollbar-track {
                background: var(--bg-secondary);
            }
            
            ::-webkit-scrollbar-thumb {
                background: var(--text-tertiary);
                border-radius: 5px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: var(--text-secondary);
            }
            
            /* Thin scrollbar for tabs */
            .scrollbar-thin::-webkit-scrollbar {
                height: 6px;
            }
            
            /* Firefox scrollbar */
            .scrollbar-thin {
                scrollbar-width: thin;
            }
            
            /* Smooth transitions */
            .smooth-transition {
                transition: all 0.2s ease;
            }
            
            /* Monochrome buttons */
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
            
            /* Collapsible JSON */
            .json-collapsible {
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                font-size: 0.875rem;
                line-height: 1.5;
            }
            
            .json-key {
                color: var(--text-secondary);
            }
            
            .json-string {
                color: var(--text-primary);
            }
            
            .json-number {
                color: var(--text-primary);
            }
            
            .json-boolean {
                color: var(--text-primary);
                font-style: italic;
            }
            
            .json-null {
                color: var(--text-tertiary);
                font-style: italic;
            }
            
            /* Minimalist shadows */
            .shadow-minimal {
                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            }
            
            .shadow-minimal-lg {
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            }
        `;
        document.head.appendChild(styleSheet);
    }
};

// Call it immediately
injectCustomStyles();




// Theme Provider Component
const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('sos-theme');
        return saved || 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('sos-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

// Use theme hook
const useTheme = () => {
    const context = React.useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
};

// Enhanced Search Component with Monochrome Theme
const EnhancedSearch = ({ sessionId, onNavigateToLog }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchType, setSearchType] = useState('semantic');
    const [filters, setFilters] = useState({
        severity: 'all',
        service: 'all',
        timeRange: 'all'
    });

    const handleSearch = async () => {
        if (!query.trim()) return;
        
        setLoading(true);
        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    session_id: sessionId,
                    search_type: searchType,
                    filters,
                    limit: 100
                })
            });
            const data = await response.json();
            setResults(data);
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleResultClick = (result) => {
        onNavigateToLog(result.file, result.line_number);
    };

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            <div className="p-6" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                        <Sparkles className="w-6 h-6" style={{ color: 'var(--bg-primary)' }} />
                    </div>
                    Smart Log Search
                </h2>
                
                <div className="flex gap-3 mb-4">
                    {['semantic', 'exact', 'regex'].map((type) => (
                        <button
                            key={type}
                            onClick={() => setSearchType(type)}
                            className={`px-5 py-2.5 rounded-xl text-sm font-semibold smooth-transition ${
                                searchType === type ? 'btn-primary' : 'btn-secondary'
                            }`}
                        >
                            {type === 'semantic' && <Zap className="w-4 h-4 inline mr-2" />}
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="flex gap-3 mb-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
                        <input
                            type="text"
                            placeholder={
                                searchType === 'semantic' 
                                    ? "Search for concepts (e.g., 'authentication errors', 'database timeouts')"
                                    : searchType === 'regex'
                                    ? "Enter regex pattern..."
                                    : "Enter exact text to search..."
                            }
                            className="w-full pl-12 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-current smooth-transition"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)'
                            }}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="px-8 py-3 rounded-xl font-semibold smooth-transition btn-primary disabled:opacity-50"
                    >
                        {loading ? (
                            <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                        ) : (
                            'Search'
                        )}
                    </button>
                </div>

                <div className="flex gap-4">
                    {['severity', 'service', 'timeRange'].map((filterType) => (
                        <select
                            key={filterType}
                            value={filters[filterType]}
                            onChange={(e) => setFilters({...filters, [filterType]: e.target.value})}
                            className="px-4 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-current"
                            style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-primary)'
                            }}
                        >
                            <option value="all">All {filterType === 'timeRange' ? 'Time' : filterType.charAt(0).toUpperCase() + filterType.slice(1) + 's'}</option>
                            {filterType === 'severity' && (
                                <>
                                    <option value="critical">Critical</option>
                                    <option value="error">Error</option>
                                    <option value="warning">Warning</option>
                                    <option value="info">Info</option>
                                </>
                            )}
                            {filterType === 'service' && (
                                <>
                                    <option value="gitlab-rails">GitLab Rails</option>
                                    <option value="sidekiq">Sidekiq</option>
                                    <option value="gitaly">Gitaly</option>
                                    <option value="nginx">Nginx</option>
                                </>
                            )}
                            {filterType === 'timeRange' && (
                                <>
                                    <option value="1h">Last Hour</option>
                                    <option value="24h">Last 24 Hours</option>
                                    <option value="7d">Last 7 Days</option>
                                </>
                            )}
                        </select>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
                <div className="space-y-3">
                    {results.map((result, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleResultClick(result)}
                            className="p-5 rounded-xl shadow-minimal hover:shadow-minimal-lg smooth-transition cursor-pointer"
                            style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <span className={`px-3 py-1 text-xs rounded-full font-semibold ${
                                        result.metadata?.severity === 'error' ? 'bg-red-500 text-white' :
                                        result.metadata?.severity === 'warning' ? 'bg-yellow-500 text-black' :
                                        'bg-gray-500 text-white'
                                    }`}>
                                        {result.metadata?.severity || 'info'}
                                    </span>
                                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{result.file}</span>
                                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Line {result.line_number}</span>
                                </div>
                                <Eye className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                            </div>
                            <code className="font-mono text-sm break-all line-clamp-2 p-3 rounded-lg" 
                                style={{ 
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)'
                                }}>
                                {result.content}
                            </code>
                        </div>
                    ))}
                </div>

                {results.length === 0 && !loading && query && (
                    <div className="text-center py-12">
                        <Search className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                        <p style={{ color: 'var(--text-secondary)' }}>No results found</p>
                        {searchType === 'semantic' && (
                            <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
                                Try different keywords or switch to exact match
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const InteractiveAnalysis = ({ data, onNavigateToLog }) => {
    const [selectedTab, setSelectedTab] = useState('overview');
    const [selectedPattern, setSelectedPattern] = useState(null);
    
    // Detect if this is a KubeSOS archive
    const isKubeSOS = data?.type === 'kubesos';

    const handlePatternClick = (pattern) => {
        setSelectedPattern(pattern);
    };

    const handleAnomalyClick = (anomaly) => {
        onNavigateToLog(anomaly.file, anomaly.line_number);
    };

    return (
        <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
            <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                <nav className="flex px-6">
                    {['overview', 'patterns', isKubeSOS ? 'events' : 'anomalies', 'timeline', 'insights'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setSelectedTab(tab)}
                            className={`px-6 py-4 text-sm font-semibold border-b-3 capitalize smooth-transition ${
                                selectedTab === tab
                                    ? 'border-current'
                                    : 'border-transparent hover:border-gray-300'
                            }`}
                            style={{
                                color: selectedTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                                borderBottomWidth: '3px'
                            }}
                        >
                            {tab}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="flex-1 overflow-y-auto">
                {selectedTab === 'overview' && (
                    <div className="p-6 space-y-6">
                        {isKubeSOS && data.kubernetes_info && (
                            <div className="p-4 rounded-xl" style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                    Kubernetes Deployment Info
                                </h3>
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                    {data.kubernetes_info.release && (
                                        <div>
                                            <span style={{ color: 'var(--text-secondary)' }}>Release:</span>
                                            <span className="ml-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {data.kubernetes_info.release}
                                            </span>
                                        </div>
                                    )}
                                    {data.kubernetes_info.namespace && (
                                        <div>
                                            <span style={{ color: 'var(--text-secondary)' }}>Namespace:</span>
                                            <span className="ml-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {data.kubernetes_info.namespace}
                                            </span>
                                        </div>
                                    )}
                                    {data.kubernetes_info.total_pods && (
                                        <div>
                                            <span style={{ color: 'var(--text-secondary)' }}>Total Pods:</span>
                                            <span className="ml-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {data.kubernetes_info.total_pods}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-4 gap-4">
                            {[
                                {
                                    icon: AlertCircle,
                                    value: isKubeSOS 
                                        ? data?.events?.filter(e => e.severity === 'error').length || 0
                                        : Object.values(data?.patterns || {}).filter(p => p.severity === 'error').reduce((sum, p) => sum + p.count, 0),
                                    label: isKubeSOS ? 'Error Events' : 'Total Errors',
                                    sublabel: isKubeSOS 
                                        ? 'Kubernetes error events'
                                        : `Across ${Object.values(data?.patterns || {}).filter(p => p.severity === 'error').length} patterns`,
                                    color: '#ef4444'
                                },
                                {
                                    icon: AlertTriangle,
                                    value: data?.anomalies?.length || 0,
                                    label: 'Anomalies',
                                    sublabel: 'Unusual patterns detected',
                                    color: '#f59e0b'
                                },
                                {
                                    icon: TrendingUp,
                                    value: Object.keys(data?.patterns || {}).length,
                                    label: 'Unique Patterns',
                                    sublabel: 'Grouped by similarity',
                                    color: '#10b981'
                                },
                                {
                                    icon: Activity,
                                    value: `${((data?.total_lines || 0) / 1000).toFixed(1)}k`,
                                    label: 'Log Lines',
                                    sublabel: 'Total processed',
                                    color: '#3b82f6'
                                }
                            ].map((stat, idx) => (
                                <div
                                    key={idx}
                                    className="p-6 rounded-xl shadow-minimal smooth-transition"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)'
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
                                            <stat.icon className="w-6 h-6" style={{ color: stat.color }} />
                                        </div>
                                        <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                            {stat.value}
                                        </span>
                                    </div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{stat.label}</p>
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{stat.sublabel}</p>
                                </div>
                            ))}
                        </div>

                        <div className="p-6 rounded-xl shadow-minimal" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Top Issues</h3>
                            <div className="space-y-3">
                                {Object.values(data?.patterns || {})
                                    .filter(p => p.severity === 'error' || p.severity === 'critical')
                                    .sort((a, b) => b.count - a.count)
                                    .slice(0, 5)
                                    .map((pattern, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handlePatternClick(pattern)}
                                            className="flex items-center justify-between p-4 rounded-xl cursor-pointer smooth-transition"
                                            style={{
                                                background: 'var(--bg-tertiary)',
                                                border: '1px solid var(--border-primary)'
                                            }}
                                        >
                                            <div className="flex-1">
                                                <code className="text-sm font-mono text-red-500 line-clamp-1">
                                                    {pattern.template}
                                                </code>
                                                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                                    {pattern.count} occurrences in {pattern.files?.length || 1} files
                                                </p>
                                            </div>
                                            <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'patterns' && (
                    <div className="p-6">
                        <div className="rounded-xl shadow-minimal" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <div className="p-6" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Log Patterns Analysis</h3>
                                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    Click any pattern to see all occurrences
                                </p>
                            </div>
                            <div className="max-h-[600px] overflow-y-auto">
                                {Object.values(data?.patterns || {})
                                    .sort((a, b) => b.count - a.count)
                                    .map((pattern, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handlePatternClick(pattern)}
                                            className="p-5 cursor-pointer smooth-transition"
                                            style={{
                                                borderBottom: '1px solid var(--border-primary)',
                                                ':hover': { background: 'var(--hover-bg)' }
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-bg)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <span className={`px-3 py-1 text-xs rounded-full font-semibold ${
                                                            pattern.severity === 'error' ? 'bg-red-500 text-white' :
                                                            pattern.severity === 'warning' ? 'bg-yellow-500 text-black' :
                                                            pattern.severity === 'info' ? 'bg-blue-500 text-white' :
                                                            'bg-gray-500 text-white'
                                                        }`}>
                                                            {pattern.severity}
                                                        </span>
                                                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                                            {pattern.count} times ({(pattern.count / data.total_lines * 100).toFixed(2)}%)
                                                        </span>
                                                    </div>
                                                    <code className="text-sm font-mono break-all" style={{ color: 'var(--text-primary)' }}>
                                                        {pattern.template}
                                                    </code>
                                                </div>
                                                <ChevronRight className="w-5 h-5 ml-4" style={{ color: 'var(--text-tertiary)' }} />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'events' && isKubeSOS && (
                    <div className="p-6">
                        <div className="rounded-xl shadow-minimal" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <div className="p-6" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Kubernetes Events</h3>
                                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    Cluster events from the Kubernetes API
                                </p>
                            </div>
                            <div className="max-h-[600px] overflow-y-auto">
                                {(data?.events || []).map((event, idx) => (
                                    <div
                                        key={idx}
                                        className="p-5 cursor-pointer smooth-transition"
                                        style={{
                                            borderBottom: '1px solid var(--border-primary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-bg)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className={`px-3 py-1 text-xs rounded-full font-semibold ${
                                                    event.severity === 'error' ? 'bg-red-500 text-white' :
                                                    event.severity === 'warning' ? 'bg-yellow-500 text-black' :
                                                    'bg-gray-500 text-white'
                                                }`}>
                                                    {event.type || event.severity}
                                                </span>
                                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {event.reason}
                                                </span>
                                                {event.count && (
                                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                        Count: {event.count}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                {event.last_seen}
                                            </span>
                                        </div>
                                        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                            {event.object_name}
                                        </div>
                                        <div className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
                                            {event.message}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'anomalies' && !isKubeSOS && (
                    <div className="p-6">
                        <div className="rounded-xl shadow-minimal" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <div className="p-6" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Detected Anomalies</h3>
                                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    Unusual log entries that deviate from normal patterns
                                </p>
                            </div>
                            <div className="max-h-[600px] overflow-y-auto">
                                {(data?.anomalies || []).map((anomaly, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => handleAnomalyClick(anomaly)}
                                        className="p-5 cursor-pointer smooth-transition"
                                        style={{
                                            borderBottom: '1px solid var(--border-primary)',
                                            ':hover': { background: 'var(--hover-bg)' }
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover-bg)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <AlertTriangle className="w-4 h-4 text-orange-500" />
                                                <span className="text-sm font-semibold text-orange-600">
                                                    Anomaly Score: {(anomaly.score * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                {anomaly.file} • Line {anomaly.line_number}
                                            </span>
                                        </div>
                                        <code className="text-xs font-mono break-all line-clamp-2 p-2 rounded-lg" 
                                            style={{ 
                                                background: 'var(--bg-tertiary)',
                                                color: 'var(--text-primary)'
                                            }}>
                                            {anomaly.content}
                                        </code>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'timeline' && (
                    <div className="p-6">
                        <div className="p-6 rounded-xl shadow-minimal" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}>
                            <h3 className="text-lg font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Error Timeline</h3>
                            <div className="h-64 rounded-xl flex items-center justify-center" style={{
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                <p style={{ color: 'var(--text-tertiary)' }}>Timeline visualization coming soon</p>
                            </div>
                        </div>
                    </div>
                )}

                {selectedTab === 'insights' && (
                    <div className="p-6 space-y-4">
                        {(data?.insights || []).map((insight, idx) => (
                            <div
                                key={idx}
                                className={`p-6 rounded-xl shadow-minimal border-l-4 ${
                                    insight.type === 'critical' ? 'border-l-red-500' :
                                    insight.type === 'warning' ? 'border-l-yellow-500' :
                                    'border-l-blue-500'
                                }`}
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    borderLeftWidth: '4px'
                                }}
                            >
                                <div className="flex items-start">
                                    <div className={`p-3 rounded-xl mr-4 ${
                                        insight.type === 'critical' ? 'bg-red-50' :
                                        insight.type === 'warning' ? 'bg-yellow-50' :
                                        'bg-blue-50'
                                    }`}>
                                        {insight.type === 'critical' ? 
                                            <AlertCircle className="w-6 h-6 text-red-500" /> :
                                            insight.type === 'warning' ?
                                            <AlertTriangle className="w-6 h-6 text-yellow-500" /> :
                                            <TrendingUp className="w-6 h-6 text-blue-500" />
                                        }
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                            {insight.title}
                                        </h4>
                                        <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                                            {insight.description}
                                        </p>
                                        {insight.recommendations && (
                                            <div>
                                                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                                                    Recommendations:
                                                </p>
                                                <ul className="text-sm list-disc list-inside space-y-1" style={{ color: 'var(--text-secondary)' }}>
                                                    {insight.recommendations.map((rec, i) => (
                                                        <li key={i}>{rec}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedPattern && (
                <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0, 0, 0, 0.5)' }}>
                    <div className="rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col" style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-primary)'
                    }}>
                        <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Pattern Details</h3>
                            <button
                                onClick={() => setSelectedPattern(null)}
                                className="p-2 rounded-xl smooth-transition"
                                style={{ ':hover': { background: 'var(--hover-bg)' } }}
                            >
                                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto">
                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Pattern Template:</p>
                                    <code className="block p-4 rounded-xl font-mono text-sm" style={{
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)'
                                    }}>
                                        {selectedPattern.template}
                                    </code>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    {[
                                        { label: 'Occurrences', value: selectedPattern.count },
                                        { label: 'Severity', value: selectedPattern.severity },
                                        { label: 'Files', value: selectedPattern.files?.length || 1 }
                                    ].map((stat, idx) => (
                                        <div key={idx} className="text-center p-4 rounded-xl" style={{
                                            background: 'var(--bg-tertiary)',
                                            border: '1px solid var(--border-primary)'
                                        }}>
                                            <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{stat.label}</p>
                                            <p className="text-3xl font-bold mt-2 capitalize" style={{ color: 'var(--text-primary)' }}>
                                                {stat.value}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Found in files:</p>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {(selectedPattern.files || []).map((file, idx) => (
                                            <div key={idx} className="text-sm p-2 rounded-lg" style={{
                                                background: 'var(--bg-tertiary)',
                                                color: 'var(--text-secondary)'
                                            }}>
                                                {file}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Replace the ENTIRE EnhancedLogViewer component in App.jsx with this

// Replace EnhancedLogViewer in App.jsx with this SIMPLE version
// NO LazyLog, NO new dependencies, just prevents freezing

const EnhancedLogViewer1 = ({ sessionId, analysisData, initialFile, initialLine }) => {
    const [selectedFile, setSelectedFile] = useState(initialFile);
    const [fileContent, setFileContent] = useState(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentLine, setCurrentLine] = useState(initialLine || 1);
    const lineRefs = useRef({});
    const [displayLimit, setDisplayLimit] = useState(10000);
    const [fileSearchTerm, setFileSearchTerm] = useState('');

    // NEW: Performance-optimized filtering
    const [parsedLines, setParsedLines] = useState([]); // Pre-parsed JSON lines
    const [availableFields, setAvailableFields] = useState({}); // All detected fields with sample values
    const [showFieldHelper, setShowFieldHelper] = useState(false);
    const [isJsonFile, setIsJsonFile] = useState(false);
    const [filterStats, setFilterStats] = useState({ total: 0, filtered: 0 });

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

    // Parse and cache JSON lines for performance
    useEffect(() => {
        if (!fileContent?.content) return;

        const parsed = [];
        const fields = {};
        let jsonCount = 0;

        // Parse all lines once
        fileContent.content.forEach((line, index) => {
            let lineData = {
                raw: line,
                parsed: null,
                index: index
            };

            if (typeof line === 'string' && line.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(line);
                    lineData.parsed = json;
                    jsonCount++;

                    // Collect field information
                    Object.entries(json).forEach(([key, value]) => {
                        if (!fields[key]) {
                            fields[key] = {
                                type: typeof value,
                                sampleValues: new Set(),
                                count: 0
                            };
                        }
                        fields[key].count++;

                        // Collect sample values for useful fields
                        if (value !== null && value !== undefined && value !== '') {
                            const valueStr = String(value);
                            if (valueStr.length < 100) { // Don't collect huge values
                                fields[key].sampleValues.add(valueStr);
                            }
                        }
                    });
                } catch (e) {
                    // Not valid JSON
                }
            }

            parsed.push(lineData);
        });

        // Convert sets to arrays and limit samples
        Object.keys(fields).forEach(key => {
            fields[key].sampleValues = Array.from(fields[key].sampleValues)
                .slice(0, 20) // Keep only first 20 samples
                .filter(v => v && v !== 'null' && v !== 'undefined'); // Filter out junk
        });

        setParsedLines(parsed);
        setAvailableFields(fields);
        setIsJsonFile(jsonCount > parsed.length * 0.3); // >30% JSON

        // Auto-show field helper for JSON files
        if (jsonCount > parsed.length * 0.3 && Object.keys(fields).length > 0) {
            setShowFieldHelper(true);
        }
    }, [fileContent]);

    useEffect(() => {
        if (initialFile && initialFile !== selectedFile) {
            setSelectedFile(initialFile);
        }
    }, [initialFile]);

    useEffect(() => {
        if (initialLine && lineRefs.current[initialLine]) {
            lineRefs.current[initialLine].scrollIntoView({ behavior: 'smooth', block: 'center' });
            lineRefs.current[initialLine].classList.add('bg-yellow-500/20');
            setTimeout(() => {
                lineRefs.current[initialLine]?.classList.remove('bg-yellow-500/20');
            }, 2000);
        }
    }, [initialLine, fileContent]);

    useEffect(() => {
        if (!selectedFile || !sessionId) return;

        const loadFileContent = async () => {
            setLoading(true);
            setDisplayLimit(10000);
            setSearchQuery(''); // Reset search on file change
            try {
                const response = await fetch(`/api/logs/${sessionId}/${selectedFile}`);
                const data = await response.json();
                setFileContent(data);
            } catch (err) {
                console.error('Error loading file:', err);
            } finally {
                setLoading(false);
            }
        };

        loadFileContent();
    }, [selectedFile, sessionId, analysisData]);

    const getLogLevel = (line) => {
        if (typeof line !== 'string') return 'default';
        const lineLower = line.toLowerCase();
        if (lineLower.includes('error') || lineLower.includes('fail')) return 'error';
        if (lineLower.includes('warn')) return 'warning';
        if (lineLower.includes('info')) return 'info';
        return 'default';
    };

    // Parse search query with boolean logic
    const parseSearchQuery = (query) => {
        if (!query.trim()) return null;

        // Handle OR logic
        if (query.includes(' OR ')) {
            const parts = query.split(' OR ');
            return {
                type: 'OR',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        // Handle AND logic (default)
        if (query.includes(' AND ')) {
            const parts = query.split(' AND ');
            return {
                type: 'AND',
                conditions: parts.map(p => parseSearchQuery(p.trim())).filter(Boolean)
            };
        }

        // Handle NOT
        if (query.startsWith('NOT ')) {
            return {
                type: 'NOT',
                condition: parseSearchQuery(query.substring(4).trim())
            };
        }

        // Handle field:value or field:>value patterns
        if (query.includes(':')) {
            const match = query.match(/^([^:]+):(.+)$/);
            if (match) {
                const [_, field, value] = match;

                // Check for operators
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

        // Plain text search
        return { type: 'TEXT', value: query };
    };

    // Evaluate parsed query against a line
    const evaluateQuery = (query, lineData) => {
        if (!query) return true;

        switch (query.type) {
            case 'OR':
                return query.conditions.some(c => evaluateQuery(c, lineData));

            case 'AND':
                return query.conditions.every(c => evaluateQuery(c, lineData));

            case 'NOT':
                return !evaluateQuery(query.condition, lineData);

            case 'TEXT':
                return lineData.raw.toLowerCase().includes(query.value.toLowerCase());

            case 'FIELD_EQ':
                if (!lineData.parsed) return false;
                const eqValue = String(lineData.parsed[query.field] || '').toLowerCase();
                return eqValue === query.value.toLowerCase();

            case 'FIELD_NEQ':
                if (!lineData.parsed) return false;
                const neqValue = String(lineData.parsed[query.field] || '').toLowerCase();
                return neqValue !== query.value.toLowerCase();

            case 'FIELD_GT':
                if (!lineData.parsed) return false;
                return Number(lineData.parsed[query.field]) > Number(query.value);

            case 'FIELD_GTE':
                if (!lineData.parsed) return false;
                return Number(lineData.parsed[query.field]) >= Number(query.value);

            case 'FIELD_LT':
                if (!lineData.parsed) return false;
                return Number(lineData.parsed[query.field]) < Number(query.value);

            case 'FIELD_LTE':
                if (!lineData.parsed) return false;
                return Number(lineData.parsed[query.field]) <= Number(query.value);

            default:
                return true;
        }
    };

    // Filter content with memoization
    const filteredContent = useMemo(() => {
        if (!parsedLines.length) return [];

        const query = parseSearchQuery(searchQuery);

        if (!query) {
            setFilterStats({ total: parsedLines.length, filtered: parsedLines.length });
            return parsedLines;
        }

        const filtered = parsedLines.filter(lineData => evaluateQuery(query, lineData));
        setFilterStats({ total: parsedLines.length, filtered: filtered.length });
        return filtered;
    }, [parsedLines, searchQuery]);

    const displayedContent = filteredContent.slice(0, displayLimit);
    const hasMore = filteredContent.length > displayLimit;

    const loadMore = () => {
        setDisplayLimit(prev => prev + 10000);
    };

    // Insert field:value syntax into search
    const insertFieldFilter = (field, value, operator = '') => {
        const filterText = operator ? `${field}:${operator}${value}` : `${field}:${value}`;

        if (searchQuery) {
            // Add with AND
            setSearchQuery(`${searchQuery} AND ${filterText}`);
        } else {
            setSearchQuery(filterText);
        }
    };

    // Generate example queries based on detected fields
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
        if (availableFields.duration_s) {
            examples.push('duration_s:>1');
        }
        examples.push('NOT level:debug');
        examples.push('error AND NOT "connection reset"');

        return examples.slice(0, 4); // Return max 4 examples
    };

    return (
        <div className="h-full flex" style={{ background: 'var(--bg-primary)' }}>
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
                                className={`px-4 py-3 cursor-pointer text-sm flex items-center smooth-transition ${selectedFile === file.path
                                    ? 'btn-primary'
                                    : ''
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

            <div className="flex-1 flex flex-col">
                {selectedFile ? (
                    <>
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

                            {/* Advanced search bar */}
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
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
                                    </div>
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="px-3 py-2 rounded-xl smooth-transition btn-secondary"
                                        >
                                            Clear
                                        </button>
                                    )}
                                    {isJsonFile && (
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
                                {isJsonFile && !searchQuery && (
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
                            {isJsonFile && showFieldHelper && Object.keys(availableFields).length > 0 && (
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
                                            .sort((a, b) => b[1].count - a[1].count) // Sort by frequency
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

                        <div className="flex-1 overflow-y-auto font-mono text-sm" style={{ background: 'var(--bg-primary)' }}>
                            {loading ? (
                                <div className="flex items-center justify-center h-full">
                                    <div className="animate-spin w-8 h-8 border-3 border-current border-t-transparent rounded-full" style={{ borderColor: 'var(--text-tertiary)' }} />
                                </div>
                            ) : (
                                <div className="p-4">
                                    {filteredContent.length === 0 && searchQuery && (
                                        <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                                            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>No matches found for:</p>
                                            <p className="mt-2 font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                                                {searchQuery}
                                            </p>
                                            <button
                                                onClick={() => setSearchQuery('')}
                                                className="mt-4 px-4 py-2 text-sm rounded-lg smooth-transition btn-secondary"
                                            >
                                                Clear Search
                                            </button>
                                        </div>
                                    )}

                                    {displayedContent.map((lineData, index) => {
                                        const actualLineNumber = lineData.index + 1;
                                        const level = getLogLevel(lineData.raw);
                                        const color = level === 'error' ? '#ef4444' :
                                            level === 'warning' ? '#f59e0b' :
                                                level === 'info' ? '#3b82f6' : 'var(--text-primary)';

                                        return (
                                            <div
                                                key={actualLineNumber}
                                                ref={el => lineRefs.current[actualLineNumber] = el}
                                                className="flex py-1 px-2 rounded smooth-transition"
                                                style={{ ':hover': { background: 'var(--hover-bg)' } }}
                                                onMouseEnter={(e) => {
                                                    setCurrentLine(actualLineNumber);
                                                    e.currentTarget.style.background = 'var(--hover-bg)';
                                                }}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <span className="w-16 flex-shrink-0 select-none text-right pr-4" style={{ color: 'var(--text-tertiary)' }}>
                                                    {actualLineNumber}
                                                </span>
                                                <pre className="flex-1 whitespace-pre-wrap break-all" style={{ color }}>
                                                    {lineData.raw}
                                                </pre>
                                            </div>
                                        );
                                    })}

                                    {hasMore && (
                                        <div className="mt-4 p-4 rounded-xl text-center" style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)'
                                        }}>
                                            <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
                                                Showing {displayedContent.length} of {filteredContent.length} filtered lines
                                            </p>
                                            <button
                                                onClick={loadMore}
                                                className="px-4 py-2 rounded-lg font-semibold smooth-transition"
                                                style={{
                                                    background: 'var(--accent)',
                                                    color: 'var(--bg-primary)'
                                                }}
                                            >
                                                Load 10,000 More Lines
                                            </button>
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

// Enhanced Upload Page with Session Overview
const EnhancedUploadPage = ({ nodes, onUploadComplete, onNodeSelect, onNodeClose }) => {
    return (
        <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
            <div className="max-w-7xl mx-auto p-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                        GitLab SOS Analysis Platform
                    </h1>
                    <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
                        Manage your active sessions or upload new SOS archives
                    </p>
                </div>

                {/* Active Sessions Overview */}
                <div className="mb-12">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
                                <Server className="w-6 h-6" />
                                Active Sessions ({nodes.length})
                            </h2>
                            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                                Click any session to view its analysis
                            </p>
                        </div>
                        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                            {nodes.filter(n => n.status === 'completed').length} completed • {' '}
                            {nodes.filter(n => n.status === 'processing').length} processing • {' '}
                            {nodes.filter(n => n.status === 'failed').length} failed
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                        {nodes.map(node => {
                            const isProcessing = node.status === 'processing';
                            const isCompleted = node.status === 'completed';
                            const isFailed = node.status === 'failed';
                            
                            return (
                                <div
                                    key={node.id}
                                    onClick={() => onNodeSelect(node.id)}
                                    className="relative p-3 rounded-lg cursor-pointer smooth-transition transform hover:scale-[1.02] hover:shadow-md"
                                    style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                    }}
                                >
                                    {/* Status Badge */}
                                    <div className="absolute top-1.5 right-1.5">
                                        {isProcessing && (
                                            <div className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" 
                                                 style={{ color: 'var(--text-tertiary)' }} />
                                        )}
                                        {isCompleted && <CheckCircle className="w-3 h-3 text-green-500" />}
                                        {isFailed && <AlertCircle className="w-3 h-3 text-red-500" />}
                                    </div>
                                    
                                    {/* Close Button */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onNodeClose(node.id);
                                        }}
                                        className="absolute top-1.5 left-1.5 p-0.5 rounded opacity-0 hover:opacity-100 smooth-transition"
                                        style={{ background: 'var(--bg-primary)' }}
                                        title="Close session"
                                    >
                                        <X className="w-2.5 h-2.5" style={{ color: 'var(--text-tertiary)' }} />
                                    </button>
                                    
                                    <div className="flex items-start gap-2 mb-2 mt-1">
                                        <div className="p-1.5 rounded flex-shrink-0" style={{ background: 'var(--bg-primary)' }}>
                                            <Package className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                                                {node.name}
                                            </h3>
                                            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                                                {node.filename ? (
                                                    node.filename.length > 15 
                                                        ? node.filename.substring(0, 12) + '...' 
                                                        : node.filename
                                                ) : 'Processing...'}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Status */}
                                    <div className="mb-2">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                            isProcessing ? 'bg-blue-500/20 text-blue-600' :
                                            isCompleted ? 'bg-green-500/20 text-green-600' :
                                            isFailed ? 'bg-red-500/20 text-red-600' :
                                            'bg-gray-500/20 text-gray-600'
                                        }`} style={{ fontSize: '10px' }}>
                                            {isProcessing && <div className="animate-spin w-1.5 h-1.5 border border-current border-t-transparent rounded-full mr-1" />}
                                            {node.status}
                                        </span>
                                    </div>
                                    
                                    {/* Stats */}
                                    {node.analysisData && (
                                        <div className="grid grid-cols-2 gap-1 text-xs">
                                            <div>
                                                <p style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Files</p>
                                                <p className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                                                    {node.analysisData.files_processed || 0}
                                                </p>
                                            </div>
                                            <div>
                                                <p style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Lines</p>
                                                <p className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                                                    {((node.analysisData.total_lines || 0) / 1000).toFixed(1)}k
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Processing indicator */}
                                    {isProcessing && (
                                        <div className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                                            <div className="flex items-center gap-1">
                                                <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
                                                Analyzing...
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Upload New Archive Section */}
                <div className="border-t pt-8" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                            Upload New SOS Archive
                        </h2>
                        <p style={{ color: 'var(--text-secondary)' }}>
                            Add another SOS archive to analyze
                        </p>
                    </div>
                    
                    <div className="max-w-4xl mx-auto">
                        <CompactFileUploader onUploadComplete={onUploadComplete} />
                    </div>
                </div>
            </div>
        </div>
    );
};

// Compact File Uploader for use within Enhanced Upload Page
const CompactFileUploader = ({ onUploadComplete }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [currentUpload, setCurrentUpload] = useState(null);
    const [uploadProgress, setUploadProgress] = useState({});

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        
        const files = Array.from(e.dataTransfer.files);
        const validFiles = files.filter(file => 
            file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)
        );
        
        if (validFiles.length === 0) {
            alert('Please upload valid SOS archives (.tar, .tar.gz, .zip)');
            return;
        }

        if (validFiles.length === 1) {
            await handleUpload(validFiles[0]);
        } else {
            await handleMultipleUploads(validFiles);
        }
    };

    const handleMultipleUploads = async (files) => {
        setUploading(true);
        setUploadQueue(files.map(f => f.name));
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setCurrentUpload(file.name);
            
            try {
                await handleUpload(file, i === files.length - 1);
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error);
            }
        }
        
        setUploadQueue([]);
        setCurrentUpload(null);
        setUploading(false);
        setUploadProgress({});
    };

    const handleUpload = async (file, isLastFile = true) => {
        if (!file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)) {
            alert(`Invalid file format: ${file.name}`);
            return;
        }

        if (!uploadQueue.length) {
            setUploading(true);
        }
        
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

        const progressInterval = setInterval(() => {
            setUploadProgress(prev => ({
                ...prev,
                [file.name]: Math.min((prev[file.name] || 0) + 10, 90)
            }));
        }, 200);

        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error('Upload failed');
            
            const result = await response.json();
            
            clearInterval(progressInterval);
            setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            onUploadComplete(result);
            
            if (!uploadQueue.length && isLastFile) {
                setUploading(false);
                setUploadProgress({});
            }
            
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Failed to upload ${file.name}`);
            clearInterval(progressInterval);
            
            if (!uploadQueue.length && isLastFile) {
                setUploading(false);
                setUploadProgress({});
            }
        }
    };

    const handleFileSelect = async (e) => {
        const files = Array.from(e.target.files || []);
        const validFiles = files.filter(file => 
            file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)
        );
        
        if (validFiles.length === 0) return;
        
        if (validFiles.length === 1) {
            await handleUpload(validFiles[0]);
        } else {
            await handleMultipleUploads(validFiles);
        }
    };

    const overallProgress = uploadQueue.length > 0
        ? Math.round(
            Object.values(uploadProgress).reduce((sum, p) => sum + p, 0) / 
            Object.keys(uploadProgress).length
          )
        : uploadProgress[Object.keys(uploadProgress)[0]] || 0;

    return (
        <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            className={`
                w-full h-80 border-2 border-dashed rounded-2xl
                flex flex-col items-center justify-center cursor-pointer
                transition-all duration-300 relative overflow-hidden
                ${uploading ? 'cursor-not-allowed opacity-75' : ''}
            `}
            style={{
                borderColor: isDragging ? 'var(--accent)' : 'var(--border-primary)',
                background: isDragging ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                transform: isDragging ? 'scale(1.02)' : 'scale(1)'
            }}
        >
            <input
                type="file"
                multiple
                onChange={handleFileSelect}
                accept=".tar,.gz,.tgz,.zip,application/gzip,application/x-tar,application/x-compressed-tar,application/zip"
                className="hidden"
                id="compact-file-input"
                disabled={uploading}
            />
            
            {uploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: 'var(--bg-primary)' }}>
                    {uploadQueue.length > 0 ? (
                        <div className="text-center">
                            <div className="mb-4">
                                <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                                    Uploading {uploadQueue.length} files
                                </p>
                                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                    Current: {currentUpload}
                                </p>
                            </div>
                            
                            <div className="w-64 space-y-2 mb-4 max-h-32 overflow-y-auto">
                                {Object.entries(uploadProgress).map(([filename, progress]) => (
                                    <div key={filename} className="text-left">
                                        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                                            <span className="truncate max-w-[200px]">{filename}</span>
                                            <span>{progress}%</span>
                                        </div>
                                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                            <div 
                                                className="h-full transition-all duration-300"
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
                        <>
                            <div className="w-48 mb-4">
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                    <div 
                                        className="h-full transition-all duration-300"
                                        style={{ 
                                            width: `${overallProgress}%`,
                                            background: 'var(--accent)'
                                        }}
                                    />
                                </div>
                            </div>
                            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Uploading... {overallProgress}%
                            </p>
                        </>
                    )}
                </div>
            )}
            
            {!uploading && (
                <label htmlFor="compact-file-input" className="text-center p-6 cursor-pointer">
                    <Upload className="w-12 h-12 mx-auto mb-4" style={{ 
                        color: isDragging ? 'var(--accent)' : 'var(--text-tertiary)' 
                    }} />
                    
                    <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                        {isDragging 
                            ? 'Drop your SOS archives here' 
                            : 'Drop files or click to browse'
                        }
                    </h3>
                    
                    <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                        💡 Multiple files supported
                    </p>
                    
                    <div className="flex flex-wrap justify-center gap-2 text-xs">
                        {['tar', 'tar.gz', 'zip'].map(ext => (
                            <span key={ext} className="px-2 py-1 rounded-full" style={{
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-secondary)'
                            }}>
                                {ext}
                            </span>
                        ))}
                    </div>
                </label>
            )}
        </div>
    );
};

// Enhanced File Uploader with Multi-file Support (Original - for when no nodes exist)
const FileUploader = ({ onUploadComplete }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [currentUpload, setCurrentUpload] = useState(null);
    const [uploadProgress, setUploadProgress] = useState({});

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        
        const files = Array.from(e.dataTransfer.files);
        const validFiles = files.filter(file => 
            file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)
        );
        
        if (validFiles.length === 0) {
            alert('Please upload valid SOS archives (.tar, .tar.gz, .zip)');
            return;
        }

        // Handle multiple files
        if (validFiles.length === 1) {
            // Single file - existing behavior
            await handleUpload(validFiles[0]);
        } else {
            // Multiple files - process sequentially
            await handleMultipleUploads(validFiles);
        }
    };

    const handleMultipleUploads = async (files) => {
        setUploading(true);
        setUploadQueue(files.map(f => f.name));
        
        console.log(`Starting upload of ${files.length} files`);
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setCurrentUpload(file.name);
            console.log(`Uploading file ${i + 1}/${files.length}: ${file.name}`);
            
            try {
                await handleUpload(file, i === files.length - 1);
                console.log(`Successfully uploaded: ${file.name}`);
                
                // Small delay between uploads to ensure proper state updates
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error);
                // Continue with next file
            }
        }
        
        setUploadQueue([]);
        setCurrentUpload(null);
        setUploading(false);
        setUploadProgress({});
    };

    const handleUpload = async (file, isLastFile = true) => {
        if (!file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)) {
            alert(`Invalid file format: ${file.name}`);
            return;
        }

        if (!uploadQueue.length) {
            setUploading(true);
        }
        
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

        const progressInterval = setInterval(() => {
            setUploadProgress(prev => ({
                ...prev,
                [file.name]: Math.min((prev[file.name] || 0) + 10, 90)
            }));
        }, 200);

        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error('Upload failed');
            
            const result = await response.json();
            
            clearInterval(progressInterval);
            setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
            
            // Small delay to show completion
            await new Promise(resolve => setTimeout(resolve, 500));
            
            onUploadComplete(result);
            
            if (!uploadQueue.length && isLastFile) {
                setUploading(false);
                setUploadProgress({});
            }
            
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Failed to upload ${file.name}`);
            clearInterval(progressInterval);
            
            if (!uploadQueue.length && isLastFile) {
                setUploading(false);
                setUploadProgress({});
            }
        }
    };

    const handleFileSelect = async (e) => {
        const files = Array.from(e.target.files || []);
        const validFiles = files.filter(file => 
            file.name.match(/\.(tar|tar\.gz|tgz|zip)$/)
        );
        
        if (validFiles.length === 0) return;
        
        if (validFiles.length === 1) {
            await handleUpload(validFiles[0]);
        } else {
            await handleMultipleUploads(validFiles);
        }
    };

    // Calculate overall progress for multiple files
    const overallProgress = uploadQueue.length > 0
        ? Math.round(
            Object.values(uploadProgress).reduce((sum, p) => sum + p, 0) / 
            Object.keys(uploadProgress).length
          )
        : uploadProgress[Object.keys(uploadProgress)[0]] || 0;

    return (
        <div className="h-full flex items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
            <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                className={`
                    w-full max-w-3xl h-96 border-3 border-dashed rounded-2xl
                    flex flex-col items-center justify-center cursor-pointer
                    transition-all duration-300 relative overflow-hidden
                    ${uploading ? 'cursor-not-allowed opacity-75' : ''}
                `}
                style={{
                    borderColor: isDragging ? 'var(--accent)' : 'var(--border-primary)',
                    background: isDragging ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                    transform: isDragging ? 'scale(1.02)' : 'scale(1)'
                }}
            >
                <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    accept=".tar,.gz,.tgz,.zip,application/gzip,application/x-tar,application/x-compressed-tar,application/zip"
                    className="hidden"
                    id="file-input"
                    disabled={uploading}
                />
                
                {uploading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: 'var(--bg-primary)' }}>
                        {uploadQueue.length > 0 ? (
                            // Multiple files upload UI
                            <div className="text-center">
                                <div className="mb-6">
                                    <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                                        Uploading {uploadQueue.length} files
                                    </p>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        Current: {currentUpload}
                                    </p>
                                </div>
                                
                                <div className="w-80 space-y-2 mb-4 max-h-48 overflow-y-auto">
                                    {Object.entries(uploadProgress).map(([filename, progress]) => (
                                        <div key={filename} className="text-left">
                                            <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                                                <span className="truncate max-w-[250px]">{filename}</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                                <div 
                                                    className="h-full transition-all duration-300"
                                                    style={{ 
                                                        width: `${progress}%`,
                                                        background: progress === 100 ? '#10b981' : 'var(--accent)'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                
                                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                                    Each file will open in a new tab
                                </p>
                            </div>
                        ) : (
                            // Single file upload UI (existing)
                            <>
                                <div className="w-64 mb-4">
                                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                                        <div 
                                            className="h-full transition-all duration-300"
                                            style={{ 
                                                width: `${overallProgress}%`,
                                                background: 'var(--accent)'
                                            }}
                                        />
                                    </div>
                                </div>
                                <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    Uploading... {overallProgress}%
                                </p>
                                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                                    Processing SOS archive
                                </p>
                            </>
                        )}
                    </div>
                )}
                
                {!uploading && (
                    <label htmlFor="file-input" className="text-center p-8 cursor-pointer">
                        <Upload className="w-20 h-20 mx-auto mb-4" style={{ 
                            color: isDragging ? 'var(--accent)' : 'var(--text-tertiary)' 
                        }} />
                        
                        <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                            {isDragging 
                                ? 'Drop your SOS archives here' 
                                : 'Upload GitLab SOS Archives'
                            }
                        </h3>
                        
                        <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>
                            Drag and drop or click to browse
                        </p>
                        
                        <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                            💡 Tip: You can select or drop multiple files at once!
                        </p>
                        
                        <div className="flex flex-wrap justify-center gap-2 text-sm">
                            {['tar', 'tar.gz', 'zip'].map(ext => (
                                <span key={ext} className="px-3 py-1 rounded-full" style={{
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-secondary)'
                                }}>
                                    {ext}
                                </span>
                            ))}
                        </div>
                    </label>
                )}
            </div>
        </div>
    );
};

// Theme Toggle Component
const ThemeToggle = () => {
    const { theme, toggleTheme } = useTheme();
    
    return (
        <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl smooth-transition"
            style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)'
            }}
        >
            <span className="text-sm font-medium">Theme</span>
            <div className="flex items-center gap-2">
                {theme === 'light' ? (
                    <>
                        <Sun className="w-4 h-4" />
                        <span className="text-xs">Light</span>
                    </>
                ) : (
                    <>
                        <Moon className="w-4 h-4" />
                        <span className="text-xs">Dark</span>
                    </>
                )}
            </div>
        </button>
    );
};

// Active Nodes Display Component
const ActiveNodesDisplay = ({ nodes, activeNodeId, onNodeSelect, onNodeClose }) => {
    if (nodes.length === 0) return null;
    
    return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Server className="w-5 h-5" />
                    Active Analysis Nodes ({nodes.length})
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Select a node to view its analysis or upload a new SOS archive
                </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {nodes.map(node => {
                    const isActive = node.id === activeNodeId;
                    const isProcessing = node.status === 'processing';
                    const isCompleted = node.status === 'completed';
                    const isFailed = node.status === 'failed';
                    
                    return (
                        <div
                            key={node.id}
                            onClick={() => onNodeSelect(node.id)}
                            className="relative p-4 rounded-xl cursor-pointer smooth-transition transform hover:scale-[1.02]"
                            style={{
                                background: isActive ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                                border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border-primary)'}`,
                                boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            {/* Status Badge */}
                            <div className="absolute top-2 right-2">
                                {isProcessing && (
                                    <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" 
                                         style={{ color: 'var(--text-tertiary)' }} />
                                )}
                                {isCompleted && <CheckCircle className="w-4 h-4 text-green-500" />}
                                {isFailed && <AlertCircle className="w-4 h-4 text-red-500" />}
                            </div>
                            
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
                                    <Package className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                        {node.name}
                                    </h4>
                                    <p className="text-xs truncate mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {node.filename || node.sessionId}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            isProcessing ? 'bg-blue-500/20 text-blue-600' :
                                            isCompleted ? 'bg-green-500/20 text-green-600' :
                                            isFailed ? 'bg-red-500/20 text-red-600' :
                                            'bg-gray-500/20 text-gray-600'
                                        }`}>
                                            {node.status}
                                        </span>
                                        {node.analysisData && (
                                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                {node.analysisData.files_processed} files
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onNodeClose(node.id);
                                }}
                                className="absolute top-2 left-2 p-1 rounded-lg opacity-0 hover:opacity-100 smooth-transition"
                                style={{ background: 'var(--bg-primary)' }}
                            >
                                <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Tab with Rename Component
const TabWithRename = ({ node, isActive, onSelect, onRename, onClose }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(node.name);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleDoubleClick = (e) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditName(node.name);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(node.name);
        }
    };

    const handleSave = () => {
        const trimmedName = editName.trim();
        if (trimmedName && trimmedName !== node.name) {
            onRename(trimmedName);
        }
        setIsEditing(false);
    };

    const handleBlur = () => {
        handleSave();
    };

    // Extract cleaner filename from session ID or use stored filename
    const shortFilename = node.filename 
        ? (node.filename.length > 20 
            ? node.filename.substring(0, 17) + '...' 
            : node.filename)
        : '';

    return (
        <div
            className={`flex items-center px-3 py-1 cursor-pointer smooth-transition ${
                isActive ? 'border-b-3' : ''
            }`}
            style={{
                background: isActive ? 'var(--bg-primary)' : 'transparent',
                borderBottom: isActive ? '3px solid var(--accent)' : 'none',
                borderRight: '1px solid var(--border-primary)',
                minWidth: '160px',
                maxWidth: '280px',
                height: '40px'
            }}
            onClick={onSelect}
            title={`${node.name}${node.filename ? `: ${node.filename}` : ''}\nDouble-click to rename`}
        >
            <Server className="w-3 h-3 mr-2 flex-shrink-0" />
            
            <div className="flex-1 min-w-0 mr-2">
                {isEditing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                        className="w-full px-1 py-0.5 text-xs font-medium rounded border-0 outline-none"
                        style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--accent)'
                        }}
                        maxLength={30}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div onDoubleClick={handleDoubleClick} className="truncate flex flex-col justify-center">
                        <span className="font-medium text-xs leading-tight" style={{ color: 'var(--text-primary)' }}>
                            {node.name}
                        </span>
                        {shortFilename && (
                            <div className="text-xs truncate leading-tight" style={{ color: 'var(--text-tertiary)', fontSize: '10px', lineHeight: '11px', marginTop: '1px' }}>
                                {shortFilename}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {node.status === 'processing' && (
                <div className="animate-spin w-2.5 h-2.5 border border-current border-t-transparent rounded-full mr-1 flex-shrink-0" />
            )}
            {node.status === 'completed' && (
                <CheckCircle className="w-3 h-3 text-green-500 mr-1 flex-shrink-0" />
            )}
            {node.status === 'failed' && (
                <AlertCircle className="w-3 h-3 text-red-500 mr-1 flex-shrink-0" />
            )}
            
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                className="p-0.5 rounded smooth-transition flex-shrink-0 opacity-60 hover:opacity-100"
                style={{ ':hover': { background: 'var(--hover-bg)' } }}
                title="Close tab"
            >
                <X className="w-2.5 h-2.5" />
            </button>
        </div>
    );
};

// Main App with Theme Support
function App() {
    // Node management state
    const [nodes, setNodes] = useState([]);
    const [activeNodeId, setActiveNodeId] = useState(null);
    const nodeIdCounter = useRef(1);

    // Get current node data
    const currentNode = nodes.find(n => n.id === activeNodeId);
    const sessionId = currentNode?.sessionId;
    const analysisData = currentNode?.analysisData;
    
    // Existing state (per node)
    const [activeTab, setActiveTab] = useState('upload');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [navigationTarget, setNavigationTarget] = useState({ file: null, line: null });
    const [powerSearchQuery, setPowerSearchQuery] = useState('');
    
    // Navigation handler
    const handleNavigateToLog = useCallback((file, lineNumber) => {
        setNavigationTarget({ file, line: lineNumber });
        setActiveTab('viewer');
    }, []);

    // Handle execute search from Duo Chat
    const handleExecuteSearch = useCallback((query) => {
        setActiveTab('power-search');
        setPowerSearchQuery(query);
    }, []);

    // Load saved nodes on mount
    useEffect(() => {
        const savedNodes = localStorage.getItem('sos_nodes');
        if (savedNodes) {
            try {
                const parsed = JSON.parse(savedNodes);
                setNodes(parsed);
                if (parsed.length > 0 && !activeNodeId) {
                    setActiveNodeId(parsed[0].id);
                }
                // Update node counter to continue from the highest node number
                const highestNodeNum = Math.max(...parsed.map(n => {
                    const match = n.id.match(/node_(\d+)_/);
                    return match ? parseInt(match[1]) : 0;
                }), 0);
                nodeIdCounter.current = highestNodeNum + 1;
            } catch (e) {
                console.error('Failed to load saved nodes:', e);
            }
        }
    }, []);

    // Save nodes to localStorage
    useEffect(() => {
        if (nodes.length > 0) {
            localStorage.setItem('sos_nodes', JSON.stringify(nodes));
        }
    }, [nodes]);

    // Poll for analysis results for ALL processing nodes
    useEffect(() => {
        const processingNodes = nodes.filter(node => node.status === 'processing');
        if (processingNodes.length === 0) return;

        const pollInterval = setInterval(async () => {
            for (const node of processingNodes) {
                try {
                    const response = await fetch(`/api/analysis/${node.sessionId}`);
                    const data = await response.json();

                    if (data.status === 'completed' || data.status === 'failed') {
                        setNodes(prev => prev.map(n => 
                            n.id === node.id 
                                ? { ...n, status: data.status, analysisData: data }
                                : n
                        ));

                        if (data.status === 'failed' && node.id === activeNodeId) {
                            setError(data.error);
                        }
                    }
                } catch (err) {
                    console.error(`Poll error for ${node.name}:`, err);
                }
            }
        }, 1000);

        return () => clearInterval(pollInterval);
    }, [nodes, activeNodeId]);

    const handleUploadComplete = useCallback((result) => {
        // Generate unique ID with timestamp to ensure uniqueness
        const timestamp = Date.now();
        const nodeNum = nodeIdCounter.current++;
        const nodeId = `node_${nodeNum}_${timestamp}`;
        const nodeName = `Node ${nodeNum}`;
        
        // Extract filename from session_id
        const filename = result.session_id.split('_').slice(2).join('_');
        
        console.log(`Creating node: ${nodeName} (${nodeId}) for file: ${filename}`);
        
        // Create new node
        const newNode = {
            id: nodeId,
            name: nodeName,
            sessionId: result.session_id,
            status: 'processing',
            analysisData: null,
            filename: filename,
            nodeNumber: nodeNum
        };
        
        // Add node to state
        setNodes(prev => {
            const updatedNodes = [...prev, newNode];
            
            // Only switch tabs for the first upload
            if (prev.length === 0) {
                setTimeout(() => {
                    setActiveNodeId(nodeId);
                    setActiveTab('viewer');
                }, 0);
            }
            
            return updatedNodes;
        });
        
        setError(null);
    }, []);

    const addNewNode = () => {
        setActiveTab('upload');
    };

    const closeNode = (nodeId) => {
        if (confirm('Close this node? Analysis data will be lost.')) {
            const nodeToClose = nodes.find(n => n.id === nodeId);
            
            setNodes(prev => prev.filter(n => n.id !== nodeId));
            
            if (nodeId === activeNodeId) {
                const remainingNodes = nodes.filter(n => n.id !== nodeId);
                if (remainingNodes.length > 0) {
                    setActiveNodeId(remainingNodes[0].id);
                } else {
                    setActiveNodeId(null);
                    setActiveTab('upload');
                }
            }
            
            if (nodeToClose) {
                localStorage.removeItem(`currentAnalysis_${nodeToClose.sessionId}`);
                localStorage.removeItem(`logCache_${nodeToClose.sessionId}`);
                // Clear auto-analysis for this session
                fetch(`/api/auto-analysis/${nodeToClose.sessionId}`, { method: 'DELETE' }).catch(() => {});
            }
        }
    };

    const clearAllNodes = () => {
        if (confirm('Clear all nodes? All analysis data will be lost.')) {
            nodes.forEach(node => {
                localStorage.removeItem(`currentAnalysis_${node.sessionId}`);
                localStorage.removeItem(`logCache_${node.sessionId}`);
                // Clear auto-analysis for each session
                fetch(`/api/auto-analysis/${node.sessionId}`, { method: 'DELETE' }).catch(() => {});
            });
            
            setNodes([]);
            setActiveNodeId(null);
            setActiveTab('upload');
            setError(null);
            setNavigationTarget({ file: null, line: null });
            
            localStorage.removeItem('sos_nodes');
            nodeIdCounter.current = 1;
        }
    };

    const clearAllSessions = async () => {
        if (confirm('Clear all sessions from server? This will delete all extracted SOS archives, clear all local nodes, and free up disk space. This action cannot be undone.')) {
            try {
                const response = await fetch('/api/sessions/clear', {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const result = await response.json();
                
                // Clear all local node data (same as clearAllNodes)
                nodes.forEach(node => {
                    localStorage.removeItem(`currentAnalysis_${node.sessionId}`);
                    localStorage.removeItem(`logCache_${node.sessionId}`);
                });
                
                // Reset all state
                setNodes([]);
                setActiveNodeId(null);
                setActiveTab('upload');
                setError(null);
                setNavigationTarget({ file: null, line: null });
                localStorage.removeItem('sos_nodes');
                nodeIdCounter.current = 1;
                
                // Show success message
                alert(`✅ ${result.message}\n💾 Space freed: ${result.space_freed}\n🗂️ All local nodes cleared`);
                
            } catch (error) {
                console.error('Failed to clear sessions:', error);
                alert(`❌ Failed to clear sessions: ${error.message}`);
            }
        }
    };

    const getStatusIcon = () => {
        if (!currentNode) return null;
        if (error) return <AlertCircle className="w-5 h-5 text-red-500" />;
        if (currentNode.status === 'processing') return <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />;
        if (currentNode.status === 'completed') return <CheckCircle className="w-5 h-5 text-green-500" />;
        return null;
    };

    return (
        <ThemeProvider>
            <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                {/* Node Tabs */}
                {nodes.length > 0 && (
                    <div className="flex items-center" style={{ 
                        background: 'var(--bg-secondary)', 
                        borderBottom: '1px solid var(--border-primary)',
                        height: '40px' // Fixed height like Chrome tabs
                    }}>
                        <div className="flex-1 flex overflow-x-auto scrollbar-thin" style={{
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'var(--text-tertiary) var(--bg-secondary)'
                        }}>
                            {nodes.map(node => {
                                return (
                                    <TabWithRename
                                        key={node.id}
                                        node={node}
                                        isActive={node.id === activeNodeId}
                                        onSelect={() => setActiveNodeId(node.id)}
                                        onRename={(newName) => {
                                            setNodes(prev => prev.map(n => 
                                                n.id === node.id ? { ...n, name: newName } : n
                                            ));
                                        }}
                                        onClose={() => closeNode(node.id)}
                                    />
                                );
                            })}
                            <button
                                onClick={addNewNode}
                                className="flex items-center px-3 py-1 smooth-transition"
                                style={{
                                    background: 'transparent',
                                    borderRight: '1px solid var(--border-primary)',
                                    height: '40px'
                                }}
                                title="Add new node"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                        {nodes.length > 1 && (
                            <div className="px-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                {nodes.length} nodes
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar */}
                    <div className="w-56 shadow-xl flex flex-col" style={{ 
                        background: 'var(--bg-secondary)', 
                        borderRight: '1px solid var(--border-primary)' 
                    }}>
                        <div className="p-6">
                            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                                GitLab SOS
                            </h1>
                            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Log Analysis Platform</p>
                        </div>

                        <nav className="px-4 py-4 flex-1 overflow-y-auto">
                            {[
                                { id: 'upload', icon: Upload, label: 'Upload SOS', enabled: true },
                                { id: 'viewer', icon: FileText, label: 'Log Viewer', enabled: !!analysisData },
                                { id: 'auto-analysis', icon: Sparkles, label: 'Auto-Analysis', enabled: !!analysisData },
                                { id: 'fast-stats', icon: BarChart3, label: 'FastStats', enabled: !!analysisData },
                                { id: 'power-search', icon: Zap, label: 'Power Search', enabled: !!analysisData },
                                { id: 'system', icon: Activity, label: 'System Metrics', enabled: !!analysisData }
                            ].map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id)}
                                    disabled={!item.enabled}
                                    className={`w-full flex items-center px-3 py-2 mb-1.5 rounded-lg text-sm smooth-transition ${
                                        activeTab === item.id 
                                            ? 'btn-primary' 
                                            : 'btn-secondary'
                                    } ${!item.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <item.icon className="w-4 h-4 mr-2.5" />
                                    {item.label}
                                </button>
                            ))}
                        </nav>

                        {/* Theme Toggle */}
                        <div className="p-4" style={{ borderTop: '1px solid var(--border-primary)' }}>
                            <ThemeToggle />
                        </div>

                        {/* Status */}
                        <div className="p-4" style={{ borderTop: '1px solid var(--border-primary)' }}>
                            <div className="rounded-xl p-4" style={{
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                {currentNode ? (
                                    <>
                                        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                            {currentNode.name} {currentNode.filename && (
                                                <span className="font-normal">- {currentNode.filename.substring(0, 20)}...</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Status</span>
                                            {getStatusIcon()}
                                        </div>
                                        {analysisData && (
                                            <>
                                                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                    Files: {analysisData.files_processed || 0}
                                                </p>
                                                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                                    Lines: {(analysisData.total_lines || 0).toLocaleString()}
                                                </p>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>No analysis data</p>
                                )}
                                <div className="space-y-2 mt-3">
                                    <button
                                        onClick={clearAllNodes}
                                        disabled={nodes.length === 0}
                                        className="w-full flex items-center justify-center px-3 py-2 text-xs rounded-xl font-semibold smooth-transition disabled:opacity-50"
                                        style={{
                                            background: 'transparent',
                                            color: '#ef4444',
                                            border: '1px solid #ef4444',
                                            ':hover': { background: '#ef4444', color: 'white' }
                                        }}
                                    >
                                        <Trash2 className="w-3 h-3 mr-1" />
                                        Clear all tabs
                                    </button>
                                    <button
                                        onClick={clearAllSessions}
                                        className="w-full flex items-center justify-center px-3 py-2 text-xs rounded-xl font-semibold smooth-transition"
                                        style={{
                                            background: 'transparent',
                                            color: '#dc2626',
                                            border: '1px solid #dc2626',
                                            ':hover': { background: '#dc2626', color: 'white' }
                                        }}
                                    >
                                        <Server className="w-3 h-3 mr-1" />
                                        Delete all sessions
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                        {activeTab === 'upload' && (
                            nodes.length === 0 ? (
                                <FileUploader onUploadComplete={handleUploadComplete} />
                            ) : (
                                <EnhancedUploadPage 
                                    nodes={nodes}
                                    onUploadComplete={handleUploadComplete}
                                    onNodeSelect={setActiveNodeId}
                                    onNodeClose={closeNode}
                                />
                            )
                        )}

                        {activeTab === 'viewer' && analysisData && (
                            <EnhancedLogViewer 
                                sessionId={sessionId} 
                                analysisData={analysisData}
                                initialFile={navigationTarget.file}
                                initialLine={navigationTarget.line}
                            />
                        )}

                        {activeTab === 'fast-stats' && analysisData && (
                            <FastStatsDashboard 
                                sessionId={sessionId}
                                analysisData={analysisData}
                                nodes={nodes}
                                currentNodeId={activeNodeId}
                                onNavigateToLog={handleNavigateToLog}
                            />
                        )}

                        {activeTab === 'auto-analysis' && analysisData && (
                            <AutoAnalysis 
                                sessionId={sessionId}
                                onNavigateToLog={handleNavigateToLog}
                            />
                        )}

                        {activeTab === 'power-search' && analysisData && (
                            <PowerSearch 
                                sessionId={sessionId} 
                                analysisData={analysisData}
                                nodes={nodes}
                                currentNodeId={activeNodeId}
                                initialQuery={powerSearchQuery}
                            />
                        )}

                        {activeTab === 'system' && analysisData && (
                            <SystemMetrics sessionId={sessionId} />
                        )}
                    </div>
                </div>

                {/* GitLab Duo Chat Widget */}
                {currentNode && analysisData && (
                    <DuoChatWidget
                        sessionId={sessionId}
                        analysisData={analysisData}
                        onNavigateToLog={handleNavigateToLog}
                        onExecuteSearch={handleExecuteSearch}
                    />
                )}
            </div>
        </ThemeProvider>
    );
}

export default App;
