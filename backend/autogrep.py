#!/usr/bin/env python3
"""
AUTOGREP - Enhanced GitLab Error Analyzer - TURBO EDITION
Full context preservation, parallel processing, streaming results
Complete implementation with all patterns
"""

import os
import re
import sys
import json
import gzip
import time
import mmap
import bisect
import hashlib
import tarfile
import tempfile
import subprocess
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional, Any, Iterator, NamedTuple, Union
from collections import defaultdict, Counter, deque
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from functools import lru_cache
import multiprocessing as mp
from queue import Queue, Empty
import threading
import heapq
import asyncio
from asyncio import Queue as AsyncQueue

# Try to import optional performance libraries
try:
    import pyahocorasick
    HAS_AHOCORASICK = True
except ImportError:
    HAS_AHOCORASICK = False
    if __name__ == "__main__":
        print("⚠️  Install pyahocorasick for 10x faster pattern matching: pip install pyahocorasick")

try:
    import regex as re2
    HAS_REGEX = True
except ImportError:
    import re as re2
    HAS_REGEX = False

try:
    from rapidfuzz import fuzz
    HAS_FUZZY = True
except ImportError:
    HAS_FUZZY = False


@dataclass(frozen=True)
class ErrorPattern:
    """Immutable error pattern definition"""
    id: str
    pattern: str
    component: str
    category: str
    severity: str = 'ERROR'
    description: str = ''
    multiline: bool = False
    correlation_extractors: List[str] = field(default_factory=list)
    priority: int = 5  # 1-10, higher = more important
    
    def __hash__(self):
        return hash((self.id, self.pattern))


@dataclass
class EnhancedErrorMatch:
    """Complete error match with ALL context preserved"""
    pattern: ErrorPattern
    matched_text: str
    clean_message: str  # The extracted, clean error message
    full_line: str  # Complete original line
    file_path: str
    line_number: int
    timestamp: Optional[datetime] = None
    node: str = 'unknown'
    
    # Full context preservation
    context_before: List[str] = field(default_factory=list)  # Up to 10 lines before
    context_after: List[str] = field(default_factory=list)   # Up to 10 lines after
    full_context_text: str = ''  # Full multi-line error (for stack traces)
    
    # Correlation and metadata
    correlation_id: Optional[str] = None
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    trace_id: Optional[str] = None
    
    # Enhanced metadata
    error_code: Optional[str] = None  # HTTP status, GRPC code, etc
    stack_trace: Optional[List[str]] = None  # Full parsed stack trace
    json_fields: Dict[str, Any] = field(default_factory=dict)  # All JSON fields if applicable
    
    # Performance metadata
    signature: Optional[str] = None
    confidence: float = 1.0
    processing_time_ms: float = 0
    
    def __post_init__(self):
        if not self.signature:
            self.signature = self._generate_signature()
    
    def _generate_signature(self) -> str:
        """Generate unique signature for error clustering"""
        clean_text = re.sub(r'\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}', '', self.clean_message or self.matched_text)
        clean_text = re.sub(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', 'UUID', clean_text)
        clean_text = re.sub(r'\b\d+\b', 'N', clean_text)
        
        sig_input = f"{self.pattern.component}:{self.pattern.id}:{clean_text[:100]}"
        return hashlib.md5(sig_input.encode()).hexdigest()[:16]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'pattern_id': self.pattern.id,
            'pattern_description': self.pattern.description,
            'component': self.pattern.component,
            'severity': self.pattern.severity,
            'message': self.clean_message,  # CRITICAL: Clean message for UI
            'full_line': self.full_line,    # Full line for reference
            'matched_text': self.matched_text,
            'file_path': self.file_path,
            'line_number': self.line_number,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'node': self.node,
            'context_before': self.context_before,
            'context_after': self.context_after,
            'full_context': self.full_context_text,
            'correlation_id': self.correlation_id,
            'request_id': self.request_id,
            'user_id': self.user_id,
            'project_id': self.project_id,
            'job_id': self.job_id,
            'trace_id': self.trace_id,
            'error_code': self.error_code,
            'stack_trace': self.stack_trace,
            'json_fields': self.json_fields,
            'signature': self.signature,
            'confidence': self.confidence
        }


class LogBoundaryDetector:
    """Detects actual error boundaries in logs"""
    
    def __init__(self):
        # Start patterns for different log types
        self.error_start_patterns = [
            (r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}.*(?:ERROR|FATAL|CRITICAL)', 'timestamp'),
            (r'^E, \[\d{4}-\d{2}-\d{2}', 'ruby'),
            (r'^\s*Traceback \(most recent call last\)', 'python_stack'),
            (r'^Exception in thread', 'java_stack'),
            (r'^panic:', 'go_panic'),
            (r'^\{\s*"(?:level|severity)"\s*:\s*"(?:error|fatal|critical)"', 'json'),
            (r'^goroutine \d+', 'go_stack'),
            (r'^FATAL:', 'fatal'),
            (r'^PANIC:', 'panic'),
        ]
        
        # Continuation patterns
        self.continuation_patterns = [
            r'^\s+at ',  # Java stack
            r'^\s+File "[^"]+", line \d+',  # Python stack
            r'^\s+from .+:\d+:in',  # Ruby stack
            r'^\s+.*\.go:\d+',  # Go stack
            r'^\s+\w+\(.*\)',  # Function calls in stacks
            r'^Caused by:',  # Java caused by
            r'^\s+\.{3}',  # Truncated stack
            r'^\s{2,}\S',  # Indented content
        ]
        
        # End patterns
        self.end_patterns = [
            r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}.*(?:INFO|DEBUG|TRACE)',
            r'^I, \[\d{4}-\d{2}-\d{2}',  # Ruby INFO
            r'^\{\s*"(?:level|severity)"\s*:\s*"(?:info|debug)"',
            r'^$',  # Empty line
            r'^[A-Z][a-z]+.*:$',  # New section header
        ]
        
        # Compile patterns
        self.compiled_start = [(re.compile(p, re.MULTILINE), t) for p, t in self.error_start_patterns]
        self.compiled_continuation = [re.compile(p, re.MULTILINE) for p in self.continuation_patterns]
        self.compiled_end = [re.compile(p, re.MULTILINE) for p in self.end_patterns]
    
    def detect_format(self, line: str) -> str:
        """Detect log format from line"""
        if line.strip().startswith('{') and '"level"' in line:
            return 'json'
        elif re.match(r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}', line):
            return 'timestamp'
        elif line.startswith('E, [') or line.startswith('I, ['):
            return 'ruby'
        elif 'Traceback' in line:
            return 'python_stack'
        elif 'goroutine' in line or '.go:' in line:
            return 'go_stack'
        else:
            return 'text'
    
    def find_boundaries(self, lines: List[str], match_line: int) -> Tuple[int, int, str]:
        """Find the actual boundaries of an error and its format"""
        start = match_line
        end = match_line
        format_type = self.detect_format(lines[match_line] if match_line < len(lines) else '')
        
        # Find start by going backwards
        for i in range(match_line - 1, max(0, match_line - 100), -1):
            line = lines[i]
            
            # Check if this is a new log entry
            is_new_entry = False
            for pattern, _ in self.compiled_start:
                if pattern.match(line):
                    is_new_entry = True
                    break
            
            if is_new_entry:
                # This is a different log entry, stop here
                break
            
            # Check if this is continuation of current error
            is_continuation = False
            for pattern in self.compiled_continuation:
                if pattern.match(line):
                    is_continuation = True
                    start = i
                    break
            
            if not is_continuation and line.strip():
                # Not a continuation and not empty, stop
                break
            elif not line.strip():
                # Empty line might be part of stack trace
                if i > 0 and any(p.match(lines[i-1]) for p in self.compiled_continuation):
                    start = i
        
        # Find end by going forward
        in_stack = False
        for i in range(match_line + 1, min(len(lines), match_line + 200)):
            line = lines[i]
            
            # Check if we hit a new log entry
            for pattern in self.compiled_end:
                if pattern.match(line):
                    return start, end, format_type
            
            # Check if this is continuation
            is_continuation = any(p.match(line) for p in self.compiled_continuation)
            
            if is_continuation:
                end = i
                in_stack = True
            elif in_stack and not line.strip():
                # Empty line after stack, might be end
                end = i
                # Check next line to be sure
                if i + 1 < len(lines):
                    next_line = lines[i + 1]
                    if not any(p.match(next_line) for p in self.compiled_continuation):
                        break
            elif not is_continuation and line.strip():
                # Non-continuation content, stop here
                break
        
        return start, end, format_type


class CorrelationTracker:
    """Tracks and groups log entries by correlation IDs"""
    
    def __init__(self):
        self.correlation_patterns = [
            r'"correlation_id"\s*:\s*"([^"]+)"',
            r'correlation_id=([a-zA-Z0-9\-_]+)',
            r'"request_id"\s*:\s*"([^"]+)"',
            r'request_id=([a-zA-Z0-9\-_]+)',
            r'"job_id"\s*:\s*"([^"]+)"',
            r'job_id=([a-zA-Z0-9\-_]+)',
            r'"trace_id"\s*:\s*"([^"]+)"',
            r'RequestId:\s*([a-zA-Z0-9\-_]+)',
            r'X-Request-Id:\s*([a-zA-Z0-9\-_]+)',
            r'"x-request-id"\s*:\s*"([^"]+)"',
        ]
        self.compiled_patterns = [re.compile(p, re.IGNORECASE) for p in self.correlation_patterns]
        self.correlation_index = defaultdict(list)
        self.id_to_entries = defaultdict(list)
    
    def extract_ids(self, line: str, line_num: int, file_path: str) -> Set[str]:
        """Extract all correlation IDs from a line"""
        ids = set()
        for pattern in self.compiled_patterns:
            matches = pattern.findall(line)
            for match in matches:
                if match and len(match) > 5:  # Avoid very short IDs
                    ids.add(match)
                    self.id_to_entries[match].append({
                        'line': line,
                        'line_num': line_num,
                        'file': file_path
                    })
        return ids
    
    def get_related_entries(self, correlation_id: str) -> List[Dict[str, Any]]:
        """Get all log entries with the same correlation ID"""
        return self.id_to_entries.get(correlation_id, [])


