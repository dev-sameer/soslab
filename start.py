#!/usr/bin/env python3
"""
GitLab SOS Analyzer - Ultimate Smart Start Script
"""
import subprocess
import sys
import time
import signal
import socket
import re
import json
from pathlib import Path
from threading import Thread, Event

class SmartRunner:
    def __init__(self):
        self.processes = []
        self.frontend_url = None
        self.frontend_ready = Event()
        
        # Set Python paths
        if sys.platform == "win32":
            self.python = str(Path("venv/Scripts/python.exe").absolute())
            self.pip = str(Path("venv/Scripts/pip.exe").absolute())
        else:
            self.python = str(Path("venv/bin/python").absolute())
            self.pip = str(Path("venv/bin/pip").absolute())
    
    def find_free_port(self, start_port):
        """Find next available port starting from start_port"""
        for port in range(start_port, start_port + 100):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('localhost', port))
            sock.close()
            if result != 0:  # Port is free
                return port
        return start_port + 100
    
    def kill_port(self, port):
        """Kill process on a port"""
        try:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True,
                text=True
            )
            if result.stdout.strip():
                pids = result.stdout.strip().split('\n')
                for pid in pids:
                    subprocess.run(["kill", "-9", pid], capture_output=True)
                time.sleep(0.5)
        except:
            pass
    
    def check_installed(self):
        """Check if everything is already installed"""
        checks = {
            "venv": Path("venv").exists(),
            "python_packages": False,
            "frontend_modules": Path("frontend/node_modules").exists()
        }
        
        # Check Python packages
        if checks["venv"]:
            result = subprocess.run(
                [self.python, "-c", "import fastapi, multipart, aiohttp"],
                capture_output=True
            )
            checks["python_packages"] = (result.returncode == 0)
        
        return checks
    
    def smart_setup(self):
        """Smart setup - only install what's needed"""
        checks = self.check_installed()
        
        # Python setup
        if not checks["venv"]:
            print("📦 First time setup - Creating Python environment...")
            subprocess.run([sys.executable, "-m", "venv", "venv"], check=True)
            checks["python_packages"] = False
        
        if not checks["python_packages"]:
            print("📦 Installing Python packages (one-time)...")
            
            # Upgrade pip silently
            subprocess.run([self.pip, "install", "--upgrade", "pip"], 
                         capture_output=True)
            
            # Critical packages
            packages = [
                "anyio==3.7.1",
                "python-multipart",  # Required for file uploads
                "fastapi==0.104.1",
                "uvicorn[standard]==0.24.0",
                "aiohttp==3.12.14",
                "websockets==12.0",
                "pandas==2.1.3",
                "numpy==1.26.2",
                "python-dotenv"
            ]
            
            for pkg in packages:
                subprocess.run([self.pip, "install", pkg], capture_output=True)
            
            print("   ✅ Python packages ready")
        else:
            print("✅ Python packages already installed")
        
        # Frontend setup
        if Path("frontend").exists():
            if not checks["frontend_modules"]:
                print("📦 Installing frontend packages (one-time)...")
                subprocess.run(["npm", "install"], cwd="frontend", 
                             capture_output=True)
                print("   ✅ Frontend packages ready")
            else:
                print("✅ Frontend packages already installed")
        
        # Create directories
        for dir_path in ["backend/data/uploads", 
                         "backend/data/extracted",
                         "backend/data/sessions"]:
            Path(dir_path).mkdir(parents=True, exist_ok=True)
    
    def start_backend(self):
        """Start backend service"""
        print("\n🚀 Starting Backend...")
        
        # Kill anything on port 8000
        self.kill_port(8000)
        
        # Start backend
        backend = subprocess.Popen(
            [self.python, "main.py"],
            cwd="backend",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        self.processes.append(("Backend", backend))
        
        # Wait for backend
        for i in range(50):  # 5 seconds
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if sock.connect_ex(('localhost', 8000)) == 0:
                sock.close()
                print("   ✅ Backend ready on http://localhost:8000")
                return True
            sock.close()
            time.sleep(0.1)
        
        print("   ⚠️ Backend starting slowly...")
        return False
    
    def start_mcp(self):
        """Start MCP if exists"""
        if not Path("backend/run_mcp.py").exists():
            return
        
        print("🤖 Starting MCP Server...")
        
        # Kill anything on port 8080
        self.kill_port(8080)
        
        mcp = subprocess.Popen(
            [self.python, "run_mcp.py"],
            cwd="backend",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        self.processes.append(("MCP", mcp))
        
        # Quick check
        time.sleep(2)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sock.connect_ex(('localhost', 8080)) == 0:
            sock.close()
            print("   ✅ MCP ready on http://localhost:8080")
        else:
            sock.close()
            print("   ⚠️ MCP starting...")
    
    def monitor_frontend_output(self, proc):
        """Monitor frontend output to find actual URL"""
        try:
            for line in proc.stdout:
                if line:
                    # Look for Vite's URL announcement
                    if "Local:" in line or "http://localhost:" in line:
                        # Extract port number
                        match = re.search(r'http://localhost:(\d+)', line)
                        if match:
                            port = match.group(1)
                            self.frontend_url = f"http://localhost:{port}"
                            print(f"   ✅ Frontend ready on {self.frontend_url}")
                            self.frontend_ready.set()
                            break
        except:
            pass
    
    def start_frontend(self):
        """Start frontend with smart port detection"""
        if not Path("frontend").exists():
            return None
        
        print("🌐 Starting Frontend...")
        
        # Check Node.js
        result = subprocess.run(["node", "--version"], capture_output=True)
        if result.returncode != 0:
            print("   ⚠️ Node.js not found - backend only mode")
            return None
        
        # Kill common frontend ports to avoid conflicts
        for port in [3000, 3001, 5173, 5174]:
            self.kill_port(port)
        
        time.sleep(1)  # Give time for ports to close
        
        # Start frontend with output monitoring
        frontend = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd="frontend",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        self.processes.append(("Frontend", frontend))
        
        # Monitor output in background thread
        monitor_thread = Thread(
            target=self.monitor_frontend_output,
            args=(frontend,),
            daemon=True
        )
        monitor_thread.start()
        
        # Wait for frontend to announce its URL (up to 30 seconds)
        print("   ⏳ Waiting for frontend to start...")
        if self.frontend_ready.wait(timeout=30):
            return self.frontend_url
        else:
            # Fallback - try common ports
            for port in [3000, 3001, 5173, 5174]:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                if sock.connect_ex(('localhost', port)) == 0:
                    sock.close()
                    self.frontend_url = f"http://localhost:{port}"
                    print(f"   ✅ Frontend found on {self.frontend_url}")
                    return self.frontend_url
                sock.close()
            
            print("   ⚠️ Frontend is starting slowly...")
            return None
    
    def run(self):
        """Main run function"""
        print("=" * 70)
        print("🚀 GitLab SOS Analyzer - Smart One-Click Start")
        print("=" * 70)
        
        # Check we're in right directory
        if not Path("backend").exists():
            print("\n❌ Error: Not in project root directory!")
            print("   Run this from the directory containing 'backend' folder")
            return 1
        
        # Smart setup - only installs if needed
        print("\n🔍 Checking installation...")
        start_time = time.time()
        self.smart_setup()
        setup_time = time.time() - start_time
        
        if setup_time < 2:
            print(f"⚡ Fast startup - everything already installed ({setup_time:.1f}s)")
        else:
            print(f"✅ Setup complete ({setup_time:.1f}s)")
        
        # Start all services
        print("\n" + "=" * 70)
        print("Starting Services:")
        print("-" * 70)
        
        backend_ok = self.start_backend()
        self.start_mcp()
        frontend_url = self.start_frontend()
        
        # Determine best URL
        if frontend_url:
            primary_url = frontend_url
        else:
            primary_url = "http://localhost:8000"
        
        # Final status
        print("\n" + "=" * 70)
        print("🎉 GitLab SOS Analyzer is Running!")
        print("=" * 70)
        
        print("\n📊 Services Status:")
        print("-" * 70)
        
        # Check actual status
        services_status = []
        
        # Backend
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sock.connect_ex(('localhost', 8000)) == 0:
            print("✅ Backend API:  http://localhost:8000")
            services_status.append("backend")
        else:
            print("⚠️ Backend API:  Starting...")
        sock.close()
        
        # MCP
        if Path("backend/run_mcp.py").exists():
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if sock.connect_ex(('localhost', 8080)) == 0:
                print("✅ MCP Server:   http://localhost:8080")
                services_status.append("mcp")
            else:
                print("⚠️ MCP Server:   Starting...")
            sock.close()
        
        # Frontend
        if frontend_url:
            print(f"✅ Frontend UI:  {frontend_url}")
            services_status.append("frontend")
        elif Path("frontend").exists():
            print("⏳ Frontend UI:  Building... (may take 10-20s)")
        
        print("=" * 70)
        print(f"\n🌟 Open your browser to: {primary_url}")
        print("\n🛑 Press Ctrl+C to stop all services")
        print("=" * 70)
        
        # Open browser automatically
        time.sleep(1)
        if sys.platform == "darwin":
            subprocess.run(["open", primary_url], capture_output=True)
        elif "linux" in sys.platform:
            subprocess.run(["xdg-open", primary_url], capture_output=True)
        
        # Create quick restart script
        self.create_quick_script()
        
        # Handle shutdown
        def shutdown(sig, frame):
            print("\n\n🛑 Stopping all services...")
            for name, proc in self.processes:
                if proc.poll() is None:
                    proc.terminate()
            print("✅ All services stopped")
            print("\n💡 To restart: python start.py")
            sys.exit(0)
        
        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)
        
        # Monitor services
        print("\n💚 All systems operational. Monitoring services...")
        
        try:
            check_count = 0
            while True:
                time.sleep(10)
                check_count += 1
                
                # Periodic health check (every minute)
                if check_count % 6 == 0:
                    dead = []
                    for name, proc in self.processes:
                        if proc.poll() is not None:
                            dead.append(name)
                    
                    if dead:
                        print(f"\n⚠️ Services stopped: {', '.join(dead)}")
                        print("   Run 'python run.py' to restart")
                
        except KeyboardInterrupt:
            shutdown(None, None)
        
        return 0
    
    def create_quick_script(self):
        """Create an even quicker start script for next time"""
        quick = f'''#!/usr/bin/env python3
# Quick start - skips all checks
import subprocess, signal, sys
processes = []
def stop(s,f):
    for p in processes: p.terminate()
    sys.exit(0)
signal.signal(signal.SIGINT, stop)
processes.append(subprocess.Popen(["{self.python}", "main.py"], cwd="backend"))
if Path("backend/run_mcp.py").exists():
    processes.append(subprocess.Popen(["{self.python}", "run_mcp.py"], cwd="backend"))
if Path("frontend").exists():
    processes.append(subprocess.Popen(["npm", "run", "dev"], cwd="frontend"))
print("✅ Started! Frontend will open on http://localhost:3000 or 3001")
print("Press Ctrl+C to stop")
while True: time.sleep(1)
'''
        Path("quick.py").write_text(quick)

if __name__ == "__main__":
    runner = SmartRunner()
    sys.exit(runner.run())