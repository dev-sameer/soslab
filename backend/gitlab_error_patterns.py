"""
GitLab Log Error Detection Patterns
===================================

Comprehensive error keyword and pattern definitions for analyzing GitLab SOS logs.
This module provides the intelligence for the analyze_file tool to actually
detect and categorize errors properly.
"""

from dataclasses import dataclass
from typing import List, Dict, Set, Optional, Pattern
import re
from enum import Enum


class Severity(Enum):
    CRITICAL = "critical"
    FATAL = "fatal"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"
    DEBUG = "debug"


@dataclass
class ErrorPattern:
    """Defines an error pattern with its characteristics"""
    pattern: str
    severity: Severity
    category: str
    description: str
    is_regex: bool = False
    case_sensitive: bool = False


# =============================================================================
# UNIVERSAL ERROR KEYWORDS (work across all log types)
# =============================================================================

UNIVERSAL_ERROR_KEYWORDS = {
    Severity.CRITICAL: [
        "CRITICAL", "critical", "PANIC", "panic", "EMERGENCY", "emergency",
        "FATAL", "fatal", "SEGFAULT", "segfault", "Segmentation fault",
        "kernel panic", "KERNEL PANIC", "OOM", "Out of memory", "OUT OF MEMORY",
        "oom-killer", "OOM killer", "stack overflow", "STACK OVERFLOW",
        "deadlock", "DEADLOCK", "data corruption", "DATA CORRUPTION"
    ],
    Severity.ERROR: [
        "ERROR", "error", "Error", "ERR", "FAIL", "fail", "Fail", "FAILED",
        "failed", "Failed", "FAILURE", "failure", "Failure", "EXCEPTION",
        "exception", "Exception", "Traceback", "traceback", "TRACEBACK",
        "abort", "ABORT", "Abort", "refused", "REFUSED", "denied", "DENIED",
        "timeout", "TIMEOUT", "Timeout", "timed out", "TIMED OUT",
        "connection refused", "CONNECTION REFUSED", "cannot connect",
        "CANNOT CONNECT", "unreachable", "UNREACHABLE", "not found",
        "NOT FOUND", "invalid", "INVALID", "corrupt", "CORRUPT",
        "permission denied", "PERMISSION DENIED", "access denied",
        "ACCESS DENIED", "unauthorized", "UNAUTHORIZED"
    ],
    Severity.WARNING: [
        "WARN", "warn", "Warn", "WARNING", "warning", "Warning",
        "deprecated", "DEPRECATED", "Deprecated", "slow", "SLOW",
        "degraded", "DEGRADED", "retry", "RETRY", "retrying", "RETRYING",
        "high load", "HIGH LOAD", "low memory", "LOW MEMORY",
        "disk space", "DISK SPACE", "threshold", "THRESHOLD"
    ]
}


# =============================================================================
# GITLAB-SPECIFIC JSON LOG PATTERNS
# =============================================================================

# For production_json.log, api_json.log, sidekiq_json.log, etc.
GITLAB_JSON_ERROR_FIELDS = {
    # Severity field patterns
    "severity_error": [
        '"severity":"ERROR"',
        '"severity": "ERROR"',
        '"severity":"error"',
        '"level":"error"',
        '"level": "error"',
    ],
    "severity_fatal": [
        '"severity":"FATAL"',
        '"severity": "FATAL"',
        '"severity":"fatal"',
        '"level":"fatal"',
    ],
    "severity_warn": [
        '"severity":"WARN"',
        '"severity": "WARN"',
        '"severity":"warn"',
        '"level":"warn"',
        '"level":"warning"',
    ],
    
    # Exception patterns
    "exception": [
        '"exception.class"',
        '"exception_class"',
        '"exception.message"',
        '"exception_message"',
        '"exception.backtrace"',
        '"backtrace"',
        '"error_class"',
        '"error_message"',
    ],
    
    # HTTP error status codes
    "http_5xx": [
        '"status":5',
        '"status": 5',
        '"status_code":5',
        '"status_code": 5',
    ],
    "http_4xx_important": [
        '"status":401',
        '"status":403',
        '"status":404',
        '"status":422',
        '"status":429',
    ],
    
    # Job failures
    "job_failure": [
        '"job_status":"fail"',
        '"job_status": "fail"',
        '"status":"fail"',
        '"failed":true',
        '"success":false',
    ]
}


