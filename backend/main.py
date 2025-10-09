#!/usr/bin/env python3
"""
GitLab SOS Analyzer Backend with Power Search and GitLab Duo Chat Integration
Enhanced with GitLab-aware pattern matching using patterns_enhanced.json
OPTIMIZED VERSION - Performance improvements for auto-analysis
"""

from fastapi import FastAPI, UploadFile, WebSocket, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import asyncio
import json
import tarfile
import zipfile
import os
import socket
import sys
from pathlib import Path
from datetime import datetime
import pandas as pd
import numpy as np
from typing import Dict, List, Set
import re
import time
import hashlib
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Any
from fastapi.responses import FileResponse

import asyncio
from concurrent.futures import ThreadPoolExecutor
import multiprocessing as mp

try:
    from fast_stats_service import FastStatsService
except ImportError:
    print("⚠️  FastStatsService not available - continuing without it")
    FastStatsService = None

# Import our modules
try:
    from power_search_engine import PowerSearchEngine, FieldType
    from gitlab_duo_chat import GitLabDuoChatIntegration
    from kubesos_analyzer import KubeSOSAnalyzer
    from mcp_unix_server import create_mcp_server
    from autogrep import AutoGrep
    import threading
except ImportError as e:
    print(f"⚠️  Some modules not available: {e}")
    # Create dummy classes to prevent errors
    class PowerSearchEngine:
        pass
    class GitLabDuoChatIntegration:
        pass
    class KubeSOSAnalyzer:
        pass
    class AutoGrep:
        pass
    def create_mcp_server(base_dir="data/extracted"):
        from mcp_unix_server import UnixMCPServer
        return UnixMCPServer(base_dir=base_dir)
    import threading


# Initialize components
power_search = PowerSearchEngine()
duo_chat = GitLabDuoChatIntegration()

# OPTIMIZATION: Increase thread pool size for better parallelization
thread_pool = ThreadPoolExecutor(max_workers=min(8, mp.cpu_count()))  # Increased from 3

try:
    fast_stats_service = FastStatsService() if FastStatsService else None
except Exception as e:
    print(f"⚠️  Failed to initialize FastStatsService: {e}")
    fast_stats_service = None

app = FastAPI(title="GitLab SOS Analyzer", version="5.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Only YOUR React app
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],  # Only methods you actually use
    allow_headers=["Content-Type", "Authorization"],  # Only headers you need
)

# Global state
analysis_sessions = {}
extracted_files = {}
auto_analysis_sessions = {}  # Store auto-analysis results separately




