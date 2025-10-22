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
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import re
from datetime import datetime
import json

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



class SystemMetricsParser:
    """Parse system command outputs with surgical precision"""
    
    def __init__(self, session_dir: Path):
        self.session_dir = session_dir
        self.root = self._find_root()
        self.parsing_errors = []
    
    def _find_root(self) -> Path:
        """Find the actual root directory containing command outputs"""
        marker_files = ['vmstat', 'top_cpu', 'free_m', 'uptime', 'iostat', 'ps']
        
        # Check current directory first
        for marker in marker_files:
            if (self.session_dir / marker).exists():
                print(f"✓ Found command files in: {self.session_dir}")
                return self.session_dir
        
        # Recursively search subdirectories
        def search_dir(path, depth=0, max_depth=3):
            if depth > max_depth:
                return None
            
            for item in path.iterdir():
                if item.is_dir():
                    for marker in marker_files:
                        if (item / marker).exists():
                            print(f"✓ Found command files in: {item}")
                            return item
                    
                    result = search_dir(item, depth + 1, max_depth)
                    if result:
                        return result
            return None
        
        found_root = search_dir(self.session_dir)
        if found_root:
            return found_root
        
        # Check common directory names
        for dirname in ['gitlabsos', 'sosreport', 'logs', 'system']:
            test_dir = self.session_dir / dirname
            if test_dir.exists():
                print(f"✓ Using {dirname} directory: {test_dir}")
                return test_dir
        
        print(f"⚠ Using session dir: {self.session_dir}")
        return self.session_dir
    
    def parse_all(self) -> Dict:
        """Parse all available command outputs with enhanced accuracy"""
        available_commands = self._discover_commands()
        parsed_data = {}
        
        for cmd_name, file_path in available_commands.items():
            try:
                parser_method = getattr(self, f"_parse_{cmd_name}", self._parse_generic)
                parsed_data[cmd_name] = parser_method(file_path)
                
                # Add metadata for validation
                parsed_data[cmd_name]['_meta'] = {
                    'source_file': str(file_path),
                    'parsed_at': datetime.now().isoformat(),
                    'file_size': file_path.stat().st_size if file_path.exists() else 0
                }
                
            except Exception as e:
                print(f"⚠️ Failed to parse {cmd_name}: {e}")
                self.parsing_errors.append({'command': cmd_name, 'error': str(e)})
                parsed_data[cmd_name] = {
                    "error": str(e),
                    "raw_output": self._safe_read(file_path)[:10000]  # Limit size
                }
        
        return {
            "available_commands": list(available_commands.keys()),
            "parsed_data": parsed_data,
            "parsing_errors": self.parsing_errors,
            "timestamp": datetime.now().isoformat()
        }
    
    def _discover_commands(self) -> Dict[str, Path]:
        """Enhanced command discovery with multiple search strategies"""
        commands = [
            'top_cpu', 'top_res', 'free_m', 'vmstat', 'uptime',
            'iostat', 'iotop', 'df_hT', 'df_inodes', 'lsblk',
            'ps', 'pidstat', 'netstat', 'netstat_i', 'sockstat', 
            'ss', 'mpstat', 'sar_cpu', 'lscpu', 'meminfo', 
            'slabtop', 'sar_mem', 'uname', 'hostname', 'date', 
            'dmesg', 'ifconfig', 'ip_address', 'sysctl_a', 
            'ulimit', 'systemctl_unit_files', 'sar_dev', 
            'sar_tcp', 'nfsiostat', 'mount', 'fstab'
        ]
        
        available = {}
        
        # Try multiple strategies
        for cmd in commands:
            # Direct path
            if (path := self.root / cmd).exists():
                available[cmd] = path
                continue
            
            # With extensions
            for ext in ['.txt', '.log', '.out']:
                if (path := self.root / f"{cmd}{ext}").exists():
                    available[cmd] = path
                    break
            
            if cmd in available:
                continue
                
            # In subdirectories
            for subdir in ['system', 'commands', 'output', 'data', 'sos_commands']:
                if (path := self.root / subdir / cmd).exists():
                    available[cmd] = path
                    break
        
        # Broad search if needed
        if len(available) < 3:
            print(f"⚠ Limited commands found, searching broadly...")
            for cmd in commands:
                if cmd not in available:
                    matches = list(self.session_dir.rglob(f"{cmd}*"))
                    if matches:
                        available[cmd] = matches[0]
                        print(f"  Found {cmd} at: {matches[0]}")
        
        print(f"✅ Discovered {len(available)} command outputs")
        return available
    
    def _safe_read(self, file_path: Path) -> str:
        """Safely read file with encoding detection"""
        if not file_path.exists():
            return ""
        
        # Try different encodings
        for encoding in ['utf-8', 'latin-1', 'ascii']:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    return f.read()
            except UnicodeDecodeError:
                continue
        
        # Last resort: binary read with replacement
        try:
            with open(file_path, 'rb') as f:
                return f.read().decode('utf-8', errors='replace')
        except:
            return ""
    
    def _safe_float(self, value: str, default: float = 0.0) -> float:
        """Convert string to float with comprehensive error handling"""
        if not value:
            return default
        
        # Clean the value
        value = str(value).strip()
        
        # Handle special cases
        if value in ['.', '..', '-', '--', 'N/A', 'n/a', 'NA', 'null', 'none', '']:
            return default
        
        # Remove any non-numeric characters except . and -
        cleaned = re.sub(r'[^0-9.-]', '', value)
        
        # Handle multiple dots
        if cleaned.count('.') > 1:
            # Keep only first dot
            parts = cleaned.split('.')
            cleaned = parts[0] + '.' + ''.join(parts[1:])
        
        try:
            result = float(cleaned)
            # Sanity check for percentages
            if 'percent' in str(value).lower() and result > 100:
                return min(result, 100.0)
            return result
        except (ValueError, AttributeError):
            return default
    
    def _safe_int(self, value: str, default: int = 0) -> int:
        """Convert string to int with error handling"""
        try:
            # Remove any unit suffixes
            value = str(value).strip()
            value = re.sub(r'[^0-9-]', '', value)
            return int(value) if value else default
        except (ValueError, AttributeError):
            return default
    
    def _parse_top_res(self, file_path: Path) -> Dict:
      """Parse top sorted by RES (memory) - same as top_cpu but different sort"""
      # Use the same parser as top_cpu since format is identical
      result = self._parse_top_cpu(file_path)
    
      # Mark that this was sorted by RES
      result['_sort_by'] = 'RES'
    
      # Re-sort processes by memory if we have them
      if result.get('processes'):
          # Sort by mem percentage if available, otherwise by RES value
          result['processes'] = sorted(
              result['processes'],
              key=lambda p: (
                  p.get('mem', 0),  # Primary sort by memory percentage
                  self._parse_memory_value(p.get('res', '0'))  # Secondary by RES value
              ),
              reverse=True
          )
    
      return result
    
    def _parse_memory_value(self, mem_str: str) -> float:
      """Convert memory string (e.g., '1.2g', '512m') to MB for sorting"""
      if not mem_str or mem_str == '-':
          return 0
    
      mem_str = str(mem_str).strip().lower()
    
      # Handle different units
      multipliers = {
          'k': 1/1024,
          'm': 1,
          'g': 1024,
          't': 1024 * 1024
      }
    
      for suffix, multiplier in multipliers.items():
          if suffix in mem_str:
              try:
                  num = float(mem_str.replace(suffix, ''))
                  return num * multiplier
              except ValueError:
                  return 0
    
    # No suffix, try to parse as number
      try:
          return float(mem_str)
      except ValueError:
          return 0

    
    def _parse_top_cpu(self, file_path: Path) -> Dict:
        """Enhanced top parser with maximum accuracy"""
        content = self._safe_read(file_path)
        if not content:
            return {"error": "Empty file", "raw_output": ""}
        
        lines = content.splitlines()
        result = {
            "raw_output": content,
            "header": {},
            "processes": [],
            "_accuracy_score": 100  # Track parsing accuracy
        }
        
        # Parse header with enhanced patterns
        for i, line in enumerate(lines[:10]):  # Check more lines for header
            
            # Top line with uptime and load
            if 'top -' in line or line.startswith('top'):
                # Extract timestamp if present
                time_match = re.search(r'(\d{2}:\d{2}:\d{2})', line)
                if time_match:
                    result['header']['time'] = time_match.group(1)
                
                # Extract uptime - multiple patterns
                uptime_patterns = [
                    r'up\s+(\d+\s+days?,\s*\d+:\d+)',
                    r'up\s+(\d+:\d+)',
                    r'up\s+(\d+\s+min)',
                    r'up\s+(.+?),\s*\d+\s*users?'
                ]
                for pattern in uptime_patterns:
                    uptime_match = re.search(pattern, line)
                    if uptime_match:
                        result['header']['uptime'] = uptime_match.group(1).strip()
                        break
                
                # Extract load averages - be very precise
                load_patterns = [
                    r'load\s+average:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)',
                    r'load\s+averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)'
                ]
                for pattern in load_patterns:
                    load_match = re.search(pattern, line)
                    if load_match:
                        result['header']['load_1min'] = self._safe_float(load_match.group(1))
                        result['header']['load_5min'] = self._safe_float(load_match.group(2))
                        result['header']['load_15min'] = self._safe_float(load_match.group(3))
                        break
            
            # Tasks line
            elif 'Tasks:' in line or 'Threads:' in line:
                # Extract all numbers first
                numbers = re.findall(r'\d+', line)
                
                # Map based on position and keywords
                if 'total' in line:
                    idx = line.lower().index('total')
                    # Find number before 'total'
                    for j, num in enumerate(numbers):
                        if str(num) in line[:idx][-10:]:
                            result['header']['tasks_total'] = int(num)
                            break
                
                # Parse specific states
                state_patterns = {
                    'running': r'(\d+)\s*running',
                    'sleeping': r'(\d+)\s*sleeping',
                    'stopped': r'(\d+)\s*stopped',
                    'zombie': r'(\d+)\s*zombie'
                }
                
                for state, pattern in state_patterns.items():
                    match = re.search(pattern, line, re.IGNORECASE)
                    if match:
                        result['header'][f'tasks_{state}'] = int(match.group(1))
                
                # Fallback: use position if we have enough numbers
                if len(numbers) >= 5 and 'tasks_total' not in result['header']:
                    result['header']['tasks_total'] = int(numbers[0])
                    result['header']['tasks_running'] = int(numbers[1])
                    result['header']['tasks_sleeping'] = int(numbers[2])
                    result['header']['tasks_stopped'] = int(numbers[3])
                    result['header']['tasks_zombie'] = int(numbers[4])
            
            # CPU line - most critical for accuracy
            elif '%Cpu' in line or 'Cpu(s):' in line:
                # Clean line first
                cpu_line = line.replace('%Cpu(s):', '').replace('%Cpu:', '').replace('Cpu(s):', '')
                
                # Extract each metric individually for maximum accuracy
                cpu_metrics = {
                    'cpu_user': [r'([\d.]+)\s*us', r'([\d.]+)%?\s*user'],
                    'cpu_system': [r'([\d.]+)\s*sy', r'([\d.]+)%?\s*system'],
                    'cpu_nice': [r'([\d.]+)\s*ni', r'([\d.]+)%?\s*nice'],
                    'cpu_idle': [r'([\d.]+)\s*id', r'([\d.]+)%?\s*idle'],
                    'cpu_iowait': [r'([\d.]+)\s*wa', r'([\d.]+)%?\s*iowait'],
                    'cpu_hi': [r'([\d.]+)\s*hi', r'([\d.]+)%?\s*hardware'],
                    'cpu_si': [r'([\d.]+)\s*si', r'([\d.]+)%?\s*software'],
                    'cpu_steal': [r'([\d.]+)\s*st', r'([\d.]+)%?\s*steal']
                }
                
                for metric, patterns in cpu_metrics.items():
                    for pattern in patterns:
                        match = re.search(pattern, cpu_line)
                        if match:
                            result['header'][metric] = self._safe_float(match.group(1))
                            break
                    
                    # Default to 0 if not found
                    if metric not in result['header']:
                        result['header'][metric] = 0.0
                        if metric == 'cpu_idle':
                            result['_accuracy_score'] -= 10  # Reduce accuracy if idle not found
            
            # Memory line - handle multiple units
            elif ('KiB Mem' in line or 'MiB Mem' in line or 'GiB Mem' in line or 
                  'Mem:' in line):
                
                # Determine unit multiplier
                unit_multiplier = 1  # Default KiB
                if 'MiB' in line:
                    unit_multiplier = 1024
                elif 'GiB' in line:
                    unit_multiplier = 1024 * 1024
                elif 'MB' in line:
                    unit_multiplier = 1024  # Assume MB = MiB
                elif 'GB' in line:
                    unit_multiplier = 1024 * 1024
                
                # Extract memory values
                mem_patterns = {
                    'total': r'([\d.]+)\s*total',
                    'free': r'([\d.]+)\s*free',
                    'used': r'([\d.]+)\s*used',
                    'buff/cache': r'([\d.]+)\s*buff/cache'
                }
                
                for key, pattern in mem_patterns.items():
                    match = re.search(pattern, line)
                    if match:
                        value_kb = self._safe_float(match.group(1)) * unit_multiplier
                        if key == 'buff/cache':
                            result['header']['mem_buff_cache_kb'] = int(value_kb)
                        else:
                            result['header'][f'mem_{key}_kb'] = int(value_kb)
                
                # Fallback: extract by position
                if 'mem_total_kb' not in result['header']:
                    numbers = re.findall(r'[\d.]+', line)
                    if len(numbers) >= 4:
                        result['header']['mem_total_kb'] = int(float(numbers[0]) * unit_multiplier)
                        result['header']['mem_free_kb'] = int(float(numbers[1]) * unit_multiplier)
                        result['header']['mem_used_kb'] = int(float(numbers[2]) * unit_multiplier)
                        result['header']['mem_buff_cache_kb'] = int(float(numbers[3]) * unit_multiplier)
            
            # Available memory (often on next line)
            elif 'avail Mem' in line:
                # Determine unit
                unit_multiplier = 1
                prev_line = lines[i-1] if i > 0 else ''
                if 'MiB' in prev_line:
                    unit_multiplier = 1024
                elif 'GiB' in prev_line:
                    unit_multiplier = 1024 * 1024
                
                avail_match = re.search(r'([\d.]+)\s*avail', line)
                if avail_match:
                    result['header']['mem_available_kb'] = int(float(avail_match.group(1)) * unit_multiplier)
            
            # Swap line
            elif ('KiB Swap' in line or 'MiB Swap' in line or 
                  'GiB Swap' in line or 'Swap:' in line):
                
                unit_multiplier = 1
                if 'MiB' in line:
                    unit_multiplier = 1024
                elif 'GiB' in line:
                    unit_multiplier = 1024 * 1024
                
                swap_patterns = {
                    'total': r'([\d.]+)\s*total',
                    'free': r'([\d.]+)\s*free',
                    'used': r'([\d.]+)\s*used'
                }
                
                for key, pattern in swap_patterns.items():
                    match = re.search(pattern, line)
                    if match:
                        value_kb = self._safe_float(match.group(1)) * unit_multiplier
                        result['header'][f'swap_{key}_kb'] = int(value_kb)
        
        # Find and parse process list with enhanced detection
        process_header_patterns = [
            r'PID\s+USER',
            r'PID\s+PPID',
            r'^\s*PID\s'
        ]
        
        process_start_idx = -1
        header_line = ""
        
        for i, line in enumerate(lines):
            for pattern in process_header_patterns:
                if re.search(pattern, line):
                    process_start_idx = i + 1
                    header_line = line
                    break
            if process_start_idx > 0:
                break
        
        # Parse processes with flexible column detection
        if process_start_idx > 0:
            # Detect column positions from header
            columns = self._detect_columns(header_line)
            
            for line in lines[process_start_idx:]:
                if not line.strip() or line.startswith('-'):
                    continue
                
                # Use flexible parsing based on detected columns
                process = self._parse_process_line(line, columns)
                if process:
                    result['processes'].append(process)
        
        # Calculate derived metrics if not present
        if 'mem_available_kb' not in result['header'] and 'mem_free_kb' in result['header']:
            # Estimate available as free + buff/cache
            result['header']['mem_available_kb'] = (
                result['header'].get('mem_free_kb', 0) + 
                result['header'].get('mem_buff_cache_kb', 0)
            )
        
        return result
    
    def _detect_columns(self, header_line: str) -> Dict[str, Tuple[int, int]]:
        """Detect column positions from header line"""
        columns = {}
        
        # Common column names to look for
        column_names = ['PID', 'USER', 'PR', 'NI', 'VIRT', 'RES', 'SHR', 
                       'S', '%CPU', '%MEM', 'TIME+', 'COMMAND', 'CMD']
        
        for col in column_names:
            if col in header_line:
                start = header_line.index(col)
                end = start + len(col)
                
                # Find next column start
                remaining = header_line[end:]
                next_col_match = re.search(r'\S', remaining)
                if next_col_match:
                    next_start = end + next_col_match.start()
                    # Find where current column likely ends
                    for next_col in column_names:
                        if next_col != col and next_col in header_line[end:]:
                            next_pos = header_line.index(next_col, end)
                            end = next_pos
                            break
                
                columns[col.lower().replace('%', '').replace('+', '')] = (start, end)
        
        return columns
    
    def _parse_process_line(self, line: str, columns: Dict) -> Optional[Dict]:
        """Parse a process line using detected column positions"""
        # First try standard whitespace splitting
        parts = line.split(None, 11)  # Split into max 12 parts
        
        if len(parts) >= 11:
            try:
                return {
                    'pid': self._safe_int(parts[0]),
                    'user': parts[1][:15],  # Truncate long usernames
                    'pr': parts[2],
                    'ni': parts[3],
                    'virt': parts[4],
                    'res': parts[5],
                    'shr': parts[6],
                    'state': parts[7],
                    'cpu': self._safe_float(parts[8]),
                    'mem': self._safe_float(parts[9]),
                    'time': parts[10],
                    'command': ' '.join(parts[11:]) if len(parts) > 11 else parts[11]
                }
            except (IndexError, ValueError):
                pass
        
        # Fallback: try to extract key fields at minimum
        if len(parts) >= 4:
            return {
                'pid': self._safe_int(parts[0]),
                'user': parts[1] if len(parts) > 1 else 'unknown',
                'cpu': self._safe_float(parts[8]) if len(parts) > 8 else 0.0,
                'mem': self._safe_float(parts[9]) if len(parts) > 9 else 0.0,
                'command': ' '.join(parts[11:]) if len(parts) > 11 else 'unknown'
            }
        
        return None
    
    def _parse_vmstat(self, file_path: Path) -> Dict:
        """Enhanced vmstat parser with validation"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "samples": [],
            "averages": {},
            "problems": []
        }
        
        # Find header line more robustly
        header_idx = -1
        header_fields = []
        
        for i, line in enumerate(lines):
            # Look for the header pattern
            if re.search(r'\br\b.*\bb\b.*\bfree\b', line):
                header_idx = i
                header_fields = line.split()
                break
            # Alternative pattern
            elif 'procs' in line.lower() and i + 1 < len(lines):
                if 'r' in lines[i + 1] and 'b' in lines[i + 1]:
                    header_idx = i + 1
                    header_fields = lines[i + 1].split()
                    break
        
        if header_idx >= 0:
            # Parse data lines (skip header and usually first summary line)
            start_idx = header_idx + 2 if header_idx + 2 < len(lines) else header_idx + 1
            
            for line_num, line in enumerate(lines[start_idx:], start=1):
                parts = line.split()
                
                # Validate we have enough fields
                if len(parts) >= 15:  # Minimum expected fields
                    try:
                        sample = {
                            'line_num': line_num,
                            'r': self._safe_int(parts[0]),  # Running
                            'b': self._safe_int(parts[1]),  # Blocked
                            'swpd': self._safe_int(parts[2]),  # Swap used
                            'free': self._safe_int(parts[3]),  # Free memory
                            'buff': self._safe_int(parts[4]),  # Buffers
                            'cache': self._safe_int(parts[5]),  # Cache
                            'si': self._safe_int(parts[6]),  # Swap in
                            'so': self._safe_int(parts[7]),  # Swap out
                            'bi': self._safe_int(parts[8]),  # Blocks in
                            'bo': self._safe_int(parts[9]),  # Blocks out
                            'in': self._safe_int(parts[10]),  # Interrupts
                            'cs': self._safe_int(parts[11]),  # Context switches
                            'us': self._safe_int(parts[12]),  # User CPU
                            'sy': self._safe_int(parts[13]),  # System CPU
                            'id': self._safe_int(parts[14]),  # Idle CPU
                            'wa': self._safe_int(parts[15]) if len(parts) > 15 else 0,  # IO Wait
                            'st': self._safe_int(parts[16]) if len(parts) > 16 else 0   # Steal time
                        }
                        
                        # Identify problems
                        if sample['si'] > 0 or sample['so'] > 0:
                            result['problems'].append({
                                'line': line_num,
                                'issue': 'swapping',
                                'details': f"si={sample['si']}, so={sample['so']}"
                            })
                        if sample['wa'] > 30:
                            result['problems'].append({
                                'line': line_num,
                                'issue': 'high_io_wait',
                                'details': f"wa={sample['wa']}%"
                            })
                        if sample['id'] < 10:
                            result['problems'].append({
                                'line': line_num,
                                'issue': 'low_idle',
                                'details': f"idle={sample['id']}%"
                            })
                        
                        result['samples'].append(sample)
                        
                    except (IndexError, ValueError) as e:
                        print(f"Failed to parse vmstat line {line_num}: {e}")
                        continue
        
        # Calculate averages if we have samples
        if result['samples']:
            num_samples = len(result['samples'])
            for key in ['r', 'b', 'si', 'so', 'us', 'sy', 'id', 'wa', 'cs', 'in']:
                total = sum(s.get(key, 0) for s in result['samples'])
                result['averages'][key] = round(total / num_samples, 2)
        
        return result
    
    def _parse_iostat(self, file_path: Path) -> Dict:
        """Enhanced iostat parser handling multiple formats"""
        content = self._safe_read(file_path)
        
        result = {
            "raw_output": content,
            "devices": {},
            "summary": {},
            "high_util_devices": []
        }
        
        # Split into sections
        sections = re.split(r'Device[:\s]', content)
        
        for section in sections[1:]:  # Skip before first "Device:"
            lines = section.strip().split('\n')
            
            if not lines:
                continue
            
            # Detect format from header
            header = lines[0]
            is_extended = 'await' in header.lower() or 'r/s' in header.lower()
            
            for line in lines[1:]:
                parts = line.split()
                
                if not parts or parts[0].startswith('#'):
                    continue
                
                device = parts[0]
                if device not in result['devices']:
                    result['devices'][device] = []
                
                try:
                    if is_extended and len(parts) >= 14:
                        # Extended format
                        sample = {
                            'rrqm_s': self._safe_float(parts[1]),
                            'wrqm_s': self._safe_float(parts[2]),
                            'r_s': self._safe_float(parts[3]),
                            'w_s': self._safe_float(parts[4]),
                            'rkB_s': self._safe_float(parts[5]),
                            'wkB_s': self._safe_float(parts[6]),
                            'avgrq_sz': self._safe_float(parts[7]),
                            'avgqu_sz': self._safe_float(parts[8]),
                            'await': self._safe_float(parts[9]),
                            'r_await': self._safe_float(parts[10]),
                            'w_await': self._safe_float(parts[11]),
                            'svctm': self._safe_float(parts[12]) if parts[12] != 'N/A' else 0,
                            'util': self._safe_float(parts[13].rstrip('%'))
                        }
                        
                        # Track high utilization
                        if sample['util'] > 90:
                            if device not in result['high_util_devices']:
                                result['high_util_devices'].append(device)
                        
                    elif len(parts) >= 6:
                        # Basic format
                        sample = {
                            'tps': self._safe_float(parts[1]),
                            'kB_read_s': self._safe_float(parts[2]),
                            'kB_wrtn_s': self._safe_float(parts[3]),
                            'kB_read': self._safe_float(parts[4]),
                            'kB_wrtn': self._safe_float(parts[5])
                        }
                    else:
                        continue
                    
                    result['devices'][device].append(sample)
                    
                except Exception as e:
                    print(f"Failed to parse iostat line for {device}: {e}")
                    continue
        
        # Calculate device summaries
        for device, samples in result['devices'].items():
            if samples:
                result['summary'][device] = {
                    'samples': len(samples),
                    'avg_util': round(sum(s.get('util', 0) for s in samples) / len(samples), 2),
                    'max_util': max(s.get('util', 0) for s in samples),
                    'avg_await': round(sum(s.get('await', 0) for s in samples) / len(samples), 2),
                    'max_await': max(s.get('await', 0) for s in samples)
                }
        
        return result
    
    def _parse_free_m(self, file_path: Path) -> Dict:
        """Parse free -m with comprehensive unit handling"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "memory_pressure": False
        }
        
        for line in lines:
            # Memory line
            if line.startswith('Mem:'):
                parts = line.split()
                if len(parts) >= 3:
                    result['total_mb'] = self._safe_int(parts[1])
                    
                    # Handle different free versions (columns vary)
                    if len(parts) >= 7:  # Newer format with available
                        result['used_mb'] = self._safe_int(parts[2])
                        result['free_mb'] = self._safe_int(parts[3])
                        result['shared_mb'] = self._safe_int(parts[4])
                        result['buff_cache_mb'] = self._safe_int(parts[5])
                        result['available_mb'] = self._safe_int(parts[6])
                    elif len(parts) >= 6:  # Older format
                        result['used_mb'] = self._safe_int(parts[2])
                        result['free_mb'] = self._safe_int(parts[3])
                        result['shared_mb'] = self._safe_int(parts[4])
                        result['buffers_mb'] = self._safe_int(parts[5])
                        # Calculate available
                        result['available_mb'] = result['free_mb'] + result.get('buffers_mb', 0)
                    else:  # Minimal format
                        result['used_mb'] = self._safe_int(parts[2]) if len(parts) > 2 else 0
                        result['free_mb'] = self._safe_int(parts[3]) if len(parts) > 3 else 0
                        result['available_mb'] = result['free_mb']
                    
                    # Calculate percentage
                    if result['total_mb'] > 0:
                        result['used_percent'] = round(result['used_mb'] / result['total_mb'] * 100, 1)
                        avail = result.get('available_mb', result['free_mb'])
                        result['available_percent'] = round(avail / result['total_mb'] * 100, 1)
                        
                        # Check memory pressure
                        if result['available_percent'] < 10:
                            result['memory_pressure'] = True
            
            # Swap line
            elif line.startswith('Swap:'):
                parts = line.split()
                if len(parts) >= 4:
                    result['swap_total_mb'] = self._safe_int(parts[1])
                    result['swap_used_mb'] = self._safe_int(parts[2])
                    result['swap_free_mb'] = self._safe_int(parts[3])
                    
                    # Flag if swap is being used
                    if result['swap_used_mb'] > 0:
                        result['swap_in_use'] = True
            
            # Handle -/+ buffers/cache line (older format)
            elif line.startswith('-/+ buffers'):
                parts = line.split()
                if len(parts) >= 3:
                    # This gives actual used/free excluding buffers/cache
                    result['real_used_mb'] = self._safe_int(parts[2])
                    result['real_free_mb'] = self._safe_int(parts[3])
        
        return result
    
    def _parse_df_hT(self, file_path: Path) -> Dict:
        """Parse df -hT with robust handling of wrapped lines and special filesystems"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "filesystems": [],
            "critical_filesystems": [],
            "total_space": {},
            "warnings": []
        }
        
        # Find header line
        header_idx = -1
        for i, line in enumerate(lines):
            if 'Filesystem' in line:
                header_idx = i
                break
        
        if header_idx < 0:
            # No header found, assume first line
            header_idx = 0
        
        # Process lines after header
        pending_line = ""
        
        for line in lines[header_idx + 1:]:
            if not line.strip():
                continue
            
            # Check if this line starts with a filesystem path or device
            # Common patterns: /dev/*, tmpfs, overlay, nfs*, etc.
            is_new_entry = False
            
            # Check for common filesystem patterns
            fs_patterns = [
                r'^/dev/',
                r'^tmpfs\s',
                r'^devtmpfs\s',
                r'^overlay\s',
                r'^shm\s',
                r'^nfs',
                r'^[a-zA-Z0-9]+fs\s',  # Any *fs filesystem
                r'^[a-zA-Z0-9\-_.]+:\/',  # NFS mounts
                r'^\/\/[a-zA-Z0-9]',  # SMB/CIFS mounts
                r'^[a-zA-Z0-9\-_.]+\s+[a-zA-Z0-9\-_]+\s+\d'  # Generic pattern with type
            ]
            
            for pattern in fs_patterns:
                if re.match(pattern, line):
                    is_new_entry = True
                    break
            
            # Also check if line has enough fields to be a complete entry
            parts = line.split()
            if len(parts) >= 6:
                # Check if 5th or 6th field contains a percentage
                for idx in [4, 5]:
                    if idx < len(parts) and '%' in parts[idx]:
                        is_new_entry = True
                        break
            
            if is_new_entry:
                # Process any pending line first
                if pending_line:
                    self._process_df_line_enhanced(pending_line, result)
                pending_line = line
            else:
                # This is a continuation of the previous line
                if pending_line:
                    pending_line += " " + line.strip()
                else:
                    # Orphaned continuation line, try to process it anyway
                    pending_line = line
        
        # Don't forget the last line
        if pending_line:
            self._process_df_line_enhanced(pending_line, result)
        
        # Calculate totals (only for real filesystems)
        total_size = 0
        total_used = 0
        
        for fs in result['filesystems']:
            # Skip special filesystems for totals
            if fs['filesystem'] in ['devtmpfs', 'tmpfs', 'shm', 'overlay'] or fs['type'] in ['devtmpfs', 'tmpfs']:
                continue
                
            # Convert to MB for totaling
            size_mb = self._convert_to_mb(fs['size'])
            used_mb = self._convert_to_mb(fs['used'])
            
            total_size += size_mb
            total_used += used_mb
            
            # Check for critical filesystems
            if fs['use_percent'] > 90:
                result['critical_filesystems'].append(fs)
                result['warnings'].append(f"{fs['mount']} is {fs['use_percent']}% full")
        
        if total_size > 0:
            result['total_space'] = {
                'total_gb': round(total_size / 1024, 2),
                'used_gb': round(total_used / 1024, 2),
                'available_gb': round((total_size - total_used) / 1024, 2),
                'use_percent': round(total_used / total_size * 100, 1)
            }
        
        return result
    
    def _process_df_line_enhanced(self, line: str, result: Dict):
        """Process a single df output line with better field detection"""
        parts = line.split()
        
        if len(parts) < 6:
            return  # Not enough fields
        
        # Try to identify the format
        # Format 1: Filesystem Type Size Used Avail Use% Mounted on
        # Format 2: Filesystem Size Used Avail Use% Mounted on (no type)
        
        # Look for the percentage field
        percent_idx = -1
        for i, part in enumerate(parts):
            if '%' in part:
                percent_idx = i
                break
        
        if percent_idx < 0:
            return  # No percentage found
        
        # Now we know the structure based on percent position
        fs_data = {}
        
        # The mount point is everything after the percentage
        mount_point = ' '.join(parts[percent_idx + 1:])
        
        # Parse backwards from percentage
        fs_data['use_percent'] = self._safe_int(parts[percent_idx].rstrip('%'))
        fs_data['mount'] = mount_point if mount_point else '/'
        
        # Available is before percentage
        if percent_idx > 0:
            fs_data['available'] = parts[percent_idx - 1]
        
        # Used is before available
        if percent_idx > 1:
            fs_data['used'] = parts[percent_idx - 2]
        
        # Size is before used
        if percent_idx > 2:
            fs_data['size'] = parts[percent_idx - 3]
        
        # Now determine if we have type field
        # If we have more fields before size, second field is likely type
        if percent_idx > 3:
            # We have a type field
            fs_data['type'] = parts[1]
            fs_data['filesystem'] = parts[0]
        else:
            # No type field
            fs_data['type'] = 'unknown'
            fs_data['filesystem'] = parts[0]
        
        # Validate the entry
        if 'filesystem' in fs_data and 'mount' in fs_data:
            # Clean up filesystem name (remove any trailing colons)
            fs_data['filesystem'] = fs_data['filesystem'].rstrip(':')
            
            # Set defaults for missing fields
            fs_data.setdefault('size', '0')
            fs_data.setdefault('used', '0')
            fs_data.setdefault('available', '0')
            fs_data.setdefault('use_percent', 0)
            fs_data.setdefault('type', 'unknown')
            
            result['filesystems'].append(fs_data)
    
    def _convert_to_mb(self, size_str: str) -> float:
        """Convert size string (e.g., '10G', '500M') to MB"""
        if not size_str or size_str == '-':
            return 0
        
        # Remove any trailing characters
        size_str = size_str.upper()
        
        multipliers = {
            'K': 1/1024,
            'M': 1,
            'G': 1024,
            'T': 1024 * 1024,
            'P': 1024 * 1024 * 1024
        }
        
        for suffix, multiplier in multipliers.items():
            if suffix in size_str:
                try:
                    num = float(size_str.replace(suffix, '').replace('I', '').replace('B', ''))
                    return num * multiplier
                except ValueError:
                    return 0
        
        # No suffix, assume MB
        try:
            return float(size_str)
        except ValueError:
            return 0
    
    def _parse_netstat(self, file_path: Path) -> Dict:
        """Enhanced netstat parser"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "connections": {},
            "protocols": {},
            "listening_ports": [],
            "statistics": {},
            "issues": []
        }
        
        for line in lines:
            line_lower = line.lower()
            
            # Parse connection lines
            if 'tcp' in line_lower or 'udp' in line_lower:
                parts = line.split()
                if len(parts) >= 4:
                    
                    # Extract protocol
                    protocol = 'tcp' if 'tcp' in line_lower else 'udp'
                    result['protocols'][protocol] = result['protocols'].get(protocol, 0) + 1
                    
                    # For TCP, get state
                    if protocol == 'tcp' and len(parts) >= 6:
                        # State is usually last column
                        state = parts[-1].upper()
                        
                        # Validate it's a real state
                        valid_states = ['ESTABLISHED', 'SYN_SENT', 'SYN_RECV', 
                                       'FIN_WAIT1', 'FIN_WAIT2', 'TIME_WAIT',
                                       'CLOSE', 'CLOSE_WAIT', 'LAST_ACK',
                                       'LISTEN', 'CLOSING', 'UNKNOWN']
                        
                        if state in valid_states:
                            result['connections'][state] = result['connections'].get(state, 0) + 1
                            
                            # Track listening ports
                            if state == 'LISTEN' and len(parts) >= 4:
                                local_addr = parts[3]
                                if ':' in local_addr:
                                    port = local_addr.split(':')[-1]
                                    if port not in result['listening_ports']:
                                        result['listening_ports'].append(port)
        
        # Check for issues
        if result['connections'].get('CLOSE_WAIT', 0) > 100:
            result['issues'].append(f"High CLOSE_WAIT count: {result['connections']['CLOSE_WAIT']}")
        
        if result['connections'].get('TIME_WAIT', 0) > 10000:
            result['issues'].append(f"Very high TIME_WAIT count: {result['connections']['TIME_WAIT']}")
        
        return result
    
    def _parse_ps(self, file_path: Path) -> Dict:
        """Enhanced ps parser"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "process_count": 0,
            "process_states": {},
            "users": {},
            "high_cpu_processes": [],
            "high_mem_processes": [],
            "zombies": []
        }
        
        # Find header line
        header_idx = -1
        for i, line in enumerate(lines):
            if 'PID' in line and ('STAT' in line or 'S' in line):
                header_idx = i
                break
        
        if header_idx >= 0:
            # Determine column positions
            header = lines[header_idx]
            stat_col = -1
            user_col = -1
            cpu_col = -1
            mem_col = -1
            cmd_col = -1
            
            # Find column indices
            headers = header.split()
            for idx, h in enumerate(headers):
                if h in ['STAT', 'S']:
                    stat_col = idx
                elif h == 'USER':
                    user_col = idx
                elif h == '%CPU':
                    cpu_col = idx
                elif h == '%MEM':
                    mem_col = idx
                elif h in ['CMD', 'COMMAND']:
                    cmd_col = idx
            
            # Parse process lines
            for line in lines[header_idx + 1:]:
                if not line.strip():
                    continue
                
                result['process_count'] += 1
                parts = line.split(None, max(10, cmd_col + 1) if cmd_col > 0 else 10)
                
                # Extract state
                if stat_col >= 0 and len(parts) > stat_col:
                    stat = parts[stat_col]
                    if stat:
                        state = stat[0]  # First character is the state
                        result['process_states'][state] = result['process_states'].get(state, 0) + 1
                        
                        # Track zombies
                        if state == 'Z':
                            pid = parts[0] if parts else 'unknown'
                            cmd = parts[cmd_col] if cmd_col >= 0 and len(parts) > cmd_col else 'unknown'
                            result['zombies'].append({'pid': pid, 'command': cmd})
                
                # Count by user
                if user_col >= 0 and len(parts) > user_col:
                    user = parts[user_col]
                    result['users'][user] = result['users'].get(user, 0) + 1
                
                # Track high resource usage
                if cpu_col >= 0 and len(parts) > cpu_col:
                    cpu = self._safe_float(parts[cpu_col])
                    if cpu > 50:
                        result['high_cpu_processes'].append({
                            'pid': parts[0],
                            'cpu': cpu,
                            'command': parts[cmd_col] if cmd_col >= 0 and len(parts) > cmd_col else 'unknown'
                        })
                
                if mem_col >= 0 and len(parts) > mem_col:
                    mem = self._safe_float(parts[mem_col])
                    if mem > 20:
                        result['high_mem_processes'].append({
                            'pid': parts[0],
                            'mem': mem,
                            'command': parts[cmd_col] if cmd_col >= 0 and len(parts) > cmd_col else 'unknown'
                        })
        
        # Add state descriptions
        result['state_descriptions'] = {
            'R': 'Running',
            'S': 'Sleeping',
            'D': 'Uninterruptible sleep',
            'Z': 'Zombie',
            'T': 'Stopped',
            'I': 'Idle kernel thread'
        }
        
        return result
    
    def _parse_uptime(self, file_path: Path) -> Dict:
        """Parse uptime with multiple format support"""
        content = self._safe_read(file_path)
        
        result = {"raw_output": content}
        
        # Extract load averages (most reliable)
        load_match = re.search(
            r'load\s+averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)',
            content, re.IGNORECASE
        )
        if load_match:
            result['load_1min'] = self._safe_float(load_match.group(1))
            result['load_5min'] = self._safe_float(load_match.group(2))
            result['load_15min'] = self._safe_float(load_match.group(3))
        
        # Extract uptime
        uptime_patterns = [
            (r'up\s+(\d+)\s+days?,\s*(\d+):(\d+)', 'days'),
            (r'up\s+(\d+):(\d+)', 'hours'),
            (r'up\s+(\d+)\s+min', 'minutes'),
            (r'up\s+(\d+)\s+days?', 'days_only')
        ]
        
        for pattern, format_type in uptime_patterns:
            match = re.search(pattern, content)
            if match:
                if format_type == 'days':
                    days = int(match.group(1))
                    hours = int(match.group(2))
                    minutes = int(match.group(3))
                    result['uptime'] = f"{days} days, {hours}:{minutes:02d}"
                    result['uptime_days'] = days
                    result['uptime_hours'] = hours
                    result['uptime_minutes'] = minutes
                elif format_type == 'hours':
                    hours = int(match.group(1))
                    minutes = int(match.group(2))
                    result['uptime'] = f"{hours}:{minutes:02d}"
                    result['uptime_hours'] = hours
                    result['uptime_minutes'] = minutes
                elif format_type == 'minutes':
                    minutes = int(match.group(1))
                    result['uptime'] = f"{minutes} min"
                    result['uptime_minutes'] = minutes
                elif format_type == 'days_only':
                    days = int(match.group(1))
                    result['uptime'] = f"{days} days"
                    result['uptime_days'] = days
                break
        
        # Extract user count
        users_match = re.search(r'(\d+)\s+users?', content)
        if users_match:
            result['users'] = int(users_match.group(1))
        
        # Extract current time if present
        time_match = re.search(r'(\d{1,2}:\d{2}:\d{2})\s+(AM|PM)?', content)
        if time_match:
            result['current_time'] = time_match.group(0).strip()
        
        return result
    
    def _parse_generic(self, file_path: Path) -> Dict:
        """Generic parser with basic analysis"""
        content = self._safe_read(file_path)
        lines = content.splitlines()
        
        result = {
            "raw_output": content,
            "line_count": len(lines),
            "file_size": len(content),
            "non_empty_lines": sum(1 for l in lines if l.strip())
        }
        
        # Try to identify any numbers or patterns
        numbers = re.findall(r'\d+\.?\d*', content)
        if numbers:
            result['numeric_values_found'] = len(numbers)
        
        # Look for any error keywords
        error_keywords = ['error', 'fail', 'critical', 'warning', 'abort', 'panic']
        errors_found = []
        for keyword in error_keywords:
            if keyword.lower() in content.lower():
                errors_found.append(keyword)
        
        if errors_found:
            result['potential_issues'] = errors_found
        
        return result


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
# Replace the entire run_auto_analysis_task function with this COMPLETE version

async def run_auto_analysis_task(session_id: str):
    """Background task to run auto-analysis - COMPLETE DATA EXTRACTION"""
    try:
        print(f"🔍 Starting auto-analysis for session: {session_id}")
        
        auto_analysis_sessions[session_id].update({
            "status": "processing",
            "progress": 10,
            "message": "Initializing pattern hunter..."
        })
        
        # Find original file
        upload_path = Path("data/uploads")
        original_file = None
        
        # Try exact match first
        for file in upload_path.iterdir():
            if session_id in file.name and file.is_file():
                original_file = file
                break
        
        if not original_file:
            raise Exception(f"Original uploaded file not found for session {session_id}")
        
        print(f"📦 Using original upload: {original_file.name}")
        
        auto_analysis_sessions[session_id].update({
            "progress": 30,
            "message": "Running pattern analysis..."
        })
        
        def run_analysis():
            print(f"🎯 Initializing AutoGrep...")
            optimal_workers = min(mp.cpu_count(), 8)
            analyzer = AutoGrep(workers=optimal_workers)
            print(f"✅ AutoGrep initialized with {len(analyzer.pattern_bank.patterns)} patterns")
            
            auto_analysis_sessions[session_id].update({
                "progress": 50,
                "message": "Analyzing patterns..."
            })
            
            # Run analysis
            start_time = time.time()
            report = analyzer.analyze_tar(str(original_file))
            analysis_duration = time.time() - start_time
            print(f"✅ Pattern analysis completed in {analysis_duration:.1f}s")
            
            auto_analysis_sessions[session_id].update({
                "progress": 80,
                "message": "Processing results..."
            })
            
            # CRITICAL FIX: Extract ALL problems from ALL error clusters
            all_problems = []
            problem_rank = 1
            
            # Process error_clusters from AutoGrep (the main GitLab errors)
            if hasattr(analyzer, 'error_clusters'):
                for component, clusters in analyzer.error_clusters.items():
                    for signature, errors in clusters:
                        if errors:
                            sample = errors[0]
                            
                            # Get unique files
                            unique_files = list(set(
                                os.path.basename(e.file_path) for e in errors[:10]
                            ))
                            
                            all_problems.append({
                                "rank": problem_rank,
                                "component": component,
                                "pattern": sample.pattern.pattern[:200],
                                "pattern_id": sample.pattern.id,
                                "severity": sample.pattern.severity,
                                "description": sample.pattern.description or "",
                                "count": len(errors),
                                "files": unique_files,
                                "sample_line": sample.line[:500],
                                "sample_file": unique_files[0] if unique_files else "unknown",
                                "signature": signature,
                                "is_monitoring": False
                            })
                            problem_rank += 1
            
            # Also check the report's gitlab_components for any missed patterns
            gitlab_components = report.get('gitlab_components', {})
            for component, issues in gitlab_components.items():
                for issue in issues:
                    # Check if we already have this pattern
                    pattern_id = issue.get('pattern_id', '')
                    if not any(p['pattern_id'] == pattern_id and p['component'] == component 
                              for p in all_problems):
                        all_problems.append({
                            "rank": problem_rank,
                            "component": component,
                            "pattern": issue.get('pattern', '')[:200],
                            "pattern_id": pattern_id,
                            "severity": issue.get('severity', 'ERROR'),
                            "description": issue.get('description', ''),
                            "count": issue.get('count', 0),
                            "files": issue.get('files', []),
                            "sample_line": issue.get('sample', ''),
                            "sample_file": issue.get('files', ['unknown'])[0] if issue.get('files') else 'unknown',
                            "signature": f"{component}_{pattern_id}",
                            "is_monitoring": False
                        })
                        problem_rank += 1
            
            # Process monitoring errors separately
            monitoring_problems = []
            if hasattr(analyzer, 'monitoring_clusters'):
                for component, clusters in analyzer.monitoring_clusters.items():
                    for signature, errors in clusters:
                        if errors:
                            sample = errors[0]
                            unique_files = list(set(
                                os.path.basename(e.file_path) for e in errors[:10]
                            ))
                            
                            monitoring_problems.append({
                                "component": component,
                                "pattern": sample.pattern.pattern[:200],
                                "pattern_id": sample.pattern.id,
                                "severity": sample.pattern.severity,
                                "description": sample.pattern.description or "",
                                "count": len(errors),
                                "files": unique_files,
                                "sample_line": sample.line[:500],
                                "is_monitoring": True
                            })
            
            # Get summary data
            summary = report.get('summary', {})
            
            # Build component statistics from actual problems
            component_stats = {}
            for problem in all_problems:
                comp = problem['component']
                if comp not in component_stats:
                    component_stats[comp] = 0
                component_stats[comp] += problem['count']
            
            # Calculate severity breakdown from actual problems
            severity_breakdown = {"CRITICAL": 0, "ERROR": 0, "WARNING": 0}
            for problem in all_problems:
                severity = problem['severity'].upper()
                if severity in severity_breakdown:
                    severity_breakdown[severity] += problem['count']
            
            print(f"📊 Extracted {len(all_problems)} GitLab problem patterns")
            print(f"📊 Extracted {len(monitoring_problems)} monitoring patterns")
            
            return {
                # Core metrics from summary
                "analysis_duration": analysis_duration,
                "total_problems": summary.get('errors_found', 0),
                "gitlab_problems": summary.get('gitlab_errors', 0),
                "monitoring_issues": summary.get('monitoring_errors', 0),
                "unique_patterns": len(all_problems),
                
                # ALL problems
                "problems": all_problems,
                "monitoring_problems": monitoring_problems,
                
                # Statistics
                "component_stats": component_stats,
                "monitoring_stats": summary.get('monitoring_summary', {}),
                "severity_breakdown": severity_breakdown,
                
                # Summary data
                "summary": summary,
                
                # Metadata
                "metadata": {
                    "files_processed": summary.get('files_processed', 0),
                    "lines_processed": summary.get('lines_processed', 0),
                    "analysis_duration_seconds": analysis_duration,
                    "pattern_bank_size": len(analyzer.pattern_bank.patterns) if hasattr(analyzer, 'pattern_bank') else 0
                }
            }
        
        # Run in thread pool
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
        print(f"   📊 Total: {results_data['total_problems']} problems found")
        print(f"   🎯 GitLab: {results_data['gitlab_problems']} ({len(results_data['problems'])} patterns)")
        print(f"   📡 Monitoring: {results_data['monitoring_issues']} ({len(results_data.get('monitoring_problems', []))} patterns)")
        
    except Exception as e:
        print(f"❌ Auto-analysis failed: {e}")
        import traceback
        traceback.print_exc()
        
        auto_analysis_sessions[session_id].update({
            "status": "failed",
            "progress": 0,
            "message": f"Failed: {str(e)}",
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

@app.get("/api/system-metrics/comprehensive/{session_id}")
async def get_comprehensive_metrics(session_id: str):
    """Get all system metrics with 100% accuracy"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    
    try:
        print(f"📊 Parsing system metrics for session: {session_id}")
        print(f"📁 Session directory: {session_dir}")
        
        # Use the new accurate parser
        parser = SystemMetricsParser(session_dir)
        data = parser.parse_all()
        
        print(f"✅ Successfully parsed {len(data['available_commands'])} commands")
        
        return {
            "session_id": session_id,
            "timestamp": data['timestamp'],
            "data": data
        }
        
    except Exception as e:
        print(f"❌ Parse failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Parse failed: {str(e)}")

