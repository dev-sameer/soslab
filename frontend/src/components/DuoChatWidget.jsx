import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    MessageCircle, X, Send, Minimize2, Maximize2,
    Bot, User, Loader2, Sparkles, ChevronDown, Copy,
    CheckCircle2, ChevronUp, RefreshCw, AlertCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// =============================================================================
// MESSAGE CONTENT RENDERER - Clean monochrome style
// =============================================================================

const MessageContent = React.memo(({ content, role, isStreaming }) => {
    const [copiedCode, setCopiedCode] = useState(null);

    const copyToClipboard = useCallback((text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedCode(id);
        setTimeout(() => setCopiedCode(null), 2000);
    }, []);

    if (role === 'user') {
        return (
            <div className="whitespace-pre-wrap text-xs leading-tight" style={{ color: 'var(--bg-primary)' }}>
                {content}
            </div>
        );
    }

    const components = useMemo(() => ({
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
            const language = match ? match[1] : '';

            if (inline) {
                return (
                    <code
                        className="px-1 py-0.5 text-xs font-mono rounded"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
                        {...props}
                    >
                        {children}
                    </code>
                );
            }

            return (
                <div className="relative group my-2 rounded-lg overflow-hidden" style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)'
                }}>
                    <div className="flex items-center justify-between px-3 py-1.5" style={{
                        background: 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border-primary)'
                    }}>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                            {language || 'code'}
                        </span>
                        <button
                            onClick={() => copyToClipboard(codeString, codeId)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-opacity hover:opacity-80"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            {copiedCode === codeId ? (
                                <><CheckCircle2 className="w-3 h-3" /><span>Copied</span></>
                            ) : (
                                <><Copy className="w-3 h-3" /><span>Copy</span></>
                            )}
                        </button>
                    </div>
                    <pre className="p-3 overflow-x-auto" style={{ margin: 0 }}>
                        <code className="text-xs leading-relaxed font-mono" style={{ color: 'var(--text-primary)' }} {...props}>
                            {codeString}
                        </code>
                    </pre>
                </div>
            );
        },
        p: ({ children }) => (
            <p className="my-0.5 leading-tight text-xs" style={{ color: 'var(--text-primary)' }}>{children}</p>
        ),
        h1: ({ children }) => (
            <h1 className="text-sm font-semibold mt-1.5 mb-0.5" style={{ color: 'var(--text-primary)' }}>{children}</h1>
        ),
        h2: ({ children }) => (
            <h2 className="text-xs font-semibold mt-1 mb-0.5" style={{ color: 'var(--text-primary)' }}>{children}</h2>
        ),
        h3: ({ children }) => (
            <h3 className="text-xs font-medium mt-1 mb-0.5" style={{ color: 'var(--text-primary)' }}>{children}</h3>
        ),
        ul: ({ children }) => (
            <ul className="my-0.5 ml-3 list-disc space-y-0 text-xs" style={{ color: 'var(--text-primary)' }}>{children}</ul>
        ),
        ol: ({ children }) => (
            <ol className="my-0.5 ml-3 list-decimal space-y-0 text-xs" style={{ color: 'var(--text-primary)' }}>{children}</ol>
        ),
        li: ({ children }) => (
            <li className="leading-relaxed" style={{ color: 'var(--text-primary)' }}>{children}</li>
        ),
        blockquote: ({ children }) => (
            <blockquote className="my-2 pl-3 py-1 text-sm" style={{
                borderLeft: '2px solid var(--accent)',
                color: 'var(--text-secondary)'
            }}>
                {children}
            </blockquote>
        ),
        a: ({ href, children }) => (
            <a
                href={href}
                className="underline underline-offset-2 hover:opacity-80 transition-opacity"
                style={{ color: 'var(--accent)' }}
                target="_blank"
                rel="noopener noreferrer"
            >
                {children}
            </a>
        ),
        strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: 'var(--text-primary)' }}>{children}</strong>
        ),
        pre: ({ children }) => <>{children}</>,
    }), [copiedCode, copyToClipboard]);

    return (
        <div className="message-content max-w-none text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {content}
            </ReactMarkdown>
            {isStreaming && (
                <span
                    className="inline-block w-1 h-3 ml-0.5 rounded-sm animate-pulse"
                    style={{ background: 'var(--accent)' }}
                />
            )}
        </div>
    );
});

