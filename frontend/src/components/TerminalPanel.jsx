import React, { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';

const TerminalPanel = ({
    isOpen,
    onClose,
    defaultHeight = 300,
    minHeight = 150,
    maxHeight = 600
}) => {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const wsRef = useRef(null);
    const [isMaximized, setIsMaximized] = useState(false);
    const [height, setHeight] = useState(defaultHeight);
    const [isResizing, setIsResizing] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!isOpen || !terminalRef.current) return;

        let terminal, fitAddon, webLinksAddon, webglAddon;
        let resizeObserver;
        let isMounted = true;

        const initTerminal = async () => {
            try {
                // Dynamic imports for xterm
                const { Terminal } = await import('xterm');
                const { FitAddon } = await import('xterm-addon-fit');
                const { WebLinksAddon } = await import('xterm-addon-web-links');
                const { WebglAddon } = await import('xterm-addon-webgl');

                // Import CSS
                await import('xterm/css/xterm.css');

                if (!isMounted) return;

                // Create terminal instance with EXACT VS Code Dark+ theme
                terminal = new Terminal({
                    cursorBlink: true,
                    cursorStyle: 'block',
                    fontSize: 12, // Crisp, small size
                    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                    fontWeight: 400, // Lighter weight for cleaner look
                    letterSpacing: 0,
                    lineHeight: 1.35, // More breathing room
                    drawBoldTextInBrightColors: false, // Consistent colors
                    theme: {
                        background: '#1e1e1e',
                        foreground: '#cccccc',
                        cursor: '#ffffff',
                        selectionBackground: '#264f78',
                        black: '#000000',
                        red: '#cd3131',
                        green: '#0dbc79',
                        yellow: '#e5e510',
                        blue: '#2472c8',
                        magenta: '#bc3fbc',
                        cyan: '#11a8cd',
                        white: '#e5e5e5',
                        brightBlack: '#666666',
                        brightRed: '#f14c4c',
                        brightGreen: '#23d18b',
                        brightYellow: '#f5f543',
                        brightBlue: '#3b8eea',
                        brightMagenta: '#d670d6',
                        brightCyan: '#29b8db',
                        brightWhite: '#e5e5e5'
                    },
                    scrollback: 10000,
                    allowProposedApi: true,
                    rendererType: 'canvas' // Fallback if WebGL fails
                });

                // Create addons
                fitAddon = new FitAddon();
                webLinksAddon = new WebLinksAddon();

                // Load addons
                terminal.loadAddon(fitAddon);
                terminal.loadAddon(webLinksAddon);

                // Open terminal in DOM
                if (terminalRef.current) {
                    terminal.open(terminalRef.current);
                }

                // Initialize WebGL addon AFTER opening terminal (required)
                try {
                    webglAddon = new WebglAddon();
                    webglAddon.onContextLoss(e => {
                        webglAddon.dispose();
                    });
                    terminal.loadAddon(webglAddon);
                    console.log('Terminal WebGL renderer enabled');
                } catch (e) {
                    console.warn('WebGL addon failed to load, falling back to canvas', e);
                }

                // Store refs
                xtermRef.current = terminal;
                fitAddonRef.current = fitAddon;

                // Fit terminal to container
                setTimeout(() => {
                    if (isMounted && fitAddon) {
                        try {
                            fitAddon.fit();
                        } catch (e) {
                            console.warn('Initial fit error:', e);
                        }
                    }
                }, 100);

                // Connect WebSocket
                if (isMounted) {
                    connectWebSocket(terminal, fitAddon);
                }

                // Handle resize
                resizeObserver = new ResizeObserver(() => {
                    if (fitAddon && terminal && isMounted) {
                        try {
                            fitAddon.fit();
                        } catch (e) {
                            // Ignore resize errors during cleanup
                        }
                    }
                });

                if (terminalRef.current) {
                    resizeObserver.observe(terminalRef.current);
                }

            } catch (error) {
                console.error('Failed to initialize terminal:', error);
                if (isMounted) {
                    terminal?.write('\r\n\x1b[31mFailed to initialize terminal\x1b[0m\r\n');
                }
            }
        };

        initTerminal();

        return () => {
            isMounted = false;

            if (resizeObserver) {
                resizeObserver.disconnect();
            }

            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            if (xtermRef.current) {
                try {
                    xtermRef.current.dispose();
                } catch (e) {
                    console.warn('Error disposing terminal:', e);
                }
                xtermRef.current = null;
            }
        };
    }, [isOpen]);

    const connectWebSocket = (terminal, fitAddon) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Handle both dev (port 3000 -> 8000 via proxy) and prod scenarios
        const host = window.location.host; // Includes port if present
        const wsUrl = `${protocol}//${host}/ws/terminal`;

        terminal.write('\r\n\x1b[33mConnecting to terminal...\x1b[0m\r\n');

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            terminal.write('\x1b[32mConnected!\x1b[0m\r\n\r\n');
            setIsConnected(true);

            // Send initial size
            try {
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    ws.send(JSON.stringify({
                        type: 'resize',
                        rows: dims.rows,
                        cols: dims.cols
                    }));
                }
            } catch (e) {
                console.warn('Initial resize error:', e);
            }

            // Handle terminal input
            terminal.onData((data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'input',
                        data: btoa(data) // Base64 encode
                    }));
                }
            });

            // Handle terminal resize
            terminal.onResize(({ rows, cols }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'resize',
                        rows,
                        cols
                    }));
                }
            });
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'output') {
                    // Decode base64 output
                    const output = atob(message.data);
                    terminal.write(output);
                } else if (message.type === 'exit') {
                    terminal.write('\r\n\x1b[33mTerminal session ended\x1b[0m\r\n');
                    setIsConnected(false);
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            terminal.write('\r\n\x1b[31mConnection error. Check backend.\x1b[0m\r\n');
            setIsConnected(false);
        };

        ws.onclose = () => {
            terminal.write('\r\n\x1b[33mDisconnected from terminal\x1b[0m\r\n');
            setIsConnected(false);
        };
    };

    const handleResize = (e) => {
        if (!isResizing) return;

        const newHeight = window.innerHeight - e.clientY;
        const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
        setHeight(clampedHeight);

        // Fit terminal after resize
        setTimeout(() => {
            if (fitAddonRef.current && xtermRef.current) {
                try {
                    fitAddonRef.current.fit();
                } catch (e) {
                    console.warn('Resize error:', e);
                }
            }
        }, 0);
    };

    const handleMouseDown = () => {
        setIsResizing(true);
    };

    const handleMouseUp = () => {
        setIsResizing(false);
    };

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleResize);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing]);

    const toggleMaximize = () => {
        setIsMaximized(!isMaximized);
        setTimeout(() => {
            if (fitAddonRef.current && xtermRef.current) {
                try {
                    fitAddonRef.current.fit();
                } catch (e) {
                    console.warn('Maximize resize error:', e);
                }
            }
        }, 100);
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#1e1e1e] border-t border-[#333333] shadow-2xl font-sans"
            style={{
                height: isMaximized ? '100vh' : `${height}px`,
                transition: isMaximized ? 'height 0.2s ease' : 'none'
            }}
        >
            {/* Resize Handle */}
            {!isMaximized && (
                <div
                    className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-[#007fd4] transition-colors z-10"
                    onMouseDown={handleMouseDown}
                />
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1 bg-[#1e1e1e] border-b border-[#2b2b2b]">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#89d185]' : 'bg-[#f14c4c]'}`} />
                        <span className="text-[10px] font-medium tracking-widest text-[#cccccc] uppercase">TERMINAL</span>
                    </div>
                    <span className="text-[9px] text-[#808080]">
                        {isConnected ? 'bash' : 'disconnected'}
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleMaximize}
                        className="p-1 hover:bg-[#333333] rounded transition-colors"
                        title={isMaximized ? 'Restore' : 'Maximize'}
                    >
                        {isMaximized ? (
                            <Minimize2 className="w-3 h-3 text-[#cccccc]" />
                        ) : (
                            <Maximize2 className="w-3 h-3 text-[#cccccc]" />
                        )}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-[#333333] rounded transition-colors"
                        title="Close"
                    >
                        <X className="w-3 h-3 text-[#cccccc]" />
                    </button>
                </div>
            </div>

            {/* Terminal Container */}
            <div
                ref={terminalRef}
                className="w-full h-[calc(100%-26px)] pl-2 pt-1 overflow-hidden"
                style={{ backgroundColor: '#1e1e1e' }}
            />
        </div>
    );
};

export default TerminalPanel;
