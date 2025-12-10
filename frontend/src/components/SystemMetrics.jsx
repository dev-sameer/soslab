import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Activity, Server, RefreshCw, AlertTriangle, CheckCircle, Info,
    ChevronDown, ChevronRight, Terminal, HelpCircle, Zap, TrendingUp,
    BookOpen, HardDrive, Cpu, MemoryStick, Network, Clock, Database,
    AlertCircle, ChevronLeft, ChevronUp, Eye, EyeOff, Search, Filter,
    BarChart3, FileText, Gauge, Layers, Package, Shield, Settings,
    Copy, Download, Maximize2, AlertOctagon, Check, ThermometerSun,
    ArrowUp, ArrowDown, Minus, ExternalLink, Lightbulb, Target,
    HeartPulse, Flame, Snowflake, CircleDot, Sparkles, Brain
} from 'lucide-react';

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const HEALTH_STATUS = {
    CRITICAL: { color: '#dc2626', bg: 'rgba(220, 38, 38, 0.1)', border: 'rgba(220, 38, 38, 0.3)', label: 'Critical', icon: AlertOctagon },
    WARNING: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', label: 'Warning', icon: AlertTriangle },
    GOOD: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', label: 'Healthy', icon: CheckCircle },
    UNKNOWN: { color: '#64748b', bg: 'rgba(100, 116, 139, 0.1)', border: 'rgba(100, 116, 139, 0.3)', label: 'Unknown', icon: HelpCircle },
};

