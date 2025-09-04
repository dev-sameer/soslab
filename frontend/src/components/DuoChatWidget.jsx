import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    MessageCircle, X, Send, Minimize2, Maximize2,
    Bot, User, Loader, Search, FileText, AlertCircle,
    Sparkles, ChevronDown, Hash, Copy, ExternalLink,
    AlertTriangle, CheckCircle, Info, XCircle, Code,
    Terminal, FileCode, Database, GitBranch, Server,
    Clock, ArrowRight, CheckCircle2, Zap, Settings, Plus
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

// Memoized Message Content Renderer (keeping exactly the same)
const MessageContent = React.memo(({ content, role }) => {
    const [copiedCode, setCopiedCode] = useState(null);

    const copyToClipboard = useCallback((text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedCode(id);
        setTimeout(() => setCopiedCode(null), 2000);
    }, []);

    if (role === 'user') {
        return <div className="text-sm leading-relaxed" style={{
            color: 'var(--bg-primary, #ffffff)',
            fontSize: '13px',
            letterSpacing: '0.01em',
            lineHeight: '1.6'
        }}>{content}</div>;
    }

    // Memoized markdown components (keeping all the same styles)
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
                            color: 'var(--text-primary, #e0e0e0)',
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

            return (
                <div className="relative group my-3">
                    <div className="absolute top-0 right-0 flex items-center gap-1 p-2 z-10">
                        {language && (
                            <span className="text-xs px-2 py-0.5 rounded" style={{
                                background: 'rgba(0,0,0,0.05)',
                                color: 'var(--text-secondary)',
                                fontSize: '10px',
                                fontWeight: '600',
                                letterSpacing: '0.03em',
                                textTransform: 'uppercase'
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
                        padding: '16px',
                        paddingTop: language ? '40px' : '16px',
                        overflow: 'auto',
                        fontSize: '12px',
                        lineHeight: '1.6',
                        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace'
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
                    color: 'var(--accent)',
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
        <div className="message-content text-sm" style={{
            color: 'var(--text-primary)',
            lineHeight: '1.6',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            letterSpacing: '0.01em'
        }}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.content === nextProps.content && prevProps.role === nextProps.role;
});

const DuoChatWidget = ({ sessionId, analysisData, onNavigateToLog, onExecuteSearch }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [threadId, setThreadId] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [showConversations, setShowConversations] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const messagesEndRef = useRef(null);
    const wsRef = useRef(null);
    const inputRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const messageQueueRef = useRef([]);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [inputMessage]);

    // Optimized scroll to bottom with debouncing
    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(scrollToBottom, 100);
        return () => clearTimeout(timer);
    }, [messages, scrollToBottom]);

    // Load conversations on mount
    useEffect(() => {
        if (sessionId) {
            loadConversations();
            if (analysisData) {
                updateContext();
            }
        }
    }, [sessionId, analysisData]);

    // Optimized WebSocket connection with reconnection logic
    const connectWebSocket = useCallback(() => {
        if (!sessionId || !isOpen) return;

        const ws = new WebSocket(`ws://localhost:8000/ws/duo/${sessionId}`);

        ws.onopen = () => {
            console.log('Duo Chat WebSocket connected (GraphQL backend)');
            // Process any queued messages
            while (messageQueueRef.current.length > 0) {
                const msg = messageQueueRef.current.shift();
                ws.send(JSON.stringify(msg));
            }
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'response') {
                handleStreamingResponse(data);
            } else if (data.type === 'complete') {
                handleResponseComplete();
            } else if (data.type === 'error') {
                handleError(data);
            } else if (data.type === 'analysis') {
                handleAnalysisResult(data.result);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setIsLoading(false);
        };

        ws.onclose = () => {
            console.log('WebSocket closed, attempting reconnect...');
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, 1000);
        };

        wsRef.current = ws;
    }, [sessionId, isOpen]);

    useEffect(() => {
        connectWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connectWebSocket]);

    // Simplified response handlers - no chunking logic needed!
    const handleStreamingResponse = useCallback((data) => {
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.isStreaming && !lastMsg.complete) {
                const messages = [...prev];
                messages[messages.length - 1] = {
                    ...lastMsg,
                    content: lastMsg.content + data.content
                };
                return messages;
            } else {
                return [...prev, {
                    role: 'assistant',
                    content: data.content,
                    timestamp: new Date(),
                    complete: false,
                    isStreaming: true,
                    threadId: data.thread_id
                }];
            }
        });

        if (data.thread_id) {
            setThreadId(data.thread_id);
        }
    }, []);

    const handleResponseComplete = useCallback(() => {
        setMessages(prev => {
            const messages = [...prev];
            const lastIdx = messages.length - 1;
            if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
                messages[lastIdx] = {
                    ...messages[lastIdx],
                    complete: true,
                    isStreaming: false
                };
            }
            return messages;
        });
        setIsLoading(false);
    }, []);

    const handleError = useCallback((data) => {
        console.error('Duo Chat error:', data.message);

        setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Error: ${data.message}`,
            timestamp: new Date(),
            complete: true,
            isError: true
        }]);
        setIsLoading(false);
    }, []);

    const loadConversations = async () => {
        try {
            const response = await fetch(`/api/duo/conversations/${sessionId}`);
            const data = await response.json();
            setConversations(data);
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    };

    const updateContext = async () => {
        try {
            await fetch('/api/duo/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId })
            });
        } catch (error) {
            console.error('Failed to update context:', error);
        }
    };

    // Simplified message sending - no chunking needed with GraphQL!
    const sendMessage = useCallback(async () => {
        if (!inputMessage.trim() || !wsRef.current || isLoading) return;

        const fullMessage = inputMessage.trim();

        const userMessage = {
            role: 'user',
            content: fullMessage,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        setInputMessage('');

        // Send full message - GraphQL handles any length!
        const messageData = {
            type: 'chat',
            message: fullMessage,  // No chunking needed
            thread_id: threadId
        };

        if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(messageData));
        } else {
            messageQueueRef.current.push(messageData);
        }
    }, [inputMessage, threadId, isLoading]);

    const handleAnalysisResult = (result) => {
        const response = result.response;
        const searchSuggestions = extractSearchSuggestions(response);

        const analysisMessage = {
            role: 'assistant',
            content: response,
            timestamp: new Date(),
            complete: true,
            actions: searchSuggestions.map(suggestion => ({
                type: 'search',
                label: suggestion,
                action: () => onExecuteSearch(suggestion)
            }))
        };

        setMessages(prev => [...prev, analysisMessage]);
        setIsLoading(false);
    };

    const extractSearchSuggestions = (text) => {
        const patterns = [];

        const quotedMatches = text.match(/"([^"]+)"/g);
        if (quotedMatches) {
            patterns.push(...quotedMatches.map(m => m.replace(/"/g, '')));
        }

        const codeMatches = text.match(/`([^`]+)`/g);
        if (codeMatches) {
            patterns.push(...codeMatches.map(m => m.replace(/`/g, '')));
        }

        return patterns.filter(p =>
            p.includes(':') || p.includes('>') || p.includes('=') || p.includes('AND') || p.includes('OR')
        );
    };

    const handleKeyPress = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    const loadConversation = (conversation) => {
        setMessages(conversation.messages || []);
        setThreadId(conversation.thread_id);
        setShowConversations(false);
    };

    const startNewConversation = () => {
        setMessages([]);
        setThreadId(null);
        setShowConversations(false);
    };

    const copyMessage = useCallback((content) => {
        navigator.clipboard.writeText(content);
    }, []);

    const quickActions = useMemo(() => [
        { icon: XCircle, label: "What are the main errors?", query: "Show me the main error patterns in these logs", color: '#ef4444' },
        { icon: Server, label: "Service health", query: "Which services are having issues?", color: '#f59e0b' },
        { icon: Clock, label: "Recent failures", query: "What failures occurred in the last hour?", color: '#3b82f6' },
        { icon: Zap, label: "Performance issues", query: "Are there any performance problems?", color: '#10b981' }
    ], []);

    // Memoized widget styles (enhanced for production)
    const widgetStyles = useMemo(() => {
        if (isFullscreen) {
            return {
                width: '100vw',
                height: '100vh',
                bottom: 0,
                right: 0,
                borderRadius: 0,
                maxHeight: '100vh'
            };
        }
        return {
            width: isMinimized ? '320px' : '440px',
            height: isMinimized ? '48px' : 'calc(100vh - 120px)',
            bottom: '20px',
            right: '20px',
            borderRadius: '12px',
            maxHeight: '720px'
        };
    }, [isFullscreen, isMinimized]);

    return (
        <>
            {/* Chat Button - Enhanced */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 group"
                    style={{ zIndex: 50 }}
                >
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full animate-ping" style={{
                            background: 'var(--accent)',
                            opacity: 0.2
                        }}></div>
                        <div className="relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all group-hover:scale-105"
                            style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                            }}>
                            <MessageCircle className="w-6 h-6" strokeWidth={2} />
                        </div>
                        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full" style={{
                            background: '#10b981',
                            boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)'
                        }}></span>
                    </div>
                    <div className="absolute -top-10 right-0 px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap"
                        style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid rgba(0,0,0,0.06)',
                            fontSize: '12px',
                            fontWeight: '500',
                            letterSpacing: '0.01em',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                        }}>
                        Ask GitLab Duo about your logs
                    </div>
                </button>
            )}

            {/* Chat Widget - Enhanced */}
            {isOpen && (
                <div className="fixed shadow-xl transition-all flex flex-col overflow-hidden"
                    style={{
                        ...widgetStyles,
                        background: 'var(--bg-primary)',
                        border: '1px solid rgba(0,0,0,0.08)',
                        zIndex: 50,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)'
                    }}>

                    {/* Header - Enhanced */}
                    <div className={`${isMinimized ? 'px-4 py-2' : 'px-5 py-3'} flex items-center justify-between`} style={{
                        background: 'var(--bg-secondary)',
                        borderBottom: isMinimized ? 'none' : '1px solid rgba(0,0,0,0.06)',
                        height: isMinimized ? '48px' : 'auto'
                    }}>
                        <div className="flex items-center gap-3">
                            <div className={`${isMinimized ? 'w-8 h-8' : 'w-9 h-9'} rounded-lg flex items-center justify-center flex-shrink-0`} style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                            }}>
                                <Bot className={`${isMinimized ? 'w-5 h-5' : 'w-5 h-5'}`} strokeWidth={2} />
                            </div>
                            {isMinimized ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold" style={{
                                        color: 'var(--text-primary)',
                                        fontSize: '13px',
                                        letterSpacing: '-0.01em'
                                    }}>
                                        GitLab Duo
                                    </span>
                                    {isLoading && (
                                        <div className="flex space-x-0.5">
                                            {[0, 150, 300].map(delay => (
                                                <div key={delay} className="w-1 h-1 rounded-full animate-bounce" style={{
                                                    background: 'var(--accent)',
                                                    animationDelay: `${delay}ms`,
                                                    opacity: 0.8
                                                }}></div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold" style={{
                                                color: 'var(--text-primary)',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                letterSpacing: '-0.02em'
                                            }}>
                                                GitLab Duo
                                            </span>
                                            <span className="px-2 py-0.5 text-xs rounded font-medium" style={{
                                                background: 'rgba(0,0,0,0.04)',
                                                color: 'var(--text-secondary)',
                                                fontSize: '10px',
                                                fontWeight: '600',
                                                letterSpacing: '0.03em',
                                                textTransform: 'uppercase'
                                            }}>AI Assistant</span>
                                        </div>
                                        <p className="text-xs" style={{
                                            color: 'var(--text-secondary)',
                                            fontSize: '11px',
                                            letterSpacing: '0.01em',
                                            opacity: 0.8
                                        }}>
                                            {isLoading ? 'Processing...' : ''}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {!isMinimized && (
                                <>
                                    <button
                                        onClick={() => setIsFullscreen(!isFullscreen)}
                                        className="p-1.5 rounded-lg transition-all hover:bg-black/5"
                                        style={{ color: 'var(--text-secondary)' }}
                                        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                                    >
                                        {isFullscreen ? <Minimize2 className="w-4 h-4" strokeWidth={2} /> : <Maximize2 className="w-4 h-4" strokeWidth={2} />}
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setIsMinimized(!isMinimized)}
                                className={`${isMinimized ? 'p-1' : 'p-1.5'} rounded-lg transition-all hover:bg-black/5`}
                                style={{ color: 'var(--text-secondary)' }}
                                title={isMinimized ? "Expand" : "Minimize"}
                            >
                                <ChevronDown className={`w-4 h-4 transition-transform ${isMinimized ? 'rotate-180' : ''}`} strokeWidth={2} />
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className={`${isMinimized ? 'p-1' : 'p-1.5'} rounded-lg transition-all hover:bg-red-500/10`}
                                style={{ color: 'var(--text-secondary)' }}
                                title="Close"
                            >
                                <X className="w-4 h-4" strokeWidth={2} />
                            </button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <>
                            {/* Messages Area - Enhanced */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{
                                background: 'var(--bg-primary)',
                                maxHeight: isFullscreen ? 'calc(100vh - 180px)' : 'calc(100% - 180px)'
                            }}>
                                {messages.length === 0 && (
                                    <div className="text-center py-12 animate-fadeIn">
                                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{
                                            background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.04) 100%)',
                                            border: '1px solid rgba(0,0,0,0.06)'
                                        }}>
                                            <Sparkles className="w-8 h-8" style={{ color: 'var(--accent)', opacity: 0.9 }} strokeWidth={1.5} />
                                        </div>
                                        <h3 className="text-lg font-bold mb-2" style={{
                                            color: 'var(--text-primary)',
                                            fontSize: '17px',
                                            fontWeight: '600',
                                            letterSpacing: '-0.02em'
                                        }}>
                                            Welcome to GitLab Duo
                                        </h3>
                                        <p className="text-sm mb-6 max-w-xs mx-auto" style={{
                                            color: 'var(--text-secondary)',
                                            fontSize: '12px',
                                            letterSpacing: '0.01em',
                                            opacity: 0.8
                                        }}>
                                            Duo powered chat
                                        </p>
                                    </div>
                                )}

                                {messages.map((message, idx) => (
                                    <div key={idx} className={`flex gap-3 animate-fadeIn ${message.role === 'user' ? 'justify-end' : ''}`}>
                                        {message.role === 'assistant' && (
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{
                                                background: 'var(--accent)',
                                                color: 'var(--bg-primary)',
                                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                                            }}>
                                                <Bot className="w-4 h-4" strokeWidth={2} />
                                            </div>
                                        )}

                                        <div className={`max-w-[85%] ${message.role === 'user' ? 'order-1' : ''}`}>
                                            <div className={`px-4 py-3 rounded-xl ${message.isError ? 'animate-shake' : ''
                                                }`}
                                                style={{
                                                    background: message.role === 'user'
                                                        ? 'var(--accent)'
                                                        : message.isError
                                                            ? 'rgba(239, 68, 68, 0.05)'
                                                            : 'var(--bg-secondary)',
                                                    color: message.role === 'user'
                                                        ? 'var(--bg-primary)'
                                                        : message.isError
                                                            ? '#dc2626'
                                                            : 'var(--text-primary)',
                                                    border: message.role === 'user'
                                                        ? 'none'
                                                        : message.isError
                                                            ? '1px solid rgba(239, 68, 68, 0.2)'
                                                            : '1px solid rgba(0,0,0,0.06)',
                                                    boxShadow: message.role === 'user'
                                                        ? '0 2px 6px rgba(0,0,0,0.08)'
                                                        : '0 1px 3px rgba(0,0,0,0.04)'
                                                }}>
                                                <MessageContent content={message.content} role={message.role} />

                                                {message.isStreaming && !message.complete && (
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <div className="flex space-x-1">
                                                            {[0, 150, 300].map(delay => (
                                                                <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{
                                                                    background: 'var(--accent)',
                                                                    animationDelay: `${delay}ms`,
                                                                    opacity: 0.7
                                                                }}></div>
                                                            ))}
                                                        </div>
                                                        <span className="text-xs" style={{
                                                            color: 'var(--text-tertiary)',
                                                            fontSize: '11px',
                                                            letterSpacing: '0.01em'
                                                        }}>
                                                            Generating...
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-3 mt-1.5 px-1">
                                                <span className="text-xs" style={{
                                                    color: 'var(--text-tertiary)',
                                                    fontSize: '10px',
                                                    letterSpacing: '0.02em',
                                                    opacity: 0.7
                                                }}>
                                                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {message.role === 'assistant' && !message.isError && (
                                                    <button
                                                        onClick={() => copyMessage(message.content)}
                                                        className="text-xs flex items-center gap-1 transition-all hover:opacity-100 opacity-50"
                                                        style={{
                                                            color: 'var(--text-tertiary)',
                                                            fontSize: '10px',
                                                            letterSpacing: '0.01em'
                                                        }}
                                                    >
                                                        <Copy className="w-3 h-3" strokeWidth={2} />
                                                        Copy
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {message.role === 'user' && (
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 order-2" style={{
                                                background: 'rgba(0,0,0,0.04)',
                                                border: '1px solid rgba(0,0,0,0.06)'
                                            }}>
                                                <User className="w-4 h-4" style={{ color: 'var(--text-primary)' }} strokeWidth={2} />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area - Enhanced */}
                            <div className="p-4" style={{
                                borderTop: '1px solid rgba(0,0,0,0.06)',
                                background: 'var(--bg-secondary)'
                            }}>
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <textarea
                                            ref={inputRef}
                                            value={inputMessage}
                                            onChange={(e) => setInputMessage(e.target.value)}
                                            onKeyPress={handleKeyPress}
                                            placeholder="Message GitLab Duo..."
                                            className="w-full px-3.5 py-2.5 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-current text-sm leading-relaxed"
                                            style={{
                                                background: 'var(--bg-primary)',
                                                border: '1px solid rgba(0,0,0,0.08)',
                                                color: 'var(--text-primary)',
                                                minHeight: '42px',
                                                maxHeight: '120px',
                                                fontSize: '13px',
                                                letterSpacing: '0.01em',
                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                                            }}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    <button
                                        onClick={sendMessage}
                                        disabled={!inputMessage.trim() || isLoading}
                                        className="px-4 py-2.5 rounded-lg transition-all flex items-center justify-center disabled:opacity-40 hover:opacity-90"
                                        style={{
                                            background: 'var(--accent)',
                                            color: 'var(--bg-primary)',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                                            minWidth: '48px'
                                        }}
                                    >
                                        {isLoading ? (
                                            <Loader className="w-4 h-4 animate-spin" strokeWidth={2} />
                                        ) : (
                                            <Send className="w-4 h-4" strokeWidth={2} />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Custom styles - Enhanced */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
                    20%, 40%, 60%, 80% { transform: translateX(2px); }
                }

                .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
                .animate-shake { animation: shake 0.5s ease-out; }
                
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
        </>
    );
};

export default DuoChatWidget;