class EnhancedAnalyzer:
    """Enhanced analyzer with proper file filtering"""
    
    def __init__(self):
        self.temp_dir = Path("data/extracted")
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Define which files are suitable for analysis
        self.suitable_patterns = [
            # GitLab Rails logs
            'gitlab-rails/production_json.log',
            'gitlab-rails/production.log',
            'gitlab-rails/api_json.log',
            'gitlab-rails/application_json.log',
            'gitlab-rails/exceptions_json.log',
            'gitlab-rails/auth.log',
            
            # Service logs
            'sidekiq/current',
            'sidekiq/*.log',
            'gitaly/current',
            'gitaly/*.log',
            'gitlab-workhorse/current',
            'gitlab-workhorse/*.log',
            'gitlab-shell/gitlab-shell.log',
            'gitlab-pages/*.log',
            'registry/*.log',
            
            # Web server logs
            'nginx/gitlab_access.log',
            'nginx/gitlab_error.log',
            'nginx/error.log',
            'nginx/access.log',
            
            # Database logs
            'postgresql/*.log',
            'redis/*.log',
            'patroni/*.log',
            
            # System logs
            'messages',
            'syslog',
            'auth.log',
            'secure',
            
            # Container logs if present
            'containers/*.log',
            'docker/*.log',
            'kubernetes/*.log'
        ]
        
        # Files to exclude but keep in viewer
        self.static_file_patterns = [
            'proc/*',
            'etc/*',
            '*.conf',
            '*.config',
            '*.yml',
            '*.yaml',
            '*_dump',
            '*_info',
            '*_check',
            '*_status',
            'df_*',
            'ps_*',
            'iostat*',
            'netstat*',
            'lsof*',
            'uname*',
            'dmesg*',
            'migrations',
            'schema'
        ]
        
        # Add KubeSOS analyzer instance
        self.kubesos_analyzer = KubeSOSAnalyzer()
    
    def _is_suitable_for_analysis(self, file_path: Path) -> bool:
        """Check if file is suitable for analysis"""
        path_str = str(file_path).lower()
        
        # Check if it matches any suitable pattern
        for pattern in self.suitable_patterns:
            pattern_re = pattern.replace('*', '.*').replace('/', r'[/\\]')
            if re.search(pattern_re, path_str):
                # Make sure it's not a static file
                for static_pattern in self.static_file_patterns:
                    static_re = static_pattern.replace('*', '.*').replace('/', r'[/\\]')
                    if re.search(static_re, path_str):
                        return False
                return True
        
        return False
    
    async def analyze_archive(self, file_path: Path, session_id: str):
        """Extract and analyze log archive"""
        
        # Create session directory
        session_dir = self.temp_dir / session_id
        session_dir.mkdir(exist_ok=True)
        
        print(f"📦 Extracting to: {session_dir}")
        
        # Extract archive
        extracted_info = self._extract_archive(file_path, session_dir)
        extracted_files[session_id] = session_dir
        
        # Check if this is a KubeSOS archive
        if self.kubesos_analyzer.is_kubesos_archive(extracted_info):
            print("🚀 Detected KubeSOS archive - using specialized analyzer")
            return await self._analyze_kubesos_archive(extracted_info, session_dir, session_id)
        
        # Initialize results
        results = {
            "session_id": session_id,
            "status": "analyzing",
            "files_processed": 0,
            "analyzed_files": 0,
            "total_files": len(extracted_info),
            "total_lines": 0,
            "patterns": {},
            "anomalies": [],
            "log_files": {},  # ALL files for viewer
            "analysis_info": {
                "suitable_files": [],
                "static_files": []
            },
            "component_analysis": {},  # Component-level analysis
            "enhanced_status": "not_available"  # Enhanced analysis removed
        }
        
        # Categorize files
        suitable_files = []
        static_files = []
        
        for file_info in extracted_info:
            file_path = Path(file_info['full_path'])
            relative_path = file_info['relative_path']
            
            # Add to complete file list for viewer
            results["log_files"][relative_path] = {
                "path": relative_path,
                "full_path": str(file_path),
                "size": file_info['size'],
                "service": self._identify_service(relative_path),
                "is_suitable": False,
                "file_type": self._identify_file_type(file_path),
                "parent_dir": relative_path.split('/')[-2] if '/' in relative_path and len(relative_path.split('/')) > 1 else None
            }
            
            # Debug: Print first few file paths to understand structure
            if len(results["log_files"]) <= 10:
                print(f"DEBUG: File {len(results['log_files'])}: relative_path='{relative_path}', service='{self._identify_service(relative_path)}'")
                if relative_path.endswith('current') or relative_path.endswith('state'):
                    path_parts = relative_path.split('/')
                    print(f"  -> Path parts: {path_parts}")
                    if len(path_parts) > 1:
                        print(f"  -> Parent directory: {path_parts[-2]}")
                    else:
                        print(f"  -> No parent directory found")
            
            if self._is_suitable_for_analysis(file_path):
                suitable_files.append(file_info)
                results["log_files"][relative_path]["is_suitable"] = True
                results["analysis_info"]["suitable_files"].append(relative_path)
            else:
                static_files.append(file_info)
                results["analysis_info"]["static_files"].append(relative_path)
        
        print(f"📊 Found {len(suitable_files)} files suitable for analysis")
        print(f"📄 Found {len(static_files)} static/config files for manual review")
        
        # Process suitable files for basic analysis
        for file_info in suitable_files:
            file_path = Path(file_info['full_path'])
            
            try:
                # Get line count for file info
                line_count = self._get_line_count(file_path)
                relative_path = file_info['relative_path']
                
                results["log_files"][relative_path]["lines"] = line_count
                results["total_lines"] += line_count
                
                # Skip pattern analysis - just count lines
                if line_count > 0:
                    results["files_processed"] += 1
                    results["analyzed_files"] += 1
                
                print(f"✅ Processed: {relative_path}")
                
            except Exception as e:
                print(f"❌ Error processing {file_path}: {e}")
        
        # Process static files just for line counts
        for file_info in static_files:
            file_path = Path(file_info['full_path'])
            relative_path = file_info['relative_path']
            
            try:
                line_count = self._get_line_count(file_path)
                results["log_files"][relative_path]["lines"] = line_count
                results["files_processed"] += 1
            except:
                results["log_files"][relative_path]["lines"] = 0
        
        # Post-process results
        results = self._post_process_results(results)
        results["status"] = "completed"
        
        print(f"✅ Basic analysis complete: {results['analyzed_files']} files analyzed")
        print(f"📂 Total files available in viewer: {results['total_files']}")
        
        return results
    
    async def _analyze_kubesos_archive(self, extracted_info: List[Dict], session_dir: Path, session_id: str):
        """Analyze KubeSOS archive with specialized handling"""
        
        # Initialize results
        results = {
            "session_id": session_id,
            "status": "analyzing",
            "files_processed": 0,
            "logai_files_analyzed": 0,
            "total_files": len(extracted_info),
            "total_lines": 0,
            "patterns": {},
            "anomalies": [],
            "log_files": {},
            "analysis_info": {
                "archive_type": "kubesos",
                "suitable_files": [],
                "static_files": []
            },
            "enhanced_status": "not_available"
        }
        
        # Get KubeSOS specific analysis
        kubesos_results = self.kubesos_analyzer.analyze_kubesos_structure(extracted_info, session_dir)
        
        # Merge KubeSOS results with standard format
        results["type"] = "kubesos"
        results["kubernetes_info"] = kubesos_results.get("kubernetes_info", {})
        results["events"] = kubesos_results.get("events", [])
        results["components"] = kubesos_results.get("components", {})
        
        # Process all files for the viewer
        for file_info in extracted_info:
            file_path = Path(file_info['full_path'])
            relative_path = file_info['relative_path']
            
            # Determine component/service
            component = 'unknown'
            if relative_path in kubesos_results.get('pod_logs', {}):
                component = kubesos_results['pod_logs'][relative_path].get('component', 'unknown')
            
            # Add to log files for viewer
            results["log_files"][relative_path] = {
                "path": relative_path,
                "full_path": str(file_path),
                "size": file_info['size'],
                "service": component,
                "is_suitable": self.kubesos_analyzer.is_log_file(relative_path),
                "file_type": self._identify_file_type(file_path)
            }
            
            # Get line count
            try:
                if self.kubesos_analyzer.is_log_file(relative_path):
                    if relative_path in kubesos_results.get('pod_logs', {}):
                        line_count = kubesos_results['pod_logs'][relative_path]['total_lines']
                    else:
                        line_count = self._get_line_count(file_path)
                    
                    results["log_files"][relative_path]["lines"] = line_count
                    results["total_lines"] += line_count
                    
                    # Convert pod log patterns to main pattern format
                    if relative_path in kubesos_results.get('pod_logs', {}):
                        pod_stats = kubesos_results['pod_logs'][relative_path]
                        
                        # Add patterns from pod analysis
                        for pattern_type, pattern_info in pod_stats.get('patterns', {}).items():
                            pattern_key = f"{pattern_type} in {component}"
                            if pattern_key not in results["patterns"]:
                                results["patterns"][pattern_key] = {
                                    "template": pattern_key,
                                    "count": 0,
                                    "files": set(),
                                    "severity": pattern_info['severity']
                                }
                            results["patterns"][pattern_key]["count"] += pattern_info['count']
                            results["patterns"][pattern_key]["files"].add(relative_path)
                        
                        results["analysis_info"]["suitable_files"].append(relative_path)
                else:
                    results["log_files"][relative_path]["lines"] = 0
                    results["analysis_info"]["static_files"].append(relative_path)
                    
                results["files_processed"] += 1
                
            except Exception as e:
                print(f"Error processing {relative_path}: {e}")
                results["log_files"][relative_path]["lines"] = 0
        
        # Convert sets to lists for JSON serialization
        for pattern in results["patterns"].values():
            if isinstance(pattern["files"], set):
                pattern["files"] = list(pattern["files"])
        
        results["status"] = "completed"
        print(f"✅ KubeSOS analysis complete: {results['files_processed']} files processed")
        
        return results
    
    def _get_line_count(self, file_path: Path) -> int:
        """Get line count for a file"""
        try:
            with open(file_path, 'rb') as f:
                return sum(1 for _ in f)
        except:
            return 0
    
    def _identify_file_type(self, file_path: Path) -> str:
        """Identify the type of file"""
        name_lower = file_path.name.lower()
        path_str = str(file_path).lower()
        
        # Config files
        if file_path.suffix in ['.conf', '.config', '.yml', '.yaml', '.rb']:
            return 'config'
        
        # Command output
        if any(cmd in name_lower for cmd in ['_dump', '_info', '_check', '_status', 'iostat', 'df_', 'ps_']):
            return 'command_output'
        
        # Proc files
        if '/proc/' in path_str:
            return 'proc'
        
        # JSON logs
        if 'json' in name_lower and '.log' in name_lower:
            return 'json_log'
        
        # Regular logs
        if file_path.suffix in ['.log', '.txt'] or name_lower in ['current', 'messages', 'syslog']:
            return 'log'
        
        return 'other'
    
    def _preprocess_line(self, line: str) -> str:
        """Preprocess log line for Drain"""
        
        # Remove leading/trailing whitespace
        line = line.strip()
        
        # Skip empty lines
        if not line:
            return ""
        
        # Remove ANSI color codes
        line = re.sub(r'\x1b\[[0-9;]*m', '', line)
        
        # Replace multiple spaces with single space
        line = re.sub(r'\s+', ' ', line)
        
        return line
    
    def _extract_archive(self, archive_path: Path, extract_dir: Path):
        """Extract archive and return file info - with recursive extraction for nested archives"""
        extracted_info = []
        
        # Convert to string to check full extension
        archive_name = archive_path.name.lower()
        
        try:
            # Handle different archive types
            if archive_name.endswith('.tar.gz') or archive_name.endswith('.tgz'):
                with tarfile.open(archive_path, 'r:gz') as tar:
                    for member in tar.getmembers():
                        if member.isfile():
                            tar.extract(member, extract_dir)
                            extracted_info.append({
                                'relative_path': member.name,
                                'full_path': extract_dir / member.name,
                                'size': member.size
                            })
            
            elif archive_name.endswith('.tar'):
                with tarfile.open(archive_path, 'r') as tar:
                    for member in tar.getmembers():
                        if member.isfile():
                            tar.extract(member, extract_dir)
                            extracted_info.append({
                                'relative_path': member.name,
                                'full_path': extract_dir / member.name,
                                'size': member.size
                            })
            
            elif archive_name.endswith('.zip'):
                with zipfile.ZipFile(archive_path) as zf:
                    for info in zf.infolist():
                        if not info.is_dir():
                            zf.extract(info, extract_dir)
                            extracted_info.append({
                                'relative_path': info.filename,
                                'full_path': extract_dir / info.filename,
                                'size': info.file_size
                            })
            
            else:
                raise ValueError(f"Unsupported archive format: {archive_path.name}")
        
        except Exception as e:
            print(f"❌ Error extracting {archive_path.name}: {e}")
            raise
        
        # Filter out macOS metadata files early
        extracted_info = [
            f for f in extracted_info 
            if not Path(f['relative_path']).name.startswith('._')
        ]
        
        # RECURSIVE EXTRACTION: Check for nested archives
        nested_archives = []
        archive_extensions = {'.tar', '.tar.gz', '.tgz', '.zip'}
        
        for file_info in extracted_info:
            file_path = file_info['full_path']
            file_name_lower = file_path.name.lower()
            
            # Check if this is a nested archive
            is_archive = any(
                file_name_lower.endswith(ext) 
                for ext in archive_extensions
            )
            
            if is_archive and not file_path.name.startswith('._'):
                nested_archives.append(file_info)
        
        # Extract nested archives
        if nested_archives:
            print(f"📦 Found {len(nested_archives)} nested archive(s) to extract")
            
            # Track which items to remove (don't modify list during iteration)
            to_remove = []
            nested_files = []
            
            for nested_info in nested_archives:
                nested_path = nested_info['full_path']
                print(f"  📂 Extracting nested: {nested_info['relative_path']}")
                
                try:
                    # Create a subdirectory for nested archive contents
                    # This prevents file conflicts and maintains structure
                    nested_dir_name = nested_path.stem
                    if nested_path.name.lower().endswith('.tar.gz'):
                        # Remove both .tar and .gz extensions
                        nested_dir_name = nested_path.name[:-7]
                    
                    nested_extract_dir = extract_dir / Path(nested_info['relative_path']).parent / nested_dir_name
                    nested_extract_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Recursively extract
                    nested_extracted = self._extract_archive(nested_path, nested_extract_dir)
                    
                    # Update paths to be relative to original extract_dir
                    for nested_file in nested_extracted:
                        nested_file['relative_path'] = str(
                            Path(nested_info['relative_path']).parent / 
                            nested_dir_name / 
                            nested_file['relative_path']
                        )
                        nested_file['full_path'] = extract_dir / nested_file['relative_path']
                    
                    nested_files.extend(nested_extracted)
                    to_remove.append(nested_info)
                    
                    # Delete the nested archive file to save space
                    try:
                        nested_path.unlink()
                        print(f"  ✅ Cleaned up: {nested_path.name}")
                    except Exception as e:
                        print(f"  ⚠️ Could not delete archive: {e}")
                        
                except Exception as e:
                    print(f"  ⚠️ Failed to extract nested archive {nested_info['relative_path']}: {e}")
            
            # Remove nested archives from list and add extracted files
            extracted_info = [
                f for f in extracted_info 
                if f not in to_remove
            ]
            extracted_info.extend(nested_files)
        
        return extracted_info
    
    def _identify_service(self, path: str) -> str:
        """Identify GitLab service from path"""
        
        path_lower = path.lower()
        filename = Path(path).name.lower()
        
        # For files with directory structure, check parent directories
        path_parts = path.lower().split('/')
        
        # Handle 'current' and 'state' files by checking their parent directory
        if filename in ['current', 'state']:
            # Look for service name in the path
            for part in reversed(path_parts[:-1]):  # Skip the filename itself
                if part in ['sidekiq', 'gitlab-sidekiq']:
                    return 'sidekiq'
                elif part in ['postgresql', 'postgres']:
                    return 'postgresql'
                elif part in ['redis', 'gitlab-redis']:
                    return 'redis'
                elif part in ['puma', 'gitlab-puma']:
                    return 'puma'
                elif part in ['gitlab-workhorse', 'workhorse']:
                    return 'gitlab-workhorse'
                elif part in ['registry', 'gitlab-registry']:
                    return 'registry'
                elif part in ['gitaly', 'gitlab-gitaly']:
                    return 'gitaly'
                elif part in ['gitlab-shell']:
                    return 'gitlab-shell'
                elif part in ['nginx', 'gitlab-nginx']:
                    return 'nginx'
                elif part in ['node-exporter', 'gitlab-node-exporter']:
                    return 'node-exporter'
                elif part in ['postgres-exporter', 'gitlab-postgres-exporter']:
                    return 'postgres-exporter'
                elif part in ['redis-exporter', 'gitlab-redis-exporter']:
                    return 'redis-exporter'
                elif part in ['pgbouncer-exporter', 'gitlab-pgbouncer-exporter']:
                    return 'pgbouncer-exporter'
                elif part in ['logrotate', 'gitlab-logrotate']:
                    return 'logrotate'
                elif part in ['prometheus', 'gitlab-prometheus']:
                    return 'prometheus'
                elif part in ['grafana', 'gitlab-grafana']:
                    return 'grafana'
                elif part in ['alertmanager', 'gitlab-alertmanager']:
                    return 'alertmanager'
            
            # If no specific service found, return generic
            return 'logs'
        
        # GitLab Rails logs (check filename patterns)
        if any(pattern in filename for pattern in [
            'production_json.log', 'production.log', 'api_json.log', 
            'application_json.log', 'exceptions_json.log', 'auth_json.log',
            'audit_json.log', 'backup_json.log', 'graphql_json.log',
            'integrations_json.log', 'web_hooks.log', 'sidekiq_client.log',
            'database_health_status.log', 'database_load_balancing.log',
            'elasticsearch.log', 'event_collection.log', 'product_usage_data.log'
        ]):
            return 'gitlab-rails'
        
        # GitLab Rails migration logs
        if 'gitlab-rails-db-migrate' in filename:
            return 'gitlab-rails'
        
        # Sidekiq logs (only actual sidekiq files)
        if any(pattern in filename for pattern in ['sidekiq']) and 'client' not in filename:
            return 'sidekiq'
        
        # Gitaly logs
        if any(pattern in filename for pattern in ['gitaly']):
            return 'gitaly'
        
        # GitLab Shell logs
        if 'gitlab-shell' in filename or 'gitlab_shell' in filename:
            return 'gitlab-shell'
        
        # Nginx/Web server logs
        if any(pattern in filename for pattern in [
            'nginx', 'access.log', 'error.log', 'gitlab_access.log', 
            'gitlab_error.log', 'puma_stderr.log', 'puma_stdout.log'
        ]):
            return 'nginx'
        
        # PostgreSQL logs
        if any(pattern in filename for pattern in ['postgresql', 'postgres']):
            return 'postgresql'
        
        # Redis logs
        if 'redis' in filename:
            return 'redis'
        
        # System logs
        if any(pattern in filename for pattern in [
            'messages', 'syslog', 'auth.log', 'secure', 'mail.log', 'dmesg'
        ]):
            return 'system'
        
        # System info/status files
        if any(pattern in filename for pattern in [
            'cpuinfo', 'meminfo', 'mount', 'fstab', 'os-release', 'limits.conf',
            'sshd_config', 'df_', 'free_', 'iostat', 'vmstat', 'mpstat',
            'netstat', 'ifconfig', 'ip_address', 'hostname', 'uname', 'uptime',
            'lscpu', 'lsblk', 'ps', 'top_', 'sar_', 'pidstat', 'sockstat',
            'ulimit', 'sysctl', 'systemctl', 'systemd', 'timedatectl',
            'getenforce', 'sestatus', 'btmp_size', 'user_uid', 'date',
            'iotop', 'ntpq', 'nfsstat', 'nfsiostat', 'tainted', 'swappiness',
            'pressure_'
        ]):
            return 'system'
        
        # GitLab status/info files
        if any(pattern in filename for pattern in [
            'gitlab_status', 'gitlab_system_status', 'gitaly_check', 
            'gitaly_internal_api_check', 'gitlab.rb', 'gitlabsos.log'
        ]):
            return 'gitlab-config'
        
        # Database/schema files
        if any(pattern in filename for pattern in [
            'schema_dump', 'ar_schema_dump', 'gitlab_migrations', 
            'non_analyzed_tables'
        ]):
            return 'database'
        
        # Search/indexing
        if any(pattern in filename for pattern in ['elastic_info', 'zoekt_info']):
            return 'search'
        
        # License info
        if 'license_info' in filename:
            return 'license'
        
        # Version/manifest files
        if any(pattern in filename for pattern in ['version-manifest', 'manifest']):
            return 'version'
        
        # Config files
        if any(ext in filename for ext in ['.conf', '.config', '.yml', '.yaml', '.rb']):
            return 'config'
        
        # RPM verification
        if 'rpm_verify' in filename:
            return 'package-management'
        
        # Default fallback
        return 'other'
    
    def _get_severity(self, text: str) -> str:
        """Determine severity from text"""
        
        text_lower = text.lower()
        
        # Critical/Fatal
        if any(x in text_lower for x in ['fatal', 'panic', 'critical', 'emergency']):
            return 'critical'
        
        # Error
        if any(x in text_lower for x in ['error', 'fail', 'exception', 'traceback']):
            return 'error'
        
        # Warning
        if any(x in text_lower for x in ['warn', 'warning', 'deprecated']):
            return 'warning'
        
        # Info
        if any(x in text_lower for x in ['info', 'notice']):
            return 'info'
        
        return 'debug'
    
    def _post_process_results(self, results):
        """Post-process and clean up results"""
        
        # Convert sets to lists
        for pattern in results["patterns"].values():
            if isinstance(pattern["files"], set):
                pattern["files"] = list(pattern["files"])
        
        # Sort patterns by count
        sorted_patterns = sorted(
            results["patterns"].items(),
            key=lambda x: x[1]["count"],
            reverse=True
        )
        
        results["patterns"] = dict(sorted_patterns)
        
        # Limit anomalies
        results["anomalies"] = results["anomalies"][:100]
        
        return results


