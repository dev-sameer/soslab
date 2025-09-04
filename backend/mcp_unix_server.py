#!/usr/bin/env python3
"""
SMART AUTONOMOUS GitLab MCP Server
- Does comprehensive analysis in ONE shot
- Intelligent pattern matching
- Returns everything you need immediately
"""

import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
import shlex
import re
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
import uvicorn

class MCPUnixServer:
    """
    Smart Autonomous MCP Server - Minimal queries, maximum results
    """

    def __init__(self, base_dir: str = "data/extracted"):
        self.app = FastAPI(title="Smart GitLab MCP Server")
        self.base_dir = Path(base_dir)
        self.current_session = None
        
        # Auto-select latest session
        self._auto_select_session()
        
        # Initialize COMPREHENSIVE pattern libraries
        self._init_smart_patterns()
        
        self._setup_routes()

    def _init_smart_patterns(self):
        """Initialize smart consolidated patterns"""
        
        # SMART PATTERNS - Get everything in one shot
        self.SMART_PATTERNS = {
            'critical': [
                # Catches ALL critical issues
                r'(PANIC|FATAL|CRITICAL|OOM|poison.*pill|crashed|died|kill|unavailable)',
                r'(ERROR|FAIL).*((deadlock|timeout|refused|lost|down|unavailable))',
                r'(repositories.*unavailable|node.*unavailable|service.*down)',
            ],
            'errors': [
                # Comprehensive error patterns
                r'(ERROR|FAIL|Exception|Error:|error:)',
                r'(5[0-9][0-9]|timeout|refused|failed)',
                r'"level":"error"|"severity":"ERROR"',
            ],
            'performance': [
                # All performance issues
                r'(duration|elapsed|took).*[1-9][0-9]{3,}',  # 1000+ ms
                r'(slow|hung|stuck|blocked|waiting)',
                r'(queue|latency|backlog).*[1-9][0-9]{2,}',
            ],
            'connection': [
                # All connection issues
                r'(connection|connect).*?(refused|timeout|failed|lost|closed)',
                r'(dial|dialing).*?(failed|error)',
                r'(unable.*connect|cannot.*connect|could not connect)',
            ]
        }

    def _auto_select_session(self):
        """Auto-select the most recent session"""
        if self.base_dir.exists():
            sessions = [d for d in self.base_dir.iterdir() if d.is_dir()]
            if sessions:
                latest = max(sessions, key=lambda d: d.stat().st_mtime)
                self.current_session = latest.name

    def _smart_analyze(self, service: str = "all", quick: bool = False) -> Dict:
        """
        SMART ANALYSIS - Gets everything in ONE operation
        No multiple queries, no asking for patterns
        """
        if not self.current_session:
            return {"error": "No session selected"}
        
        session_path = self.base_dir / self.current_session
        results = defaultdict(lambda: defaultdict(list))
        
        # Service-specific log patterns - Updated for GitLabSOS structure
        log_mappings = {
            'postgresql': [
                '*/postgresql/current',  # svlogd format
                '*/postgresql/*.log*',
                '*postgres*.log*',
                '*psql*.log*',
                '*pgbouncer*.log*',
                '*patroni*.log*'
            ],
            'psql': [  # Alias for postgresql
                '*/postgresql/current',
                '*/postgresql/*.log*',
                '*postgres*.log*',
                '*psql*.log*'
            ],
            'sidekiq': [
                '*/sidekiq/current',  # svlogd format
                '*/sidekiq/*.log*',
                '*sidekiq*.log*'
            ],
            'gitaly': [
                '*/gitaly/current',
                '*/gitaly/*.log*',
                '*gitaly*.log*',
                '*praefect*.log*'
            ],
            'rails': [
                '*/gitlab-rails/production_json.log*',
                '*/gitlab-rails/production.log*',
                '*/gitlab-rails/api_json.log*',
                '*/gitlab-rails/exceptions_json.log*',
                '*/puma/current',  # Puma serves Rails
                '*production*.log*',
                '*api*.log*',
                '*exceptions*.log*'
            ],
            'puma': [  # Alias for rails
                '*/puma/current',
                '*/puma/*.log*',
                '*/gitlab-rails/production*.log*'
            ],
            'redis': [
                '*/redis/current',
                '*/redis/*.log*',
                '*redis*.log*'
            ],
            'nginx': [
                '*/nginx/current',
                '*/nginx/gitlab_access.log*',
                '*/nginx/gitlab_error.log*',
                '*/nginx/*.log*',
                '*nginx*.log*'
            ],
            'registry': [
                '*/registry/current',
                '*/registry/*.log*',
                '*registry*.log*'
            ],
            'pages': [
                '*/gitlab-pages/current',
                '*/gitlab-pages/*.log*',
                '*pages*.log*'
            ],
            'prometheus': [
                '*/prometheus/current',
                '*/prometheus/*.log*',
                '*prometheus*.log*'
            ],
            'workhorse': [
                '*/gitlab-workhorse/current',
                '*/gitlab-workhorse/*.log*',
                '*workhorse*.log*'
            ],
            'kubernetes': ['*kube*.log*', '*k8s*.log*', '*helm*.log*'],
            'all': ['*.log*', '*/current', 'var/log/gitlab/**/current']
        }
        
        # Handle service aliases
        service_normalized = service.lower()
        if service_normalized in ['psql', 'postgres']:
            service_normalized = 'postgresql'
        elif service_normalized == 'puma':
            service_normalized = 'rails'
        
        # Get the right log patterns
        if service_normalized == "all":
            patterns = log_mappings['all']
        else:
            patterns = log_mappings.get(service_normalized, log_mappings['all'])
        
        # Collect all log files
        log_files = []
        for pattern in patterns:
            found = list(session_path.rglob(pattern))
            log_files.extend(found)
        
        # Remove duplicates
        log_files = list(set(log_files))
        
        if not log_files:
            # Try to help user understand what's available
            all_logs = list(session_path.rglob('*.log*')) + list(session_path.rglob('*/current'))
            if all_logs:
                log_names = set([f.parent.name if f.name == 'current' else f.name for f in all_logs[:20]])
                return {"error": f"No {service} logs found. Available: {', '.join(list(log_names)[:10])}"}
            return {"error": f"No {service} logs found"}
        
        # SMART SINGLE-PASS ANALYSIS
        # Instead of multiple greps, do ONE smart grep per file
        for log_file in log_files[:50]:  # Limit files for performance
            if not log_file.is_file():
                continue
                
            try:
                # Build ONE comprehensive grep command
                if quick:
                    # Quick mode - just critical issues
                    grep_pattern = '(PANIC|FATAL|ERROR|FAIL|timeout|refused|unavailable|OOM|deadlock)'
                else:
                    # Full mode - comprehensive patterns
                    grep_pattern = '(ERROR|FAIL|WARN|timeout|slow|refused|unavailable|deadlock|duration.*[0-9]{4,}|5[0-9][0-9])'
                
                # Single grep with context
                cmd = f"grep -i -n -C 2 -E '{grep_pattern}' {shlex.quote(str(log_file))} 2>/dev/null | head -500"
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                
                if result.stdout:
                    lines = result.stdout.strip().split('\n')
                    
                    # Smart categorization
                    for line in lines:
                        line_lower = line.lower()
                        
                        # Categorize by severity/type
                        if any(x in line_lower for x in ['panic', 'fatal', 'critical', 'oom', 'crash']):
                            results['CRITICAL'][str(log_file.name)].append(line[:300])
                        elif any(x in line_lower for x in ['error', 'fail', 'exception']):
                            results['ERRORS'][str(log_file.name)].append(line[:300])
                        elif any(x in line_lower for x in ['timeout', 'deadlock', 'refused']):
                            results['TIMEOUTS'][str(log_file.name)].append(line[:300])
                        elif any(x in line_lower for x in ['slow', 'duration', 'elapsed']):
                            # Check if it's actually slow (extract number if possible)
                            duration_match = re.search(r'(\d+)(?:ms|\.?\d*s)', line)
                            if duration_match:
                                duration = int(duration_match.group(1))
                                if duration > 1000:  # Over 1 second
                                    results['PERFORMANCE'][str(log_file.name)].append(line[:300])
                        elif any(x in line_lower for x in ['warn', 'warning']):
                            results['WARNINGS'][str(log_file.name)].append(line[:300])
                    
            except Exception as e:
                results['scan_errors'][str(log_file)].append(str(e))
        
        # Also get some statistics
        stats = {
            'files_scanned': len(log_files),
            'critical_count': sum(len(v) for files in results.get('CRITICAL', {}).values() for v in files),
            'error_count': sum(len(v) for files in results.get('ERRORS', {}).values() for v in files),
            'timeout_count': sum(len(v) for files in results.get('TIMEOUTS', {}).values() for v in files),
        }
        
        return {'results': dict(results), 'stats': stats, 'log_files': log_files[:10]}

    def _get_tools_definition(self) -> List[Dict[str, Any]]:
        """Simplified tool definitions - fewer but smarter"""
        return [
            # Session management (keep these)
            {
                "name": "sessions",
                "description": "List all available SOS sessions",
                "inputSchema": {"type": "object", "properties": {}, "required": []}
            },
            {
                "name": "cd",
                "description": "Change to a specific SOS session",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session": {"type": "string", "description": "Session ID"}
                    },
                    "required": ["session"]
                }
            },
            {
                "name": "ls",
                "description": "List files in the current session",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to list", "default": ""},
                        "pattern": {"type": "string", "description": "File pattern to search", "default": ""}
                    },
                    "required": []
                }
            },
            
            # SMART UNIFIED TOOLS
            {
                "name": "analyze",
                "description": "Smart comprehensive analysis - gets EVERYTHING in one shot. No patterns needed!",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "service": {
                            "type": "string",
                            "description": "Service: postgresql/psql, sidekiq, gitaly, rails/puma, redis, nginx, registry, pages, prometheus, workhorse, or 'all'",
                            "default": "all"
                        },
                        "quick": {
                            "type": "boolean",
                            "description": "Quick mode - only critical issues",
                            "default": False
                        }
                    },
                    "required": []
                }
            },
            {
                "name": "health",
                "description": "Complete health check - ONE call gets everything",
                "inputSchema": {"type": "object", "properties": {}, "required": []}
            },
            {
                "name": "trace",
                "description": "Trace any ID across all logs",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "ID to trace"}
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "search",
                "description": "Smart search - automatically finds related issues",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "smart": {"type": "boolean", "default": True}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "deep_dive",
                "description": "Deep comprehensive analysis of a service - gets EVERYTHING including slow queries, locks, errors, connections in ONE shot",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "service": {
                            "type": "string",
                            "description": "Service to deep dive: postgresql, sidekiq, gitaly, rails, etc.",
                            "default": "postgresql"
                        }
                    },
                    "required": []
                }
            }
        ]

    def _setup_routes(self):
        """Setup FastAPI routes"""
        
        @self.app.get("/mcp")
        async def mcp_info():
            return {
                "implementation": "smart-gitlab-mcp",
                "version": "4.0.0",
                "protocol": "json-rpc-2.0",
                "description": "Smart Autonomous GitLab MCP - No excessive queries!"
            }
        
        @self.app.post("/mcp")
        async def handle_mcp_request(request: Request):
            try:
                body = await request.json()
                
                if isinstance(body, list):
                    responses = []
                    for req in body:
                        response = await self._handle_single_request(req)
                        if response:
                            responses.append(response)
                    return JSONResponse(content=responses)
                else:
                    response = await self._handle_single_request(body)
                    if response:
                        return JSONResponse(content=response)
                    return Response(status_code=204)
                        
            except Exception as e:
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "error": {"code": -32603, "message": str(e)},
                        "id": None
                    },
                    status_code=500
                )

    async def _handle_single_request(self, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a single JSON-RPC 2.0 request"""
        
        if "jsonrpc" not in request or request["jsonrpc"] != "2.0":
            return {
                "jsonrpc": "2.0",
                "error": {"code": -32600, "message": "Invalid Request"},
                "id": request.get("id")
            }
        
        method = request.get("method")
        params = request.get("params", {})
        request_id = request.get("id")
        
        try:
            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "smart-gitlab-mcp", "version": "4.0.0"}
                }
            elif method == "tools/list":
                result = {"tools": self._get_tools_definition()}
            elif method == "tools/call":
                result = await self._handle_tool_call(params)
            else:
                if request_id is not None:
                    return {
                        "jsonrpc": "2.0",
                        "error": {"code": -32601, "message": f"Method not found: {method}"},
                        "id": request_id
                    }
                return None
            
            if request_id is not None:
                return {"jsonrpc": "2.0", "result": result, "id": request_id}
            return None
            
        except Exception as e:
            if request_id is not None:
                return {
                    "jsonrpc": "2.0",
                    "error": {"code": -32603, "message": str(e)},
                    "id": request_id
                }
            return None

    async def _handle_tool_call(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Route tool calls to handlers"""
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        
        handlers = {
            "sessions": self._sessions,
            "cd": self._cd,
            "ls": self._ls,
            "analyze": self._analyze,
            "health": self._health,
            "trace": self._trace,
            "search": self._search,
            "deep_dive": self._deep_dive,
        }
        
        handler = handlers.get(tool_name)
        if handler:
            result = await handler(arguments)
            return {"content": [{"type": "text", "text": result}]}
        else:
            return {
                "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                "isError": True
            }

    async def _sessions(self, args: Dict) -> str:
        """List sessions"""
        sessions = []
        
        if self.base_dir.exists():
            for session_dir in self.base_dir.iterdir():
                if session_dir.is_dir():
                    log_count = len(list(session_dir.rglob("*.log*")))
                    current_count = len(list(session_dir.rglob("*/current")))
                    sessions.append({
                        'name': session_dir.name,
                        'logs': log_count + current_count,
                        'current': session_dir.name == self.current_session
                    })
        
        output = ["📁 Available SOS Sessions\n" + "="*80]
        for s in sessions:
            marker = "→" if s['current'] else " "
            output.append(f"{marker} {s['name']} ({s['logs']} logs)")
        
        return '\n'.join(output)

    async def _cd(self, args: Dict) -> str:
        """Change session"""
        session = args.get('session')
        if not session:
            return "❌ Session name required"
        
        session_path = self.base_dir / session
        if not session_path.exists():
            return f"❌ Session '{session}' not found"
        
        self.current_session = session
        
        # Quick stats
        log_count = len(list(session_path.rglob("*.log*")))
        current_count = len(list(session_path.rglob("*/current")))
        
        # Check what services are available
        services = []
        if list(session_path.rglob("*/postgresql/*")) or list(session_path.rglob("*psql*")):
            services.append("postgresql")
        if list(session_path.rglob("*/sidekiq/*")):
            services.append("sidekiq")
        if list(session_path.rglob("*/gitaly/*")):
            services.append("gitaly")
        if list(session_path.rglob("*/gitlab-rails/*")) or list(session_path.rglob("*/puma/*")):
            services.append("rails")
        if list(session_path.rglob("*/redis/*")):
            services.append("redis")
        if list(session_path.rglob("*/nginx/*")):
            services.append("nginx")
        
        output = [f"✅ Switched to: {session}"]
        output.append(f"📊 {log_count + current_count} log files available")
        if services:
            output.append(f"🔧 Services found: {', '.join(services)}")
        
        return '\n'.join(output)

    async def _ls(self, args: Dict) -> str:
        """List files in the current session"""
        path = args.get('path', '')
        pattern = args.get('pattern', '')
        
        if not self.current_session:
            return "❌ No session selected. Use 'cd' to select a session."
        
        session_path = self.base_dir / self.current_session
        target_path = session_path / path if path else session_path
        
        if not target_path.exists():
            return f"❌ Path not found: {path}"
        
        output = [f"📂 Contents of {path if path else 'session root'}:"]
        output.append("="*80)
        
        if pattern:
            # Search for specific pattern
            files = list(target_path.rglob(pattern))
            output.append(f"🔍 Files matching '{pattern}':\n")
            
            # Group by directory
            by_dir = defaultdict(list)
            for f in files[:100]:  # Limit output
                rel_path = f.relative_to(session_path)
                by_dir[str(rel_path.parent)].append(rel_path.name)
            
            for dir_path, filenames in sorted(by_dir.items()):
                output.append(f"\n📁 {dir_path}/")
                for filename in filenames[:10]:
                    output.append(f"    {filename}")
                if len(filenames) > 10:
                    output.append(f"    ... and {len(filenames) - 10} more")
        else:
            # List immediate contents
            items = sorted(target_path.iterdir())[:50]
            
            dirs = []
            files = []
            
            for item in items:
                if item.is_dir():
                    # Count items in directory
                    item_count = len(list(item.iterdir()))
                    dirs.append(f"  📁 {item.name}/ ({item_count} items)")
                else:
                    size_kb = round(item.stat().st_size / 1024, 1)
                    files.append(f"  📄 {item.name} ({size_kb} KB)")
            
            if dirs:
                output.append("\nDirectories:")
                output.extend(dirs)
            
            if files:
                output.append("\nFiles:")
                output.extend(files)
                
        return '\n'.join(output)

    async def _analyze(self, args: Dict) -> str:
        """SMART COMPREHENSIVE ANALYSIS - Everything in ONE shot"""
        service = args.get('service', 'all')
        quick = args.get('quick', False)
        
        # Do the smart analysis
        analysis = self._smart_analyze(service, quick)
        
        if 'error' in analysis:
            return f"❌ {analysis['error']}"
        
        results = analysis.get('results', {})
        stats = analysis.get('stats', {})
        log_files = analysis.get('log_files', [])
        
        # Format output
        output = [f"🔍 SMART ANALYSIS: {service.upper()}"]
        output.append("="*80)
        output.append(f"📊 Scanned {stats['files_scanned']} files")
        
        # Show what files were analyzed (helpful for debugging)
        if log_files and len(log_files) > 0:
            file_names = [f.name if hasattr(f, 'name') else str(f).split('/')[-1] for f in log_files[:5]]
            output.append(f"📁 Sample logs: {', '.join(file_names)}")
        
        output.append("")
        
        # Show critical issues first
        if 'CRITICAL' in results and results['CRITICAL']:
            output.append("🚨 CRITICAL ISSUES - IMMEDIATE ACTION REQUIRED:")
            output.append("-"*40)
            for file, issues in list(results['CRITICAL'].items())[:5]:
                output.append(f"\n📄 {file}:")
                for issue in issues[:3]:
                    output.append(f"  ⚠️ {issue}")
            output.append("")
        
        # Show errors
        if 'ERRORS' in results and results['ERRORS']:
            error_count = sum(len(issues) for issues in results['ERRORS'].values())
            output.append(f"❌ ERRORS ({error_count} found):")
            output.append("-"*40)
            for file, issues in list(results['ERRORS'].items())[:3]:
                output.append(f"\n📄 {file}:")
                for issue in issues[:2]:
                    output.append(f"  • {issue}")
            output.append("")
        
        # Show timeouts/deadlocks
        if 'TIMEOUTS' in results and results['TIMEOUTS']:
            timeout_count = sum(len(issues) for issues in results['TIMEOUTS'].values())
            output.append(f"⏱️ TIMEOUTS/DEADLOCKS ({timeout_count} found):")
            output.append("-"*40)
            for file, issues in list(results['TIMEOUTS'].items())[:3]:
                output.append(f"\n📄 {file}:")
                for issue in issues[:2]:
                    output.append(f"  • {issue}")
            output.append("")
        
        # Show performance issues
        if 'PERFORMANCE' in results and results['PERFORMANCE']:
            perf_count = sum(len(issues) for issues in results['PERFORMANCE'].values())
            output.append(f"🐌 PERFORMANCE ISSUES ({perf_count} slow operations):")
            output.append("-"*40)
            for file, issues in list(results['PERFORMANCE'].items())[:3]:
                output.append(f"\n📄 {file}:")
                for issue in issues[:2]:
                    output.append(f"  • {issue}")
            output.append("")
        
        # Summary
        output.append("\n📈 SUMMARY:")
        output.append("-"*40)
        output.append(f"🚨 Critical: {stats['critical_count']}")
        output.append(f"❌ Errors: {stats['error_count']}")
        output.append(f"⏱️ Timeouts: {stats['timeout_count']}")
        
        # Health assessment
        if stats['critical_count'] > 0:
            output.append(f"\n⚠️ HEALTH: CRITICAL - Immediate intervention required!")
        elif stats['error_count'] > 10:
            output.append(f"\n⚠️ HEALTH: DEGRADED - Multiple errors detected")
        elif stats['timeout_count'] > 5:
            output.append(f"\n⚠️ HEALTH: WARNING - Performance issues detected")
        else:
            output.append(f"\n✅ HEALTH: GOOD - No major issues detected")
        
        # Quick recommendations
        output.append("\n💡 RECOMMENDATIONS:")
        if stats['critical_count'] > 0:
            output.append("1. Address critical issues immediately")
            output.append("2. Check system resources (memory, disk)")
            output.append("3. Review recent deployments")
        elif stats['error_count'] > 0:
            output.append("1. Review error patterns for root cause")
            output.append("2. Check service dependencies")
        elif stats['timeout_count'] > 0:
            output.append("1. Review database performance")
            output.append("2. Check for lock contention")
            output.append("3. Monitor resource utilization")
        else:
            output.append("1. Continue monitoring")
            output.append("2. Review logs periodically")
        
        return '\n'.join(output)

    async def _health(self, args: Dict) -> str:
        """ONE-SHOT HEALTH CHECK - Gets everything immediately"""
        
        # Analyze all services in one go - expanded list
        services = ['postgresql', 'sidekiq', 'gitaly', 'rails', 'redis', 'nginx', 'registry', 'pages', 'prometheus']
        health_status = {}
        
        output = ["🏥 COMPLETE HEALTH CHECK"]
        output.append("="*80)
        
        critical_services = []
        warning_services = []
        healthy_services = []
        missing_services = []
        
        for service in services:
            analysis = self._smart_analyze(service, quick=True)
            
            if 'error' in analysis:
                # No logs found for service
                missing_services.append(service)
                continue
            
            stats = analysis['stats']
            
            if stats['critical_count'] > 0:
                critical_services.append(service)
                health_status[service] = 'CRITICAL'
            elif stats['error_count'] > 5:
                warning_services.append(service)
                health_status[service] = 'WARNING'
            else:
                healthy_services.append(service)
                health_status[service] = 'HEALTHY'
        
        # Overall status
        if critical_services:
            output.append("\n🚨 STATUS: CRITICAL\n")
            output.append("Critical Services:")
            for svc in critical_services:
                output.append(f"  ❌ {svc.upper()}")
        elif warning_services:
            output.append("\n⚠️ STATUS: DEGRADED\n")
            output.append("Services with issues:")
            for svc in warning_services:
                output.append(f"  ⚠️ {svc.upper()}")
        else:
            output.append("\n✅ STATUS: HEALTHY\n")
        
        # Service breakdown
        output.append("\n📊 SERVICE STATUS:")
        output.append("-"*40)
        for service, status in health_status.items():
            icon = "❌" if status == "CRITICAL" else "⚠️" if status == "WARNING" else "✅"
            output.append(f"{icon} {service.upper()}: {status}")
        
        if missing_services:
            output.append("\n📝 Services not found in logs:")
            for svc in missing_services:
                output.append(f"  ⚪ {svc.upper()}")
        
        # Quick fix recommendations
        if critical_services:
            output.append("\n🔧 IMMEDIATE ACTIONS:")
            if 'postgresql' in critical_services:
                output.append("• Check PostgreSQL locks and connections")
            if 'sidekiq' in critical_services:
                output.append("• Check Sidekiq memory and job queues")
            if 'gitaly' in critical_services:
                output.append("• Check Gitaly node availability")
            if 'redis' in critical_services:
                output.append("• Check Redis memory and connections")
        
        return '\n'.join(output)

    async def _trace(self, args: Dict) -> str:
        """Smart trace - finds everything about an ID in one shot"""
        trace_id = args.get('id', '')
        
        if not trace_id:
            return "❌ No ID provided"
        
        if not self.current_session:
            return "❌ No session selected"
        
        session_path = self.base_dir / self.current_session
        
        # Smart grep for the ID across all logs
        cmd = f"grep -r -i -n -C 2 {shlex.quote(trace_id)} {shlex.quote(str(session_path))} 2>/dev/null | head -200"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        
        output = [f"🔍 TRACE: {trace_id}"]
        output.append("="*80)
        
        if result.stdout:
            lines = result.stdout.strip().split('\n')
            
            # Group by file
            by_file = defaultdict(list)
            for line in lines:
                if ':' in line:
                    parts = line.split(':', 2)
                    if len(parts) >= 3:
                        file_path = parts[0].replace(str(session_path) + '/', '')
                        by_file[file_path].append(parts[2] if len(parts) > 2 else line)
            
            output.append(f"\n📊 Found in {len(by_file)} files\n")
            
            for file_path, matches in list(by_file.items())[:10]:
                output.append(f"\n📄 {file_path}:")
                for match in matches[:5]:
                    output.append(f"  {match[:300]}")
        else:
            output.append("❌ No traces found")
        
        return '\n'.join(output)

    async def _search(self, args: Dict) -> str:
        """Smart search - automatically expands search and finds related issues"""
        query = args.get('query', '')
        smart = args.get('smart', True)
        
        if not query:
            return "❌ No query provided"
        
        if not self.current_session:
            return "❌ No session selected"
        
        session_path = self.base_dir / self.current_session
        
        # If smart mode, expand the search
        if smart:
            # Add related terms
            expansions = []
            if 'error' in query.lower():
                expansions = ['ERROR', 'FAIL', 'Exception']
            elif 'timeout' in query.lower():
                expansions = ['timeout', 'timed out', 'deadline exceeded']
            elif 'connection' in query.lower():
                expansions = ['connection', 'connect', 'refused', 'lost']
            else:
                expansions = [query]
            
            pattern = '|'.join(expansions)
        else:
            pattern = query
        
        # Smart grep with expanded pattern
        cmd = f"grep -r -i -E '{pattern}' {shlex.quote(str(session_path))} 2>/dev/null | head -100"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        
        output = [f"🔍 SMART SEARCH: {query}"]
        output.append("="*80)
        
        if result.stdout:
            lines = result.stdout.strip().split('\n')
            
            # Categorize results
            critical = []
            errors = []
            warnings = []
            other = []
            
            for line in lines:
                line_lower = line.lower()
                if any(x in line_lower for x in ['panic', 'fatal', 'critical']):
                    critical.append(line)
                elif any(x in line_lower for x in ['error', 'fail']):
                    errors.append(line)
                elif any(x in line_lower for x in ['warn', 'warning']):
                    warnings.append(line)
                else:
                    other.append(line)
            
            # Show results by category
            if critical:
                output.append(f"\n🚨 CRITICAL ({len(critical)} found):")
                for line in critical[:5]:
                    output.append(f"  {line[:300]}")
            
            if errors:
                output.append(f"\n❌ ERRORS ({len(errors)} found):")
                for line in errors[:10]:
                    output.append(f"  {line[:300]}")
            
            if warnings:
                output.append(f"\n⚠️ WARNINGS ({len(warnings)} found):")
                for line in warnings[:5]:
                    output.append(f"  {line[:300]}")
            
            if other and not (critical or errors or warnings):
                output.append(f"\n📋 MATCHES ({len(other)} found):")
                for line in other[:10]:
                    output.append(f"  {line[:300]}")
            
            # Summary
            total = len(critical) + len(errors) + len(warnings) + len(other)
            output.append(f"\n📊 Total: {total} matches")
        else:
            output.append("❌ No matches found")
            
            # Suggest alternatives
            output.append("\n💡 Try searching for:")
            output.append("  • 'ERROR' - for all errors")
            output.append("  • 'timeout' - for timeout issues")
            output.append("  • 'CRITICAL' - for critical issues")
        
        return '\n'.join(output)

    async def _deep_dive(self, args: Dict) -> str:
        """DEEP COMPREHENSIVE ANALYSIS - Everything about ANY service in ONE shot with ALL AutoGrep patterns"""
        service = args.get('service', 'all')
        
        if not self.current_session:
            return "❌ No session selected"
        
        session_path = self.base_dir / self.current_session
        output = [f"🔬 DEEP DIVE ANALYSIS: {service.upper()}"]
        output.append("="*80)
        
        # COMPLETE AutoGrep patterns - ALL OF THEM
        deep_patterns = {
            'postgresql': {
                'connection_failures': [
                    r'PG::ConnectionBad',
                    r'PG::UnableToSend',
                    r'PG::CannotConnectNow',
                    r'PG::TooManyConnections',
                    r'ActiveRecord::ConnectionTimeoutError',
                    r'ActiveRecord::ConnectionNotEstablished',
                    r'could not connect to server',
                    r'connection pool exhausted',
                    r'pgbouncer cannot connect to server',
                    r'remaining connection slots are reserved',
                    r'too many clients already',
                    r'no pg_hba.conf entry',
                    r'FATAL:.*connection'
                ],
                'deadlocks_locks': [
                    r'ERROR.*deadlock detected',
                    r'ERROR.*could not serialize access due to concurrent update',
                    r'ActiveRecord::Deadlocked',
                    r'PG::TRDeadlockDetected',
                    r'PG::LockNotAvailable',
                    r'canceling statement due to lock timeout',
                    r'lock timeout',
                    r'waiting for.*lock',
                    r'ExclusiveLock',
                    r'ShareLock',
                    r'AccessExclusiveLock',
                    r'Process.*waits'
                ],
                'critical_errors': [
                    r'PG::CrashShutdown',
                    r'PG::DiskFull',
                    r'PG::OutOfMemory',
                    r'PANIC.*could not write to file pg_xlog',
                    r'PANIC.*WAL contains references to invalid pages',
                    r'PANIC.*corrupted page pointers',
                    r'FATAL.*the database system is shutting down(?!.*administrator command)',
                    r'PANIC:',
                    r'FATAL:'
                ],
                'slow_queries': [
                    r'duration: [1-9][0-9]{3,}\.\d+ ms',
                    r'LOG:.*duration: [1-9][0-9]{2,}\.\d+ ms.*(?:execute|statement)',
                    r'temporary file.*size [1-9][0-9]{7,}',
                    r'checkpoint.*complete.*[1-9][0-9]{2,}',
                    r'COPY.*FROM stdin'
                ],
                'statement_errors': [
                    r'ActiveRecord::StatementInvalid',
                    r'ActiveRecord::StatementTimeout',
                    r'PG::QueryCanceled',
                    r'PG::NotNullViolation',
                    r'PG::UniqueViolation',
                    r'PG::ForeignKeyViolation',
                    r'duplicate key value violates',
                    r'violates.*constraint',
                    r'invalid input syntax'
                ],
                'replication': [
                    r'replication slot.*does not exist',
                    r'WAL.*behind',
                    r'streaming replication.*failed',
                    r'standby.*disconnected',
                    r'wal_receiver.*crashed',
                    r'timeline.*diverged'
                ],
                'performance': [
                    r'autovacuum:.*[1-9][0-9]{4,}',
                    r'automatic analyze.*[1-9][0-9]{3,}',
                    r'checkpoint.*too frequent',
                    r'checkpoints are occurring too frequently'
                ]
            },
            'sidekiq': {
                'critical_failures': [
                    r'Sidekiq.*Shutdown(?!.*graceful)',
                    r'Sidekiq.*poison.*pill',
                    r'Sidekiq.*malformed.*job',
                    r'Sidekiq.*OOM.*killed',
                    r'Sidekiq.*memory.*exceeded',
                    r'Sidekiq.*worker.*died',
                    r'Sidekiq.*processor.*crashed',
                    r'Worker.*died',
                    r'Processor.*died',
                    r'Thread.*died',
                    r'Manager.*died',
                    r'Launcher.*died',
                    r'Fetcher.*died'
                ],
                'job_failures': [
                    r'Job.*failed.*times',
                    r'Job raised exception',
                    r'sidekiq_retries_exhausted',
                    r'retry: true',
                    r'retries_exhausted',
                    r'moved to dead',
                    r'ActiveJob::DeserializationError',
                    r'ActiveJob::EnqueueError',
                    r'Sidekiq::JobRetry::Handled',
                    r'Sidekiq::JobRetry::Skip',
                    r'dead_jobs',
                    r'"status":"failed"'
                ],
                'performance': [
                    r'job_duration.*[1-9][0-9]{4,}',
                    r'queue_latency.*[1-9][0-9]{3,}',
                    r'Busy:.*[1-9][0-9]{2,}',
                    r'Enqueued:.*[1-9][0-9]{4,}',
                    r'RSS.*[1-9][0-9]{3,}.*MB',
                    r'stuck jobs',
                    r'job timeout exceeded',
                    r'"duration":[0-9]{5,}',
                    r'elapsed.*[0-9]{4,}'
                ],
                'memory': [
                    r'memory_killer',
                    r'MemoryKiller',
                    r'memory threshold exceeded',
                    r'heap_live_slots.*[1-9][0-9]{7,}',
                    r'RSS:.*[0-9]{4,}.*MB',
                    r'OOM',
                    r'Cannot allocate memory',
                    r'memory.*exceeded'
                ],
                'redis_issues': [
                    r'Redis::TimeoutError.*Sidekiq',
                    r'Redis::CannotConnectError.*Sidekiq',
                    r'Redis connection lost',
                    r'connection_pool.*exhausted',
                    r'Could not connect to Redis'
                ],
                'queues': [
                    r'queue:.*size.*[0-9]{4,}',
                    r'queue.*stuck',
                    r'queue.*backlog',
                    r'heartbeat.*failed'
                ]
            },
            'gitaly': {
                'grpc_errors': [
                    r'rpc error:\s*code\s*=\s*Unavailable',
                    r'rpc error:\s*code\s*=\s*DeadlineExceeded',
                    r'rpc error:\s*code\s*=\s*Internal',
                    r'rpc error:\s*code\s*=\s*NotFound',
                    r'rpc error:\s*code\s*=\s*ResourceExhausted',
                    r'rpc error:\s*code\s*=\s*FailedPrecondition',
                    r'rpc error:\s*code\s*=\s*Aborted',
                    r'rpc error:\s*code\s*=\s*DataLoss',
                    r'GRPC::Unavailable',
                    r'GRPC::DeadlineExceeded',
                    r'GRPC::Internal',
                    r'GRPC::InvalidArgument',
                    r'GRPC::PermissionDenied',
                    r'GRPC::ResourceExhausted',
                    r'GRPC::DataLoss',
                    r'all SubCons are in TransientFailure',
                    r'transport is closing'
                ],
                'connection_failures': [
                    r'ERROR:\s*dialing failed:.*connection.*context deadline exceeded',
                    r'ERROR:\s*dialing failed:.*connection refused',
                    r'failed to dial.*connection(?!.*will retry)',
                    r'praefect.*failed to connect to gitaly node',
                    r'praefect.*gitaly node.*unreachable',
                    r'praefect.*no healthy gitaly nodes available',
                    r'praefect.*all gitaly nodes are down',
                    r'praefect.*connection.*failed',
                    r'praefect.*cannot connect',
                    r'praefect.*dial.*connection refused',
                    r'praefect.*context deadline exceeded'
                ],
                'replication_failures': [
                    r'replication.*failed(?!.*t\.)',
                    r'voting.*failed',
                    r'transaction.*failed(?!.*t\.)',
                    r'praefect.*replication.*failed(?!.*t\.)',
                    r'reconciliation.*failed',
                    r'metadata.*inconsistent',
                    r'failover.*triggered',
                    r'replication event.*failed',
                    r'replication queue.*full'
                ],
                'critical_unavailable': [
                    r'repositories that are unavailable',
                    r'virtual-storage.*has.*repositories.*that are unavailable',
                    r'gitaly.*unavailable',
                    r'storage.*unavailable',
                    r'gitaly node.*unavailable',
                    r'praefect.*primary.*unavailable'
                ],
                'operations': [
                    r'CreateRepository.*failed',
                    r'FetchRemote.*failed',
                    r'CreateBranch.*failed',
                    r'DeleteBranch.*failed',
                    r'CommitDiff.*failed',
                    r'TreeEntry.*failed',
                    r'GetBlob.*failed',
                    r'GetCommit.*failed'
                ],
                'storage': [
                    r'no such file or directory',
                    r'permission denied',
                    r'disk.*full',
                    r'inode.*exhausted',
                    r'filesystem.*read-only'
                ]
            },
            'rails': {
                'http_500_errors': [
                    r'"status":500',
                    r'"status":"500"',
                    r'status=500',
                    r'HTTP/1.1" 500',
                    r'"status":502',
                    r'"status":503',
                    r'"status":504',
                    r'Bad Gateway',
                    r'Service Unavailable',
                    r'Gateway Timeout'
                ],
                'http_400_errors': [
                    r'"status":422',
                    r'"status":429',
                    r'"status":401',
                    r'"status":403',
                    r'"status":404',
                    r'Unprocessable Entity',
                    r'Too Many Requests',
                    r'rate_limit',
                    r'Unauthorized',
                    r'Forbidden'
                ],
                'timeouts': [
                    r'"duration_s":[1-9][0-9]{2,}',
                    r'"duration_s":[6-9][0-9]',
                    r'Rack::Timeout::RequestTimeoutException',
                    r'Rack::Timeout::RequestExpiryError',
                    r'execution expired',
                    r'Net::ReadTimeout',
                    r'Net::OpenTimeout',
                    r'Gitlab::RequestContext::RequestDeadlineExceeded',
                    r'statement timeout',
                    r'canceling statement due to statement timeout',
                    r'"queue_duration_s":[1-9][0-9]+',
                    r'queue_duration.*[1-9][0-9]{4,}'
                ],
                'database_errors': [
                    r'ActiveRecord::ConnectionTimeoutError',
                    r'ActiveRecord::ConnectionNotEstablished',
                    r'ActiveRecord::StatementInvalid',
                    r'ActiveRecord::Deadlocked',
                    r'ActiveRecord::StaleObjectError',
                    r'ActiveRecord::RecordNotUnique',
                    r'PG::ConnectionBad',
                    r'PG::UnableToSend',
                    r'PG::TRDeadlockDetected',
                    r'could not obtain a connection',
                    r'remaining connection slots',
                    r'"db_duration_s":[1-9][0-9]+',
                    r'"db_count":[1-9][0-9]{3,}'
                ],
                'memory_errors': [
                    r'NoMemoryError',
                    r'Cannot allocate memory',
                    r'SystemStackError',
                    r'stack level too deep',
                    r'"cpu_s":[1-9][0-9]{2,}',
                    r'memory quota exceeded',
                    r'Memory limit exceeded',
                    r'GC::OOM'
                ],
                'git_errors': [
                    r'Gitlab::Git::CommandError',
                    r'Gitlab::Git::CommitError',
                    r'Gitlab::Git::PreReceiveError',
                    r'Gitlab::Git::Repository::NoRepository',
                    r'fatal: bad object',
                    r'fatal: corrupt',
                    r'fatal: not a git repository',
                    r'fatal: ambiguous argument',
                    r'fatal: your current branch .* does not have any commits',
                    r'Rugged::OdbError',
                    r'Rugged::ReferenceError',
                    r'Rugged::RepositoryError'
                ],
                'auth_errors': [
                    r'ActiveSession::SessionTerminatedError',
                    r'JWT::ExpiredSignature',
                    r'JWT::VerificationError',
                    r'JWT::DecodeError',
                    r'Gitlab::Auth::TooManyIps',
                    r'Gitlab::Auth::IpBlacklisted',
                    r'Rack_Attack',
                    r'throttle_authenticated',
                    r'OAuth::Unauthorized'
                ],
                'elasticsearch': [
                    r'Elasticsearch::Transport::Transport::Errors',
                    r'Faraday::TimeoutError.*elasticsearch',
                    r'Gitlab::Elastic::IndexRecordService::ImportError',
                    r'elasticsearch.*timeout',
                    r'elasticsearch.*CircuitBreaker'
                ],
                'graphql': [
                    r'GraphQL::ExecutionError',
                    r'GraphQL::Query::Executor::PropagateNull',
                    r'GraphQL::CoercionError',
                    r'complexity.*exceeds max',
                    r'depth.*exceeds max'
                ]
            },
            'redis': {
                'connection_errors': [
                    r'Redis.*connection.*refused',
                    r'Redis::TimeoutError',
                    r'Redis::ConnectionError',
                    r'Redis::CannotConnectError',
                    r'Could not connect to Redis',
                    r'Redis.*connection.*lost',
                    r'Redis.*connection.*dropped',
                    r'Error connecting to Redis'
                ],
                'memory_issues': [
                    r'MISCONF Redis is configured to save RDB snapshots.*unable to persist',
                    r'OOM command not allowed when used memory',
                    r'Redis.*memory.*usage.*critical',
                    r'Redis.*maxmemory.*policy.*triggered',
                    r'maxmemory.*reached',
                    r'evicted_keys',
                    r'used_memory_human:.*[0-9]+G'
                ],
                'cluster_issues': [
                    r'Redis.*CLUSTERDOWN.*Hash.*slot.*not.*served',
                    r'Redis.*MASTERDOWN.*Link.*with.*MASTER.*is.*down',
                    r'Redis.*master.*not.*found',
                    r'Redis.*slave.*not.*found',
                    r'Redis.*READONLY.*You.*can.*t.*write',
                    r'MOVED',
                    r'ASK'
                ],
                'persistence': [
                    r'Background save.*failed',
                    r'BGSAVE.*failed',
                    r'MISCONF.*RDB',
                    r'Asynchronous AOF.*failed',
                    r'AOF.*error'
                ],
                'performance': [
                    r'slowlog',
                    r'blocked_clients',
                    r'rejected_connections',
                    r'instantaneous_ops_per_sec.*[0-9]{5,}'
                ]
            },
            'nginx': {
                'upstream_errors': [
                    r'upstream.*failed',
                    r'no live upstreams',
                    r'upstream.*timeout',
                    r'connect.*failed.*upstream',
                    r'upstream prematurely closed',
                    r'upstream sent invalid header',
                    r'upstream sent too big header'
                ],
                'http_errors': [
                    r'" 502 ',
                    r'" 503 ',
                    r'" 504 ',
                    r'" 500 ',
                    r'" 499 ',  # Client closed connection
                    r'failed.*\(.*\)',
                    r'limiting requests',
                    r'limiting connections'
                ],
                'ssl_errors': [
                    r'SSL_do_handshake.*failed',
                    r'SSL.*certificate.*failed',
                    r'SSL.*error',
                    r'peer closed connection in SSL handshake',
                    r'SSL: error:.*certificate verify failed',
                    r'SSL_write.*failed',
                    r'SSL_read.*failed'
                ],
                'performance': [
                    r'request_time=[0-9]{2,}',
                    r'upstream_response_time=[0-9]{2,}',
                    r'request_time.*[0-9]{3,}\.',
                    r'upstream_response_time.*[0-9]{3,}\.'
                ],
                'client_errors': [
                    r'client.*closed.*keepalive connection',
                    r'client.*closed.*connection',
                    r'client.*timed out',
                    r'client intended to send too large body',
                    r'client sent invalid request'
                ]
            },
            'kubernetes': {
                'deployment_failures': [
                    r'Job failed: BackoffLimitExceeded',
                    r'UPGRADE FAILED:.*has no deployed releases',
                    r'UPGRADE FAILED: cannot patch.*with kind Deployment',
                    r'UPGRADE FAILED: type mismatch',
                    r'ImagePullBackOff',
                    r'ErrImagePull',
                    r'Failed to pull image',
                    r'CrashLoopBackOff',
                    r'CreateContainerConfigError',
                    r'InvalidImageName'
                ],
                'resource_issues': [
                    r'System OOM encountered, victim process',
                    r'Memory cgroup out of memory',
                    r'manifest unknown',
                    r'Insufficient cpu',
                    r'Insufficient memory',
                    r'pod has unbound immediate PersistentVolumeClaims',
                    r'no persistent volumes available'
                ],
                'network_issues': [
                    r'kex_exchange_identification: Connection closed by remote host',
                    r'Unable to connect to the server',
                    r'dial tcp.*connection refused',
                    r'dial tcp.*i/o timeout',
                    r'TLS handshake timeout'
                ]
            },
            'geo': {
                'configuration_errors': [
                    r'Geo secondary database is not configured',
                    r'Geo site has a database that is writable',
                    r'Geo.*tracking database.*not configured',
                    r'Geo.*node.*not found'
                ],
                'sync_errors': [
                    r'Repository cannot be checksummable',
                    r'File is not checksummable',
                    r'The file is missing on the Geo primary site',
                    r'"primary_missing_file"\s*:\s*true',
                    r'Verification timed out after',
                    r'@failed-geo-sync',
                    r'unexpected disconnect while reading sideband packet',
                    r'Geo.*sync.*failed',
                    r'Geo.*verification.*failed'
                ],
                'replication_lag': [
                    r'Geo.*replication.*lag',
                    r'Geo.*behind.*primary',
                    r'replication.*slot.*inactive'
                ]
            },
            'ssl': {
                'verification_errors': [
                    r'unable to get local issuer certificate',
                    r'unable to verify the first certificate',
                    r'certificate signed by unknown authority',
                    r'self signed certificate in certificate chain',
                    r'x509: certificate relies on legacy Common Name field',
                    r'SSL certificate problem',
                    r'certificate has expired',
                    r'certificate is not yet valid'
                ],
                'handshake_errors': [
                    r'SSL_connect returned=1 errno=0 state=error',
                    r'SSL: error:.*:x509 certificate routines',
                    r'transport: authentication handshake failed',
                    r'tls: failed to verify certificate',
                    r'TLS handshake error',
                    r'SSL handshake failed'
                ]
            }
        }
        
        # Determine which patterns to use
        if service.lower() == 'all':
            services_to_check = list(deep_patterns.keys())
        else:
            service_normalized = service.lower()
            if service_normalized in ['psql', 'postgres']:
                service_normalized = 'postgresql'
            elif service_normalized == 'puma':
                service_normalized = 'rails'
            
            if service_normalized not in deep_patterns:
                patterns = {
                    'errors': [r'ERROR', r'FAIL', r'Exception'],
                    'warnings': [r'WARN', r'WARNING'],
                    'critical': [r'FATAL', r'PANIC', r'CRITICAL']
                }
                services_to_check = [service_normalized]
            else:
                services_to_check = [service_normalized]
        
        # Results collection
        all_results = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        
        # Process each service
        for check_service in services_to_check:
            if check_service not in deep_patterns:
                continue
                
            patterns = deep_patterns[check_service]
            
            # Find log files
            log_mappings = {
                'postgresql': ['*/postgresql/*', '*postgres*.log*', '*psql*'],
                'sidekiq': ['*/sidekiq/*', '*sidekiq*.log*'],
                'gitaly': ['*/gitaly/*', '*gitaly*.log*', '*/praefect/*'],
                'rails': ['*/gitlab-rails/*', '*production*.log*', '*/puma/*'],
                'redis': ['*/redis/*', '*redis*.log*'],
                'nginx': ['*/nginx/*', '*nginx*.log*'],
                'kubernetes': ['*kube*.log*', '*k8s*.log*', '*helm*.log*'],
                'geo': ['*geo*.log*', '*secondary*.log*'],
                'ssl': ['*.log*', '*/current'],  # SSL issues can be anywhere
            }
            
            log_patterns = log_mappings.get(check_service, ['*.log*', '*/current'])
            log_files = []
            for pattern in log_patterns:
                log_files.extend(session_path.rglob(pattern))
            
            if not log_files:
                continue
            
            # Run ALL patterns
            for category, category_patterns in patterns.items():
                for pattern in category_patterns:
                    for log_file in log_files[:30]:
                        if not log_file.is_file():
                            continue
                        
                        try:
                            cmd = f"grep -E '{pattern}' {shlex.quote(str(log_file))} 2>/dev/null | head -100"
                            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                            
                            if result.stdout:
                                lines = result.stdout.strip().split('\n')
                                for line in lines[:50]:
                                    all_results[check_service][category][str(log_file.name)].append(line[:500])
                        except:
                            continue
        
        # OUTPUT RESULTS
        
        if service.lower() != 'all':
            # Single service analysis
            service_results = all_results.get(services_to_check[0], {})
            
            if not service_results:
                output.append(f"❌ No issues found in {service} logs")
                return '\n'.join(output)
            
            # Output all findings by category
            for category, files in service_results.items():
                total_in_category = sum(len(issues) for issues in files.values())
                if total_in_category > 0:
                    output.append(f"\n📌 {category.upper().replace('_', ' ')} ({total_in_category} found):")
                    output.append("-"*40)
                    
                    # Show samples from each file
                    for file_name, issues in list(files.items())[:5]:
                        output.append(f"\n📄 {file_name} ({len(issues)} issues):")
                        for issue in issues[:10]:
                            output.append(f"  {issue}")
        else:
            # Multi-service analysis
            output.append("📊 ALL SERVICES ANALYSIS:\n")
            
            for svc, results in all_results.items():
                total_issues = sum(sum(len(issues) for issues in files.values()) for files in results.values())
                if total_issues > 0:
                    output.append(f"\n🔍 {svc.upper()} ({total_issues} total issues):")
                    output.append("-"*40)
                    
                    # Show category breakdown
                    for category, files in results.items():
                        cat_total = sum(len(issues) for issues in files.values())
                        if cat_total > 0:
                            output.append(f"  • {category}: {cat_total}")
                            # Show one sample
                            for file_name, issues in files.items():
                                if issues:
                                    output.append(f"    → {issues[0][:150]}")
                                    break
        
        # STATISTICS
        output.append("\n📈 STATISTICS:")
        output.append("-"*40)
        
        total_all_issues = 0
        category_totals = defaultdict(int)
        service_totals = defaultdict(int)
        
        for svc, results in all_results.items():
            for category, files in results.items():
                count = sum(len(issues) for issues in files.values())
                category_totals[category] += count
                service_totals[svc] += count
                total_all_issues += count
        
        output.append(f"Total issues found: {total_all_issues}")
        
        if service_totals:
            output.append("\nBy Service:")
            for svc, count in sorted(service_totals.items(), key=lambda x: x[1], reverse=True):
                output.append(f"  {svc}: {count}")
        
        if category_totals and len(category_totals) > 1:
            output.append("\nTop Issue Categories:")
            for cat, count in sorted(category_totals.items(), key=lambda x: x[1], reverse=True)[:10]:
                output.append(f"  {cat}: {count}")
        
        return '\n'.join(output)

    def start(self, host: str = "0.0.0.0", port: int = 8080):
        """DEEP COMPREHENSIVE ANALYSIS - Everything about ANY service in ONE shot"""
        service = args.get('service', 'all')
        
        if not self.current_session:
            return "❌ No session selected"
        
        session_path = self.base_dir / self.current_session
        output = [f"🔬 DEEP DIVE ANALYSIS: {service.upper()}"]
        output.append("="*80)
        
        # COMPREHENSIVE patterns for ALL services
        deep_patterns = {
            'postgresql': {
                'slow_queries': [
                    r'duration: [1-9][0-9]{3,}\.\d+ ms',
                    r'LOG:.*duration: [1-9][0-9]{2,}\.\d+ ms.*(?:execute|statement)',
                    r'COPY.*FROM stdin',
                    r'INSERT.*VALUES.*\([0-9]{3,}',
                ],
                'locks': [
                    r'deadlock detected',
                    r'lock timeout',
                    r'waiting for.*lock',
                    r'canceling statement due to lock timeout',
                ],
                'connections': [
                    r'connection.*(?:received|authorized|authenticated)',
                    r'disconnection:',
                    r'FATAL:.*connection',
                    r'too many clients',
                ],
                'errors': [
                    r'ERROR:',
                    r'FATAL:',
                    r'PANIC:',
                    r'duplicate key value',
                ],
                'performance': [
                    r'temporary file:.*size [0-9]{7,}',
                    r'checkpoint.*complete',
                    r'autovacuum:',
                ]
            },
            'sidekiq': {
                'job_failures': [
                    r'retry: true',
                    r'retries_exhausted',
                    r'Job.*failed',
                    r'moved to dead',
                    r'ActiveJob::DeserializationError',
                    r'"status":"failed"',
                ],
                'memory': [
                    r'RSS:.*[0-9]{4,}.*MB',
                    r'OOM',
                    r'memory.*exceeded',
                    r'MemoryKiller',
                    r'sidekiq.*memory',
                ],
                'performance': [
                    r'job_duration.*[0-9]{5,}',
                    r'queue_latency.*[0-9]{3,}',
                    r'"duration":[0-9]{5,}',
                    r'elapsed.*[0-9]{4,}',
                ],
                'workers': [
                    r'Worker.*died',
                    r'Processor.*died',
                    r'Thread.*died',
                    r'heartbeat.*failed',
                ],
                'queues': [
                    r'queue:.*size.*[0-9]{4,}',
                    r'Enqueued:.*[0-9]{4,}',
                    r'queue.*stuck',
                    r'queue.*backlog',
                ]
            },
            'gitaly': {
                'grpc': [
                    r'code.*(?:Unavailable|DeadlineExceeded|Internal|ResourceExhausted)',
                    r'all SubCons are in TransientFailure',
                    r'transport is closing',
                    r'grpc.*error',
                ],
                'operations': [
                    r'.*Repository.*failed',
                    r'.*Branch.*failed',
                    r'.*Commit.*failed',
                    r'.*TreeEntry.*failed',
                    r'.*GetBlob.*failed',
                ],
                'replication': [
                    r'replication.*failed',
                    r'voting.*failed',
                    r'metadata.*inconsistent',
                    r'reconciliation.*failed',
                    r'praefect.*failed',
                ],
                'storage': [
                    r'storage.*unavailable',
                    r'no such file or directory',
                    r'permission denied',
                    r'disk.*full',
                    r'filesystem.*read-only',
                ],
                'connections': [
                    r'dial.*failed',
                    r'connection.*refused',
                    r'context deadline exceeded',
                    r'no healthy.*nodes',
                ]
            },
            'rails': {
                'http_errors': [
                    r'"status":5[0-9][0-9]',
                    r'"status":4[0-9][0-9]',
                    r'status=5[0-9][0-9]',
                    r'status=4[0-9][0-9]',
                ],
                'timeouts': [
                    r'Rack::Timeout',
                    r'execution expired',
                    r'Net::ReadTimeout',
                    r'"duration_s":[1-9][0-9]+',
                    r'queue_duration.*[1-9][0-9]{3,}',
                ],
                'database': [
                    r'ActiveRecord::ConnectionTimeoutError',
                    r'ActiveRecord::StatementInvalid',
                    r'ActiveRecord::Deadlocked',
                    r'PG::ConnectionBad',
                ],
                'memory': [
                    r'NoMemoryError',
                    r'Cannot allocate memory',
                    r'memory quota exceeded',
                    r'GC::OOM',
                ],
                'exceptions': [
                    r'ActionController::RoutingError',
                    r'ActionView::Template::Error',
                    r'NoMethodError',
                    r'StandardError',
                ]
            },
            'redis': {
                'connection': [
                    r'Redis::ConnectionError',
                    r'Redis::TimeoutError',
                    r'Redis::CannotConnectError',
                    r'Could not connect to Redis',
                ],
                'memory': [
                    r'OOM command not allowed',
                    r'maxmemory.*reached',
                    r'used_memory_human:.*[0-9]+G',
                    r'evicted_keys',
                ],
                'persistence': [
                    r'Background save',
                    r'BGSAVE.*failed',
                    r'MISCONF.*RDB',
                    r'Asynchronous AOF',
                ],
                'cluster': [
                    r'CLUSTERDOWN',
                    r'MASTERDOWN',
                    r'master.*not found',
                    r'READONLY',
                ],
                'performance': [
                    r'slowlog',
                    r'blocked_clients',
                    r'rejected_connections',
                    r'instantaneous_ops_per_sec',
                ]
            },
            'nginx': {
                'upstream': [
                    r'upstream.*failed',
                    r'no live upstreams',
                    r'upstream.*timeout',
                    r'connect.*failed.*upstream',
                ],
                'errors': [
                    r'" 502 ',
                    r'" 503 ',
                    r'" 504 ',
                    r'" 500 ',
                    r'failed.*\(.*\)',
                ],
                'ssl': [
                    r'SSL_do_handshake.*failed',
                    r'SSL.*certificate.*failed',
                    r'SSL.*error',
                    r'peer closed connection',
                ],
                'performance': [
                    r'request_time=[0-9]{2,}',
                    r'upstream_response_time=[0-9]{2,}',
                    r'limiting requests',
                    r'limiting connections',
                ],
                'access': [
                    r'" 4[0-9][0-9] ',
                    r'" 3[0-9][0-9] ',
                    r'request.*".*".*[0-9]{3}',
                ]
            },
            'registry': {
                'blob': [
                    r'blob.*unknown',
                    r'blob.*upload.*failed',
                    r'manifest.*unknown',
                    r'failed to.*blob',
                ],
                'auth': [
                    r'authorization.*failed',
                    r'authentication.*required',
                    r'token.*invalid',
                    r'unauthorized',
                ],
                'storage': [
                    r'storage.*error',
                    r'filesystem.*error',
                    r'failed to.*store',
                    r'quota.*exceeded',
                ],
                'api': [
                    r'API.*error',
                    r'handler.*error',
                    r'request.*failed',
                    r'response.*error',
                ]
            },
            'prometheus': {
                'scrape': [
                    r'scrape.*failed',
                    r'scrape.*error',
                    r'target.*down',
                    r'up.*0',
                ],
                'storage': [
                    r'storage.*error',
                    r'WAL.*error',
                    r'compaction.*failed',
                    r'chunks.*error',
                ],
                'memory': [
                    r'memory.*pressure',
                    r'heap.*bytes',
                    r'allocation.*failed',
                    r'OOM',
                ],
                'query': [
                    r'query.*error',
                    r'evaluation.*error',
                    r'timeout.*exceeded',
                    r'query.*slow',
                ]
            },
            'workhorse': {
                'upload': [
                    r'upload.*failed',
                    r'multipart.*error',
                    r'body.*too large',
                    r'upload.*timeout',
                ],
                'proxy': [
                    r'proxy.*error',
                    r'badgateway',
                    r'upstream.*error',
                    r'dial.*failed',
                ],
                'auth': [
                    r'authorization.*failed',
                    r'JWT.*invalid',
                    r'token.*expired',
                    r'forbidden',
                ],
                'performance': [
                    r'slow.*request',
                    r'timeout',
                    r'duration.*[0-9]{4,}',
                    r'elapsed.*[0-9]{4,}',
                ]
            }
        }
        
        # Determine which patterns to use
        if service.lower() == 'all':
            # For 'all', do a quick scan of each service
            services_to_check = list(deep_patterns.keys())
        else:
            # Normalize service name
            service_normalized = service.lower()
            if service_normalized in ['psql', 'postgres']:
                service_normalized = 'postgresql'
            elif service_normalized == 'puma':
                service_normalized = 'rails'
            
            if service_normalized not in deep_patterns:
                # Default to generic patterns
                patterns = {
                    'errors': [r'ERROR', r'FAIL', r'Exception'],
                    'warnings': [r'WARN', r'WARNING'],
                    'performance': [r'slow', r'timeout', r'duration.*[0-9]{4,}'],
                    'connections': [r'connection', r'refused', r'failed']
                }
                services_to_check = [service_normalized]
            else:
                patterns = deep_patterns[service_normalized]
                services_to_check = [service_normalized]
        
        # Comprehensive results collection
        all_results = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        
        # Process each service
        for check_service in services_to_check:
            if check_service not in deep_patterns:
                continue
                
            patterns = deep_patterns[check_service]
            
            # Find relevant log files for this service
            log_mappings = {
                'postgresql': ['*/postgresql/*', '*postgres*.log*', '*psql*'],
                'sidekiq': ['*/sidekiq/*', '*sidekiq*.log*'],
                'gitaly': ['*/gitaly/*', '*gitaly*.log*', '*/praefect/*'],
                'rails': ['*/gitlab-rails/*', '*production*.log*', '*/puma/*'],
                'redis': ['*/redis/*', '*redis*.log*'],
                'nginx': ['*/nginx/*', '*nginx*.log*'],
                'registry': ['*/registry/*', '*registry*.log*'],
                'prometheus': ['*/prometheus/*', '*prometheus*.log*'],
                'workhorse': ['*/gitlab-workhorse/*', '*workhorse*.log*'],
            }
            
            log_patterns = log_mappings.get(check_service, ['*.log*', '*/current'])
            log_files = []
            for pattern in log_patterns:
                log_files.extend(session_path.rglob(pattern))
            
            if not log_files:
                continue
            
            # Run comprehensive grep for each pattern category
            for category, category_patterns in patterns.items():
                for pattern in category_patterns:
                    for log_file in log_files[:20]:  # Limit for performance
                        if not log_file.is_file():
                            continue
                        
                        try:
                            cmd = f"grep -E '{pattern}' {shlex.quote(str(log_file))} 2>/dev/null | head -50"
                            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                            
                            if result.stdout:
                                lines = result.stdout.strip().split('\n')
                                for line in lines[:30]:
                                    all_results[check_service][category][str(log_file.name)].append(line[:400])
                        except:
                            continue
        
        # INTELLIGENT ANALYSIS FOR EACH SERVICE
        
        if service.lower() != 'all':
            # Single service deep analysis
            service_results = all_results.get(services_to_check[0], {})
            
            if not service_results:
                output.append(f"❌ No issues found in {service} logs")
                output.append("\n💡 This could mean:")
                output.append("  • Service is healthy")
                output.append("  • Logs are not in expected location")
                output.append("  • Service is not running")
                return '\n'.join(output)
            
            # Service-specific analysis
            if services_to_check[0] == 'postgresql':
                output.extend(self._analyze_postgresql_deep(service_results))
            elif services_to_check[0] == 'sidekiq':
                output.extend(self._analyze_sidekiq_deep(service_results))
            elif services_to_check[0] == 'gitaly':
                output.extend(self._analyze_gitaly_deep(service_results))
            elif services_to_check[0] == 'rails':
                output.extend(self._analyze_rails_deep(service_results))
            elif services_to_check[0] == 'redis':
                output.extend(self._analyze_redis_deep(service_results))
            elif services_to_check[0] == 'nginx':
                output.extend(self._analyze_nginx_deep(service_results))
            else:
                # Generic analysis for other services
                output.extend(self._analyze_generic_deep(services_to_check[0], service_results))
        else:
            # Multi-service analysis
            output.append("📊 MULTI-SERVICE DEEP ANALYSIS:\n")
            
            critical_services = []
            warning_services = []
            healthy_services = []
            
            for svc, results in all_results.items():
                issue_count = sum(len(files) for cat in results.values() for files in cat.values())
                if issue_count > 50:
                    critical_services.append((svc, issue_count))
                elif issue_count > 10:
                    warning_services.append((svc, issue_count))
                else:
                    healthy_services.append((svc, issue_count))
            
            if critical_services:
                output.append("🚨 CRITICAL SERVICES:")
                for svc, count in critical_services:
                    output.append(f"  ❌ {svc.upper()}: {count} issues")
            
            if warning_services:
                output.append("\n⚠️ WARNING SERVICES:")
                for svc, count in warning_services:
                    output.append(f"  ⚠️ {svc.upper()}: {count} issues")
            
            # Show top issues from each critical service
            for svc, _ in critical_services[:3]:
                output.append(f"\n🔍 {svc.upper()} TOP ISSUES:")
                svc_results = all_results[svc]
                for category, files in list(svc_results.items())[:2]:
                    output.append(f"  • {category.replace('_', ' ').title()}:")
                    for file_name, issues in list(files.items())[:1]:
                        output.append(f"    {issues[0][:200]}")
        
        return '\n'.join(output)

    def start(self, host: str = "0.0.0.0", port: int = 8080):
        """Start the server"""
        print(f"🚀 SMART GitLab MCP Server starting on http://{host}:{port}/mcp")
        print(f"📁 Base directory: {self.base_dir}")
        print(f"📌 Current session: {self.current_session or 'None'}")
        print(f"✨ AUTONOMOUS: One command gets everything!")
        print(f"🎯 NO EXCESSIVE QUERIES: Smart consolidated analysis")
        uvicorn.run(self.app, host=host, port=port)

def create_mcp_server(base_dir: str = "data/extracted") -> MCPUnixServer:
    """Factory function"""
    return MCPUnixServer(base_dir=base_dir)

if __name__ == "__main__":
    server = create_mcp_server()
    server.start()