# =============================================================================
# COMPONENT-SPECIFIC PATTERNS
# =============================================================================

COMPONENT_PATTERNS = {
    "sidekiq": {
        "errors": [
            # Job failures
            r'"class":"[^"]+","error_class":"([^"]+)"',
            r'"error_message":"([^"]+)"',
            r'fail.*JobWrapper',
            r'dead.*JobWrapper',
            r'retry_count.*exceeded',
            r'Sidekiq::Shutdown',
            r'job_status.*fail',
            # Memory issues
            r'exceeded memory limit',
            r'RSS.*exceeded',
        ],
        "keywords": [
            "error_class", "error_message", "fail", "dead", "retry",
            "exceeded", "Shutdown", "timeout"
        ]
    },
    
    "gitaly": {
        "errors": [
            # gRPC errors
            r'code.*Aborted',
            r'code.*Canceled',
            r'code.*DeadlineExceeded',
            r'code.*Internal',
            r'code.*NotFound',
            r'code.*PermissionDenied',
            r'code.*ResourceExhausted',
            r'code.*Unavailable',
            r'code.*Unknown',
            # Repository errors
            r'repository.*not found',
            r'repository.*does not exist',
            r'git.*fatal',
            r'pack-objects.*died',
            r'repository.*corrupted',
            # Connection errors
            r'dial.*connection refused',
            r'context deadline exceeded',
            r'stream terminated',
        ],
        "keywords": [
            "error", "fatal", "failed", "Aborted", "Canceled",
            "DeadlineExceeded", "Unavailable", "refused", "corrupted"
        ]
    },
    
    "praefect": {
        "errors": [
            r'replication.*failed',
            r'repository.*inconsistent',
            r'primary.*unavailable',
            r'secondary.*behind',
            r'quorum.*not reached',
            r'reconciliation.*failed',
        ],
        "keywords": [
            "error", "failed", "inconsistent", "unavailable",
            "behind", "quorum", "reconciliation"
        ]
    },
    
    "postgresql": {
        "errors": [
            # PostgreSQL error levels
            r'^ERROR:',
            r'^FATAL:',
            r'^PANIC:',
            r'LOG:.*ERROR',
            r'LOG:.*FATAL',
            # Specific errors
            r'deadlock detected',
            r'too many connections',
            r'connection refused',
            r'could not connect',
            r'out of shared memory',
            r'canceling statement',
            r'terminating connection',
            r'recovery conflict',
            r'lock timeout',
            r'statement timeout',
            r'duplicate key',
            r'foreign key constraint',
            r'relation.*does not exist',
            r'permission denied',
        ],
        "keywords": [
            "ERROR:", "FATAL:", "PANIC:", "deadlock", "too many connections",
            "connection refused", "out of memory", "timeout", "duplicate key"
        ]
    },
    
    "patroni": {
        "errors": [
            r'ERROR.*patroni',
            r'failed to.*postgres',
            r'leader.*lost',
            r'failover.*triggered',
            r'timeline.*diverged',
            r'replication.*lag',
            r'standby.*behind',
            r'checkpoint.*timeout',
        ],
        "keywords": [
            "ERROR", "failed", "lost", "failover", "diverged", "lag", "timeout"
        ]
    },
    
    "pgbouncer": {
        "errors": [
            r'ERROR.*pgbouncer',
            r'connection.*refused',
            r'server.*disconnected',
            r'client.*disconnected.*unexpectedly',
            r'login.*failed',
            r'pooler.*error',
            r'server_connect_timeout',
        ],
        "keywords": [
            "ERROR", "refused", "disconnected", "failed", "timeout"
        ]
    },
    
    "redis": {
        "errors": [
            r'#.*Error',
            r'MISCONF',
            r'LOADING',
            r'BUSY',
            r'OOM',
            r'maxmemory',
            r'connection.*refused',
            r'connection.*reset',
            r'Connection timed out',
            r'master.*down',
            r'replica.*stale',
        ],
        "keywords": [
            "Error", "MISCONF", "OOM", "refused", "reset", "timeout", "down", "stale"
        ]
    },
    
    "nginx": {
        "errors": [
            r'\s5\d{2}\s',  # 5xx status codes
            r'upstream.*error',
            r'upstream.*timeout',
            r'upstream.*refused',
            r'connect\(\).*failed',
            r'no live upstreams',
            r'client.*closed.*connection',
            r'SSL.*error',
            r'certificate.*error',
        ],
        "keywords": [
            "error", "failed", "timeout", "refused", "upstream", "SSL"
        ]
    },
    
    "puma": {
        "errors": [
            r'ERROR.*puma',
            r'worker.*died',
            r'worker.*timeout',
            r'worker.*killed',
            r'out of workers',
            r'backlog.*full',
            r'request.*timeout',
        ],
        "keywords": [
            "ERROR", "died", "timeout", "killed", "backlog"
        ]
    },
    
    "workhorse": {
        "errors": [
            r'error.*workhorse',
            r'502 Bad Gateway',
            r'504 Gateway Timeout',
            r'upstream.*error',
            r'request.*canceled',
        ],
        "keywords": [
            "error", "Bad Gateway", "Gateway Timeout", "upstream", "canceled"
        ]
    },
    
    "consul": {
        "errors": [
            r'\[ERR\]',
            r'\[ERROR\]',
            r'failed to sync',
            r'leader.*lost',
            r'no cluster leader',
            r'RPC.*failed',
            r'health check.*critical',
        ],
        "keywords": [
            "ERR", "ERROR", "failed", "lost", "critical"
        ]
    },
    
    "geo": {
        "errors": [
            r'Geo::.*Error',
            r'Geo::.*Registry.*failed',
            r'sync.*failed',
            r'checksum.*mismatch',
            r'repository.*verification.*failed',
            r'file.*missing',
            r'replication.*lag',
        ],
        "keywords": [
            "Error", "failed", "mismatch", "missing", "lag"
        ]
    },
    
    "registry": {
        "errors": [
            r'level.*error',
            r'error.*registry',
            r'blob.*unknown',
            r'manifest.*unknown',
            r'unauthorized',
            r'storage.*error',
        ],
        "keywords": [
            "error", "unknown", "unauthorized", "storage"
        ]
    },
    
    "system": {
        "errors": [
            r'kernel:.*error',
            r'kernel:.*failed',
            r'segfault',
            r'oom-killer',
            r'Out of memory',
            r'hardware error',
            r'I/O error',
            r'disk.*error',
            r'EXT4-fs error',
            r'XFS.*error',
            r'BTRFS.*error',
            r'device.*offline',
            r'link.*down',
            r'connection tracking.*full',
            r'nf_conntrack.*full',
        ],
        "keywords": [
            "error", "failed", "segfault", "oom", "Out of memory",
            "I/O error", "disk", "offline", "down"
        ]
    }
}