class FalsePositiveFilter:
    """Advanced false positive detection system"""
    
    def __init__(self):
        # System info files to skip or treat specially
        self.system_info_files = {
            'top_res', 'df_hT', 'iostat', 'sysctl_a', 'ip_address',
            'hostname', 'ntpq', 'systemctl_unit_files', 'rpm_verify',
            'sar_tcp', 'sar_network', 'sar_memory', 'sar_cpu',
            'netstat', 'ss', 'ip_route', 'iptables', 'ifconfig',
            'mount', 'lsblk', 'free', 'vmstat', 'mpstat',
            'ps_aux', 'ps_ef', 'lsof', 'ulimit', 'limits.conf',
            'ps', 'nfsstat', 'uptime', 'w', 'who', 'last'
        }
        
        # Config files to skip unless they contain actual errors
        self.config_files = {
            'sshd_config', 'ssh_config', 'gitlab.rb', 'database.yml',
            'resque.yml', 'cable.yml', 'settings.yml', 'secrets.yml',
            'unicorn.rb', 'puma.rb', 'nginx.conf'
        }
        
        # Schema/structure files that should be skipped entirely
        self.schema_files = {
            'schema.rb', 'structure.sql', 'ar_schema_dump_result',
            'db_schema', 'schema_dump', 'database_structure',
            'migrations', 'migrate'
        }
        
        # Check/diagnostic files that contain descriptions not errors
        self.diagnostic_files = {
            'praefect_check', 'gitlab_check', 'gitlab_geo_check',
            'gitlab-rake', 'gitlab-ctl', 'rake_check',
            'doctor.rb', 'check.rb', 'verify'
        }
        
        # Monitoring/observability services that are not core GitLab
        self.monitoring_services = {
            'grafana-agent', 'prometheus', 'mimir', 'loki', 'tempo',
            'otel-collector', 'otelopscol', 'telegraf', 'datadog',
            'new-relic', 'elastic-agent', 'fluentbit', 'fluentd',
            'vector', 'filebeat', 'metricbeat', 'heartbeat',
            'node-exporter', 'blackbox-exporter', 'alertmanager'
        }
        
        # Worker/Job class patterns that look like errors but aren't
        self.worker_class_patterns = [
            r'"class":"[^"]*(?:Timeout|Error|Failed|Failure|Retry|Dead|Shutdown|Crashed|Exception|Expire|Expired)Worker"',
            r'"worker":"[^"]*(?:Timeout|Error|Failed|Failure|Retry|Dead|Shutdown|Crashed|Exception)Worker"',
            r'VerificationTimeoutWorker',
            r'SyncTimeoutCronWorker',
            r'RetryWorker',
            r'DeadJobWorker',
            r'FailureWorker',
            r'ErrorTrackingWorker',
            r'ExceptionWorker',
            r'ExpireJobCacheWorker',
            r'ExpirePipelineCacheWorker',
            r'StuckCiJobsWorker',
            r'FailedPipelineWorker',
            r'TimeoutWorker',
            r'CleanupContainerExpirationPolicyWorker',
            r'DeleteExpiredJobArtifactsWorker',
            r'TimeoutPendingStatusCheckResponsesWorker',
            r'TimeoutOrphanedJobArtifactFilesWorker',
            r'ExpireBuildArtifactsWorker',
            r'Geo::[^"]*(?:Timeout|Verification|Sync|Retry|Failed)(?:Worker|CronWorker)',
            r'Ci::[^"]*(?:Timeout|Failed|Retry|Stuck)Worker',
            r'ComplianceManagement::[^"]*TimeoutWorker'
        ]
        
        # False positive patterns - comprehensive list
        self.false_positive_patterns = [
            # Command not found errors
            r'sh:\s+line\s+\d+:\s+\w+:\s+command not found',
            r'bash:\s+line\s+\d+:\s+\w+:\s+command not found',
            r':\s+command not found',
            r'command not found',
            r'chpst:\s+fatal:\s+unknown user/group',
            r'fatal:\s+unknown user/group',
            r'unknown user/group:\s+gitlab-\w+',
            
            # Success/Health indicators
            r'SUCCESS:\s+node\s+is\s+healthy',
            r'"grpc\.code":"OK"',
            r'"level":"info"',
            r'"level":"debug"',
            r'"level":"trace"',
            r'"severity":"info"',
            r'"severity":"debug"',
            r'"severity":"INFO"',
            r'"severity":"DEBUG"',
            r'level=info',
            r'level=debug',
            r'INFO\s+--',
            r'DEBUG\s+--',
            
            # Job execution (not errors)
            r'"status":"completed"',
            r'"status":"success"',
            r'"state":"finished"',
            r'"state":"completed"',
            r'completed_at":"\d{4}',
            r'succeeded_at":"\d{4}',
            
            # Normal systemd operations
            r'systemd\[\d+\]:\s+Started\s+',
            r'systemd\[\d+\]:\s+Starting\s+',
            r'systemd\[\d+\]:\s+Stopped\s+',
            r'systemd\[\d+\]:\s+Stopping\s+',
            r'\.service:\s+Succeeded',
            r'\.service:\s+Deactivated\s+successfully',
            
            # Comments and headers
            r'^\s*#',
            r'^\s*$',
            r'^-+$',
            r'^=+$',
            
            # System info output formats
            r'^\s*\d+\s+root\s+\d+\s+\d+',
            r'^Filesystem\s+Type\s+Size',
            r'^Device:\s+rrqm/s',
            r'^\w+\.\w+\s*=\s*[\d\w]+$',
            r'^[a-z\-]+\.target\s+\w+$',
            r'^\s*inet\s+\d+\.\d+\.\d+\.\d+',
            r'^total\s+used\s+free',
            
            # Schema/Migration patterns
            r't\.integer.*timeout.*default:',
            r't\.index.*failed.*where:',
            r't\.string.*error.*default:',
            r't\.boolean.*expired.*default:',
            r'add_column.*timeout',
            r'add_column.*error',
            r'add_column.*failed',
            r'create_table.*errors',
            r'create_table.*failures',
            r'remove_column.*error',
            r'add_index.*failed',
            
            # Command line arguments (not errors)
            r'--timeout\s+\d+',
            r'--error-.*\s+',
            r'--retry\s+\d+',
            r'--failed-.*',
            r'/bin/.*--.*timeout',
            r'/usr/bin/.*--.*error',
            
            # Health check endpoints
            r'GET\s+/health',
            r'GET\s+/metrics',
            r'GET\s+/-/.*health',
            r'GET\s+/-/readiness',
            r'GET\s+/-/liveness',
            r'POST\s+/api/v4/internal/check',
            
            # Normal shutdown messages
            r'Shutting down gracefully',
            r'Graceful shutdown',
            r'Received TERM signal',
            r'Stopping workers',
            r'terminate.*administrator command.*gitlab-ctl',
            
            # Deprecation warnings (not errors)
            r'will cause.*future versions',
            r'deprecated.*will be removed',
            r'DEPRECATION WARNING',
            r'is deprecated and will',
        ]
        
        # Compile all patterns for efficiency
        self.compiled_worker_patterns = [re.compile(p, re.IGNORECASE) for p in self.worker_class_patterns]
        self.compiled_false_positive_patterns = [re.compile(p, re.IGNORECASE) for p in self.false_positive_patterns]
    
    def is_false_positive(self, line: str, file_path: Path = None) -> bool:
        """Check if a line is a false positive"""
        # Check false positive patterns
        for fp_pattern in self.compiled_false_positive_patterns:
            if fp_pattern.search(line):
                return True
        
        # Check worker class names
        for worker_pattern in self.compiled_worker_patterns:
            if worker_pattern.search(line):
                # Check if it's a real error despite having Worker in name
                if '"severity":"ERROR"' in line or '"level":"error"' in line:
                    if '"exception":"' in line or 'error":"' in line:
                        return False  # Real error
                return True
        
        return False
    
    def is_schema_file(self, file_path: Path) -> bool:
        """Check if file is a database schema file"""
        filename = file_path.name.lower()
        
        for schema_indicator in self.schema_files:
            if schema_indicator.lower() in filename:
                return True
        
        return False
    
    def is_system_info_file(self, file_path: Path) -> bool:
        """Check if file is a system info file"""
        filename = file_path.name
        
        if filename in self.system_info_files:
            return True
        
        if any(cmd in filename for cmd in ['top_', 'df_', 'iostat', 'sar_', 'ps_', 'ps']):
            return True
        
        return False
    
    def is_config_file(self, file_path: Path) -> bool:
        """Check if file is a configuration file"""
        filename = file_path.name
        
        if filename.endswith(('.conf', '.config', '.cfg', '.ini', '.yaml', '.yml')):
            if '/log/' not in str(file_path):
                return True
        
        if filename in self.config_files:
            return True
        
        return False
    
    def is_monitoring_service_error(self, line: str, file_path: str) -> Tuple[bool, Optional[str]]:
        """Check if error is from monitoring infrastructure"""
        line_lower = line.lower()
        
        for service in self.monitoring_services:
            if service in line_lower:
                if f'{service}:' in line_lower or f'caller={service}' in line or f'agent={service}' in line:
                    return True, service
        
        return False, None


