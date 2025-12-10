#!/usr/bin/env python3
"""
Terminal WebSocket Handler for SOSLab
Real PTY-based terminal with full shell functionality
"""

import asyncio
import os
import pty
import select
import struct
import fcntl
import termios
import signal
import subprocess
from typing import Optional
from fastapi import WebSocket, WebSocketDisconnect
from pathlib import Path


class TerminalSession:
    """Manages a single PTY terminal session"""
    
    def __init__(self, working_dir: str = None, shell: str = None):
        self.working_dir = working_dir or os.path.expanduser("~")
        self.shell = shell or os.environ.get("SHELL", "/bin/bash")
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self.running = False
    
    def start(self) -> bool:
        """Start the PTY session"""
        try:
            # Create pseudo-terminal
            self.master_fd, self.slave_fd = pty.openpty()
            
            # Fork process
            self.pid = os.fork()
            
            if self.pid == 0:
                # Child process
                os.close(self.master_fd)
                os.setsid()
                
                # Set up slave as controlling terminal
                fcntl.ioctl(self.slave_fd, termios.TIOCSCTTY, 0)
                
                # Duplicate slave to stdin, stdout, stderr
                os.dup2(self.slave_fd, 0)
                os.dup2(self.slave_fd, 1)
                os.dup2(self.slave_fd, 2)
                
                if self.slave_fd > 2:
                    os.close(self.slave_fd)
                
                # Change to working directory
                os.chdir(self.working_dir)
                
                # Set environment
                env = os.environ.copy()
                env["TERM"] = "xterm-256color"
                env["COLORTERM"] = "truecolor"
                env["LC_ALL"] = "en_US.UTF-8"
                env["LANG"] = "en_US.UTF-8"
                
                # Execute shell
                os.execvpe(self.shell, [self.shell, "-l"], env)
            else:
                # Parent process
                os.close(self.slave_fd)
                self.slave_fd = None
                self.running = True
                
                # Set master to non-blocking
                flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
                fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
                
                return True
                
        except Exception as e:
            print(f"Failed to start terminal: {e}")
            self.cleanup()
            return False
    
    def resize(self, rows: int, cols: int):
        """Resize the terminal"""
        if self.master_fd is not None:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except Exception as e:
                print(f"Resize error: {e}")
    
    def write(self, data: bytes):
        """Write data to terminal"""
        if self.master_fd is not None and self.running:
            try:
                os.write(self.master_fd, data)
            except Exception as e:
                print(f"Write error: {e}")
    
    def read(self, timeout: float = 0.01) -> Optional[bytes]:
        """Read data from terminal"""
        if self.master_fd is None or not self.running:
            return None
        
        try:
            ready, _, _ = select.select([self.master_fd], [], [], timeout)
            if ready:
                return os.read(self.master_fd, 4096)
        except (OSError, IOError):
            self.running = False
        return None
    
    def cleanup(self):
        """Clean up terminal session"""
        self.running = False
        
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except:
                pass
            self.master_fd = None
        
        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except:
                pass
            self.slave_fd = None
        
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGTERM)
                os.waitpid(self.pid, os.WNOHANG)
            except:
                pass
            self.pid = None


class TerminalManager:
    """Manages multiple terminal sessions"""
    
    def __init__(self, base_dir: str = "data/extracted"):
        self.base_dir = Path(base_dir)
        self.sessions: dict[str, TerminalSession] = {}
    
    def create_session(self, session_id: str) -> TerminalSession:
        """Create a new terminal session"""
        # Ensure base directory exists
        self.base_dir.mkdir(parents=True, exist_ok=True)
        
        session = TerminalSession(working_dir=str(self.base_dir.absolute()))
        self.sessions[session_id] = session
        return session
    
    def get_session(self, session_id: str) -> Optional[TerminalSession]:
        """Get existing session"""
        return self.sessions.get(session_id)
    
    def remove_session(self, session_id: str):
        """Remove and cleanup session"""
        if session_id in self.sessions:
            self.sessions[session_id].cleanup()
            del self.sessions[session_id]
    
    def cleanup_all(self):
        """Cleanup all sessions"""
        for session_id in list(self.sessions.keys()):
            self.remove_session(session_id)


# Global terminal manager
terminal_manager = TerminalManager()