# Initialize analyzer
analyzer = EnhancedAnalyzer()


def safe_restore_sessions():
    """
    Safely restore sessions from disk ONLY if they exist and are valid.
    This won't interfere with new sessions or break anything.
    """
    try:
        extracted_dir = Path("data/extracted")
        if not extracted_dir.exists():
            return  # No extracted dir, nothing to restore
        
        # Only restore sessions that are NOT already in memory
        for session_dir in extracted_dir.iterdir():
            if not session_dir.is_dir():
                continue
                
            session_id = session_dir.name
            
            # Skip if already in memory (don't override active sessions!)
            if session_id in analysis_sessions:
                continue
            
            # Check if directory has files (not empty)
            has_files = any(session_dir.rglob("*"))
            if not has_files:
                continue
            
            print(f"🔄 Found orphaned session on disk: {session_id}")
            
            # Build minimal metadata just for viewing files
            log_files = {}
            file_count = 0
            
            try:
                for file_path in session_dir.rglob("*"):
                    if file_path.is_file():
                        file_count += 1
                        relative_path = str(file_path.relative_to(session_dir))
                        
                        # Use your existing _identify_service function
                        service = analyzer._identify_service(relative_path)
                        
                        log_files[relative_path] = {
                            "path": relative_path,
                            "full_path": str(file_path),
                            "size": file_path.stat().st_size,
                            "service": service,
                            "is_suitable": True,
                            "file_type": analyzer._identify_file_type(file_path)
                        }
                
                if file_count > 0:
                    # Create minimal session data
                    analysis_sessions[session_id] = {
                        "session_id": session_id,
                        "status": "completed",
                        "files_processed": file_count,
                        "total_files": file_count,
                        "total_lines": 0,
                        "patterns": {},
                        "anomalies": [],
                        "log_files": log_files,
                        "analysis_info": {
                            "suitable_files": list(log_files.keys()),
                            "static_files": []
                        },
                        "enhanced_status": "not_available",
                        "restored_from_disk": True  # Mark as restored
                    }
                    
                    extracted_files[session_id] = session_dir
                    print(f"  ✅ Restored {file_count} files for session {session_id}")
                    
            except Exception as e:
                print(f"  ⚠️ Could not restore {session_id}: {e}")
                continue
                
    except Exception as e:
        print(f"⚠️ Session restoration check failed (non-critical): {e}")
        # Don't crash - this is just a recovery attempt