# =============================================================================
# SVLOG (daemontools/runit current files) PATTERNS
# =============================================================================

# These files use TAI64N timestamps and have specific patterns
SVLOG_PATTERNS = {
    "error_indicators": [
        r'level.*error',
        r'level.*fatal',
        r'level.*panic',
        r'"severity":"ERROR"',
        r'"severity":"FATAL"',
        r'\bERROR\b',
        r'\bFATAL\b',
        r'\bPANIC\b',
        r'\bFAIL',
        r'\bfailed\b',
    ],
    "warning_indicators": [
        r'level.*warn',
        r'"severity":"WARN"',
        r'\bWARN',
        r'\bwarning\b',
    ]
}


# =============================================================================
# LOG TYPE DETECTION
# =============================================================================

def detect_log_type(filepath: str, sample_lines: List[str] = None) -> str:
    """
    Detect the type of log file based on path and content.
    Returns component name like 'sidekiq', 'gitaly', 'postgresql', etc.
    """
    filepath_lower = filepath.lower()
    
    # Path-based detection
    path_mappings = {
        'sidekiq': ['sidekiq'],
        'gitaly': ['gitaly'],
        'praefect': ['praefect'],
        'postgresql': ['postgresql', 'postgres'],
        'patroni': ['patroni'],
        'pgbouncer': ['pgbouncer'],
        'redis': ['redis'],
        'nginx': ['nginx'],
        'puma': ['puma'],
        'workhorse': ['workhorse', 'gitlab-workhorse'],
        'consul': ['consul'],
        'geo': ['geo.log', 'geo_'],
        'registry': ['registry'],
        'gitlab-rails': ['gitlab-rails', 'production_json', 'api_json', 'application_json'],
        'system': ['syslog', 'messages', 'dmesg', 'kern.log', 'auth.log'],
    }
    
    for component, patterns in path_mappings.items():
        if any(p in filepath_lower for p in patterns):
            return component
    
    # Content-based detection for generic files like 'current'
    if sample_lines:
        sample_text = '\n'.join(sample_lines[:50])
        
        # Check for JSON log format
        if '"severity"' in sample_text or '"level"' in sample_text:
            if 'sidekiq' in sample_text.lower():
                return 'sidekiq'
            if 'gitaly' in sample_text.lower():
                return 'gitaly'
            return 'gitlab-rails'  # Default JSON logs
        
        # Check for PostgreSQL format
        if 'LOG:' in sample_text or 'ERROR:' in sample_text or 'FATAL:' in sample_text:
            return 'postgresql'
    
    return 'unknown'


