#!/usr/bin/env python3
"""
AUTOGREP -  GitLab Error Analyzer
Enhanced with false positive filtering and monitoring separation
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
from typing import Dict, List, Set, Tuple, Optional, Any, Iterator, NamedTuple
from collections import defaultdict, Counter, deque
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from functools import lru_cache
import multiprocessing as mp
from queue import Queue, Empty
import threading
import heapq

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


@dataclass(frozen=True)
class ErrorPattern:
    """Immutable error pattern definition"""
    id: str
    pattern: str
    component: str
    category: str
    severity: str = 'ERROR'
    description: str = ''
    
    def __hash__(self):
        return hash((self.id, self.pattern))


@dataclass
class ErrorMatch:
    """Structured error match with full context"""
    pattern: ErrorPattern
    matched_text: str
    line: str
    file_path: str
    line_number: int
    timestamp: Optional[datetime] = None
    node: str = 'unknown'
    context_before: List[str] = field(default_factory=list)
    context_after: List[str] = field(default_factory=list)
    correlation_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    signature: Optional[str] = None
    
    def __post_init__(self):
        if not self.signature:
            self.signature = self._generate_signature()
    
    def _generate_signature(self) -> str:
        """Generate unique signature for error clustering"""
        clean_text = re.sub(r'\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}', '', self.matched_text)
        clean_text = re.sub(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', 'UUID', clean_text)
        clean_text = re.sub(r'\b\d+\b', 'N', clean_text)
        
        sig_input = f"{self.pattern.component}:{self.pattern.id}:{clean_text[:100]}"
        return hashlib.md5(sig_input.encode()).hexdigest()[:16]


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
            # Command not found errors (NEW - ADDED AT TOP)
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
            
            # Process listings showing commands
            r'^\s*\d+\s+.*ruby.*sidekiq.*--timeout',
            r'^\s*git\s+\d+.*ruby.*timeout',
            r'/opt/gitlab/.*--timeout',
            
            # Thread/Stack traces showing gem paths (not errors)
            r'Thread:.*gems.*rack-timeout',
            r'<Thread:.*rack-timeout.*>',
            r'/gems/.*timeout.*\.rb',
            r'/gems/.*error.*\.rb',
            r'/lib/ruby/.*timeout',
            
            # Health check endpoints (even with 50x)
            r'GET\s+/health.*50[0-9]',
            r'GET\s+/metrics.*50[0-9]',
            r'GET\s+/-/.*health.*50[0-9]',
            r'GET\s+/-/readiness.*50[0-9]',
            r'GET\s+/-/liveness.*50[0-9]',
            r'POST\s+/api/v4/internal/check.*50[0-9]',
            r'GET\s+/health',
            r'GET\s+/metrics',
            r'GET\s+/-/.*health',
            r'GET\s+/-/readiness',
            r'GET\s+/-/liveness',
            r'POST\s+/api/v4/internal/check',
            
            # Check output descriptions
            r'Checking\s+.*\s+\[(?:fatal|error|warning)\]',
            r'checks if.*\[(?:fatal|error|warning)\]',
            r'confirms if.*\[(?:fatal|error|warning)\]',
            r'verifies if.*error',
            r'Testing.*failed',
            
            # Normal job/worker execution
            r'"jid":"[^"]+","class":"[^"]*Worker".*"status":"completed"',
            r'"worker":"[^"]*Worker".*"duration":\d+',
            r'"class":"[^"]*Worker".*"completed_at"',
            r'"class":"[^"]*Worker".*INFO',
            
            # GitLab normal operations
            r'gitlab-ctl\s+stop',
            r'gitlab-ctl\s+restart',
            r'gitlab-ctl\s+reconfigure',
            r'Reconfigured successfully',
            r'Upgrade complete',
            
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
            
            # Performance metrics (not errors)
            r'"redis_calls":\d+,"redis_duration_s"',
            r'"redis_read_bytes":\d+,"redis_write_bytes"',
            r'"db_count":\d+,"db_duration_s"',
            r'"cpu_s":\d+\.\d+,"mem_objects"',
            
            # Normal git operations
            r'git-upload-pack.*exit.*status.*0',
            r'git-receive-pack.*exit.*status.*0',
            r'Counting objects',
            r'Compressing objects',
            r'Writing objects',
            
            # Prometheus scraping (normal)
            r'msg="Scrape.*succeeded"',
            r'scrape_duration_seconds',
            r'scrape_samples_scraped',
            
            # Normal Redis operations
            r'redis.*PING.*PONG',
            r'redis.*Connected to Redis',
            r'redis.*Reconnected to Redis'
        ]
        
        # Compile all patterns for efficiency
        self.compiled_worker_patterns = [re.compile(p, re.IGNORECASE) for p in self.worker_class_patterns]
        self.compiled_false_positive_patterns = [re.compile(p, re.IGNORECASE) for p in self.false_positive_patterns]
    
    def is_monitoring_service_error(self, line: str, file_path: str) -> Tuple[bool, Optional[str]]:
        """Check if error is from monitoring infrastructure not core GitLab"""
        line_lower = line.lower()
        
        for service in self.monitoring_services:
            if service in line_lower:
                if f'{service}:' in line_lower or f'caller={service}' in line or f'agent={service}' in line:
                    return True, service
                if any(mon_url in line for mon_url in ['mimir.', 'loki.', 'tempo.', 'prometheus.', 'grafana.']):
                    return True, service
        
        monitoring_indicators = [
            'failed pushing to ingester',
            'Failed to send batch',
            'Failed to scrape',
            'Exporting failed',
            'non-recoverable error.*push',
            'server returned HTTP status.*mimir',
            'server returned HTTP status.*prometheus',
            'ts=.*caller=dedupe.go'
        ]
        
        for indicator in monitoring_indicators:
            if re.search(indicator, line, re.IGNORECASE):
                return True, 'monitoring'
        
        return False, None
    
    def is_worker_class_name(self, line: str) -> bool:
        """Check if the match is just a worker class name, not an actual error"""
        for pattern in self.compiled_worker_patterns:
            if pattern.search(line):
                error_indicators = [
                    '"severity":"ERROR"',
                    '"level":"error"',
                    'failed permanently',
                    'exhausted',
                    'crashed',
                    'exception":"',
                    'error":"'
                ]
                
                if not any(indicator in line for indicator in error_indicators):
                    return True
                
                success_indicators = [
                    '"status":"completed"',
                    '"severity":"INFO"',
                    '"level":"info"',
                    'completed_at"',
                    'succeeded_at"',
                    '"duration_ms":',
                    'enqueued_at"'
                ]
                
                if any(indicator in line for indicator in success_indicators):
                    return True
        
        return False
    
    def is_normal_shutdown(self, line: str) -> bool:
        """Check if this is a normal shutdown operation"""
        shutdown_patterns = [
            r'terminating connection due to administrator command',
            r'Received TERM signal',
            r'Shutting down gracefully',
            r'Graceful shutdown',
            r'gitlab-ctl stop',
            r'gitlab-ctl restart',
            r'Stopping workers',
            r'terminate.*administrator.*gitlab-ctl',
            r'the database system is shutting down.*administrator',
            r'process already finished',
            r'waiting for supervised command',
            r'wrapper for process shutting down'
        ]
        
        for pattern in shutdown_patterns:
            if re.search(pattern, line, re.IGNORECASE):
                return True
        
        if 'administrator command' in line and any(cmd in line for cmd in ['gitlab-ctl', 'systemctl', 'service']):
            return True
        
        return False
    
    def is_diagnostic_output(self, file_path: Path) -> bool:
        """Check if file contains diagnostic tool output with descriptions"""
        filename = file_path.name.lower()
        for diag_file in self.diagnostic_files:
            if diag_file.lower() in filename:
                return True
        return False
    
    def is_schema_file(self, file_path: Path) -> bool:
        """Check if file is a database schema file"""
        filename = file_path.name.lower()
        
        for schema_indicator in self.schema_files:
            if schema_indicator.lower() in filename:
                return True
        
        if filename.endswith(('.sql', '.rb')):
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    first_lines = ''.join(f.readlines(100))
                    if any(indicator in first_lines for indicator in [
                        'CREATE TABLE', 'ALTER TABLE', 'add_column',
                        't.integer', 't.string', 't.index',
                        'ActiveRecord::Schema', 'create_table'
                    ]):
                        return True
            except:
                pass
        
        return False
    
    def is_system_info_file(self, file_path: Path) -> bool:
        """Check if file is a system info file (not a log)"""
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


class PatternBank:
    """Central repository of ALL GitLab error patterns - COMPLETE SET"""
    
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
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            # Connection failures
            ErrorPattern('pg_conn_dial_fail', r'ERROR:\s*dialing failed:.*connection.*context deadline exceeded', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pg_conn_refused', r'ERROR:\s*dialing failed:.*connection refused', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pg_dial_fail', r'dialing failed:\s*failed to dial', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_dial_generic', r'dialing failed:', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_conn_fail', r'failed to dial.*connection(?!.*will retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_conn_refused2', r'failed to dial.*connection refused', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_no_route', r'failed to dial.*no route to host', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_net_unreach', r'failed to dial.*network is unreachable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pg_timeout', r'failed to dial.*timeout(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Praefect-specific errors
            ErrorPattern('pf_gitaly_conn_fail', r'praefect.*failed to connect to gitaly node', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_gitaly_unreach', r'praefect.*gitaly node.*unreachable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_no_healthy', r'praefect.*no healthy gitaly nodes available', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_all_down', r'praefect.*all gitaly nodes are down', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_conn_pool', r'praefect.*gitaly connection pool exhausted', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_dial_fail', r'praefect.*gitaly.*dial.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_conn_fail2', r'praefect.*connection.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_cannot_conn', r'praefect.*cannot connect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_dial_refused', r'praefect.*dial.*connection refused', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_deadline', r'praefect.*context deadline exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_no_healthy2', r'praefect.*no healthy nodes', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
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
            ErrorPattern('node_health_fail', r'failed checking node health', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('node_check_fail', r'node health check failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_unhealthy', r'gitaly node.*is not healthy', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_health_fail', r'gitaly node.*failed health check', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_node_unavail', r'praefect.*node.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_storage_unavail', r'praefect.*storage.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('health_mgr_err', r'HealthManager.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('health_check_fail', r'health.*check.*failed(?!.*will retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # GRPC errors
            ErrorPattern('grpc_unavail', r'rpc error:\s*code\s*=\s*Unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_deadline', r'rpc error:\s*code\s*=\s*DeadlineExceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_internal', r'rpc error:\s*code\s*=\s*Internal', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_notfound', r'rpc error:\s*code\s*=\s*NotFound', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('grpc_error', r'rpc error:.*desc\s*=', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
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
            ErrorPattern('grpc_transient', r'all SubCons are in TransientFailure', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_core_fail', r'\[core\].*grpc:.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_transport', r'grpc:.*createTransport failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('grpc_addrconn', r'addrConn.*createTransport failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Gitaly-specific
            ErrorPattern('gitaly_deadline', r'gitaly.*deadline exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_timeout', r'gitaly.*timeout(?!.*default)(?!.*integer)(?!.*t\.)(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_ctx_deadline', r'gitaly.*context deadline exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_op_timeout', r'gitaly.*operation.*timeout(?!.*--timeout)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_timeout_gitaly', r'praefect.*timeout.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_deadline2', r'praefect.*deadline exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('ctx_deadline', r'context deadline exceeded(?!.*will retry)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('deadline_exceeded', r'deadline exceeded(?!.*retrying)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Replication & Storage
            ErrorPattern('repl_fail', r'replication.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_event_fail', r'replication event.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('voting_fail', r'voting.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('trans_fail', r'transaction.*failed(?!.*t\.)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('metadata_inconsist', r'metadata.*inconsistent', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('failover_trigger', r'failover.*triggered', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('reconcil_fail', r'reconciliation.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_exists', r'replication event.*already exists', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('repl_queue_full', r'replication queue.*full', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_backlog', r'replication.*backlog.*exceeded', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('node_update_err', r'Error updating node', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('shard_err', r'error getting shard', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('shard_fail', r'could not get shard', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repo_store_fail', r'repository scoped store.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('router_err', r'router.*error(?!.*INFO)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repl_job_fail', r'replication job.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_assign_fail', r'praefect.*assignment.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_elector_err', r'praefect.*elector.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_repo_store_err', r'praefect.*repository.*store.*error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('lock_acquire_fail', r'could not acquire lock', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('lock_timeout', r'lock.*timeout(?!.*t\.integer)(?!.*default:)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('db_locked', r'database.*is locked', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Repository operations
            ErrorPattern('repo_not_found', r'gitaly.*repository.*not found(?!.*creating)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('repo_corrupt', r'gitaly.*repository.*corrupted', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('storage_not_found', r'gitaly.*storage.*not found', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_perm_denied', r'gitaly.*permission.*denied', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('git_cmd_fail', r'gitaly.*git.*command.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_spawn_fail', r'gitaly.*spawn.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_gc_fail', r'gitaly.*gc.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_repack_fail', r'gitaly.*repack.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_housekeep_fail', r'gitaly.*housekeeping.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_cleanup_fail', r'gitaly.*cleanup.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('no_remote_head', r'no remote HEAD found', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Streaming
            ErrorPattern('stream_internal', r'finished streaming call with code Internal', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('stream_error', r'finished streaming call with error', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('stream_fail', r'streaming call.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_stream_fail', r'gitaly.*stream.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            
            # Virtual storage & infrastructure
            ErrorPattern('repos_unavail', r'virtual-storage.*has.*repositories.*that are unavailable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('repos_unavail2', r'repositories that are unavailable', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_node_unavail', r'gitaly.*node.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('storage_unavail', r'storage.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_unavail', r'gitaly.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_rpc_unavail', r'gitaly.*rpc error.*unavailable', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_conn_reset', r'gitaly.*connection reset by peer', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_broken_pipe', r'gitaly.*broken pipe', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_transport_close', r'gitaly.*transport is closing', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('gitaly_shutdown', r'gitaly.*server.*shutting down(?!.*gracefully)', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            ErrorPattern('gitaly_unhealthy2', r'gitaly.*unhealthy', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_not_respond', r'gitaly.*not responding', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_election_fail', r'praefect.*election.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_consensus_fail', r'praefect.*consensus.*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_disk_full', r'gitaly.*disk.*full', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_mem_exceeded', r'gitaly.*memory.*exceeded', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_cpu_throttle', r'gitaly.*cpu.*throttled', 'Praefect/Gitaly', 'infrastructure', 'WARNING'),
            
            # Additional from docs
            ErrorPattern('jwt_verify_err', r'JWT::VerificationError', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('sig_verify_fail', r'Signature verification raised', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('token_expired', r'token has expired', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('token_untrusted', r'token signed by untrusted key', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('deny_hidden_ref', r'deny updating a hidden ref', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('pre_receive_decline', r'Pre-receive hook declined', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('remote_hung_up', r'fatal: the remote end hung up unexpectedly', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('early_eof', r'fatal: early EOF', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('index_pack_fail', r'index-pack failed', 'Praefect/Gitaly', 'git', 'ERROR'),
            ErrorPattern('fork_exec_denied', r'fork/exec.*permission denied', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('op_not_permitted', r'operation not permitted', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('git2go_denied', r'fork/exec.*gitaly-git2go.*permission denied', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('fapolicy_deny', r'fapolicyd.*denying execution', 'Praefect/Gitaly', 'system', 'ERROR'),
            ErrorPattern('token_expired_perm', r'permission denied: token has expired', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('timestamp_window', r'timestamp.*outside.*valid.*window', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('tls_handshake_fail', r'transport: authentication handshake failed', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('tls_verify_fail', r'tls: failed to verify certificate', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('server_handshake_fail', r'ServerHandshake.*failed.*wrapped server handshake', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gpg_key_encrypted', r'invalid argument: signing key is encrypted', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gpg_tag_invalid', r'invalid data: tag byte does not have MSB set', 'Praefect/Gitaly', 'security', 'ERROR'),
            ErrorPattern('gitaly_hooks_slow', r'gitaly-hooks.*taking.*seconds.*to start', 'Praefect/Gitaly', 'performance', 'WARNING'),
            
            # === NEW ADDITIONAL PATTERNS APPENDED ===
            # Additional error level indicators
            ErrorPattern('pf_level_error', r'"level":"error".*praefect(?!.*Worker)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_level_error', r'"level":"error".*gitaly(?!.*Worker)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_level_error2', r'level=error.*praefect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_level_error2', r'level=error.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_error_log', r'ERROR:.*praefect', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('gitaly_error_log', r'ERROR:.*gitaly', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_fatal_log', r'FATAL:.*praefect(?!.*shutdown)', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('gitaly_fatal_log', r'FATAL:.*gitaly(?!.*shutdown)', 'Praefect/Gitaly', 'infrastructure', 'CRITICAL'),
            ErrorPattern('pf_error_field', r'"error":"[^"]+(?!.*future versions)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_msg_error', r'msg":".*error(?!.*future versions)', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
            ErrorPattern('pf_msg_failed', r'msg":".*failed', 'Praefect/Gitaly', 'infrastructure', 'ERROR'),
        ]
        
        # ==================== POSTGRESQL PATTERNS ====================
        postgresql_patterns = [
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            ErrorPattern('pg_conn_bad', r'PG::ConnectionBad', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_unable_send', r'PG::UnableToSend', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_admin_shutdown', r'PG::AdminShutdown(?!.*gitlab-ctl)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_crash_shutdown', r'PG::CrashShutdown', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_cannot_conn', r'PG::CannotConnectNow', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_conn', r'PG::TooManyConnections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_conn_timeout', r'ActiveRecord::ConnectionTimeoutError', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_conn_not_estab', r'ActiveRecord::ConnectionNotEstablished', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_server_conn_fail', r'could not connect to server', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_pool_exhausted', r'connection pool exhausted', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_conn_fail', r'pgbouncer cannot connect to server', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_crash', r'pgbouncer.*server.*conn.*crashed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_pooler_err', r'pgbouncer.*pooler.*error', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_auth_fail', r'pgbouncer.*auth.*failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pgbouncer_db_disallow', r'pgbouncer.*database.*does.*not.*allow.*connections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_deadlock', r'ERROR.*deadlock detected', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_serialize_fail', r'ERROR.*could not serialize access due to concurrent update', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_duplicate_key', r'ERROR.*duplicate key value violates unique constraint', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stmt_invalid', r'ActiveRecord::StatementInvalid', 'PostgreSQL', 'database', 'ERROR'),
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
            ErrorPattern('pg_readonly_trans', r'PG::ReadOnlySqlTransaction.*cannot execute UPDATE in a read-only transaction', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stale_obj', r'ActiveRecord::StaleObjectError', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('ar_stmt_cache_exp', r'ActiveRecord::PreparedStatementCacheExpired', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_disk_full', r'PG::DiskFull', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_out_of_mem', r'PG::OutOfMemory', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_config_limit', r'PG::ConfigurationLimitExceeded', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_system_err', r'PG::SystemError', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_starting_up', r'FATAL.*the database system is starting up', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shutting_down', r'FATAL.*the database system is shutting down(?!.*administrator command)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shared_mem_fail', r'FATAL.*could not map anonymous shared memory', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_conn_slots_reserved', r'FATAL.*remaining connection slots are reserved', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_role_not_exist', r'FATAL.*role.*does not exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_not_exist', r'FATAL.*database.*does not exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_pass_auth_fail', r'FATAL.*password authentication failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_accessed', r'FATAL.*database.*is being accessed by other users', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_admin_termination', r'FATAL.*terminating connection due to administrator command(?!.*gitlab-ctl)', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_idle_timeout', r'FATAL.*terminating connection due to idle-in-transaction timeout', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_no_hba_entry', r'FATAL.*no pg_hba\.conf entry', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_clients', r'FATAL.*sorry.*too many clients already', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_rel_not_exist', r'ERROR.*relation.*does not exist(?!.*creating)', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_col_not_exist', r'ERROR.*column.*does not exist(?!.*adding)', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_func_not_exist', r'ERROR.*function.*does not exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_perm_denied_rel', r'ERROR.*permission denied for relation', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_perm_denied_schema', r'ERROR.*permission denied for schema', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_stmt_timeout', r'ERROR.*canceling statement due to statement timeout', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_conflict_recovery', r'ERROR.*canceling statement due to conflict with recovery', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_shared_preload', r'ERROR.*shared_preload_libraries', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_max_conn_exceeded', r'ERROR.*max_connections.*exceeded', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_too_many_clients2', r'ERROR.*too many clients already', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_db_not_accepting', r'ERROR.*database.*is not accepting connections', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_repl_slot_not_exist', r'replication slot.*does not exist', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_ahead', r'requested starting point.*ahead of.*WAL', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_stream_fail', r'could not start WAL streaming', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_stream_repl_fail', r'streaming replication.*failed', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_wal_receiver_crash', r'wal_receiver.*crashed', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_wal_sender_term', r'wal_sender.*terminated', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_repl_lag_exceeded', r'replication.*lag.*exceeded', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_standby_disconnect', r'standby.*disconnected', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pg_primary_conn_lost', r'primary.*connection.*lost', 'PostgreSQL', 'database', 'ERROR'),
            ErrorPattern('pg_panic_xlog', r'PANIC.*could not write to file pg_xlog', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_wal_refs', r'PANIC.*WAL contains references to invalid pages', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_checkpoint', r'PANIC.*could not locate a valid checkpoint record', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_page_ptr', r'PANIC.*corrupted page pointers', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_panic_invalid_page', r'PANIC.*invalid page in block', 'PostgreSQL', 'database', 'CRITICAL'),
            ErrorPattern('pg_checkpoint_freq', r'LOG.*checkpoints are occurring too frequently', 'PostgreSQL', 'database', 'WARNING'),
            ErrorPattern('pgbouncer_conn_crash', r'WARNING.*pgbouncer.*server connection.*crashed', 'PostgreSQL', 'database', 'ERROR'),
        ]
        
        # ==================== REDIS PATTERNS ====================
        redis_patterns = [
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            ErrorPattern('redis_conn_refused', r'Redis.*connection.*refused', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_timeout', r'Redis.*timeout(?!.*t\.integer)(?!.*default:)', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_timeout_err', r'Redis::TimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_read_timeout', r'Redis::ReadTimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_write_timeout', r'Redis::WriteTimeoutError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_err', r'Redis::ConnectionError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_cannot_conn', r'Redis::CannotConnectError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_protocol_err', r'Redis::ProtocolError', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_fail', r'Could not connect to Redis', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_lost', r'Redis.*connection.*lost', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_conn_dropped', r'Redis.*connection.*dropped', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_misconf', r'MISCONF Redis is configured to save RDB snapshots.*unable to persist', 'Redis', 'cache', 'ERROR'),
            ErrorPattern('redis_oom', r'OOM command not allowed when used memory', 'Redis', 'cache', 'CRITICAL'),
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
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            ErrorPattern('sidekiq_retry_err', r'Sidekiq.*RetryError', 'Sidekiq', 'background_jobs', 'ERROR'),
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
            ErrorPattern('job_raised_exception', r'Job raised exception', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('job_status_failed', r'job_status.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('active_job_failed', r'ActiveJob.*failed', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('failed_process_args', r'Failed to process.*with args', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_retries_exhausted', r'sidekiq_retries_exhausted', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_busy_high', r'Busy:.*Enqueued:.*[1-9]\d+', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_threads_busy', r'Threads:.*\(\d+\s+busy\)', 'Sidekiq', 'background_jobs', 'WARNING'),
            ErrorPattern('sidekiq_eof_reached', r'end of file reached.*Sidekiq', 'Sidekiq', 'background_jobs', 'ERROR'),
            ErrorPattern('sidekiq_record_not_found', r'WARN.*ActiveRecord::RecordNotFound', 'Sidekiq', 'background_jobs', 'WARNING'),
        ]
        
        # ==================== RAILS APPLICATION PATTERNS ====================
        rails_patterns = [
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            ErrorPattern('av_template_err', r'ActionView::Template::Error', 'Rails', 'application', 'ERROR'),
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
            ErrorPattern('validation_fail_blank', r"Validation failed.*can't be blank", 'Rails', 'application', 'ERROR'),
            ErrorPattern('size_cant_blank', r"Size can't be blank", 'Rails', 'application', 'ERROR'),
            ErrorPattern('no_method_err', r'NoMethodError.*undefined method', 'Rails', 'application', 'ERROR'),
            ErrorPattern('name_err', r'NameError.*undefined.*variable', 'Rails', 'application', 'ERROR'),
            ErrorPattern('argument_err', r'ArgumentError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('runtime_err', r'RuntimeError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('standard_err', r'StandardError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('load_err', r'LoadError.*cannot load such file', 'Rails', 'application', 'ERROR'),
            ErrorPattern('type_err', r'TypeError.*no implicit conversion', 'Rails', 'application', 'ERROR'),
            ErrorPattern('stack_err', r'SystemStackError.*stack level too deep', 'Rails', 'application', 'ERROR'),
            ErrorPattern('json_parse_err', r'JSON::ParserError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('yaml_syntax_err', r'YAML::SyntaxError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('encoding_undef_conv', r'Encoding::UndefinedConversionError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('encoding_invalid_byte', r'Encoding::InvalidByteSequenceError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('uri_invalid', r'URI::InvalidURIError', 'Rails', 'application', 'ERROR'),
            ErrorPattern('timeout_err', r'Timeout::Error', 'Rails', 'application', 'ERROR'),
            ErrorPattern('execution_expired', r'execution expired', 'Rails', 'application', 'ERROR'),
            ErrorPattern('rack_timeout', r'Rack::Timeout::RequestTimeoutException', 'Rails', 'application', 'ERROR'),
            ErrorPattern('gitlab_deadline_exceeded', r'Gitlab::RequestContext::RequestDeadlineExceeded', 'Rails', 'application', 'ERROR'),
        ]
        
        # ==================== NEW CATEGORIES APPENDED ====================
        
        # ==================== KUBERNETES/HELM PATTERNS ====================
        kubernetes_patterns = [
            # Helm upgrade failures
            ErrorPattern('k8s_job_backoff', r'Job failed: BackoffLimitExceeded', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_no_deployed', r'UPGRADE FAILED:.*has no deployed releases', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_patch_fail', r'UPGRADE FAILED: cannot patch.*with kind Deployment', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_type_mismatch', r'UPGRADE FAILED: type mismatch', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_args_err', r'Error: this command needs 2 arguments', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('helm_drop_view_err', r'Error: cannot drop view.*because extension.*requires it', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            
            # Pod/Container issues
            ErrorPattern('k8s_image_pull_backoff', r'ImagePullBackOff', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_err_image_pull', r'ErrImagePull', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_failed_pull_image', r'Failed to pull image', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_manifest_unknown', r'manifest unknown', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_kex_exchange', r'kex_exchange_identification: Connection closed by remote host', 'Kubernetes/Helm', 'kubernetes', 'ERROR'),
            ErrorPattern('k8s_system_oom', r'System OOM encountered, victim process', 'Kubernetes/Helm', 'kubernetes', 'CRITICAL'),
            ErrorPattern('k8s_mem_cgroup_oom', r'Memory cgroup out of memory', 'Kubernetes/Helm', 'kubernetes', 'CRITICAL'),
        ]
        
        # ==================== SSL/CERTIFICATES PATTERNS ====================
        ssl_patterns = [
            # Certificate verification
            ErrorPattern('ssl_local_issuer', r'unable to get local issuer certificate', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_verify_first', r'unable to verify the first certificate', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_unknown_authority', r'certificate signed by unknown authority', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_self_signed', r'self signed certificate in certificate chain', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_x509_legacy', r'x509: certificate relies on legacy Common Name field', 'SSL/Certificates', 'security', 'WARNING'),
            ErrorPattern('ssl_key_mismatch', r'X\.509 key values mismatch', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_key_mismatch2', r'key values mismatch', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_untrusted_root', r'SEC_E_UNTRUSTED_ROOT', 'SSL/Certificates', 'security', 'ERROR'),
            
            # SSL handshake
            ErrorPattern('ssl_problem', r'SSL certificate problem', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_connect_err', r'SSL_connect returned=1 errno=0 state=error', 'SSL/Certificates', 'security', 'ERROR'),
            ErrorPattern('ssl_x509_routines', r'SSL: error:.*:x509 certificate routines', 'SSL/Certificates', 'security', 'ERROR'),
        ]
        
        # ==================== GEO REPLICATION PATTERNS ====================
        geo_patterns = [
            # Critical Geo errors
            ErrorPattern('geo_secondary_not_config', r'Geo secondary database is not configured', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_db_writable', r'Geo site has a database that is writable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_tracking_not_config', r'Geo.*tracking database.*not configured', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_conflict_recovery', r'ERROR: canceling statement due to conflict with recovery', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_not_checksummable', r'Repository cannot be checksummable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_file_not_checksummable', r'File is not checksummable', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_primary_missing', r'The file is missing on the Geo primary site', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_primary_missing_file', r'"primary_missing_file"\s*:\s*true', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_verification_timeout', r'Verification timed out after', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_unexpected_disconnect', r'unexpected disconnect while reading sideband packet', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_failed_sync', r'@failed-geo-sync', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_site_unhealthy', r'Geo.*site.*unhealthy', 'Geo', 'replication', 'ERROR'),
            ErrorPattern('geo_repos_unavail', r'Geo.*repositories.*unavailable', 'Geo', 'replication', 'CRITICAL'),
            ErrorPattern('geo_tracking_inconsist', r'Geo.*tracking.*inconsistent', 'Geo', 'replication', 'ERROR'),
        ]
        
        # ==================== ALL OTHER PATTERNS ====================
        # Nginx, Workhorse, Git/Shell, CI/CD, Auth, Network, System, etc.
        other_patterns = [
            # === ORIGINAL PATTERNS - KEPT INTACT ===
            # Nginx
            ErrorPattern('nginx_worker_exit', r'nginx.*worker.*process.*exited.*on.*signal(?!.*reload)', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_close', r'nginx.*upstream.*prematurely.*closed.*connection', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_ssl_handshake', r'nginx.*SSL.*handshake.*failed', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_client_large_body', r'nginx.*client.*intended.*to.*send.*too.*large.*body', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_invalid', r'nginx.*upstream.*sent.*invalid.*header', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_connect_refused', r'nginx.*connect.*failed.*Connection.*refused', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_recv_reset', r'nginx.*recv.*failed.*Connection.*reset.*by.*peer', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_upstream_timeout', r'upstream.*timed out(?!.*retry)', 'Nginx', 'proxy', 'ERROR'),
            ErrorPattern('nginx_no_live_upstream', r'no live upstreams', 'Nginx', 'proxy', 'ERROR'),
            
            # Workhorse
            ErrorPattern('workhorse_err', r'Workhorse.*error(?!.*INFO)(?!.*retry)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_timeout', r'Workhorse.*timeout(?!.*increased)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_conn_fail', r'Workhorse.*connection.*failed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_upload_fail', r'Workhorse.*upload.*failed', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_badgateway', r'badgateway:.*failed to receive response(?!.*retry)', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_keywatcher_eof', r'keywatcher:.*pubsub receive:.*EOF', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('workhorse_keywatcher_misconf', r'keywatcher:.*pubsub receive:.*MISCONF', 'Workhorse', 'proxy', 'ERROR'),
            ErrorPattern('puma_worker_timeout', r'Puma.*timed out.*worker', 'Puma/Workhorse', 'application', 'ERROR'),
            ErrorPattern('puma_worker_spinning', r'Puma.*worker.*spinning at 100%', 'Puma/Workhorse', 'application', 'ERROR'),
            
            # Git/Shell
            ErrorPattern('gitlab_shell_err', r'GitLab.*Shell.*error(?!.*INFO)', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('gitlab_shell_auth_fail', r'GitLab.*Shell.*authentication.*failed', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('gitlab_shell_perm_denied', r'GitLab.*Shell.*permission.*denied', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_remote_hung_up', r'fatal:.*The remote end hung up unexpectedly', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_not_repo', r'fatal:.*not a git repository', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_repo_corrupt', r'fatal:.*repository.*corrupt', 'Git/Shell', 'git_access', 'CRITICAL'),
            ErrorPattern('git_could_not_read', r'Could not read from remote repository', 'Git/Shell', 'git_access', 'ERROR'),
            ErrorPattern('git_push_fail', r'error:.*failed to push some refs', 'Git/Shell', 'git_access', 'ERROR'),
            
            # CI/CD
            ErrorPattern('pipeline_fail', r'Pipeline.*failed(?!.*retry)(?!.*t\.index)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('job_fail_exit', r'Job.*failed.*exit.*code.*[1-9]\d*(?!.*will retry)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_not_avail', r'Runner.*not.*available', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_auth_fail', r'Runner.*authentication.*failed', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('runner_executor_err', r'Runner.*executor.*error', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('build_fail', r'Build.*failed(?!.*rebuilding)', 'CI/CD', 'ci_cd', 'ERROR'),
            ErrorPattern('job_timeout', r'ERROR: Job failed: execution took longer than', 'CI/CD', 'ci_cd', 'ERROR'),
            
            # Auth
            ErrorPattern('http_401', r'401 Unauthorized', 'Auth', 'security', 'ERROR'),
            ErrorPattern('http_403', r'403 Forbidden', 'Auth', 'security', 'ERROR'),
            ErrorPattern('oauth_err', r'OAuth.*error', 'Auth', 'security', 'ERROR'),
            ErrorPattern('oauth2_invalid', r'OAuth2.*invalid.*grant', 'Auth', 'security', 'ERROR'),
            ErrorPattern('jwt_expired', r'JWT.*expired', 'Auth', 'security', 'ERROR'),
            ErrorPattern('jwt_sig_fail', r'JWT.*signature.*verification.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('auth_fail', r'authentication.*failed(?!.*handshake)(?!.*context deadline)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('pass_auth_fail', r'password authentication failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('ldap_auth_fail', r'LDAP.*authentication.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('saml_auth_fail', r'SAML.*authentication.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('perm_denied', r'permission denied(?!.*dial)(?!.*connection)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('rack_attack', r'Rack_Attack', 'Auth', 'security', 'WARNING'),
            ErrorPattern('invalid_token', r'Invalid.*token', 'Auth', 'security', 'ERROR'),
            ErrorPattern('ldap_conn_fail', r'LDAP.*connection.*failed', 'Auth', 'security', 'ERROR'),
            ErrorPattern('auth_fail2', r'auth.*failed(?!.*handshake)', 'Auth', 'security', 'ERROR'),
            ErrorPattern('access_denied', r'access.*denied', 'Auth', 'security', 'ERROR'),
            ErrorPattern('unauthorized', r'unauthorized', 'Auth', 'security', 'ERROR'),
            
            # Network
            ErrorPattern('tcp_conn_refused', r'Failed to open TCP connection.*Connection refused', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('conn_timeout', r'Connection timed out(?!.*retry)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('net_unreachable', r'Network is unreachable', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('conn_reset_peer', r'Connection reset by peer(?!.*client)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('broken_pipe', r'Broken pipe(?!.*client)', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('no_route_host', r'No route to host', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('name_service_unknown', r'Name or service not known', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_502', r'\b502 Bad Gateway\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_503', r'\b503 Service Unavailable\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_504', r'\b504 Gateway Timeout\b', 'Network', 'infrastructure', 'ERROR'),
            ErrorPattern('http_500', r'\b500 Internal Server Error\b', 'Network', 'infrastructure', 'ERROR'),
            
            # System/OS - Note: command not found patterns are already handled in false positive filter
            ErrorPattern('oom', r'Out of memory(?!.*available)', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('oom_killer', r'OOM killer', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('cannot_alloc_mem', r'Cannot allocate memory', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('no_space_left', r'No space left on device', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('disk_quota_exceeded', r'Disk quota exceeded', 'System/OS', 'system', 'ERROR'),
            ErrorPattern('too_many_open_files', r'Too many open files', 'System/OS', 'system', 'ERROR'),
            ErrorPattern('segfault', r'segmentation fault', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('kernel_killed', r'kernel:.*killed process', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('filesystem_full', r'filesystem.*full', 'System/OS', 'system', 'CRITICAL'),
            ErrorPattern('inode_exhausted', r'inode.*exhausted', 'System/OS', 'system', 'CRITICAL'),
            
            # Generic critical errors
            ErrorPattern('level_error', r'"level":"error".*"error":"[^"]+"(?!.*Worker)(?!.*retry)(?!.*INFO)', 'Generic', 'generic', 'ERROR'),
            ErrorPattern('level_fatal', r'"level":"fatal"(?!.*shutdown)(?!.*stopping)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('fatal_error', r'FATAL:(?!.*terminating.*administrator)(?!.*shutting down)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('critical_error', r'CRITICAL:(?!.*INFO)', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('panic', r'PANIC:', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('kernel_panic', r'kernel panic', 'Generic', 'generic', 'CRITICAL'),
            ErrorPattern('unhandled_exception', r'unhandled exception', 'Generic', 'generic', 'ERROR'),
            ErrorPattern('uncaught_exception', r'uncaught exception', 'Generic', 'generic', 'ERROR'),
        ]
        
        # Add all patterns to the bank
        all_patterns = (
            praefect_patterns + postgresql_patterns + redis_patterns + 
            sidekiq_patterns + rails_patterns + kubernetes_patterns +
            ssl_patterns + geo_patterns + other_patterns
        )
        
        for pattern in all_patterns:
            self.patterns.append(pattern)
            self.by_component[pattern.component].append(pattern)
            self.by_severity[pattern.severity].append(pattern)
    
    def _compile_patterns(self):
        """Compile all regex patterns for efficient matching"""
        for pattern in self.patterns:
            try:
                self.compiled_patterns[pattern.id] = re2.compile(
                    pattern.pattern, 
                    re2.IGNORECASE | re2.MULTILINE
                )
            except Exception as e:
                print(f"⚠️  Failed to compile pattern {pattern.id}: {e}")
    
    def _build_automaton(self):
        """Build Aho-Corasick automaton for ultra-fast multi-pattern matching"""
        if not HAS_AHOCORASICK:
            return
        
        self.automaton = pyahocorasick.Automaton()
        
        # Add simple string patterns to automaton
        for pattern in self.patterns:
            # Extract literal strings from regex for fast pre-filtering
            literals = self._extract_literals(pattern.pattern)
            for literal in literals:
                self.automaton.add_word(literal.lower(), pattern)
        
        self.automaton.make_automaton()
        if mp.current_process().name == 'MainProcess':
            print(f"✅ Built Aho-Corasick automaton with {len(self.automaton)} patterns")
    
    def _extract_literals(self, regex_pattern: str) -> List[str]:
        """Extract literal strings from regex pattern for Aho-Corasick"""
        literals = []
        
        simple_patterns = [
            r'error', r'fail', r'fatal', r'panic', r'critical',
            r'timeout', r'refused', r'unavailable', r'exception'
        ]
        
        for literal in simple_patterns:
            if literal in regex_pattern.lower():
                literals.append(literal)
        
        return literals if literals else [regex_pattern[:20]]


class StreamProcessor:
    """Memory-efficient streaming log processor with false positive filtering"""
    
    def __init__(self, pattern_bank: PatternBank, false_positive_filter: FalsePositiveFilter = None, context_lines: int = 5):
        self.pattern_bank = pattern_bank
        self.false_positive_filter = false_positive_filter or FalsePositiveFilter()
        self.context_lines = context_lines
        self.context_buffer = deque(maxlen=context_lines * 2 + 1)
        self.line_number = 0
        
    def process_file(self, file_path: Path, chunk_size: int = 8192) -> Iterator[ErrorMatch]:
        """Stream process file without loading into memory with intelligent filtering"""
        self.line_number = 0
        self.context_buffer.clear()
        
        # Skip schema files entirely
        if self.false_positive_filter.is_schema_file(file_path):
            return
        
        # Skip system info files unless they have specific errors
        if self.false_positive_filter.is_system_info_file(file_path):
            # Only look for specific errors in system files
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_num, line in enumerate(f, 1):
                        # Skip command not found errors (already filtered as false positives)
                        if 'No such file or directory' in line and 'command not found' not in line:
                            # Create a basic error match for system errors
                            yield ErrorMatch(
                                pattern=ErrorPattern('system_error', 'No such file', 'System/OS', 'system', 'ERROR'),
                                matched_text=line.strip(),
                                line=line.strip(),
                                file_path=str(file_path),
                                line_number=line_num,
                                node=self._extract_node(file_path)
                            )
            except:
                pass
            return
        
        # Check if it's a config file - process with extra caution
        if self.false_positive_filter.is_config_file(file_path):
            # Config files need special handling - usually skip unless real errors
            return
        
        try:
            # Handle different file types
            if str(file_path).endswith('.gz'):
                file_handle = gzip.open(file_path, 'rt', encoding='utf-8', errors='ignore')
            else:
                file_handle = open(file_path, 'r', encoding='utf-8', errors='ignore')
            
            with file_handle as f:
                # Use mmap for huge files if not compressed
                if not str(file_path).endswith('.gz') and file_path.stat().st_size > 100_000_000:
                    yield from self._process_mmap(file_path)
                else:
                    yield from self._process_stream(f, file_path)
                    
        except Exception as e:
            print(f"⚠️  Error processing {file_path}: {e}")
    
    def _process_stream(self, file_handle, file_path: Path) -> Iterator[ErrorMatch]:
        """Process file stream line by line with false positive filtering"""
        for line in file_handle:
            self.line_number += 1
            self.context_buffer.append(line.rstrip())
            
            # Quick pre-filter with file path context
            if not self._should_process_line(line, file_path):
                continue
            
            # Check patterns
            matches = self._check_patterns(line, file_path)
            for match in matches:
                # Add context
                match.context_before = list(self.context_buffer)[:self.context_lines]
                yield match
    
    def _process_mmap(self, file_path: Path) -> Iterator[ErrorMatch]:
        """Use memory mapping for huge files with false positive filtering"""
        with open(file_path, 'rb') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mmapped_file:
                for line in iter(mmapped_file.readline, b""):
                    self.line_number += 1
                    line_str = line.decode('utf-8', errors='ignore').rstrip()
                    
                    if not self._should_process_line(line_str, file_path):
                        continue
                    
                    matches = self._check_patterns(line_str, file_path)
                    for match in matches:
                        yield match
    
    def _should_process_line(self, line: str, file_path: Path = None) -> bool:
        """Quick pre-filter to skip obviously non-error lines with false positive detection"""
        if len(line) < 10:
            return False
        
        # Check if it's a false positive pattern first
        for fp_pattern in self.false_positive_filter.compiled_false_positive_patterns:
            if fp_pattern.search(line):
                return False
        
        # Check if it's just a worker class name
        if self.false_positive_filter.is_worker_class_name(line):
            return False
        
        # Check if it's a normal shutdown
        if self.false_positive_filter.is_normal_shutdown(line):
            return False
        
        # Skip successful operations
        if any(success in line.lower() for success in [
            '"level":"info"', '"level":"debug"', 
            '"severity":"info"', '"severity":"debug"',
            'success', 'succeeded', 'completed successfully'
        ]):
            # Unless it has critical errors
            if not any(critical in line.lower() for critical in [
                'oom', 'panic', 'crashed', 'no space left'
            ]):
                return False
        
        # Quick byte-level checks for error indicators
        error_indicators = {'error', 'fail', 'fatal', 'panic', 'exception', 'critical', 'timeout', 'refused', 'unavailable'}
        line_lower = line.lower()
        
        return any(indicator in line_lower for indicator in error_indicators)
    
    def _check_patterns(self, line: str, file_path: Path) -> List[ErrorMatch]:
        """Check line against all patterns efficiently with false positive filtering"""
        matches = []
        
        # Check if it's from monitoring service
        is_monitoring, monitoring_service = self.false_positive_filter.is_monitoring_service_error(line, str(file_path))
        
        # Limit matches per line to avoid over-processing
        MAX_MATCHES_PER_LINE = 3  # Performance optimization
        
        # Use Aho-Corasick if available
        if self.pattern_bank.automaton and HAS_AHOCORASICK:
            for end_pos, pattern in self.pattern_bank.automaton.iter(line.lower()):
                if len(matches) >= MAX_MATCHES_PER_LINE:  # Early termination
                    break
                    
                # Verify with actual regex
                if pattern.id in self.pattern_bank.compiled_patterns:
                    regex = self.pattern_bank.compiled_patterns[pattern.id]
                    if match := regex.search(line):
                        # Additional validation
                        if not self._validate_match(line, match.group(0), file_path):
                            continue
                        
                        error_match = self._create_match(pattern, match, line, file_path)
                        error_match.metadata['is_monitoring'] = is_monitoring
                        error_match.metadata['monitoring_service'] = monitoring_service
                        matches.append(error_match)
        else:
            # Fallback to regex matching
            for pattern in self.pattern_bank.patterns:
                if len(matches) >= MAX_MATCHES_PER_LINE:  # Early termination
                    break
                    
                if pattern.id in self.pattern_bank.compiled_patterns:
                    regex = self.pattern_bank.compiled_patterns[pattern.id]
                    if match := regex.search(line):
                        # Additional validation
                        if not self._validate_match(line, match.group(0), file_path):
                            continue
                        
                        error_match = self._create_match(pattern, match, line, file_path)
                        error_match.metadata['is_monitoring'] = is_monitoring
                        error_match.metadata['monitoring_service'] = monitoring_service
                        matches.append(error_match)
                        break  # One match per line for efficiency
        
        return matches
    
    def _validate_match(self, line: str, matched_text: str, file_path: Path) -> bool:
        """Validate if the match is a real error"""
        
        # Skip health endpoints even with HTTP errors
        if any(endpoint in line for endpoint in ['/health', '/metrics', '/-/readiness', '/-/liveness', '/api/v4/internal/check']):
            return False
        
        # Skip deprecation warnings
        if 'future versions' in line or 'deprecated' in line:
            return False
        
        # Check if it's diagnostic output describing errors
        if self.false_positive_filter.is_diagnostic_output(file_path):
            if any(desc in line for desc in ['Checking ', 'checks if', 'confirms if', 'verifies']):
                return False
        
        return True
    
    def _create_match(self, pattern: ErrorPattern, regex_match, line: str, file_path: Path) -> ErrorMatch:
        """Create ErrorMatch object"""
        return ErrorMatch(
            pattern=pattern,
            matched_text=regex_match.group(0),
            line=line,
            file_path=str(file_path),
            line_number=self.line_number,
            timestamp=self._extract_timestamp(line),
            node=self._extract_node(file_path),
            correlation_id=self._extract_correlation_id(line)
        )
    
    def _extract_timestamp(self, line: str) -> Optional[datetime]:
        """Extract timestamp from log line"""
        patterns = [
            r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})',
            r'"time":"([^"]+)"',
            r'"timestamp":"([^"]+)"'
        ]
        
        for pattern in patterns:
            if match := re.search(pattern, line):
                try:
                    return datetime.fromisoformat(match.group(1).replace('T', ' ').split('.')[0])
                except:
                    pass
        return None
    
    def _extract_node(self, file_path: Path) -> str:
        """Extract node name from file path"""
        path_str = str(file_path)
        
        # Try to extract node from path
        if 'praefect' in path_str:
            return 'praefect'
        elif 'gitaly' in path_str:
            return 'gitaly'
        elif 'gitlab' in path_str:
            return 'gitlab'
        
        return 'unknown'
    
    def _extract_correlation_id(self, line: str) -> Optional[str]:
        """Extract correlation ID from log line"""
        patterns = [
            r'"correlation_id":"([^"]+)"',
            r'correlation_id=([a-zA-Z0-9\-_]+)'
        ]
        
        for pattern in patterns:
            if match := re.search(pattern, line):
                return match.group(1)
        return None


class AutoGrep:
    """Main analyzer class - Ultra-reliable GitLab error detection with false positive filtering"""
    
    def __init__(self, workers: int = None):
        self.workers = workers or mp.cpu_count()
        self.pattern_bank = PatternBank()
        self.false_positive_filter = FalsePositiveFilter()
        self.results = defaultdict(list)
        self.error_clusters = defaultdict(list)
        self.monitoring_errors = defaultdict(list)
        self.gitlab_errors = defaultdict(list)
        self.monitoring_clusters = defaultdict(list)
        self.stats = {
            'files_processed': 0,
            'lines_processed': 0,
            'errors_found': 0,
            'gitlab_errors': 0,
            'monitoring_errors': 0,
            'false_positives_filtered': 0,
            'start_time': None,
            'end_time': None
        }
    
    def analyze_tar(self, tar_path: str) -> Dict[str, Any]:
        """Analyze GitLab SOS dump"""
        print(f"\n{'='*80}")
        print(f"🚀 AUTOGREP - Starting analysis of {tar_path}")
        print(f"{'='*80}\n")
        
        self.stats['start_time'] = time.time()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Extract tar
            print("📦 Extracting archive...")
            self._extract_tar(tar_path, temp_dir)
            
            # Find files to process
            print("🔍 Scanning for log files...")
            files = self._find_log_files(Path(temp_dir))
            print(f"📋 Found {len(files)} files to analyze")
            
            # Process files in parallel
            print(f"⚡ Processing with {self.workers} workers...")
            self._process_files_parallel(files)
            
            # Cluster errors
            print("🔮 Clustering errors...")
            self._cluster_errors()
            
            # Generate report
            self.stats['end_time'] = time.time()
            return self._generate_report()
    
    def _extract_tar(self, tar_path: str, dest: str):
        """
        Extract archive file - handles tar, tar.gz, tgz, and zip files
        Surgical fix to handle different archive types without breaking existing functionality
        """
        import tarfile
        import zipfile
        
        archive_name = os.path.basename(tar_path).lower()
        
        try:
            # Detect and extract based on file extension
            if archive_name.endswith('.zip'):
                # Handle ZIP files
                print(f"  📦 Detected ZIP archive")
                with zipfile.ZipFile(tar_path, 'r') as zf:
                    zf.extractall(dest)
                    
            elif archive_name.endswith('.tar.gz') or archive_name.endswith('.tgz'):
                # Handle gzipped tar files
                print(f"  📦 Detected TAR.GZ archive")
                with tarfile.open(tar_path, 'r:gz') as tar:
                    tar.extractall(dest)
                    
            elif archive_name.endswith('.tar'):
                # Handle plain tar files  
                print(f"  📦 Detected TAR archive")
                with tarfile.open(tar_path, 'r') as tar:
                    tar.extractall(dest)
                    
            else:
                # Fallback: try to detect by magic bytes
                print(f"  ⚠️  Unknown extension, detecting format...")
                
                with open(tar_path, 'rb') as f:
                    magic = f.read(4)
                
                if magic[:2] == b'PK':
                    # ZIP file signature
                    print(f"  📦 Detected ZIP by magic bytes")
                    with zipfile.ZipFile(tar_path, 'r') as zf:
                        zf.extractall(dest)
                        
                elif magic[:3] == b'\x1f\x8b\x08':
                    # GZIP signature
                    print(f"  📦 Detected GZIP by magic bytes")
                    with tarfile.open(tar_path, 'r:gz') as tar:
                        tar.extractall(dest)
                        
                else:
                    # Try as plain tar as last resort
                    print(f"  📦 Attempting TAR extraction")
                    with tarfile.open(tar_path, 'r') as tar:
                        tar.extractall(dest)
                        
            print(f"  ✅ Successfully extracted to {dest}")
            
        except Exception as e:
            print(f"  ❌ Failed to extract {tar_path}: {e}")
            raise Exception(f"Could not extract archive: {e}")
    
    def _find_log_files(self, root: Path) -> List[Path]:
        """Find all relevant log files"""
        files = []
        
        for path in root.rglob('*'):
            if path.is_file():
                # Include log files and specific system files
                if any(indicator in str(path).lower() for indicator in [
                    'log', 'current', 'production', 'sidekiq', 'gitaly',
                    'praefect', 'workhorse', 'postgres', 'redis', 'nginx'
                ]):
                    files.append(path)
        
        return files
    
    def _process_files_parallel(self, files: List[Path]):
        """Process files in parallel with enhanced error categorization"""
        with ProcessPoolExecutor(max_workers=self.workers) as executor:
            futures = {executor.submit(self._process_single_file, f): f for f in files}
            
            completed = 0
            total = len(files)
            
            for future in as_completed(futures):
                completed += 1
                self.stats['files_processed'] += 1
                print(f"\r⚡ Progress: {completed}/{total} files ({100*completed/total:.1f}%)", end='', flush=True)
                
                try:
                    errors, lines_count = future.result()
                    self.stats['lines_processed'] += lines_count
                    
                    for error in errors:
                        self.results[error.pattern.component].append(error)
                        self.stats['errors_found'] += 1
                        
                        # Separate monitoring from GitLab errors
                        if error.metadata.get('error_type') == 'monitoring':
                            self.monitoring_errors[error.pattern.component].append(error)
                            self.stats['monitoring_errors'] += 1
                        else:
                            self.gitlab_errors[error.pattern.component].append(error)
                            self.stats['gitlab_errors'] += 1
                            
                except Exception as e:
                    print(f"\n⚠️  Error processing file: {e}")
            
            print()  # New line after progress
    
    def _process_single_file(self, file_path: Path) -> Tuple[List[ErrorMatch], int]:
        """Process single file with false positive filtering - returns errors and line count"""
        processor = StreamProcessor(self.pattern_bank, self.false_positive_filter)
        errors = []
        lines_processed = 0
        
        # Single pass through the file
        for error_match in processor.process_file(file_path):
            # Check if it's a monitoring error
            if error_match.metadata.get('is_monitoring', False):
                error_match.metadata['error_type'] = 'monitoring'
            else:
                error_match.metadata['error_type'] = 'gitlab'
            
            errors.append(error_match)
        
        # Get line count from processor (it already tracked this)
        lines_processed = processor.line_number  # Use the line counter from processor
        
        return errors, lines_processed
    
    def _cluster_errors(self):
        """Cluster similar errors together with monitoring separation"""
        # Cluster GitLab errors
        for component, errors in self.gitlab_errors.items():
            # Group by signature
            clusters = defaultdict(list)
            for error in errors:
                clusters[error.signature].append(error)
            
            # Sort clusters by frequency
            sorted_clusters = sorted(
                clusters.items(),
                key=lambda x: len(x[1]),
                reverse=True
            )
            
            self.error_clusters[component] = sorted_clusters
        
        # Also cluster monitoring errors separately if needed
        for component, errors in self.monitoring_errors.items():
            clusters = defaultdict(list)
            for error in errors:
                clusters[error.signature].append(error)
            
            sorted_clusters = sorted(
                clusters.items(),
                key=lambda x: len(x[1]),
                reverse=True
            )
            
            self.monitoring_clusters[component] = sorted_clusters
    
    def _generate_report(self) -> Dict[str, Any]:
        """Generate analysis report with enhanced filtering insights"""
        duration = self.stats['end_time'] - self.stats['start_time']
        
        print(f"\n{'='*80}")
        print(f"📊 ANALYSIS COMPLETE - PRODUCTION-GRADE FILTERING APPLIED")
        print(f"{'='*80}\n")
        
        print(f"⏱️  Duration: {duration:.2f} seconds")
        print(f"📁 Files processed: {self.stats['files_processed']:,}")
        print(f"📄 Lines processed: {self.stats['lines_processed']:,}")
        print(f"❌ Total errors found: {self.stats['errors_found']:,}")
        print(f"  ├─ GitLab errors: {self.stats['gitlab_errors']:,}")
        print(f"  └─ Monitoring errors: {self.stats['monitoring_errors']:,}\n")
        
        if self.stats['errors_found'] == 0:
            print("✅ No errors found! System appears healthy.")
            return {'errors': [], 'stats': self.stats}
        
        # Count errors by severity - GitLab only
        severity_counts = {'CRITICAL': 0, 'ERROR': 0, 'WARNING': 0}
        component_counts = defaultdict(int)
        
        for component, errors in self.gitlab_errors.items():
            component_counts[component] = len(errors)
            for error in errors:
                severity_counts[error.pattern.severity] += 1
        
        # Show summary
        print(f"{'='*80}")
        print(f"GITLAB ERROR SUMMARY (Monitoring excluded)")
        print(f"{'='*80}\n")
        
        print("📊 By Severity:")
        for severity in ['CRITICAL', 'ERROR', 'WARNING']:
            count = severity_counts[severity]
            if count > 0:
                emoji = '🔴' if severity == 'CRITICAL' else '🟡' if severity == 'ERROR' else '🟠'
                print(f"  {emoji} {severity:8s}: {count:,}")
        
        print(f"\n📊 By Component (Top 10):")
        sorted_components = sorted(component_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        for component, count in sorted_components:
            print(f"  • {component:25s}: {count:,} errors")
        
        # Show monitoring summary if present
        if self.stats['monitoring_errors'] > 0:
            print(f"\n📊 Monitoring Infrastructure Issues (Separate):")
            monitoring_counts = {comp: len(errors) for comp, errors in self.monitoring_errors.items()}
            for component, count in sorted(monitoring_counts.items(), key=lambda x: x[1], reverse=True):
                print(f"  • {component:25s}: {count:,} errors")
        
        # Show top errors by component
        print(f"\n{'='*80}")
        print(f"TOP GITLAB ERROR PATTERNS (Real Issues Only)")
        print(f"{'='*80}")
        
        report_data = {
            'summary': {
                **self.stats,
                'severity_counts': severity_counts,
                'component_counts': dict(component_counts)
            },
            'gitlab_components': {},
            'monitoring_summary': {}
        }
        
        # Process GitLab errors only for detailed report
        important_components = ['Praefect/Gitaly', 'PostgreSQL', 'Redis', 'Sidekiq', 'Rails', 
                               'Kubernetes/Helm', 'Git/Shell', 'Network', 'System/OS', 'SSL/Certificates',
                               'Geo']
        
        components_to_show = []
        for comp in important_components:
            if comp in self.error_clusters:
                components_to_show.append(comp)
        
        # Add any other components with CRITICAL errors
        for component in self.error_clusters.keys():
            if component not in components_to_show:
                clusters = self.error_clusters[component]
                for _, errors in clusters:
                    if any(e.pattern.severity == 'CRITICAL' for e in errors):
                        components_to_show.append(component)
                        break
        
        for component in components_to_show:
            clusters = self.error_clusters[component]
            if not clusters:
                continue
            
            print(f"\n🔧 {component}")
            print(f"{'-'*60}")
            
            component_data = []
            
            # Show top 3 error patterns per component
            for signature, errors in clusters[:3]:
                sample = errors[0]
                count = len(errors)
                
                # Get unique nodes/files
                unique_files = list(set(os.path.basename(e.file_path) for e in errors[:5]))
                
                severity_emoji = '🔴' if sample.pattern.severity == 'CRITICAL' else '🟡' if sample.pattern.severity == 'ERROR' else '🟠'
                
                print(f"\n  {severity_emoji} [{sample.pattern.severity}] {sample.pattern.id}")
                print(f"     Count: {count} occurrences")
                if sample.pattern.description:
                    print(f"     Description: {sample.pattern.description}")
                print(f"     Pattern: {sample.pattern.pattern[:100]}...")
                print(f"     Sample: {sample.line[:150]}...")
                if unique_files:
                    print(f"     Files: {', '.join(unique_files[:3])}")
                
                component_data.append({
                    'pattern_id': sample.pattern.id,
                    'severity': sample.pattern.severity,
                    'count': count,
                    'pattern': sample.pattern.pattern,
                    'description': sample.pattern.description,
                    'sample': sample.line,
                    'files': unique_files
                })
            
            report_data['gitlab_components'][component] = component_data
        
        # Store monitoring summary
        if self.monitoring_errors:
            report_data['monitoring_summary'] = {
                comp: len(errors) for comp, errors in self.monitoring_errors.items()
            }
        
        # Critical issues summary
        critical_errors = []
        for component, clusters in self.error_clusters.items():
            for signature, errors in clusters:
                if errors[0].pattern.severity == 'CRITICAL':
                    critical_errors.append((component, errors))
        
        if critical_errors:
            print(f"\n{'='*80}")
            print(f"⚠️  CRITICAL ISSUES REQUIRING IMMEDIATE ATTENTION")
            print(f"{'='*80}")
            
            for component, errors in sorted(critical_errors, key=lambda x: len(x[1]), reverse=True)[:5]:
                sample = errors[0]
                print(f"\n🔴 [{component}] {sample.pattern.id}")
                print(f"   {sample.pattern.description or sample.pattern.pattern[:100]}")
                print(f"   Found {len(errors)} times")
        
        # Save to JSON
        self._save_json_report(report_data)
        
        print(f"\n{'='*80}")
        print(f"✅ Analysis complete with production-grade filtering")
        print(f"📊 GitLab errors: {self.stats['gitlab_errors']:,} | Monitoring: {self.stats['monitoring_errors']:,}")
        print(f"💾 Check autogrep_report_*.json for full details")
        print(f"{'='*80}\n")
        
        return report_data
    
    def _save_json_report(self, report_data: Dict[str, Any]):
        """Save report to JSON file in proper location"""
        from pathlib import Path
    
        # Create reports directory if it doesn't exist
        reports_dir = Path("data/reports")
        reports_dir.mkdir(parents=True, exist_ok=True)
    
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"autogrep_report_{timestamp}.json"
        filepath = reports_dir / filename
    
    # Save to the reports directory
        with open(filepath, 'w') as f:
            json.dump(report_data, f, indent=2, default=str)
    
        print(f"\n💾 Report saved to: {filepath}")
    
    # Optional: Clean up old reports (keep last 20)
        self._cleanup_old_reports(reports_dir)
    

    def _cleanup_old_reports(self, reports_dir: Path, keep_count: int = 20):
        """Clean up old report files, keeping only the most recent ones"""
        try:
            # Get all autogrep report files
            report_files = sorted(
                reports_dir.glob("autogrep_report_*.json"),
                key=lambda f: f.stat().st_mtime,
                reverse=True  # Most recent first
            )
        
        # Delete older files if we have too many
            if len(report_files) > keep_count:
                for old_file in report_files[keep_count:]:
                    old_file.unlink()
                    if mp.current_process().name == 'MainProcess':
                        print(f"  🗑️ Cleaned up old report: {old_file.name}")
        except Exception as e:
            # Don't fail if cleanup fails
            pass


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python autogrep.py <gitlab_sos_dump.tar.gz> [workers]")
        sys.exit(1)
    
    tar_file = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else None
    
    if not os.path.exists(tar_file):
        print(f"❌ File not found: {tar_file}")
        sys.exit(1)
    
    analyzer = AutoGrep(workers=workers)
    report = analyzer.analyze_tar(tar_file)
    
    # Return exit code based on errors found
    sys.exit(0 if report['summary']['errors_found'] == 0 else 1)


if __name__ == "__main__":
    main()