@app.post("/api/upload")
async def upload_sos(
    background_tasks: BackgroundTasks,
    file: UploadFile
):
    """Handle SOS file upload"""
    
    if not file.filename.endswith(('.tar', '.tar.gz', '.tgz', '.zip')):
        raise HTTPException(400, "Invalid file format")
    
    session_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
    
    # Save uploaded file
    upload_path = Path("data/uploads")
    upload_path.mkdir(parents=True, exist_ok=True)
    
    file_path = upload_path / f"{session_id}_{file.filename}"
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # Start analysis in background
    background_tasks.add_task(
        analyze_sos_task,
        session_id,
        file_path
    )
    
    return {
        "session_id": session_id,
        "status": "processing",
        "message": "Analysis started"
    }

async def analyze_sos_task(session_id: str, file_path: Path):
    """Background task to analyze SOS"""
    try:
        results = await analyzer.analyze_archive(file_path, session_id)
        analysis_sessions[session_id] = results
        
        # Add context for Duo Chat if available
        if session_id in analysis_sessions:
            duo_chat.add_session_context(session_id, analysis_sessions[session_id])
            
    except Exception as e:
        print(f"❌ Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        analysis_sessions[session_id] = {
            "session_id": session_id,
            "status": "failed",
            "error": str(e)
        }

@app.get("/api/analysis/{session_id}")
async def get_analysis(session_id: str):
    """Get analysis results"""
    
    # NEW BLOCK: Try to restore from disk if not in memory
    if session_id not in analysis_sessions:
        # Try to restore from disk if it exists
        session_dir = Path("data/extracted") / session_id
        if session_dir.exists() and session_dir.is_dir():
            # Trigger restoration for just this session
            safe_restore_sessions()
    # END OF NEW BLOCK
    
    # Original code continues
    if session_id not in analysis_sessions:
        return {"session_id": session_id, "status": "processing"}
    
    return analysis_sessions[session_id]