// =============================================================================
// TYPING INDICATOR - Minimal dots
// =============================================================================

const TypingIndicator = () => (
    <div className="flex items-center gap-1 py-1">
        {[0, 150, 300].map((delay) => (
            <div
                key={delay}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{
                    background: 'var(--text-tertiary)',
                    animationDelay: `${delay}ms`,
                    animationDuration: '1s'
                }}
            />
        ))}
    </div>
);

// =============================================================================
// MAIN CHAT WIDGET - Monochrome design
// =============================================================================

const DuoChatWidget = ({ sessionId, analysisData }) => {
    // UI State
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Chat State
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [threadId, setThreadId] = useState(null);

    // Refs
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

    // Scroll to bottom
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, []);

    useEffect(() => {
        const timer = setTimeout(scrollToBottom, 50);
        return () => clearTimeout(timer);
    }, [messages, scrollToBottom]);

    // Update context
    useEffect(() => {
        if (sessionId && isOpen && analysisData) {
            fetch('/api/duo/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId })
            }).catch(console.error);
        }
    }, [sessionId, analysisData, isOpen]);

    // ==========================================================================
    // MESSAGE HANDLERS
    // ==========================================================================

    const handleStreamChunk = useCallback((data) => {
        setIsStreaming(true);
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    ...lastMsg,
                    content: lastMsg.content + (data.content || '')
                };
                return updated;
            }
            return [...prev, {
                role: 'assistant',
                content: data.content || '',
                timestamp: new Date(),
                isStreaming: true
            }];
        });
        if (data.thread_id) setThreadId(data.thread_id);
    }, []);

    const handleFullResponse = useCallback((data) => {
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    ...lastMsg,
                    content: data.content || lastMsg.content,
                    isStreaming: false
                };
                return updated;
            }
            return [...prev, {
                role: 'assistant',
                content: data.content,
                timestamp: new Date(),
                isStreaming: false
            }];
        });
        if (data.thread_id) setThreadId(data.thread_id);
        setIsLoading(false);
        setIsStreaming(false);
    }, []);

    const handleResponseComplete = useCallback((data) => {
        setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...updated[lastIdx], isStreaming: false };
            }
            return updated;
        });
        if (data.thread_id) setThreadId(data.thread_id);
        setIsLoading(false);
        setIsStreaming(false);
    }, []);

    const handleError = useCallback((data) => {
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.message || data.content || 'An error occurred',
            timestamp: new Date(),
            isStreaming: false,
            isError: true
        }]);
        setIsLoading(false);
        setIsStreaming(false);
    }, []);

    // ==========================================================================
    // WEBSOCKET
    // ==========================================================================

    const connectWebSocket = useCallback(() => {
        if (!sessionId || !isOpen) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/duo/${sessionId}`);

        ws.onopen = () => {
            console.log('✅ Duo Chat connected');
            while (messageQueueRef.current.length > 0) {
                ws.send(JSON.stringify(messageQueueRef.current.shift()));
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const normalized = {
                    ...data,
                    thread_id: data.threadId || data.thread_id,
                    content: data.content || data.message
                };

                switch (data.type) {
                    case 'start':
                        if (normalized.thread_id) setThreadId(normalized.thread_id);
                        setIsStreaming(true);
                        break;
                    case 'chunk':
                    case 'stream':
                        handleStreamChunk(normalized);
                        break;
                    case 'response':
                        handleFullResponse(normalized);
                        break;
                    case 'complete':
                        normalized.content ? handleFullResponse(normalized) : handleResponseComplete(normalized);
                        break;
                    case 'error':
                        handleError(normalized);
                        break;
                }
            } catch (e) {
                console.error('WebSocket parse error:', e);
            }
        };

        ws.onerror = () => {
            setIsLoading(false);
            setIsStreaming(false);
        };

        ws.onclose = () => {
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
        };

        wsRef.current = ws;
    }, [sessionId, isOpen, handleStreamChunk, handleFullResponse, handleResponseComplete, handleError]);

    useEffect(() => {
        if (isOpen && sessionId) connectWebSocket();
        return () => {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, [isOpen, sessionId, connectWebSocket]);

    // ==========================================================================
    // SEND MESSAGE
    // ==========================================================================

    const sendMessage = useCallback(async () => {
        if (!inputMessage.trim() || isLoading) return;

        const content = inputMessage.trim();
        setMessages(prev => [...prev, { role: 'user', content, timestamp: new Date() }]);
        setIsLoading(true);
        setInputMessage('');
        if (inputRef.current) inputRef.current.style.height = 'auto';

        const messageData = { type: 'chat', message: content, thread_id: threadId, stream: true };

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(messageData));
        } else {
            messageQueueRef.current.push(messageData);
            try {
                const response = await fetch('/api/duo/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: content, session_id: sessionId, thread_id: threadId })
                });
                const data = await response.json();
                if (data.response) handleFullResponse({ content: data.response, thread_id: data.threadId });
            } catch (error) {
                handleError({ message: error.message });
            }
        }
    }, [inputMessage, threadId, isLoading, sessionId, handleFullResponse, handleError]);

    const handleKeyPress = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    const clearChat = useCallback(() => {
        setMessages([]);
        setThreadId(null);
    }, []);

    // ==========================================================================
    // STYLES
    // ==========================================================================

    const widgetStyles = useMemo(() => {
        if (isFullscreen) {
            return { width: '100vw', height: '100vh', bottom: 0, right: 0, borderRadius: 0 };
        }
        return {
            width: isMinimized ? '260px' : '360px',
            height: isMinimized ? '36px' : 'min(600px, calc(100vh - 100px))',
            bottom: '16px',
            right: '16px',
            borderRadius: '8px'
        };
    }, [isFullscreen, isMinimized]);

    // ==========================================================================
    // RENDER
    // ==========================================================================

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-4 right-4 group z-50"
                >
                    <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105"
                        style={{
                            background: 'var(--accent)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                        }}
                    >
                        <MessageCircle className="w-5 h-5" style={{ color: 'var(--bg-primary)' }} />
                    </div>
                    <span
                        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                        style={{ background: '#22c55e', borderColor: 'var(--bg-primary)' }}
                    />
                </button>
            )}

            {/* Chat Widget */}
            {isOpen && (
                <div
                    className="fixed flex flex-col overflow-hidden z-50"
                    style={{
                        ...widgetStyles,
                        background: 'var(--bg-primary)',
                        border: '0.5px solid var(--border-primary)',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)'
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-2.5 py-1.5 shrink-0"
                        style={{ background: 'var(--bg-secondary)', borderBottom: '0.5px solid var(--border-primary)' }}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center"
                                style={{ background: 'var(--accent)' }}
                            >
                                <Bot className="w-4 h-4" style={{ color: 'var(--bg-primary)' }} />
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                                        GitLab Duo
                                    </span>
                                    <span
                                        className="px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider rounded"
                                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                                    >
                                        Chat
                                    </span>
                                </div>
                                {!isMinimized && (
                                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                        {isLoading ? 'Thinking...' : isStreaming ? 'Responding...' : 'Ready'}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-0.5">
                            {!isMinimized && (
                                <>
                                    <button
                                        onClick={clearChat}
                                        className="p-1.5 rounded-lg transition-colors"
                                        style={{ color: 'var(--text-tertiary)' }}
                                        title="Clear"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => setIsFullscreen(!isFullscreen)}
                                        className="p-1.5 rounded-lg transition-colors"
                                        style={{ color: 'var(--text-tertiary)' }}
                                    >
                                        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: 'var(--text-tertiary)' }}
                            >
                                {isMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: 'var(--text-tertiary)' }}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <>
                            {/* Messages */}
                            <div
                                className="flex-1 overflow-y-auto p-2 space-y-2"
                                style={{ background: 'var(--bg-primary)' }}
                            >
                                {/* Empty State */}
                                {messages.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                                        <div
                                            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                                            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
                                        >
                                            <Sparkles className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                                        </div>
                                        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                                            GitLab Duo Chat
                                        </h3>
                                        <p className="text-xs mb-4 max-w-[200px]" style={{ color: 'var(--text-tertiary)' }}>
                                            Ask about logs, errors, or GitLab configs
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5 w-full max-w-xs">
                                            {[
                                                { label: 'Find errors', query: 'What are the main errors?' },
                                                { label: 'Service health', query: 'Which services have issues?' },
                                                { label: 'Performance', query: 'Any performance problems?' },
                                                { label: 'Recent issues', query: 'Recent issues?' }
                                            ].map((action) => (
                                                <button
                                                    key={action.label}
                                                    onClick={() => { setInputMessage(action.query); inputRef.current?.focus(); }}
                                                    className="px-2 py-1.5 rounded-lg text-xs transition-colors"
                                                    style={{
                                                        background: 'var(--bg-secondary)',
                                                        color: 'var(--text-secondary)',
                                                        border: '1px solid var(--border-primary)'
                                                    }}
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Messages */}
                                {messages.map((message, idx) => (
                                    <div key={idx} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : ''}`}>
                                        {message.role === 'assistant' && (
                                            <div
                                                className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                                style={{ background: message.isError ? 'rgba(239,68,68,0.1)' : 'var(--bg-tertiary)' }}
                                            >
                                                {message.isError ? (
                                                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                                                ) : (
                                                    <Bot className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                                                )}
                                            </div>
                                        )}

                                        <div className={`max-w-[85%] ${message.role === 'user' ? 'order-1' : ''}`}>
                                            <div
                                                className="px-2 py-1 rounded-lg"
                                                style={{
                                                    background: message.role === 'user'
                                                        ? 'var(--accent)'
                                                        : message.isError
                                                            ? 'rgba(239,68,68,0.1)'
                                                            : 'var(--bg-secondary)',
                                                    border: message.role === 'user'
                                                        ? 'none'
                                                        : `0.5px solid ${message.isError ? 'rgba(239,68,68,0.15)' : 'var(--border-primary)'}`
                                                }}
                                            >
                                                <MessageContent
                                                    content={message.content}
                                                    role={message.role}
                                                    isStreaming={message.isStreaming}
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 px-1">
                                                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {message.role === 'assistant' && !message.isError && !message.isStreaming && (
                                                    <button
                                                        onClick={() => navigator.clipboard.writeText(message.content)}
                                                        className="flex items-center gap-0.5 text-[10px] opacity-50 hover:opacity-100 transition-opacity"
                                                        style={{ color: 'var(--text-tertiary)' }}
                                                    >
                                                        <Copy className="w-2.5 h-2.5" /> Copy
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {message.role === 'user' && (
                                            <div
                                                className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 order-2 mt-0.5"
                                                style={{ background: 'var(--bg-tertiary)' }}
                                            >
                                                <User className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Loading */}
                                {isLoading && !isStreaming && (
                                    <div className="flex gap-2">
                                        <div
                                            className="w-6 h-6 rounded-lg flex items-center justify-center"
                                            style={{ background: 'var(--bg-tertiary)' }}
                                        >
                                            <Bot className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                                        </div>
                                        <div
                                            className="px-3 py-2 rounded-xl"
                                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
                                        >
                                            <TypingIndicator />
                                        </div>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div
                                className="p-2 shrink-0"
                                style={{ background: 'var(--bg-primary)', borderTop: '0.5px solid var(--border-primary)' }}
                            >
                                <div className="flex gap-1.5">
                                    <textarea
                                        ref={inputRef}
                                        value={inputMessage}
                                        onChange={(e) => setInputMessage(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        placeholder="Ask about your logs..."
                                        className="flex-1 px-2.5 py-1.5 rounded-lg resize-none focus:outline-none text-sm"
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            border: '0.5px solid var(--border-primary)',
                                            color: 'var(--text-primary)',
                                            minHeight: '32px',
                                            maxHeight: '100px'
                                        }}
                                        disabled={isLoading}
                                        rows={1}
                                    />
                                    <button
                                        onClick={sendMessage}
                                        disabled={!inputMessage.trim() || isLoading}
                                        className="px-2.5 py-1.5 rounded-lg transition-all flex items-center justify-center"
                                        style={{
                                            background: inputMessage.trim() && !isLoading ? 'var(--accent)' : 'var(--bg-tertiary)',
                                            color: inputMessage.trim() && !isLoading ? 'var(--bg-primary)' : 'var(--text-tertiary)',
                                            cursor: !inputMessage.trim() || isLoading ? 'not-allowed' : 'pointer',
                                            minWidth: '36px'
                                        }}
                                    >
                                        {isLoading ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Send className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
};

export default DuoChatWidget;