async def handle_terminal_websocket(websocket: WebSocket, session_id: str = "default"):
    """
    WebSocket handler for terminal connections
    
    Protocol:
    - Client sends JSON: {"type": "input", "data": "..."} for input
    - Client sends JSON: {"type": "resize", "rows": N, "cols": N} for resize
    - Server sends JSON: {"type": "output", "data": "..."} for output
    - Server sends JSON: {"type": "exit"} when terminal exits
    """
    await websocket.accept()
    print(f"🖥️  Terminal WebSocket connected: {session_id}")
    
    # Create terminal session
    session = terminal_manager.create_session(session_id)
    
    if not session.start():
        await websocket.send_json({"type": "error", "message": "Failed to start terminal"})
        await websocket.close()
        return
    
    # Set initial size
    session.resize(24, 80)
    
    async def read_output():
        """Read terminal output and send to WebSocket"""
        while session.running:
            try:
                data = session.read(timeout=0.05)
                if data:
                    # Send as base64 to handle binary data safely
                    import base64
                    await websocket.send_json({
                        "type": "output",
                        "data": base64.b64encode(data).decode("ascii")
                    })
                else:
                    await asyncio.sleep(0.01)
            except Exception as e:
                print(f"Output read error: {e}")
                break
        
        # Terminal exited
        try:
            await websocket.send_json({"type": "exit"})
        except:
            pass
    
    # Start output reader task
    output_task = asyncio.create_task(read_output())
    
    try:
        while session.running:
            try:
                # Receive message from client
                message = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=0.1
                )
                
                msg_type = message.get("type")
                
                if msg_type == "input":
                    # Write input to terminal
                    import base64
                    data = base64.b64decode(message.get("data", ""))
                    session.write(data)
                    
                elif msg_type == "resize":
                    # Resize terminal
                    rows = message.get("rows", 24)
                    cols = message.get("cols", 80)
                    session.resize(rows, cols)
                    
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                print(f"🔌 Terminal WebSocket disconnected: {session_id}")
                break
            except Exception as e:
                print(f"Terminal WebSocket error: {e}")
                break
    
    finally:
        # Cleanup
        output_task.cancel()
        try:
            await output_task
        except asyncio.CancelledError:
            pass
        
        terminal_manager.remove_session(session_id)
        print(f"🖥️  Terminal session ended: {session_id}")


# FastAPI endpoint to add to main.py
def register_terminal_routes(app):
    """Register terminal routes with FastAPI app"""
    
    @app.websocket("/ws/terminal/{session_id}")
    async def terminal_endpoint(websocket: WebSocket, session_id: str):
        await handle_terminal_websocket(websocket, session_id)
    
    @app.websocket("/ws/terminal")
    async def terminal_default_endpoint(websocket: WebSocket):
        import uuid
        session_id = str(uuid.uuid4())
        await handle_terminal_websocket(websocket, session_id)
    
    @app.get("/api/terminal/info")
    async def terminal_info():
        """Get terminal info"""
        return {
            "base_dir": str(terminal_manager.base_dir.absolute()),
            "active_sessions": len(terminal_manager.sessions),
            "shell": os.environ.get("SHELL", "/bin/bash")
        }


# Code to add to main.py:
TERMINAL_INTEGRATION_CODE = '''
# Add this import at the top of main.py
from terminal_handler import terminal_manager, handle_terminal_websocket

# Add these routes after the app is created

@app.websocket("/ws/terminal/{session_id}")
async def terminal_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for terminal sessions"""
    await handle_terminal_websocket(websocket, session_id)

@app.websocket("/ws/terminal")
async def terminal_default_endpoint(websocket: WebSocket):
    """WebSocket endpoint for default terminal session"""
    import uuid
    session_id = str(uuid.uuid4())
    await handle_terminal_websocket(websocket, session_id)

@app.get("/api/terminal/info")
async def terminal_info():
    """Get terminal info"""
    return {
        "base_dir": str(terminal_manager.base_dir.absolute()),
        "active_sessions": len(terminal_manager.sessions),
        "shell": os.environ.get("SHELL", "/bin/bash")
    }

# Add cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_terminal():
    terminal_manager.cleanup_all()
'''

if __name__ == "__main__":
    print("Terminal Handler Module")
    print("=" * 50)
    print(TERMINAL_INTEGRATION_CODE)