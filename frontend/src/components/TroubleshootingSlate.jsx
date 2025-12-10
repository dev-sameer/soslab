import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    FileText, X, Minimize2, Maximize2, Trash2, Download, Copy,
    GripVertical, Layers
} from 'lucide-react';

/**
 * TroubleshootingSlate - A simple persistent scratchpad
 * 
 * Features:
 * - Simple text area (not todo-style entries)
 * - Persists across browser refreshes via localStorage
 * - Agent tools can append text
 * - Clear button to reset
 * - Draggable panel
 */

const STORAGE_KEY = 'soslab_troubleshooting_slate';
const POSITION_KEY = 'soslab_slate_position';

const TroubleshootingSlate = ({ isOpen, onClose }) => {
    // State
    const [content, setContent] = useState('');
    const [isMinimized, setIsMinimized] = useState(false);
    const [position, setPosition] = useState({ x: 20, y: 100 });
    const [size, setSize] = useState({ width: 420, height: 500 });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'error'

    const textareaRef = useRef(null);
    const panelRef = useRef(null);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const savedContent = localStorage.getItem(STORAGE_KEY);
            if (savedContent) {
                setContent(savedContent);
            }

            const savedPosition = localStorage.getItem(POSITION_KEY);
            if (savedPosition) {
                const pos = JSON.parse(savedPosition);
                setPosition(pos.position || { x: 20, y: 100 });
                setSize(pos.size || { width: 420, height: 500 });
            }
        } catch (e) {
            console.error('Failed to load slate data:', e);
        }
    }, []);

    // Save content to localStorage whenever it changes (debounced)
    useEffect(() => {
        setSaveStatus('saving');
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, content);
                setSaveStatus('saved');
            } catch (e) {
                console.error('Failed to save slate:', e);
                setSaveStatus('error');
            }
        }, 300); // Debounce 300ms

        return () => clearTimeout(timer);
    }, [content]);

    // Save position/size
    useEffect(() => {
        try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({ position, size }));
        } catch (e) {
            console.error('Failed to save position:', e);
        }
    }, [position, size]);

    // Drag handlers
    const handleMouseDown = (e) => {
        if (e.target.closest('.no-drag')) return;
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
    };

    const handleMouseMove = useCallback((e) => {
        if (isDragging) {
            const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.x));
            const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y));
            setPosition({ x: newX, y: newY });
        }
        if (isResizing) {
            const newWidth = Math.max(300, Math.min(800, e.clientX - position.x));
            const newHeight = Math.max(200, Math.min(800, e.clientY - position.y));
            setSize({ width: newWidth, height: newHeight });
        }
    }, [isDragging, isResizing, dragOffset, position]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        setIsResizing(false);
    }, []);

    useEffect(() => {
        if (isDragging || isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

    // Append text (for agent to use)
    const appendToSlate = useCallback((text) => {
        setContent(prev => {
            const separator = prev.trim() ? '\n\n---\n\n' : '';
            const timestamp = new Date().toLocaleString();
            return prev + separator + `[${timestamp}]\n${text}`;
        });
        // Scroll to bottom
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
        }, 100);
    }, []);

    // Clear all
    const clearAll = () => {
        if (confirm('Clear the entire slate? This cannot be undone.')) {
            setContent('');
        }
    };

    // Export to file
    const exportToFile = () => {
        const blob = new Blob([
            `# Troubleshooting Slate\nExported: ${new Date().toLocaleString()}\n\n---\n\n${content}`
        ], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `troubleshooting-slate-${new Date().toISOString().split('T')[0]}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Copy to clipboard
    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(content);
            alert('Copied to clipboard!');
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    };

    // Expose appendToSlate globally for agent to use
    useEffect(() => {
        window.appendToSlate = appendToSlate;
        window.addToSlate = (entry) => {
            // Compatibility: handle both old format (object) and new format (string)
            if (typeof entry === 'string') {
                appendToSlate(entry);
            } else if (entry && typeof entry === 'object') {
                const title = entry.title ? `**${entry.title}**\n` : '';
                const severity = entry.severity ? `[${entry.severity.toUpperCase()}] ` : '';
                appendToSlate(`${severity}${title}${entry.content || ''}`);
            }
        };
        return () => {
            delete window.appendToSlate;
            delete window.addToSlate;
        };
    }, [appendToSlate]);

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            className="fixed z-50 flex flex-col"
            style={{
                left: position.x,
                top: position.y,
                width: isMinimized ? 280 : size.width,
                height: isMinimized ? 'auto' : size.height,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                transition: isDragging || isResizing ? 'none' : 'width 0.2s, height 0.2s'
            }}
        >
            {/* Header - Draggable */}
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-move select-none"
                style={{
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-primary)',
                    borderRadius: '12px 12px 0 0'
                }}
                onMouseDown={handleMouseDown}
            >
                <GripVertical className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                <Layers className="w-4 h-4" style={{ color: 'var(--accent)' }} />

                <span className="font-semibold text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
                    Slate
                </span>

                {/* Save status indicator */}
                <span className="text-xs" style={{
                    color: saveStatus === 'saved' ? 'var(--text-tertiary)' :
                        saveStatus === 'error' ? '#ef4444' : 'var(--accent)'
                }}>
                    {saveStatus === 'saved' ? '✓ saved' : saveStatus === 'saving' ? 'saving...' : '⚠ error'}
                </span>

                <div className="flex items-center gap-1 no-drag">
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="p-1 rounded hover:bg-black/10"
                        title={isMinimized ? "Expand" : "Minimize"}
                    >
                        {isMinimized ? (
                            <Maximize2 className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        ) : (
                            <Minimize2 className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        )}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 rounded hover:bg-red-500/20"
                        title="Close"
                    >
                        <X className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Simple Textarea - The actual slate */}
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Your notes here... 

Agent findings will be appended automatically.
Type freely - everything auto-saves."
                        className="flex-1 p-3 resize-none no-drag"
                        style={{
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            border: 'none',
                            outline: 'none',
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                            fontSize: '13px',
                            lineHeight: '1.6'
                        }}
                    />

                    {/* Footer toolbar */}
                    <div
                        className="flex items-center gap-2 px-3 py-2 no-drag"
                        style={{
                            borderTop: '1px solid var(--border-primary)',
                            background: 'var(--bg-secondary)'
                        }}
                    >
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            {content.length} chars
                        </span>

                        <div className="flex-1" />

                        <button
                            onClick={copyToClipboard}
                            className="p-1.5 rounded hover:bg-black/10"
                            title="Copy to clipboard"
                            disabled={!content}
                        >
                            <Copy className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>

                        <button
                            onClick={exportToFile}
                            className="p-1.5 rounded hover:bg-black/10"
                            title="Export as Markdown"
                            disabled={!content}
                        >
                            <Download className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>

                        <button
                            onClick={clearAll}
                            className="p-1.5 rounded hover:bg-red-500/20"
                            title="Clear slate"
                            disabled={!content}
                        >
                            <Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
                        </button>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                        style={{
                            background: 'linear-gradient(135deg, transparent 50%, var(--border-primary) 50%)',
                            borderRadius: '0 0 12px 0'
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setIsResizing(true);
                        }}
                    />
                </>
            )}
        </div>
    );
};

export default TroubleshootingSlate;