@app.get("/api/logs/{session_id}/{file_path:path}")
async def get_log_content(session_id: str, file_path: str):
    """Get actual log file content - optimized but complete"""
    
    if session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Extracted files not found")
    
    # Get the actual file path
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        file_size = actual_path.stat().st_size
        
        # Read ALL lines - no limiting for log analysis
        lines = []
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                lines.append(line.rstrip())
        
        return {
            "file": file_path,
            "content": lines,
            "total_lines": len(lines),
            "file_size": file_size,
            "truncated": False  # Never truncate for log analysis
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")

@app.get("/api/logs/{session_id}/{file_path:path}/more")
async def get_more_log_content(session_id: str, file_path: str, offset: int = 0, lines: int = 1000):
    """Get more log content starting from offset"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        content_lines = []
        current_line = 0
        
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if current_line >= offset:
                    if len(content_lines) >= lines:
                        break
                    content_lines.append(line.rstrip())
                current_line += 1
        
        return {
            "content": content_lines,
            "offset": offset,
            "lines_returned": len(content_lines),
            "has_more": len(content_lines) == lines
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")

async def download_log(session_id: str, file_path: str):
    """Download full log file"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, "File not found")
    
    def iterfile():
        with open(actual_path, 'rb') as f:
            yield from f
    
    return StreamingResponse(
        iterfile(),
        media_type="text/plain",
        headers={
            "Content-Disposition": f"attachment; filename={Path(file_path).name}"
        }
    )

@app.post("/api/search")
async def search_logs(query: dict):
    """Simple text-based search"""
    
    session_id = query.get("session_id")
    search_query = query.get("query", "")
    filters = query.get("filters", {})
    limit = query.get("limit", 100)
    
    print(f"🔍 Search request: query='{search_query}', filters={filters}")
    
    if not session_id or session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Extracted files not found")
    
    session_dir = extracted_files[session_id]
    results = []
    
    # Simple text search
    log_files = analysis_sessions[session_id].get("log_files", {})
    
    # Skip files that are not actual logs
    skip_patterns = [
        'migrations', 'schema', '_dump', '_info', '_check', 
        'systemctl', 'proc/', 'etc/', '.conf', '.yml', '.yaml'
    ]
    
    start_time = time.time()
    files_searched = 0
    
    for file_path, file_info in log_files.items():
        if len(results) >= limit:
            break
        
        # Skip non-log files
        if any(skip in file_path.lower() for skip in skip_patterns):
            continue
        
        # Apply service filter if specified
        if filters.get("service", "all") != "all":
            service = file_info.get("service", "").lower()
            if filters["service"] not in service:
                continue
        
        actual_path = session_dir / file_path
        if not actual_path.exists():
            continue
        
        files_searched += 1
        
        try:
            with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line_num, line in enumerate(f):
                    if len(results) >= limit:
                        break
                    
                    # Simple case-insensitive text search
                    if search_query.lower() in line.lower():
                        # Apply severity filter if specified
                        if filters.get("severity", "all") != "all":
                            line_lower = line.lower()
                            severity = filters["severity"]
                            if severity == "error" and not any(term in line_lower for term in ['error', 'fail', 'exception']):
                                continue
                            elif severity == "warning" and 'warn' not in line_lower:
                                continue
                            elif severity == "critical" and not any(term in line_lower for term in ['critical', 'fatal', 'panic']):
                                continue
                        
                        results.append({
                            "content": line.strip(),
                            "file": file_path,
                            "line_number": line_num + 1,
                            "similarity": 1.0,
                            "type": 'text',
                            "metadata": {
                                "service": file_info.get("service", "unknown")
                            }
                        })
                        
        except Exception as e:
            print(f"Error searching {file_path}: {e}")
    
    search_time = time.time() - start_time
    
    return {
        "results": results,
        "search_time": f"{search_time:.2f}s",
        "files_searched": files_searched,
        "total_results": len(results),
        "search_type": "simple_text"
    }

@app.get("/api/file-categories/{session_id}")
async def get_file_categories(session_id: str):
    """Get categorized file list"""
    
    if session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    analysis = analysis_sessions[session_id]
    
    return {
        "logai_suitable_files": analysis.get("analysis_info", {}).get("suitable_files", []),
        "static_files": analysis.get("analysis_info", {}).get("static_files", []),
        "file_types": {
            file_path: info.get("file_type", "other")
            for file_path, info in analysis.get("log_files", {}).items()
        }
    }

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket for real-time updates"""
    await websocket.accept()
    
    try:
        while True:
            if session_id in analysis_sessions:
                await websocket.send_json(analysis_sessions[session_id])
            await asyncio.sleep(1)
            
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()

@app.get("/api/pattern/{session_id}/{pattern_index}/instances")
async def get_pattern_instances(session_id: str, pattern_index: int, limit: int = 100):
    """Get actual log lines that match a specific pattern"""
    
    if session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Extracted files not found")
    
    analysis_data = analysis_sessions[session_id]
    patterns_list = list(analysis_data.get('patterns', {}).values())
    
    if pattern_index >= len(patterns_list):
        raise HTTPException(404, "Pattern not found")
    
    pattern = patterns_list[pattern_index]
    session_dir = extracted_files[session_id]
    
    # Get files where this pattern appears
    pattern_files = pattern.get('files', [])
    instances = []
    
    # Search through files for lines matching this pattern
    for file_path in pattern_files[:5]:  # Limit to first 5 files for performance
        actual_path = session_dir / file_path
        
        if not actual_path.exists():
            continue
        
        try:
            with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line_num, line in enumerate(f):
                    if len(instances) >= limit:
                        break
                    
                    # Simple check - in production, you'd match against the actual pattern
                    # For now, check if line contains key parts of the pattern
                    pattern_words = [w for w in pattern['template'].split() if not w.startswith('<')]
                    
                    if any(word in line for word in pattern_words[:3]):  # Check first 3 words
                        instances.append({
                            'file': file_path,
                            'line_number': line_num + 1,
                            'content': line.strip()
                        })
            
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
    
    return {
        'pattern': pattern,
        'instances': instances,
        'total_found': len(instances)
    }

@app.get("/health")
async def health_check():        
    return {
        "status": "healthy",
        "version": "5.3.0",
        "features": {
            "basic_pattern_analysis": True,
            "power_search": True,
            "file_categorization": True,
            "gitlab_duo_chat": True,
            "kubesos_support": True
        },
        "sessions": len(analysis_sessions)
    }

# Power Search endpoints
@app.post("/api/power-search/analyze")
async def analyze_log_structure(request: dict):
    """
    Analyze log structure to discover fields and patterns
    """
    session_id = request.get('session_id')
    log_files = request.get('log_files', {})
    
    if not session_id:
        raise HTTPException(400, "Session ID required")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    # Add full paths to log files
    session_dir = extracted_files[session_id]
    for file_path, file_info in log_files.items():
        file_info['full_path'] = str(session_dir / file_path)
    
    # Analyze log structure
    analysis = power_search.analyze_log_structure(session_id, log_files)
    
    return analysis

@app.post("/api/power-search/search")
async def power_search_logs(request: dict):
    """
    Execute power search with streaming results
    """
    session_id = request.get('session_id')
    query_string = request.get('query', '')
    limit = request.get('limit', 100)
    context_lines = request.get('context_lines', 0)
    stream = request.get('stream', True)
    
    if not session_id:
        raise HTTPException(400, "Session ID required")
    
    if not query_string:
        raise HTTPException(400, "Query required")
    
    if session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    # Get log files with full paths
    log_files = analysis_sessions[session_id].get('log_files', {})
    session_dir = extracted_files.get(session_id)
    
    if not session_dir:
        raise HTTPException(404, "Extracted files not found")
    
    # Add full paths
    for file_path, file_info in log_files.items():
        file_info['full_path'] = str(session_dir / file_path)
    
    # Parse query
    try:
        query = power_search.parse_query(query_string)
    except Exception as e:
        raise HTTPException(400, f"Invalid query: {str(e)}")
    
    async def generate_results():
        """Generate search results as JSON stream"""
        try:
            # Execute search
            for result in power_search.search(
                session_id=session_id,
                query=query,
                files=log_files,
                limit=limit,
                context_lines=context_lines
            ):
                # Yield each result as JSON line
                yield json.dumps(result) + '\n'
                
                # Small delay to prevent overwhelming the client
                if stream:
                    await asyncio.sleep(0.001)
                    
        except Exception as e:
            error_result = {
                'error': str(e),
                'type': 'search_error'
            }
            yield json.dumps(error_result) + '\n'
    
    if stream:
        return StreamingResponse(
            generate_results(),
            media_type="application/x-ndjson"
        )
    else:
        # Collect all results and return as array
        results = []
        async for line in generate_results():
            if line.strip():
                results.append(json.loads(line))
        return results

@app.post("/api/power-search/validate-query")
async def validate_query(request: dict):
    """
    Validate and explain a query without executing it
    """
    query_string = request.get('query', '')
    
    try:
        query = power_search.parse_query(query_string)
        
        # Generate explanation
        explanation = {
            'valid': True,
            'filters': [],
            'logical_operator': query.logical_op.value
        }
        
        for filter_item in query.filters:
            explanation['filters'].append({
                'field': filter_item.field,
                'operator': filter_item.operator.value,
                'value': filter_item.value,
                'description': f"Find logs where {filter_item.field or 'content'} {filter_item.operator.value} {filter_item.value}"
            })
        
        return explanation
        
    except Exception as e:
        return {
            'valid': False,
            'error': str(e)
        }

@app.get("/api/power-search/suggestions/{session_id}")
async def get_search_suggestions(session_id: str, prefix: str = ''):
    """
    Get autocomplete suggestions for fields and values
    """
    if session_id not in analysis_sessions:
        return []
    
    suggestions = []
    
    # Suggest fields
    for field in power_search.common_fields:
        if prefix.lower() in field.lower():
            suggestions.append({
                'type': 'field',
                'value': field,
                'display': f"{field}:",
                'description': f"Filter by {field}"
            })
    
    # Suggest operators after field
    if ':' in prefix or '=' in prefix:
        field_part = prefix.split(':')[0].split('=')[0].strip()
        if field_part in power_search.field_types:
            field_type = power_search.field_types[field_part]
            
            if field_type == FieldType.NUMBER:
                operators = ['=', '!=', '>', '>=', '<', '<=']
            else:
                operators = ['=', '!=', '~', '!~']
            
            for op in operators:
                suggestions.append({
                    'type': 'operator',
                    'value': f"{field_part}{op}",
                    'display': f"{field_part} {op}",
                    'description': f"Compare {field_part}"
                })
    
    # Suggest values
    field_match = re.match(r'(\w+)[=:~]', prefix)
    if field_match:
        field = field_match.group(1)
        if field in power_search.field_values:
            for value in power_search.field_values[field][:10]:
                suggestions.append({
                    'type': 'value',
                    'value': f'{prefix}{value}',
                    'display': str(value),
                    'description': f"Common value for {field}"
                })
    
    return suggestions[:20]  # Limit suggestions

# GitLab Duo Chat endpoints  
@app.post("/api/duo/chat")
async def duo_chat_message(request: dict):
    """Send message to GitLab Duo Chat"""
    
    session_id = request.get('session_id')
    message = request.get('message')
    thread_id = request.get('thread_id')
    
    if not session_id or not message:
        raise HTTPException(400, "session_id and message required")
    
    try:
        # Add context if this is a new conversation
        if session_id in analysis_sessions and session_id not in duo_chat.session_contexts:
            duo_chat.add_session_context(session_id, analysis_sessions[session_id])
        
        # Send message
        result = await duo_chat.send_chat_message(
            message=message,
            session_id=session_id,
            thread_id=thread_id
        )
        
        return result
        
    except Exception as e:
        raise HTTPException(500, f"Chat error: {str(e)}")

@app.websocket("/ws/duo/{session_id}")
async def duo_chat_stream(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for streaming Duo Chat responses"""
    await websocket.accept()
    print(f"✅ Duo Chat WebSocket connected for session: {session_id}")
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            print(f"📨 Received from client: {data}")
            
            if data['type'] == 'chat':
                try:
                    # Send to Duo using hybrid approach
                    result = await duo_chat.send_chat_message(
                        message=data['message'],
                        session_id=session_id,
                        thread_id=data.get('thread_id')
                    )
                    print(f"✅ Duo Chat result: {result}")
                    
                    # With REST API, we get immediate response
                    if 'response' in result:
                        # Send the complete response
                        await websocket.send_json({
                            'type': 'response',
                            'content': result['response'],
                            'thread_id': result.get('threadId')
                        })
                        
                        # Send completion immediately
                        await websocket.send_json({
                            'type': 'complete',
                            'thread_id': result.get('threadId')
                        })
                    else:
                        # Fallback behavior if REST not available
                        await websocket.send_json({
                            'type': 'response',
                            'content': "Message sent to GitLab Duo Chat. Response retrieval not available via API.",
                            'thread_id': result.get('threadId')
                        })
                        
                        await websocket.send_json({
                            'type': 'complete',
                            'thread_id': result.get('threadId')
                        })
                    
                except Exception as e:
                    print(f"❌ Error: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    
                    await websocket.send_json({
                        'type': 'error',
                        'message': f"Chat error: {str(e)}"
                    })
            
    except Exception as e:
        print(f"❌ WebSocket error: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        print("🔌 WebSocket connection closed")
        await websocket.close()

@app.get("/api/duo/conversations/{session_id}")
async def get_conversations(session_id: str):
    """Get all conversations for a session"""
    return duo_chat.load_conversations(session_id)

@app.post("/api/duo/context")
async def update_context(request: dict):
    """Update session context for Duo Chat"""
    session_id = request.get('session_id')
    
    if not session_id:
        raise HTTPException(400, "session_id required")
    
    # Check if we have analysis data for this session
    if session_id in analysis_sessions:
        duo_chat.add_session_context(session_id, analysis_sessions[session_id])
        return {"status": "context updated", "session_id": session_id}
    
    return {"status": "no analysis data found", "session_id": session_id}

@app.post("/api/duo/search-suggestion")
async def get_search_suggestion(request: dict):
    """Get Power Search query suggestion from natural language"""
    
    query = request.get('query')
    session_id = request.get('session_id')
    
    context = duo_chat.session_contexts.get(session_id, {})
    suggestion = duo_chat.create_log_search_query(query, context)
    
    return {
        'original': query,
        'suggestion': suggestion,
        'context_available': bool(context)
    }

# Fast-stats endpoints
@app.post("/api/fast-stats/analyze/{session_id}")
async def analyze_with_fast_stats(session_id: str, options: dict = {}):
    """Analyze logs with fast-stats"""
    
    if not fast_stats_service:
        raise HTTPException(500, "Fast-stats service not available")
    
    print(f"📊 Fast-stats analysis requested for session: {session_id}")
    
    if session_id not in extracted_files:
        raise HTTPException(404, f"Session not found: {session_id}")
    
    session_dir = extracted_files[session_id]
    
    if not session_dir.exists():
        raise HTTPException(404, f"Session directory not found: {session_dir}")
    
    print(f"📁 Session directory: {session_dir}")
    
    async def stream_results():
        try:
            async for result in fast_stats_service.analyze_logs(session_id, session_dir, options):
                yield json.dumps(result) + '\n'
        except Exception as e:
            import traceback
            error_result = {
                'type': 'error',
                'message': f'Stream error: {str(e)}',
                'traceback': traceback.format_exc()
            }
            yield json.dumps(error_result) + '\n'
    
    return StreamingResponse(
        stream_results(),
        media_type="application/x-ndjson"
    )

@app.post("/api/fast-stats/compare")
async def compare_with_fast_stats(body: dict):
    """Compare performance between two sessions"""
    
    if not fast_stats_service:
        raise HTTPException(500, "Fast-stats service not available")
    
    session_id1 = body.get('baseline_session')
    session_id2 = body.get('compare_session')
    log_type = body.get('log_type')
    options = body.get('options', {})
    
    if not all([session_id1, session_id2, log_type]):
        raise HTTPException(400, "Missing required parameters")
    
    if session_id1 not in extracted_files or session_id2 not in extracted_files:
        raise HTTPException(404, "One or both sessions not found")
    
    async def stream_comparison():
        async for result in fast_stats_service.compare_logs(
            session_id1, extracted_files[session_id1],
            session_id2, extracted_files[session_id2],
            log_type, options
        ):
            yield json.dumps(result) + '\n'
    
    return StreamingResponse(
        stream_comparison(),
        media_type="application/x-ndjson"
    )

@app.get("/api/fast-stats/suggestions/{session_id}")
async def get_fast_stats_suggestions(session_id: str):
    """Get analysis suggestions"""
    
    if not fast_stats_service:
        return [{
            'title': 'Fast-Stats Not Available',
            'description': 'Fast-stats service is not initialized. Check binary installation.',
            'action': 'error',
            'priority': 'critical'
        }]
    
    return fast_stats_service.get_analysis_suggestions(session_id)

@app.post("/api/fast-stats/top/{session_id}")
async def analyze_top_items(session_id: str, options: dict = {}):
    """Analyze top resource consumers"""
    
    if not fast_stats_service:
        raise HTTPException(500, "Fast-stats service not available")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    async def stream_top_results():
        async for result in fast_stats_service.analyze_top_items(
            session_id, extracted_files[session_id], options=options
        ):
            yield json.dumps(result) + '\n'
    
    return StreamingResponse(
        stream_top_results(),
        media_type="application/x-ndjson"
    )

@app.post("/api/fast-stats/errors/{session_id}")
async def analyze_errors(session_id: str):
    """Analyze errors in logs"""
    
    if not fast_stats_service:
        raise HTTPException(500, "Fast-stats service not available")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    async def stream_error_results():
        async for result in fast_stats_service.analyze_errors(
            session_id, extracted_files[session_id]
        ):
            yield json.dumps(result) + '\n'
    
    return StreamingResponse(
        stream_error_results(),
        media_type="application/x-ndjson"
    )

@app.get("/api/debug/session/{session_id}")
async def debug_session_files(session_id: str):
    """Debug endpoint to inspect extracted files"""
    
    if session_id not in extracted_files:
        return {"error": "Session not found", "available_sessions": list(extracted_files.keys())}
    
    session_dir = extracted_files[session_id]
    
    if not session_dir.exists():
        return {"error": f"Directory does not exist: {session_dir}"}
    
    # List all files with details
    files_info = []
    log_files_found = []
    
    for root, dirs, files in os.walk(session_dir):
        for file in files:
            file_path = Path(root) / file
            rel_path = file_path.relative_to(session_dir)
            
            try:
                stat = file_path.stat()
                size = stat.st_size
                
                file_info = {
                    "path": str(rel_path),
                    "name": file,
                    "size": size,
                    "size_readable": f"{size / 1024:.1f} KB" if size < 1024*1024 else f"{size / 1024 / 1024:.1f} MB"
                }
                
                # Check if it's a log file we care about
                if any(log_name in file.lower() for log_name in ['production_json.log', 'api_json.log', 'sidekiq', 'gitaly']):
                    file_info["is_log_file"] = True
                    log_files_found.append(file_info)
                
                files_info.append(file_info)
                
            except Exception as e:
                files_info.append({
                    "path": str(rel_path),
                    "error": str(e)
                })
    
    # Test fast-stats on first production_json.log found
    test_result = None
    if fast_stats_service and log_files_found:
        for log_file in log_files_found:
            if 'production_json.log' in log_file['path']:
                test_path = session_dir / log_file['path']
                try:
                    # Try to run fast-stats directly
                    import subprocess
                    cmd = [str(fast_stats_service.binary_path), '--limit', '5', '--format', 'json', str(test_path)]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    
                    test_result = {
                        "command": ' '.join(cmd),
                        "return_code": result.returncode,
                        "stdout_sample": result.stdout[:500] if result.stdout else None,
                        "stderr": result.stderr if result.stderr else None
                    }
                    break
                except Exception as e:
                    test_result = {"error": str(e)}
    
    return {
        "session_id": session_id,
        "session_dir": str(session_dir),
        "total_files": len(files_info),
        "log_files_found": log_files_found,
        "fast_stats_available": fast_stats_service is not None,
        "fast_stats_binary": str(fast_stats_service.binary_path) if fast_stats_service else None,
        "test_result": test_result,
        "files": files_info[:20]  # First 20 files
    }

@app.delete("/api/sessions/clear")
async def clear_all_sessions():
    """Clear all extracted sessions and free up disk space"""
    try:
        extracted_dir = Path("data/extracted")
        uploads_dir = Path("data/uploads")
        
        # Count sessions before deletion
        session_count = 0
        total_size = 0
        
        if extracted_dir.exists():
            for session_dir in extracted_dir.iterdir():
                if session_dir.is_dir():
                    session_count += 1
                    # Calculate size
                    for file in session_dir.rglob("*"):
                        if file.is_file():
                            total_size += file.stat().st_size
            
            # Delete all session directories
            import shutil
            for session_dir in extracted_dir.iterdir():
                if session_dir.is_dir():
                    shutil.rmtree(session_dir)
        
        # Also clear uploads if you want
        if uploads_dir.exists():
            for upload_file in uploads_dir.iterdir():
                if upload_file.is_file():
                    upload_file.unlink()
        
        # Clear in-memory data - ENSURE ALL MAPS ARE CLEARED
        analysis_sessions.clear()
        extracted_files.clear()
        auto_analysis_sessions.clear()
        
        # Reset MCP server session if needed
        # (MCP server will auto-select on next operation)
        
        size_mb = round(total_size / 1024 / 1024, 2)
        
        return {
            "status": "success",
            "message": f"Cleared {session_count} sessions",
            "space_freed": f"{size_mb} MB",
            "sessions_remaining": 0
        }
        
    except Exception as e:
        raise HTTPException(500, f"Failed to clear sessions: {str(e)}")
    
@app.post("/api/sessions/check-disk")
async def check_disk_sessions():
    """
    Check for sessions on disk that aren't in memory.
    This is safe and won't break anything - just reports status.
    """
    extracted_dir = Path("data/extracted")
    
    if not extracted_dir.exists():
        return {
            "disk_sessions": [],
            "memory_sessions": list(analysis_sessions.keys()),
            "orphaned": []
        }
    
    disk_sessions = [d.name for d in extracted_dir.iterdir() if d.is_dir()]
    memory_sessions = list(analysis_sessions.keys())
    orphaned = [s for s in disk_sessions if s not in memory_sessions]
    
    # Try to restore orphaned sessions
    if orphaned:
        safe_restore_sessions()
        # Check again after restoration
        memory_sessions = list(analysis_sessions.keys())
        orphaned = [s for s in disk_sessions if s not in memory_sessions]
    
    return {
        "disk_sessions": disk_sessions,
        "memory_sessions": memory_sessions,
        "orphaned": orphaned,
        "recovered": len(disk_sessions) - len(orphaned)
    }

@app.get("/api/sessions/list")
async def list_sessions():
    """List all sessions with their sizes"""
    try:
        extracted_dir = Path("data/extracted")
        sessions = []
        
        if extracted_dir.exists():
            for session_dir in extracted_dir.iterdir():
                if session_dir.is_dir():
                    # Calculate size
                    size = sum(f.stat().st_size for f in session_dir.rglob("*") if f.is_file())
                    
                    # Get file count
                    file_count = len(list(session_dir.rglob("*")))
                    
                    # Get modification time
                    mtime = session_dir.stat().st_mtime
                    
                    sessions.append({
                        "name": session_dir.name,
                        "size_mb": round(size / 1024 / 1024, 2),
                        "file_count": file_count,
                        "modified": datetime.fromtimestamp(mtime).isoformat(),
                        "path": str(session_dir)
                    })
        
        # Sort by modification time (newest first)
        sessions.sort(key=lambda x: x["modified"], reverse=True)
        
        total_size = sum(s["size_mb"] for s in sessions)
        
        return {
            "sessions": sessions,
            "total_count": len(sessions),
            "total_size_mb": round(total_size, 2)
        }
        
    except Exception as e:
        raise HTTPException(500, f"Failed to list sessions: {str(e)}")

@app.delete("/api/sessions/{session_id}")
async def delete_specific_session(session_id: str):
    """Delete a specific session"""
    try:
        extracted_dir = Path("data/extracted")
        session_path = extracted_dir / session_id
        
        if not session_path.exists():
            raise HTTPException(404, "Session not found")
        
        # Calculate size before deletion
        size = sum(f.stat().st_size for f in session_path.rglob("*") if f.is_file())
        size_mb = round(size / 1024 / 1024, 2)
        
        # Delete the session directory
        import shutil
        shutil.rmtree(session_path)
        
        # Remove from in-memory data if present
        if session_id in analysis_sessions:
            del analysis_sessions[session_id]
        if session_id in extracted_files:
            del extracted_files[session_id]
        if session_id in auto_analysis_sessions:
            del auto_analysis_sessions[session_id]
        
        return {
            "status": "success",
            "message": f"Deleted session: {session_id}",
            "space_freed": f"{size_mb} MB"
        }
        
    except Exception as e:
        raise HTTPException(500, f"Failed to delete session: {str(e)}")

# Auto-Analysis endpoints (OPTIMIZED)
@app.post("/api/auto-analysis/{session_id}")
async def start_auto_analysis(session_id: str, background_tasks: BackgroundTasks):
    """Start auto-analysis using autogrep.py in the background"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    # Check if auto-analysis is already running or completed
    if session_id in auto_analysis_sessions:
        current_status = auto_analysis_sessions[session_id].get('status')
        if current_status == 'processing':
            return {
                "session_id": session_id,
                "status": "already_running",
                "message": "Auto-analysis is already in progress"
            }
        elif current_status == 'completed':
            return {
                "session_id": session_id,
                "status": "already_completed",
                "message": "Auto-analysis already completed",
                "results": auto_analysis_sessions[session_id]
            }
    
    # Initialize auto-analysis session
    auto_analysis_sessions[session_id] = {
        "session_id": session_id,
        "status": "processing",
        "started_at": datetime.now().isoformat(),
        "progress": 0,
        "message": "Starting auto-analysis..."
    }
    
    # Start background task
    background_tasks.add_task(run_auto_analysis_task, session_id)
    
    return {
        "session_id": session_id,
        "status": "started",
        "message": "Auto-analysis started in background"
    }

# OPTIMIZED run_auto_analysis_task function
async def run_auto_analysis_task(session_id: str):
    """Background task to run auto-analysis using autogrep.py - OPTIMIZED VERSION"""
    try:
        print(f"🔍 Starting auto-analysis for session: {session_id}")
        
        # Update status
        auto_analysis_sessions[session_id].update({
            "status": "processing",
            "progress": 10,
            "message": "Initializing pattern hunter..."
        })
        
        # OPTIMIZATION: More efficient file finding
        upload_path = Path("data/uploads")
        
        # Build a list of potential files more efficiently
        potential_files = []
        
        # Use glob more efficiently with specific patterns
        # First, try exact match with session_id
        pattern1 = f"*{session_id}*"
        potential_files.extend(upload_path.glob(pattern1))
        
        # If not found, extract the original filename from session_id
        if not potential_files:
            parts = session_id.split('_', 2)
            if len(parts) > 2:
                original_filename = parts[2]
                pattern2 = f"*{original_filename}"
                potential_files.extend(upload_path.glob(pattern2))
        
        # Use the first valid file found
        original_file = None
        for file in potential_files:
            if file.exists() and file.is_file():
                original_file = file
                break
        
        if not original_file:
            # Fallback to listing all files if patterns didn't work
            for file in upload_path.iterdir():
                if session_id in file.name and file.is_file():
                    original_file = file
                    break
        
        if not original_file:
            raise Exception(f"Original uploaded file not found for session {session_id}")
        
        print(f"📦 Using original upload: {original_file.name}")
        
        auto_analysis_sessions[session_id].update({
            "progress": 30,
            "message": "Running pattern analysis on original archive..."
        })
        
        # Run the analysis with optimizations
        def run_analysis():
            print(f"🎯 Initializing AutoGrep...")
            # OPTIMIZATION: Use more workers for better parallelization
            optimal_workers = min(mp.cpu_count(), 8)  # Increased from 4
            analyzer = AutoGrep(workers=optimal_workers)
            print(f"✅ AutoGrep initialized with {len(analyzer.pattern_bank.patterns)} patterns, using {optimal_workers} workers")
            
            auto_analysis_sessions[session_id].update({
                "progress": 50,
                "message": "Analyzing patterns..."
            })
            
            # Run the analysis - AutoGrep returns a report dict
            print(f"🔍 Starting pattern analysis on: {original_file}")
            start_time = time.time()
            report = analyzer.analyze_tar(str(original_file))
            analysis_duration = time.time() - start_time
            print(f"✅ Pattern analysis completed in {analysis_duration:.1f}s")
            
            auto_analysis_sessions[session_id].update({
                "progress": 80,
                "message": "Processing results..."
            })
            
            # Convert AutoGrep report format to match frontend expectations
            problems = []
            rank = 1
            
            # Process GitLab components from the report
            gitlab_components = report.get('gitlab_components', {})
            for component, issues in gitlab_components.items():
                for issue in issues[:10]:  # Limit to top 10 per component
                    problems.append({
                        "rank": rank,
                        "component": component,
                        "pattern": issue.get('pattern', ''),
                        "count": issue.get('count', 0),
                        "nodes": [],  # AutoGrep doesn't track nodes the same way
                        "files": issue.get('files', []),
                        "first_seen": None,
                        "last_seen": None,
                        "sample_line": issue.get('sample', ''),
                        "sample_file": issue.get('files', ['unknown'])[0] if issue.get('files') else 'unknown',
                        "line_number": 0,  # AutoGrep doesn't provide line numbers in summary
                        "error_category": component.lower().replace('/', '_').replace(' ', '_'),
                        "cluster_signature": f"{component}_{issue.get('pattern_id', rank)}"
                    })
                    rank += 1
                    if rank > 50:  # Max 50 problems total
                        break
                if rank > 50:
                    break
            
            # Build component stats
            component_stats = report.get('summary', {}).get('component_counts', {})
            
            # Get monitoring stats if available
            monitoring_stats = report.get('monitoring_summary', {})
            
            # Process summary data
            summary = report.get('summary', {})
            
            return {
                "analysis_duration": analysis_duration,
                "total_problems": summary.get('errors_found', 0),
                "gitlab_problems": summary.get('gitlab_errors', 0),
                "monitoring_issues": summary.get('monitoring_errors', 0),
                "unique_patterns": len(problems),
                "problems": problems,
                "component_stats": component_stats,
                "monitoring_stats": monitoring_stats,
                "correlation_ids": 0,  # AutoGrep doesn't expose this
                "repository_errors": 0   # AutoGrep doesn't expose this
            }
        
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        results_data = await loop.run_in_executor(thread_pool, run_analysis)
        
        # Store results
        auto_analysis_sessions[session_id].update({
            "status": "completed",
            "progress": 100,
            "message": "Auto-analysis completed",
            "completed_at": datetime.now().isoformat(),
            "results": results_data
        })
        
        print(f"✅ Auto-analysis completed for session: {session_id}")
        print(f"   📊 Results: {results_data['total_problems']} problems, {results_data['unique_patterns']} patterns")
        
    except Exception as e:
        print(f"❌ Auto-analysis failed for session {session_id}: {e}")
        import traceback
        traceback.print_exc()
        
        auto_analysis_sessions[session_id].update({
            "status": "failed",
            "progress": 0,
            "message": f"Auto-analysis failed: {str(e)}",
            "error": str(e),
            "failed_at": datetime.now().isoformat()
        })

@app.get("/api/auto-analysis/{session_id}")
async def get_auto_analysis_status(session_id: str):
    """Get auto-analysis status and results"""
    
    if session_id not in auto_analysis_sessions:
        return {
            "session_id": session_id,
            "status": "not_started",
            "message": "Auto-analysis not started"
        }
    
    return auto_analysis_sessions[session_id]

@app.delete("/api/auto-analysis/{session_id}")
async def clear_auto_analysis(session_id: str):
    """Clear auto-analysis results for a session"""
    
    if session_id in auto_analysis_sessions:
        del auto_analysis_sessions[session_id]
        return {
            "session_id": session_id,
            "status": "cleared",
            "message": "Auto-analysis results cleared"
        }
    
    return {
        "session_id": session_id,
        "status": "not_found",
        "message": "No auto-analysis results found"
    }

@app.get("/api/logs/{session_id}/{file_path:path}/raw")
async def get_raw_log(session_id: str, file_path: str):
    """Stream raw file - handles nested paths correctly"""
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    
    # Try the exact path first
    actual_path = session_dir / file_path
    
    # If not found, try without the session prefix (common issue)
    if not actual_path.exists():
        # The file_path might include redundant directory structure
        # Try to find the file by searching for it
        parts = file_path.split('/')
        
        # Try different combinations
        for i in range(len(parts)):
            test_path = session_dir / '/'.join(parts[i:])
            if test_path.exists() and test_path.is_file():
                actual_path = test_path
                break
    
    # Still not found? Try searching for the file
    if not actual_path.exists():
        file_name = os.path.basename(file_path)
        # Search for the file in the session directory
        for root, dirs, files in os.walk(session_dir):
            if file_name in files:
                actual_path = Path(root) / file_name
                break
    
    if not actual_path.exists() or not actual_path.is_file():
        print(f"File not found: {actual_path}")
        print(f"Session dir: {session_dir}")
        print(f"Requested path: {file_path}")
        raise HTTPException(404, f"File not found: {file_path}")
    
    return FileResponse(actual_path, media_type="text/plain")


def ensure_localhost_only():
    """Refuse to start if not on localhost"""
    # Just check for cloud environments, not IP
    cloud_indicators = [
        'AWS_EXECUTION_ENV', 'ECS_CONTAINER_METADATA_URI',
        'GOOGLE_CLOUD_PROJECT', 'AZURE_FUNCTIONS_ENVIRONMENT',
        'VERCEL', 'NETLIFY', 'HEROKU_APP_ID', 'RAILWAY_ENVIRONMENT'
    ]
    
    for indicator in cloud_indicators:
        if os.environ.get(indicator):
            print(f"ERROR: Cloud environment detected ({indicator})")
            print("This tool cannot run in cloud environments")
            sys.exit(1)
    
    print("✅ Running in local environment")


if __name__ == "__main__":
    ensure_localhost_only()
    import uvicorn

    safe_restore_sessions()
    
    print("🚀 Starting GitLab SOS Analyzer v5.3.0 - OPTIMIZED")
    print("✨ Features: Pattern Analysis, Power Search, GitLab Duo Chat, KubeSOS Support")
    print("⚡ Performance: Optimized for faster auto-analysis")
    print("📂 Web UI at http://localhost:8000")
    print("\n⚠️  Note: MCP Server must be run separately")
    print("   Run 'python run_mcp.py' in another terminal for GitLab Duo MCP support")
    
    # CRITICAL: Change this to 127.0.0.1
    uvicorn.run(app, host="127.0.0.1", port=8000)