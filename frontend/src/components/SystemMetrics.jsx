import React, { useState, useEffect, useMemo } from 'react';
import {
    Activity, Server, RefreshCw, AlertTriangle, CheckCircle, Info,
    ChevronDown, ChevronRight, Terminal, HelpCircle, Zap, TrendingUp,
    BookOpen, HardDrive, Cpu, MemoryStick, Network, Clock, Database,
    AlertCircle, ChevronLeft, ChevronUp, Eye, EyeOff, Search, Filter,
    BarChart3, FileText, Gauge, Layers, Package, Shield, Settings,
    Copy, Download, Maximize2, AlertOctagon, Check
} from 'lucide-react';

// Main Component - More practical and usable
const SystemMetrics = ({ sessionId }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('critical');
    const [showAllCommands, setShowAllCommands] = useState(false);
    const [showRawOutputs, setShowRawOutputs] = useState(false);
    const [expandedCommands, setExpandedCommands] = useState(new Set(['top_cpu', 'vmstat', 'free_m']));
    const [copiedCommand, setCopiedCommand] = useState(null);

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

    // Get all available commands for "All Commands" view - must be before conditionals
    const allAvailableCommands = useMemo(() => {
        if (!data || !data.available_commands) return [];
        return data.available_commands;
    }, [data]);

    // Dynamic command categories based on available commands
    const commandCategories = useMemo(() => {
        if (!data || !data.available_commands) return {};

        const available = data.available_commands;

        // Define command groupings dynamically
        const categories = {
            critical: {
                label: 'Critical Metrics',
                icon: AlertOctagon,
                commands: ['top_cpu', 'top_res', 'vmstat', 'free_m', 'df_hT', 'uptime'],
                description: 'Essential system health indicators'
            },
            performance: {
                label: 'Performance',
                icon: TrendingUp,
                commands: ['iostat', 'iotop', 'mpstat', 'sar_cpu', 'sar_dev', 'sar_tcp', 'sar_mem'],
                description: 'Detailed performance metrics'
            },
            diagnostics: {
                label: 'Diagnostics',
                icon: Activity,
                commands: ['ps', 'netstat', 'netstat_i', 'sockstat', 'ss', 'dmesg', 'lscpu', 'meminfo', 'slabtop'],
                description: 'System diagnostics and troubleshooting'
            },
            storage: {
                label: 'Storage',
                icon: HardDrive,
                commands: ['df_inodes', 'lsblk', 'mount', 'fstab'],
                description: 'Storage and filesystem information'
            },
            network: {
                label: 'Network',
                icon: Network,
                commands: ['ifconfig', 'ip_address', 'netstat', 'ss', 'sockstat'],
                description: 'Network configuration and statistics'
            },
            system: {
                label: 'System Info',
                icon: Server,
                commands: ['uname', 'hostname', 'date', 'systemctl_unit_files', 'sysctl_a', 'ulimit'],
                description: 'System configuration and information'
            }
        };

        // Filter categories to only include those with available commands
        const filteredCategories = {};
        Object.entries(categories).forEach(([key, category]) => {
            const availableInCategory = category.commands.filter(cmd => available.includes(cmd));
            if (availableInCategory.length > 0) {
                filteredCategories[key] = {
                    ...category,
                    commands: availableInCategory
                };
            }
        });

        return filteredCategories;
    }, [data]);

    // Set default active tab to first available category
    const defaultActiveTab = useMemo(() => {
        const categoryKeys = Object.keys(commandCategories);
        return categoryKeys.length > 0 ? categoryKeys[0] : 'critical';
    }, [commandCategories]);

    // Update active tab if current tab is not available
    useEffect(() => {
        if (!commandCategories[activeTab] && defaultActiveTab !== activeTab) {
            setActiveTab(defaultActiveTab);
        }
    }, [commandCategories, activeTab, defaultActiveTab]);

    if (loading) {
        return <LoadingScreen />;
    }

    if (!data) {
        return <NoDataScreen />;
    }

    const currentCategory = commandCategories[activeTab];
    const availableInCategory = currentCategory?.commands || [];

    const commandsToShow = showAllCommands ? allAvailableCommands : availableInCategory;

    return (
        <div className="h-full flex flex-col overflow-hidden" style={{
            background: 'var(--bg-primary)',
            fontSize: '13px'
        }}>
            {/* Compact Header */}
            <Header
                data={data}
                onRefresh={fetchData}
                showRawOutputs={showRawOutputs}
                setShowRawOutputs={setShowRawOutputs}
                showAllCommands={showAllCommands}
                setShowAllCommands={setShowAllCommands}
                hasCategories={Object.keys(commandCategories).length > 0}
            />

            {/* Alert Bar - Only show if critical issues exist */}
            <AlertBar data={data} />

            {/* Tab Navigation - Only show if not in "All Commands" mode */}
            {!showAllCommands && Object.keys(commandCategories).length > 0 && (
                <TabNavigation
                    categories={commandCategories}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                />
            )}

            {/* Main Content - Full Width */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto p-4">
                    {/* Quick Summary Cards - Only show in critical tab or when no categories */}
                    {(activeTab === 'critical' || showAllCommands || Object.keys(commandCategories).length === 0) && <QuickSummary data={data} />}

                    {/* Command Outputs */}
                    <div className="space-y-4 mt-4">
                        {commandsToShow.map(cmdName => (
                            <PracticalCommandCard
                                key={cmdName}
                                cmdName={cmdName}
                                data={data.parsed_data[cmdName]}
                                showRawOutput={showRawOutputs}
                                isExpanded={expandedCommands.has(cmdName)}
                                onToggle={() => {
                                    const newExpanded = new Set(expandedCommands);
                                    if (newExpanded.has(cmdName)) {
                                        newExpanded.delete(cmdName);
                                    } else {
                                        newExpanded.add(cmdName);
                                    }
                                    setExpandedCommands(newExpanded);
                                }}
                                copiedCommand={copiedCommand}
                                setCopiedCommand={setCopiedCommand}
                            />
                        ))}
                    </div>

                    {/* Empty state when no commands available */}
                    {commandsToShow.length === 0 && (
                        <div className="text-center py-12">
                            <Terminal className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
                            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                                {showAllCommands ? 'No system commands available' : 'No commands in this category'}
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                {showAllCommands ? 'Upload a system diagnostics archive to view metrics' : 'Try switching to "All Commands" view'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Loading Screen
const LoadingScreen = () => (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 border-3 border-current border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                <Server className="absolute inset-2 w-12 h-12" style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Parsing System Metrics
            </p>
        </div>
    </div>
);

// No Data Screen
const NoDataScreen = () => (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
            <Server className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                No System Data Available
            </p>
        </div>
    </div>
);

// Compact Header
const Header = ({ data, onRefresh, showRawOutputs, setShowRawOutputs, showAllCommands, setShowAllCommands, hasCategories }) => (
    <div className="px-6 py-3" style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)'
    }}>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                    background: 'linear-gradient(135deg, var(--accent), var(--text-primary))'
                }}>
                    <Activity className="w-4 h-4" style={{ color: 'var(--bg-primary)' }} />
                </div>
                <div>
                    <h1 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        System Metrics
                    </h1>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {data.available_commands?.length || 0} commands available
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {/* All Commands toggle - only show if categories exist */}
                {hasCategories && (
                    <button
                        onClick={() => setShowAllCommands(!showAllCommands)}
                        className="px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition-all"
                        style={{
                            background: showAllCommands ? 'var(--accent)' : 'var(--bg-tertiary)',
                            color: showAllCommands ? 'var(--bg-primary)' : 'var(--text-secondary)',
                            border: '1px solid var(--border-primary)'
                        }}
                    >
                        <Layers className="w-3.5 h-3.5" />
                        {showAllCommands ? 'Categorized' : 'All Commands'}
                    </button>
                )}

                <button
                    onClick={() => setShowRawOutputs(!showRawOutputs)}
                    className="px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition-all"
                    style={{
                        background: showRawOutputs ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: showRawOutputs ? 'var(--bg-primary)' : 'var(--text-secondary)',
                        border: '1px solid var(--border-primary)'
                    }}
                >
                    {showRawOutputs ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    {showRawOutputs ? 'Raw' : 'Parsed'}
                </button>

                <button
                    onClick={onRefresh}
                    className="px-3 py-1.5 rounded flex items-center gap-2 text-xs font-medium"
                    style={{
                        background: 'var(--accent)',
                        color: 'var(--bg-primary)'
                    }}
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                </button>
            </div>
        </div>
    </div>
);

// Alert Bar - Only critical alerts
const AlertBar = ({ data }) => {
    const alerts = [];

    if (data.parsed_data?.vmstat?.samples) {
        const hasSwapping = data.parsed_data.vmstat.samples.some(s => s.si > 0 || s.so > 0);
        if (hasSwapping) {
            alerts.push({ type: 'critical', text: 'ACTIVE SWAPPING DETECTED' });
        }
    }

    if (data.parsed_data?.top_cpu?.header) {
        const h = data.parsed_data.top_cpu.header;
        if (h.tasks_zombie > 10) {
            alerts.push({ type: 'warning', text: `${h.tasks_zombie} ZOMBIE PROCESSES` });
        }
        if (h.load_1min > 10) {
            alerts.push({ type: 'critical', text: `LOAD: ${h.load_1min.toFixed(2)}` });
        }
    }

    if (alerts.length === 0) return null;

    return (
        <div className="px-6 py-2 flex items-center gap-4" style={{
            background: alerts.some(a => a.type === 'critical') ? '#dc262620' : '#f59e0b20',
            borderBottom: '1px solid var(--border-primary)'
        }}>
            <AlertCircle className="w-4 h-4" style={{
                color: alerts.some(a => a.type === 'critical') ? '#dc2626' : '#f59e0b'
            }} />
            {alerts.map((alert, idx) => (
                <span key={idx} className="text-xs font-bold" style={{
                    color: alert.type === 'critical' ? '#dc2626' : '#f59e0b'
                }}>
                    {alert.text}
                </span>
            ))}
        </div>
    );
};

// Tab Navigation - Dynamic and clean
const TabNavigation = ({ categories, activeTab, setActiveTab }) => (
    <div className="px-6 py-2" style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)'
    }}>
        <div className="flex items-center gap-1">
            {Object.entries(categories).map(([key, category]) => {
                const Icon = category.icon;
                const count = category.commands.length;
                const isActive = activeTab === key;

                return (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className="px-3 py-2 rounded-lg flex items-center gap-2 text-xs whitespace-nowrap transition-all"
                        style={{
                            background: isActive ? 'var(--accent)' : 'transparent',
                            color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)'
                        }}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="font-medium">{category.label}</span>
                        <span className="px-1.5 py-0.5 rounded text-xs font-semibold"
                            style={{
                                background: isActive ? 'rgba(0,0,0,0.2)' : 'var(--bg-tertiary)',
                                color: isActive ? 'var(--bg-primary)' : 'var(--text-tertiary)'
                            }}>
                            {count}
                        </span>
                    </button>
                );
            })}
        </div>
    </div>
);

