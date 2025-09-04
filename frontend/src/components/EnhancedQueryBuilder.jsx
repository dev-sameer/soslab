import React, { useState, useCallback } from 'react';
import { Plus, X, Search, Zap, Info, ChevronDown } from 'lucide-react';

// Enhanced Query Builder UI with comma-separated value support - Using PowerSearch styles
const EnhancedQueryBuilder = ({ onQueryChange, onSearch }) => {
    const [filters, setFilters] = useState([]);
    const [showHelp, setShowHelp] = useState(false);
    
    // Common filter templates
    const filterTemplates = [
        { 
            label: 'Service Errors', 
            field: 'service', 
            values: ['rails', 'sidekiq', 'gitaly'],
            additionalFilter: 'severity:error'
        },
        { 
            label: '5xx Errors', 
            field: 'status', 
            values: ['500', '502', '503', '504']
        },
        { 
            label: 'High Severity', 
            field: 'severity', 
            values: ['error', 'critical', 'fatal']
        },
        {
            label: 'Slow Requests',
            field: 'duration',
            operator: '>',
            value: '1000'
        }
    ];
    
    const addFilter = useCallback(() => {
        setFilters([...filters, {
            id: Date.now(),
            field: 'service',
            operator: ':',
            values: [''],
            isMultiple: false
        }]);
    }, [filters]);
    
    const updateFilter = useCallback((id, updates) => {
        setFilters(filters.map(f => 
            f.id === id ? { ...f, ...updates } : f
        ));
    }, [filters]);
    
    const removeFilter = useCallback((id) => {
        setFilters(filters.filter(f => f.id !== id));
    }, [filters]);
    
    const addValue = useCallback((filterId) => {
        setFilters(filters.map(f => {
            if (f.id === filterId) {
                return {
                    ...f,
                    values: [...f.values, ''],
                    isMultiple: true
                };
            }
            return f;
        }));
    }, [filters]);
    
    const updateValue = useCallback((filterId, index, value) => {
        setFilters(filters.map(f => {
            if (f.id === filterId) {
                const newValues = [...f.values];
                newValues[index] = value;
                return { ...f, values: newValues };
            }
            return f;
        }));
    }, [filters]);
    
    const removeValue = useCallback((filterId, index) => {
        setFilters(filters.map(f => {
            if (f.id === filterId) {
                const newValues = f.values.filter((_, i) => i !== index);
                return { 
                    ...f, 
                    values: newValues,
                    isMultiple: newValues.length > 1
                };
            }
            return f;
        }));
    }, [filters]);
    
    const buildQuery = useCallback(() => {
        const parts = filters.map(filter => {
            const field = filter.field;
            const operator = filter.operator;
            
            if (filter.isMultiple) {
                // Build comma-separated values
                const validValues = filter.values.filter(v => v.trim());
                if (validValues.length === 0) return null;
                
                // Quote values that contain spaces
                const quotedValues = validValues.map(v => 
                    v.includes(' ') ? `"${v}"` : v
                );
                
                return `${field}${operator}${quotedValues.join(',')}`;
            } else {
                const value = filter.values[0];
                if (!value.trim()) return null;
                
                // Quote if contains spaces
                const quotedValue = value.includes(' ') ? `"${value}"` : value;
                return `${field}${operator}${quotedValue}`;
            }
        }).filter(Boolean);
        
        return parts.join(' AND ');
    }, [filters]);
    
    const applyTemplate = useCallback((template) => {
        const newFilter = {
            id: Date.now(),
            field: template.field,
            operator: template.operator || ':',
            values: template.values || [template.value],
            isMultiple: Array.isArray(template.values)
        };
        
        setFilters([...filters, newFilter]);
        
        if (template.additionalFilter) {
            // Parse and add additional filter
            const [field, value] = template.additionalFilter.split(':');
            setFilters(prev => [...prev, {
                id: Date.now() + 1,
                field,
                operator: ':',
                values: [value],
                isMultiple: false
            }]);
        }
    }, [filters]);
    
    return (
        <div className="space-y-4 p-4 rounded-lg" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)'
        }}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Zap className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                    Query Builder
                </h3>
                <button
                    onClick={() => setShowHelp(!showHelp)}
                    className="p-1 rounded smooth-transition"
                    style={{
                        background: 'transparent',
                        color: 'var(--text-secondary)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-tertiary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                    }}
                >
                    <Info className="w-5 h-5" />
                </button>
            </div>
            
            {/* Help Panel */}
            {showHelp && (
                <div className="p-3 rounded text-sm" style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)'
                }}>
                    <p className="font-medium mb-1">Comma-Separated Values:</p>
                    <ul className="list-disc list-inside space-y-1" style={{ color: 'var(--text-secondary)' }}>
                        <li>Use commas to match any of multiple values</li>
                        <li>Example: <code className="px-1 rounded" style={{
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)'
                        }}>service:rails,sidekiq</code></li>
                        <li>Wildcards work too: <code className="px-1 rounded" style={{
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)'
                        }}>service:rail*,*worker</code></li>
                        <li>Quote values with spaces: <code className="px-1 rounded" style={{
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)'
                        }}>user:"John Doe","Jane Smith"</code></li>
                    </ul>
                </div>
            )}
            
            {/* Quick Templates */}
            <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Quick filters:</span>
                {filterTemplates.map((template, idx) => (
                    <button
                        key={idx}
                        onClick={() => applyTemplate(template)}
                        className="px-3 py-1 text-sm rounded smooth-transition btn-secondary"
                    >
                        {template.label}
                    </button>
                ))}
            </div>
            
            {/* Filters */}
            <div className="space-y-2">
                {filters.map((filter) => (
                    <div key={filter.id} className="p-3 rounded" style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-primary)'
                    }}>
                        <div className="flex items-start gap-2">
                            {/* Field selector */}
                            <select
                                value={filter.field}
                                onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                                className="px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-current"
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <option value="service">service</option>
                                <option value="status">status</option>
                                <option value="severity">severity</option>
                                <option value="level">level</option>
                                <option value="duration">duration</option>
                                <option value="path">path</option>
                                <option value="method">method</option>
                                <option value="user">user</option>
                                <option value="message">message</option>
                            </select>
                            
                            {/* Operator */}
                            <select
                                value={filter.operator}
                                onChange={(e) => updateFilter(filter.id, { operator: e.target.value })}
                                className="px-2 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-current"
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <option value=":">:</option>
                                <option value="=">＝</option>
                                <option value="!=">≠</option>
                                <option value=">">＞</option>
                                <option value="<">＜</option>
                                <option value=">=">≥</option>
                                <option value="<=">≤</option>
                                <option value="~">∼</option>
                            </select>
                            
                            {/* Values */}
                            <div className="flex-1">
                                <div className="flex flex-wrap gap-2">
                                    {filter.values.map((value, idx) => (
                                        <div key={idx} className="flex items-center gap-1">
                                            <input
                                                type="text"
                                                value={value}
                                                onChange={(e) => updateValue(filter.id, idx, e.target.value)}
                                                placeholder={filter.isMultiple ? `Value ${idx + 1}` : "Value"}
                                                className="px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-current"
                                                style={{
                                                    background: 'var(--bg-primary)',
                                                    border: '1px solid var(--border-primary)',
                                                    color: 'var(--text-primary)'
                                                }}
                                            />
                                            {filter.isMultiple && (
                                                <button
                                                    onClick={() => removeValue(filter.id, idx)}
                                                    className="p-1 rounded smooth-transition"
                                                    style={{
                                                        color: '#ef4444',
                                                        background: 'transparent'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = '#fee2e2';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = 'transparent';
                                                    }}
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                            {idx === filter.values.length - 1 && (
                                                <button
                                                    onClick={() => addValue(filter.id)}
                                                    className="p-1 rounded smooth-transition"
                                                    style={{
                                                        color: 'var(--accent)',
                                                        background: 'transparent'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = 'var(--bg-tertiary)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    title="Add another value"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {filter.isMultiple && (
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                        Matches any of these values (OR)
                                    </p>
                                )}
                            </div>
                            
                            {/* Remove filter */}
                            <button
                                onClick={() => removeFilter(filter.id)}
                                className="p-1 rounded smooth-transition"
                                style={{
                                    color: '#ef4444',
                                    background: 'transparent'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#fee2e2';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                }}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            
            {/* Add Filter Button */}
            <button
                onClick={addFilter}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded smooth-transition btn-secondary"
            >
                <Plus className="w-4 h-4" />
                Add Filter
            </button>
            
            {/* Query Preview */}
            <div className="rounded p-3" style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)'
            }}>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Query Preview:</p>
                <code className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                    {buildQuery() || '(empty)'}
                </code>
            </div>
            
            {/* Search Button */}
            <button
                onClick={() => {
                    const query = buildQuery();
                    onQueryChange(query);
                    onSearch(query);
                }}
                disabled={!buildQuery()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded font-medium smooth-transition btn-primary disabled:opacity-50"
            >
                <Search className="w-4 h-4" />
                Search
            </button>
        </div>
    );
};

// Integration into PowerSearch component - add this inside the PowerSearch component
const PowerSearchWithQueryBuilder = () => {
    const [showQueryBuilder, setShowQueryBuilder] = useState(false);
    
    return (
        <>
            {/* Add this button in the PowerSearch header section */}
            <button
                onClick={() => setShowQueryBuilder(!showQueryBuilder)}
                className="px-3 py-1.5 text-sm rounded smooth-transition btn-secondary flex items-center gap-1"
            >
                <Zap className="w-4 h-4" />
                Query Builder
                <ChevronDown className={`w-3 h-3 transition-transform ${showQueryBuilder ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Add this below the main query input */}
            {showQueryBuilder && (
                <div className="mt-4">
                    <EnhancedQueryBuilder
                        onQueryChange={(q) => setQuery(q)}
                        onSearch={(q) => {
                            setQuery(q);
                            executeSearch();
                        }}
                    />
                </div>
            )}
        </>
    );
};

export default EnhancedQueryBuilder;