# Add this new endpoint to main.py - keeps existing endpoints intact
@app.get("/api/logs/{session_id}/{file_path:path}/metadata")
async def get_log_metadata(session_id: str, file_path: str):
    """Get file metadata without loading all content - for performance"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        # Quick line count without loading everything
        line_count = 0
        json_count = 0
        file_size = actual_path.stat().st_size
        
        # Sample first 100 lines for JSON detection
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                line_count += 1
                if i < 100 and line.strip().startswith('{'):
                    try:
                        json.loads(line)
                        json_count += 1
                    except:
                        pass
        
        is_json = json_count > 30  # >30% of sample is JSON
        
        return {
            "file": file_path,
            "total_lines": line_count,
            "file_size": file_size,
            "is_json_log": is_json,
            "should_virtualize": line_count > 10000  # Virtualize large files
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error reading metadata: {str(e)}")

# Enhanced Backend API Endpoints for Production Log Search
# Add these to your FastAPI backend

import json
import os
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
import asyncio

# Enhanced metadata endpoint with better JSON detection
@app.get("/api/logs/{session_id}/{file_path:path}/metadata")
async def get_log_metadata(session_id: str, file_path: str):
    """Get file metadata with enhanced JSON detection"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        line_count = 0
        json_count = 0
        file_size = actual_path.stat().st_size
        json_fields = set()
        
        # Enhanced sampling - check more lines for better detection
        sample_size = min(500, file_size // 1000)  # Sample more lines for large files
        
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                line_count += 1
                if i < sample_size:
                    line_stripped = line.strip()
                    if line_stripped.startswith('{') and line_stripped.endswith('}'):
                        try:
                            parsed = json.loads(line)
                            json_count += 1
                            json_fields.update(parsed.keys())
                        except:
                            pass
        
        # Better JSON detection logic
        is_json = (
            json_count > sample_size * 0.1 or  # >10% JSON
            file_path.endswith('.json') or 
            'json' in file_path.lower() or
            (json_count > 5 and len(json_fields) > 3)  # Has structured JSON
        )
        
        return {
            "file": file_path,
            "total_lines": line_count,
            "file_size": file_size,
            "is_json_log": is_json,
            "detected_fields": list(json_fields)[:50],  # Return top 50 fields
            "json_ratio": json_count / max(sample_size, 1),
            "should_virtualize": line_count > 5000,  # Lower threshold for virtualization
            "recommended_chunk_size": min(10000, max(1000, line_count // 10))
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error reading metadata: {str(e)}")


# Main content endpoint - optimized for full search
@app.get("/api/logs/{session_id}/{file_path:path}")
async def get_log_content(session_id: str, file_path: str):
    """Get complete log file content for robust searching"""
    
    if session_id not in analysis_sessions:
        raise HTTPException(404, "Session not found")
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Extracted files not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        file_size = actual_path.stat().st_size
        
        # Read ALL lines for complete search capability
        lines = []
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                lines.append(line.rstrip())
        
        return {
            "file": file_path,
            "content": lines,  # Return ALL lines
            "total_lines": len(lines),
            "file_size": file_size,
            "truncated": False,
            "encoding": "utf-8"
        }
        
    except MemoryError:
        # If file is too large for memory, offer streaming alternative
        raise HTTPException(413, "File too large for memory. Use streaming endpoint /api/logs/{session_id}/{file_path}/stream")
    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")


# Streaming endpoint for very large files
@app.get("/api/logs/{session_id}/{file_path:path}/stream")
async def stream_log_content(
    session_id: str, 
    file_path: str,
    start_line: int = Query(0, description="Starting line number"),
    end_line: Optional[int] = Query(None, description="Ending line number"),
    chunk_size: int = Query(10000, description="Lines per chunk")
):
    """Stream log content for very large files"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    async def generate():
        current_line = 0
        chunk = []
        
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if current_line >= start_line:
                    if end_line and current_line >= end_line:
                        break
                    
                    chunk.append(line.rstrip())
                    
                    if len(chunk) >= chunk_size:
                        yield json.dumps({
                            "lines": chunk,
                            "start": current_line - len(chunk) + 1,
                            "end": current_line
                        }) + "\n"
                        chunk = []
                        await asyncio.sleep(0)  # Allow other tasks
                
                current_line += 1
            
            # Send remaining chunk
            if chunk:
                yield json.dumps({
                    "lines": chunk,
                    "start": current_line - len(chunk),
                    "end": current_line - 1,
                    "complete": True
                }) + "\n"
    
    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff"}
    )


# Server-side search endpoint for extremely large files
@app.post("/api/logs/{session_id}/{file_path:path}/search")
async def search_in_log(
    session_id: str,
    file_path: str,
    query: Dict[str, Any],
    max_results: int = Query(1000, description="Maximum results to return"),
    context_lines: int = Query(0, description="Context lines around matches")
):
    """Server-side search for extremely large log files"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    def evaluate_condition(condition: Dict, line: str, parsed_json: Optional[Dict] = None) -> bool:
        """Evaluate a search condition"""
        
        cond_type = condition.get('type')
        
        if cond_type == 'TEXT':
            return condition['value'].lower() in line.lower()
        
        elif cond_type == 'OR':
            return any(evaluate_condition(c, line, parsed_json) for c in condition['conditions'])
        
        elif cond_type == 'AND':
            return all(evaluate_condition(c, line, parsed_json) for c in condition['conditions'])
        
        elif cond_type == 'NOT':
            return not evaluate_condition(condition['condition'], line, parsed_json)
        
        elif cond_type in ['FIELD_EQ', 'FIELD_NEQ', 'FIELD_GT', 'FIELD_GTE', 'FIELD_LT', 'FIELD_LTE']:
            if parsed_json is None:
                # Try to parse JSON
                if line.strip().startswith('{'):
                    try:
                        parsed_json = json.loads(line)
                    except:
                        return False
                else:
                    return False
            
            field = condition['field']
            value = condition['value']
            field_value = parsed_json.get(field)
            
            if field_value is None:
                return cond_type == 'FIELD_NEQ'
            
            if cond_type == 'FIELD_EQ':
                return str(field_value).lower() == str(value).lower()
            elif cond_type == 'FIELD_NEQ':
                return str(field_value).lower() != str(value).lower()
            elif cond_type == 'FIELD_GT':
                return float(field_value) > float(value)
            elif cond_type == 'FIELD_GTE':
                return float(field_value) >= float(value)
            elif cond_type == 'FIELD_LT':
                return float(field_value) < float(value)
            elif cond_type == 'FIELD_LTE':
                return float(field_value) <= float(value)
        
        return True
    
    try:
        results = []
        total_lines = 0
        matches_found = 0
        
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line_num, line in enumerate(f):
                total_lines += 1
                line_stripped = line.rstrip()
                
                # Parse JSON if needed
                parsed_json = None
                if line_stripped.startswith('{'):
                    try:
                        parsed_json = json.loads(line_stripped)
                    except:
                        pass
                
                # Evaluate search condition
                if evaluate_condition(query, line_stripped, parsed_json):
                    matches_found += 1
                    
                    # Add context if requested
                    result_entry = {
                        "line_number": line_num + 1,
                        "content": line_stripped
                    }
                    
                    if context_lines > 0:
                        # Add context (would need to buffer lines for this)
                        result_entry["context"] = {
                            "before": [],
                            "after": []
                        }
                    
                    results.append(result_entry)
                    
                    if len(results) >= max_results:
                        break
        
        return {
            "total_lines": total_lines,
            "total_matches": matches_found,
            "results": results,
            "truncated": matches_found > len(results)
        }
        
    except Exception as e:
        raise HTTPException(500, f"Search error: {str(e)}")


# Download endpoint remains the same but with better error handling
@app.get("/api/logs/{session_id}/{file_path:path}/download")
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
            while chunk := f.read(1024 * 1024):  # 1MB chunks
                yield chunk
    
    filename = Path(file_path).name
    
    return StreamingResponse(
        iterfile(),
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/plain; charset=utf-8"
        }
    )


# Field extraction endpoint for better field discovery
@app.get("/api/logs/{session_id}/{file_path:path}/fields")
async def extract_log_fields(
    session_id: str, 
    file_path: str,
    sample_size: int = Query(1000, description="Number of lines to sample")
):
    """Extract available fields from JSON log files"""
    
    if session_id not in extracted_files:
        raise HTTPException(404, "Session not found")
    
    session_dir = extracted_files[session_id]
    actual_path = session_dir / file_path
    
    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")
    
    try:
        fields = {}
        lines_sampled = 0
        json_lines = 0
        
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if lines_sampled >= sample_size:
                    break
                
                lines_sampled += 1
                line_stripped = line.strip()
                
                if line_stripped.startswith('{'):
                    try:
                        parsed = json.loads(line_stripped)
                        json_lines += 1
                        
                        for key, value in parsed.items():
                            if key not in fields:
                                fields[key] = {
                                    'type': type(value).__name__,
                                    'count': 0,
                                    'sample_values': set(),
                                    'nullable': False
                                }
                            
                            fields[key]['count'] += 1
                            
                            if value is None:
                                fields[key]['nullable'] = True
                            elif fields[key]['sample_values'] is not None:
                                if len(fields[key]['sample_values']) < 50:
                                    val_str = str(value)
                                    if len(val_str) < 200:  # Don't store huge values
                                        fields[key]['sample_values'].add(val_str)
                                else:
                                    fields[key]['sample_values'] = None  # Too many unique values
                    except:
                        pass
        
        # Convert sets to lists for JSON serialization
        for field in fields.values():
            if field['sample_values'] is not None:
                field['sample_values'] = list(field['sample_values'])[:20]
        
        return {
            "fields": fields,
            "lines_sampled": lines_sampled,
            "json_lines": json_lines,
            "is_json_file": json_lines > lines_sampled * 0.1
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error extracting fields: {str(e)}")


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