const CATEGORY_CONFIG = {
    critical: { label: 'Critical Metrics', icon: HeartPulse, color: '#dc2626', description: 'Essential health indicators - check these first' },
    performance: { label: 'Performance', icon: Zap, color: '#f59e0b', description: 'Detailed performance and throughput metrics' },
    diagnostics: { label: 'Diagnostics', icon: Activity, color: '#8b5cf6', description: 'System diagnostics and troubleshooting data' },
    storage: { label: 'Storage', icon: HardDrive, color: '#06b6d4', description: 'Disk space, filesystems, and I/O information' },
    network: { label: 'Network', icon: Network, color: '#3b82f6', description: 'Network configuration and connection stats' },
    system: { label: 'System Info', icon: Server, color: '#64748b', description: 'System configuration and static information' },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatNumber = (num, decimals = 1) => {
    if (num === null || num === undefined || isNaN(num)) return 'N/A';
    if (num >= 1000000) return (num / 1000000).toFixed(decimals) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(decimals) + 'K';
    return Number(num).toFixed(decimals);
};

const formatBytes = (bytes, decimals = 1) => {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return 'N/A';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(decimals) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(decimals) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(decimals) + ' KB';
    return bytes + ' B';
};

const getHealthStatus = (value, thresholds) => {
    if (value === null || value === undefined || isNaN(value)) return HEALTH_STATUS.UNKNOWN;
    if (thresholds.criticalAbove !== undefined && value > thresholds.criticalAbove) return HEALTH_STATUS.CRITICAL;
    if (thresholds.criticalBelow !== undefined && value < thresholds.criticalBelow) return HEALTH_STATUS.CRITICAL;
    if (thresholds.warningAbove !== undefined && value > thresholds.warningAbove) return HEALTH_STATUS.WARNING;
    if (thresholds.warningBelow !== undefined && value < thresholds.warningBelow) return HEALTH_STATUS.WARNING;
    return HEALTH_STATUS.GOOD;
};

const calculateOverallHealth = (metrics) => {
    if (!metrics || metrics.length === 0) return HEALTH_STATUS.UNKNOWN;
    const hasCritical = metrics.some(m => m.status === HEALTH_STATUS.CRITICAL);
    const hasWarning = metrics.some(m => m.status === HEALTH_STATUS.WARNING);
    if (hasCritical) return HEALTH_STATUS.CRITICAL;
    if (hasWarning) return HEALTH_STATUS.WARNING;
    return HEALTH_STATUS.GOOD;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const SystemMetrics = ({ sessionId }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('critical');
    const [showAllCommands, setShowAllCommands] = useState(false);
    const [showRawOutputs, setShowRawOutputs] = useState(false);
    const [expandedCommands, setExpandedCommands] = useState(new Set(['top_cpu', 'vmstat', 'free_m']));
    const [copiedCommand, setCopiedCommand] = useState(null);
    const [showHelp, setShowHelp] = useState(new Set());

    useEffect(() => {
        fetchData();
    }, [sessionId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/system-metrics/comprehensive/${sessionId}`);
            const result = await response.json();
            setData(result.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // Get all available commands
    const allAvailableCommands = useMemo(() => {
        if (!data || !data.available_commands) return [];
        return data.available_commands;
    }, [data]);

    // Dynamic command categories based on available commands
    const commandCategories = useMemo(() => {
        if (!data || !data.available_commands) return {};

        const available = data.available_commands;
        const categories = {
            critical: { ...CATEGORY_CONFIG.critical, commands: ['top_cpu', 'top_res', 'vmstat', 'free_m', 'df_hT', 'uptime'] },
            performance: { ...CATEGORY_CONFIG.performance, commands: ['iostat', 'iotop', 'mpstat', 'sar_cpu', 'sar_dev', 'sar_tcp', 'sar_mem'] },
            diagnostics: { ...CATEGORY_CONFIG.diagnostics, commands: ['ps', 'netstat', 'netstat_i', 'sockstat', 'ss', 'dmesg', 'lscpu', 'meminfo', 'slabtop'] },
            storage: { ...CATEGORY_CONFIG.storage, commands: ['df_inodes', 'lsblk', 'mount', 'fstab'] },
            network: { ...CATEGORY_CONFIG.network, commands: ['ifconfig', 'ip_address', 'netstat', 'ss', 'sockstat'] },
            system: { ...CATEGORY_CONFIG.system, commands: ['uname', 'hostname', 'date', 'systemctl_unit_files', 'sysctl_a', 'ulimit'] },
        };

        const filteredCategories = {};
        Object.entries(categories).forEach(([key, category]) => {
            const availableInCategory = category.commands.filter(cmd => available.includes(cmd));
            if (availableInCategory.length > 0) {
                filteredCategories[key] = { ...category, commands: availableInCategory };
            }
        });

        return filteredCategories;
    }, [data]);

    // Extract key metrics for health overview
    const healthMetrics = useMemo(() => {
        if (!data?.parsed_data) return [];

        const metrics = [];
        const pd = data.parsed_data;

        // Load Average
        if (pd.top_cpu?.header?.load_1min !== undefined) {
            const load = pd.top_cpu.header.load_1min;
            metrics.push({
                id: 'load',
                label: 'System Load',
                value: load,
                displayValue: load.toFixed(2),
                unit: '',
                description: 'Average number of processes waiting for CPU',
                status: getHealthStatus(load, { criticalAbove: 8, warningAbove: 4 }),
                thresholds: { good: '< 4', warning: '4-8', critical: '> 8' },
            });
        }

        // CPU Usage
        if (pd.top_cpu?.header?.cpu_idle !== undefined) {
            const cpuUsed = 100 - pd.top_cpu.header.cpu_idle;
            metrics.push({
                id: 'cpu',
                label: 'CPU Usage',
                value: cpuUsed,
                displayValue: cpuUsed.toFixed(0),
                unit: '%',
                description: 'Percentage of CPU being used',
                status: getHealthStatus(cpuUsed, { criticalAbove: 90, warningAbove: 80 }),
                thresholds: { good: '< 80%', warning: '80-90%', critical: '> 90%' },
            });
        }

        // Memory
        if (pd.free_m) {
            const mem = pd.free_m;
            const usedPct = mem.total_mb ? ((mem.used_mb || (mem.total_mb - (mem.available_mb || mem.free_mb))) / mem.total_mb * 100) : 0;
            metrics.push({
                id: 'memory',
                label: 'Memory Usage',
                value: usedPct,
                displayValue: usedPct.toFixed(0),
                unit: '%',
                description: 'Percentage of RAM being used',
                status: getHealthStatus(usedPct, { criticalAbove: 90, warningAbove: 80 }),
                thresholds: { good: '< 80%', warning: '80-90%', critical: '> 90%' },
            });
        }

        // Swap
        if (pd.vmstat?.samples) {
            const hasSwapping = pd.vmstat.samples.some(s => s.si > 0 || s.so > 0);
            metrics.push({
                id: 'swap',
                label: 'Swap Activity',
                value: hasSwapping ? 1 : 0,
                displayValue: hasSwapping ? 'Active' : 'None',
                unit: '',
                description: 'Whether system is using swap (disk as memory)',
                status: hasSwapping ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.GOOD,
                thresholds: { good: 'None', warning: '-', critical: 'Any activity' },
            });
        }

        // Disk
        if (pd.df_hT?.filesystems) {
            const rootFs = pd.df_hT.filesystems.find(fs => fs.mount === '/');
            if (rootFs) {
                metrics.push({
                    id: 'disk',
                    label: 'Root Disk',
                    value: rootFs.use_percent,
                    displayValue: rootFs.use_percent,
                    unit: '%',
                    description: 'Usage of the main system disk',
                    status: getHealthStatus(rootFs.use_percent, { criticalAbove: 90, warningAbove: 80 }),
                    thresholds: { good: '< 80%', warning: '80-90%', critical: '> 90%' },
                });
            }
        }

        // IO Wait
        if (pd.top_cpu?.header?.cpu_iowait !== undefined) {
            const iowait = pd.top_cpu.header.cpu_iowait;
            metrics.push({
                id: 'iowait',
                label: 'I/O Wait',
                value: iowait,
                displayValue: iowait.toFixed(1),
                unit: '%',
                description: 'CPU time waiting for disk operations',
                status: getHealthStatus(iowait, { criticalAbove: 30, warningAbove: 15 }),
                thresholds: { good: '< 15%', warning: '15-30%', critical: '> 30%' },
            });
        }

        return metrics;
    }, [data]);

    const overallHealth = useMemo(() => calculateOverallHealth(healthMetrics), [healthMetrics]);

    // Set default active tab
    useEffect(() => {
        const categoryKeys = Object.keys(commandCategories);
        if (categoryKeys.length > 0 && !commandCategories[activeTab]) {
            setActiveTab(categoryKeys[0]);
        }
    }, [commandCategories, activeTab]);

    const toggleCommand = useCallback((cmdName) => {
        setExpandedCommands(prev => {
            const next = new Set(prev);
            next.has(cmdName) ? next.delete(cmdName) : next.add(cmdName);
            return next;
        });
    }, []);

    const toggleHelp = useCallback((cmdName) => {
        setShowHelp(prev => {
            const next = new Set(prev);
            next.has(cmdName) ? next.delete(cmdName) : next.add(cmdName);
            return next;
        });
    }, []);

    if (loading) return <LoadingScreen />;
    if (!data) return <NoDataScreen />;

    const currentCategory = commandCategories[activeTab];
    const commandsToShow = showAllCommands ? allAvailableCommands : (currentCategory?.commands || []);

    return (
        <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
            {/* Header */}
            <Header
                data={data}
                onRefresh={fetchData}
                showRawOutputs={showRawOutputs}
                setShowRawOutputs={setShowRawOutputs}
                showAllCommands={showAllCommands}
                setShowAllCommands={setShowAllCommands}
                hasCategories={Object.keys(commandCategories).length > 0}
                overallHealth={overallHealth}
            />

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto p-4 space-y-4">
                    {/* Health Overview Dashboard */}
                    <HealthDashboard metrics={healthMetrics} overallHealth={overallHealth} />

                    {/* Critical Alerts Banner */}
                    <AlertBanner data={data} />

                    {/* Category Tabs */}
                    {!showAllCommands && Object.keys(commandCategories).length > 0 && (
                        <TabNavigation
                            categories={commandCategories}
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                        />
                    )}

                    {/* Command Cards */}
                    <div className="space-y-3">
                        {commandsToShow.map(cmdName => (
                            <CommandCard
                                key={cmdName}
                                cmdName={cmdName}
                                data={data.parsed_data[cmdName]}
                                showRawOutput={showRawOutputs}
                                isExpanded={expandedCommands.has(cmdName)}
                                showHelp={showHelp.has(cmdName)}
                                onToggle={() => toggleCommand(cmdName)}
                                onToggleHelp={() => toggleHelp(cmdName)}
                                copiedCommand={copiedCommand}
                                setCopiedCommand={setCopiedCommand}
                            />
                        ))}

                        {commandsToShow.length === 0 && (
                            <EmptyState
                                icon={Terminal}
                                title={showAllCommands ? 'No system commands available' : 'No commands in this category'}
                                description={showAllCommands ? 'Upload a system diagnostics archive to view metrics' : 'Try switching to "All Commands" view'}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// LOADING & EMPTY STATES
// ============================================================================

const LoadingScreen = () => (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 border-3 rounded-full animate-spin"
                    style={{ borderColor: 'var(--border-primary)', borderTopColor: 'var(--accent)' }} />
                <Server className="absolute inset-3 w-10 h-10" style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Parsing System Metrics</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Analyzing command outputs...</p>
        </div>
    </div>
);

const NoDataScreen = () => (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
            <Server className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No System Data Available</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Upload an SOS report to analyze system metrics</p>
        </div>
    </div>
);

const EmptyState = ({ icon: Icon, title, description }) => (
    <div className="text-center py-12 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        <Icon className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
    </div>
);

// ============================================================================
// HEADER
// ============================================================================

const Header = ({ data, onRefresh, showRawOutputs, setShowRawOutputs, showAllCommands, setShowAllCommands, hasCategories, overallHealth }) => (
    <div className="px-4 py-3" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                    background: `linear-gradient(135deg, ${overallHealth.color}, var(--bg-tertiary))`,
                    boxShadow: `0 0 20px ${overallHealth.color}30`
                }}>
                    <Activity className="w-5 h-5" style={{ color: 'white' }} />
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>System Metrics</h1>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{
                            background: overallHealth.bg,
                            color: overallHealth.color,
                            border: `1px solid ${overallHealth.border}`
                        }}>
                            {overallHealth.label}
                        </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {data.available_commands?.length || 0} commands · Real-time health analysis
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {hasCategories && (
                    <ToggleButton
                        active={showAllCommands}
                        onClick={() => setShowAllCommands(!showAllCommands)}
                        icon={Layers}
                        label={showAllCommands ? 'Categorized' : 'All Commands'}
                    />
                )}
                <ToggleButton
                    active={showRawOutputs}
                    onClick={() => setShowRawOutputs(!showRawOutputs)}
                    icon={showRawOutputs ? Eye : EyeOff}
                    label={showRawOutputs ? 'Raw' : 'Parsed'}
                />
                <button
                    onClick={onRefresh}
                    className="px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold smooth-transition"
                    style={{ background: 'var(--accent)', color: 'var(--bg-primary)' }}
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                </button>
            </div>
        </div>
    </div>
);

const ToggleButton = ({ active, onClick, icon: Icon, label }) => (
    <button
        onClick={onClick}
        className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 smooth-transition"
        style={{
            background: active ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
            border: '1px solid var(--border-primary)'
        }}
    >
        <Icon className="w-3.5 h-3.5" />
        {label}
    </button>
);

// ============================================================================
// HEALTH DASHBOARD
// ============================================================================

const HealthDashboard = ({ metrics, overallHealth }) => {
    if (metrics.length === 0) return null;

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            {/* Dashboard Header */}
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                <div className="flex items-center gap-2">
                    <HeartPulse className="w-4 h-4" style={{ color: overallHealth.color }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>System Health Overview</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Lightbulb className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Hover for details</span>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {metrics.map(metric => (
                    <MetricCard key={metric.id} metric={metric} />
                ))}
            </div>
        </div>
    );
};

const MetricCard = ({ metric }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const StatusIcon = metric.status.icon;

    return (
        <div
            className="relative p-3 rounded-xl smooth-transition cursor-help"
            style={{
                background: metric.status.bg,
                border: `1px solid ${metric.status.border}`,
            }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {/* Status Indicator */}
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{metric.label}</span>
                <StatusIcon className="w-3.5 h-3.5" style={{ color: metric.status.color }} />
            </div>

            {/* Value */}
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold" style={{ color: metric.status.color }}>{metric.displayValue}</span>
                {metric.unit && <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{metric.unit}</span>}
            </div>

            {/* Progress Bar (for percentage metrics) */}
            {metric.unit === '%' && typeof metric.value === 'number' && (
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                    <div
                        className="h-full rounded-full smooth-transition"
                        style={{
                            width: `${Math.min(metric.value, 100)}%`,
                            background: metric.status.color
                        }}
                    />
                </div>
            )}

            {/* Tooltip */}
            {showTooltip && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-lg shadow-xl"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{metric.label}</div>
                    <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{metric.description}</p>

                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full" style={{ background: HEALTH_STATUS.GOOD.color }} />
                            <span style={{ color: 'var(--text-tertiary)' }}>Good:</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{metric.thresholds.good}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full" style={{ background: HEALTH_STATUS.WARNING.color }} />
                            <span style={{ color: 'var(--text-tertiary)' }}>Warning:</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{metric.thresholds.warning}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full" style={{ background: HEALTH_STATUS.CRITICAL.color }} />
                            <span style={{ color: 'var(--text-tertiary)' }}>Critical:</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{metric.thresholds.critical}</span>
                        </div>
                    </div>

                    {/* Tooltip Arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
                        style={{ background: 'var(--bg-primary)', borderRight: '1px solid var(--border-primary)', borderBottom: '1px solid var(--border-primary)' }} />
                </div>
            )}
        </div>
    );
};

// ============================================================================
// ALERT BANNER
// ============================================================================

const AlertBanner = ({ data }) => {
    const alerts = useMemo(() => {
        const result = [];

        if (data.parsed_data?.vmstat?.samples) {
            const hasSwapping = data.parsed_data.vmstat.samples.some(s => s.si > 0 || s.so > 0);
            if (hasSwapping) {
                result.push({
                    type: 'critical',
                    icon: Flame,
                    title: 'Active Swapping Detected',
                    description: 'System is using disk as memory - severe performance impact',
                    action: 'Check memory usage and consider adding RAM or killing memory-hungry processes'
                });
            }
        }

        if (data.parsed_data?.top_cpu?.header) {
            const h = data.parsed_data.top_cpu.header;
            if (h.tasks_zombie > 10) {
                result.push({
                    type: 'warning',
                    icon: AlertTriangle,
                    title: `${h.tasks_zombie} Zombie Processes`,
                    description: 'Dead processes not properly cleaned up',
                    action: 'Identify parent processes and consider restarting affected services'
                });
            }
            if (h.load_1min > 10) {
                result.push({
                    type: 'critical',
                    icon: ThermometerSun,
                    title: `High System Load: ${h.load_1min.toFixed(2)}`,
                    description: 'More processes waiting than can be handled',
                    action: 'Identify CPU-intensive processes and consider scaling or optimization'
                });
            }
        }

        return result;
    }, [data]);

    if (alerts.length === 0) return null;

    return (
        <div className="space-y-2">
            {alerts.map((alert, idx) => (
                <div
                    key={idx}
                    className="rounded-xl p-3 flex items-start gap-3"
                    style={{
                        background: alert.type === 'critical' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        border: `1px solid ${alert.type === 'critical' ? 'rgba(220, 38, 38, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                    }}
                >
                    <alert.icon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{
                        color: alert.type === 'critical' ? '#dc2626' : '#f59e0b'
                    }} />
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold" style={{ color: alert.type === 'critical' ? '#dc2626' : '#f59e0b' }}>
                            {alert.title}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{alert.description}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                            <Lightbulb className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{alert.action}</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// ============================================================================
// TAB NAVIGATION
// ============================================================================

const TabNavigation = ({ categories, activeTab, setActiveTab }) => (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        <div className="flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {Object.entries(categories).map(([key, category]) => {
                const Icon = category.icon;
                const isActive = activeTab === key;

                return (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className="flex-shrink-0 px-4 py-3 flex items-center gap-2 smooth-transition relative"
                        style={{
                            background: isActive ? 'var(--bg-primary)' : 'transparent',
                            borderBottom: isActive ? `2px solid ${category.color}` : '2px solid transparent',
                        }}
                    >
                        <Icon className="w-4 h-4" style={{ color: isActive ? category.color : 'var(--text-tertiary)' }} />
                        <span className="text-xs font-medium" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {category.label}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full text-xs" style={{
                            background: isActive ? category.color : 'var(--bg-tertiary)',
                            color: isActive ? 'white' : 'var(--text-tertiary)',
                            fontSize: '10px'
                        }}>
                            {category.commands.length}
                        </span>
                    </button>
                );
            })}
        </div>
    </div>
);