class TurboStreamProcessor:
    """Ultra-fast streaming processor with Aho-Corasick pre-filtering"""
    
    def __init__(self, pattern_bank: 'EnhancedPatternBank', false_positive_filter: FalsePositiveFilter = None):
        self.pattern_bank = pattern_bank
        self.false_positive_filter = false_positive_filter or FalsePositiveFilter()
        self.boundary_detector = LogBoundaryDetector()
        self.correlation_tracker = CorrelationTracker()
        self.automaton = pattern_bank.automaton if HAS_AHOCORASICK else None
        self.quick_filters = self._build_quick_filters()
    
    def _build_quick_filters(self) -> Set[str]:
        """Build set of quick filter strings for pre-checking"""
        filters = set()
        # Extract key error indicators from patterns
        for pattern in self.pattern_bank.patterns:
            # Extract simple strings from regex patterns
            simple_strings = re.findall(r'[a-z]+', pattern.pattern.lower())
            filters.update(s for s in simple_strings if len(s) > 3)
        # Add common error indicators
        filters.update(['error', 'fail', 'fatal', 'panic', 'exception', 
                       'critical', 'timeout', 'refused', 'unavailable',
                       'abort', 'crash', 'corrupt', 'invalid', 'violation'])
        return filters
    
    async def process_file_streaming(self, file_path: Path, result_queue: AsyncQueue) -> int:
        """Process file with streaming results"""
        errors_found = 0
        
        # Skip false positive files
        if self.false_positive_filter.is_schema_file(file_path):
            return 0
        if self.false_positive_filter.is_system_info_file(file_path):
            return 0
        if self.false_positive_filter.is_config_file(file_path):
            return 0
        
        try:
            # Check file size for strategy selection
            file_size = file_path.stat().st_size
            use_mmap = file_size > 50 * 1024 * 1024 and not str(file_path).endswith('.gz')
            
            if use_mmap:
                errors_found = await self._process_mmap(file_path, result_queue)
            else:
                errors_found = await self._process_regular(file_path, result_queue)
                
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
        
        return errors_found
    
    async def _process_regular(self, file_path: Path, result_queue: AsyncQueue) -> int:
        """Regular file processing with streaming and context preservation"""
        errors_found = 0
        
        # Get relevant patterns for this file type
        relevant_patterns = self._get_relevant_patterns(file_path)
        
        # Load file into memory for context extraction
        try:
            if str(file_path).endswith('.gz'):
                with gzip.open(file_path, 'rt', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
            else:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
        except Exception as e:
            print(f"Failed to read {file_path}: {e}")
            return 0
        
        # First pass: Build correlation index
        for idx, line in enumerate(lines):
            self.correlation_tracker.extract_ids(line, idx, str(file_path))
        
        # Second pass: Process errors with context
        line_buffer = deque(maxlen=10)  # Keep last 10 lines for context
        processed_lines = set()  # Track processed lines to avoid duplicates
        
        for line_number, line in enumerate(lines):
            # Skip if already processed as part of another error's context
            if line_number in processed_lines:
                line_buffer.append(line.rstrip())
                continue
            
            # Quick pre-filter
            if not self._quick_check(line):
                line_buffer.append(line.rstrip())
                continue
            
            # Check for false positives
            if self.false_positive_filter.is_false_positive(line, file_path):
                line_buffer.append(line.rstrip())
                continue
            
            # Check patterns
            for pattern in relevant_patterns:
                if pattern.id in self.pattern_bank.compiled_patterns:
                    regex = self.pattern_bank.compiled_patterns[pattern.id]
                    match = regex.search(line)
                    
                    if match:
                        # Find error boundaries for full context
                        start, end, format_type = self.boundary_detector.find_boundaries(lines, line_number)
                        
                        # Mark these lines as processed
                        for i in range(start, end + 1):
                            processed_lines.add(i)
                        
                        # Extract full context
                        context_lines = lines[start:end+1]
                        full_context = ''.join(context_lines)
                        
                        # Extract clean message
                        clean_message = self._extract_clean_message(line, pattern, context_lines)
                        
                        # Create enhanced match
                        error_match = EnhancedErrorMatch(
                            pattern=pattern,
                            matched_text=match.group(0),
                            clean_message=clean_message,
                            full_line=line.rstrip(),
                            file_path=str(file_path),
                            line_number=line_number + 1,
                            context_before=list(line_buffer)[-5:] if line_buffer else [],
                            context_after=[lines[i].rstrip() for i in range(line_number + 1, min(line_number + 6, len(lines)))],
                            full_context_text=full_context,
                            node=self._extract_node(file_path),
                            timestamp=self._extract_timestamp(line)
                        )
                        
                        # Extract additional metadata
                        self._extract_metadata(line, error_match, context_lines)
                        
                        # Extract stack trace if present
                        if format_type in ['python_stack', 'java_stack', 'go_stack', 'ruby']:
                            error_match.stack_trace = self._extract_stack_trace(context_lines, format_type)
                        
                        # Get correlation info
                        if error_match.correlation_id:
                            related = self.correlation_tracker.get_related_entries(error_match.correlation_id)
                            error_match.json_fields['related_entries_count'] = len(related)
                        
                        # Send to result queue
                        await result_queue.put({
                            'type': 'error',
                            'data': error_match.to_dict()
                        })
                        
                        errors_found += 1
                        break  # Move to next line after finding a match
            
            line_buffer.append(line.rstrip())
            
            # Progress update every 1000 lines
            if line_number > 0 and line_number % 1000 == 0:
                await result_queue.put({
                    'type': 'progress',
                    'file': str(file_path),
                    'lines_processed': line_number,
                    'total_lines': len(lines),
                    'progress_percent': (line_number / len(lines)) * 100
                })
        
        return errors_found
    
    async def _process_mmap(self, file_path: Path, result_queue: AsyncQueue) -> int:
        """Memory-mapped file processing for huge files"""
        errors_found = 0
        relevant_patterns = self._get_relevant_patterns(file_path)
        
        with open(file_path, 'r+b') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mmapped_file:
                # Process in chunks
                chunk_size = 10 * 1024 * 1024  # 10MB chunks
                offset = 0
                line_buffer = deque(maxlen=10)
                
                while offset < len(mmapped_file):
                    # Read chunk
                    end_offset = min(offset + chunk_size, len(mmapped_file))
                    
                    # Find line boundary
                    while end_offset < len(mmapped_file) and mmapped_file[end_offset-1:end_offset] != b'\n':
                        end_offset += 1
                    
                    chunk = mmapped_file[offset:end_offset].decode('utf-8', errors='ignore')
                    lines = chunk.split('\n')
                    
                    for line in lines:
                        if not line:
                            continue
                        
                        if self._quick_check(line) and not self.false_positive_filter.is_false_positive(line):
                            for pattern in relevant_patterns:
                                if pattern.id in self.pattern_bank.compiled_patterns:
                                    regex = self.pattern_bank.compiled_patterns[pattern.id]
                                    match = regex.search(line)
                                    
                                    if match:
                                        clean_message = self._extract_clean_message(line, pattern)
                                        
                                        error_match = EnhancedErrorMatch(
                                            pattern=pattern,
                                            matched_text=match.group(0),
                                            clean_message=clean_message,
                                            full_line=line,
                                            file_path=str(file_path),
                                            line_number=0,  # Line numbers not available with mmap
                                            context_before=list(line_buffer)[-5:],
                                            node=self._extract_node(file_path),
                                            timestamp=self._extract_timestamp(line)
                                        )
                                        
                                        self._extract_metadata(line, error_match)
                                        
                                        await result_queue.put({
                                            'type': 'error',
                                            'data': error_match.to_dict()
                                        })
                                        
                                        errors_found += 1
                                        break
                        
                        line_buffer.append(line)
                    
                    offset = end_offset
                    
                    # Progress update
                    await result_queue.put({
                        'type': 'progress',
                        'file': str(file_path),
                        'progress_percent': (offset / len(mmapped_file)) * 100
                    })
        
        return errors_found
    
    def _quick_check(self, line: str) -> bool:
        """Ultra-fast pre-check using Aho-Corasick or simple string matching"""
        if not line or len(line) < 10:
            return False
        
        line_lower = line.lower()
        
        # Use Aho-Corasick if available
        if self.automaton and HAS_AHOCORASICK:
            try:
                for end_index, pattern in self.automaton.iter(line_lower):
                    return True
                return False
            except:
                pass
        
        # Fallback to quick string checks
        return any(indicator in line_lower for indicator in self.quick_filters)
    
    def _extract_clean_message(self, line: str, pattern: ErrorPattern, context_lines: List[str] = None) -> str:
        """Extract clean, human-readable error message"""
        
        # Try JSON extraction first
        if line.strip().startswith('{'):
            try:
                data = json.loads(line)
                # Priority order for message extraction
                message = (
                    data.get('error_message') or
                    data.get('exception', {}).get('message') or
                    data.get('exception', {}).get('class') or
                    data.get('error') or
                    data.get('msg') or
                    data.get('message', '')
                )
                
                # Clean up common noise
                if message and message not in ['bulk_exception', 'exception', 'error']:
                    return message
                    
            except json.JSONDecodeError:
                pass
        
        # Check context lines for better message
        if context_lines:
            for ctx_line in context_lines[:5]:  # Check first 5 lines
                if ctx_line.strip().startswith('{'):
                    try:
                        data = json.loads(ctx_line)
                        message = (
                            data.get('error_message') or
                            data.get('exception', {}).get('message') or
                            data.get('error')
                        )
                        if message and message not in ['bulk_exception', 'exception', 'error']:
                            return message
                    except:
                        pass
        
        # Pattern-specific extraction
        extractors = {
            'ssl': r'(?:error|failed):\s*(.+?)(?:\n|$)',
            'timeout': r'timeout.*?:\s*(.+?)(?:\n|$)',
            'connection': r'connection.*?:\s*(.+?)(?:\n|$)',
            'postgres': r'ERROR:\s*(.+?)(?:\n|$)',
            'grpc': r'desc\s*=\s*"?([^"]+)"?',
            'redis': r'(?:Redis|REDIS).*?:\s*(.+?)(?:\n|$)',
            'sidekiq': r'(?:failed|error):\s*(.+?)(?:\n|$)',
        }
        
        for key, extractor in extractors.items():
            if key in pattern.id.lower() or key in pattern.component.lower():
                match = re.search(extractor, line, re.IGNORECASE)
                if match:
                    return match.group(1).strip()
        
        # Generic extraction
        error_patterns = [
            r'(?:ERROR|FATAL|CRITICAL|error|fail)[:\s]+(.+?)(?:\n|$)',
            r'message[:\s]+["\']*([^"\']+)',
            r'msg[:\s]+["\']*([^"\']+)',
        ]
        
        for error_pattern in error_patterns:
            match = re.search(error_pattern, line, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        
        # Fallback to pattern description
        return pattern.description or pattern.pattern[:100]
    
    def _extract_metadata(self, line: str, error_match: EnhancedErrorMatch, context_lines: List[str] = None):
        """Extract all available metadata"""
        
        # JSON extraction
        if line.strip().startswith('{'):
            try:
                data = json.loads(line)
                error_match.json_fields = data
                
                # Extract specific fields
                error_match.correlation_id = data.get('correlation_id')
                error_match.request_id = data.get('request_id')
                error_match.user_id = data.get('user_id')
                error_match.project_id = data.get('project_id')
                error_match.job_id = data.get('job_id')
                error_match.trace_id = data.get('trace_id')
                error_match.error_code = data.get('code') or data.get('status') or data.get('grpc.code')
                
            except json.JSONDecodeError:
                pass
        
        # Pattern-based extraction
        patterns = {
            'correlation_id': r'correlation_id[=:]\s*"?([a-zA-Z0-9\-_]+)"?',
            'request_id': r'request_id[=:]\s*"?([a-zA-Z0-9\-_]+)"?',
            'status_code': r'\b([45]\d{2})\s+(?:Error|Bad|Not)',
            'grpc_code': r'code\s*=\s*(\w+)',
        }
        
        for field, regex in patterns.items():
            if match := re.search(regex, line, re.IGNORECASE):
                if field == 'status_code':
                    error_match.error_code = match.group(1)
                else:
                    setattr(error_match, field, match.group(1))
        
        # Check context lines for additional metadata
        if context_lines:
            for ctx_line in context_lines:
                if not error_match.correlation_id:
                    if match := re.search(r'correlation_id[=:]\s*"?([a-zA-Z0-9\-_]+)"?', ctx_line):
                        error_match.correlation_id = match.group(1)
                if not error_match.error_code:
                    if match := re.search(r'\b([45]\d{2})\s+', ctx_line):
                        error_match.error_code = match.group(1)
    
    def _extract_stack_trace(self, lines: List[str], format_type: str) -> Optional[List[str]]:
        """Extract stack trace from context lines"""
        stack_trace = []
        
        if format_type == 'python_stack':
            in_trace = False
            for line in lines:
                if 'Traceback' in line:
                    in_trace = True
                    stack_trace.append(line.strip())
                elif in_trace:
                    if line.startswith(' ') or 'File' in line:
                        stack_trace.append(line.strip())
                    else:
                        break
        
        elif format_type == 'java_stack':
            for line in lines:
                if 'Exception' in line or line.strip().startswith('at '):
                    stack_trace.append(line.strip())
                elif 'Caused by:' in line:
                    stack_trace.append(line.strip())
        
        elif format_type == 'go_stack':
            for line in lines:
                if 'panic:' in line or 'goroutine' in line or '.go:' in line:
                    stack_trace.append(line.strip())
        
        return stack_trace if stack_trace else None
    
    def _get_relevant_patterns(self, file_path: Path) -> List[ErrorPattern]:
        """Get patterns relevant to this file type, sorted by priority"""
        
        path_str = str(file_path).lower()
        filename = file_path.name.lower()
        
        # Map file types to relevant components
        relevance_map = {
            'sidekiq': ['Sidekiq', 'Rails', 'Redis'],
            'gitaly': ['Praefect/Gitaly', 'Git/Shell'],
            'praefect': ['Praefect/Gitaly'],
            'postgresql': ['PostgreSQL'],
            'postgres': ['PostgreSQL'],
            'redis': ['Redis'],
            'nginx': ['Nginx', 'Network'],
            'workhorse': ['Workhorse', 'Rails', 'Network'],
            'gitlab-rails': ['Rails', 'Auth', 'Geo'],
            'puma': ['Puma/Workhorse', 'Rails'],
            'production': ['Rails'],
            'api_json': ['Rails'],
            'application': ['Rails'],
        }
        
        # Determine relevant components
        relevant_components = set()
        for key, components in relevance_map.items():
            if key in path_str or key in filename:
                relevant_components.update(components)
        
        # Add generic components
        relevant_components.update(['System/OS', 'Network', 'Generic'])
        
        # Filter patterns by relevance
        relevant = []
        for p in self.pattern_bank.patterns:
            if p.component in relevant_components:
                relevant.append(p)
            elif p.severity == 'CRITICAL':
                relevant.append(p)  # Always include critical patterns
        
        # Sort by priority and severity
        severity_order = {'CRITICAL': 0, 'ERROR': 1, 'WARNING': 2}
        relevant.sort(key=lambda p: (
            -p.priority,  # Higher priority first
            severity_order.get(p.severity, 3),  # Critical first
            p.id  # Alphabetical as tiebreaker
        ))
        
        return relevant
    
    def _extract_timestamp(self, line: str) -> Optional[datetime]:
        """Extract timestamp from log line"""
        patterns = [
            r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})',
            r'"time":"([^"]+)"',
            r'"timestamp":"([^"]+)"',
            r'"@timestamp":"([^"]+)"',
            r'\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*)\]',
        ]
        
        for pattern in patterns:
            if match := re.search(pattern, line):
                try:
                    timestamp_str = match.group(1).replace('T', ' ').split('.')[0].split('+')[0].split('Z')[0]
                    return datetime.fromisoformat(timestamp_str)
                except:
                    pass
        return None
    
    def _extract_node(self, file_path: Path) -> str:
        """Extract node name from file path"""
        path_str = str(file_path).lower()
        
        nodes = ['praefect', 'gitaly', 'postgresql', 'postgres', 'redis', 
                 'sidekiq', 'workhorse', 'nginx', 'puma', 'gitlab-rails',
                 'gitlab-shell', 'registry', 'pages', 'kas']
        
        for node in nodes:
            if node in path_str:
                return node
        
        return 'unknown'


