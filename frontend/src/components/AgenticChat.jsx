import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';  // IMPORTANT: npm install remark-gfm
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
    Bot, Send, Loader2, AlertCircle, CheckCircle, Copy, Check,
    Zap, Terminal, ChevronDown, ChevronRight, Settings,
    Trash2, Maximize2, Minimize2, User, Wrench, Clock, RefreshCw,
    ChevronUp, ChevronsUpDown, CheckCircle2
} from 'lucide-react';

const AgenticChat = ({ sessionId, analysisData }) => {
    // State management
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [expandedTools, setExpandedTools] = useState({});
    const [copiedCode, setCopiedCode] = useState({});
    const [collapsedCode, setCollapsedCode] = useState({});
    const [fullscreen, setFullscreen] = useState(false);
    const [metrics, setMetrics] = useState(null);
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    const [autoScroll, setAutoScroll] = useState(true);

    // Refs
    const messagesEndRef = useRef(null);
    const wsRef = useRef(null);
    const inputRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const streamingIntervalRef = useRef(null);
    const streamingTextRef = useRef('');
    const streamingIndexRef = useRef(0);
    const currentStreamIdRef = useRef(null);
    const accumulatedContentRef = useRef('');

    // Auto-scroll to bottom
    const scrollToBottom = useCallback(() => {
        if (autoScroll) {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    }, [autoScroll]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, streamingMessage, scrollToBottom]);

    // Copy to clipboard with text feedback
    const copyToClipboard = useCallback(async (text, id) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedCode(prev => ({ ...prev, [id]: true }));
            setTimeout(() => {
                setCopiedCode(prev => ({ ...prev, [id]: false }));
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, []);

    // Toggle code block collapse
    const toggleCodeCollapse = useCallback((id) => {
        setCollapsedCode(prev => ({ ...prev, [id]: !prev[id] }));
    }, []);

    // Custom markdown components - PURE CSS VARIABLES, no isDarkMode
    const markdownComponents = useMemo(() => ({
        // Enhanced code blocks with collapsible feature
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
            const codeContent = String(children).replace(/\n$/, '');
            const lineCount = codeContent.split('\n').length;
            const isCollapsed = collapsedCode[codeId];

            if (!inline && (match || codeContent.includes('\n'))) {
                return (
                    <div className="code-block-wrapper relative my-3 flex flex-col rounded-xl overflow-hidden"
                        style={{
                            border: '1px solid rgba(128, 128, 128, 0.15)',
                            background: 'var(--bg-tertiary, rgba(0,0,0,0.02))'
                        }}
                        dir="ltr"
                    >
                        {/* Language badge */}
                        {lang && (
                            <div className="absolute left-3 top-2.5 z-10">
                                <span className="text-xs px-2 py-0.5 rounded font-semibold"
                                    style={{
                                        background: 'rgba(0,0,0,0.05)',
                                        color: 'var(--text-secondary)',
                                        fontSize: '10px',
                                        letterSpacing: '0.03em',
                                        textTransform: 'uppercase'
                                    }}>
                                    {lang}
                                </span>
                            </div>
                        )}

                        {/* Action bar */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
                            {lineCount > 10 && (
                                <button
                                    onClick={() => toggleCodeCollapse(codeId)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 items-center px-2 py-0.5 rounded text-xs"
                                    style={{
                                        background: 'rgba(0,0,0,0.05)',
                                        color: 'var(--text-secondary)',
                                        fontSize: '11px',
                                        fontWeight: '500'
                                    }}
                                >
                                    <ChevronsUpDown className="w-3 h-3" />
                                    <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                                </button>
                            )}

                            <button
                                onClick={() => copyToClipboard(codeContent, codeId)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 items-center px-2 py-0.5 rounded text-xs"
                                style={{
                                    background: 'rgba(0,0,0,0.05)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '11px',
                                    fontWeight: '500'
                                }}
                            >
                                {copiedCode[codeId] ? (
                                    <>
                                        <CheckCircle2 className="w-3 h-3" style={{ color: '#10b981' }} />
                                        <span style={{ color: '#10b981' }}>Copied</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3 h-3" />
                                        <span>Copy</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Code content */}
                        {isCollapsed ? (
                            <div className="py-3 px-4 text-xs italic"
                                style={{ color: 'var(--text-tertiary)' }}>
                                {lineCount} lines hidden
                            </div>
                        ) : (
                            <pre className="code-pre" style={{
                                margin: 0,
                                padding: lang ? '40px 16px 16px 16px' : '16px',
                                overflow: 'auto',
                                fontSize: '12px',
                                lineHeight: '1.6',
                                background: 'transparent',
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
                                    {codeContent}
                                </code>
                            </pre>
                        )}
                    </div>
                );
            }

            // Inline code
            return (
                <code {...props}
                    className="px-1.5 py-0.5 rounded text-xs inline-code"
                    style={{
                        background: 'rgba(128, 128, 128, 0.08)',
                        color: 'var(--text-primary)',
                        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                        fontSize: '12px',
                        letterSpacing: '0.02em',
                        padding: '2px 6px',
                        borderRadius: '4px'
                    }}>
                    {children}
                </code>
            );
        },

        // Paragraph
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

        // Lists
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

        // Blockquote
        blockquote: ({ children }) => (
            <blockquote className="my-3 pl-3 border-l-2 italic" style={{
                borderColor: 'var(--accent, #3b82f6)',
                color: 'var(--text-secondary)',
                paddingLeft: '0.75em',
                marginLeft: '0',
                fontSize: '13px',
                letterSpacing: '0.01em'
            }}>
                {children}
            </blockquote>
        ),

        // Headers
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

        h4: ({ children }) => (
            <h4 className="text-base font-semibold mt-2 mb-1" style={{
                color: 'var(--text-primary)',
                fontWeight: '600',
                fontSize: '14px'
            }}>
                {children}
            </h4>
        ),

        // ============ TABLES ============
        table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg" style={{
                border: '1px solid rgba(128, 128, 128, 0.15)'
            }}>
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
                borderBottom: '1px solid rgba(128, 128, 128, 0.15)'
            }}>
                {children}
            </thead>
        ),

        tbody: ({ children }) => (
            <tbody>{children}</tbody>
        ),

        tr: ({ children }) => (
            <tr style={{
                borderBottom: '1px solid rgba(128, 128, 128, 0.08)'
            }}>
                {children}
            </tr>
        ),

        th: ({ children, style, align }) => (
            <th className="px-3 py-2 text-left font-semibold" style={{
                color: 'var(--text-primary)',
                fontWeight: '600',
                textAlign: align || 'left',
                fontSize: '11px',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                background: 'rgba(128, 128, 128, 0.05)',
                ...style
            }}>
                {children}
            </th>
        ),

        td: ({ children, style, align }) => (
            <td className="px-3 py-2" style={{
                color: 'var(--text-primary)',
                textAlign: align || 'left',
                fontSize: '12px',
                ...style
            }}>
                {children}
            </td>
        ),

        // Links
        a: ({ href, children }) => (
            <a href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-2 hover:no-underline"
                style={{
                    color: 'var(--accent)',
                    textDecorationColor: 'currentColor',
                    fontSize: 'inherit',
                    fontWeight: '500'
                }}>
                {children}
            </a>
        ),

        // Horizontal rule
        hr: () => (
            <hr className="my-4" style={{
                borderTop: '1px solid rgba(128, 128, 128, 0.15)',
                borderBottom: 'none'
            }} />
        ),

        // Strong/Bold
        strong: ({ children }) => (
            <strong style={{ fontWeight: '600', letterSpacing: '-0.01em' }}>
                {children}
            </strong>
        ),

        // Emphasis
        em: ({ children }) => (
            <em style={{ fontStyle: 'italic' }}>{children}</em>
        ),

        // Strikethrough (remark-gfm)
        del: ({ children }) => (
            <del style={{ color: 'var(--text-tertiary)' }}>{children}</del>
        ),

        // Pre wrapper
        pre: ({ children }) => <>{children}</>,

        // Task list checkboxes (remark-gfm)
        input: ({ type, checked, ...props }) => {
            if (type === 'checkbox') {
                return (
                    <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="mr-2 rounded"
                        style={{ accentColor: 'var(--accent)' }}
                        {...props}
                    />
                );
            }
            return <input type={type} {...props} />;
        },
    }), [copiedCode, collapsedCode, copyToClipboard, toggleCodeCollapse]);

    // WebSocket connection with exponential backoff
    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('✅ WebSocket already connected');
            return;
        }

        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        try {
            console.log(`🔌 Connecting to agent (attempt ${reconnectAttempts + 1})...`);
            const ws = new WebSocket('ws://localhost:8001/ws/agent');

            let pingInterval;

            ws.onopen = () => {
                console.log('✅ Agent connected successfully');
                setIsConnected(true);
                setReconnectAttempts(0);
                wsRef.current = ws;

                pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 120000);

                if (sessionId) {
                    console.log('📜 Requesting history for session:', sessionId);
                    ws.send(JSON.stringify({
                        type: 'get_history',
                        session_id: sessionId
                    }));
                }

                ws.send(JSON.stringify({ type: 'get_metrics' }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 Message received:', data.type, data);
                    handleAgentMessage(data);
                } catch (error) {
                    console.error('❌ Failed to parse message:', error, event.data);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                setIsConnected(false);
            };

            ws.onclose = (event) => {
                console.log(`🔌 WebSocket closed (code: ${event.code})`);
                setIsConnected(false);
                clearInterval(pingInterval);
                wsRef.current = null;

                if (event.code !== 1000 && reconnectAttempts < 5) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                    console.log(`⏳ Reconnecting in ${delay}ms...`);
                    setReconnectAttempts(prev => prev + 1);
                    reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
                }
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('❌ Failed to create WebSocket:', error);
            setIsConnected(false);

            if (reconnectAttempts < 5) {
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                setReconnectAttempts(prev => prev + 1);
                reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
            }
        }
    }, [sessionId, reconnectAttempts]);

    // Cleanup on unmount
    useEffect(() => {
        connectWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);
            if (wsRef.current) wsRef.current.close(1000);
        };
    }, [connectWebSocket]);

    // Message handler
    const handleAgentMessage = useCallback((data) => {
        console.log('🔧 Processing:', data.type);

        switch (data.type) {
            case 'thinking':
                accumulatedContentRef.current = '';
                currentStreamIdRef.current = null;
                setStreamingMessage({
                    id: `thinking-${Date.now()}`,
                    type: 'thinking',
                    content: data.content || 'Using tool...'
                });
                break;

            case 'tool_call':
                setStreamingMessage(null);
                const toolCallId = `tool-${Date.now()}`;
                setMessages(prev => [...prev, {
                    id: toolCallId,
                    type: 'tool_call',
                    tool: data.tool,
                    params: data.params || data.arguments,
                    status: 'running',
                    timestamp: new Date()
                }]);
                break;

            case 'tool_result':
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastToolIndex = newMessages.findLastIndex(m =>
                        m.type === 'tool_call' && m.status === 'running'
                    );
                    if (lastToolIndex !== -1) {
                        newMessages[lastToolIndex] = {
                            ...newMessages[lastToolIndex],
                            result: data.result,
                            status: 'complete'
                        };
                    }
                    return newMessages;
                });
                break;

            case 'response':
                if (data.content) {
                    accumulatedContentRef.current += data.content;
                    setStreamingMessage(prev => {
                        const messageId = currentStreamIdRef.current || `assistant-${Date.now()}`;
                        if (!currentStreamIdRef.current) currentStreamIdRef.current = messageId;
                        return {
                            id: messageId,
                            type: 'assistant',
                            content: accumulatedContentRef.current,
                            timestamp: prev?.timestamp || new Date()
                        };
                    });
                }
                break;

            case 'complete':
                if (accumulatedContentRef.current) {
                    const finalMessage = {
                        id: currentStreamIdRef.current || `assistant-${Date.now()}`,
                        type: 'assistant',
                        content: accumulatedContentRef.current,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, finalMessage]);
                }
                setStreamingMessage(null);
                accumulatedContentRef.current = '';
                currentStreamIdRef.current = null;
                setIsProcessing(false);
                break;

            case 'error':
                if (streamingIntervalRef.current) {
                    clearInterval(streamingIntervalRef.current);
                    streamingIntervalRef.current = null;
                }
                setStreamingMessage(null);
                setMessages(prev => [...prev, {
                    id: `error-${Date.now()}`,
                    type: 'error',
                    content: data.content || data.message || 'An error occurred',
                    timestamp: new Date()
                }]);
                setIsProcessing(false);
                break;

            case 'history':
                if (data.messages && Array.isArray(data.messages)) {
                    console.log(`📚 Loading ${data.messages.length} history messages`);
                    const formattedMessages = data.messages.map((msg, idx) => ({
                        ...msg,
                        id: msg.id || `history-${idx}`,
                        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
                    }));
                    setMessages(formattedMessages);
                }
                break;

            case 'metrics':
                if (data.data) setMetrics(data.data);
                break;

            case 'slate_update':
                // Forward slate updates to the TroubleshootingSlate component
                if (data.action === 'add' && data.entry) {
                    // Call the global addToSlate function if it exists
                    if (window.addToSlate) {
                        window.addToSlate(data.entry);
                    } else {
                        console.warn('window.addToSlate not available yet');
                    }
                }
                break;

            case 'pong':
                break;

            default:
                console.warn('Unknown message type:', data.type);
        }
    }, []);

    // Send message with validation
    const sendMessage = useCallback(async () => {
        const trimmedInput = input.trim();

        if (!trimmedInput || !isConnected || isProcessing) {
            if (!isConnected) {
                setMessages(prev => [...prev, {
                    id: `error-${Date.now()}`,
                    type: 'error',
                    content: 'Not connected to agent. Please wait...',
                    timestamp: new Date()
                }]);
            }
            return;
        }

        setInput('');
        setIsProcessing(true);
        accumulatedContentRef.current = '';
        currentStreamIdRef.current = null;

        const userMsgId = `user-${Date.now()}`;
        const userMessage = {
            id: userMsgId,
            type: 'user',
            content: trimmedInput,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);

        try {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'chat',
                    message: trimmedInput,
                    context: {
                        session_id: sessionId || 'default',
                        files_count: analysisData?.total_files || 0,
                        total_lines: analysisData?.total_lines || 0,
                        current_tab: 'chat'
                    }
                }));
            } else {
                throw new Error('WebSocket not connected');
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: `error-${Date.now()}`,
                type: 'error',
                content: 'Failed to send message. Please try again.',
                timestamp: new Date()
            }]);
        }
    }, [input, isConnected, isProcessing, sessionId, analysisData]);

    // Handle Enter key
    const handleKeyPress = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    // Quick commands
    const quickCommands = [
        { icon: Terminal, label: 'List files', cmd: 'Show me all the files in this session' },
        { icon: Zap, label: 'Find errors', cmd: 'Search for errors in the logs' },
        { icon: CheckCircle, label: 'Analyze', cmd: 'Analyze the logs for issues' },
        { icon: Clock, label: 'Timeline', cmd: 'Show me a timeline of events' }
    ];

    // Message rendering
    const renderMessage = useCallback((msg, isLast = false) => {
        switch (msg.type) {
            case 'user':
                return (
                    <div key={msg.id} className="flex justify-end mb-4 animate-fadeIn group">
                        <div className="max-w-[80%] flex gap-3 items-start">
                            <div className="rounded-xl px-4 py-3" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                            }}>
                                <div className="text-sm leading-relaxed" style={{
                                    fontSize: '13px',
                                    letterSpacing: '0.01em',
                                    lineHeight: '1.6'
                                }}>
                                    {msg.content}
                                </div>
                            </div>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1" style={{
                                background: 'rgba(0,0,0,0.04)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <User className="w-4 h-4" style={{ color: 'var(--text-primary)' }} strokeWidth={2} />
                            </div>
                        </div>
                    </div>
                );

            case 'assistant':
                const msgCopyId = `msg-${msg.id}`;
                return (
                    <div key={msg.id} className="flex justify-start mb-4 animate-fadeIn group">
                        <div className="max-w-[85%] flex gap-3 items-start">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                            }}>
                                <Bot className="w-4 h-4" strokeWidth={2} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="rounded-xl px-4 py-3" style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                }}>
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
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className={`flex items-center gap-3 mt-1.5 px-1 ${isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                    <span className="text-xs" style={{
                                        color: 'var(--text-tertiary)',
                                        fontSize: '10px',
                                        letterSpacing: '0.02em',
                                        opacity: 0.7
                                    }}>
                                        {msg.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <button
                                        onClick={() => copyToClipboard(msg.content, msgCopyId)}
                                        className="text-xs flex items-center gap-1 transition-all hover:opacity-100 opacity-50"
                                        style={{
                                            color: 'var(--text-tertiary)',
                                            fontSize: '10px',
                                            letterSpacing: '0.01em'
                                        }}
                                    >
                                        {copiedCode[msgCopyId] ? (
                                            <>
                                                <CheckCircle2 className="w-3 h-3" style={{ color: '#10b981' }} />
                                                <span style={{ color: '#10b981' }}>Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-3 h-3" strokeWidth={2} />
                                                <span>Copy</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case 'thinking':
                return (
                    <div key={msg.id} className="flex justify-start mb-4 animate-fadeIn">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                            }}>
                                <Bot className="w-4 h-4" strokeWidth={2} />
                            </div>
                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid rgba(0,0,0,0.06)',
                                color: 'var(--text-secondary)'
                            }}>
                                <div className="flex space-x-1">
                                    {[0, 150, 300].map(delay => (
                                        <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{
                                            background: 'var(--accent)',
                                            animationDelay: `${delay}ms`,
                                            opacity: 0.7
                                        }}></div>
                                    ))}
                                </div>
                                <span className="text-sm" style={{ fontSize: '13px' }}>{msg.content}</span>
                            </div>
                        </div>
                    </div>
                );

            case 'tool_call':
                const isExpanded = expandedTools[msg.id];
                const isRunning = msg.status === 'running';

                return (
                    <div key={msg.id} className="mb-4 ml-11 animate-fadeIn">
                        <div className="rounded-xl overflow-hidden" style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid rgba(0,0,0,0.06)'
                        }}>
                            {/* Tool header */}
                            <div
                                className="flex items-center justify-between px-4 py-3 cursor-pointer select-none transition-colors"
                                onClick={() => setExpandedTools(prev => ({
                                    ...prev,
                                    [msg.id]: !prev[msg.id]
                                }))}
                                style={{ background: 'rgba(0,0,0,0.02)' }}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                                        style={{ background: 'rgba(168, 85, 247, 0.15)' }}>
                                        <Wrench className="w-3.5 h-3.5" style={{ color: '#a855f7' }} strokeWidth={2} />
                                    </div>
                                    <span className="font-mono text-sm font-medium" style={{
                                        color: 'var(--text-primary)',
                                        fontSize: '12px',
                                        letterSpacing: '0.02em'
                                    }}>
                                        {msg.tool}
                                    </span>
                                    {isRunning ? (
                                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                                    ) : (
                                        <CheckCircle className="w-4 h-4" style={{ color: '#10b981' }} />
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {msg.timestamp && (
                                        <span className="text-xs" style={{
                                            color: 'var(--text-tertiary)',
                                            fontSize: '10px'
                                        }}>
                                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    )}
                                    <div style={{ color: 'var(--text-tertiary)' }}>
                                        {isExpanded ?
                                            <ChevronUp className="w-4 h-4" strokeWidth={2} /> :
                                            <ChevronDown className="w-4 h-4" strokeWidth={2} />
                                        }
                                    </div>
                                </div>
                            </div>

                            {/* Expanded content */}
                            {isExpanded && (
                                <div className="px-4 pb-4 space-y-3 animate-slideDown" style={{
                                    borderTop: '1px solid rgba(0,0,0,0.06)'
                                }}>
                                    {msg.params && (
                                        <div className="mt-3">
                                            <div className="text-xs mb-1.5 font-medium" style={{
                                                color: 'var(--text-tertiary)',
                                                fontSize: '10px',
                                                letterSpacing: '0.03em',
                                                textTransform: 'uppercase'
                                            }}>
                                                Parameters
                                            </div>
                                            <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto"
                                                style={{
                                                    background: 'rgba(0,0,0,0.02)',
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    border: '1px solid rgba(0,0,0,0.04)'
                                                }}>
                                                {typeof msg.params === 'string'
                                                    ? msg.params
                                                    : JSON.stringify(msg.params, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {msg.result && (
                                        <div>
                                            <div className="text-xs mb-1.5 font-medium" style={{
                                                color: 'var(--text-tertiary)',
                                                fontSize: '10px',
                                                letterSpacing: '0.03em',
                                                textTransform: 'uppercase'
                                            }}>
                                                Result
                                            </div>
                                            <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto"
                                                style={{
                                                    background: 'rgba(0,0,0,0.02)',
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '11px',
                                                    border: '1px solid rgba(0,0,0,0.04)'
                                                }}>
                                                {msg.result}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'error':
                return (
                    <div key={msg.id} className="mb-4 ml-11 animate-shake">
                        <div className="rounded-xl p-4 flex items-start gap-3" style={{
                            background: 'rgba(239, 68, 68, 0.05)',
                            border: '1px solid rgba(239, 68, 68, 0.2)'
                        }}>
                            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm" style={{ color: '#dc2626', fontSize: '13px' }}>{msg.content}</div>
                                {msg.timestamp && (
                                    <div className="text-xs mt-1" style={{ color: '#ef4444', fontSize: '10px' }}>
                                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    }, [expandedTools, markdownComponents, copiedCode, copyToClipboard]);

    return (
        <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50' : 'h-full'}`} style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)'
        }}>
            {/* Header */}
            <div className="px-4 py-3" style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                            background: 'var(--accent)',
                            color: 'var(--bg-primary)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                        }}>
                            <Bot className="w-6 h-6" strokeWidth={2} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="font-semibold" style={{
                                    color: 'var(--text-primary)',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    letterSpacing: '-0.02em'
                                }}>
                                    Agent Chat
                                </h2>
                                <span className="px-2 py-0.5 text-xs rounded font-medium" style={{
                                    background: 'rgba(0,0,0,0.04)',
                                    color: 'var(--text-secondary)',
                                    fontSize: '10px',
                                    fontWeight: '600',
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase'
                                }}>GPT-OSS</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '11px'
                            }}>
                                <div className={`w-2 h-2 rounded-full ${isConnected ? 'animate-pulse' : ''}`}
                                    style={{ background: isConnected ? '#10b981' : '#ef4444' }} />
                                <span>{isConnected ? 'Connected' : reconnectAttempts > 0 ? `Reconnecting... (${reconnectAttempts}/5)` : 'Disconnected'}</span>
                                {metrics && (
                                    <>
                                        <span>•</span>
                                        <span>{messages.length} messages</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={() => setAutoScroll(!autoScroll)}
                            className="p-1.5 rounded-lg transition-all hover:bg-black/5"
                            style={{ color: autoScroll ? 'var(--accent)' : 'var(--text-secondary)' }}
                            title="Auto-scroll"
                        >
                            <ChevronDown className="w-4 h-4" strokeWidth={2} />
                        </button>
                        <button
                            onClick={() => connectWebSocket()}
                            disabled={isConnected}
                            className="p-1.5 rounded-lg transition-all hover:bg-black/5 disabled:opacity-50"
                            style={{ color: 'var(--text-secondary)' }}
                            title="Reconnect"
                        >
                            <RefreshCw className={`w-4 h-4 ${!isConnected ? 'animate-spin' : ''}`} strokeWidth={2} />
                        </button>
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="p-1.5 rounded-lg transition-all hover:bg-black/5"
                            style={{ color: 'var(--text-secondary)' }}
                            title="Settings"
                        >
                            <Settings className="w-4 h-4" strokeWidth={2} />
                        </button>
                        <button
                            onClick={() => setFullscreen(!fullscreen)}
                            className="p-1.5 rounded-lg transition-all hover:bg-black/5"
                            style={{ color: 'var(--text-secondary)' }}
                            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        >
                            {fullscreen ? <Minimize2 className="w-4 h-4" strokeWidth={2} /> : <Maximize2 className="w-4 h-4" strokeWidth={2} />}
                        </button>
                        <button
                            onClick={() => {
                                if (messages.length > 0 && confirm('Clear all messages?')) {
                                    setMessages([]);
                                    setStreamingMessage(null);
                                }
                            }}
                            disabled={messages.length === 0}
                            className="p-1.5 rounded-lg transition-all hover:bg-red-500/10 disabled:opacity-50"
                            style={{ color: 'var(--text-secondary)' }}
                            title="Clear chat"
                        >
                            <Trash2 className="w-4 h-4" strokeWidth={2} />
                        </button>
                    </div>
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div className="mt-3 p-3 rounded-xl animate-slideDown" style={{
                        background: 'rgba(0,0,0,0.02)',
                        border: '1px solid rgba(0,0,0,0.06)'
                    }}>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                                    Model
                                </span>
                                <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                    {metrics?.model || 'gpt-oss:20b'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                                    Session
                                </span>
                                <span className="text-sm font-mono truncate max-w-xs" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                    {sessionId || 'default'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                                    Files
                                </span>
                                <span className="text-sm" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                    {analysisData?.total_files || 0} files ({analysisData?.total_lines || 0} lines)
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Quick Commands */}
            {messages.length === 0 && !streamingMessage && (
                <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <div className="flex gap-2 flex-wrap">
                        {quickCommands.map(({ icon: Icon, label, cmd }) => (
                            <button
                                key={cmd}
                                onClick={() => {
                                    setInput(cmd);
                                    setTimeout(() => inputRef.current?.focus(), 100);
                                }}
                                disabled={!isConnected}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm font-medium disabled:opacity-50 hover:bg-black/5"
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px'
                                }}
                            >
                                <Icon className="w-4 h-4" strokeWidth={2} />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-4 py-4" style={{ background: 'var(--bg-primary)' }}>
                {messages.length === 0 && !streamingMessage && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center py-12 animate-fadeIn">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{
                                background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.04) 100%)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <Bot className="w-8 h-8" style={{ color: 'var(--accent)', opacity: 0.9 }} strokeWidth={1.5} />
                            </div>
                            <h3 className="text-lg font-bold mb-2" style={{
                                color: 'var(--text-primary)',
                                fontSize: '17px',
                                fontWeight: '600',
                                letterSpacing: '-0.02em'
                            }}>
                                {isConnected ? 'Start a conversation' : 'Connecting to agent...'}
                            </h3>
                            <p className="text-sm max-w-xs mx-auto" style={{
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                letterSpacing: '0.01em',
                                opacity: 0.8
                            }}>
                                {isConnected
                                    ? 'Ask questions about your SOS archive'
                                    : 'Please wait while we establish connection'}
                            </p>
                        </div>
                    </div>
                )}

                {/* Render all messages */}
                {messages.map((msg, idx) => renderMessage(msg, idx === messages.length - 1))}

                {/* Render streaming message */}
                {streamingMessage && (
                    <div className="flex justify-start mb-4 animate-fadeIn">
                        <div className="max-w-[85%] flex gap-3 items-start">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                            }}>
                                <Bot className="w-4 h-4" strokeWidth={2} />
                            </div>
                            {streamingMessage.type === 'thinking' ? (
                                <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    color: 'var(--text-secondary)'
                                }}>
                                    <div className="flex space-x-1">
                                        {[0, 150, 300].map(delay => (
                                            <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{
                                                background: 'var(--accent)',
                                                animationDelay: `${delay}ms`,
                                                opacity: 0.7
                                            }}></div>
                                        ))}
                                    </div>
                                    <span className="text-sm" style={{ fontSize: '13px' }}>{streamingMessage.content}</span>
                                </div>
                            ) : (
                                <div className="flex-1 min-w-0">
                                    <div className="rounded-xl px-4 py-3" style={{
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                    }}>
                                        <div className="message-content text-sm" style={{
                                            color: 'var(--text-primary)',
                                            lineHeight: '1.6',
                                            fontSize: '13px'
                                        }}>
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                components={markdownComponents}
                                            >
                                                {streamingMessage.content || '\u00A0'}
                                            </ReactMarkdown>
                                        </div>
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
                                                fontSize: '11px'
                                            }}>
                                                Generating...
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Loading dots when processing but no streaming */}
                {isProcessing && !streamingMessage && (
                    <div className="flex justify-start mb-4 animate-fadeIn">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                                background: 'var(--accent)',
                                color: 'var(--bg-primary)'
                            }}>
                                <Bot className="w-4 h-4" strokeWidth={2} />
                            </div>
                            <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <div className="flex space-x-1">
                                    {[0, 150, 300].map(delay => (
                                        <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{
                                            background: 'var(--accent)',
                                            animationDelay: `${delay}ms`,
                                            opacity: 0.7
                                        }}></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4" style={{
                background: 'var(--bg-secondary)',
                borderTop: '1px solid rgba(0,0,0,0.06)'
            }}>
                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={
                            !isConnected
                                ? "Connecting to agent..."
                                : isProcessing
                                    ? "Processing..."
                                    : "Message Agent..."
                        }
                        disabled={!isConnected || isProcessing}
                        className="flex-1 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-1 text-sm leading-relaxed disabled:opacity-50"
                        style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid rgba(0,0,0,0.08)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            letterSpacing: '0.01em',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                        }}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!isConnected || isProcessing || !input.trim()}
                        className="px-4 py-2.5 rounded-lg transition-all flex items-center justify-center disabled:opacity-40 hover:opacity-90"
                        style={{
                            background: 'var(--accent)',
                            color: 'var(--bg-primary)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                            minWidth: '48px'
                        }}
                        title={!isConnected ? "Not connected" : isProcessing ? "Processing..." : "Send message"}
                    >
                        {isProcessing ? (
                            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                        ) : (
                            <Send className="w-4 h-4" strokeWidth={2} />
                        )}
                    </button>
                </div>
            </div>

            {/* Custom styles */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes slideDown {
                    from { max-height: 0; opacity: 0; }
                    to { max-height: 1000px; opacity: 1; }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
                    20%, 40%, 60%, 80% { transform: translateX(2px); }
                }

                .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
                .animate-slideDown { animation: slideDown 0.3s ease-out; }
                .animate-shake { animation: shake 0.5s ease-out; }
                
                .message-content * { color: inherit !important; }
                .message-content p:first-child { margin-top: 0; }
                .message-content p:last-child { margin-bottom: 0; }
                
                .code-block-wrapper { position: relative; }
                .code-block-wrapper:hover button { opacity: 1 !important; }
                
                /* Theme-aware code backgrounds */
                @media (prefers-color-scheme: dark) {
                    .inline-code { background: rgba(255, 255, 255, 0.08) !important; }
                    .code-block-wrapper { background: rgba(255, 255, 255, 0.03) !important; }
                    .code-pre { background: transparent !important; }
                }
                
                @media (prefers-color-scheme: light) {
                    .inline-code { background: rgba(0, 0, 0, 0.04) !important; }
                    .code-block-wrapper { background: rgba(0, 0, 0, 0.02) !important; }
                }
                
                /* Scrollbar styling */
                .message-content pre::-webkit-scrollbar,
                .overflow-x-auto::-webkit-scrollbar,
                .overflow-y-auto::-webkit-scrollbar {
                    height: 6px;
                    width: 6px;
                }
                .message-content pre::-webkit-scrollbar-track,
                .overflow-x-auto::-webkit-scrollbar-track,
                .overflow-y-auto::-webkit-scrollbar-track {
                    background: transparent;
                }
                .message-content pre::-webkit-scrollbar-thumb,
                .overflow-x-auto::-webkit-scrollbar-thumb,
                .overflow-y-auto::-webkit-scrollbar-thumb {
                    background: var(--text-tertiary);
                    border-radius: 3px;
                    opacity: 0.5;
                }
            `}</style>
        </div>
    );
};

export default AgenticChat;