// Quick Summary - Key metrics at a glance
const QuickSummary = ({ data }) => {
    const metrics = [];

    if (data.parsed_data?.top_cpu?.header) {
        const h = data.parsed_data.top_cpu.header;
        metrics.push({
            label: 'Load Average',
            value: h.load_1min?.toFixed(2) || 'N/A',
            subtext: `5m: ${h.load_5min?.toFixed(2) || 'N/A'}`,
            status: h.load_1min > 8 ? 'critical' : h.load_1min > 4 ? 'warning' : 'good',
            unit: ''
        });

        metrics.push({
            label: 'CPU Usage',
            value: h.cpu_idle ? `${(100 - h.cpu_idle).toFixed(0)}` : 'N/A',
            subtext: `IO Wait: ${h.cpu_iowait?.toFixed(1) || '0'}%`,
            status: h.cpu_idle < 10 ? 'critical' : h.cpu_idle < 20 ? 'warning' : 'good',
            unit: '%'
        });

        metrics.push({
            label: 'Processes',
            value: h.tasks_total || 'N/A',
            subtext: `Zombies: ${h.tasks_zombie || 0}`,
            status: h.tasks_zombie > 10 ? 'critical' : h.tasks_zombie > 0 ? 'warning' : 'good',
            unit: ''
        });
    }

    if (data.parsed_data?.free_m) {
        const mem = data.parsed_data.free_m;
        const usedPct = mem.total_mb ? ((mem.used_mb || (mem.total_mb - (mem.available_mb || mem.free_mb))) / mem.total_mb * 100) : 0;
        metrics.push({
            label: 'Memory Used',  // Changed from just 'Memory'
            value: usedPct.toFixed(0),
            subtext: `${((mem.available_mb || mem.free_mb || 0) / 1024).toFixed(1)}G available`,
            status: usedPct > 90 ? 'critical' : usedPct > 80 ? 'warning' : 'good',
            unit: '%'
        });
    }


    if (data.parsed_data?.df_hT?.filesystems) {
        const rootFs = data.parsed_data.df_hT.filesystems.find(fs => fs.mount === '/');
        if (rootFs) {
            metrics.push({
                label: 'Root Disk',
                value: rootFs.use_percent,
                subtext: `${rootFs.available} free`,
                status: rootFs.use_percent > 90 ? 'critical' : rootFs.use_percent > 80 ? 'warning' : 'good',
                unit: '%'
            });
        }
    }

    if (metrics.length === 0) {
        return null; // Don't show summary if no data
    }

    return (
        <div className="mb-6">
            <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                System Overview
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {metrics.map((metric, idx) => (
                    <div key={idx} className="p-3 rounded-lg" style={{
                        background: 'var(--bg-secondary)',
                        border: `1px solid ${metric.status === 'critical' ? '#dc262640' :
                                metric.status === 'warning' ? '#f59e0b40' :
                                    'var(--border-primary)'
                            }`
                    }}>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                            {metric.label}
                        </div>
                        <div className="text-lg font-bold flex items-baseline gap-1" style={{
                            color: metric.status === 'good' ? 'var(--text-primary)' :
                                metric.status === 'warning' ? '#f59e0b' : '#dc2626'
                        }}>
                            {metric.value}
                            <span className="text-xs">{metric.unit}</span>
                        </div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                            {metric.subtext}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Command Card with accurate information
const PracticalCommandCard = ({ cmdName, data, showRawOutput, isExpanded, onToggle, copiedCommand, setCopiedCommand }) => {
    const cmdHelp = getCommandHelp(cmdName);
    const [showHelp, setShowHelp] = useState(false);

    const handleCopy = () => {
        if (data?.raw_output) {
            navigator.clipboard.writeText(data.raw_output);
            setCopiedCommand(cmdName);
            setTimeout(() => setCopiedCommand(null), 2000);
        }
    };

    return (
        <div className="rounded-lg overflow-hidden" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)'
        }}>
            {/* Command Header */}
            <div className="px-4 py-3" style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '1px solid var(--border-primary)'
            }}>
                <div className="flex items-center justify-between">
                    <button
                        onClick={onToggle}
                        className="flex items-center gap-3 flex-1 text-left"
                    >
                        {isExpanded ?
                            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                            <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        }
                        <Terminal className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {cmdName.replace(/_/g, ' ').toUpperCase()}
                            </h3>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                {cmdHelp.description}
                            </p>
                        </div>
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowHelp(!showHelp)}
                            className="p-1.5 rounded transition-all"
                            style={{
                                background: showHelp ? 'var(--accent)' : 'transparent',
                                color: showHelp ? 'var(--bg-primary)' : 'var(--text-tertiary)'
                            }}
                            title="Show reading guide"
                        >
                            <HelpCircle className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleCopy}
                            className="p-1.5 rounded transition-all"
                            style={{
                                background: copiedCommand === cmdName ? '#10b981' : 'transparent',
                                color: copiedCommand === cmdName ? 'white' : 'var(--text-tertiary)'
                            }}
                            title="Copy raw output"
                        >
                            {copiedCommand === cmdName ?
                                <Check className="w-4 h-4" /> :
                                <Copy className="w-4 h-4" />
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* Help Section */}
            {showHelp && (
                <div className="px-4 py-3" style={{
                    background: 'var(--bg-primary)',
                    borderBottom: '1px solid var(--border-primary)'
                }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div>
                            <h4 className="font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <BookOpen className="w-3 h-3" />
                                How to Read:
                            </h4>
                            <ul className="space-y-1">
                                {cmdHelp.lookFor.map((item, idx) => (
                                    <li key={idx} style={{ color: 'var(--text-secondary)' }}>
                                        • {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <AlertTriangle className="w-3 h-3" />
                                Critical Indicators:
                            </h4>
                            <ul className="space-y-1">
                                {cmdHelp.redFlags.map((item, idx) => (
                                    <li key={idx} style={{ color: '#dc2626' }}>
                                        • {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Command Content */}
            {isExpanded && (
                <div className="p-4">
                    {renderPracticalContent(cmdName, data, showRawOutput)}
                </div>
            )}
        </div>
    );
};

// Practical content renderers
const renderPracticalContent = (cmdName, data, showRawOutput) => {
    if (!data) return <NoDataMessage />;

    if (data.error) {
        return (
            <div className="p-4 rounded" style={{ background: '#dc262610', border: '1px solid #dc262640' }}>
                <p className="text-xs" style={{ color: '#dc2626' }}>Parse error: {data.error}</p>
                {data.raw_output && (
                    <pre className="mt-3 p-2 rounded text-xs font-mono overflow-auto"
                        style={{ background: '#000', color: '#0f0', maxHeight: '200px' }}>
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
            return <TopOutput data={data} />;
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

// Top Output - Compact and useful
// Top Output - Compact and useful
const TopOutput = ({ data }) => {
    const h = data.header || {};
    const processes = data.processes || [];

    // Determine if this is sorted by RES or CPU
    const isSortedByRes = data._sort_by === 'RES';

    // Filter processes based on sort type
    const criticalProcesses = isSortedByRes
        ? processes.filter(p => parseFloat(p.mem) > 1).slice(0, 10)  // For RES sort, show high memory processes
        : processes.filter(p => parseFloat(p.cpu) > 50 || parseFloat(p.mem) > 30).slice(0, 10);  // For CPU sort

    // Filter out monitoring commands (top, ps, etc.) unless they're using significant resources
    const filteredProcesses = criticalProcesses.filter(p => {
        const cmd = (p.command || '').toLowerCase();
        const isMonitoringCmd = cmd.includes('top -') || cmd.includes('ps ') || cmd.includes('tail -');
        // Keep monitoring commands only if they're using significant resources
        return !isMonitoringCmd || parseFloat(p.cpu) > 10 || parseFloat(p.mem) > 5;
    });

    return (
        <div className="space-y-4">
            {/* Header Stats */}
            <div className="grid grid-cols-6 gap-3">
                <StatBlock label="Load" value={h.load_1min?.toFixed(2)} alert={h.load_1min > 8} />
                <StatBlock label="CPU%" value={h.cpu_idle ? (100 - h.cpu_idle).toFixed(0) : 'N/A'}
                    alert={h.cpu_idle < 10} />
                <StatBlock label="IO Wait%" value={h.cpu_iowait?.toFixed(1)} alert={h.cpu_iowait > 30} />
                <StatBlock label="Memory Available"  // Changed from "Memory Free"
                    value={h.mem_available_kb ? `${(h.mem_available_kb / 1024 / 1024).toFixed(1)}G` : 'N/A'}
                    alert={h.mem_available_kb && h.mem_total_kb && (h.mem_available_kb / h.mem_total_kb < 0.1)} />
                <StatBlock label="Tasks" value={h.tasks_total} />
                <StatBlock label="Zombies" value={h.tasks_zombie || 0} alert={h.tasks_zombie > 0} />
            </div>

            {/* Critical Processes */}
            {filteredProcesses.length > 0 && (
                <div>
                    <h4 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                        {isSortedByRes ? 'High Memory Processes:' : 'High Resource Processes:'}
                    </h4>
                    <div className="overflow-auto">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr style={{ background: 'var(--bg-primary)' }}>
                                    <th className="px-2 py-1 text-left">PID</th>
                                    <th className="px-2 py-1 text-left">USER</th>
                                    <th className="px-2 py-1 text-right">CPU%</th>
                                    <th className="px-2 py-1 text-right">MEM%</th>
                                    <th className="px-2 py-1 text-right">RES</th>
                                    <th className="px-2 py-1 text-left">COMMAND</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProcesses.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                        <td className="px-2 py-1">{p.pid}</td>
                                        <td className="px-2 py-1">{p.user}</td>
                                        <td className="px-2 py-1 text-right" style={{
                                            color: parseFloat(p.cpu) > 50 ? '#dc2626' : 'inherit'
                                        }}>{p.cpu}%</td>
                                        <td className="px-2 py-1 text-right" style={{
                                            color: parseFloat(p.mem) > 30 ? '#dc2626' : 'inherit'
                                        }}>{p.mem}%</td>
                                        <td className="px-2 py-1 text-right">{p.res || '-'}</td>
                                        <td className="px-2 py-1 truncate max-w-xs">{p.command}</td>
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

// Vmstat Output - Focus on problems
const VmstatOutput = ({ data }) => {
    const samples = data.samples || [];
    if (!samples.length) return <RawOutput data={data} />;

    const hasSwapping = samples.some(s => s.si > 0 || s.so > 0);
    const avgIdle = samples.reduce((sum, s) => sum + s.id, 0) / samples.length;
    const maxWait = Math.max(...samples.map(s => s.wa));
    const problemSamples = samples.filter(s => s.si > 0 || s.so > 0 || s.wa > 30 || s.id < 20);

    return (
        <div className="space-y-3">
            {/* Quick Analysis */}
            <div className="grid grid-cols-4 gap-3">
                <StatBlock label="Swapping" value={hasSwapping ? 'ACTIVE' : 'None'} alert={hasSwapping} />
                <StatBlock label="Avg Idle%" value={avgIdle.toFixed(0)} alert={avgIdle < 20} />
                <StatBlock label="Max Wait%" value={maxWait.toFixed(0)} alert={maxWait > 30} />
                <StatBlock label="Problems" value={problemSamples.length} alert={problemSamples.length > 0} />
            </div>

            {/* Problem Samples Only */}
            {problemSamples.length > 0 && (
                <div>
                    <h4 className="text-xs font-bold mb-2" style={{ color: '#dc2626' }}>
                        Problem Samples ({problemSamples.length} of {samples.length}):
                    </h4>
                    <div className="overflow-auto">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr style={{ background: 'var(--bg-primary)' }}>
                                    <th className="px-2 py-1">#</th>
                                    <th className="px-2 py-1">r</th>
                                    <th className="px-2 py-1">b</th>
                                    <th className="px-2 py-1 text-red-500">si</th>
                                    <th className="px-2 py-1 text-red-500">so</th>
                                    <th className="px-2 py-1">us</th>
                                    <th className="px-2 py-1">sy</th>
                                    <th className="px-2 py-1">id</th>
                                    <th className="px-2 py-1">wa</th>
                                </tr>
                            </thead>
                            <tbody>
                                {problemSamples.slice(0, 10).map((s, idx) => (
                                    <tr key={idx} style={{ background: '#dc262610' }}>
                                        <td className="px-2 py-1">{samples.indexOf(s) + 1}</td>
                                        <td className="px-2 py-1">{s.r}</td>
                                        <td className="px-2 py-1">{s.b}</td>
                                        <td className="px-2 py-1 font-bold" style={{ color: s.si > 0 ? '#dc2626' : 'inherit' }}>{s.si}</td>
                                        <td className="px-2 py-1 font-bold" style={{ color: s.so > 0 ? '#dc2626' : 'inherit' }}>{s.so}</td>
                                        <td className="px-2 py-1">{s.us}</td>
                                        <td className="px-2 py-1">{s.sy}</td>
                                        <td className="px-2 py-1" style={{ color: s.id < 20 ? '#f59e0b' : 'inherit' }}>{s.id}</td>
                                        <td className="px-2 py-1" style={{ color: s.wa > 30 ? '#dc2626' : 'inherit' }}>{s.wa}</td>
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

// Memory Output - Clear and simple
// Memory Output - Clear and simple
const MemoryOutput = ({ data }) => {
    const total = data.total_mb || 0;
    const available = data.available_mb || data.free_mb || 0;
    const used = data.used_mb || (total - available);
    const usedPct = total ? (used / total * 100) : 0;
    const availPct = total ? (available / total * 100) : 0;

    return (
        <div className="space-y-3">
            {/* Memory Bar */}
            <div>
                <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--text-secondary)' }}>Memory Usage</span>
                    <span style={{ color: usedPct > 90 ? '#dc2626' : 'var(--text-primary)' }}>
                        {usedPct.toFixed(1)}% used ({availPct.toFixed(1)}% available)
                    </span>
                </div>
                <div className="h-8 rounded overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                    <div className="h-full" style={{
                        width: `${usedPct}%`,
                        background: usedPct > 90 ? '#dc2626' : usedPct > 80 ? '#f59e0b' : '#10b981'
                    }} />
                </div>
            </div>

            {/* Details */}
            <div className="grid grid-cols-5 gap-2 text-xs">
                <div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Total</div>
                    <div className="font-mono font-bold">{(total / 1024).toFixed(1)}G</div>
                </div>
                <div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Used</div>
                    <div className="font-mono font-bold">{(used / 1024).toFixed(1)}G</div>
                </div>
                <div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Available</div>
                    <div className="font-mono font-bold" style={{ color: '#10b981' }}>{(available / 1024).toFixed(1)}G</div>
                </div>
                <div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Buff/Cache</div>
                    <div className="font-mono font-bold">{((data.buff_cache_mb || 0) / 1024).toFixed(1)}G</div>
                </div>
                <div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Swap Used</div>
                    <div className="font-mono font-bold" style={{
                        color: data.swap_used_mb > 0 ? '#dc2626' : 'inherit'
                    }}>{((data.swap_used_mb || 0) / 1024).toFixed(1)}G</div>
                </div>
            </div>
        </div>
    );
};

// Disk Output
const DiskOutput = ({ data }) => {
    const filesystems = data.filesystems || [];
    const criticalFs = filesystems.filter(fs => fs.use_percent > 80);

    return (
        <div className="space-y-2">
            {criticalFs.length > 0 && (
                <div className="p-2 rounded" style={{ background: '#dc262610', border: '1px solid #dc262640' }}>
                    <p className="text-xs font-bold" style={{ color: '#dc2626' }}>
                        Critical: {criticalFs.map(fs => `${fs.mount} (${fs.use_percent}%)`).join(', ')}
                    </p>
                </div>
            )}

            {filesystems.map((fs, idx) => (
                <div key={idx} className="flex items-center gap-3 text-xs">
                    <div className="w-24 font-mono">{fs.mount}</div>
                    <div className="flex-1">
                        <div className="h-4 rounded overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                            <div className="h-full" style={{
                                width: `${fs.use_percent}%`,
                                background: fs.use_percent > 90 ? '#dc2626' : fs.use_percent > 80 ? '#f59e0b' : '#10b981'
                            }} />
                        </div>
                    </div>
                    <div className="w-12 text-right font-mono">{fs.use_percent}%</div>
                    <div className="w-20 text-right" style={{ color: 'var(--text-tertiary)' }}>{fs.available}</div>
                </div>
            ))}
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

                return (
                    <div key={device} className="p-3 rounded" style={{
                        background: 'var(--bg-primary)',
                        border: maxUtil > 90 ? '1px solid #dc262640' : '1px solid var(--border-primary)'
                    }}>
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-xs">{device}</span>
                            {maxUtil > 90 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#dc262620', color: '#dc2626' }}>High Util</span>}
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                                <span style={{ color: 'var(--text-tertiary)' }}>Await: </span>
                                <span className="font-mono" style={{ color: avgAwait > 50 ? '#dc2626' : 'inherit' }}>
                                    {avgAwait.toFixed(1)}ms
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-tertiary)' }}>Util: </span>
                                <span className="font-mono" style={{ color: maxUtil > 90 ? '#dc2626' : 'inherit' }}>
                                    {maxUtil.toFixed(0)}%
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-tertiary)' }}>R: </span>
                                <span className="font-mono">{latest.rkB_s?.toFixed(0) || 0}KB/s</span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-tertiary)' }}>W: </span>
                                <span className="font-mono">{latest.wkB_s?.toFixed(0) || 0}KB/s</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Other simple outputs
const UptimeOutput = ({ data }) => (
    <div className="grid grid-cols-4 gap-3">
        <StatBlock label="Uptime" value={data.uptime || 'N/A'} />
        <StatBlock label="Load 1m" value={data.load_1min?.toFixed(2)} alert={data.load_1min > 8} />
        <StatBlock label="Load 5m" value={data.load_5min?.toFixed(2)} />
        <StatBlock label="Load 15m" value={data.load_15min?.toFixed(2)} />
    </div>
);

const NetstatOutput = ({ data }) => {
    const connections = data.connections || {};
    const critical = connections['CLOSE_WAIT'] > 100 || connections['TIME_WAIT'] > 10000;

    return (
        <div className="space-y-3">
            {critical && (
                <div className="p-2 rounded" style={{ background: '#dc262610', border: '1px solid #dc262640' }}>
                    <p className="text-xs" style={{ color: '#dc2626' }}>
                        Warning: High connection counts detected
                    </p>
                </div>
            )}
            <div className="grid grid-cols-4 gap-2">
                {Object.entries(connections).map(([state, count]) => (
                    <div key={state} className="text-xs">
                        <div style={{ color: 'var(--text-tertiary)' }}>{state}</div>
                        <div className="font-mono font-bold" style={{
                            color: (state === 'CLOSE_WAIT' && count > 100) ||
                                (state === 'TIME_WAIT' && count > 10000) ? '#dc2626' : 'var(--text-primary)'
                        }}>{count}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ProcessOutput = ({ data }) => {
    const states = data.process_states || {};
    return (
        <div className="grid grid-cols-6 gap-3">
            <StatBlock label="Total" value={data.process_count || 0} />
            {Object.entries(states).map(([state, count]) => (
                <StatBlock
                    key={state}
                    label={state}
                    value={count}
                    alert={state === 'D' || (state === 'Z' && count > 10)}
                />
            ))}
        </div>
    );
};

// Raw Output
const RawOutput = ({ data }) => (
    <pre className="font-mono text-xs p-3 rounded overflow-auto" style={{
        background: '#000',
        color: '#0f0',
        maxHeight: '400px',
        border: '1px solid var(--border-primary)'
    }}>
        {data.raw_output || JSON.stringify(data, null, 2)}
    </pre>
);

// Helper Components
const StatBlock = ({ label, value, alert }) => (
    <div className="p-2 rounded text-center" style={{
        background: alert ? '#dc262610' : 'var(--bg-primary)',
        border: `1px solid ${alert ? '#dc262640' : 'var(--border-primary)'}`
    }}>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
        <div className="font-mono font-bold" style={{ color: alert ? '#dc2626' : 'var(--text-primary)' }}>
            {value}
        </div>
    </div>
);

const NoDataMessage = () => (
    <div className="text-center py-4">
        <AlertCircle className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            No data available
        </p>
    </div>
);

// Command Help Database - Accurate and comprehensive
const getCommandHelp = (cmdName) => {
    const helps = {
        top_cpu: {
            description: 'Process activity monitor showing real-time CPU and memory usage',
            lookFor: [
                'Load average (1, 5, 15 min averages)',
                'CPU states (%user, %system, %idle, %iowait)',
                'Memory usage (total, free, available)',
                'Process count and states (running, sleeping, zombie)',
                'Top CPU-consuming processes'
            ],
            redFlags: [
                'Load average > number of CPU cores',
                'CPU idle < 10% (high utilization)',
                'High I/O wait (>30%) indicates disk bottleneck',
                'Zombie processes (Z state) > 0',
                'Memory available < 10% of total'
            ]
        },
        top_res: {
            description: 'Process activity monitor sorted by memory (RES) usage',
            lookFor: [
                'Memory usage per process (RES column)',
                'Virtual memory size (VIRT column)',
                'Memory percentage (%MEM column)',
                'Process states and priorities'
            ],
            redFlags: [
                'Processes using excessive memory (>50% each)',
                'High virtual memory usage',
                'Memory leaks (gradually increasing RES)',
                'Out of memory conditions'
            ]
        },
        vmstat: {
            description: 'Virtual memory statistics and system performance counters',
            lookFor: [
                'Process run queue (r column) - should be < CPU cores',
                'Swap activity (si/so) - should be 0',
                'CPU idle percentage (id) - should be >20%',
                'I/O wait (wa) - should be <30%',
                'Context switches (cs) - high values indicate contention'
            ],
            redFlags: [
                'Any swap in/out activity (si/so > 0)',
                'CPU idle consistently <20%',
                'I/O wait >30% indicates disk bottleneck',
                'Run queue > CPU count indicates CPU saturation',
                'High interrupt rates'
            ]
        },
        free_m: {
            description: 'Memory usage statistics in megabytes',
            lookFor: [
                'Available memory (should be >10% of total)',
                'Swap used (should be 0 for optimal performance)',
                'Buffer/cache (kernel disk cache)',
                'Memory pressure indicators'
            ],
            redFlags: [
                'Available memory < 10% of total RAM',
                'Any swap usage (performance degradation)',
                'No buffer/cache (inefficient disk I/O)',
                'Memory fragmentation'
            ]
        },
        df_hT: {
            description: 'Disk filesystem usage with human-readable sizes and types',
            lookFor: [
                'Use% column (filesystem utilization)',
                'Available space in human-readable format',
                'Filesystem types (ext4, xfs, etc.)',
                'Mount points and device names'
            ],
            redFlags: [
                'Any filesystem > 90% used',
                'Root filesystem (/) > 80% used',
                '/var or /tmp > 85% used',
                'No space available on critical filesystems'
            ]
        },
        iostat: {
            description: 'I/O statistics for storage devices and partitions',
            lookFor: [
                'Device utilization (%util) - should be <90%',
                'Average wait time (await) - response time',
                'Read/write operations per second (r/s, w/s)',
                'Data transfer rates (rkB/s, wkB/s)',
                'Queue size (avgqu-sz)'
            ],
            redFlags: [
                'Device utilization >90% (device saturated)',
                'Average wait >50ms (SSD) or >100ms (HDD)',
                'Very high queue sizes',
                'Inconsistent I/O patterns'
            ]
        },
        uptime: {
            description: 'System uptime and load average information',
            lookFor: [
                'System uptime duration',
                'Load averages (1, 5, 15 minute)',
                'Number of logged-in users',
                'Current time'
            ],
            redFlags: [
                'Load average > CPU core count',
                'Very short uptime (frequent reboots)',
                'Load increasing over time',
                'System instability indicators'
            ]
        },
        netstat: {
            description: 'Network connection statistics and socket information',
            lookFor: [
                'Connection states (ESTABLISHED, LISTEN, etc.)',
                'Protocol usage (TCP, UDP)',
                'Local and foreign addresses',
                'Connection counts by state'
            ],
            redFlags: [
                'CLOSE_WAIT > 100 (connection leaks)',
                'TIME_WAIT > 10000 (connection exhaustion)',
                'Many connections in FIN_WAIT states',
                'Network connectivity issues'
            ]
        },
        ps: {
            description: 'Process status snapshot showing all running processes',
            lookFor: [
                'Process states (R=running, S=sleeping, D=uninterruptible, Z=zombie)',
                'Total process count',
                'Process hierarchy (PPID)',
                'Resource usage patterns'
            ],
            redFlags: [
                'Uninterruptible processes (D state) - system hangs',
                'Zombie processes (Z state) > 0',
                'Excessive process count (>1000)',
                'Resource exhaustion'
            ]
        },
        lscpu: {
            description: 'CPU architecture and processing unit information',
            lookFor: [
                'CPU socket and core counts',
                'Architecture type',
                'CPU model and frequency',
                'Cache sizes and hierarchy'
            ],
            redFlags: [
                'Mismatched CPU configurations',
                'Unsupported architectures',
                'Hardware compatibility issues'
            ]
        },
        meminfo: {
            description: 'Detailed kernel memory statistics from /proc/meminfo',
            lookFor: [
                'Total and available memory',
                'Kernel memory usage',
                'Huge page allocation',
                'Memory zone information'
            ],
            redFlags: [
                'Low available memory',
                'High kernel memory usage',
                'Memory allocation failures',
                'NUMA imbalance issues'
            ]
        },
        dmesg: {
            description: 'Kernel ring buffer messages showing system events',
            lookFor: [
                'Hardware detection messages',
                'Driver initialization',
                'Error and warning messages',
                'System event timestamps'
            ],
            redFlags: [
                'Hardware errors or failures',
                'Driver initialization failures',
                'Kernel warnings and errors',
                'System stability issues'
            ]
        }
    };

    return helps[cmdName] || {
        description: 'System diagnostic command output',
        lookFor: ['Review output for anomalies', 'Check for error conditions', 'Verify expected values'],
        redFlags: ['Error messages', 'Warning conditions', 'Unexpected values', 'Resource exhaustion']
    };
};

export default SystemMetrics;