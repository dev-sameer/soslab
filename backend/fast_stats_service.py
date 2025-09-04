#!/usr/bin/env python3
"""
FastStats Service
"""

import asyncio
import json
import subprocess
import platform
import os
from pathlib import Path
from typing import Dict, List, Optional, AsyncGenerator
from datetime import datetime

class FastStatsService:
    """Service to interact with fast-stats binary - PRODUCTION VERSION"""
    
    # ONLY THESE FILES ARE SUPPORTED BY FAST-STATS
    SUPPORTED_FILES = {
        'production_json': {
            'patterns': ['production_json.log', 'production.json.log'],
            'description': 'GitLab Rails production logs (JSON format)'
        },
        'api_json': {
            'patterns': ['api_json.log', 'api.json.log'],
            'description': 'GitLab API logs (JSON format)'
        },
        'gitaly': {
            'patterns': ['gitaly/current', 'gitaly.log'],
            'description': 'Gitaly service logs'
        },
        'sidekiq': {
            'patterns': ['sidekiq/current', 'sidekiq.log'],
            'description': 'Sidekiq background jobs logs'
        },
        'praefect': {
            'patterns': ['praefect/current', 'praefect.log'],
            'description': 'Praefect logs (if using Gitaly Cluster)'
        }
    }
    
    def __init__(self):
        self.binary_path = self._get_binary_path()
        self.active_analyses = {}
        self.results_cache = {}
        print(f"✅ FastStatsService initialized with binary: {self.binary_path}")
        
    def _get_binary_path(self) -> Path:
        """Get the appropriate fast-stats binary for the platform"""
        base_dir = Path(__file__).parent / "bin"
        
        system = platform.system().lower()
        machine = platform.machine().lower()
        
        # Map platform to binary name
        if system == "darwin":
            if machine == "arm64":
                binary_name = "fast-stats-darwin-arm64"
            else:
                binary_name = "fast-stats-darwin-x64"
        elif system == "linux":
            if machine in ["x86_64", "amd64"]:
                binary_name = "fast-stats-linux-x64"
            elif machine == "aarch64":
                binary_name = "fast-stats-linux-arm64"
            else:
                binary_name = "fast-stats-linux-x64"
        elif system == "windows":
            binary_name = "fast-stats-windows.exe"
        else:
            binary_name = "fast-stats"
        
        binary_path = base_dir / binary_name
        
        if not binary_path.exists():
            generic_path = base_dir / "fast-stats"
            if generic_path.exists():
                binary_path = generic_path
            else:
                raise FileNotFoundError(f"fast-stats binary not found: {binary_path}")
        
        # Ensure executable permissions on Unix
        if system != "windows":
            os.chmod(binary_path, 0o755)
            
        return binary_path
    
    def _find_supported_files(self, session_dir: Path) -> Dict[str, List[Dict]]:
        """Find ONLY files that fast-stats actually supports"""
        print(f"🔍 Searching for fast-stats compatible files in: {session_dir}")
        
        supported_files = {}
        total_found = 0
        
        # Walk through directory
        for root, dirs, files in os.walk(session_dir):
            root_path = Path(root)
            
            for file in files:
                file_path = root_path / file
                relative_path = file_path.relative_to(session_dir)
                
                # Skip if file is too small
                try:
                    if file_path.stat().st_size < 100:
                        continue
                except:
                    continue
                
                # Check against supported patterns
                for log_type, config in self.SUPPORTED_FILES.items():
                    for pattern in config['patterns']:
                        if str(relative_path).endswith(pattern) or pattern in str(relative_path):
                            if log_type not in supported_files:
                                supported_files[log_type] = []
                            
                            supported_files[log_type].append({
                                'path': file_path,
                                'relative_path': str(relative_path),
                                'size': file_path.stat().st_size,
                                'type': log_type
                            })
                            print(f"  ✅ Found {log_type}: {relative_path}")
                            total_found += 1
                            break
        
        print(f"📊 Found {total_found} fast-stats compatible files")
        return supported_files
    
    async def analyze_logs(
        self, 
        session_id: str,
        session_dir: Path,
        options: Optional[Dict] = None
    ) -> AsyncGenerator[Dict, None]:
        """Analyze ONLY supported log files with fast-stats"""
        options = options or {}
        
        # Find only supported files
        available_files = self._find_supported_files(session_dir)
        
        if not available_files:
            yield {
                'type': 'error',
                'message': 'No fast-stats compatible files found',
                'details': 'FastStats supports: production_json.log, api_json.log, gitaly/current, sidekiq/current, praefect/current'
            }
            return
        
        # Summary of what we found
        file_summary = {}
        for log_type, files in available_files.items():
            file_summary[log_type] = {
                'count': len(files),
                'description': self.SUPPORTED_FILES[log_type]['description'],
                'files': [f['relative_path'] for f in files]
            }
        
        yield {
            'type': 'info',
            'message': f'Found {sum(len(files) for files in available_files.values())} compatible files',
            'file_summary': file_summary
        }
        
        successful = 0
        failed = 0
        total_endpoints_found = 0
        
        # Process each file type
        for log_type, files in available_files.items():
            for file_info in files:
                file_path = file_info['path']
                
                yield {
                    'type': 'progress',
                    'message': f'Analyzing {file_info["relative_path"]}...',
                    'log_type': log_type,
                    'description': self.SUPPORTED_FILES[log_type]['description']
                }
                
                try:
                    # Build command - let fast-stats auto-detect format
                    cmd = [str(self.binary_path)]
                    
                    # Add options
                    # Add options
                    if options.get('sort_by'):
                        cmd.extend(['--sort-by', options['sort_by']])  # ✅ Correct argument
                    else:
                        cmd.extend(['--sort-by', 'score'])  # ✅ Correct argument
                        
                    if options.get('limit'):
                        cmd.extend(['--limit', str(options['limit'])])
                    else:
                        cmd.extend(['--limit', '50'])
                        
                    if options.get('interval'):
                        cmd.extend(['--interval', options['interval']])
                    
                    # Output format
                    cmd.extend(['--format', 'json'])
                    
                    # Add the file
                    cmd.append(str(file_path))
                    
                    print(f"🚀 Running: {' '.join(cmd)}")
                    
                    # Execute with timeout
                    process = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    try:
                        stdout, stderr = await asyncio.wait_for(
                            process.communicate(),
                            timeout=30.0  # 30 second timeout
                        )
                    except asyncio.TimeoutError:
                        process.kill()
                        yield {
                            'type': 'error',
                            'message': f'Analysis timeout for {file_info["relative_path"]}',
                            'details': 'File may be too large or complex'
                        }
                        failed += 1
                        continue
                    
                    if process.returncode != 0:
                        error_msg = stderr.decode().strip()
                        print(f"❌ Failed: {error_msg}")
                        
                        yield {
                            'type': 'error',
                            'message': f'Failed to analyze {file_info["relative_path"]}',
                            'details': error_msg
                        }
                        failed += 1
                        continue
                    
                    # Parse results
                    stdout_str = stdout.decode().strip()
                    if not stdout_str:
                        yield {
                            'type': 'warning',
                            'message': f'{file_info["relative_path"]} is empty or contains no analyzable data'
                        }
                        continue
                    
                    # Debug: Print first 200 chars of output
                    print(f"📝 Raw output (first 200 chars): {stdout_str[:200]}...")
                    
                    try:
                        # Parse JSON results
                        results = []
                        
                        # When using intervals, fast-stats outputs multiple JSON objects
                        # separated by interval headers like ">>> 2025-07-14 00:00:00 <<<"
                        current_interval = None
                        
                        for line in stdout_str.split('\n'):
                            line = line.strip()
                            if not line:
                                continue
                                
                            # Check for interval header
                            if line.startswith('>>>') and line.endswith('<<<'):
                                current_interval = line.strip('>>> ').strip(' <<<')
                            elif line.startswith('{'):
                                try:
                                    result_data = json.loads(line)
                                    if 'stats' in result_data:
                                        # Add interval info if using intervals
                                        if current_interval:
                                            result_data['interval'] = current_interval
                                        results.append(result_data)
                                except:
                                    pass
                        
                        # If no results with stats found, try parsing as single JSON
                        if not results and stdout_str.startswith('{'):
                            try:
                                single_result = json.loads(stdout_str)
                                if 'stats' in single_result:
                                    results = [single_result]
                            except:
                                pass
                        
                        # Debug logging
                        print(f"📊 Found {len(results)} result objects")
                        
                        # Process all results
                        all_processed = []
                        for result_data in results:
                            if 'stats' in result_data:
                                stats_data = result_data.get('stats', [])
                                interval = result_data.get('interval')
                                
                                print(f"  📈 Processing {len(stats_data)} stats entries")
                                
                                for stat in stats_data:
                                    processed = {
                                        'controller': stat.get('prim_field', 'Unknown'),
                                        'count': int(stat.get('count', 0)),
                                        'rps': float(stat.get('rps', 0.0)),
                                        'p99_ms': float(stat.get('p99', 0.0)),
                                        'p95_ms': float(stat.get('p95', 0.0)),
                                        'median_ms': float(stat.get('median', 0.0)),
                                        'max_ms': float(stat.get('max', 0.0)),
                                        'min_ms': float(stat.get('min', 0.0)),
                                        'score': float(stat.get('score', 0.0)),
                                        'fail_percentage': float(stat.get('perc_failed', 0.0))
                                    }
                                    if interval:
                                        processed['interval'] = interval
                                    all_processed.append(processed)
                        
                        if all_processed:
                            successful += 1
                            total_endpoints_found += len(all_processed)
                            
                            # Cache results
                            cache_key = f"{session_id}:{log_type}:{file_info['relative_path']}"
                            self.results_cache[cache_key] = all_processed
                            
                            yield {
                                'type': 'results',
                                'log_type': log_type,
                                'log_file': file_info['relative_path'],
                                'results': all_processed,
                                'count': len(all_processed),
                                'description': self.SUPPORTED_FILES[log_type]['description'],
                                'has_intervals': any('interval' in r for r in all_processed)
                            }
                            
                            print(f"✅ Success: {file_info['relative_path']} - {len(all_processed)} endpoints analyzed")
                        else:
                            yield {
                                'type': 'warning',
                                'message': f'No data found in {file_info["relative_path"]}'
                            }
                        
                    except json.JSONDecodeError as e:
                        print(f"❌ JSON parse error: {e}")
                        yield {
                            'type': 'error',
                            'message': f'Failed to parse results from {file_info["relative_path"]}',
                            'details': str(e)
                        }
                        failed += 1
                        
                except Exception as e:
                    print(f"❌ Unexpected error: {e}")
                    import traceback
                    traceback.print_exc()
                    yield {
                        'type': 'error',
                        'message': f'Unexpected error with {file_info["relative_path"]}',
                        'details': str(e)
                    }
                    failed += 1
        
        # Final summary
        yield {
            'type': 'complete',
            'message': 'Analysis complete!',
            'stats': {
                'successful': successful,
                'failed': failed,
                'total_files': successful + failed,
                'total_endpoints': total_endpoints_found,
                'supported_types': list(available_files.keys())
            }
        }
    
    def get_analysis_suggestions(self, session_id: str) -> List[Dict]:
        """Get intelligent suggestions based on cached results"""
        
        suggestions = []
        
        # Check cached results
        session_results = {
            k: v for k, v in self.results_cache.items() 
            if k.startswith(f"{session_id}:")
        }
        
        if not session_results:
            return [{
                'title': 'Start Performance Analysis',
                'description': 'Click "Run Analysis" to analyze GitLab performance logs',
                'action': 'analyze',
                'priority': 'high'
            }]
        
        # Analyze what we have
        has_slow_endpoints = False
        has_high_failures = False
        total_endpoints = 0
        
        for cache_key, results in session_results.items():
            total_endpoints += len(results)
            
            # Check for performance issues
            slow_endpoints = [r for r in results if r.get('p99_ms', 0) > 5000]
            if slow_endpoints:
                has_slow_endpoints = True
                
            # Check for failures
            failing_endpoints = [r for r in results if r.get('fail_percentage', 0) > 10]
            if failing_endpoints:
                has_high_failures = True
        
        # Generate suggestions
        if has_slow_endpoints:
            suggestions.append({
                'title': 'Performance Issues Detected',
                'description': 'Found endpoints with P99 > 5 seconds. Consider analyzing with time intervals.',
                'action': 'analyze',
                'options': {'interval': '1h'},
                'priority': 'high'
            })
        
        if has_high_failures:
            suggestions.append({
                'title': 'High Failure Rates',
                'description': 'Some endpoints have >10% failure rate. Review error logs for details.',
                'action': 'errors',
                'priority': 'high'
            })
        
        if total_endpoints > 100:
            suggestions.append({
                'title': 'Large Dataset',
                'description': 'Consider using top analysis to identify resource-heavy operations',
                'action': 'top',
                'priority': 'medium'
            })
        
        # Always suggest comparison if we have multiple nodes
        suggestions.append({
            'title': 'Compare Performance',
            'description': 'Compare with another session to identify performance regressions',
            'action': 'compare',
            'priority': 'medium'
        })
        
        return suggestions

    
    
    
    
    async def analyze_top_items(
        self,
        session_id: str,
        session_dir: Path,
        category: str = 'paths',
        options: Optional[Dict] = None
    ) -> AsyncGenerator[Dict, None]:
        """Analyze top resource consumers - PRODUCTION VERSION"""
        
        options = options or {}
        available_files = self._find_supported_files(session_dir)
        
        if not available_files:
            yield {
                'type': 'error',
                'message': 'No fast-stats compatible files found for top analysis'
            }
            return
        
        # Top analysis supports ALL file types (not just production/api)
        # Order by priority for best analysis results
        relevant_types = ['production_json', 'api_json', 'sidekiq', 'gitaly', 'praefect']
        files_to_analyze = []
        
        # Collect files in priority order
        for log_type in relevant_types:
            if log_type in available_files:
                files_to_analyze.extend(available_files[log_type])
        
        if not files_to_analyze:
            yield {
                'type': 'warning',
                'message': 'Top analysis requires supported log files (production_json, api_json, sidekiq, gitaly, or praefect)'
            }
            return
        
        # Report what files will be analyzed
        file_summary = {}
        for file_info in files_to_analyze:
            log_type = file_info['type']
            if log_type not in file_summary:
                file_summary[log_type] = []
            file_summary[log_type].append(file_info['relative_path'])
        
        yield {
            'type': 'info',
            'message': f'Starting top analysis on {len(files_to_analyze)} files',
            'file_summary': file_summary
        }
        
        successful_analyses = 0
        failed_analyses = 0
        
        # Process each file INDIVIDUALLY (no aggregation)
        for file_info in files_to_analyze:
            yield {
                'type': 'progress',
                'message': f'Analyzing top items in {file_info["relative_path"]}...',
                'log_type': file_info['type'],
                'description': self.SUPPORTED_FILES[file_info['type']]['description']
            }
            
            try:
                # Build top command with better error handling
                cmd = [str(self.binary_path), 'top']
                
                # Add options in correct order for TOP subcommand
                if options.get('limit'):
                    cmd.extend(['--limit', str(options.get('limit', 10))])
                else:
                    cmd.extend(['--limit', '10'])
                
                if options.get('sort_by'):
                    cmd.extend(['--sort-by', options['sort_by']])
                else:
                    cmd.extend(['--sort-by', 'duration'])
                
                if options.get('display'):
                    cmd.extend(['--display', options['display']])
                else:
                    cmd.extend(['--display', 'both'])
                
                # Don't use JSON format - parse the table output like CLI
                # File must be LAST
                cmd.append(str(file_info['path']))
                
                print(f"📊 Running top analysis: {' '.join(cmd)}")
                
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=45.0  # Increased timeout for larger files
                )
                
                if process.returncode != 0:
                    error_msg = stderr.decode().strip()
                    print(f"❌ Top analysis error for {file_info['relative_path']}: {error_msg}")
                    
                    # Better error categorization
                    if "not supported" in error_msg.lower():
                        yield {
                            'type': 'warning',
                            'message': f'Top analysis not supported for {file_info["relative_path"]} ({file_info["type"]})',
                            'details': f'File type {file_info["type"]} may not support top analysis'
                        }
                    else:
                        yield {
                            'type': 'error',
                            'message': f'Top analysis failed for {file_info["relative_path"]}',
                            'details': error_msg
                        }
                    failed_analyses += 1
                    continue
                
                # Parse results - always use table parsing for consistency
                stdout_str = stdout.decode().strip()
                print(f"📝 Top analysis output length: {len(stdout_str)} chars")
                # Don't truncate - we need to see the full output for debugging
                if len(stdout_str) < 5000:  # Only print if reasonable size
                    print(f"📝 Full output:\n{stdout_str}")
                else:
                    print(f"📝 Output too large ({len(stdout_str)} chars), showing first 2000:\n{stdout_str[:2000]}")
                
                if stdout_str:
                    # Parse the table format output
                    top_data = self._parse_top_table_format(stdout_str)
                    
                    # Send individual results (no aggregation)
                    if top_data and (top_data.get('paths') or top_data.get('projects') or top_data.get('users')):
                        yield {
                            'type': 'top_results',
                            'log_type': file_info['type'],  # INDIVIDUAL file type
                            'log_file': file_info['relative_path'],  # INDIVIDUAL file
                            'results': top_data,  # INDIVIDUAL results
                            'file_description': self.SUPPORTED_FILES[file_info['type']]['description']
                        }
                        
                        successful_analyses += 1
                        print(f"✅ Top analysis successful for {file_info['relative_path']} - found {len(top_data.get('paths', {}))} paths, {len(top_data.get('projects', {}))} projects, {len(top_data.get('users', {}))} users")
                    else:
                        # Debug what we got back
                        print(f"⚠️ No valid data parsed from {file_info['relative_path']}")
                        print(f"⚠️ Parsed data structure: paths={len(top_data.get('paths', {}))}, projects={len(top_data.get('projects', {}))}, users={len(top_data.get('users', {}))}")
                        
                        yield {
                            'type': 'warning',
                            'message': f'No top data found in {file_info["relative_path"]}',
                            'details': f'File may be empty or contain no analyzable top-level data'
                        }
                else:
                    yield {
                        'type': 'warning',
                        'message': f'Empty output from top analysis of {file_info["relative_path"]}'
                    }
                    
            except asyncio.TimeoutError:
                yield {
                    'type': 'error',
                    'message': f'Top analysis timeout for {file_info["relative_path"]}',
                    'details': 'Analysis took longer than 45 seconds - file may be very large'
                }
                failed_analyses += 1
            except Exception as e:
                print(f"❌ Exception in top analysis for {file_info['relative_path']}: {e}")
                import traceback
                traceback.print_exc()
                yield {
                    'type': 'error',
                    'message': f'Failed to analyze top items in {file_info["relative_path"]}',
                    'details': str(e)
                }
                failed_analyses += 1
        
        # Final summary with detailed stats
        yield {
            'type': 'complete',
            'message': 'Top analysis complete!',
            'stats': {
                'successful': successful_analyses,
                'failed': failed_analyses,
                'total_files': len(files_to_analyze),
                'file_types_analyzed': list(file_summary.keys())
            }
        }
    
    def _parse_top_table_format(self, output: str) -> Dict:
        """Parse table-formatted top output from fast-stats - PRODUCTION READY"""
        top_data = {
            'totals': {},
            'paths': {},
            'projects': {},
            'users': {},
            'clients': {}
        }
        
        try:
            lines = output.split('\n')
            current_section = None
            header_line = None
            data_lines_found = 0
            
            print(f"📋 Parsing {len(lines)} lines of top output")
            
            for i, line in enumerate(lines):
                # Keep original line for data parsing (don't strip for data detection)
                line_stripped = line.strip()
                
                # Skip truly empty lines
                if not line and not line_stripped:
                    continue
                
                # Detect sections - format is "Top N {Type} by {Field} -- Values / Percentages"
                if line_stripped.startswith('Top ') and ' by ' in line_stripped:
                    # Parse section type from the header
                    if 'Path' in line_stripped:
                        current_section = 'paths'
                    elif 'Project' in line_stripped:
                        current_section = 'projects'
                    elif 'User' in line_stripped:
                        current_section = 'users'
                    elif 'Client' in line_stripped:
                        current_section = 'clients'
                    
                    print(f"📍 Found {current_section} section at line {i}: {line_stripped}")
                    header_line = None
                    continue
                
                # Detect totals section
                if line_stripped == 'Totals':
                    current_section = 'totals'
                    print(f"📍 Found totals section at line {i}")
                    continue
                
                # Parse totals section
                if current_section == 'totals' and ':' in line_stripped and not line.startswith(' '):
                    parts = line_stripped.split(':', 1)
                    if len(parts) == 2:
                        key = parts[0].strip().upper()  # Uppercase for consistency
                        value = parts[1].strip()
                        
                        # Convert totals to proper numeric format
                        if key == 'COUNT':
                            top_data['totals']['count'] = int(value.replace(',', ''))
                        elif key in ['DUR', 'DURATION']:
                            top_data['totals']['duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['DB']:
                            top_data['totals']['db_duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['REDIS']:
                            top_data['totals']['redis_duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['GITALY']:
                            top_data['totals']['gitaly_duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['RUGGED']:
                            top_data['totals']['rugged_duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['QUEUE']:
                            top_data['totals']['queue_duration'] = self._parse_duration_to_seconds(value)
                        elif key in ['CPU']:
                            top_data['totals']['cpu_s'] = self._parse_duration_to_seconds(value)
                        elif key in ['MEM']:
                            top_data['totals']['mem_b'] = self._parse_memory_to_bytes(value)
                        elif key in ['GIT_RSS']:
                            top_data['totals']['git_rss'] = self._parse_memory_to_bytes(value)
                        elif key in ['BYTES', 'RESP_BYTES']:
                            top_data['totals']['resp_bytes'] = self._parse_memory_to_bytes(value)
                        elif key == 'DISK_R':
                            top_data['totals']['disk_r'] = int(value.replace(',', ''))
                        elif key == 'DISK_W':
                            top_data['totals']['disk_w'] = int(value.replace(',', ''))
                        elif key == 'FAIL_CT':
                            top_data['totals']['fails'] = int(value.replace(',', ''))
                        elif key == 'RPS':
                            top_data['totals']['rps'] = float(value)
                
                # Parse data rows in top sections
                elif current_section in ['paths', 'projects', 'users', 'clients']:
                    # Look for header line (contains column names)
                    if any(h in line.upper() for h in ['COUNT', 'RPS', 'DUR', 'PATH', 'PROJECT', 'USER', 'CLIENT']) and 'VALUES' not in line.upper():
                        # This is likely the header line
                        if '/' not in line:  # Headers don't have value/percent pairs
                            header_line = line
                            print(f"📋 Found header at line {i}: {line[:100]}")
                            continue
                    
                    # Data lines characteristics:
                    # 1. Contain "/" for value/percent pairs
                    # 2. Have multiple numeric values
                    # 3. Are not separator lines (all dashes)
                    # 4. The name part starts at the beginning (but might have some indent)
                    
                    # Don't check for leading whitespace - data rows might be slightly indented
                    if '/' in line and line.count('/') >= 2 and not line.strip().startswith('-'):
                        # Also skip lines that look like headers
                        if 'VALUES' in line.upper() or 'PERCENTAGES' in line.upper():
                            continue
                            
                        parsed_row = self._parse_cli_data_row(line, current_section, header_line)
                        if parsed_row and parsed_row['name']:
                            name = parsed_row['name']
                            data_lines_found += 1
                            
                            # Store in appropriate section
                            if current_section == 'clients':
                                # Map clients to users for compatibility
                                if 'users' not in top_data:
                                    top_data['users'] = {}
                                top_data['users'][name] = parsed_row
                            else:
                                if current_section not in top_data:
                                    top_data[current_section] = {}
                                top_data[current_section][name] = parsed_row
                            
                            # Log first few successful parses
                            if data_lines_found <= 3:
                                # Count non-zero numeric fields (skip string fields like 'name')
                                numeric_fields = ['count', 'duration', 'db_time', 'redis_time', 'gitaly_time', 
                                                'rugged_time', 'queue_time', 'cpu_time', 'mem_bytes', 'git_rss', 
                                                'resp_bytes', 'disk_r', 'disk_w', 'fail_count']
                                non_zero_count = sum(1 for k in numeric_fields if parsed_row.get(k, 0) > 0)
                                print(f"✅ Parsed data row {data_lines_found}: {name} with {non_zero_count} non-zero fields")
                        else:
                            if '/' in line and not line.strip().startswith('-') and data_lines_found < 5:
                                print(f"⚠️ Failed to parse potential data row at line {i}: {line}")
            
            print(f"📊 Parsing complete - found {data_lines_found} data rows")
            print(f"📊 Results: {len(top_data.get('paths', {}))} paths, {len(top_data.get('projects', {}))} projects, {len(top_data.get('users', {}))} users, {len(top_data.get('clients', {}))} clients")
            
            # Log totals if found
            if top_data['totals']:
                print(f"📊 Totals: {top_data['totals']}")
            
            return top_data
            
        except Exception as e:
            print(f"❌ Failed to parse table format: {e}")
            import traceback
            traceback.print_exc()
            return top_data
    
    def _parse_cli_data_row(self, line: str, section_type: str, header_line: Optional[str] = None) -> Optional[Dict]:
        """Parse a single CLI data row with proper column extraction"""
        try:
            import re
            
            # The CLI output format: NAME    COUNT / %   RPS / %   DUR / %   ...
            # Data rows might have some indentation but less than headers
            if not line or not line.strip():
                return None
            
            # Debug the line for first few attempts
            if '/' in line and line.strip()[:1] not in ['-']:
                print(f"🔍 Attempting to parse line: {line}")
            
            # Find the first number followed by spaces and a slash
            # This pattern should match something like "1234 / 56"
            match = re.search(r'\s+(\d+)\s+/\s+\d+', line)
            if not match:
                if '/' in line and not line.strip().startswith('-'):
                    print(f"⚠️ No value/percent pattern found in potential data line")
                return None
            
            name_end = match.start()
            name = line[:name_end].strip()
            data_part = line[name_end:].strip()
            
            if not name:
                print(f"⚠️ No name extracted from line")
                return None
            
            print(f"✅ Extracted name: '{name}', data starts at position {name_end}")
            
            # Now parse all value/percent pairs
            # Updated pattern to be more flexible with spacing
            value_pattern = r'(\S+)\s*/\s*(\S+)'
            matches = list(re.finditer(value_pattern, data_part))
            
            print(f"📊 Found {len(matches)} value/percent pairs")
            
            parsed_values = []
            for i, match in enumerate(matches):
                value_str = match.group(1).strip()
                percent_str = match.group(2).strip()
                
                # Parse the value based on its format
                if any(unit in value_str for unit in ['ms', 's', 'm', 'h', 'd']):
                    # Duration value
                    value = self._parse_duration_to_seconds(value_str)
                elif any(unit in value_str.upper() for unit in ['GIB', 'MIB', 'KIB', 'GB', 'MB', 'KB', 'B']):
                    # Memory value
                    value = self._parse_memory_to_bytes(value_str)
                else:
                    # Numeric value
                    try:
                        if '.' in value_str:
                            value = float(value_str.replace(',', ''))
                        else:
                            value = int(value_str.replace(',', ''))
                    except:
                        print(f"⚠️ Failed to parse numeric value: {value_str}")
                        value = 0
                
                # Parse percentage
                try:
                    percent = float(percent_str.strip('%'))
                except:
                    percent = 0
                
                parsed_values.append((value, percent))
                
                # Debug first few values
                if i < 3:
                    print(f"  Value {i}: {value_str} -> {value}, {percent_str} -> {percent}%")
            
            # Initialize result with all fields
            result = {
                'name': name,
                'count': 0,
                'count_percent': 0,
                'duration': 0,
                'duration_percent': 0,
                'db_time': 0,
                'db_percent': 0,
                'redis_time': 0,
                'redis_percent': 0,
                'gitaly_time': 0,
                'gitaly_percent': 0,
                'rugged_time': 0,
                'rugged_percent': 0,
                'queue_time': 0,
                'queue_percent': 0,
                'cpu_time': 0,
                'cpu_percent': 0,
                'mem_bytes': 0,
                'mem_percent': 0,
                'git_rss': 0,
                'resp_bytes': 0,
                'disk_r': 0,
                'disk_w': 0,
                'fail_count': 0,
                'fail_percent': 0
            }
            
            # Map values based on expected column order
            # The order from fast-stats is: COUNT, RPS, DUR, then varies by log type
            
            # COUNT is always first
            if len(parsed_values) > 0:
                result['count'] = int(parsed_values[0][0])
                result['count_percent'] = parsed_values[0][1]
            
            # RPS is second (we skip it as it's not stored in our structure)
            
            # DUR is third
            if len(parsed_values) > 2:
                result['duration'] = parsed_values[2][0]
                result['duration_percent'] = parsed_values[2][1]
            
            # Remaining columns depend on the log type
            # Use header or totals to determine format
            if header_line and 'GIT_RSS' in header_line.upper():
                # Gitaly format
                self._parse_gitaly_columns(parsed_values, result)
            elif header_line and 'QUEUE' in header_line.upper():
                # Sidekiq format
                self._parse_sidekiq_columns(parsed_values, result)
            else:
                # Default to Rails format (production/api)
                self._parse_rails_columns(parsed_values, result)
            
            print(f"✅ Successfully parsed: {name} with count={result['count']}, duration={result['duration']}")
            return result
            
        except Exception as e:
            print(f"❌ Failed to parse CLI row: {line[:100]}... Error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _parse_rails_columns(self, parsed_values, result):
        """Parse Rails log format columns (production/api)"""
        # Format: COUNT, RPS, DUR, DB, REDIS, GITALY, [RUGGED], CPU, MEM, FAIL_CT
        if len(parsed_values) > 3:
            result['db_time'] = parsed_values[3][0]
            result['db_percent'] = parsed_values[3][1]
        if len(parsed_values) > 4:
            result['redis_time'] = parsed_values[4][0]
            result['redis_percent'] = parsed_values[4][1]
        if len(parsed_values) > 5:
            result['gitaly_time'] = parsed_values[5][0]
            result['gitaly_percent'] = parsed_values[5][1]
        
        # Check if we have RUGGED column (optional)
        remaining = len(parsed_values) - 6
        if remaining >= 4:  # Has RUGGED + CPU + MEM + FAIL
            result['rugged_time'] = parsed_values[6][0]
            result['rugged_percent'] = parsed_values[6][1]
            cpu_idx = 7
        else:  # No RUGGED
            cpu_idx = 6
        
        if len(parsed_values) > cpu_idx:
            result['cpu_time'] = parsed_values[cpu_idx][0]
            result['cpu_percent'] = parsed_values[cpu_idx][1]
        if len(parsed_values) > cpu_idx + 1:
            result['mem_bytes'] = int(parsed_values[cpu_idx + 1][0])
            result['mem_percent'] = parsed_values[cpu_idx + 1][1]
        if len(parsed_values) > cpu_idx + 2:
            result['fail_count'] = int(parsed_values[cpu_idx + 2][0])
            result['fail_percent'] = parsed_values[cpu_idx + 2][1]
    
    def _parse_sidekiq_columns(self, parsed_values, result):
        """Parse Sidekiq log format columns"""
        # Format: COUNT, RPS, DUR, DB, REDIS, GITALY, QUEUE, CPU, MEM, FAIL_CT
        if len(parsed_values) > 3:
            result['db_time'] = parsed_values[3][0]
            result['db_percent'] = parsed_values[3][1]
        if len(parsed_values) > 4:
            result['redis_time'] = parsed_values[4][0]
            result['redis_percent'] = parsed_values[4][1]
        if len(parsed_values) > 5:
            result['gitaly_time'] = parsed_values[5][0]
            result['gitaly_percent'] = parsed_values[5][1]
        if len(parsed_values) > 6:
            result['queue_time'] = parsed_values[6][0]
            result['queue_percent'] = parsed_values[6][1]
        if len(parsed_values) > 7:
            result['cpu_time'] = parsed_values[7][0]
            result['cpu_percent'] = parsed_values[7][1]
        if len(parsed_values) > 8:
            result['mem_bytes'] = int(parsed_values[8][0])
            result['mem_percent'] = parsed_values[8][1]
        if len(parsed_values) > 9:
            result['fail_count'] = int(parsed_values[9][0])
            result['fail_percent'] = parsed_values[9][1]
    
    def _parse_gitaly_columns(self, parsed_values, result):
        """Parse Gitaly log format columns"""
        # Format: COUNT, RPS, DUR, CPU, GIT_RSS, RESP_BYTES, DISK_R, DISK_W, FAIL_CT
        if len(parsed_values) > 3:
            result['cpu_time'] = parsed_values[3][0]
            result['cpu_percent'] = parsed_values[3][1]
        if len(parsed_values) > 4:
            result['git_rss'] = int(parsed_values[4][0])
        if len(parsed_values) > 5:
            result['resp_bytes'] = int(parsed_values[5][0])
        if len(parsed_values) > 6:
            result['disk_r'] = int(parsed_values[6][0])
        if len(parsed_values) > 7:
            result['disk_w'] = int(parsed_values[7][0])
        if len(parsed_values) > 8:
            result['fail_count'] = int(parsed_values[8][0])
            result['fail_percent'] = parsed_values[8][1]
    
    def _parse_duration_to_seconds(self, duration_str: str) -> float:
        """Convert duration strings like '9m20.6s' to seconds"""
        try:
            duration_str = duration_str.strip()
            total_seconds = 0.0
            
            import re
            
            # Handle formats like "9m20.6s", "1h30m", "45.5s", "22m18.8s"
            hours = re.findall(r'(\d+(?:\.\d+)?)h', duration_str)
            if hours:
                total_seconds += float(hours[0]) * 3600
            
            minutes = re.findall(r'(\d+(?:\.\d+)?)m', duration_str)
            if minutes:
                total_seconds += float(minutes[0]) * 60
            
            seconds = re.findall(r'(\d+(?:\.\d+)?)s', duration_str)
            if seconds:
                total_seconds += float(seconds[0])
            
            # If no units found, assume it's already in seconds
            if total_seconds == 0.0 and duration_str.replace('.', '').replace(',', '').isdigit():
                total_seconds = float(duration_str.replace(',', ''))
            
            return total_seconds
            
        except Exception as e:
            print(f"❌ Failed to parse duration: {duration_str}")
            return 0.0
    
    def _parse_memory_to_bytes(self, memory_str: str) -> int:
        """Convert memory strings like '5.01 GiB' to bytes"""
        try:
            memory_str = memory_str.strip().upper()
            
            import re
            match = re.match(r'(\d+(?:\.\d+)?)\s*([KMGT]?I?B)', memory_str)
            if not match:
                return 0
            
            value = float(match.group(1))
            unit = match.group(2)
            
            multipliers = {
                'B': 1,
                'KB': 1000, 'KIB': 1024,
                'MB': 1000**2, 'MIB': 1024**2,
                'GB': 1000**3, 'GIB': 1024**3,
                'TB': 1000**4, 'TIB': 1024**4
            }
            
            return int(value * multipliers.get(unit, 1))
            
        except Exception as e:
            print(f"❌ Failed to parse memory: {memory_str}")
            return 0
    
    async def analyze_errors(
        self,
        session_id: str,
        session_dir: Path,
        options: Optional[Dict] = None
    ) -> AsyncGenerator[Dict, None]:
        """Analyze errors in supported logs"""
        
        available_files = self._find_supported_files(session_dir)
        
        if not available_files:
            yield {
                'type': 'error',
                'message': 'No fast-stats compatible files found for error analysis'
            }
            return
        
        total_errors_found = 0
        
        # Process all supported file types
        for log_type, files in available_files.items():
            for file_info in files:
                yield {
                    'type': 'progress',
                    'message': f'Analyzing errors in {file_info["relative_path"]}...'
                }
                
                try:
                    # Build command - errors subcommand
                    cmd = [
                        str(self.binary_path),
                        'errors',
                        '--format', 'json',
                        str(file_info['path'])
                    ]
                    
                    print(f"🚨 Running error analysis: {' '.join(cmd)}")
                    
                    process = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(),
                        timeout=30.0
                    )
                    
                    if process.returncode != 0:
                        error_msg = stderr.decode()
                        if "no errors found" in error_msg.lower():
                            yield {
                                'type': 'info',
                                'message': f'No errors found in {file_info["relative_path"]} ✨'
                            }
                        else:
                            yield {
                                'type': 'error',
                                'message': f'Error analysis failed for {file_info["relative_path"]}',
                                'details': error_msg
                            }
                        continue
                    
                    stdout_str = stdout.decode().strip()
                    print(f"📝 Error analysis output (first 500 chars): {stdout_str[:500]}...")
                    
                    if stdout_str:
                        try:
                            # Try JSON parsing first
                            errors = []
                            json_parsed = False
                            
                            # Try to parse as JSON lines
                            for line in stdout_str.split('\n'):
                                if line.strip():
                                    try:
                                        error_data = json.loads(line)
                                        errors.append(error_data)
                                        json_parsed = True
                                    except json.JSONDecodeError:
                                        continue
                            
                            # If JSON parsing failed, parse table format
                            if not json_parsed and stdout_str:
                                errors = self._parse_table_errors(stdout_str)
                            
                            if errors:
                                total_errors_found += len(errors)
                                yield {
                                    'type': 'error_results',
                                    'log_type': log_type,
                                    'log_file': file_info['relative_path'],
                                    'results': errors,
                                    'count': len(errors)
                                }
                            else:
                                yield {
                                    'type': 'info',
                                    'message': f'No errors found in {file_info["relative_path"]}'
                                }
                        except Exception as e:
                            print(f"❌ Error parsing results: {e}")
                            yield {
                                'type': 'warning',
                                'message': f'Could not parse error results from {file_info["relative_path"]}',
                                'details': str(e)
                            }
                            
                except asyncio.TimeoutError:
                    yield {
                        'type': 'error',
                        'message': f'Error analysis timeout for {file_info["relative_path"]}'
                    }
                except Exception as e:
                    print(f"❌ Exception in error analysis: {e}")
                    yield {
                        'type': 'error',
                        'message': f'Failed to analyze errors',
                        'details': str(e)
                    }
        
        yield {
            'type': 'complete',
            'message': 'Error analysis complete',
            'total_errors': total_errors_found
        }
    
    def _parse_table_errors(self, output: str) -> List[Dict]:
        """Parse table-formatted error output from fast-stats"""
        errors = []
        
        try:
            lines = output.split('\n')
            current_error = None
            events = []
            
            for line in lines:
                line = line.strip()
                
                # Look for error title (starts with │Error:)
                if line.startswith('│Error:') and 'Error:' in line:
                    # Save previous error if exists
                    if current_error:
                        current_error['events'] = events
                        errors.append(current_error)
                    
                    # Extract error message
                    error_msg = line.split('Error:', 1)[1].strip('│ ')
                    current_error = {
                        'error': 'GitLab Error',
                        'message': error_msg,
                        'count': 0,
                        'backtrace': [],
                        'events': []
                    }
                    events = []
                
                # Look for count (│Count: X│)
                elif line.startswith('│Count:') and current_error:
                    try:
                        count_str = line.split('Count:', 1)[1].strip('│ ')
                        current_error['count'] = int(count_str)
                    except:
                        pass
                
                # Look for event data (contains timestamps)
                elif '2025-' in line and current_error:  # Assuming 2025 timestamps
                    # Parse event line: TIME CORR_ID ACTION USER PROJECT
                    parts = line.strip('│ ').split()
                    if len(parts) >= 3:
                        event = {
                            'timestamp': parts[0] if len(parts) > 0 else '',
                            'correlation_id': parts[1] if len(parts) > 1 else '',
                            'action': parts[2] if len(parts) > 2 else '',
                            'user': parts[3] if len(parts) > 3 else '-',
                            'project': parts[4] if len(parts) > 4 else ''
                        }
                        events.append(event)
            
            # Don't forget the last error
            if current_error:
                current_error['events'] = events
                errors.append(current_error)
            
            print(f"📊 Parsed {len(errors)} errors from table format")
            return errors
            
        except Exception as e:
            print(f"❌ Failed to parse table format: {e}")
            return []
    
    async def compare_logs(
        self,
        session_id1: str,
        session_dir1: Path,
        session_id2: str, 
        session_dir2: Path,
        log_type: str,
        options: Optional[Dict] = None
    ) -> AsyncGenerator[Dict, None]:
        """Compare performance between two sessions"""
        
        # Find files in both sessions
        files1 = self._find_supported_files(session_dir1)
        files2 = self._find_supported_files(session_dir2)
        
        if log_type not in files1 or log_type not in files2:
            yield {
                'type': 'error',
                'message': f'Log type {log_type} not found in both sessions',
                'details': f'Session 1 has: {list(files1.keys())}, Session 2 has: {list(files2.keys())}'
            }
            return
        
        file1 = files1[log_type][0]['path']
        file2 = files2[log_type][0]['path']
        
        # Build comparison command
        cmd = [
            str(self.binary_path),
            '--compare', str(file2),
            '--format', 'json'
        ]
        
        if options and options.get('limit'):
            cmd.extend(['--limit', str(options['limit'])])
        else:
            cmd.extend(['--limit', '20'])
        
        cmd.append(str(file1))
        
        print(f"🔄 Running comparison: {' '.join(cmd)}")
        
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=60.0  # Longer timeout for comparison
            )
            
            if process.returncode != 0:
                yield {
                    'type': 'error',
                    'message': 'Comparison failed',
                    'details': stderr.decode()
                }
                return
            
            # Parse results
            results = []
            stdout_str = stdout.decode().strip()
            
            for line in stdout_str.split('\n'):
                if line.strip():
                    try:
                        results.append(json.loads(line))
                    except:
                        pass
            
            yield {
                'type': 'comparison_results',
                'results': results,
                'baseline_session': session_id1,
                'compare_session': session_id2,
                'log_type': log_type
            }
            
        except asyncio.TimeoutError:
            yield {
                'type': 'error',
                'message': 'Comparison timeout - files may be too large'
            }
        except Exception as e:
            yield {
                'type': 'error',
                'message': f'Comparison error: {str(e)}'
            }