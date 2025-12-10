// TRUE Chrome-Style Tab Component - Trapezoid shape with separators
// Copy this to replace the TabWithRename component in App.jsx

import React, { useState, useEffect, useRef } from 'react';
import { Server, X, CheckCircle, AlertCircle } from 'lucide-react';

const ChromeTab = ({ node, isActive, onSelect, onRename, onClose }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(node.name);
    const [isHovered, setIsHovered] = useState(false);
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

    // Smart truncation
    const getDisplayName = () => {
        if (node.name.length <= 18) return node.name;
        return node.name.substring(0, 15) + '...';
    };

    const getDisplayFilename = () => {
        if (!node.filename) return '';
        if (node.filename.length <= 25) return node.filename;

        const parts = node.filename.split('.');
        const ext = parts.length > 1 ? parts.pop() : '';
        const name = parts.join('.');

        if (ext) {
            return name.substring(0, 18) + '...' + ext;
        }
        return node.filename.substring(0, 22) + '...';
    };

    // Chrome trapezoid shape using SVG path
    const tabPath = `
        M 12,32 
        L 4,8 
        Q 4,4 8,4 
        L ${isActive ? '100%' : 'calc(100% - 4px)'},4 
        Q ${isActive ? 'calc(100% - 4px)' : 'calc(100% - 8px)'},4 ${isActive ? 'calc(100% - 4px)' : 'calc(100% - 8px)'},8 
        L ${isActive ? 'calc(100% - 12px)' : 'calc(100% - 16px)'},32 
        Z
    `;

    return (
        <div
            className="relative flex items-center cursor-pointer group"
            style={{
                minWidth: '180px',
                maxWidth: '300px',
                height: '36px',
                marginRight: '-8px', // Overlap for Chrome effect
                paddingLeft: '16px',
                paddingRight: '12px',
                zIndex: isActive ? 10 : isHovered ? 5 : 1,
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 4px 12px rgba(0, 0, 0, 0.15)' : 'none'
            }}
            onClick={onSelect}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            title={`${node.name}${node.filename ? `\n${node.filename}` : ''}\n\nDouble-click to rename`}
        >
            {/* Chrome trapezoid background */}
            <svg
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                }}
                viewBox="0 0 100% 36"
                preserveAspectRatio="none"
            >
                <path
                    d="M 12,36 L 4,8 Q 4,4 8,4 L calc(100% - 8),4 Q calc(100% - 4),4 calc(100% - 4),8 L calc(100% - 12),36 Z"
                    fill={isActive ? 'var(--bg-primary)' : isHovered ? 'var(--bg-tertiary)' : 'var(--bg-secondary)'}
                    stroke="var(--border-primary)"
                    strokeWidth={isActive ? "1.5" : "0.5"}
                    style={{ transition: 'all 0.15s ease' }}
                />
                {/* Top accent for active tab */}
                {isActive && (
                    <line
                        x1="8"
                        y1="4"
                        x2="calc(100% - 8)"
                        y2="4"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />
                )}
            </svg>

            {/* Tab separator (right edge) */}
            {!isActive && (
                <div
                    style={{
                        position: 'absolute',
                        right: '0',
                        top: '8px',
                        bottom: '8px',
                        width: '1px',
                        background: 'linear-gradient(to bottom, transparent, var(--border-primary) 20%, var(--border-primary) 80%, transparent)',
                        opacity: isHovered ? 0 : 0.4,
                        transition: 'opacity 0.15s ease'
                    }}
                />
            )}

            {/* Content */}
            <div className="relative flex items-center w-full" style={{ zIndex: 1 }}>
                {/* Icon */}
                <Server
                    className="flex-shrink-0 mr-2.5"
                    style={{
                        width: '14px',
                        height: '14px',
                        color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                        transition: 'color 0.15s ease'
                    }}
                />

                {/* Text content */}
                <div className="flex-1 min-w-0 mr-2 overflow-hidden">
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={handleBlur}
                            className="w-full px-2 py-1 text-xs font-medium rounded"
                            style={{
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--accent)',
                                outline: 'none'
                            }}
                            maxLength={30}
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div
                            onDoubleClick={handleDoubleClick}
                            className="flex flex-col justify-center"
                            style={{ gap: '1px' }}
                        >
                            <div
                                className="truncate"
                                style={{
                                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    fontSize: '13px',
                                    fontWeight: isActive ? 600 : 500,
                                    lineHeight: '1.3',
                                    transition: 'color 0.15s ease'
                                }}
                                title={node.name}
                            >
                                {getDisplayName()}
                            </div>

                            {node.filename && (
                                <div
                                    className="truncate"
                                    style={{
                                        color: 'var(--text-tertiary)',
                                        fontSize: '10.5px',
                                        lineHeight: '1.2',
                                        opacity: isActive ? 0.9 : 0.7
                                    }}
                                    title={node.filename}
                                >
                                    {getDisplayFilename()}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Status */}
                {node.status === 'processing' && (
                    <div
                        className="animate-spin border-2 border-current border-t-transparent rounded-full flex-shrink-0 mr-1.5"
                        style={{
                            width: '12px',
                            height: '12px',
                            borderColor: 'var(--accent)',
                            borderTopColor: 'transparent'
                        }}
                    />
                )}
                {node.status === 'completed' && (
                    <CheckCircle
                        className="flex-shrink-0 mr-1.5"
                        style={{
                            width: '12px',
                            height: '12px',
                            color: '#10b981'
                        }}
                    />
                )}
                {node.status === 'failed' && (
                    <AlertCircle
                        className="flex-shrink-0 mr-1.5"
                        style={{
                            width: '12px',
                            height: '12px',
                            color: '#ef4444'
                        }}
                    />
                )}

                {/* Close button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="flex-shrink-0 rounded-full"
                    style={{
                        width: '18px',
                        height: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: isHovered || isActive ? 1 : 0,
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--hover-bg)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-tertiary)';
                    }}
                    title="Close tab"
                >
                    <X style={{ width: '11px', height: '11px' }} />
                </button>
            </div>
        </div>
    );
};

export default ChromeTab;
