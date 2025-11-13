import React, { useState, useMemo, useCallback } from 'react';
import { CheckCircle, AlertCircle, XCircle, Download, ChevronDown, ChevronRight, Copy, CheckCircle2, FileText, Hash } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const AIAnalysisDisplay = ({ duoAnalysis, onExport }) => {
    const [expandedPatterns, setExpandedPatterns] = useState({});
    const [copiedCode, setCopiedCode] = useState(null);

    if (!duoAnalysis || !duoAnalysis.analyses || duoAnalysis.analyses.length === 0) {
        return null;
    }

    const togglePattern = (idx) => {
        setExpandedPatterns(prev => ({
            ...prev,
            [idx]: !prev[idx]
        }));
    };

    const copyToClipboard = useCallback((text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedCode(id);
        setTimeout(() => setCopiedCode(null), 2000);
    }, []);

    // Monochrome severity colors - using only grays and blacks
    const getSeverityColor = (severity) => {
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return '#000000';  // Black for critical
            case 'ERROR': return '#404040';      // Dark gray for error
            case 'WARNING': return '#808080';    // Medium gray for warning
            default: return 'var(--text-secondary)';
        }
    };

    const getSeverityIcon = (severity) => {
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return <XCircle className="w-4 h-4" strokeWidth={2} />;
            case 'ERROR': return <AlertCircle className="w-4 h-4" strokeWidth={2} />;
            case 'WARNING': return <AlertCircle className="w-4 h-4" strokeWidth={2} />;
            default: return <AlertCircle className="w-4 h-4" strokeWidth={2} />;
        }
    };

    const successfulAnalyses = duoAnalysis.analyses.filter(a => !a.failed);
    const failedAnalyses = duoAnalysis.analyses.filter(a => a.failed);

    // Memoized markdown components matching DuoChatWidget style
    const markdownComponents = useMemo(() => ({
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;

            if (inline) {
                return (
                    <code
                        className="px-1.5 py-0.5 rounded text-xs"
                        style={{
                            background: 'rgba(128, 128, 128, 0.08)',
                            color: 'var(--text-primary)',
                            fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                            fontSize: '12px',
                            letterSpacing: '0.02em',
                            padding: '2px 6px',
                            borderRadius: '4px'
                        }}
                        {...props}
                    >
                        {children}
                    </code>
                );
            }

            const language = match ? match[1] : '';
            const showLanguage = language && language.toLowerCase() !== 'plaintext' && language.toLowerCase() !== 'text';

            return (
                <div className="relative group my-3">
                    <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                        {showLanguage && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{
                                background: 'rgba(0,0,0,0.05)',
                                color: 'var(--text-tertiary)',
                                fontSize: '9px',
                                fontWeight: '500',
                                letterSpacing: '0.02em',
                                textTransform: 'uppercase',
                                opacity: 0.6
                            }}>
                                {language}
                            </span>
                        )}
                        <button
                            onClick={() => copyToClipboard(codeString, codeId)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded text-xs flex items-center gap-1"
                            style={{
                                background: 'rgba(0,0,0,0.05)',
                                color: 'var(--text-secondary)',
                                fontSize: '11px',
                                fontWeight: '500',
                                letterSpacing: '0.01em'
                            }}
                        >
                            {copiedCode === codeId ? (
                                <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="w-3 h-3" />
                                    Copy
                                </>
                            )}
                        </button>
                    </div>

                    <pre style={{
                        background: 'rgba(0,0,0,0.02)',
                        border: '1px solid rgba(0,0,0,0.06)',
                        borderRadius: '8px',
                        padding: '12px',
                        paddingTop: showLanguage ? '28px' : '12px',
                        overflow: 'auto',
                        fontSize: '12px',
                        lineHeight: '1.5',
                        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                        maxHeight: '400px'
                    }}>
                        <code style={{
                            color: 'var(--text-primary)',
                            background: 'transparent',
                            padding: 0,
                            fontSize: 'inherit',
                            fontFamily: 'inherit',
                            letterSpacing: '0.02em'
                        }}>
                            {codeString}
                        </code>
                    </pre>
                </div>
            );
        },

        p: ({ children }) => (
            <p className="my-3 leading-relaxed" style={{
                color: 'var(--text-primary)',
                margin: '0.75em 0',
                fontSize: '13px',
                letterSpacing: '0.01em',
                lineHeight: '1.6'
            }}>
                {children}
            </p>
        ),

        h1: ({ children }) => (
            <h1 className="text-2xl font-semibold mt-5 mb-3" style={{
                color: 'var(--text-primary)',
                fontWeight: '700',
                fontSize: '20px',
                letterSpacing: '-0.02em'
            }}>
                {children}
            </h1>
        ),

        h2: ({ children }) => (
            <h2 className="text-xl font-semibold mt-4 mb-2" style={{
                color: 'var(--text-primary)',
                fontWeight: '600',
                fontSize: '17px',
                letterSpacing: '-0.01em'
            }}>
                {children}
            </h2>
        ),

        h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-3 mb-2" style={{
                color: 'var(--text-primary)',
                fontWeight: '600',
                fontSize: '15px',
                letterSpacing: '-0.01em'
            }}>
                {children}
            </h3>
        ),

        ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1" style={{
                color: 'var(--text-primary)',
                paddingLeft: '0',
                fontSize: '13px',
                lineHeight: '1.6'
            }}>
                {children}
            </ul>
        ),

        ol: ({ children, start }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1"
                start={start}
                style={{
                    color: 'var(--text-primary)',
                    paddingLeft: '0',
                    fontSize: '13px',
                    lineHeight: '1.6'
                }}>
                {children}
            </ol>
        ),

        li: ({ children }) => (
            <li className="leading-relaxed" style={{
                marginTop: '0.25em',
                marginBottom: '0.25em',
                letterSpacing: '0.01em'
            }}>
                {children}
            </li>
        ),

        blockquote: ({ children }) => (
            <blockquote className="my-3 pl-3 border-l-2 italic" style={{
                borderColor: 'rgba(0, 0, 0, 0.08)',
                color: 'var(--text-secondary)',
                paddingLeft: '0.75em',
                marginLeft: '0',
                fontSize: '13px',
                letterSpacing: '0.01em'
            }}>
                {children}
            </blockquote>
        ),

        a: ({ href, children }) => (
            <a
                href={href}
                className="underline decoration-1 underline-offset-2 hover:no-underline"
                style={{
                    color: 'var(--text-primary)',
                    textDecorationColor: 'currentColor',
                    fontSize: 'inherit',
                    fontWeight: '500'
                }}
                target="_blank"
                rel="noopener noreferrer"
            >
                {children}
            </a>
        ),

        strong: ({ children }) => (
            <strong style={{ fontWeight: '600', letterSpacing: '-0.01em' }}>
                {children}
            </strong>
        ),

        em: ({ children }) => (
            <em style={{ fontStyle: 'italic' }}>
                {children}
            </em>
        ),

        hr: () => (
            <hr className="my-4" style={{
                borderTop: '1px solid rgba(0, 0, 0, 0.06)',
                borderBottom: 'none'
            }} />
        ),

        table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
                <table className="min-w-full border-collapse" style={{
                    fontSize: '12px',
                    borderSpacing: '0'
                }}>
                    {children}
                </table>
            </div>
        ),

        thead: ({ children }) => (
            <thead style={{
                borderBottom: '1px solid rgba(0, 0, 0, 0.08)'
            }}>
                {children}
            </thead>
        ),

        tbody: ({ children }) => (
            <tbody>
                {children}
            </tbody>
        ),

        tr: ({ children }) => (
            <tr style={{
                borderBottom: '1px solid rgba(0, 0, 0, 0.04)'
            }}>
                {children}
            </tr>
        ),

        th: ({ children, style, align }) => (
            <th
                className="px-3 py-2 text-left font-semibold"
                style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    textAlign: align || 'left',
                    fontSize: '11px',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    ...style
                }}
            >
                {children}
            </th>
        ),

        td: ({ children, style, align }) => (
            <td
                className="px-3 py-2"
                style={{
                    color: 'var(--text-primary)',
                    textAlign: align || 'left',
                    fontSize: '12px',
                    ...style
                }}
            >
                {children}
            </td>
        ),

        pre: ({ children }) => <>{children}</>,
    }), [copiedCode, copyToClipboard]);

    return (
        <div className="space-y-4">
            {/* Summary Banner - Pure Monochrome Style */}
            <div className="p-4 rounded-xl" style={{
                background: 'var(--bg-secondary)',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{
                            background: 'var(--text-primary)',
                            color: 'var(--bg-primary)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                        }}>
                            <CheckCircle className="w-5 h-5" strokeWidth={2} />
                        </div>
                        <div>
                            <h3 className="font-semibold" style={{
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                                fontWeight: '600',
                                letterSpacing: '-0.01em'
                            }}>
                                AI Analysis Complete
                            </h3>
                            <p className="text-sm" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                marginTop: '2px'
                            }}>
                                {successfulAnalyses.length} of {duoAnalysis.analyses.length} patterns analyzed
                                {failedAnalyses.length > 0 && ` • ${failedAnalyses.length} failed`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onExport}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                        style={{
                            background: 'var(--text-primary)',
                            color: 'var(--bg-primary)',
                            fontSize: '11px',
                            fontWeight: '600',
                            letterSpacing: '0.02em',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                        }}>
                        <Download className="w-3 h-3 inline mr-1" strokeWidth={2} />
                        Export All
                    </button>
                </div>
            </div>

            {/* Individual Pattern Analyses - Monochrome Cards */}
            <div className="space-y-3">
                {duoAnalysis.analyses.map((analysis, idx) => {
                    const isExpanded = expandedPatterns[idx];
                    const error = analysis.error;
                    
                    return (
                        <div 
                            key={idx}
                            className="rounded-xl overflow-hidden transition-all"
                            style={{ 
                                background: 'var(--bg-secondary)', 
                                border: `1px solid ${analysis.failed ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0,0,0,0.06)'}`,
                                boxShadow: isExpanded ? '0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)'
                            }}
                        >
                            {/* Pattern Header - Clickable */}
                            <div 
                                className="p-4 cursor-pointer hover:bg-opacity-95 transition-all"
                                style={{ 
                                    background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                                    borderBottom: isExpanded ? '1px solid rgba(0,0,0,0.06)' : 'none'
                                }}
                                onClick={() => togglePattern(idx)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3 flex-1">
                                        <button className="mt-0.5 transition-transform" style={{
                                            color: 'var(--text-secondary)',
                                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'
                                        }}>
                                            <ChevronDown className="w-4 h-4" strokeWidth={2} />
                                        </button>
                                        
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ 
                                                    background: 'var(--text-primary)', 
                                                    color: 'var(--bg-primary)',
                                                    fontSize: '10px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.03em'
                                                }}>
                                                    #{analysis.pattern_number}
                                                </span>
                                                
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded"
                                                    style={{ 
                                                        background: `${getSeverityColor(error.severity)}15`,
                                                        border: `1px solid ${getSeverityColor(error.severity)}30`
                                                    }}>
                                                    {getSeverityIcon(error.severity)}
                                                    <span className="text-xs font-semibold" style={{
                                                        color: getSeverityColor(error.severity),
                                                        fontSize: '11px',
                                                        fontWeight: '600',
                                                        letterSpacing: '0.02em'
                                                    }}>
                                                        {error.severity}
                                                    </span>
                                                </div>
                                                
                                                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ 
                                                    background: 'rgba(0,0,0,0.04)',
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    fontWeight: '500',
                                                    letterSpacing: '0.01em'
                                                }}>
                                                    {error.component}
                                                </span>
                                                
                                                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ 
                                                    background: 'rgba(0,0,0,0.04)',
                                                    color: 'var(--text-primary)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    letterSpacing: '0.01em'
                                                }}>
                                                    {error.count.toLocaleString()}×
                                                </span>
                                            </div>
                                            
                                            <p className="text-sm line-clamp-2 font-mono" style={{ 
                                                color: 'var(--text-primary)',
                                                fontSize: '12px',
                                                letterSpacing: '0.01em',
                                                lineHeight: '1.5',
                                                fontFamily: '"SF Mono", "Monaco", monospace'
                                            }}>
                                                {error.message}
                                            </p>
                                            
                                            {error.files && error.files.length > 0 && (
                                                <div className="flex items-center gap-1.5 mt-2">
                                                    <FileText className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} strokeWidth={2} />
                                                    <p className="text-xs font-mono truncate" style={{ 
                                                        color: 'var(--text-tertiary)',
                                                        fontSize: '10px',
                                                        letterSpacing: '0.01em',
                                                        fontFamily: '"SF Mono", "Monaco", monospace'
                                                    }}>
                                                        {error.files[0]}
                                                        {error.files.length > 1 && ` +${error.files.length - 1} more`}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {analysis.failed && (
                                        <span className="text-xs px-2 py-1 rounded font-medium" style={{
                                            background: 'rgba(0, 0, 0, 0.1)',
                                            color: 'var(--text-primary)',
                                            fontSize: '10px',
                                            fontWeight: '600',
                                            letterSpacing: '0.02em'
                                        }}>
                                            Failed
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* AI Analysis Content - Beautiful Typography */}
                            {isExpanded && (
                                <div className="p-6 animate-fadeIn" style={{ 
                                    background: 'var(--bg-primary)',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                                }}>
                                    {analysis.failed ? (
                                        <div className="text-center py-12">
                                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{
                                                background: 'rgba(0, 0, 0, 0.05)',
                                                border: '1px solid rgba(0, 0, 0, 0.2)'
                                            }}>
                                                <XCircle className="w-8 h-8" style={{ color: 'var(--text-primary)' }} strokeWidth={2} />
                                            </div>
                                            <p className="text-sm font-medium" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '13px',
                                                letterSpacing: '0.01em'
                                            }}>
                                                AI analysis failed for this pattern
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="message-content" style={{
                                            color: 'var(--text-primary)',
                                            lineHeight: '1.6',
                                            fontSize: '13px',
                                            letterSpacing: '0.01em'
                                        }}>
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {(() => {
                                                    let text = analysis.analysis;
                                                    if (typeof text === 'string') {
                                                        // Handle escaped newlines and other escape sequences
                                                        text = text
                                                            .replace(/\\n/g, '\n')
                                                            .replace(/\\t/g, '\t')
                                                            .replace(/\\"/g, '"')
                                                            .replace(/\\'/g, "'");
                                                        
                                                        // Decode HTML entities like \u003c to <
                                                        text = text
                                                            .replace(/\\u003c/gi, '<')
                                                            .replace(/\\u003e/gi, '>')
                                                            .replace(/\\u0026/gi, '&')
                                                            .replace(/\\u0027/gi, "'")
                                                            .replace(/\\u0022/gi, '"');
                                                        
                                                        // If it starts with a quote, it might be JSON-encoded
                                                        if (text.startsWith('"') && text.endsWith('"')) {
                                                            try {
                                                                text = JSON.parse(text);
                                                            } catch (e) {
                                                                // Not JSON, just remove quotes
                                                                text = text.slice(1, -1);
                                                            }
                                                        }
                                                    }
                                                    return text;
                                                })()}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Custom Styles */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .animate-fadeIn { 
                    animation: fadeIn 0.3s ease-out; 
                }
                
                .message-content * { 
                    color: inherit !important; 
                }
                
                .message-content p:first-child {
                    margin-top: 0;
                }
                
                .message-content p:last-child {
                    margin-bottom: 0;
                }
                
                @media (prefers-color-scheme: dark) {
                    .message-content code:not(pre code) { 
                        background: rgba(255, 255, 255, 0.08) !important;
                    }
                }
                
                @media (prefers-color-scheme: light) {
                    .message-content code:not(pre code) { 
                        background: rgba(0, 0, 0, 0.04) !important;
                    }
                }
            `}</style>
        </div>
    );
};

export default AIAnalysisDisplay;