def get_error_patterns_for_component(component: str) -> Dict:
    """Get the error detection patterns for a specific component."""
    if component in COMPONENT_PATTERNS:
        return COMPONENT_PATTERNS[component]
    return {
        "errors": [],
        "keywords": list(UNIVERSAL_ERROR_KEYWORDS[Severity.ERROR])
    }


# =============================================================================
# ERROR ANALYSIS FUNCTIONS
# =============================================================================

def analyze_line(line: str, component: str = 'unknown') -> Dict:
    """
    Analyze a single log line for errors.
    Returns dict with severity, matched_pattern, category, etc.
    """
    result = {
        'is_error': False,
        'severity': None,
        'matched_pattern': None,
        'category': None
    }
    
    # Check critical patterns first (most severe)
    for keyword in UNIVERSAL_ERROR_KEYWORDS[Severity.CRITICAL]:
        if keyword in line:
            result['is_error'] = True
            result['severity'] = 'critical'
            result['matched_pattern'] = keyword
            result['category'] = 'critical_error'
            return result
    
    # Check component-specific patterns
    patterns = get_error_patterns_for_component(component)
    
    for pattern in patterns.get('errors', []):
        try:
            if re.search(pattern, line, re.IGNORECASE):
                result['is_error'] = True
                result['severity'] = 'error'
                result['matched_pattern'] = pattern
                result['category'] = f'{component}_error'
                return result
        except re.error:
            # Invalid regex, try as literal
            if pattern in line:
                result['is_error'] = True
                result['severity'] = 'error'
                result['matched_pattern'] = pattern
                result['category'] = f'{component}_error'
                return result
    
    # Check component-specific keywords
    for keyword in patterns.get('keywords', []):
        if keyword.lower() in line.lower():
            result['is_error'] = True
            result['severity'] = 'error'
            result['matched_pattern'] = keyword
            result['category'] = f'{component}_error'
            return result
    
    # Check universal error keywords
    for keyword in UNIVERSAL_ERROR_KEYWORDS[Severity.ERROR]:
        if keyword in line:
            result['is_error'] = True
            result['severity'] = 'error'
            result['matched_pattern'] = keyword
            result['category'] = 'generic_error'
            return result
    
    # Check warnings
    for keyword in UNIVERSAL_ERROR_KEYWORDS[Severity.WARNING]:
        if keyword in line:
            result['is_error'] = False  # Warnings aren't errors
            result['severity'] = 'warning'
            result['matched_pattern'] = keyword
            result['category'] = 'warning'
            return result
    
    return result


