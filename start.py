#!/usr/bin/env python3
"""
GitLab SOS Analyzer - Ultimate Smart Start Script
Complete version with auto Python version handling and debug mode
"""
import subprocess
import sys
import time
import signal
import socket
import re
import argparse
import shutil
from pathlib import Path
from threading import Thread, Event

class SmartRunner:
    def __init__(self, debug_mode=False, force_reinstall=False):
        """Initialize the SmartRunner"""
        self.debug = debug_mode
        self.force_reinstall = force_reinstall
        self.processes = []
        self.frontend_url = None
        self.frontend_ready = Event()
        
        # Set Python paths based on platform
        if sys.platform == "win32":
            self.python = str(Path("venv/Scripts/python.exe").absolute())
            self.pip = str(Path("venv/Scripts/pip.exe").absolute())
        else:
            self.python = str(Path("venv/bin/python").absolute())
            self.pip = str(Path("venv/bin/pip").absolute())
    
    def log_debug(self, message):
        """Print debug message if in debug mode"""
        if self.debug:
            print(f"   🔧 [DEBUG] {message}")
    
    def get_python_version(self):
        """Get the current Python version as tuple (major, minor)"""
        try:
            result = subprocess.run(
                [sys.executable, "--version"],
                capture_output=True,
                text=True
            )
            version_str = result.stdout.strip()
            # Extract version numbers
            import re
            match = re.search(r'(\d+)\.(\d+)', version_str)
            if match:
                return (int(match.group(1)), int(match.group(2)))
        except Exception as e:
            self.log_debug(f"Could not get Python version: {e}")
        return (3, 11)  # Default to 3.11 if can't detect
    
    def get_compatible_pandas_version(self):
        """Get the appropriate pandas version for current Python"""
        major, minor = self.get_python_version()
        
        # Python version to pandas version mapping
        if (major, minor) >= (3, 13):
            # Python 3.13+ needs pandas 2.2.3 or newer
            return "pandas>=2.2.3"
        elif (major, minor) == (3, 12):
            # Python 3.12 works with pandas 2.1.x and newer
            return "pandas>=2.1.3,<3.0"
        elif (major, minor) >= (3, 9):
            # Python 3.9-3.11 work with pandas 2.1.3
            return "pandas>=2.1.3,<3.0"
        else:
            # Older Python versions
            return "pandas>=1.3.0,<2.0"
    
    def get_compatible_numpy_version(self):
        """Get the appropriate numpy version for current Python"""
        major, minor = self.get_python_version()
        
        # NumPy compatibility
        if (major, minor) >= (3, 13):
            # Python 3.13+ needs newer numpy
            return "numpy>=1.26.0,<2.0"
        elif (major, minor) >= (3, 12):
            # Python 3.12
            return "numpy>=1.23.5,<2.0"
        else:
            # Older Python versions
            return "numpy>=1.21.0,<2.0"
    
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
        """Kill process on a port - cross-platform"""
        try:
            if sys.platform == "win32":
                # Windows
                result = subprocess.run(
                    f"netstat -ano | findstr :{port}",
                    shell=True,
                    capture_output=True,
                    text=True
                )
                if result.stdout:
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        parts = line.split()
                        if len(parts) > 4:
                            pid = parts[-1]
                            subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
            else:
                # Unix/Linux/Mac
                result = subprocess.run(
                    ["lsof", "-ti", f":{port}"],
                    capture_output=True,
                    text=True
                )
                if result.stdout.strip():
                    pids = result.stdout.strip().split('\n')
                    for pid in pids:
                        subprocess.run(["kill", "-9", pid], capture_output=True)
            
            time.sleep(0.5)  # Give time for port to be released
        except Exception as e:
            self.log_debug(f"Could not kill port {port}: {e}")
    
    def check_python_version_mismatch(self):
        """Check if venv was created with different Python version"""
        if not Path("venv").exists():
            return False
        
        try:
            # Get current Python version
            current_result = subprocess.run(
                [sys.executable, "--version"],
                capture_output=True,
                text=True
            )
            current_version = current_result.stdout.strip()
            
            # Get venv Python version
            if Path(self.python).exists():
                venv_result = subprocess.run(
                    [self.python, "--version"],
                    capture_output=True,
                    text=True
                )
                venv_version = venv_result.stdout.strip()
                
                # Extract major.minor version numbers
                import re
                current_match = re.search(r'(\d+\.\d+)', current_version)
                venv_match = re.search(r'(\d+\.\d+)', venv_version)
                
                if current_match and venv_match:
                    current_ver = current_match.group(1)
                    venv_ver = venv_match.group(1)
                    
                    if current_ver != venv_ver:
                        print(f"   ⚠️ Python version changed ({venv_ver} → {current_ver})")
                        self.log_debug(f"Current: {current_version}, Venv: {venv_version}")
                        return True
        except Exception as e:
            self.log_debug(f"Error checking Python version: {e}")
        
        return False
    
    def check_packages_installed(self):
        """Check if all required Python packages are installed"""
        if not Path(self.python).exists():
            return False
        
        test_script = """
import sys
try:
    import fastapi
    import multipart
    import aiohttp
    import aiofiles
    import pandas
    import numpy
    import uvicorn
    import websockets
    import psutil
    print("OK")
except ImportError as e:
    print(f"MISSING:{e.name if hasattr(e, 'name') else str(e)}")
except Exception as e:
    print(f"ERROR:{e}")
"""
        
        try:
            result = subprocess.run(
                [self.python, "-c", test_script],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            output = result.stdout.strip()
            if output == "OK":
                return True
            elif output.startswith("MISSING:"):
                missing = output.split(':')[1] if ':' in output else output
                self.log_debug(f"Missing package: {missing}")
                
                # Special handling for pandas on Python 3.13+
                if "pandas" in missing.lower():
                    py_version = self.get_python_version()
                    if py_version >= (3, 13):
                        print("   ⚠️ Pandas compatibility issue detected with Python 3.13+")
                        print("   📝 Will install compatible version...")
                return False
            else:
                self.log_debug(f"Package check result: {output}")
                return False
                
        except subprocess.TimeoutExpired:
            self.log_debug("Package check timed out")
            return False
        except Exception as e:
            self.log_debug(f"Package check error: {e}")
            return False
    
    def recreate_venv(self):
        """Recreate virtual environment with current Python version"""
        print("   📦 Recreating virtual environment...")
        
        # Remove old venv
        if Path("venv").exists():
            try:
                shutil.rmtree("venv")
                self.log_debug("Removed old venv")
            except Exception as e:
                self.log_debug(f"Error removing old venv: {e}")
                print("   ⚠️ Could not remove old venv, trying to continue...")
        
        # Create new venv
        try:
            subprocess.run([sys.executable, "-m", "venv", "venv"], check=True)
            
            # Update paths for new venv
            if sys.platform == "win32":
                self.python = str(Path("venv/Scripts/python.exe").absolute())
                self.pip = str(Path("venv/Scripts/pip.exe").absolute())
            else:
                self.python = str(Path("venv/bin/python").absolute())
                self.pip = str(Path("venv/bin/pip").absolute())
            
            print("   ✅ Virtual environment recreated")
            return True
            
        except Exception as e:
            print(f"   ❌ Failed to create virtual environment: {e}")
            return False
    
    def install_packages(self):
        """Install all required Python packages with version compatibility"""
        print("   📦 Installing Python packages...")
        
        # First upgrade pip
        try:
            if self.debug:
                subprocess.run([self.pip, "install", "--upgrade", "pip"])
            else:
                subprocess.run([self.pip, "install", "--upgrade", "pip"], 
                             capture_output=True)
        except Exception as e:
            self.log_debug(f"Failed to upgrade pip: {e}")
        
        # Get Python version for compatibility
        py_version = self.get_python_version()
        self.log_debug(f"Python version detected: {py_version[0]}.{py_version[1]}")
        
        # Get compatible versions
        pandas_spec = self.get_compatible_pandas_version()
        numpy_spec = self.get_compatible_numpy_version()
        
        self.log_debug(f"Using pandas spec: {pandas_spec}")
        self.log_debug(f"Using numpy spec: {numpy_spec}")
        
        # List of required packages with dynamic versions
        packages = [
            "anyio==3.7.1",
            "python-multipart",
            "fastapi==0.104.1",
            "uvicorn[standard]==0.24.0",
            "aiohttp==3.12.14",
            "aiofiles==23.2.1",
            "websockets==12.0",
            numpy_spec,  # Dynamic numpy version
            pandas_spec,  # Dynamic pandas version
            "python-dotenv",
            "psutil==5.9.6"  # Memory monitoring for performance optimizations
        ]
        
        # Install packages with progress
        total = len(packages)
        failed = []
        
        for i, pkg in enumerate(packages, 1):
            pkg_name = pkg.split('==')[0].split('>=')[0].split('[')[0]
            
            try:
                if self.debug:
                    print(f"   📦 Installing {pkg}... ({i}/{total})")
                    result = subprocess.run([self.pip, "install", pkg])
                    if result.returncode != 0:
                        failed.append(pkg_name)
                else:
                    print(f"   📦 Installing {pkg_name}... ({i}/{total})", end='\r')
                    result = subprocess.run([self.pip, "install", pkg], 
                                          capture_output=True)
                    if result.returncode != 0:
                        failed.append(pkg_name)
            except Exception as e:
                self.log_debug(f"Failed to install {pkg}: {e}")
                failed.append(pkg_name)
        
        # Clear progress line in non-debug mode
        if not self.debug:
            print(" " * 60, end='\r')
        
        # Special handling for pandas failures on Python 3.13+
        if "pandas" in failed and py_version >= (3, 13):
            print("   ⚠️ Pandas installation failed - trying latest version...")
            
            # Try installing latest pandas without version constraint
            try:
                if self.debug:
                    print("   📦 Installing latest pandas...")
                    result = subprocess.run([self.pip, "install", "--upgrade", "pandas"])
                else:
                    result = subprocess.run([self.pip, "install", "--upgrade", "pandas"], 
                                          capture_output=True)
                
                if result.returncode == 0:
                    failed.remove("pandas")
                    print("   ✅ Pandas installed successfully with latest version")
            except Exception as e:
                self.log_debug(f"Alternate pandas install failed: {e}")
        
        if failed:
            print(f"   ⚠️ Some packages failed: {', '.join(failed)}")
            print("   💡 Try running with --debug to see errors")
            
            # Provide specific guidance for pandas on Python 3.13
            if "pandas" in failed and py_version >= (3, 13):
                print("\n   📝 Note: Python 3.13 requires pandas 2.2.3 or newer")
                print("   You may need to manually install: pip install 'pandas>=2.2.3'")
        else:
            print("   ✅ Python packages installed")
        
        return len(failed) == 0
    
    def setup_environment(self):
        """Smart setup - handles Python version changes automatically"""
        print("\n🔍 Checking installation...")
        
        # Show Python version info
        py_version = self.get_python_version()
        print(f"   📌 Python {py_version[0]}.{py_version[1]} detected")
        
        # Check if venv exists
        venv_exists = Path("venv").exists()
        
        # Check for Python version mismatch
        version_mismatch = False
        if venv_exists:
            version_mismatch = self.check_python_version_mismatch()
        
        # Handle version mismatch
        if version_mismatch:
            print("🔄 Auto-fixing Python version change...")
            if not self.recreate_venv():
                return False
            venv_exists = True
            packages_ok = False  # Need to reinstall after recreating venv
        else:
            # Check if packages are installed
            packages_ok = venv_exists and self.check_packages_installed()
        
        # Create venv if doesn't exist
        if not venv_exists:
            print("📦 First time setup - Creating virtual environment...")
            try:
                subprocess.run([sys.executable, "-m", "venv", "venv"], check=True)
                packages_ok = False  # Need to install packages
            except Exception as e:
                print(f"   ❌ Failed to create virtual environment: {e}")
                return False
        
        # Install packages if needed or forced
        if not packages_ok or self.force_reinstall:
            if self.force_reinstall:
                print("🔄 Force reinstall mode")
            elif not packages_ok:
                print("📦 Installing required packages...")
            
            # Show special note for Python 3.13+
            if py_version >= (3, 13):
                print("   📝 Note: Using Python 3.13+ compatible package versions")
            
            if not self.install_packages():
                print("   ⚠️ Some packages failed to install, continuing anyway...")
        else:
            print("✅ Python packages already installed")
        
        # Setup frontend if exists
        if Path("frontend").exists():
            if not Path("frontend/node_modules").exists() or self.force_reinstall:
                print("📦 Installing frontend packages...")
                try:
                    if self.debug:
                        subprocess.run(["npm", "install"], cwd="frontend")
                    else:
                        subprocess.run(["npm", "install"], cwd="frontend", 
                                     capture_output=True)
                    print("   ✅ Frontend packages installed")
                except Exception as e:
                    print(f"   ⚠️ Frontend setup failed: {e}")
            else:
                print("✅ Frontend packages already installed")
        
        # Create required directories
        for dir_path in ["backend/data/uploads", 
                         "backend/data/extracted",
                         "backend/data/sessions"]:
            Path(dir_path).mkdir(parents=True, exist_ok=True)
        
        return True
    
    def start_backend(self):
        """Start backend service"""
        print("\n🚀 Starting Backend...")
        
        self.log_debug("Killing any process on port 8000...")
        self.kill_port(8000)
        
        self.log_debug(f"Starting backend with: {self.python} main.py")
        
        # Start backend
        try:
            if self.debug:
                backend = subprocess.Popen(
                    [self.python, "main.py"],
                    cwd="backend"
                )
            else:
                backend = subprocess.Popen(
                    [self.python, "main.py"],
                    cwd="backend",
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            
            self.processes.append(("Backend", backend))
            
            # Wait for backend to be ready
            self.log_debug("Waiting for backend on port 8000...")
            
            for i in range(50):  # 5 seconds
                # Check if process died
                if backend.poll() is not None:
                    print("   ❌ Backend failed to start!")
                    if not self.debug:
                        print("   💡 Run with --debug to see the error")
                    return False
                
                # Check if port is open
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                if sock.connect_ex(('localhost', 8000)) == 0:
                    sock.close()
                    print("   ✅ Backend ready on http://localhost:8000")
                    return True
                sock.close()
                
                time.sleep(0.1)
                if self.debug and i % 10 == 0:
                    self.log_debug(f"Still waiting... ({i/10}s)")
            
            print("   ⚠️ Backend starting slowly...")
            return False
            
        except Exception as e:
            print(f"   ❌ Failed to start backend: {e}")
            return False
    
    def start_mcp(self):
        """Start MCP server if exists"""
        if not Path("backend/run_mcp.py").exists():
            self.log_debug("MCP script not found, skipping...")
            return
        
        print("🤖 Starting MCP Server...")
        
        self.log_debug("Killing any process on port 8080...")
        self.kill_port(8080)
        
        try:
            if self.debug:
                mcp = subprocess.Popen(
                    [self.python, "run_mcp.py"],
                    cwd="backend"
                )
            else:
                mcp = subprocess.Popen(
                    [self.python, "run_mcp.py"],
                    cwd="backend",
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            
            self.processes.append(("MCP", mcp))
            
            # Quick check if started
            time.sleep(2)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if sock.connect_ex(('localhost', 8080)) == 0:
                sock.close()
                print("   ✅ MCP ready on http://localhost:8080")
            else:
                sock.close()
                print("   ⚠️ MCP starting...")
                
        except Exception as e:
            print(f"   ⚠️ Failed to start MCP: {e}")
    
    def monitor_frontend_output(self, proc):
        """Monitor frontend output to find the URL"""
        try:
            for line in proc.stdout:
                if line:
                    if self.debug:
                        print(f"   🔧 [FRONTEND] {line.strip()}")
                    
                    # Look for the URL in output
                    if "Local:" in line or "http://localhost:" in line:
                        match = re.search(r'http://localhost:(\d+)', line)
                        if match:
                            port = match.group(1)
                            self.frontend_url = f"http://localhost:{port}"
                            print(f"   ✅ Frontend ready on {self.frontend_url}")
                            self.frontend_ready.set()
                            if not self.debug:
                                break
        except Exception as e:
            self.log_debug(f"Error monitoring frontend: {e}")
    
    def start_frontend(self):
        """Start frontend if exists"""
        if not Path("frontend").exists():
            self.log_debug("Frontend directory not found")
            return None
        
        print("🌐 Starting Frontend...")
        
        # Check Node.js
        try:
            result = subprocess.run(["node", "--version"], capture_output=True, text=True)
            if result.returncode != 0:
                print("   ⚠️ Node.js not found - backend only mode")
                return None
            self.log_debug(f"Node.js version: {result.stdout.strip()}")
        except Exception as e:
            print(f"   ⚠️ Node.js check failed: {e}")
            return None
        
        # Kill common frontend ports
        self.log_debug("Clearing frontend ports...")
        for port in [3000, 3001, 5173, 5174]:
            self.kill_port(port)
        
        time.sleep(1)
        
        # Start frontend
        try:
            frontend = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd="frontend",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            self.processes.append(("Frontend", frontend))
            
            # Monitor output in background
            monitor_thread = Thread(
                target=self.monitor_frontend_output,
                args=(frontend,),
                daemon=True
            )
            monitor_thread.start()
            
            # Wait for frontend to be ready
            print("   ⏳ Waiting for frontend to start...")
            if self.frontend_ready.wait(timeout=30):
                return self.frontend_url
            else:
                # Try common ports as fallback
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
                
        except Exception as e:
            print(f"   ⚠️ Failed to start frontend: {e}")
            return None
    
    def open_browser(self, url):
        """Open browser with the app"""
        try:
            time.sleep(1)
            if sys.platform == "darwin":
                subprocess.run(["open", url], capture_output=True)
            elif sys.platform == "win32":
                subprocess.run(["start", url], shell=True, capture_output=True)
            elif "linux" in sys.platform:
                subprocess.run(["xdg-open", url], capture_output=True)
        except Exception as e:
            self.log_debug(f"Could not open browser: {e}")
    
    def run(self):
        """Main run function"""
        # Print header
        print("=" * 70)
        mode = "GitLab SOS Analyzer - Smart One-Click Start"
        if self.debug:
            mode += " [DEBUG MODE]"
        if self.force_reinstall:
            mode += " [REINSTALL]"
        print(f"🚀 {mode}")
        print("=" * 70)
        
        # Check directory
        if not Path("backend").exists():
            print("\n❌ Error: Not in project root directory!")
            print("   Run this from the directory containing 'backend' folder")
            return 1
        
        # Show Python version in debug mode
        if self.debug:
            try:
                result = subprocess.run([sys.executable, "--version"], 
                                      capture_output=True, text=True)
                print(f"\n🔧 [DEBUG] Python: {result.stdout.strip()}")
                print(f"🔧 [DEBUG] Executable: {sys.executable}")
            except:
                pass
        
        # Setup environment
        start_time = time.time()
        if not self.setup_environment():
            print("\n❌ Setup failed!")
            return 1
        
        setup_time = time.time() - start_time
        if setup_time < 2:
            print(f"⚡ Fast startup ({setup_time:.1f}s)")
        else:
            print(f"✅ Setup complete ({setup_time:.1f}s)")
        
        # Start services
        print("\n" + "=" * 70)
        print("Starting Services:")
        print("-" * 70)
        
        backend_ok = self.start_backend()
        self.start_mcp()
        frontend_url = self.start_frontend()
        
        # Determine primary URL
        primary_url = frontend_url if frontend_url else "http://localhost:8000"
        
        # Show status
        print("\n" + "=" * 70)
        print("🎉 GitLab SOS Analyzer is Running!")
        print("=" * 70)
        
        if self.debug:
            print("\n🔧 DEBUG MODE - All logs visible")
        
        print("\n📊 Services Status:")
        print("-" * 70)
        
        # Check services
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sock.connect_ex(('localhost', 8000)) == 0:
            print("✅ Backend API:  http://localhost:8000")
        else:
            print("⚠️ Backend API:  Starting...")
        sock.close()
        
        if Path("backend/run_mcp.py").exists():
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if sock.connect_ex(('localhost', 8080)) == 0:
                print("✅ MCP Server:   http://localhost:8080")
            else:
                print("⚠️ MCP Server:   Starting...")
            sock.close()
        
        if frontend_url:
            print(f"✅ Frontend UI:  {frontend_url}")
        elif Path("frontend").exists():
            print("⏳ Frontend UI:  Building...")
        
        print("=" * 70)
        print(f"\n🌟 Open your browser to: {primary_url}")
        print("\n🛑 Press Ctrl+C to stop all services")
        
        if self.debug:
            print("\n🔧 Service logs will appear below:")
            print("-" * 70)
        else:
            print("=" * 70)
        
        # Open browser
        self.open_browser(primary_url)
        
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
        if not self.debug:
            print("\n💚 All systems operational. Monitoring services...")
        
        try:
            check_count = 0
            while True:
                time.sleep(10)
                check_count += 1
                
                # Periodic health check
                if check_count % 6 == 0:  # Every minute
                    dead = []
                    for name, proc in self.processes:
                        if proc.poll() is not None:
                            dead.append(name)
                    
                    if dead:
                        print(f"\n⚠️ Services stopped: {', '.join(dead)}")
                        print("   Run 'python start.py' to restart")
                        
        except KeyboardInterrupt:
            shutdown(None, None)
        
        return 0


def main():
    """Main entry point"""
    try:
        # Parse arguments
        parser = argparse.ArgumentParser(
            description="GitLab SOS Analyzer - Smart Start Script",
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog="""
Features:
  • Auto-detects and fixes Python version changes
  • Installs correct package versions for your Python
  • Smart package checking - only installs what's missing  
  • Debug mode for troubleshooting
  • Cross-platform support (Windows, Mac, Linux)

Python Compatibility:
  • Python 3.9-3.12: Uses pandas 2.1.3
  • Python 3.13+: Automatically uses pandas 2.2.3+
  • All versions handled automatically!

Examples:
  python start.py                      # Normal mode (auto-fixes everything)
  python start.py --debug              # Show all logs
  python start.py --reinstall          # Force reinstall packages
  python start.py --debug --reinstall  # Both debug and reinstall
            """
        )
        
        parser.add_argument(
            "--debug",
            action="store_true",
            help="Enable debug mode to show all service logs"
        )
        
        parser.add_argument(
            "--reinstall",
            action="store_true",
            help="Force reinstall all packages"
        )
        
        args = parser.parse_args()
        
        # Create and run
        runner = SmartRunner(debug_mode=args.debug, force_reinstall=args.reinstall)
        return runner.run()
        
    except KeyboardInterrupt:
        print("\n\n🛑 Interrupted by user")
        return 0
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        print("💡 Try running with --debug for more information")
        if "--debug" in sys.argv:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())