class EnhancedPatternBank:
    """Complete pattern bank with all GitLab error patterns"""
    
    def __init__(self):
        self.patterns: List[ErrorPattern] = []
        self.by_component: Dict[str, List[ErrorPattern]] = defaultdict(list)
        self.by_severity: Dict[str, List[ErrorPattern]] = defaultdict(list)
        self.compiled_patterns: Dict[str, re.Pattern] = {}
        self.automaton = None
        
        self._load_all_patterns()
        self._compile_patterns()
        if HAS_AHOCORASICK:
            self._build_automaton()
    
    def _load_all_patterns(self):
        """Load ALL GitLab error patterns - COMPLETE SET FROM YOUR ORIGINAL + ENHANCED"""
        
        # ==================== PRAEFECT/GITALY PATTERNS ====================
        praefect_patterns = [
            # Connection failures - Enhanced patterns
            ErrorPattern('pg_conn_dial_fail', r'(?:ERROR|error).*dialing\s+failed.*(?:connection.*context\s+deadline\s+exceeded|deadline\s+exceeded)', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL', multiline=True),
            ErrorPattern('pg_conn_refused', r'(?:ERROR|error).*dialing\s+failed.*connection\s+refused', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pg_dial_fail', r'dialing\s+failed.*failed\s+to\s+dial', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_dial_generic', r'dialing\s+failed\s*:', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_conn_fail', r'failed\s+to\s+dial.*connection(?!.*will\s+retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_conn_refused2', r'failed\s+to\s+dial.*connection\s+refused', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_no_route', r'failed\s+to\s+dial.*no\s+route\s+to\s+host', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_net_unreach', r'failed\s+to\s+dial.*network\s+is\s+unreachable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_timeout', r'failed\s+to\s+dial.*timeout(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Praefect-specific errors - Enhanced
            ErrorPattern('pf_gitaly_conn_fail', r'praefect.*failed\s+to\s+connect\s+to\s+gitaly\s+node', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_gitaly_unreach', r'praefect.*gitaly\s+node.*unreachable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_no_healthy', r'praefect.*no\s+healthy\s+gitaly\s+nodes\s+available', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_all_down', r'praefect.*all\s+gitaly\s+nodes\s+are\s+down', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_conn_pool', r'praefect.*gitaly\s+connection\s+pool\s+exhausted', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_dial_fail', r'praefect.*gitaly.*dial.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_conn_fail2', r'praefect.*connection.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_cannot_conn', r'praefect.*cannot\s+connect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_dial_refused', r'praefect.*dial.*connection\s+refused', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_deadline', r'praefect.*context\s+deadline\s+exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_no_healthy2', r'praefect.*no\s+healthy\s+nodes', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_trans_fail', r'praefect.*transaction.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_repl_fail', r'praefect.*replication.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_primary_unreach', r'praefect.*primary.*unreachable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_voting_fail', r'praefect.*voting.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_metadata_inconsist', r'praefect.*metadata.*inconsistent', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('pf_failover', r'praefect.*failover.*triggered', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('pf_reconcil_fail', r'praefect.*reconciliation.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_datastore_err', r'praefect.*datastore.*error(?!.*INFO)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_node_mgr_err', r'praefect.*node.*manager.*error(?!.*INFO)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_coord_err', r'praefect.*coordinator.*error(?!.*INFO)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_sql_err', r'praefect.*sql.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_postgres_err', r'praefect.*postgres.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_migration_fail', r'praefect.*database.*migration.*failed', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            
            # Node health
            ErrorPattern('node_health_fail', r'failed\s+checking\s+node\s+health', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('node_check_fail', r'node\s+health\s+check\s+failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_unhealthy', r'gitaly\s+node.*is\s+not\s+healthy', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_health_fail', r'gitaly\s+node.*failed\s+health\s+check', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_node_unavail', r'praefect.*node.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_storage_unavail', r'praefect.*storage.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('health_mgr_err', r'HealthManager.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('health_check_fail', r'health.*check.*failed(?!.*will\s+retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # GRPC errors - Enhanced with more variations
            ErrorPattern('grpc_unavail', r'(?:rpc\s+error|RPC\s+error|grpc).*code\s*=\s*Unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_deadline', r'(?:rpc\s+error|RPC\s+error|grpc).*code\s*=\s*DeadlineExceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_internal', r'(?:rpc\s+error|RPC\s+error|grpc).*code\s*=\s*Internal', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_notfound', r'(?:rpc\s+error|RPC\s+error|grpc).*code\s*=\s*NotFound', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_error', r'(?:rpc\s+error|RPC\s+error).*desc\s*=', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_unavail2', r'GRPC::Unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_deadline2', r'GRPC::DeadlineExceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_internal2', r'GRPC::Internal', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_invalid', r'GRPC::InvalidArgument', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_notfound2', r'GRPC::NotFound', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_exists', r'GRPC::AlreadyExists', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_permission', r'GRPC::PermissionDenied', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_exhausted', r'GRPC::ResourceExhausted', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_precond', r'GRPC::FailedPrecondition', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_aborted', r'GRPC::Aborted', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_range', r'GRPC::OutOfRange', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_unimpl', r'GRPC::Unimplemented', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_dataloss', r'GRPC::DataLoss', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('grpc_unauth', r'GRPC::Unauthenticated', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_transient', r'all\s+SubCons\s+are\s+in\s+TransientFailure', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_core_fail', r'\[core\].*grpc.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_transport', r'grpc.*createTransport\s+failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_addrconn', r'addrConn.*createTransport\s+failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Gitaly-specific
            ErrorPattern('gitaly_deadline', r'gitaly.*deadline\s+exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_timeout', r'gitaly.*timeout(?!.*default)(?!.*integer)(?!.*t\.)(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_ctx_deadline', r'gitaly.*context\s+deadline\s+exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_op_timeout', r'gitaly.*operation.*timeout(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_timeout_gitaly', r'praefect.*timeout.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_deadline2', r'praefect.*deadline\s+exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('ctx_deadline', r'context\s+deadline\s+exceeded(?!.*will\s+retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('deadline_exceeded', r'deadline\s+exceeded(?!.*retrying)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Replication & Storage
            ErrorPattern('repl_fail', r'replication.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_event_fail', r'replication\s+event.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('voting_fail', r'voting.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('trans_fail', r'transaction.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('metadata_inconsist', r'metadata.*inconsistent', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('failover_trigger', r'failover.*triggered', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('reconcil_fail', r'reconciliation.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_exists', r'replication\s+event.*already\s+exists', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('repl_queue_full', r'replication\s+queue.*full', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_backlog', r'replication.*backlog.*exceeded', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('node_update_err', r'Error\s+updating\s+node', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('shard_err', r'error\s+getting\s+shard', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('shard_fail', r'could\s+not\s+get\s+shard', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repo_store_fail', r'repository\s+scoped\s+store.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('router_err', r'router.*error(?!.*INFO)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_job_fail', r'replication\s+job.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_assign_fail', r'praefect.*assignment.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_elector_err', r'praefect.*elector.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_repo_store_err', r'praefect.*repository.*store.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('lock_acquire_fail', r'could\s+not\s+acquire\s+lock', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('lock_timeout', r'lock.*timeout(?!.*t\.integer)(?!.*default:)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('db_locked', r'database.*is\s+locked', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Repository operations
            ErrorPattern('repo_not_found', r'gitaly.*repository.*not\s+found(?!.*creating)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repo_corrupt', r'gitaly.*repository.*corrupted', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('storage_not_found', r'gitaly.*storage.*not\s+found', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_perm_denied', r'gitaly.*permission.*denied', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('git_cmd_fail', r'gitaly.*git.*command.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_spawn_fail', r'gitaly.*spawn.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_gc_fail', r'gitaly.*gc.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_repack_fail', r'gitaly.*repack.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_housekeep_fail', r'gitaly.*housekeeping.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_cleanup_fail', r'gitaly.*cleanup.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('no_remote_head', r'no\s+remote\s+HEAD\s+found', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Streaming
            ErrorPattern('stream_internal', r'finished\s+streaming\s+call\s+with\s+code\s+Internal', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('stream_error', r'finished\s+streaming\s+call\s+with\s+error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('stream_fail', r'streaming\s+call.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_stream_fail', r'gitaly.*stream.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Virtual storage & infrastructure
            ErrorPattern('repos_unavail', r'virtual-storage.*has.*repositories.*that\s+are\s+unavailable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('repos_unavail2', r'repositories\s+that\s+are\s+unavailable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_node_unavail', r'gitaly.*node.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('storage_unavail', r'storage.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_unavail', r'gitaly.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_rpc_unavail', r'gitaly.*rpc\s+error.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_conn_reset', r'gitaly.*connection\s+reset\s+by\s+peer', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_broken_pipe', r'gitaly.*broken\s+pipe', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_transport_close', r'gitaly.*transport\s+is\s+closing', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('gitaly_shutdown', r'gitaly.*server.*shutting\s+down(?!.*gracefully)', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('gitaly_unhealthy2', r'gitaly.*unhealthy', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_not_respond', r'gitaly.*not\s+responding', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_election_fail', r'praefect.*election.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_consensus_fail', r'praefect.*consensus.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_disk_full', r'gitaly.*disk.*full', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_mem_exceeded', r'gitaly.*memory.*exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_cpu_throttle', r'gitaly.*cpu.*throttled', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            
            # Additional from docs
            ErrorPattern('jwt_verify_err', r'JWT::VerificationError', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('sig_verify_fail', r'Signature\s+verification\s+raised', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('token_expired', r'token\s+has\s+expired', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('token_untrusted', r'token\s+signed\s+by\s+untrusted\s+key', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('deny_hidden_ref', r'deny\s+updating\s+a\s+hidden\s+ref', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('pre_receive_decline', r'Pre-receive\s+hook\s+declined', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('remote_hung_up', r'fatal:\s*the\s+remote\s+end\s+hung\s+up\s+unexpectedly', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('early_eof', r'fatal:\s*early\s+EOF', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('index_pack_fail', r'index-pack\s+failed', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('fork_exec_denied', r'fork/exec.*permission\s+denied', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('op_not_permitted', r'operation\s+not\s+permitted', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('git2go_denied', r'fork/exec.*gitaly-git2go.*permission\s+denied', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('fapolicy_deny', r'fapolicyd.*denying\s+execution', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('token_expired_perm', r'permission\s+denied:\s*token\s+has\s+expired', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('timestamp_window', r'timestamp.*outside.*valid.*window', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('tls_handshake_fail', r'transport:\s*authentication\s+handshake\s+failed', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('tls_verify_fail', r'tls:\s*failed\s+to\s+verify\s+certificate', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('server_handshake_fail', r'ServerHandshake.*failed.*wrapped\s+server\s+handshake', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gpg_key_encrypted', r'invalid\s+argument:\s*signing\s+key\s+is\s+encrypted', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gpg_tag_invalid', r'invalid\s+data:\s*tag\s+byte\s+does\s+not\s+have\s+MSB\s+set', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gitaly_hooks_slow', r'gitaly-hooks.*taking.*seconds.*to\s+start', 'Praefect/Gitaly', 'performance', 'WARNING'),
            
            # Additional error level indicators
            ErrorPattern('pf_level_error', r'"level"\s*:\s*"error".*praefect(?!.*Worker)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_level_error', r'"level"\s*:\s*"error".*gitaly(?!.*Worker)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_level_error2', r'level=error.*praefect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_level_error2', r'level=error.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_error_log', r'ERROR:.*praefect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_error_log', r'ERROR:.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_fatal_log', r'FATAL:.*praefect(?!.*shutdown)', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_fatal_log', r'FATAL:.*gitaly(?!.*shutdown)', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_error_field', r'"error"\s*:\s*"[^"]+(?!.*future\s+versions)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_msg_error', r'"msg"\s*:\s*".*error(?!.*future\s+versions)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_msg_failed', r'"msg"\s*:\s*".*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
        ]
        
        # ==================== POSTGRESQL PATTERNS ====================
        postgresql_patterns = [
            ErrorPattern('pg_conn_bad', r'PG::ConnectionBad', 'PostgreSQL', 'database', 'ERROR', multiline=True),
            ErrorPattern('pg_unable_send', r'PG::UnableToSend', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_admin_shutdown', r'PG::AdminShutdown(?!.*gitlab-ctl)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_crash_shutdown', r'PG::CrashShutdown', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_cannot_conn', r'PG::CannotConnectNow', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_conn', r'PG::TooManyConnections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_conn_timeout', r'ActiveRecord::ConnectionTimeoutError', 'PostgreSQL', 'database', 'ERROR', multiline=True),
            ErrorPattern('ar_conn_not_estab', r'ActiveRecord::ConnectionNotEstablished', 'PostgreSQL', 'database', 'ERROR', multiline=True),
            ErrorPattern('pg_server_conn_fail', r'could\s+not\s+connect\s+to\s+server', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_pool_exhausted', r'connection\s+pool\s+exhausted', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_conn_fail', r'pgbouncer\s+cannot\s+connect\s+to\s+server', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_crash', r'pgbouncer.*server.*conn.*crashed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_pooler_err', r'pgbouncer.*pooler.*error', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_auth_fail', r'pgbouncer.*auth.*failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_db_disallow', r'pgbouncer.*database.*does.*not.*allow.*connections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_deadlock', r'ERROR.*deadlock\s+detected', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_serialize_fail', r'ERROR.*could\s+not\s+serialize\s+access\s+due\s+to\s+concurrent\s+update', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_duplicate_key', r'ERROR.*duplicate\s+key\s+value\s+violates\s+unique\s+constraint', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stmt_invalid', r'ActiveRecord::StatementInvalid', 'PostgreSQL', 'database', 'ERROR', multiline=True),
            ErrorPattern('ar_stmt_timeout', r'ActiveRecord::StatementTimeout', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_invalid_fkey', r'ActiveRecord::InvalidForeignKey', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_not_unique', r'ActiveRecord::RecordNotUnique', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_deadlocked', r'ActiveRecord::Deadlocked', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_query_canceled', r'PG::QueryCanceled', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_lock_not_avail', r'PG::LockNotAvailable', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_not_null_viol', r'PG::NotNullViolation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_check_viol', r'PG::CheckViolation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_exclusion_viol', r'PG::ExclusionViolation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_unique_viol', r'PG::UniqueViolation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_fkey_viol', r'PG::ForeignKeyViolation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_readonly_trans', r'PG::ReadOnlySqlTransaction.*cannot\s+execute\s+UPDATE\s+in\s+a\s+read-only\s+transaction', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stale_obj', r'ActiveRecord::StaleObjectError', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stmt_cache_exp', r'ActiveRecord::PreparedStatementCacheExpired', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_disk_full', r'PG::DiskFull', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_out_of_mem', r'PG::OutOfMemory', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_config_limit', r'PG::ConfigurationLimitExceeded', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_system_err', r'PG::SystemError', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_starting_up', r'FATAL.*the\s+database\s+system\s+is\s+starting\s+up', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shutting_down', r'FATAL.*the\s+database\s+system\s+is\s+shutting\s+down(?!.*administrator\s+command)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shared_mem_fail', r'FATAL.*could\s+not\s+map\s+anonymous\s+shared\s+memory', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_conn_slots_reserved', r'FATAL.*remaining\s+connection\s+slots\s+are\s+reserved', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_role_not_exist', r'FATAL.*role.*does\s+not\s+exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_not_exist', r'FATAL.*database.*does\s+not\s+exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_pass_auth_fail', r'FATAL.*password\s+authentication\s+failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_accessed', r'FATAL.*database.*is\s+being\s+accessed\s+by\s+other\s+users', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_admin_termination', r'FATAL.*terminating\s+connection\s+due\s+to\s+administrator\s+command(?!.*gitlab-ctl)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_idle_timeout', r'FATAL.*terminating\s+connection\s+due\s+to\s+idle-in-transaction\s+timeout', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_no_hba_entry', r'FATAL.*no\s+pg_hba\.conf\s+entry', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_clients', r'FATAL.*sorry.*too\s+many\s+clients\s+already', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_rel_not_exist', r'ERROR.*relation.*does\s+not\s+exist(?!.*creating)', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_col_not_exist', r'ERROR.*column.*does\s+not\s+exist(?!.*adding)', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_func_not_exist', r'ERROR.*function.*does\s+not\s+exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_perm_denied_rel', r'ERROR.*permission\s+denied\s+for\s+relation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_perm_denied_schema', r'ERROR.*permission\s+denied\s+for\s+schema', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_stmt_timeout', r'ERROR.*canceling\s+statement\s+due\s+to\s+statement\s+timeout', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_conflict_recovery', r'ERROR.*canceling\s+statement\s+due\s+to\s+conflict\s+with\s+recovery', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shared_preload', r'ERROR.*shared_preload_libraries', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_max_conn_exceeded', r'ERROR.*max_connections.*exceeded', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_clients2', r'ERROR.*too\s+many\s+clients\s+already', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_not_accepting', r'ERROR.*database.*is\s+not\s+accepting\s+connections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_repl_slot_not_exist', r'replication\s+slot.*does\s+not\s+exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_ahead', r'requested\s+starting\s+point.*ahead\s+of.*WAL', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_stream_fail', r'could\s+not\s+start\s+WAL\s+streaming', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_stream_repl_fail', r'streaming\s+replication.*failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_receiver_crash', r'wal_receiver.*crashed', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_wal_sender_term', r'wal_sender.*terminated', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_repl_lag_exceeded', r'replication.*lag.*exceeded', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_standby_disconnect', r'standby.*disconnected', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_primary_conn_lost', r'primary.*connection.*lost', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_panic_xlog', r'PANIC.*could\s+not\s+write\s+to\s+file\s+pg_xlog', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_wal_refs', r'PANIC.*WAL\s+contains\s+references\s+to\s+invalid\s+pages', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_checkpoint', r'PANIC.*could\s+not\s+locate\s+a\s+valid\s+checkpoint\s+record', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_page_ptr', r'PANIC.*corrupted\s+page\s+pointers', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_invalid_page', r'PANIC.*invalid\s+page\s+in\s+block', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_checkpoint_freq', r'LOG.*checkpoints\s+are\s+occurring\s+too\s+frequently', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pgbouncer_conn_crash', r'WARNING.*pgbouncer.*server\s+connection.*crashed', 'PostgreSQL', 'database', 'ERROR'),
        ]
        
        # ==================== REDIS PATTERNS ====================
        redis_patterns = [
            ErrorPattern('redis_conn_refused', r'Redis.*connection.*refused', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_timeout', r'Redis.*timeout(?!.*t\.integer)(?!.*default:)', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_timeout_err', r'Redis::TimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_read_timeout', r'Redis::ReadTimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_write_timeout', r'Redis::WriteTimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_err', r'Redis::ConnectionError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_cannot_conn', r'Redis::CannotConnectError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_protocol_err', r'Redis::ProtocolError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_fail', r'Could\s+not\s+connect\s+to\s+Redis', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_lost', r'Redis.*connection.*lost', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_dropped', r'Redis.*connection.*dropped', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_misconf', r'MISCONF\s+Redis\s+is\s+configured\s+to\s+save\s+RDB\s+snapshots.*unable\s+to\s+persist', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_oom', r'OOM\s+command\s+not\s+allowed\s+when\s+used\s+memory', 'Redis', 'cache', 'CRITICAL'),
            ErrorPattern('redis_mem_critical', r'Redis.*memory.*usage.*critical', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_maxmem_policy', r'Redis.*maxmemory.*policy.*triggered', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_readonly', r'Redis.*READONLY.*You.*can.*t.*write', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_clusterdown', r'Redis.*CLUSTERDOWN.*Hash.*slot.*not.*served', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_moved', r'Redis.*MOVED.*slot', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_ask', r'Redis.*ASK.*slot', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_tryagain', r'Redis.*TRYAGAIN.*Multiple.*keys.*request', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_crossslot', r'Redis.*CROSSSLOT.*Keys.*in.*request', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_masterdown', r'Redis.*MASTERDOWN.*Link.*with.*MASTER.*is.*down', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_sentinel_err', r'Redis.*sentinel.*error', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_failover_fail', r'Redis.*failover.*failed', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_master_not_found', r'Redis.*master.*not.*found', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_slave_not_found', r'Redis.*slave.*not.*found', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_repl_err', r'Redis.*replication.*error', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_noauth', r'Redis.*NOAUTH.*Authentication.*required', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_wrongtype', r'Redis.*WRONGTYPE.*Operation.*against.*key', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_execabort', r'Redis.*EXECABORT.*Transaction.*discarded', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_loading', r'Redis.*LOADING.*Redis.*is.*loading', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_busy', r'Redis.*BUSY.*Redis.*is.*busy', 'Redis', 'cache', 'WARNING'),
            ErrorPattern('redis_noscript', r'Redis.*NOSCRIPT.*No.*matching.*script', 'Redis', 'cache', 'ERROR'),
        ]
        
        # ==================== SIDEKIQ PATTERNS ====================
        sidekiq_patterns = [
            ErrorPattern('sidekiq_retry_err', r'Sidekiq.*RetryError', 'Sidekiq', 'background_jobs', 'ERROR', multiline=True),
            ErrorPattern('sidekiq_shutdown', r'Sidekiq.*Shutdown(?!.*graceful)', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_redis_timeout', r'Sidekiq.*Redis::TimeoutError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_redis_conn', r'Sidekiq.*Redis::ConnectionError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_timeout', r'Sidekiq.*job.*timeout', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_mem_exceeded', r'Sidekiq.*memory.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_queue_full', r'Sidekiq.*queue.*full', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_worker_died', r'Sidekiq.*worker.*died', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_poison_pill', r'Sidekiq.*poison.*pill', 'Sidekiq', 'background_jobs', 'CRITICAL'),
            ErrorPattern('sidekiq_malformed_job', r'Sidekiq.*malformed.*job', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_deserial_fail', r'Sidekiq.*deserialization.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_middleware_err', r'Sidekiq.*middleware.*error', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_scheduler_err', r'Sidekiq.*scheduler.*error', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_cron_fail', r'Sidekiq.*cron.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_batch_fail', r'Sidekiq.*batch.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_unique_conflict', r'Sidekiq.*unique.*job.*conflict', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_rate_limit', r'Sidekiq.*rate.*limit.*exceeded', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_circuit_open', r'Sidekiq.*circuit.*breaker.*open', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_dead_queue', r'Sidekiq.*dead.*job.*queue', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_retry_exhausted', r'Sidekiq.*retry.*exhausted', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_processor_crash', r'Sidekiq.*processor.*crashed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_heartbeat_fail', r'Sidekiq.*heartbeat.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_thread_died', r'Sidekiq.*thread.*died', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_manager_died', r'Sidekiq.*manager.*died', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_launcher_died', r'Sidekiq.*launcher.*died', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_fetcher_died', r'Sidekiq.*fetcher.*died', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_oom_killed', r'Sidekiq.*OOM.*killed', 'Sidekiq', 'background_jobs', 'CRITICAL'),
            ErrorPattern('sidekiq_mem_limit', r'Sidekiq.*memory.*limit.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_queue_latency', r'Sidekiq.*queue.*latency.*high', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_worker_stuck', r'Sidekiq.*worker.*stuck', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_timeout_exceed', r'Sidekiq.*job.*timeout.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_redis_pool_exhaust', r'Sidekiq.*Redis.*connection.*pool.*exhausted', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('job_failed_times', r'Job.*failed.*times', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('job_raised_exception', r'Job\s+raised\s+exception', 'Sidekiq', 'background_jobs', 'ERROR', multiline=True),
            ErrorPattern('job_status_failed', r'job_status.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('active_job_failed', r'ActiveJob.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('failed_process_args', r'Failed\s+to\s+process.*with\s+args', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_retries_exhausted', r'sidekiq_retries_exhausted', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_busy_high', r'Busy:.*Enqueued:.*[1-9]\d+', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_threads_busy', r'Threads:.*\(\d+\s+busy\)', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_eof_reached', r'end\s+of\s+file\s+reached.*Sidekiq', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_record_not_found', r'WARN.*ActiveRecord::RecordNotFound', 'Sidekiq', 'background_jobs', 'WARNING'),
            
            # Job interruption patterns
            ErrorPattern('sidekiq_interrupted_exhausted', r'sidekiq_interruptions_exhausted', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_interrupted_count_exceeded', r'interrupted_count.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_interrupted_max_retries', r'max_retries_after_interruption.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_interrupted_queue_full', r'interrupted.*queue.*full', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_adding_dead_job_interrupted', r'adding\s+dead.*job.*to\s+interrupted\s+queue', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_worker_dead_cleanup', r'worker_dead.*cleaning.*working\s+queue', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_job_cancelled', r'Canceling\s+thread\s+with\s+CancelledError', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_cancelled_error', r'Gitlab::SidekiqDaemon::Monitor::CancelledError', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_monitor_exception', r'sidekiq_daemon.*monitor.*exception', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_exceed_limit_error', r'ExceedLimitError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_exceeds_payload', r'job\s+exceeds\s+payload\s+size\s+limit', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_payload_too_large', r'payload.*size.*exceeded.*limit', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_compression_failed', r'compression.*failed.*job.*payload', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_duplicate_check_fail', r'duplicate.*job.*check.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_idempotency_key_fail', r'idempotency.*key.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_duplicate_cookie_fail', r'duplicate.*cookie.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_concurrency_limit_exceeded', r'concurrency.*limit.*exceeded', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_concurrency_deferred', r'job.*deferred.*concurrency', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_concurrency_tracker_stale', r'concurrency.*tracker.*stale', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_unrouted_api_error', r'UnroutedSidekiqApiError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_redis_outside_via', r'Sidekiq\s+Redis\s+called\s+outside\s+a\s+\.via\s+block', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_invalid_routing_rule', r'InvalidRoutingRuleError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_unknown_predicate', r'WorkerMatcher::UnknownPredicate', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_no_metadata_error', r'NoMetadataError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_invalid_queue_error', r'InvalidQueueError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_status_expired', r'sidekiq.*status.*expired', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_enqueue_from_transaction', r'EnqueueFromTransactionError', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_cannot_enqueue_transaction', r'cannot\s+be\s+enqueued\s+inside\s+a\s+transaction', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_retry_handled', r'Sidekiq::JobRetry::Handled', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_job_retry_skip', r'Sidekiq::JobRetry::Skip', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_job_status_fail', r'"job_status"\s*:\s*"fail"', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_dropped', r'"job_status"\s*:\s*"dropped"', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_job_deferred', r'"job_status"\s*:\s*"deferred"', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_watchdog_too_fast', r'systemd\s+Watchdog\s+too\s+fast', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_watchdog_fail', r'watchdog.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_resource_limit_exceeded', r'resource.*usage.*limit.*exceeded', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_cpu_limit_exceeded', r'cpu.*limit.*exceeded.*sidekiq', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_memory_usage_high', r'memory.*usage.*high.*sidekiq', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_import_stuck', r'stuck.*import.*job', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_export_stuck', r'stuck.*export.*job', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_merge_stuck', r'stuck.*merge.*job', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_import_jid_expired', r'import.*jid.*expired', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('bulk_import_pipeline_fail', r'Pipeline\s+failed.*bulk.*import', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('bulk_import_retrying', r'Retrying\s+pipeline.*bulk.*import', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('bulk_import_invalid_status', r'Pipeline\s+in\s+invalid\s+status', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('bulk_import_batch_fail', r'Batch\s+export.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_exception_class', r'"exception\.class"\s*:\s*"[^"]+"', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_exception_message', r'"exception\.message"\s*:\s*"[^"]+"', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_error_message', r'"error_message"\s*:\s*"[^"]+"', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_error_class', r'"error_class"\s*:\s*"[^"]+"', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_jobs_dead_total', r'sidekiq_jobs_dead_total', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_job_moved_to_dead', r'job.*moved.*to.*dead.*set', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('reliable_fetch_cleanup_fail', r'Reliable.*Fetcher.*cleanup.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('reliable_fetch_working_queue_fail', r'Reliable.*Fetcher.*working.*queue.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('reliable_fetch_heartbeat_missing', r'heartbeat.*missing.*worker.*dead', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_admin_mode_bypass_fail', r'admin.*mode.*bypass.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_logger_warn', r'Sidekiq\.logger\.warn', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_logger_error', r'Sidekiq\.logger\.error', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_perform_failure', r'perform_failure.*exception', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_fail_op', r'status_event.*fail_op', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_correlation_missing', r'correlation_id.*missing.*sidekiq', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_scheduling_latency_high', r'scheduling_latency_s.*[5-9]\d+', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_queue_duration_high', r'queue_duration_s.*[1-9]\d{2,}', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_worker_context_fail', r'worker.*context.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_dedup_wal_fail', r'dedup.*wal.*location.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_dedup_strategy_fail', r'deduplication.*strategy.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
        ]
        
        # ==================== RAILS APPLICATION PATTERNS ====================
        rails_patterns = [
            ErrorPattern('av_template_err', r'ActionView::Template::Error', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('ac_routing_err', r'ActionController::RoutingError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ac_unknown_format', r'ActionController::UnknownFormat', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ac_param_missing', r'ActionController::ParameterMissing', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ac_unpermitted_params', r'ActionController::UnpermittedParameters', 'Rails', 'application', 'WARNING'),
            ErrorPattern('ad_mime_invalid', r'ActionDispatch::Http::MimeNegotiation::InvalidType', 'Rails', 'application', 'ERROR'),
            ErrorPattern('am_validation_err', r'ActiveModel::ValidationError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_record_invalid', r'ActiveRecord::RecordInvalid', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_record_not_found', r'ActiveRecord::RecordNotFound', 'Rails', 'application', 'WARNING'),
            ErrorPattern('ar_record_not_saved', r'ActiveRecord::RecordNotSaved', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_record_not_destroyed', r'ActiveRecord::RecordNotDestroyed', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_unknown_attr', r'ActiveRecord::UnknownAttributeError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_attr_assignment', r'ActiveRecord::AttributeAssignmentError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_stale_object', r'ActiveRecord::StaleObjectError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('ar_stmt_cache_expired', r'ActiveRecord::PreparedStatementCacheExpired', 'Rails', 'application', 'WARNING'),
            ErrorPattern('as_msg_verifier_invalid', r'ActiveSupport::MessageVerifier::InvalidSignature', 'Rails', 'application', 'ERROR'),
            ErrorPattern('as_msg_encryptor_invalid', r'ActiveSupport::MessageEncryptor::InvalidMessage', 'Rails', 'application', 'ERROR'),
            ErrorPattern('am_unknown_attr', r'ActiveModel::UnknownAttributeError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('validation_fail_blank', r"Validation\s+failed.*can't\s+be\s+blank", 'Rails', 'application', 'ERROR'),
            ErrorPattern('size_cant_blank', r"Size\s+can't\s+be\s+blank", 'Rails', 'application', 'ERROR'),
            ErrorPattern('no_method_err', r'NoMethodError.*undefined\s+method', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('name_err', r'NameError.*undefined.*variable', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('argument_err', r'ArgumentError', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('runtime_err', r'RuntimeError', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('standard_err', r'StandardError', 'Rails', 'application', 'ERROR', multiline=True),
            ErrorPattern('load_err', r'LoadError.*cannot\s+load\s+such\s+file', 'Rails', 'application', 'ERROR'),
            ErrorPattern('type_err', r'TypeError.*no\s+implicit\s+conversion', 'Rails', 'application', 'ERROR'),
            ErrorPattern('stack_err', r'SystemStackError.*stack\s+level\s+too\s+deep', 'Rails', 'application', 'ERROR'),
            ErrorPattern('json_parse_err', r'JSON::ParserError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('yaml_syntax_err', r'YAML::SyntaxError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('encoding_undef_conv', r'Encoding::UndefinedConversionError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('encoding_invalid_byte', r'Encoding::InvalidByteSequenceError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('uri_invalid', r'URI::InvalidURIError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('timeout_err', r'Timeout::Error', 'Rails', 'application', 'ERROR'),
            ErrorPattern('execution_expired', r'execution\s+expired', 'Rails', 'application', 'ERROR'),
            ErrorPattern('rack_timeout', r'Rack::Timeout::RequestTimeoutException', 'Rails', 'application', 'ERROR'),
            ErrorPattern('gitlab_deadline_exceeded', r'Gitlab::RequestContext::RequestDeadlineExceeded', 'Rails', 'application', 'ERROR'),
        ]
        
        # ==================== KUBERNETES/HELM PATTERNS ====================
        kubernetes_patterns = [
            ErrorPattern('k8s_job_backoff', r'Job\s+failed:\s*BackoffLimitExceeded', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_no_deployed', r'UPGRADE\s+FAILED:.*has\s+no\s+deployed\s+releases', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_patch_fail', r'UPGRADE\s+FAILED:\s*cannot\s+patch.*with\s+kind\s+Deployment', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_type_mismatch', r'UPGRADE\s+FAILED:\s*type\s+mismatch', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_args_err', r'Error:\s*this\s+command\s+needs\s+2\s+arguments', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_drop_view_err', r'Error:\s*cannot\s+drop\s+view.*because\s+extension.*requires\s+it', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_image_pull_backoff', r'ImagePullBackOff', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_err_image_pull', r'ErrImagePull', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_failed_pull_image', r'Failed\s+to\s+pull\s+image', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_manifest_unknown', r'manifest\s+unknown', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_kex_exchange', r'kex_exchange_identification:\s*Connection\s+closed\s+by\s+remote\s+host', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_system_oom', r'System\s+OOM\s+encountered,\s*victim\s+process', 'Kubernetes/Helm', 'kubernetes', 'CRITICAL'),
            ErrorPattern('k8s_mem_cgroup_oom', r'Memory\s+cgroup\s+out\s+of\s+memory', 'Kubernetes/Helm', 'kubernetes', 'CRITICAL'),
        ]
        
        # ==================== SSL/CERTIFICATES PATTERNS ====================
        ssl_patterns = [
            ErrorPattern('ssl_local_issuer', r'unable\s+to\s+get\s+local\s+issuer\s+certificate', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_verify_first', r'unable\s+to\s+verify\s+the\s+first\s+certificate', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_unknown_authority', r'certificate\s+signed\s+by\s+unknown\s+authority', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_self_signed', r'self\s+signed\s+certificate\s+in\s+certificate\s+chain', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_x509_legacy', r'x509:\s*certificate\s+relies\s+on\s+legacy\s+Common\s+Name\s+field', 'SSL/Certificates', 'security', 'WARNING'),
            ErrorPattern('ssl_key_mismatch', r'X\.509\s+key\s+values\s+mismatch', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_key_mismatch2', r'key\s+values\s+mismatch', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_untrusted_root', r'SEC_E_UNTRUSTED_ROOT', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_problem', r'SSL\s+certificate\s+problem', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_connect_err', r'SSL_connect\s+returned=1\s+errno=0\s+state=error', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_x509_routines', r'SSL:\s*error:.*:x509\s+certificate\s+routines', 'SSL/Certificates', 'security', 'ERROR'),
        ]
        
        # ==================== GEO REPLICATION PATTERNS ====================
        geo_patterns = [
            ErrorPattern('geo_secondary_not_config', r'Geo\s+secondary\s+database\s+is\s+not\s+configured', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_db_writable', r'Geo\s+site\s+has\s+a\s+database\s+that\s+is\s+writable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_tracking_not_config', r'Geo.*tracking\s+database.*not\s+configured', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_conflict_recovery', r'ERROR:\s*canceling\s+statement\s+due\s+to\s+conflict\s+with\s+recovery', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_not_checksummable', r'Repository\s+cannot\s+be\s+checksummable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_file_not_checksummable', r'File\s+is\s+not\s+checksummable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_primary_missing', r'The\s+file\s+is\s+missing\s+on\s+the\s+Geo\s+primary\s+site', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_primary_missing_file', r'"primary_missing_file"\s*:\s*true', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_verification_timeout', r'Verification\s+timed\s+out\s+after', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_unexpected_disconnect', r'unexpected\s+disconnect\s+while\s+reading\s+sideband\s+packet', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_failed_sync', r'@failed-geo-sync', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_site_unhealthy', r'Geo.*site.*unhealthy', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_repos_unavail', r'Geo.*repositories.*unavailable', 'Geo', 'replication', 'CRITICAL'),
            ErrorPattern('geo_tracking_inconsist', r'Geo.*tracking.*inconsistent', 'Geo', 'replication', 'ERROR'),
        ]
        
        # ==================== ALL OTHER PATTERNS ====================
        other_patterns = [
            # Nginx - Enhanced patterns
            ErrorPattern('nginx_worker_exit', r'nginx.*worker.*process.*exited.*on.*signal(?!.*reload)', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_close', r'nginx.*upstream.*prematurely.*closed.*connection', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_ssl_handshake', r'nginx.*SSL.*handshake.*failed', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_client_large_body', r'nginx.*client.*intended.*to.*send.*too.*large.*body', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_invalid', r'nginx.*upstream.*sent.*invalid.*header', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_connect_refused', r'nginx.*connect.*failed.*Connection.*refused', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_recv_reset', r'nginx.*recv.*failed.*Connection.*reset.*by.*peer', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_timeout', r'upstream.*timed\s+out(?!.*retry)', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_no_live_upstream', r'no\s+live\s+upstreams', 'Nginx', 'proxy', 'ERROR'),
            
            # Workhorse patterns (all categories) - Enhanced
            ErrorPattern('workhorse_keywatcher_eof', r'keywatcher:.*pubsub\s+receive:.*EOF', 'Workhorse', 'redis', 'ERROR'),
            ErrorPattern('workhorse_keywatcher_misconf', r'keywatcher:.*pubsub\s+receive:.*MISCONF', 'Workhorse', 'redis', 'ERROR'),
            ErrorPattern('workhorse_redis_no_connection', r'no\s+redis\s+connection', 'Workhorse', 'redis', 'ERROR'),
            ErrorPattern('workhorse_redis_sentinel_unreachable', r'all\s+sentinels.*are\s+unreachable', 'Workhorse', 'redis', 'ERROR'),
            ErrorPattern('workhorse_keywatcher_unknown_msg', r'keywatcher:\s*unknown:', 'Workhorse', 'redis', 'ERROR'),
            ErrorPattern('workhorse_gitaly_lookup_fail', r'look\s+up\s+for\s+gitaly\s+connection', 'Workhorse', 'gitaly', 'ERROR'),
            ErrorPattern('workhorse_gitaly_sidechannel_err', r'sidechannel\s+error', 'Workhorse', 'gitaly', 'ERROR'),
            ErrorPattern('workhorse_gitaly_archive_fail', r'SendArchive:.*failed', 'Workhorse', 'gitaly', 'ERROR'),
            ErrorPattern('workhorse_gitaly_diff_fail', r'diff\.RawDiff:', 'Workhorse', 'gitaly', 'ERROR'),
            ErrorPattern('workhorse_gitaly_snapshot_fail', r'SendSnapshot:.*copy\s+gitaly\s+output', 'Workhorse', 'gitaly', 'ERROR'),
            ErrorPattern('workhorse_upload_injected_param', r'injected\s+client\s+parameter', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_upload_too_many_files', r'upload\s+request\s+contains\s+more\s+than.*files', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_upload_unexpected_eof', r'unexpected\s+EOF\s+when\s+reading\s+multipart', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_upload_entity_too_large', r'entity\s+too\s+large', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_upload_exif_removal_fail', r'error\s+while\s+removing\s+EXIF', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_upload_persist_fail', r'persisting\s+multipart\s+file', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_objectstore_invalid_status', r'PUT\s+request.*returned:', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_objectstore_put_fail', r'PUT\s+request.*:', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_queue_too_many_requests', r'too\s+many\s+requests\s+queued', 'Workhorse', 'queueing', 'ERROR'),
            ErrorPattern('workhorse_queue_timeout', r'queueing\s+timedout', 'Workhorse', 'queueing', 'ERROR'),
            ErrorPattern('workhorse_api_no_response', r'no\s+api\s+response:\s*status', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_api_preauth_fail', r'preAuthorizeHandler.*do\s+request', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_api_decode_fail', r'decode\s+authorization\s+response', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_api_response_limit', r'response\s+body\s+exceeded\s+maximum\s+buffer\s+size', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_api_audit_event_fail', r'failed\s+to\s+send\s+git\s+audit\s+event', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_geoproxy_fail', r'GetGeoProxyData:', 'Workhorse', 'api', 'ERROR'),
            ErrorPattern('workhorse_git_busyreader_err', r'busyReader:', 'Workhorse', 'git', 'ERROR'),
            ErrorPattern('workhorse_git_coupledwriter_err', r'coupledWriter:', 'Workhorse', 'git', 'ERROR'),
            ErrorPattern('workhorse_git_limit_error', r'handling\s+limit\s+error', 'Workhorse', 'git', 'ERROR'),
            ErrorPattern('workhorse_http_no_content_length', r'header\s+Content-Length\s+was\s+not\s+set', 'Workhorse', 'http', 'ERROR'),
            ErrorPattern('workhorse_http_range_not_supported', r'range\s+requests\s+are\s+not\s+supported', 'Workhorse', 'http', 'ERROR'),
            ErrorPattern('workhorse_http_invalid_range', r'invalid\s+range', 'Workhorse', 'http', 'ERROR'),
            ErrorPattern('workhorse_http_content_changed', r'content\s+has\s+changed\s+since\s+first\s+request', 'Workhorse', 'http', 'ERROR'),
            ErrorPattern('workhorse_zip_invalid', r'zip\s+archive\s+format\s+invalid', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_zip_entry_not_found', r'zip\s+entry\s+not\s+found', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_zip_archive_not_found', r'zip\s+archive\s+not\s+found', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_zip_limits_reached', r'zip\s+processing\s+limits\s+reached', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_channel_connect_fail', r'Channel:\s*connecting\s+to\s+server\s+failed', 'Workhorse', 'websocket', 'ERROR'),
            ErrorPattern('workhorse_channel_upgrade_fail', r'upgrading\s+client\s+to\s+websocket\s+failed', 'Workhorse', 'websocket', 'ERROR'),
            ErrorPattern('workhorse_tls_cert_fail', r'TLS.*certificate', 'Workhorse', 'tls', 'ERROR'),
            ErrorPattern('workhorse_tls_handshake_fail', r'TLS\s+handshake', 'Workhorse', 'tls', 'ERROR'),
            ErrorPattern('workhorse_context_deadline', r'context\s+deadline\s+exceeded', 'Workhorse', 'timeout', 'ERROR'),
            ErrorPattern('workhorse_context_canceled', r'context\s+canceled', 'Workhorse', 'timeout', 'WARNING'),
            ErrorPattern('workhorse_sendurl_copy_fail', r'SendURL:\s*Copy\s+response', 'Workhorse', 'sendurl', 'ERROR'),
            ErrorPattern('workhorse_body_limit_exceeded', r'body\s+limit.*exceeded', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_invalid_body_limit_mode', r'invalid\s+body\s+limit\s+mode', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_builds_invalid_content_type', r'invalid\s+content-type\s+received', 'Workhorse', 'ci', 'ERROR'),
            ErrorPattern('workhorse_fullduplex_enable_fail', r'enabling\s+full\s+duplex', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_panic_recovered', r'panic.*recovered', 'Workhorse', 'application', 'CRITICAL'),
            ErrorPattern('workhorse_handler_aborted', r'Handler\s+aborted\s+connection', 'Workhorse', 'application', 'WARNING'),
            ErrorPattern('workhorse_err', r'Workhorse.*error(?!.*INFO)(?!.*retry)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_timeout', r'Workhorse.*timeout(?!.*increased)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_conn_fail', r'Workhorse.*connection.*failed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_upload_fail', r'Workhorse.*upload.*failed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_badgateway', r'badgateway:.*failed\s+to\s+receive\s+response(?!.*retry)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('puma_worker_timeout', r'Puma.*timed\s+out.*worker', 'Puma/Workhorse', 'application', 'ERROR'),
            ErrorPattern('puma_worker_spinning', r'Puma.*worker.*spinning\s+at\s+100%', 'Puma/Workhorse', 'application', 'ERROR'),
            ErrorPattern('workhorse_gocloud_bucket_create_fail', r'error\s+creating\s+GoCloud\s+bucket', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_gocloud_write_fail', r'error\s+writing\s+to\s+GoCloud\s+bucket', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_gocloud_close_fail', r'error\s+closing\s+GoCloud\s+bucket', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_gocloud_delete_fail', r'error\s+deleting\s+object', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_gocloud_bucket_open_fail', r'error\s+opening\s+bucket\s+for\s+delete', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_multipart_not_enough_parts', r'not\s+enough\s+Parts', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_multipart_complete_fail', r'CompleteMultipartUpload\s+request.*returned', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_multipart_decode_fail', r'decode\s+CompleteMultipartUpload\s+answer', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_multipart_empty_result', r'empty\s+CompleteMultipartUploadResult', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_multipart_remote_error', r'CompleteMultipartUpload\s+remote\s+error', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_part_upload_fail', r'upload\s+part\s+\d+:', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_part_buffer_create_fail', r'create\s+temporary\s+buffer\s+file', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_part_buffer_copy_fail', r'copy\s+to\s+temporary\s+buffer\s+file', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_part_rewind_fail', r'rewind\s+part\s+\d+\s+temporary\s+dump', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_s3_missing_deadline', r'missing\s+deadline', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_azure_credentials_fail', r'error\s+creating\s+Azure\s+credentials', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_azure_default_creds_fail', r'error\s+creating\s+default\s+Azure\s+credentials', 'Workhorse', 'objectstore', 'ERROR'),
            ErrorPattern('workhorse_image_resize_fail', r'read\s+image\s+resize\s+params', 'Workhorse', 'imageresizer', 'ERROR'),
            ErrorPattern('workhorse_image_open_fail', r'open\s+image\s+data\s+stream', 'Workhorse', 'imageresizer', 'ERROR'),
            ErrorPattern('workhorse_image_resize_concurrency_limit', r'concurrency_limit_exceeds', 'Workhorse', 'imageresizer', 'WARNING'),
            ErrorPattern('workhorse_image_resize_cmd_fail', r'gitlab-resize-image.*failed', 'Workhorse', 'imageresizer', 'ERROR'),
            ErrorPattern('workhorse_image_file_too_large', r'image.*exceeds.*max.*filesize', 'Workhorse', 'imageresizer', 'WARNING'),
            ErrorPattern('workhorse_circuit_breaker_open', r'circuit\s+breaker.*open', 'Workhorse', 'circuitbreaker', 'WARNING'),
            ErrorPattern('workhorse_circuit_breaker_error', r'gobreaker:.*error', 'Workhorse', 'circuitbreaker', 'ERROR'),
            ErrorPattern('workhorse_circuit_breaker_too_many_requests', r'This\s+endpoint\s+has\s+been\s+requested\s+too\s+many\s+times', 'Workhorse', 'circuitbreaker', 'ERROR'),
            ErrorPattern('workhorse_terminal_connect_fail', r'terminal.*connect.*failed', 'Workhorse', 'terminal', 'ERROR'),
            ErrorPattern('workhorse_terminal_upgrade_fail', r'terminal.*upgrade.*failed', 'Workhorse', 'terminal', 'ERROR'),
            ErrorPattern('workhorse_terminal_timeout', r'terminal.*timeout', 'Workhorse', 'terminal', 'ERROR'),
            ErrorPattern('workhorse_websocket_dial_fail', r'websocket.*dial.*failed', 'Workhorse', 'websocket', 'ERROR'),
            ErrorPattern('workhorse_dependency_proxy_fail', r'dependency.*proxy.*failed', 'Workhorse', 'dependencyproxy', 'ERROR'),
            ErrorPattern('workhorse_dependency_proxy_inject_fail', r'dependency.*proxy.*inject.*failed', 'Workhorse', 'dependencyproxy', 'ERROR'),
            ErrorPattern('workhorse_senddata_inject_fail', r'senddata.*inject.*failed', 'Workhorse', 'senddata', 'ERROR'),
            ErrorPattern('workhorse_senddata_header_missing', r'senddata.*header.*missing', 'Workhorse', 'senddata', 'WARNING'),
            ErrorPattern('workhorse_archive_cleaner_walk_fail', r'error\s+walking\s+archive\s+cleaner\s+path', 'Workhorse', 'archive', 'ERROR'),
            ErrorPattern('workhorse_archive_cleaner_remove_fail', r'error\s+walking\s+archiveCleaner\s+path\s+for\s+empty\s+directories', 'Workhorse', 'archive', 'ERROR'),
            ErrorPattern('workhorse_healthcheck_fail', r'health.*check.*failed', 'Workhorse', 'healthcheck', 'ERROR'),
            ErrorPattern('workhorse_readiness_fail', r'readiness.*check.*failed', 'Workhorse', 'healthcheck', 'ERROR'),
            ErrorPattern('workhorse_geo_proxy_url_parse_fail', r'Could\s+not\s+parse\s+Geo\s+proxy\s+URL', 'Workhorse', 'geo', 'ERROR'),
            ErrorPattern('workhorse_geo_proxy_status_fail', r'GetGeoProxyData:\s*Received\s+HTTP\s+status\s+code', 'Workhorse', 'geo', 'ERROR'),
            ErrorPattern('workhorse_cert_pool_load_fail', r'failed\s+to\s+load\s+system\s+cert\s+pool', 'Workhorse', 'tls', 'ERROR'),
            ErrorPattern('workhorse_config_redis_fail', r'unable\s+to\s+configure\s+redis\s+client', 'Workhorse', 'config', 'ERROR'),
            ErrorPattern('workhorse_config_parse_fail', r'failed\s+to\s+parse.*config', 'Workhorse', 'config', 'ERROR'),
            ErrorPattern('workhorse_metrics_error', r'prometheus.*error', 'Workhorse', 'metrics', 'ERROR'),
            ErrorPattern('workhorse_static_page_fail', r'static.*page.*failed', 'Workhorse', 'staticpages', 'ERROR'),
            ErrorPattern('workhorse_artifact_metadata_fail', r'artifact.*metadata.*failed', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_artifact_format_invalid', r'artifact.*format.*invalid', 'Workhorse', 'artifacts', 'ERROR'),
            ErrorPattern('workhorse_package_upload_fail', r'package.*upload.*failed', 'Workhorse', 'packages', 'ERROR'),
            ErrorPattern('workhorse_package_nuget_fail', r'nuget.*failed', 'Workhorse', 'packages', 'ERROR'),
            ErrorPattern('workhorse_package_pypi_fail', r'pypi.*failed', 'Workhorse', 'packages', 'ERROR'),
            ErrorPattern('workhorse_package_helm_fail', r'helm.*failed', 'Workhorse', 'packages', 'ERROR'),
            ErrorPattern('workhorse_lsif_parse_fail', r'lsif\s+parser:', 'Workhorse', 'lsif', 'ERROR'),
            ErrorPattern('workhorse_lsif_zip_cache_fail', r'cached\s+incoming\s+LSIF\s+zip.*failed', 'Workhorse', 'lsif', 'ERROR'),
            ErrorPattern('workhorse_lsif_transform_fail', r'lsif.*transform.*failed', 'Workhorse', 'lsif', 'ERROR'),
            ErrorPattern('workhorse_jwt_sign_fail', r'secret\.JWTTokenString:\s*sign\s+JWT', 'Workhorse', 'auth', 'ERROR'),
            ErrorPattern('workhorse_secret_bytes_fail', r'secret\.JWTTokenString:', 'Workhorse', 'auth', 'ERROR'),
            ErrorPattern('workhorse_token_invalid', r'token.*invalid', 'Workhorse', 'auth', 'ERROR'),
            ErrorPattern('workhorse_badgateway_no_response', r'badgateway:\s*failed\s+to\s+receive\s+response', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_badgateway_context_canceled', r'badgateway.*context.*canceled', 'Workhorse', 'proxy', 'WARNING'),
            ErrorPattern('workhorse_duo_workflow_fail', r'duo.*workflow.*failed', 'Workhorse', 'ai', 'ERROR'),
            ErrorPattern('workhorse_duo_workflow_client_fail', r'duo.*workflow.*client.*error', 'Workhorse', 'ai', 'ERROR'),
            ErrorPattern('workhorse_duo_workflow_action_fail', r'duo.*workflow.*action.*failed', 'Workhorse', 'ai', 'ERROR'),
            ErrorPattern('workhorse_sendfile_fail', r'sendfile.*failed', 'Workhorse', 'sendfile', 'ERROR'),
            ErrorPattern('workhorse_sendfile_inject_fail', r'sendfile.*inject.*failed', 'Workhorse', 'sendfile', 'ERROR'),
            ErrorPattern('workhorse_forward_headers_fail', r'forward.*headers.*failed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_method_not_allowed', r'method.*not.*allowed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_transport_restricted', r'transport.*restricted', 'Workhorse', 'transport', 'ERROR'),
            ErrorPattern('workhorse_transport_allowed_ip_error', r'AllowedIPError', 'Workhorse', 'transport', 'ERROR'),
            ErrorPattern('workhorse_transport_cidr_parse_fail', r'error\s+parsing.*CIDR', 'Workhorse', 'transport', 'ERROR'),
            ErrorPattern('workhorse_listener_fail', r'listener.*failed', 'Workhorse', 'server', 'ERROR'),
            ErrorPattern('workhorse_listener_tls_fail', r'listener.*TLS.*failed', 'Workhorse', 'server', 'ERROR'),
            ErrorPattern('workhorse_version_mismatch', r'version.*mismatch', 'Workhorse', 'version', 'WARNING'),
            ErrorPattern('workhorse_url_prefix_invalid', r'url.*prefix.*invalid', 'Workhorse', 'config', 'ERROR'),
            ErrorPattern('workhorse_gob_encode_fail', r'gob.*encode.*failed', 'Workhorse', 'encoding', 'ERROR'),
            ErrorPattern('workhorse_gob_decode_fail', r'gob.*decode.*failed', 'Workhorse', 'encoding', 'ERROR'),
            ErrorPattern('workhorse_build_register_fail', r'build.*register.*failed', 'Workhorse', 'ci', 'ERROR'),
            ErrorPattern('workhorse_runner_register_fail', r'runner.*register.*failed', 'Workhorse', 'ci', 'ERROR'),
            ErrorPattern('workhorse_import_fail', r'import.*failed', 'Workhorse', 'import', 'ERROR'),
            ErrorPattern('workhorse_export_fail', r'export.*failed', 'Workhorse', 'export', 'ERROR'),
            ErrorPattern('workhorse_group_import_fail', r'group.*import.*failed', 'Workhorse', 'import', 'ERROR'),
            ErrorPattern('workhorse_metric_image_upload_fail', r'metric.*image.*upload.*failed', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_work_items_csv_import_fail', r'work_items.*import_csv.*failed', 'Workhorse', 'import', 'ERROR'),
            ErrorPattern('workhorse_wiki_attachment_fail', r'wiki.*attachment.*failed', 'Workhorse', 'upload', 'ERROR'),
            ErrorPattern('workhorse_correlation_id_missing', r'correlation.*id.*missing', 'Workhorse', 'logging', 'WARNING'),
            ErrorPattern('workhorse_helper_fail', r'helper.*failed', 'Workhorse', 'util', 'ERROR'),
            ErrorPattern('workhorse_command_fail', r'command.*failed', 'Workhorse', 'util', 'ERROR'),
            ErrorPattern('workhorse_range_seek_fail', r'range.*seek.*failed', 'Workhorse', 'http', 'ERROR'),
            ErrorPattern('workhorse_deploy_page_fail', r'deploy.*page.*failed', 'Workhorse', 'staticpages', 'ERROR'),
            
            # Git/Shell
            ErrorPattern('gitlab_shell_err', r'GitLab.*Shell.*error(?!.*INFO)', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('gitlab_shell_auth_fail', r'GitLab.*Shell.*authentication.*failed', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('gitlab_shell_perm_denied', r'GitLab.*Shell.*permission.*denied', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_remote_hung_up', r'fatal:.*The\s+remote\s+end\s+hung\s+up\s+unexpectedly', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_not_repo', r'fatal:.*not\s+a\s+git\s+repository', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_repo_corrupt', r'fatal:.*repository.*corrupt', 'Git/Shell', 'git_access', 'CRITICAL'),
            ErrorPattern('git_could_not_read', r'Could\s+not\s+read\s+from\s+remote\s+repository', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_push_fail', r'error:.*failed\s+to\s+push\s+some\s+refs', 'Git/Shell', 'git_access', 'ERROR'),
            
            # CI/CD - Enhanced
            ErrorPattern('pipeline_fail', r'Pipeline.*failed(?!.*retry)(?!.*t\.index)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('job_fail_exit', r'Job.*failed.*exit.*code.*[1-9]\d*(?!.*will\s+retry)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_not_avail', r'Runner.*not.*available', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_auth_fail', r'Runner.*authentication.*failed', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_executor_err', r'Runner.*executor.*error', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('build_fail', r'Build.*failed(?!.*rebuilding)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('job_timeout', r'ERROR:\s*Job\s+failed:\s*execution\s+took\s+longer\s+than', 'CI/CD', 'ci_cd', 'ERROR'),
            
            # Auth - Enhanced
            ErrorPattern('http_401', r'\b401\s+Unauthorized\b', 'Auth', 'security', 'ERROR'),
            ErrorPattern('http_403', r'\b403\s+Forbidden\b', 'Auth', 'security', 'ERROR'),
            ErrorPattern('oauth_err', r'OAuth.*error', 'Auth', 'security', 'ERROR'),
            ErrorPattern('oauth2_invalid', r'OAuth2.*invalid.*grant', 'Auth', 'security', 'ERROR'),
            ErrorPattern('jwt_expired', r'JWT.*expired', 'Auth', 'security', 'ERROR'),
            ErrorPattern('jwt_sig_fail', r'JWT.*signature.*verification.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('auth_fail', r'authentication.*failed(?!.*handshake)(?!.*context\s+deadline)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('pass_auth_fail', r'password\s+authentication\s+failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('ldap_auth_fail', r'LDAP.*authentication.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('saml_auth_fail', r'SAML.*authentication.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('perm_denied', r'permission\s+denied(?!.*dial)(?!.*connection)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('rack_attack', r'Rack_Attack', 'Auth', 'security', 'WARNING'),
            ErrorPattern('invalid_token', r'Invalid.*token', 'Auth', 'security', 'ERROR'),
            ErrorPattern('ldap_conn_fail', r'LDAP.*connection.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('auth_fail2', r'auth.*failed(?!.*handshake)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('access_denied', r'access.*denied', 'Auth', 'security', 'ERROR'),
            ErrorPattern('unauthorized', r'unauthorized', 'Auth', 'security', 'ERROR'),
            
            # Network - Enhanced
            ErrorPattern('tcp_conn_refused', r'Failed\s+to\s+open\s+TCP\s+connection.*Connection\s+refused', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('conn_timeout', r'Connection\s+timed\s+out(?!.*retry)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('net_unreachable', r'Network\s+is\s+unreachable', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('conn_reset_peer', r'Connection\s+reset\s+by\s+peer(?!.*client)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('broken_pipe', r'Broken\s+pipe(?!.*client)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('no_route_host', r'No\s+route\s+to\s+host', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('name_service_unknown', r'Name\s+or\s+service\s+not\s+known', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_502', r'\b502\s+Bad\s+Gateway\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_503', r'\b503\s+Service\s+Unavailable\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_504', r'\b504\s+Gateway\s+Timeout\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_500', r'\b500\s+Internal\s+Server\s+Error\b', 'Network', 'infrastructure', 'ERROR'),
            
            # System/OS - Enhanced
            ErrorPattern('oom', r'Out\s+of\s+memory(?!.*available)', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('oom_killer', r'OOM\s+killer', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('cannot_alloc_mem', r'Cannot\s+allocate\s+memory', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('no_space_left', r'No\s+space\s+left\s+on\s+device', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('disk_quota_exceeded', r'Disk\s+quota\s+exceeded', 'System/OS', 'system', 'ERROR'),
            ErrorPattern('too_many_open_files', r'Too\s+many\s+open\s+files', 'System/OS', 'system', 'ERROR'),
            ErrorPattern('segfault', r'segmentation\s+fault', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('kernel_killed', r'kernel:.*killed\s+process', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('filesystem_full', r'filesystem.*full', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('inode_exhausted', r'inode.*exhausted', 'System/OS', 'system', 'CRITICAL'),
            
            # Generic critical errors - Enhanced
            ErrorPattern('level_error', r'"level"\s*:\s*"error".*"error"\s*:\s*"[^"]+"(?!.*Worker)(?!.*retry)(?!.*INFO)', 'Generic', 'generic', 'ERROR'),
            ErrorPattern('level_fatal', r'"level"\s*:\s*"fatal"(?!.*shutdown)(?!.*stopping)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('fatal_error', r'FATAL:(?!.*terminating.*administrator)(?!.*shutting\s+down)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('critical_error', r'CRITICAL:(?!.*INFO)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('panic', r'PANIC:', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('kernel_panic', r'kernel\s+panic', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('unhandled_exception', r'unhandled\s+exception', 'Generic', 'generic', 'ERROR', multiline=True),
            ErrorPattern('uncaught_exception', r'uncaught\s+exception', 'Generic', 'generic', 'ERROR', multiline=True),
        ]
        
        # Combine all patterns
        all_patterns = (
            praefect_patterns + postgresql_patterns + redis_patterns +
            sidekiq_patterns + rails_patterns + kubernetes_patterns +
            ssl_patterns + geo_patterns + other_patterns
        )
        
        self.patterns.extend(all_patterns)
        
    def _compile_patterns(self):
        """Compile patterns with caching"""
        for pattern in self.patterns:
            try:
                self.compiled_patterns[pattern.id] = re2.compile(
                    pattern.pattern, 
                    re2.IGNORECASE | re2.MULTILINE
                )
            except Exception as e:
                print(f"Failed to compile pattern {pattern.id}: {e}")
    
    def _build_automaton(self):
        """Build Aho-Corasick automaton for ultra-fast multi-pattern matching"""
        if not HAS_AHOCORASICK:
            return
        self.automaton = pyahocorasick.Automaton()
        
        for pattern in self.patterns:
            # Extract literal strings from regex
            literals = self._extract_literals(pattern.pattern)
            for literal in literals:
                self.automaton.add_word(literal.lower(), pattern)
        
        self.automaton.make_automaton()
        print(f"✅ Built Aho-Corasick automaton with {len(self.automaton)} patterns")
    
    def _extract_literals(self, regex_pattern: str) -> List[str]:
        """Extract literal strings from regex for Aho-Corasick"""
        literals = []
        
        # Remove regex special chars to get literals
        cleaned = re.sub(r'[\\^$*+?{}\[\]().|]', ' ', regex_pattern)
        words = cleaned.split()
        
        # Filter meaningful words (>3 chars)
        literals = [w.lower() for w in words if len(w) > 3]
        
        return literals if literals else [regex_pattern[:20]]


class TurboAutoGrep:
    """Main analyzer with streaming and parallel processing"""
    
    def __init__(self, workers: int = None):
        self.workers = workers or min(mp.cpu_count(), 16)  # Use more cores
        self.pattern_bank = EnhancedPatternBank()
        self.results_queue = None
        self.stats = {
            'files_processed': 0,
            'lines_processed': 0,
            'errors_found': 0,
            'start_time': None,
            'end_time': None
        }
    
    async def analyze_tar_streaming(self, tar_path: str, callback=None):
        """Analyze with streaming results"""
        print(f"\n{'='*80}")
        print(f"🚀 TURBO AUTOGREP - Starting streaming analysis")
        print(f"⚡ Using {self.workers} parallel workers")
        print(f"{'='*80}\n")
        
        self.stats['start_time'] = time.time()
        self.results_queue = AsyncQueue()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Extract archive
            print("📦 Extracting archive...")
            files = self._extract_tar(tar_path, temp_dir)
            print(f"📋 Found {len(files)} files to analyze")
            
            # Start result collector
            results = []
            collector_task = asyncio.create_task(
                self._collect_results(self.results_queue, results, callback)
            )
            
            # Process files in parallel
            print(f"⚡ Processing with {self.workers} workers...")
            await self._process_files_parallel_async(files)
            
            # Signal completion
            await self.results_queue.put({'type': 'complete'})
            
            # Wait for collector
            await collector_task
            
            self.stats['end_time'] = time.time()
            
            # Group and analyze results
            analyzed_results = self._analyze_results(results)
            
            return analyzed_results
    
    async def _process_files_parallel_async(self, files: List[Path]):
        """Process files in parallel with async/await"""
        
        # Create processor pool
        processors = [
            TurboStreamProcessor(self.pattern_bank) 
            for _ in range(self.workers)
        ]
        
        # Create tasks
        tasks = []
        for i, file_path in enumerate(files):
            processor = processors[i % self.workers]
            task = processor.process_file_streaming(
                file_path, 
                self.results_queue
            )
            tasks.append(task)
        
        # Run all tasks concurrently
        results = await asyncio.gather(*tasks)
        
        self.stats['files_processed'] = len(files)
        self.stats['errors_found'] = sum(results)
    
    async def _collect_results(self, queue: AsyncQueue, results: List, callback):
        """Collect streaming results"""
        while True:
            try:
                item = await queue.get()
                
                if item['type'] == 'complete':
                    break
                elif item['type'] == 'error':
                    results.append(item['data'])
                    self.stats['errors_found'] += 1
                    
                    # Stream to callback if provided
                    if callback:
                        await callback(item['data'])
                        
                elif item['type'] == 'progress':
                    # Handle progress updates
                    if callback:
                        await callback({'type': 'progress', **item})
                        
            except Exception as e:
                print(f"Collector error: {e}")
    
    def _analyze_results(self, results: List[Dict]) -> Dict[str, Any]:
        """Analyze and group results"""
        
        print(f"🔍 Analyzing {len(results)} error results...")
        
        # DEBUG: Print first result to see structure
        if results:
            print(f"📋 First result keys: {list(results[0].keys())}")
            print(f"📋 First result sample: {results[0].get('message', 'NO MESSAGE')[:100]}")
        
        # Group by signature
        error_groups = defaultdict(list)
        
        for error in results:
            # Create signature for grouping
            sig = self._create_signature(error)
            error_groups[sig].append(error)
        
        print(f"📊 Created {len(error_groups)} error groups from {len(results)} errors")
        
        # Build final report
        report = {
            'summary': self.stats,
            'total_errors': len(results),
            'unique_patterns': len(error_groups),
            'errors_by_severity': self._group_by_severity(results),
            'errors_by_component': self._group_by_component(results),
            'error_groups': [],
            'top_errors': []
        }
        
        # Process error groups
        for sig, errors in error_groups.items():
            group = {
                'signature': sig,
                'count': len(errors),
                'message': errors[0]['message'],  # Clean message
                'severity': errors[0]['severity'],
                'component': errors[0]['component'],
                'pattern_id': errors[0]['pattern_id'],
                'samples': errors[:3],  # Keep first 3 full samples
                'files': list(set(e['file_path'] for e in errors)),
                'has_correlation': any(e.get('correlation_id') for e in errors),
                'has_stack_trace': any(e.get('stack_trace') for e in errors)
            }
            report['error_groups'].append(group)
        
        print(f"✅ Built {len(report['error_groups'])} error groups")
        
        # Sort by frequency
        report['error_groups'].sort(key=lambda x: x['count'], reverse=True)
        report['top_errors'] = report['error_groups'][:10]
        
        print(f"📊 Top error: {report['top_errors'][0]['message'][:100] if report['top_errors'] else 'NONE'}")
        
        return report
    
    def _create_signature(self, error: Dict) -> str:
        """Create signature for grouping similar errors"""
        # Use pattern_id + normalized message
        message = error.get('message', '')
        
        # Normalize message
        normalized = re.sub(r'\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}', 'TIMESTAMP', message)
        normalized = re.sub(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', 'UUID', normalized)
        normalized = re.sub(r'\b\d+\b', 'N', normalized)
        
        return f"{error['pattern_id']}:{normalized[:100]}"
    
    def _group_by_severity(self, results: List[Dict]) -> Dict[str, int]:
        """Group errors by severity"""
        severity_counts = defaultdict(int)
        for error in results:
            severity_counts[error['severity']] += 1
        return dict(severity_counts)
    
    def _group_by_component(self, results: List[Dict]) -> Dict[str, int]:
        """Group errors by component"""
        component_counts = defaultdict(int)
        for error in results:
            component_counts[error['component']] += 1
        return dict(component_counts)
    
    def _extract_tar(self, tar_path: str, dest: str) -> List[Path]:
        """Extract tar and return file paths"""
        files = []
        
        if tar_path.endswith('.gz'):
            mode = 'r:gz'
        else:
            mode = 'r'
            
        with tarfile.open(tar_path, mode) as tar:
            tar.extractall(dest)
            
            for root, _, filenames in os.walk(dest):
                for filename in filenames:
                    files.append(Path(root) / filename)
        
        return files


# Export main class
AutoGrep = TurboAutoGrep

if __name__ == "__main__":
    main()