def analyze_json_line(line: str) -> Dict:
    """
    Analyze a JSON-formatted log line.
    """
    import json
    
    result = {
        'is_error': False,
        'severity': None,
        'matched_pattern': None,
        'category': None,
        'parsed': None
    }
    
    try:
        data = json.loads(line)
        result['parsed'] = data
        
        # Check severity field
        severity = data.get('severity', data.get('level', '')).lower()
        
        if severity in ['fatal', 'panic', 'emergency']:
            result['is_error'] = True
            result['severity'] = 'critical'
            result['category'] = 'json_fatal'
            return result
        
        if severity == 'error':
            result['is_error'] = True
            result['severity'] = 'error'
            result['category'] = 'json_error'
            return result
        
        if severity in ['warn', 'warning']:
            result['severity'] = 'warning'
            result['category'] = 'json_warning'
            return result
        
        # Check for exception fields
        if any(k in data for k in ['exception.class', 'exception_class', 'error_class', 'backtrace']):
            result['is_error'] = True
            result['severity'] = 'error'
            result['category'] = 'exception'
            return result
        
        # Check HTTP status
        status = data.get('status', data.get('status_code'))
        if status and isinstance(status, (int, str)):
            status = int(status)
            if 500 <= status < 600:
                result['is_error'] = True
                result['severity'] = 'error'
                result['category'] = 'http_5xx'
                return result
            if status in [401, 403, 429]:
                result['severity'] = 'warning'
                result['category'] = 'http_auth_error'
                return result
        
        # Check job status
        job_status = data.get('job_status', data.get('status'))
        if job_status == 'fail':
            result['is_error'] = True
            result['severity'] = 'error'
            result['category'] = 'job_failure'
            return result
        
    except (json.JSONDecodeError, ValueError):
        # Not valid JSON, fall back to text analysis
        pass
    
    return result


def get_quick_error_check_keywords() -> List[str]:
    """
    Returns a list of keywords for quick initial error detection.
    Use these for fast preliminary filtering before detailed analysis.
    """
    return [
        # Critical
        "CRITICAL", "PANIC", "FATAL", "EMERGENCY", "OOM", "segfault",
        "kernel panic", "deadlock",
        
        # Error
        "ERROR", "Error", "error", "FAIL", "fail", "FAILED", "failed",
        "EXCEPTION", "Exception", "exception", "Traceback",
        "refused", "timeout", "TIMEOUT", "denied", "abort",
        
        # JSON markers
        '"severity":"ERROR"', '"severity":"FATAL"', '"level":"error"',
        '"exception', '"error_class"', '"status":5',
        
        # Component specific
        "ERROR:", "FATAL:", "[ERR]", "[ERROR]",
        "upstream error", "Bad Gateway", "Gateway Timeout"
    ]


def compile_error_regex() -> Pattern:
    """
    Compile a single regex pattern that matches most common errors.
    Use for fast scanning of large files.
    """
    patterns = [
        r'\bERROR\b',
        r'\bFATAL\b',
        r'\bPANIC\b',
        r'\bCRITICAL\b',
        r'\bFAIL(?:ED|URE)?\b',
        r'\bEXCEPTION\b',
        r'\bTraceback\b',
        r'"severity"\s*:\s*"(?:ERROR|FATAL)"',
        r'"level"\s*:\s*"(?:error|fatal)"',
        r'"exception[._](?:class|message)"',
        r'"status"\s*:\s*5\d{2}',
        r'ERROR:',
        r'FATAL:',
        r'\[ERR(?:OR)?\]',
    ]
    
    return re.compile('|'.join(patterns), re.IGNORECASE)


# Pre-compiled regex for performance
FAST_ERROR_REGEX = compile_error_regex()


def quick_scan_for_errors(lines: List[str]) -> List[int]:
    """
    Quick scan to find line numbers that likely contain errors.
    Returns list of line indices (0-based).
    """
    error_lines = []
    
    for idx, line in enumerate(lines):
        if FAST_ERROR_REGEX.search(line):
            error_lines.append(idx)
    
    return error_lines


# =============================================================================
# SUMMARY GENERATION
# =============================================================================

def generate_error_summary(errors: List[Dict], total_lines: int) -> Dict:
    """
    Generate a summary of detected errors.
    """
    if not errors:
        return {
            'total_errors': 0,
            'error_rate': 0.0,
            'severity_breakdown': {},
            'category_breakdown': {},
            'top_patterns': []
        }
    
    severity_counts = {}
    category_counts = {}
    pattern_counts = {}
    
    for error in errors:
        sev = error.get('severity', 'unknown')
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
        
        cat = error.get('category', 'unknown')
        category_counts[cat] = category_counts.get(cat, 0) + 1
        
        pattern = error.get('matched_pattern', 'unknown')
        pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1
    
    # Sort patterns by count
    top_patterns = sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    
    return {
        'total_errors': len(errors),
        'error_rate': round(len(errors) / total_lines * 100, 2) if total_lines > 0 else 0,
        'severity_breakdown': severity_counts,
        'category_breakdown': category_counts,
        'top_patterns': top_patterns
    }