// ============================================================================
// COMMAND CARD
// ============================================================================

const CommandCard = ({ cmdName, data, showRawOutput, isExpanded, showHelp, onToggle, onToggleHelp, copiedCommand, setCopiedCommand }) => {
    const cmdHelp = getCommandHelp(cmdName);

    const handleCopy = () => {
        if (data?.raw_output) {
            navigator.clipboard.writeText(data.raw_output);
            setCopiedCommand(cmdName);
            setTimeout(() => setCopiedCommand(null), 2000);
        }
    };

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
            {/* Command Header */}
            <div
                className="px-4 py-3 cursor-pointer smooth-transition"
                style={{ background: 'var(--bg-tertiary)' }}
                onClick={onToggle}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isExpanded ?
                            <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} /> :
                            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                        }
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${cmdHelp.color}20` }}>
                            <cmdHelp.icon className="w-4 h-4" style={{ color: cmdHelp.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {cmdHelp.title}
                            </h3>
                            <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                                {cmdHelp.subtitle}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                            onClick={onToggleHelp}
                            className="p-2 rounded-lg smooth-transition"
                            style={{
                                background: showHelp ? 'var(--accent)' : 'var(--bg-primary)',
                                color: showHelp ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                                border: '1px solid var(--border-primary)'
                            }}
                            title="Show detailed guide"
                        >
                            <Brain className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleCopy}
                            className="p-2 rounded-lg smooth-transition"
                            style={{
                                background: copiedCommand === cmdName ? '#10b981' : 'var(--bg-primary)',
                                color: copiedCommand === cmdName ? 'white' : 'var(--text-tertiary)',
                                border: '1px solid var(--border-primary)'
                            }}
                            title="Copy raw output"
                        >
                            {copiedCommand === cmdName ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Detailed Help Guide */}
            {showHelp && <DetailedHelpGuide cmdHelp={cmdHelp} />}

            {/* Command Content */}
            {isExpanded && (
                <div className="p-4">
                    {renderCommandContent(cmdName, data, showRawOutput)}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// DETAILED HELP GUIDE
// ============================================================================

const DetailedHelpGuide = ({ cmdHelp }) => (
    <div className="p-4 space-y-4" style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-primary)' }}>
        {/* What is this? */}
        <div>
            <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-4 h-4" style={{ color: '#3b82f6' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>What is this?</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{cmdHelp.whatIsThis}</p>
        </div>

        {/* Why does it matter? */}
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4" style={{ color: '#8b5cf6' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Why does it matter?</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{cmdHelp.whyItMatters}</p>
        </div>

        {/* How to read it */}
        <div>
            <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4" style={{ color: '#06b6d4' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>How to read it</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {cmdHelp.howToRead.map((item, idx) => (
                    <div key={idx} className="p-2 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                        <div className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>{item.field}</div>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.meaning}</p>
                        {item.goodValue && (
                            <div className="flex items-center gap-1 mt-1">
                                <CheckCircle className="w-3 h-3" style={{ color: '#10b981' }} />
                                <span className="text-xs" style={{ color: '#10b981' }}>Good: {item.goodValue}</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>

        {/* Red Flags */}
        <div>
            <div className="flex items-center gap-2 mb-2">
                <AlertOctagon className="w-4 h-4" style={{ color: '#dc2626' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Red flags to watch for</span>
            </div>
            <div className="space-y-1">
                {cmdHelp.redFlags.map((flag, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
                        <div>
                            <span className="text-xs font-medium" style={{ color: '#dc2626' }}>{flag.condition}</span>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{flag.meaning}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* Quick Tips */}
        {cmdHelp.quickTips && (
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4" style={{ color: '#f59e0b' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Quick tips</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {cmdHelp.quickTips.map((tip, idx) => (
                        <span key={idx} className="px-2 py-1 rounded-lg text-xs" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                            {tip}
                        </span>
                    ))}
                </div>
            </div>
        )}
    </div>
);

// ============================================================================
// COMMAND CONTENT RENDERERS
// ============================================================================

const renderCommandContent = (cmdName, data, showRawOutput) => {
    if (!data) return <EmptyState icon={AlertCircle} title="No data available" description="This command output was not found in the archive" />;

    if (data.error) {
        return (
            <div className="rounded-lg p-4" style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
                <p className="text-xs" style={{ color: '#dc2626' }}>Parse error: {data.error}</p>
                {data.raw_output && (
                    <pre className="mt-3 p-3 rounded-lg text-xs font-mono overflow-auto max-h-48" style={{ background: '#0f172a', color: '#22c55e' }}>
                        {data.raw_output}
                    </pre>
                )}
            </div>
        );
    }

    if (showRawOutput && data.raw_output) {
        return <RawOutput data={data} />;
    }

    // Command-specific renderers
    switch (cmdName) {
        case 'top_cpu':
        case 'top_res':
            return <TopOutput data={data} sortBy={cmdName === 'top_res' ? 'memory' : 'cpu'} />;
        case 'vmstat':
            return <VmstatOutput data={data} />;
        case 'free_m':
            return <MemoryOutput data={data} />;
        case 'df_hT':
            return <DiskOutput data={data} />;
        case 'iostat':
            return <IostatOutput data={data} />;
        case 'uptime':
            return <UptimeOutput data={data} />;
        case 'netstat':
            return <NetstatOutput data={data} />;
        case 'ps':
            return <ProcessOutput data={data} />;
        default:
            return <RawOutput data={data} />;
    }
};

// Top Output
const TopOutput = ({ data, sortBy }) => {
    const h = data.header || {};
    const processes = data.processes || [];

    const criticalProcesses = useMemo(() => {
        if (sortBy === 'memory') {
            return processes.filter(p => parseFloat(p.mem) > 1).slice(0, 10);
        }
        return processes.filter(p => parseFloat(p.cpu) > 5 || parseFloat(p.mem) > 10).slice(0, 10);
    }, [processes, sortBy]);

    return (
        <div className="space-y-4">
            {/* Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard
                    label="Load Average"
                    value={h.load_1min?.toFixed(2) || 'N/A'}
                    subtext={`5m: ${h.load_5min?.toFixed(2) || 'N/A'}`}
                    status={getHealthStatus(h.load_1min, { criticalAbove: 8, warningAbove: 4 })}
                    icon={Gauge}
                />
                <StatCard
                    label="CPU Usage"
                    value={h.cpu_idle ? `${(100 - h.cpu_idle).toFixed(0)}%` : 'N/A'}
                    subtext={`Idle: ${h.cpu_idle?.toFixed(1) || 0}%`}
                    status={getHealthStatus(h.cpu_idle, { criticalBelow: 10, warningBelow: 20 })}
                    icon={Cpu}
                />
                <StatCard
                    label="I/O Wait"
                    value={`${h.cpu_iowait?.toFixed(1) || 0}%`}
                    subtext="CPU waiting for disk"
                    status={getHealthStatus(h.cpu_iowait, { criticalAbove: 30, warningAbove: 15 })}
                    icon={HardDrive}
                />
                <StatCard
                    label="Memory Available"
                    value={h.mem_available_kb ? formatBytes(h.mem_available_kb * 1024) : 'N/A'}
                    subtext={h.mem_total_kb ? `of ${formatBytes(h.mem_total_kb * 1024)}` : ''}
                    status={getHealthStatus(h.mem_available_kb && h.mem_total_kb ? (h.mem_available_kb / h.mem_total_kb * 100) : 50, { criticalBelow: 10, warningBelow: 20 })}
                    icon={MemoryStick}
                />
                <StatCard
                    label="Total Tasks"
                    value={h.tasks_total || 'N/A'}
                    subtext={`Running: ${h.tasks_running || 0}`}
                    status={HEALTH_STATUS.GOOD}
                    icon={Layers}
                />
                <StatCard
                    label="Zombies"
                    value={h.tasks_zombie || 0}
                    subtext="Dead processes"
                    status={getHealthStatus(h.tasks_zombie || 0, { criticalAbove: 10, warningAbove: 0 })}
                    icon={AlertTriangle}
                />
            </div>

            {/* Top Processes */}
            {criticalProcesses.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                    <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                        <Target className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {sortBy === 'memory' ? 'Top Memory Consumers' : 'Top CPU Consumers'}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)' }}>
                                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>PID</th>
                                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>User</th>
                                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>CPU%</th>
                                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>MEM%</th>
                                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>RES</th>
                                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Command</th>
                                </tr>
                            </thead>
                            <tbody>
                                {criticalProcesses.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                        <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{p.pid}</td>
                                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{p.user}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{
                                            color: parseFloat(p.cpu) > 50 ? '#dc2626' : parseFloat(p.cpu) > 20 ? '#f59e0b' : 'var(--text-primary)'
                                        }}>{p.cpu}%</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{
                                            color: parseFloat(p.mem) > 30 ? '#dc2626' : parseFloat(p.mem) > 15 ? '#f59e0b' : 'var(--text-primary)'
                                        }}>{p.mem}%</td>
                                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{p.res || '-'}</td>
                                        <td className="px-3 py-2 truncate max-w-xs font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{p.command}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// Vmstat Output
const VmstatOutput = ({ data }) => {
    const samples = data.samples || [];
    if (!samples.length) return <RawOutput data={data} />;

    const hasSwapping = samples.some(s => s.si > 0 || s.so > 0);
    const avgIdle = samples.reduce((sum, s) => sum + s.id, 0) / samples.length;
    const maxWait = Math.max(...samples.map(s => s.wa));
    const problemSamples = samples.filter(s => s.si > 0 || s.so > 0 || s.wa > 30 || s.id < 20);

    return (
        <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                    label="Swap Activity"
                    value={hasSwapping ? 'ACTIVE' : 'None'}
                    subtext={hasSwapping ? 'Performance degraded!' : 'No swapping'}
                    status={hasSwapping ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.GOOD}
                    icon={hasSwapping ? Flame : Snowflake}
                />
                <StatCard
                    label="Avg CPU Idle"
                    value={`${avgIdle.toFixed(0)}%`}
                    subtext="Available CPU capacity"
                    status={getHealthStatus(avgIdle, { criticalBelow: 10, warningBelow: 20 })}
                    icon={Cpu}
                />
                <StatCard
                    label="Max I/O Wait"
                    value={`${maxWait.toFixed(0)}%`}
                    subtext="Highest disk wait"
                    status={getHealthStatus(maxWait, { criticalAbove: 50, warningAbove: 30 })}
                    icon={HardDrive}
                />
                <StatCard
                    label="Problem Samples"
                    value={problemSamples.length}
                    subtext={`of ${samples.length} total`}
                    status={getHealthStatus(problemSamples.length, { criticalAbove: samples.length * 0.5, warningAbove: 0 })}
                    icon={AlertCircle}
                />
            </div>

            {/* Problem Samples */}
            {problemSamples.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
                    <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(220, 38, 38, 0.1)', borderBottom: '1px solid rgba(220, 38, 38, 0.2)' }}>
                        <AlertOctagon className="w-4 h-4" style={{ color: '#dc2626' }} />
                        <span className="text-xs font-semibold" style={{ color: '#dc2626' }}>
                            Problem Samples ({problemSamples.length} of {samples.length})
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)' }}>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>#</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>r</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>b</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: '#dc2626' }}>si</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: '#dc2626' }}>so</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>us</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>sy</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>id</th>
                                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>wa</th>
                                </tr>
                            </thead>
                            <tbody>
                                {problemSamples.slice(0, 10).map((s, idx) => (
                                    <tr key={idx} style={{ background: 'rgba(220, 38, 38, 0.05)' }}>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-tertiary)' }}>{samples.indexOf(s) + 1}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>{s.r}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>{s.b}</td>
                                        <td className="px-3 py-2 text-center font-mono font-bold" style={{ color: s.si > 0 ? '#dc2626' : 'var(--text-tertiary)' }}>{s.si}</td>
                                        <td className="px-3 py-2 text-center font-mono font-bold" style={{ color: s.so > 0 ? '#dc2626' : 'var(--text-tertiary)' }}>{s.so}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>{s.us}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>{s.sy}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: s.id < 20 ? '#f59e0b' : 'var(--text-primary)' }}>{s.id}</td>
                                        <td className="px-3 py-2 text-center font-mono" style={{ color: s.wa > 30 ? '#dc2626' : 'var(--text-primary)' }}>{s.wa}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// Memory Output
const MemoryOutput = ({ data }) => {
    const total = data.total_mb || 0;
    const available = data.available_mb || data.free_mb || 0;
    const used = data.used_mb || (total - available);
    const usedPct = total ? (used / total * 100) : 0;
    const availPct = total ? (available / total * 100) : 0;
    const swapUsed = data.swap_used_mb || 0;
    const swapTotal = data.swap_total_mb || 0;

    const memoryStatus = getHealthStatus(usedPct, { criticalAbove: 90, warningAbove: 80 });

    return (
        <div className="space-y-4">
            {/* Main Memory Bar */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <MemoryStick className="w-4 h-4" style={{ color: memoryStatus.color }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Physical Memory</span>
                    </div>
                    <span className="text-sm font-bold" style={{ color: memoryStatus.color }}>
                        {usedPct.toFixed(1)}% used
                    </span>
                </div>

                {/* Visual Bar */}
                <div className="h-6 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-secondary)' }}>
                    <div
                        className="h-full flex items-center justify-center text-xs font-semibold smooth-transition"
                        style={{ width: `${usedPct}%`, background: memoryStatus.color, color: 'white' }}
                    >
                        {usedPct > 15 && `${(used / 1024).toFixed(1)}G Used`}
                    </div>
                    <div
                        className="h-full flex items-center justify-center text-xs font-semibold"
                        style={{ width: `${availPct}%`, background: '#10b98130', color: '#10b981' }}
                    >
                        {availPct > 15 && `${(available / 1024).toFixed(1)}G Free`}
                    </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-5 gap-3 mt-4">
                    <div className="text-center">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Total</div>
                        <div className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{(total / 1024).toFixed(1)}G</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Used</div>
                        <div className="text-sm font-bold font-mono" style={{ color: memoryStatus.color }}>{(used / 1024).toFixed(1)}G</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Available</div>
                        <div className="text-sm font-bold font-mono" style={{ color: '#10b981' }}>{(available / 1024).toFixed(1)}G</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Buff/Cache</div>
                        <div className="text-sm font-bold font-mono" style={{ color: 'var(--text-secondary)' }}>{((data.buff_cache_mb || 0) / 1024).toFixed(1)}G</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Swap Used</div>
                        <div className="text-sm font-bold font-mono" style={{ color: swapUsed > 0 ? '#dc2626' : 'var(--text-secondary)' }}>
                            {(swapUsed / 1024).toFixed(1)}G
                        </div>
                    </div>
                </div>
            </div>

            {/* Swap Warning */}
            {swapUsed > 0 && (
                <div className="rounded-xl p-3 flex items-start gap-3" style={{ background: 'rgba(220, 38, 38, 0.1)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#dc2626' }} />
                    <div>
                        <div className="text-sm font-semibold" style={{ color: '#dc2626' }}>Swap Memory In Use</div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            System is using {(swapUsed / 1024).toFixed(1)}G of swap space. This causes significant performance degradation.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

// Disk Output
const DiskOutput = ({ data }) => {
    const filesystems = data.filesystems || [];
    const criticalFs = filesystems.filter(fs => fs.use_percent > 90);
    const warningFs = filesystems.filter(fs => fs.use_percent > 80 && fs.use_percent <= 90);

    return (
        <div className="space-y-4">
            {/* Critical Alerts */}
            {criticalFs.length > 0 && (
                <div className="rounded-xl p-3" style={{ background: 'rgba(220, 38, 38, 0.1)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                    <div className="flex items-center gap-2 mb-2">
                        <AlertOctagon className="w-4 h-4" style={{ color: '#dc2626' }} />
                        <span className="text-xs font-bold" style={{ color: '#dc2626' }}>Critical: Low Disk Space</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {criticalFs.map((fs, idx) => (
                            <span key={idx} className="px-2 py-1 rounded-lg text-xs font-mono" style={{ background: 'rgba(220, 38, 38, 0.2)', color: '#dc2626' }}>
                                {fs.mount} ({fs.use_percent}%)
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Filesystem List */}
            <div className="space-y-2">
                {filesystems.map((fs, idx) => {
                    const status = getHealthStatus(fs.use_percent, { criticalAbove: 90, warningAbove: 80 });
                    return (
                        <div key={idx} className="rounded-lg p-3" style={{ background: 'var(--bg-primary)', border: `1px solid ${status.border}` }}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <HardDrive className="w-4 h-4" style={{ color: status.color }} />
                                    <span className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{fs.mount}</span>
                                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                                        {fs.type || 'unknown'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fs.available} free</span>
                                    <span className="text-sm font-bold" style={{ color: status.color }}>{fs.use_percent}%</span>
                                </div>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                                <div
                                    className="h-full rounded-full smooth-transition"
                                    style={{ width: `${fs.use_percent}%`, background: status.color }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Iostat Output
const IostatOutput = ({ data }) => {
    const devices = data.devices || {};

    return (
        <div className="space-y-3">
            {Object.entries(devices).map(([device, samples]) => {
                if (!samples.length) return null;
                const latest = samples[samples.length - 1];
                const avgAwait = samples.reduce((sum, s) => sum + (s.await || 0), 0) / samples.length;
                const maxUtil = Math.max(...samples.map(s => s.util || 0));
                const status = getHealthStatus(maxUtil, { criticalAbove: 90, warningAbove: 70 });

                return (
                    <div key={device} className="rounded-xl p-4" style={{ background: 'var(--bg-primary)', border: `1px solid ${status.border}` }}>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <HardDrive className="w-4 h-4" style={{ color: status.color }} />
                                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{device}</span>
                            </div>
                            {maxUtil > 90 && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'rgba(220, 38, 38, 0.2)', color: '#dc2626' }}>
                                    High Utilization
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                            <div>
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Avg Wait</span>
                                <div className="text-sm font-mono font-bold" style={{ color: avgAwait > 50 ? '#dc2626' : 'var(--text-primary)' }}>
                                    {avgAwait.toFixed(1)}ms
                                </div>
                            </div>
                            <div>
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max Util</span>
                                <div className="text-sm font-mono font-bold" style={{ color: status.color }}>
                                    {maxUtil.toFixed(0)}%
                                </div>
                            </div>
                            <div>
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Read</span>
                                <div className="text-sm font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {formatBytes((latest.rkB_s || 0) * 1024)}/s
                                </div>
                            </div>
                            <div>
                                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Write</span>
                                <div className="text-sm font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {formatBytes((latest.wkB_s || 0) * 1024)}/s
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Other outputs
const UptimeOutput = ({ data }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Uptime" value={data.uptime || 'N/A'} subtext="System running time" status={HEALTH_STATUS.GOOD} icon={Clock} />
        <StatCard label="Load 1m" value={data.load_1min?.toFixed(2) || 'N/A'} status={getHealthStatus(data.load_1min, { criticalAbove: 8, warningAbove: 4 })} icon={Gauge} />
        <StatCard label="Load 5m" value={data.load_5min?.toFixed(2) || 'N/A'} status={HEALTH_STATUS.GOOD} icon={Gauge} />
        <StatCard label="Load 15m" value={data.load_15min?.toFixed(2) || 'N/A'} status={HEALTH_STATUS.GOOD} icon={Gauge} />
    </div>
);

const NetstatOutput = ({ data }) => {
    const connections = data.connections || {};
    const hasCritical = connections['CLOSE_WAIT'] > 100 || connections['TIME_WAIT'] > 10000;

    return (
        <div className="space-y-4">
            {hasCritical && (
                <div className="rounded-xl p-3 flex items-start gap-3" style={{ background: 'rgba(220, 38, 38, 0.1)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#dc2626' }} />
                    <div>
                        <div className="text-sm font-semibold" style={{ color: '#dc2626' }}>High Connection Counts</div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            {connections['CLOSE_WAIT'] > 100 && `CLOSE_WAIT: ${connections['CLOSE_WAIT']} (possible connection leak). `}
                            {connections['TIME_WAIT'] > 10000 && `TIME_WAIT: ${connections['TIME_WAIT']} (possible port exhaustion).`}
                        </p>
                    </div>
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(connections).map(([state, count]) => (
                    <StatCard
                        key={state}
                        label={state}
                        value={formatNumber(count)}
                        status={
                            (state === 'CLOSE_WAIT' && count > 100) || (state === 'TIME_WAIT' && count > 10000)
                                ? HEALTH_STATUS.CRITICAL
                                : HEALTH_STATUS.GOOD
                        }
                        icon={Network}
                    />
                ))}
            </div>
        </div>
    );
};

const ProcessOutput = ({ data }) => {
    const states = data.process_states || {};
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="Total Processes" value={data.process_count || 0} status={HEALTH_STATUS.GOOD} icon={Layers} />
            {Object.entries(states).map(([state, count]) => (
                <StatCard
                    key={state}
                    label={state === 'D' ? 'D (Blocked)' : state === 'Z' ? 'Z (Zombie)' : state}
                    value={count}
                    status={state === 'D' || (state === 'Z' && count > 10) ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.GOOD}
                    icon={state === 'Z' ? AlertTriangle : CircleDot}
                />
            ))}
        </div>
    );
};

// Raw Output
const RawOutput = ({ data }) => (
    <pre className="font-mono text-xs p-4 rounded-xl overflow-auto" style={{
        background: '#0f172a',
        color: '#22c55e',
        maxHeight: '400px',
        border: '1px solid var(--border-primary)'
    }}>
        {data.raw_output || JSON.stringify(data, null, 2)}
    </pre>
);

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

const StatCard = ({ label, value, subtext, status = HEALTH_STATUS.GOOD, icon: Icon }) => (
    <div className="p-3 rounded-xl smooth-transition" style={{
        background: status.bg,
        border: `1px solid ${status.border}`
    }}>
        <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
            {Icon && <Icon className="w-3.5 h-3.5" style={{ color: status.color }} />}
        </div>
        <div className="text-lg font-bold" style={{ color: status.color }}>{value}</div>
        {subtext && <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{subtext}</div>}
    </div>
);

// ============================================================================
// COMPREHENSIVE COMMAND HELP DATABASE
// ============================================================================

const getCommandHelp = (cmdName) => {
    const helps = {
        top_cpu: {
            title: 'Process Monitor (CPU)',
            subtitle: 'Real-time process activity sorted by CPU usage',
            icon: Cpu,
            color: '#3b82f6',
            whatIsThis: 'The "top" command shows a real-time view of all processes running on your system, similar to Task Manager on Windows. This version is sorted by CPU usage, showing you which processes are consuming the most processing power.',
            whyItMatters: 'High CPU usage can cause slow application response times, delayed job processing, and overall system sluggishness. Identifying CPU-hungry processes helps you optimize performance and troubleshoot slowdowns.',
            howToRead: [
                { field: 'Load Average', meaning: 'Average number of processes waiting for CPU over 1, 5, and 15 minutes. Think of it like a queue at a coffee shop.', goodValue: 'Less than number of CPU cores' },
                { field: 'CPU% (us/sy/id/wa)', meaning: 'us=user apps, sy=system, id=idle (available), wa=waiting for disk. Idle should be high.', goodValue: 'id > 20%, wa < 15%' },
                { field: '%CPU per process', meaning: 'How much of total CPU capacity each process uses. 100% = one full CPU core.', goodValue: 'No single process > 80% sustained' },
                { field: '%MEM per process', meaning: 'Percentage of total RAM used by each process.', goodValue: 'No single process > 50%' },
                { field: 'RES (Resident Memory)', meaning: 'Actual physical RAM used by the process, not including shared libraries.', goodValue: 'Varies by application' },
                { field: 'Tasks (running/sleeping/zombie)', meaning: 'Process states. Running=active, Sleeping=waiting, Zombie=dead but not cleaned up.', goodValue: 'Zombies should be 0' },
            ],
            redFlags: [
                { condition: 'Load average > CPU cores', meaning: 'More work than CPUs can handle. System is overloaded and queuing processes.' },
                { condition: 'CPU idle < 10%', meaning: 'Almost no spare capacity. Any additional load will cause problems.' },
                { condition: 'I/O wait > 30%', meaning: 'CPU is spending too much time waiting for slow disk. Consider faster storage or caching.' },
                { condition: 'Zombie processes > 0', meaning: 'Parent processes not cleaning up children. May indicate application bugs.' },
                { condition: 'Single process using > 90% CPU', meaning: 'One process dominating system. Could be stuck in a loop or legitimately busy.' },
            ],
            quickTips: ['Check load vs CPU cores first', 'High wa% = disk bottleneck', 'Zombies need parent process restart'],
        },
        top_res: {
            title: 'Process Monitor (Memory)',
            subtitle: 'Real-time process activity sorted by memory usage',
            icon: MemoryStick,
            color: '#8b5cf6',
            whatIsThis: 'Same as top but sorted by memory (RES column) instead of CPU. Shows which processes are using the most RAM.',
            whyItMatters: 'Memory-hungry processes can cause the system to use swap (disk as memory), dramatically slowing everything down. Finding memory hogs is crucial for performance.',
            howToRead: [
                { field: 'RES (Resident)', meaning: 'Actual physical RAM used. This is the real memory footprint.', goodValue: 'Check against total RAM' },
                { field: 'VIRT (Virtual)', meaning: 'Total address space including shared libs and swap. Often much larger than RES.', goodValue: 'Can be very high, less important' },
                { field: '%MEM', meaning: 'Percentage of total system RAM used by this process.', goodValue: 'No process > 50% unless expected' },
                { field: 'SHR (Shared)', meaning: 'Memory that can be shared with other processes (like libraries).', goodValue: 'Higher is better for efficiency' },
            ],
            redFlags: [
                { condition: 'Process RES growing over time', meaning: 'Possible memory leak. Process may need restart or investigation.' },
                { condition: 'Total memory used > 90%', meaning: 'System will start swapping soon or already is. Critical performance impact.' },
                { condition: 'Single process using > 60% RAM', meaning: 'One process dominating memory. May need tuning or more RAM.' },
            ],
            quickTips: ['Focus on RES not VIRT', 'Watch for growing memory over time', 'High total = swap risk'],
        },
        vmstat: {
            title: 'Virtual Memory Statistics',
            subtitle: 'Memory, swap, and CPU statistics over time',
            icon: Activity,
            color: '#06b6d4',
            whatIsThis: 'vmstat provides snapshots of system memory, swap activity, and CPU usage at regular intervals. It\'s like a health monitor that takes readings every few seconds.',
            whyItMatters: 'This is one of the most important commands for detecting memory pressure and swap activity. Swapping is a major performance killer that vmstat reveals clearly.',
            howToRead: [
                { field: 'r (runnable)', meaning: 'Processes waiting for CPU time. Like people in line at a register.', goodValue: 'Less than 2x CPU cores' },
                { field: 'b (blocked)', meaning: 'Processes stuck waiting for I/O (usually disk). High numbers = disk bottleneck.', goodValue: 'Should be 0 or low' },
                { field: 'si (swap in)', meaning: 'Memory pages read FROM disk (swap). Any activity here means performance loss.', goodValue: 'Should always be 0' },
                { field: 'so (swap out)', meaning: 'Memory pages written TO disk (swap). System is desperate for RAM.', goodValue: 'Should always be 0' },
                { field: 'us/sy/id/wa', meaning: 'CPU time: user/system/idle/wait. id=available capacity, wa=waiting for disk.', goodValue: 'id > 20%, wa < 20%' },
                { field: 'cs (context switches)', meaning: 'How often CPU switches between processes. Very high = possible contention.', goodValue: 'Depends on workload' },
            ],
            redFlags: [
                { condition: 'si or so > 0', meaning: 'CRITICAL: System is swapping. Severe performance degradation. Add RAM or reduce memory usage immediately.' },
                { condition: 'b (blocked) consistently > 0', meaning: 'Processes stuck waiting for disk. Storage is too slow or overloaded.' },
                { condition: 'id (idle) < 10%', meaning: 'CPU completely saturated. No spare capacity for additional work.' },
                { condition: 'wa (wait) > 30%', meaning: 'CPU spending too much time waiting for disk. I/O bottleneck.' },
                { condition: 'r > 4x CPU cores', meaning: 'Severe CPU contention. Too many processes competing for limited CPUs.' },
            ],
            quickTips: ['si/so = 0 is critical', 'First line is average since boot', 'Watch for patterns in multiple samples'],
        },
        free_m: {
            title: 'Memory Usage',
            subtitle: 'Physical and swap memory statistics',
            icon: MemoryStick,
            color: '#10b981',
            whatIsThis: 'Shows how much RAM and swap space is being used. The "-m" means values are in megabytes for easier reading.',
            whyItMatters: 'Understanding memory usage helps you know if you need more RAM, if something is leaking memory, or if the system is about to start swapping.',
            howToRead: [
                { field: 'total', meaning: 'Total physical RAM installed in the system.', goodValue: 'Depends on workload needs' },
                { field: 'used', meaning: 'RAM currently in use by applications and system.', goodValue: 'Should leave some available' },
                { field: 'free', meaning: 'Completely unused RAM. Linux tries to use RAM for caching, so this is often low.', goodValue: 'Can be low if available is high' },
                { field: 'available', meaning: 'RAM that can be given to applications if needed (free + reclaimable cache). THIS IS THE KEY NUMBER.', goodValue: '> 10-20% of total' },
                { field: 'buff/cache', meaning: 'RAM used for disk caching. Can be reclaimed if needed. This is good!', goodValue: 'Higher is good for I/O performance' },
                { field: 'Swap used', meaning: 'Disk space being used as overflow memory. Should be avoided.', goodValue: 'Should be 0 for best performance' },
            ],
            redFlags: [
                { condition: 'available < 10% of total', meaning: 'System is running low on memory. May start swapping soon.' },
                { condition: 'Swap used > 0', meaning: 'System had to use disk as memory at some point. Performance was/is impacted.' },
                { condition: 'available decreasing over time', meaning: 'Possible memory leak. Something is consuming more and more RAM.' },
                { condition: 'buff/cache very low', meaning: 'Not enough RAM for disk caching. I/O performance will suffer.' },
            ],
            quickTips: ['Focus on "available" not "free"', 'buff/cache is good and reclaimable', 'Any swap usage = investigate'],
        },
        df_hT: {
            title: 'Disk Space Usage',
            subtitle: 'Filesystem usage with human-readable sizes',
            icon: HardDrive,
            color: '#f59e0b',
            whatIsThis: 'Shows how much disk space is used and available on each mounted filesystem. "-h" means human-readable (GB/MB), "-T" shows filesystem type.',
            whyItMatters: 'Running out of disk space can crash applications, corrupt databases, and prevent logs from being written. It\'s one of the most common causes of system failures.',
            howToRead: [
                { field: 'Filesystem', meaning: 'The device or mount source (like /dev/sda1 or an NFS path).', goodValue: 'N/A' },
                { field: 'Type', meaning: 'Filesystem type (ext4, xfs, nfs, etc.). Different types have different characteristics.', goodValue: 'ext4 or xfs for Linux' },
                { field: 'Size', meaning: 'Total capacity of the filesystem.', goodValue: 'N/A' },
                { field: 'Used', meaning: 'How much space is currently occupied by files.', goodValue: 'N/A' },
                { field: 'Avail', meaning: 'Free space remaining. Note: some space is reserved for root.', goodValue: '> 20% free recommended' },
                { field: 'Use%', meaning: 'Percentage of disk space used. THE KEY NUMBER.', goodValue: '< 80%' },
                { field: 'Mounted on', meaning: 'Where in the directory tree this filesystem appears.', goodValue: 'N/A' },
            ],
            redFlags: [
                { condition: '/ (root) > 85%', meaning: 'CRITICAL: System partition running low. Can prevent boot or cause crashes.' },
                { condition: '/var > 90%', meaning: 'HIGH: Logs and temp files live here. Can cause application failures.' },
                { condition: 'Any filesystem at 100%', meaning: 'EMERGENCY: No space left. Applications will fail to write data.' },
                { condition: '/tmp > 80%', meaning: 'Temporary files accumulating. May affect applications that need temp space.' },
            ],
            quickTips: ['Watch / and /var closely', '85% = time to clean up', '95% = urgent action needed'],
        },
        iostat: {
            title: 'I/O Statistics',
            subtitle: 'Disk performance and utilization metrics',
            icon: HardDrive,
            color: '#ec4899',
            whatIsThis: 'Shows detailed disk I/O statistics including throughput, latency, and utilization. Essential for diagnosing storage bottlenecks.',
            whyItMatters: 'Slow disk I/O is one of the most common performance problems. iostat helps identify if disks are overloaded or performing poorly.',
            howToRead: [
                { field: '%util', meaning: 'How busy the disk is. 100% means completely saturated with no spare capacity.', goodValue: '< 80%' },
                { field: 'await', meaning: 'Average time (ms) each I/O request waits. Includes queue time + service time.', goodValue: '< 10ms SSD, < 20ms HDD' },
                { field: 'r/s, w/s', meaning: 'Read and write operations per second (IOPS).', goodValue: 'Depends on workload' },
                { field: 'rkB/s, wkB/s', meaning: 'Throughput in kilobytes per second.', goodValue: 'Check against disk specs' },
                { field: 'avgqu-sz', meaning: 'Average queue length. How many requests waiting in line.', goodValue: '< 1 is ideal' },
                { field: 'svctm', meaning: 'Average service time. How long disk takes to complete each request.', goodValue: '< 5ms SSD, < 10ms HDD' },
            ],
            redFlags: [
                { condition: '%util > 90%', meaning: 'Disk is saturated. Adding more I/O will increase latency.' },
                { condition: 'await > 50ms', meaning: 'Very slow response time. Applications will feel sluggish.' },
                { condition: 'avgqu-sz consistently > 1', meaning: 'Requests queuing up. Disk can\'t keep up with demand.' },
                { condition: 'High %util but low throughput', meaning: 'Many small random I/Os. Consider caching or SSDs.' },
            ],
            quickTips: ['%util is the key metric', 'await includes queue time', 'First sample is since boot'],
        },
        uptime: {
            title: 'System Uptime',
            subtitle: 'How long the system has been running',
            icon: Clock,
            color: '#64748b',
            whatIsThis: 'Shows how long since the system was last rebooted, current time, number of users, and load averages.',
            whyItMatters: 'Uptime indicates system stability. Unexpected reboots can indicate hardware problems. Load averages show overall system demand.',
            howToRead: [
                { field: 'Current time', meaning: 'System clock time. Important for correlating with logs.', goodValue: 'Should be accurate (NTP)' },
                { field: 'up X days', meaning: 'Time since last reboot. Longer = more stable.', goodValue: 'Depends on maintenance schedule' },
                { field: 'X users', meaning: 'Number of logged-in user sessions (including SSH).', goodValue: 'Expected number' },
                { field: 'load average', meaning: 'Average runnable processes over 1, 5, 15 minutes.', goodValue: 'Less than CPU cores' },
            ],
            redFlags: [
                { condition: 'Very short uptime unexpectedly', meaning: 'System rebooted recently. Check for crashes or power issues.' },
                { condition: 'Load > 2x CPU cores', meaning: 'System is overloaded. More demand than capacity.' },
                { condition: 'Load increasing over 1→5→15', meaning: 'Problem is getting worse. Investigate immediately.' },
            ],
            quickTips: ['Load < cores = healthy', 'Watch the trend in load averages', 'Unexpected reboot = check logs'],
        },
        netstat: {
            title: 'Network Connections',
            subtitle: 'Active network connections and their states',
            icon: Network,
            color: '#3b82f6',
            whatIsThis: 'Shows all network connections, their states, and statistics. Useful for understanding network activity and diagnosing connection issues.',
            whyItMatters: 'Network problems like connection leaks, port exhaustion, or stuck connections can cause application failures and performance issues.',
            howToRead: [
                { field: 'ESTABLISHED', meaning: 'Active, working connections. Normal and expected.', goodValue: 'Expected for your apps' },
                { field: 'LISTEN', meaning: 'Server sockets waiting for connections. One per service/port.', goodValue: 'Expected services' },
                { field: 'TIME_WAIT', meaning: 'Connections being cleaned up. Normal but too many = port exhaustion.', goodValue: '< 10,000' },
                { field: 'CLOSE_WAIT', meaning: 'Connection closed by remote, waiting for app to close. Can indicate leaks.', goodValue: '< 100' },
                { field: 'FIN_WAIT', meaning: 'Closing connections. Should be temporary.', goodValue: 'Low numbers' },
                { field: 'SYN_RECV', meaning: 'Incoming connections being established. Many = possible attack.', goodValue: 'Very low' },
            ],
            redFlags: [
                { condition: 'CLOSE_WAIT > 100', meaning: 'Application not closing connections properly. Possible connection leak.' },
                { condition: 'TIME_WAIT > 10,000', meaning: 'Risk of port exhaustion. May need kernel tuning.' },
                { condition: 'Many SYN_RECV', meaning: 'Possible SYN flood attack or network problems.' },
                { condition: 'ESTABLISHED much higher than expected', meaning: 'More connections than anticipated. Check for issues.' },
            ],
            quickTips: ['CLOSE_WAIT = app bug', 'TIME_WAIT = busy server', 'Watch for connection counts growing'],
        },
        ps: {
            title: 'Process Status',
            subtitle: 'Snapshot of all running processes',
            icon: Layers,
            color: '#8b5cf6',
            whatIsThis: 'Shows a snapshot of all processes at a single point in time, including their states, resource usage, and relationships.',
            whyItMatters: 'Understanding process states helps identify stuck processes, resource hogs, and system health issues.',
            howToRead: [
                { field: 'R (Running)', meaning: 'Process is actively using CPU or ready to run.', goodValue: 'Normal' },
                { field: 'S (Sleeping)', meaning: 'Process is waiting for something (I/O, signal, etc.). Most processes are here.', goodValue: 'Normal' },
                { field: 'D (Uninterruptible)', meaning: 'Process is stuck in kernel, usually waiting for I/O. Cannot be killed.', goodValue: 'Should be 0 or very low' },
                { field: 'Z (Zombie)', meaning: 'Process finished but parent hasn\'t collected exit status. Doesn\'t use resources but indicates bug.', goodValue: 'Should be 0' },
                { field: 'T (Stopped)', meaning: 'Process is paused (e.g., Ctrl+Z or debugger).', goodValue: 'Only if expected' },
            ],
            redFlags: [
                { condition: 'D (uninterruptible) processes', meaning: 'Processes stuck in kernel. Usually disk/NFS problem.' },
                { condition: 'Z (zombie) processes', meaning: 'Dead processes not cleaned up. Parent process has a bug.' },
                { condition: 'Very high process count', meaning: 'May indicate fork bomb or runaway process creation.' },
                { condition: 'Many processes from one user', meaning: 'Possible runaway script or attack.' },
            ],
            quickTips: ['D state = I/O problem', 'Zombies need parent restart', 'Total count varies by system'],
        },
    };

    return helps[cmdName] || {
        title: cmdName.replace(/_/g, ' ').toUpperCase(),
        subtitle: 'System diagnostic command',
        icon: Terminal,
        color: '#64748b',
        whatIsThis: 'This is a system diagnostic command that provides information about your system\'s state and performance.',
        whyItMatters: 'System diagnostics help identify problems, monitor health, and troubleshoot issues.',
        howToRead: [
            { field: 'Output', meaning: 'Review the raw output for relevant information', goodValue: 'Depends on context' },
        ],
        redFlags: [
            { condition: 'Error messages', meaning: 'Indicates problems that need investigation' },
            { condition: 'Unexpected values', meaning: 'May indicate misconfiguration or issues' },
        ],
        quickTips: ['Compare with expected values', 'Look for error keywords', 'Check documentation'],
    };
};

export default SystemMetrics;