"""
Power Search Engine - Production-grade search for GitLab logs and KubeSOS
Enhanced to handle Kubernetes logs, events, and resource descriptions
Performance optimized with memory-efficient streaming and caching
Now with wildcard support and comma-separated values
"""

import re
import json
from typing import List, Dict, Set, Optional, Tuple, Any, Generator, Union
from dataclasses import dataclass, field
from enum import Enum
import operator
from datetime import datetime, timedelta
from pathlib import Path
import mmap
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
from collections import defaultdict, OrderedDict, deque
import logging
import gc
from functools import lru_cache

logger = logging.getLogger(__name__)

class FieldType(Enum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    TIMESTAMP = "timestamp"
    ARRAY = "array"
    OBJECT = "object"

class Operator(Enum):
    # Comparison
    EQ = "="
    NEQ = "!="
    GT = ">"
    GTE = ">="
    LT = "<"
    LTE = "<="
    
    # String
    CONTAINS = "~"
    NOT_CONTAINS = "!~"
    REGEX = "=~"
    NOT_REGEX = "!~"
    
    # Logical
    AND = "AND"
    OR = "OR"
    NOT = "NOT"
    
    # Special
    EXISTS = "EXISTS"
    NOT_EXISTS = "!EXISTS"
    IN = "IN"
    NOT_IN = "NOT IN"

@dataclass
class SearchFilter:
    field: Optional[str]
    operator: Operator
    value: Any
    is_negated: bool = False

@dataclass
class SearchQuery:
    filters: List[SearchFilter] = field(default_factory=list)
    logical_op: Operator = Operator.AND
    sub_queries: List['SearchQuery'] = field(default_factory=list)
    is_negated: bool = False

class WildcardMatcher:
    """Efficient wildcard pattern matching"""
    
    @staticmethod
    def wildcard_to_regex(pattern: str) -> str:
        """Convert wildcard pattern to regex"""
        # Escape special regex chars except our wildcards
        escaped = re.escape(pattern)
        # Replace escaped wildcards with regex equivalents
        escaped = escaped.replace(r'\*', '.*')
        escaped = escaped.replace(r'\?', '.')
        # Handle character classes [abc]
        escaped = re.sub(r'\\(\[[^\]]+\])', r'\1', escaped)
        return f'^{escaped}$'
    
    @staticmethod
    def match(pattern: str, value: str, case_sensitive: bool = False) -> bool:
        """Match value against wildcard pattern"""
        regex = WildcardMatcher.wildcard_to_regex(pattern)
        flags = 0 if case_sensitive else re.IGNORECASE
        return bool(re.match(regex, value, flags))
    
class PowerSearchEngine:
    """
    Production-grade search engine for log analysis
    Enhanced for KubeSOS support with performance optimizations
    """
    
    def __init__(self, max_workers: int = 4):
        self.field_types = {}  # Dynamically discovered field types
        self.field_values = {}  # Sample values for autocomplete
        self.common_fields = set()  # Fields that appear frequently
        self.indexed_files = {}  # File metadata cache
        self.max_workers = max_workers
        
        # Thread-safe caches
        self._cache_lock = threading.Lock()
        self._json_cache = OrderedDict()  # LRU cache for parsed JSON
        self._regex_cache = {}  # Compiled regex patterns
        self._service_cache = {}  # Service detection cache
        
        # Performance settings
        self.MAX_CACHE_SIZE = 10000
        self.CHUNK_SIZE = 8192  # For file reading
        
        # Enhanced for KubeSOS - recognize Kubernetes resource files
        self.kubernetes_resource_files = {
            'events', 'all_events', 'describe_pods', 'describe_nodes',
            'describe_deployments', 'get_pods', 'get_services', 'get_endpoints',
            'top_pods', 'top_nodes', 'describe_pv', 'describe_pvc'
        }
        
        # Service detection patterns based on GitLab's official log structure
        self.service_patterns = {
            'rails': ['production_json.log', 'production.log', 'api_json.log', 'application_json.log',
                     'application.log', 'integrations_json.log', 'kubernetes.log', 'git_json.log',
                     'audit_json.log', 'importer.log', 'exporter.log', 'features_json.log',
                     'ci_resource_groups_json.log', 'auth.log', 'auth_json.log', 'graphql_json.log',
                     'migrations.log', 'web_hooks.log', 'elasticsearch.log', 'exceptions_json.log',
                     'service_measurement.log', 'geo.log', 'update_mirror_service_json.log',
                     'llm.log', 'database_load_balancing.log', 'clickhouse.log', 'zoekt.log',
                     'repocheck.log', 'sidekiq_client.log', 'epic_work_item_sync.log',
                     'secret_push_protection.log', 'active_context.log', 'performance_bar_json.log',
                     'backup_json.log', 'product_usage_data.log'],
            'sidekiq': ['sidekiq.log', '/sidekiq/current'],
            'gitaly': ['gitaly', 'gitaly_hooks.log', 'grpc.log'],
            'workhorse': ['gitlab-workhorse', 'workhorse'],
            'nginx': ['nginx', 'gitlab_access.log', 'gitlab_error.log', 'gitlab_pages_access.log',
                     'gitlab_pages_error.log', 'gitlab_registry_access.log', 'gitlab_registry_error.log'],
            'postgresql': ['postgresql', 'postgres'],
            'redis': ['redis'],
            'puma': ['puma_stdout.log', 'puma_stderr.log'],
            'shell': ['gitlab-shell.log', 'gitlab-shell'],
            'pages': ['gitlab-pages', 'pages'],
            'registry': ['registry'],
            'prometheus': ['prometheus'],
            'alertmanager': ['alertmanager'],
            'grafana': ['grafana'],
            'patroni': ['patroni'],
            'pgbouncer': ['pgbouncer'],
            'praefect': ['praefect'],
            'kas': ['gitlab-kas', 'kas'],
            'mailroom': ['mailroom', 'mail_room_json.log'],
            'sentinel': ['sentinel'],
            'letsencrypt': ['lets-encrypt'],
            'mattermost': ['mattermost'],
            'gitlab-exporter': ['gitlab-exporter'],
            'logrotate': ['logrotate'],
            'crond': ['crond'],
            'reconfigure': ['reconfigure']
        }
        
        # Precompile common regex patterns
        self._compile_common_patterns()
    
    def _compile_common_patterns(self):
        """Precompile commonly used regex patterns"""
        common_patterns = {
            'json_timestamp': re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(\{.+\})\s*$'),
            'key_value': re.compile(r'(\w+)=([^\s]+)'),
            'key_colon_value': re.compile(r'(\w+):([^\s]+)'),
            'iso_timestamp': re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?'),
            'severity_patterns': re.compile(r'\b(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|CRITICAL)\b', re.IGNORECASE)
        }
        self._regex_cache.update(common_patterns)
    
    def _get_compiled_regex(self, pattern: str, flags: int = 0) -> re.Pattern:
        """Get or compile a regex pattern with caching"""
        cache_key = (pattern, flags)
        if cache_key not in self._regex_cache:
            self._regex_cache[cache_key] = re.compile(pattern, flags)
        return self._regex_cache[cache_key]
    
    def analyze_log_structure(self, session_id: str, log_files: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dynamically analyze log structure to understand available fields
        Enhanced to understand Kubernetes resource outputs
        """
        logger.info(f"Analyzing log structure for session {session_id}")
        
        field_stats = defaultdict(lambda: {'count': 0, 'types': defaultdict(int), 'values': defaultdict(int)})
        total_lines_analyzed = 0
        
        # Use thread pool for parallel file analysis
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []
            
            for file_path, file_info in log_files.items():
                future = executor.submit(self._analyze_single_file, file_path, file_info)
                futures.append((file_path, future))
            
            # Collect results
            for file_path, future in futures:
                try:
                    file_stats, lines_count = future.result(timeout=30)
                    total_lines_analyzed += lines_count
                    
                    # Merge stats
                    for field, stats in file_stats.items():
                        field_stats[field]['count'] += stats['count']
                        for type_name, count in stats['types'].items():
                            field_stats[field]['types'][type_name] += count
                        for value, count in stats['values'].items():
                            field_stats[field]['values'][value] += count
                except Exception as e:
                    logger.error(f"Error analyzing file {file_path}: {e}")
        
        # Process statistics
        analysis = {
            'total_lines_analyzed': total_lines_analyzed,
            'discovered_fields': {},
            'common_values': {},
            'suggested_filters': []
        }
        
        # Determine field types and common values
        for field_path, stats in field_stats.items():
            if stats['count'] > total_lines_analyzed * 0.1:  # Field appears in >10% of logs
                self.common_fields.add(field_path)
            
            # Determine field type
            field_type = self._determine_field_type(stats['types'])
            self.field_types[field_path] = field_type
            
            # Sort values by frequency and limit
            sorted_values = sorted(stats['values'].items(), key=lambda x: x[1], reverse=True)
            
            analysis['discovered_fields'][field_path] = {
                'type': field_type.value,
                'count': stats['count'],
                'sample_values': [v for v, _ in sorted_values[:10]],  # Top 10 values
                'is_common': field_path in self.common_fields
            }
            
            # Store for autocomplete
            if field_type in [FieldType.STRING, FieldType.NUMBER]:
                self.field_values[field_path] = [v for v, _ in sorted_values[:100]]
        
        # Generate suggested filters based on common patterns
        analysis['suggested_filters'] = self._generate_filter_suggestions(dict(field_stats))
        
        logger.info(f"Discovered {len(self.field_types)} fields across {total_lines_analyzed} lines")
        
        return analysis
    
    def _analyze_single_file(self, file_path: str, file_info: Dict[str, Any]) -> Tuple[Dict, int]:
        """Analyze a single file and return stats"""
        field_stats = defaultdict(lambda: {'count': 0, 'types': defaultdict(int), 'values': defaultdict(int)})
        lines_analyzed = 0
        
        # Sample the file to understand structure
        samples = self._sample_file(file_path, file_info.get('full_path'))
        
        # Check if this is a Kubernetes resource file
        filename = Path(file_path).name
        if self._is_kubernetes_resource_file(filename):
            # Special handling for Kubernetes resources
            self._analyze_kubernetes_resource(samples, field_stats, filename)
            lines_analyzed = len(samples)
        else:
            # Regular log analysis
            for line in samples:
                lines_analyzed += 1
                
                # Try to parse as JSON (including timestamp-prefixed)
                parsed_json = self._try_parse_json(line)
                if parsed_json:
                    self._analyze_json_fields(parsed_json, field_stats)
                else:
                    # Plain text line
                    self._analyze_text_line(line, field_stats)
        
        return dict(field_stats), lines_analyzed
    
    def _try_parse_json(self, line: str) -> Optional[Dict]:
        """Try to parse JSON from a line, handling various formats with caching"""
        if not line.strip():
            return None
        
        # Check cache first
        line_hash = hash(line)
        with self._cache_lock:
            if line_hash in self._json_cache:
                # Move to end (LRU)
                result = self._json_cache.pop(line_hash)
                self._json_cache[line_hash] = result
                return result
        
        result = None
        
        # Try pure JSON first
        if line.strip().startswith('{'):
            try:
                result = json.loads(line.strip())
            except:
                pass
        
        # Try timestamp-prefixed JSON (KubeSOS format)
        if result is None and 'json_timestamp' in self._regex_cache:
            match = self._regex_cache['json_timestamp'].search(line)
            if match:
                try:
                    result = json.loads(match.group(1))
                except:
                    pass
        
        # Cache the result
        with self._cache_lock:
            self._json_cache[line_hash] = result
            # Maintain cache size
            if len(self._json_cache) > self.MAX_CACHE_SIZE:
                # Remove oldest entries
                for _ in range(len(self._json_cache) // 10):
                    self._json_cache.popitem(last=False)
        
        return result
    
    def _is_kubernetes_resource_file(self, filename: str) -> bool:
        """Check if this is a Kubernetes resource output file"""
        return filename in self.kubernetes_resource_files
    
    def _analyze_kubernetes_resource(self, samples: List[str], field_stats: Dict, filename: str):
        """Analyze Kubernetes resource outputs (events, describe commands, etc.)"""
        
        if 'events' in filename:
            # Parse Kubernetes events format
            for line in samples[1:]:  # Skip header
                if not line.strip():
                    continue
                    
                # Events have structured columns, extract common fields
                event_fields = ['TYPE', 'REASON', 'OBJECT', 'MESSAGE']
                for field in event_fields:
                    field_stats[field]['count'] += 1
                    field_stats[field]['types']['string'] += 1
                    
                    # Extract actual values from line
                    if 'Warning' in line or 'Error' in line:
                        field_stats['TYPE']['values']['Warning'] += 1
        
        elif 'describe_pods' in filename:
            # Parse pod descriptions for common fields
            pod_fields = ['Name', 'Namespace', 'Status', 'Node', 'Container']
            for field in pod_fields:
                field_stats[field]['count'] += 1
                field_stats[field]['types']['string'] += 1
    
    def parse_query(self, query_string: str) -> SearchQuery:
        """
        Parse query string into structured query object - ULTRA ROBUST version
        Properly handles field:"multi word value" including with NOT
        """
        # Preserve the original query for debugging
        original_query = query_string
        
        # Basic cleanup but preserve structure
        query_string = ' '.join(query_string.split())
        
        # Handle parentheses by creating sub-queries
        if '(' in query_string:
            return self._parse_complex_query(query_string)
        
        query = SearchQuery()
        
        # Enhanced tokenization that properly handles field:"value with spaces"
        tokens = self._tokenize_query(query_string)
        
        # Debug logging
        logger.debug(f"Tokenized query: {tokens}")
        
        i = 0
        while i < len(tokens):
            token = tokens[i]
            
            # Handle NOT operator - special handling for field:"value" patterns
            if token == 'NOT' and i + 1 < len(tokens):
                i += 1
                next_token = tokens[i]
                
                # Check if NOT is followed by a field:value filter
                filter_item = self._parse_single_filter(next_token)
                filter_item.is_negated = True
                query.filters.append(filter_item)
                i += 1
                continue
            
            # Handle AND/OR operators
            if token in ['AND', 'OR']:
                if len(query.filters) > 0 or len(query.sub_queries) > 0:
                    query.logical_op = Operator.AND if token == 'AND' else Operator.OR
                i += 1
                continue
            
            # Regular filter
            filter_item = self._parse_single_filter(token)
            query.filters.append(filter_item)
            i += 1
        
        return query
    
    def _tokenize_query(self, query_string: str) -> List[str]:
        """Tokenize query string preserving quoted strings and field:value pairs - ULTRA ROBUST"""
        tokens = []
        current_token = []
        in_quotes = False
        quote_char = None
        i = 0
        
        while i < len(query_string):
            char = query_string[i]
            
            # Handle quotes
            if char in '"\'':
                if not in_quotes:
                    # Starting a quoted section
                    in_quotes = True
                    quote_char = char
                    current_token.append(char)
                elif char == quote_char:
                    # Ending the quoted section
                    current_token.append(char)
                    in_quotes = False
                    quote_char = None
                    # DON'T break the token here - let it complete with the field
                else:
                    # Different quote inside quotes
                    current_token.append(char)
                i += 1
                continue
            
            # Inside quotes, just append everything
            if in_quotes:
                current_token.append(char)
                i += 1
                continue
            
            # Handle spaces outside quotes
            if char.isspace():
                if current_token:
                    token_str = ''.join(current_token)
                    # Check if this completes a field:value or field:"value" token
                    if ':' in token_str or '=' in token_str or '>' in token_str or '<' in token_str or '~' in token_str or '!' in token_str:
                        tokens.append(token_str)
                    elif token_str.upper() in ['AND', 'OR', 'NOT']:
                        tokens.append(token_str.upper())
                    else:
                        tokens.append(token_str)
                    current_token = []
                i += 1
                continue
            
            # Check for logical operators at word boundaries
            if not in_quotes and current_token == [] and i < len(query_string) - 2:
                # Look for AND, OR, NOT at the beginning of a token
                remaining = query_string[i:].upper()
                if remaining.startswith('AND '):
                    tokens.append('AND')
                    i += 4  # Skip 'AND '
                    continue
                elif remaining.startswith('OR '):
                    tokens.append('OR')
                    i += 3  # Skip 'OR '
                    continue
                elif remaining.startswith('NOT '):
                    tokens.append('NOT')
                    i += 4  # Skip 'NOT '
                    continue
            
            # Regular character - build token
            current_token.append(char)
            i += 1
        
        # Add final token
        if current_token:
            token_str = ''.join(current_token)
            if token_str.upper() in ['AND', 'OR', 'NOT']:
                tokens.append(token_str.upper())
            else:
                tokens.append(token_str)
        
        return tokens
    
    def _parse_complex_query(self, query_string: str) -> SearchQuery:
        """Parse complex queries with parentheses"""
        query = SearchQuery()
        
        # Find all parentheses groups
        paren_groups = []
        level = 0
        current_group = []
        
        i = 0
        while i < len(query_string):
            if query_string[i] == '(':
                if level == 0:
                    current_group = [i]
                level += 1
            elif query_string[i] == ')':
                level -= 1
                if level == 0:
                    current_group.append(i)
                    paren_groups.append(tuple(current_group))
            i += 1
        
        if not paren_groups:
            # No valid parentheses, parse as simple query
            return self.parse_query(query_string.replace('(', '').replace(')', ''))
        
        # Replace parentheses groups with placeholders and parse
        modified_query = query_string
        group_contents = {}
        
        for idx, (start, end) in enumerate(reversed(paren_groups)):
            placeholder = f"__GROUP_{idx}__"
            group_content = query_string[start+1:end]
            group_contents[placeholder] = group_content
            modified_query = modified_query[:start] + placeholder + modified_query[end+1:]
        
        # Tokenize the modified query
        tokens = self._tokenize_query(modified_query)
        
        i = 0
        while i < len(tokens):
            token = tokens[i]
            
            if token in ['AND', 'OR']:
                if i == 1:  # First operator determines main logical op
                    query.logical_op = Operator.AND if token == 'AND' else Operator.OR
                i += 1
                continue
            
            # Handle NOT before groups
            is_negated = False
            if token == 'NOT' and i + 1 < len(tokens):
                is_negated = True
                i += 1
                token = tokens[i]
            
            if token.startswith('__GROUP_') and token.endswith('__'):
                # Parse sub-query
                sub_query_str = group_contents[token]
                sub_query = self.parse_query(sub_query_str)
                sub_query.is_negated = is_negated
                query.sub_queries.append(sub_query)
            else:
                # Regular filter
                filter_item = self._parse_single_filter(token)
                filter_item.is_negated = is_negated
                query.filters.append(filter_item)
            
            i += 1
        
        return query
    
    def _parse_single_filter(self, filter_str: str) -> SearchFilter:
        """Parse a single filter expression - ULTRA ROBUST with better quote handling"""
        
        # Clean up the filter string
        filter_str = filter_str.strip()
        
        # Remove outer parentheses if present
        if filter_str.startswith('(') and filter_str.endswith(')'):
            inner = filter_str[1:-1]
            if ' AND ' not in inner.upper() and ' OR ' not in inner.upper():
                filter_str = inner
        
        # ENHANCED patterns that properly capture quoted values
        # The key is to use non-greedy matching for the field part
        patterns = [
            # Quoted value patterns (highest priority)
            (r'^(.+?)!="([^"]*)"$', Operator.NEQ),  # field!="value with spaces"
            (r'^(.+?)!=\'([^\']*)\'$', Operator.NEQ),  # field!='value with spaces'
            (r'^(.+?)!~"([^"]*)"$', Operator.NOT_CONTAINS),  # field!~"value"
            (r'^(.+?)!~\'([^\']*)\'$', Operator.NOT_CONTAINS),  # field!~'value'
            (r'^(.+?)="([^"]*)"$', Operator.EQ),  # field="value with spaces"
            (r'^(.+?)=\'([^\']*)\'$', Operator.EQ),  # field='value with spaces'
            (r'^(.+?)~"([^"]*)"$', Operator.CONTAINS),  # field~"value"
            (r'^(.+?)~\'([^\']*)\'$', Operator.CONTAINS),  # field~'value'
            (r'^(.+?):"([^"]*)"$', Operator.EQ),  # field:"value with spaces" (colon syntax)
            (r'^(.+?):\'([^\']*)\'$', Operator.EQ),  # field:'value with spaces'
            
            # Unquoted patterns (lower priority)
            (r'^(.+?)!=(.+)$', Operator.NEQ),
            (r'^(.+?)!~(.+)$', Operator.NOT_CONTAINS),
            (r'^(.+?)>=(.+)$', Operator.GTE),
            (r'^(.+?)<=(.+)$', Operator.LTE),
            (r'^(.+?)>(.+)$', Operator.GT),
            (r'^(.+?)<(.+)$', Operator.LT),
            (r'^(.+?)=~(.+)$', Operator.REGEX),
            (r'^(.+?)~(.+)$', Operator.CONTAINS),
            (r'^(.+?)=(.+)$', Operator.EQ),
            (r'^(.+?):(.+)$', Operator.EQ),  # Colon syntax without quotes
        ]
        
        for pattern, op in patterns:
            match = re.match(pattern, filter_str)
            if match:
                field = match.group(1).strip()
                value = match.group(2)  # Don't strip the value yet
                
                # For quoted patterns, the quotes are already removed by the regex
                # For unquoted patterns, we need to clean up
                if not ('"' in pattern or "'" in pattern):
                    value = value.strip()
                    # Remove quotes if they exist in unquoted patterns
                    if (value.startswith('"') and value.endswith('"')) or \
                       (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                
                # Handle comma-separated values for IN operations
                if ',' in value and op in [Operator.EQ, Operator.NEQ]:
                    values = [v.strip() for v in value.split(',')]
                    if op == Operator.EQ:
                        return SearchFilter(field=field, operator=Operator.IN, value=values)
                    else:
                        return SearchFilter(field=field, operator=Operator.NOT_IN, value=values)
                
                # Type conversion for numeric comparisons
                if op in [Operator.GT, Operator.GTE, Operator.LT, Operator.LTE]:
                    try:
                        value = float(value)
                    except:
                        pass
                
                return SearchFilter(field=field, operator=op, value=value)
        
        # If no operator found, treat as text search
        search_text = filter_str.strip()
        if (search_text.startswith('"') and search_text.endswith('"')) or \
           (search_text.startswith("'") and search_text.endswith("'")):
            search_text = search_text[1:-1]
        
        return SearchFilter(field=None, operator=Operator.CONTAINS, value=search_text)
    
    def search(self, session_id: str, query: Union[str, SearchQuery], 
               files: Dict[str, Any], limit: int = 1000,
               context_lines: int = 0) -> Generator[Dict, None, None]:
        """
        Execute search and yield results as they're found
        Enhanced to search through Kubernetes resource files
        Accepts both string queries and SearchQuery objects
        """
        
        # Parse query if string
        if isinstance(query, str):
            query = self.parse_query(query)
        
        result_count = 0
        files_searched = 0
        
        logger.info(f"Power Search: Starting search across {len(files)} files")
        
        # Pre-filter files based on service filters for efficiency
        service_filters = [f for f in query.filters if f.field == 'service']
        filtered_files = files
        
        if service_filters and query.logical_op == Operator.AND:
            # If we have service filters with AND, we can pre-filter files
            filtered_files = {}
            for file_path, file_info in files.items():
                service = self._detect_service_from_path(file_path)
                filename = file_path.split('/')[-1].lower()
                
                # Check all service filters
                matches_all = True
                for sf in service_filters:
                    # Handle IN operator (comma-separated values)
                    if sf.operator == Operator.IN:
                        matched_any = False
                        for filter_value in sf.value:
                            if self._match_service_pattern(service, filename, str(filter_value)):
                                matched_any = True
                                break
                        if not matched_any:
                            matches_all = False
                            break
                    else:
                        filter_value = str(sf.value)
                        if not self._match_service_pattern(service, filename, filter_value):
                            matches_all = False
                            break
                
                if matches_all:
                    filtered_files[file_path] = file_info
            
            logger.info(f"Pre-filtered to {len(filtered_files)} files based on service filters")
        
        # Search files
        for file_path, file_info in filtered_files.items():
            if result_count >= limit:
                break
                
            full_path = file_info.get('full_path')
            if not full_path or not os.path.exists(full_path):
                logger.warning(f"Skipping {file_path}: File not found at {full_path}")
                continue
            
            service = self._detect_service_from_path(file_path)
            files_searched += 1
            
            # Check if this is a Kubernetes resource file
            filename = Path(file_path).name
            if self._is_kubernetes_resource_file(filename):
                # Special handling for Kubernetes resources
                for result in self._search_kubernetes_resource(full_path, filename, query, file_path):
                    if result_count >= limit:
                        break
                    result_count += 1
                    yield result
            else:
                # Regular log file search - use memory-mapped file for efficiency
                try:
                    for result in self._search_regular_file(full_path, file_path, query, context_lines):
                        if result_count >= limit:
                            break
                        result_count += 1
                        yield result
                except Exception as e:
                    logger.error(f"Error searching file {file_path}: {e}")
        
        logger.info(f"Power Search complete: {result_count} results found across {files_searched} files")
    
    def _match_service_pattern(self, service: str, filename: str, pattern: str) -> bool:
        """Check if service/filename matches a pattern (with wildcard and sub-service support)"""
        # Check for wildcards
        if '*' in pattern or '?' in pattern:
            if ':' in pattern:
                # Sub-service with wildcards
                parts = pattern.split(':', 1)
                main_pattern, sub_pattern = parts
                
                if not WildcardMatcher.match(main_pattern, service):
                    return False
                
                # Check filename with wildcard
                return (WildcardMatcher.match(sub_pattern, filename) or 
                        WildcardMatcher.match(sub_pattern, filename.replace('.log', '')))
            else:
                # Just service wildcard
                return WildcardMatcher.match(pattern, service)
        
        # Regular pattern (no wildcards)
        if ':' in pattern:
            # Sub-service filter
            main_service, sub_service = pattern.split(':', 1)
            if service != main_service:
                return False
            
            # Check filename match
            sub_service_norm = sub_service.replace('_', '').replace('.log', '')
            filename_norm = filename.replace('_', '').replace('.log', '')
            
            return (sub_service in filename or sub_service_norm in filename_norm)
        else:
            # Regular service filter
            return service == pattern
    
    def _search_regular_file(self, full_path: str, file_path: str, query: SearchQuery, context_lines: int) -> Generator[Dict, None, None]:
        """Search a regular log file using memory-mapped file for efficiency"""
        
        with open(full_path, 'rb') as f:
            # Get file size
            f.seek(0, os.SEEK_END)
            file_size = f.tell()
            if file_size == 0:
                return
            f.seek(0)
            
            # Use mmap for large files
            if file_size > 1024 * 1024:  # 1MB
                with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mmapped:
                    yield from self._search_mmap_file(mmapped, file_path, query, context_lines)
            else:
                # Small file, read normally
                f.seek(0)
                content = f.read().decode('utf-8', errors='ignore')
                lines = content.splitlines()
                
                context_buffer = []
                for line_num, line in enumerate(lines, 1):
                    if not line or line.isspace():
                        continue
                    
                    matches, match_details = self._match_line(line, query, file_path)
                    
                    if matches:
                        result = {
                            'file': file_path,
                            'line_number': line_num,
                            'content': line,
                            'match_details': match_details,
                            'service': self._detect_service_from_path(file_path),
                            'context': {}
                        }
                        
                        # Add context
                        if context_lines > 0:
                            if context_buffer:
                                result['context']['before'] = context_buffer[-context_lines:]
                            
                            # Get after context
                            after_context = []
                            for i in range(1, min(context_lines + 1, len(lines) - line_num + 1)):
                                after_context.append(lines[line_num - 1 + i])
                            result['context']['after'] = after_context
                        
                        yield result
                    
                    # Maintain context buffer
                    if context_lines > 0:
                        context_buffer.append(line)
                        if len(context_buffer) > context_lines:
                            context_buffer.pop(0)
    
    def _search_mmap_file(self, mmapped: mmap.mmap, file_path: str, query: SearchQuery, context_lines: int) -> Generator[Dict, None, None]:
        """Search through a memory-mapped file"""
        
        context_buffer = []
        line_number = 0
        
        # Read file in chunks for better performance
        chunk_overlap = 1024  # Overlap to handle lines split across chunks
        position = 0
        leftover = b""
        
        while position < len(mmapped):
            # Read chunk
            chunk_size = min(self.CHUNK_SIZE, len(mmapped) - position)
            chunk = leftover + mmapped[position:position + chunk_size]
            position += chunk_size
            
            # Find last newline in chunk
            last_newline = chunk.rfind(b'\n')
            if last_newline == -1:
                # No newline in chunk, keep it all as leftover
                leftover = chunk
                continue
            
            # Process complete lines
            lines = chunk[:last_newline].split(b'\n')
            leftover = chunk[last_newline + 1:]
            
            for line_bytes in lines:
                line_number += 1
                
                try:
                    line = line_bytes.decode('utf-8', errors='replace')
                except:
                    continue
                
                if not line or line.isspace():
                    continue
                
                # Maintain context buffer
                if context_lines > 0:
                    context_buffer.append((line_number, line))
                    if len(context_buffer) > context_lines * 2 + 1:
                        context_buffer.pop(0)
                
                # Check if line matches
                matches, match_details = self._match_line(line, query, file_path)
                
                if matches:
                    result = {
                        'file': file_path,
                        'line_number': line_number,
                        'content': line,
                        'match_details': match_details,
                        'service': self._detect_service_from_path(file_path),
                        'context': {}
                    }
                    
                    # Add context
                    if context_lines > 0 and context_buffer:
                        # Get before context
                        buffer_idx = len(context_buffer) - 1
                        context_before = []
                        for i in range(min(context_lines, buffer_idx)):
                            ctx_line_num, ctx_line = context_buffer[buffer_idx - i - 1]
                            if ctx_line_num < line_number:
                                context_before.insert(0, ctx_line)
                        result['context']['before'] = context_before
                        
                        # For after context, we'll need to read ahead
                        # This is handled separately for mmap efficiency
                        result['context']['after'] = []
                    
                    yield result
        
        # Process any leftover data
        if leftover:
            line_number += 1
            try:
                line = leftover.decode('utf-8', errors='replace')
                matches, match_details = self._match_line(line, query, file_path)
                
                if matches:
                    yield {
                        'file': file_path,
                        'line_number': line_number,
                        'content': line,
                        'match_details': match_details,
                        'service': self._detect_service_from_path(file_path),
                        'context': {}
                    }
            except:
                pass
    
    def _search_kubernetes_resource(self, file_path: str, filename: str, query: SearchQuery, relative_path: str) -> Generator[Dict, None, None]:
        """Search through Kubernetes resource files (events, describe outputs, etc.)"""
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        
        if 'events' in filename:
            # Parse events with column structure
            if not lines:
                return
                
            # First line is header
            header = lines[0] if lines else ''
            
            for line_num, line in enumerate(lines[1:], 2):  # Start from line 2
                if not line.strip():
                    continue
                    
                # Create a pseudo-structured format for events
                event_data = self._parse_event_line(line, header)
                
                # Check if it matches the query
                matches, match_details = self._match_structured_data(event_data, query, relative_path)
                
                if matches:
                    yield {
                        'file': relative_path,
                        'line_number': line_num,
                        'content': line.rstrip('\n\r'),
                        'match_details': match_details,
                        'service': 'kubernetes-events',
                        'parsed_data': event_data
                    }
        
        elif 'describe' in filename:
            # For describe outputs, search line by line but with context awareness
            current_section = None
            
            for line_num, line in enumerate(lines, 1):
                # Track sections (e.g., "Name:", "Containers:", etc.)
                if line and not line[0].isspace() and ':' in line:
                    current_section = line.split(':')[0].strip()
                
                matches, match_details = self._match_line(line, query, relative_path)
                
                if matches:
                    # Add section context
                    match_details['section'] = current_section
                    
                    yield {
                        'file': relative_path,
                        'line_number': line_num,
                        'content': line.rstrip('\n\r'),
                        'match_details': match_details,
                        'service': 'kubernetes-resources'
                    }
    
    def _parse_event_line(self, line: str, header: str) -> Dict:
        """Parse a Kubernetes event line into structured data"""
        event_data = {}
        
        # Common columns in kubectl events output
        columns = ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE']
        
        # Try to extract based on position or pattern
        parts = line.split()
        if len(parts) >= 4:
            # Basic parsing - this could be enhanced based on actual format
            if 'Warning' in line or 'Normal' in line:
                for i, part in enumerate(parts):
                    if part in ['Warning', 'Normal', 'Error']:
                        event_data['TYPE'] = part
                        break
            
            # Extract reason (usually after type)
            if 'Failed' in line:
                event_data['REASON'] = 'Failed'
            elif 'Created' in line:
                event_data['REASON'] = 'Created'
            
            # The message is usually the last part
            if len(parts) > 5:
                event_data['MESSAGE'] = ' '.join(parts[5:])
        
        return event_data
    
    def _match_structured_data(self, data: Dict, query: SearchQuery, file_path: str) -> Tuple[bool, Dict]:
        """Match structured data (like parsed events) against query"""
        match_details = {
            'matched_filters': [],
            'parsed_fields': data,
            'file_service': 'kubernetes'
        }
        
        # Evaluate filters against the structured data
        filter_results = []
        for filter_item in query.filters:
            matched = False
            details = {}
            
            if filter_item.field:
                # Field-based search in structured data
                if filter_item.field in data:
                    field_value = data[filter_item.field]
                    details['actual_value'] = field_value
                    matched = self._compare_values(field_value, filter_item.operator, filter_item.value)
            else:
                # Text search across all values
                for value in data.values():
                    if self._compare_values(str(value), filter_item.operator, filter_item.value):
                        matched = True
                        break
            
            # Apply negation if needed
            if filter_item.is_negated:
                matched = not matched
            
            if matched:
                match_details['matched_filters'].append({
                    'field': filter_item.field,
                    'operator': filter_item.operator.value,
                    'value': filter_item.value,
                    'actual_value': details.get('actual_value'),
                    'negated': filter_item.is_negated
                })
            
            filter_results.append(matched)
        
        # Apply logical operator
        if not filter_results:
            final_match = False
        elif query.logical_op == Operator.AND:
            final_match = all(filter_results)
        else:  # OR
            final_match = any(filter_results)
        
        return final_match, match_details
    
    def _match_line(self, line: str, query: SearchQuery, file_path: str = None) -> Tuple[bool, Dict]:
        """Check if a line matches the query - ROBUST version with proper NOT handling"""
        
        match_details = {
            'matched_filters': [],
            'parsed_fields': {},
            'file_service': self._detect_service_from_path(file_path) if file_path else None,
            'debug_info': []  # Add debug info for troubleshooting
        }
        
        # Try to parse as JSON first
        parsed_line = self._try_parse_json(line)
        if parsed_line:
            match_details['parsed_fields'] = self._flatten_json(parsed_line)
        
        # Evaluate each filter
        filter_results = []
        for filter_idx, filter_item in enumerate(query.filters):
            # Evaluate the filter
            matched, details = self._evaluate_filter(line, parsed_line, filter_item, file_path)
            
            # Store debug info
            debug_entry = {
                'filter': f"{filter_item.field or 'text'}{filter_item.operator.value}{filter_item.value}",
                'matched_before_negation': matched,
                'is_negated': filter_item.is_negated,
                'details': details
            }
            
            # Apply negation if specified
            if filter_item.is_negated:
                matched = not matched
                debug_entry['matched_after_negation'] = matched
            
            match_details['debug_info'].append(debug_entry)
            
            # Track which filters matched
            if matched:
                match_entry = {
                    'field': filter_item.field,
                    'operator': filter_item.operator.value,
                    'value': filter_item.value,
                    'negated': filter_item.is_negated
                }
                
                # Add actual value if available
                if 'actual_value' in details:
                    match_entry['actual_value'] = details['actual_value']
                
                match_details['matched_filters'].append(match_entry)
            
            filter_results.append(matched)
        
        # Evaluate sub-queries recursively
        sub_query_results = []
        for sub_query in query.sub_queries:
            sub_matched, sub_details = self._match_line(line, sub_query, file_path)
            
            # Apply sub-query level negation
            if sub_query.is_negated:
                sub_matched = not sub_matched
            
            sub_query_results.append(sub_matched)
            
            # Merge match details from sub-queries
            if sub_matched:
                match_details['matched_filters'].extend(sub_details.get('matched_filters', []))
        
        # Combine all results based on logical operator
        all_results = filter_results + sub_query_results
        
        if not all_results:
            # No filters to evaluate
            final_match = False
        elif query.logical_op == Operator.AND:
            # ALL filters must match
            final_match = all(all_results)
        else:  # OR
            # ANY filter must match
            final_match = any(all_results)
        
        # Apply query-level negation if exists
        if hasattr(query, 'is_negated') and query.is_negated:
            final_match = not final_match
        
        # Log debug info for NOT filters (only in development/debug mode)
        if any(f.is_negated for f in query.filters):
            for debug_entry in match_details['debug_info']:
                if debug_entry['is_negated']:
                    logger.debug(f"NOT filter evaluation: {debug_entry}")
        
        return final_match, match_details
    
    def _evaluate_filter(self, line: str, parsed_line: Optional[Dict], 
                        filter_item: SearchFilter, file_path: str = None) -> Tuple[bool, Dict]:
        """Evaluate a single filter against a line - ULTRA ROBUST for message field"""
        
        details = {}
        
        # Handle IN/NOT_IN operators
        if filter_item.operator in [Operator.IN, Operator.NOT_IN]:
            return self._evaluate_in_operator(line, parsed_line, filter_item, file_path)
        
               # Special handling for service filter (keep existing logic)
        if filter_item.field == 'service' and file_path:
                service = self._detect_service_from_path(file_path)
                filename = file_path.split('/')[-1].lower()
                details['actual_value'] = service
    
                # Use the _match_service_pattern method which handles sub-services and wildcards
                filter_value = str(filter_item.value)
                matched = self._match_service_pattern(service, filename, filter_value)
    
                # Handle NOT operators for service filters
                if filter_item.operator == Operator.NEQ:
                    matched = not matched
                elif filter_item.operator == Operator.NOT_CONTAINS:
                    matched = not matched
    
                return matched, details
        
                            # Text search (no specific field)
        if filter_item.field is None:
            if filter_item.operator == Operator.CONTAINS:
                result = str(filter_item.value).lower() in line.lower()
                return result, details
            elif filter_item.operator == Operator.NOT_CONTAINS:
                result = str(filter_item.value).lower() not in line.lower()
                return result, details
            elif filter_item.operator == Operator.REGEX:
                try:
                    pattern = self._get_compiled_regex(filter_item.value, re.IGNORECASE)
                    return bool(pattern.search(line)), details
                except:
                    return False, details
        
        # ROBUST Field-based search
        field_value = None
        field_found = False
        
        # Map of field aliases for common fields
        field_aliases = {
            'message': ['message', 'msg', 'error.message', 'exception.message', 'error', 'log'],
            'msg': ['message', 'msg', 'error.message', 'exception.message'],
            'severity': ['severity', 'level', 'log_level', 'loglevel', 'log.level'],
            'level': ['severity', 'level', 'log_level', 'loglevel', 'log.level'],
        }
        
        # Priority 1: Check parsed JSON fields
        if parsed_line:
            # Get possible field names
            possible_fields = field_aliases.get(filter_item.field, [filter_item.field])
            
            # Special handling for message field - check multiple possible locations
            if filter_item.field in ['message', 'msg']:
                # Try common message field names in order of preference
                message_fields = ['message', 'msg', 'error.message', 'exception.message', 
                                'error', 'log', 'text', 'content']
                for msg_field in message_fields:
                    if msg_field in parsed_line:
                        field_value = parsed_line[msg_field]
                        field_found = True
                        break
                
                # If still not found, try to construct from other fields
                if not field_found and parsed_line:
                    # For some logs, the message might be constructed from multiple fields
                    if 'exception.class' in parsed_line and 'exception.message' in parsed_line:
                        field_value = f"{parsed_line['exception.class']}: {parsed_line['exception.message']}"
                        field_found = True
                    elif 'error' in parsed_line:
                        field_value = str(parsed_line['error'])
                        field_found = True
            else:
                # For non-message fields, use standard lookup
                for field_name in possible_fields:
                    if field_name in parsed_line:
                        field_value = parsed_line[field_name]
                        field_found = True
                        break
        
        # Priority 2: If not found in JSON and this is a message field, use the whole line
        if not field_found and filter_item.field in ['message', 'msg']:
            # For message searches on non-JSON or when field not found, search the entire line
            field_value = line
            field_found = True
            details['extraction_method'] = 'full_line_content'
        
        # Priority 3: Try regex extraction for other fields
        if not field_found and filter_item.field:
            # Patterns to extract field from plain text
            patterns = [
                rf'\b{re.escape(filter_item.field)}[=:]\s*"([^"]+)"',
                rf'\b{re.escape(filter_item.field)}[=:]\s*\'([^\']+)\'',
                rf'\b{re.escape(filter_item.field)}[=:]\s*(\S+)',
            ]
            
            for pattern in patterns:
                try:
                    regex = self._get_compiled_regex(pattern, re.IGNORECASE)
                    match = regex.search(line)
                    if match:
                        field_value = match.group(1)
                        field_found = True
                        details['extraction_method'] = 'regex'
                        break
                except:
                    continue
        
        # Now evaluate the filter
        if field_found:
            details['actual_value'] = field_value
            result = self._compare_values(field_value, filter_item.operator, filter_item.value)
            return result, details
        else:
            # Field not found
            details['field_not_found'] = True
            # For NOT operations on missing fields, return True
            if filter_item.operator in [Operator.NEQ, Operator.NOT_CONTAINS, Operator.NOT_REGEX]:
                return True, details
            return False, details
    
    def _evaluate_in_operator(self, line: str, parsed_line: Optional[Dict], 
                             filter_item: SearchFilter, file_path: str = None) -> Tuple[bool, Dict]:
        """Evaluate IN/NOT_IN operators (multiple values)"""
        details = {}
        
        # Special handling for service filters
        if filter_item.field == 'service' and file_path:
            actual_service = self._detect_service_from_path(file_path)
            filename = file_path.split('/')[-1].lower()
            
            matched = False
            matched_pattern = None
            
            for pattern in filter_item.value:
                if self._match_service_pattern(actual_service, filename, str(pattern)):
                    matched = True
                    matched_pattern = pattern
                    break
            
            details['actual_value'] = actual_service
            if matched:
                details['matched_value'] = matched_pattern
            
            # Apply NOT_IN logic
            if filter_item.operator == Operator.NOT_IN:
                matched = not matched
            
            return matched, details
        
        # General IN evaluation
        field_value = None
        
        # Get field value from parsed JSON or text
        if filter_item.field:
            if parsed_line and filter_item.field in parsed_line:
                field_value = parsed_line[filter_item.field]
            else:
                # Try to extract from text
                patterns = [
                    rf'{re.escape(filter_item.field)}[=:]\s*(\S+)',
                    rf'\b{re.escape(filter_item.field)}\s*[=:]\s*(\S+)'
                ]
                for pattern in patterns:
                    try:
                        regex = self._get_compiled_regex(pattern, re.IGNORECASE)
                        match = regex.search(line)
                        if match:
                            field_value = match.group(1)
                            break
                    except:
                        continue
        
        if field_value is None:
            return filter_item.operator == Operator.NOT_IN, details
        
        # Check if field value matches any of the values
        field_value_str = str(field_value).lower()
        matched = False
        matched_value = None
        
        for value in filter_item.value:
            value_str = str(value).lower()
            
            # Support wildcards in each value
            if '*' in value or '?' in value:
                if WildcardMatcher.match(value, field_value_str):
                    matched = True
                    matched_value = value
                    break
            elif field_value_str == value_str:
                matched = True
                matched_value = value
                break
        
        details['actual_value'] = field_value
        if matched:
            details['matched_value'] = matched_value
        
        # Apply NOT_IN logic
        if filter_item.operator == Operator.NOT_IN:
            matched = not matched
        
        return matched, details
    
    def _compare_values(self, actual: Any, op: Operator, expected: Any) -> bool:
        """Compare values based on operator - ULTRA ROBUST string comparison"""
        
        # Handle None values
        if actual is None:
            if op == Operator.EQ:
                return expected is None or str(expected).lower() == 'null'
            elif op == Operator.NEQ:
                return expected is not None and str(expected).lower() != 'null'
            elif op in [Operator.CONTAINS, Operator.NOT_CONTAINS]:
                return op == Operator.NOT_CONTAINS
            return False
        
        # String operations - most important for message filtering
        if op == Operator.CONTAINS:
            # Convert both to strings for comparison
            actual_str = str(actual)
            expected_str = str(expected)
            
            # Case-insensitive contains
            return expected_str.lower() in actual_str.lower()
        
        elif op == Operator.NOT_CONTAINS:
            # Explicit NOT_CONTAINS operation
            actual_str = str(actual)
            expected_str = str(expected)
            
            # Case-insensitive not contains
            result = expected_str.lower() not in actual_str.lower()
            return result
        
        elif op == Operator.EQ:
            # Handle wildcards
            if isinstance(expected, str) and ('*' in expected or '?' in expected):
                return WildcardMatcher.match(expected, str(actual))
            
            # Case-insensitive equality for strings
            return str(actual).lower() == str(expected).lower()
        
        elif op == Operator.NEQ:
            # Not equals - inverse of EQ
            if isinstance(expected, str) and ('*' in expected or '?' in expected):
                return not WildcardMatcher.match(expected, str(actual))
            
            return str(actual).lower() != str(expected).lower()
        
        elif op == Operator.REGEX:
            try:
                pattern = self._get_compiled_regex(str(expected), re.IGNORECASE)
                return bool(pattern.search(str(actual)))
            except:
                return False
        
        elif op == Operator.NOT_REGEX:
            try:
                pattern = self._get_compiled_regex(str(expected), re.IGNORECASE)
                return not bool(pattern.search(str(actual)))
            except:
                return True
        
        # Numeric operations
        elif op in [Operator.GT, Operator.GTE, Operator.LT, Operator.LTE]:
            try:
                actual_num = float(actual)
                expected_num = float(expected)
                
                if op == Operator.GT:
                    return actual_num > expected_num
                elif op == Operator.GTE:
                    return actual_num >= expected_num
                elif op == Operator.LT:
                    return actual_num < expected_num
                elif op == Operator.LTE:
                    return actual_num <= expected_num
            except:
                return False
        
        return False
    
    def _get_field_value(self, obj: Dict, field_path: str) -> Any:
        """Get field value from nested object - ROBUST version"""
        
        # First, try direct key lookup (for pre-flattened keys)
        if field_path in obj:
            return obj[field_path]
        
        # Try nested object traversal
        parts = field_path.split('.')
        current = obj
        
        for i, part in enumerate(parts):
            if isinstance(current, dict):
                if part in current:
                    current = current[part]
                else:
                    # Try partial path as a flattened key
                    partial_path = '.'.join(parts[:i+1])
                    if partial_path in obj:
                        # Found as a flattened key, return it
                        return obj[partial_path]
                    
                    # Also try the remaining path as a key in current dict
                    remaining_path = '.'.join(parts[i:])
                    if remaining_path in current:
                        return current[remaining_path]
                    
                    # Not found
                    return None
            elif isinstance(current, list) and part.isdigit():
                # Handle array indexing
                idx = int(part)
                if 0 <= idx < len(current):
                    current = current[idx]
                else:
                    return None
            else:
                return None
        
        return current
    
    def _flatten_json(self, obj: Dict, prefix: str = '') -> Dict:
        """Flatten nested JSON for easier searching - ROBUST version"""
        
        flattened = {}
        
        for key, value in obj.items():
            # Create the full key path
            full_key = f"{prefix}.{key}" if prefix else key
            
            if isinstance(value, dict):
                # Recurse for nested objects
                nested_flattened = self._flatten_json(value, full_key)
                flattened.update(nested_flattened)
                
                # Also store the dict as-is for certain fields (like headers, params)
                flattened[full_key] = value
            elif isinstance(value, list):
                # Store lists as-is
                flattened[full_key] = value
                
                # For lists of strings, also create a concatenated version for searching
                if value and all(isinstance(item, str) for item in value):
                    flattened[f"{full_key}_concat"] = ' '.join(value)
            else:
                # Store the scalar value
                flattened[full_key] = value
            
            # Also store dot-notation keys as-is if they exist in the original
            # (some logs have pre-flattened keys like "meta.user")
            if '.' in key and not prefix:
                flattened[key] = value
        
        return flattened
    
    def _sample_file(self, file_path: str, full_path: str, max_lines: int = 1000) -> List[str]:
        """Sample lines from a file for analysis"""
        
        samples = []
        
        if not full_path or not os.path.exists(full_path):
            return samples
        
        try:
            with open(full_path, 'rb') as f:
                # Get file size
                f.seek(0, os.SEEK_END)
                file_size = f.tell()
                f.seek(0)
                
                # Read from beginning
                for _ in range(max_lines // 2):
                    line = f.readline()
                    if not line:
                        break
                    try:
                        samples.append(line.decode('utf-8', errors='ignore'))
                    except:
                        pass
                
                # Read from middle
                if file_size > 10000:
                    f.seek(file_size // 2)
                    f.readline()  # Skip partial line
                    
                    for _ in range(max_lines // 4):
                        line = f.readline()
                        if not line:
                            break
                        try:
                            samples.append(line.decode('utf-8', errors='ignore'))
                        except:
                            pass
                
                # Read from end
                if file_size > 10000:
                    f.seek(max(0, file_size - 10000))
                    f.readline()  # Skip partial line
                    
                    for _ in range(max_lines // 4):
                        line = f.readline()
                        if not line:
                            break
                        try:
                            samples.append(line.decode('utf-8', errors='ignore'))
                        except:
                            pass
        
        except Exception as e:
            logger.error(f"Error sampling file {file_path}: {e}")
        
        return samples
    
    def _analyze_json_fields(self, obj: Dict, field_stats: Dict, prefix: str = ''):
        """Analyze JSON structure and collect statistics"""
        
        for key, value in obj.items():
            # For keys that already contain dots (like "meta.user"), use them as-is
            if '.' in key and not prefix:
                field_path = key
            else:
                field_path = f"{prefix}.{key}" if prefix else key
            
            field_stats[field_path]['count'] += 1
            
            # Determine type
            if isinstance(value, bool):
                type_name = 'boolean'
            elif isinstance(value, (int, float)):
                type_name = 'number'
            elif isinstance(value, str):
                type_name = 'string'
            elif isinstance(value, list):
                type_name = 'array'
            elif isinstance(value, dict):
                type_name = 'object'
                # Only recurse if it's an actual nested object (not a flattened key)
                if '.' not in key:
                    self._analyze_json_fields(value, field_stats, field_path)
            else:
                type_name = 'unknown'
            
            field_stats[field_path]['types'][type_name] += 1
            
            # Collect sample values (for strings and numbers)
            if type_name in ['string', 'number'] and value is not None:
                str_value = str(value)
                if len(str_value) < 100:  # Don't store very long values
                    field_stats[field_path]['values'][str_value] += 1
    
    def _analyze_text_line(self, line: str, field_stats: Dict):
        """Analyze plain text log line for patterns"""
        
        # Use precompiled patterns
        for pattern_name in ['key_value', 'key_colon_value']:
            pattern = self._regex_cache.get(pattern_name)
            if pattern:
                matches = pattern.findall(line)
                for key, value in matches:
                    field_stats[key]['count'] += 1
                    
                    # Try to determine type
                    if value.isdigit():
                        type_name = 'number'
                    elif value in ['true', 'false']:
                        type_name = 'boolean'
                    else:
                        type_name = 'string'
                    
                    field_stats[key]['types'][type_name] += 1
                    
                    if len(value) < 100:
                        field_stats[key]['values'][value] += 1
    
    def _determine_field_type(self, type_counts: Dict[str, int]) -> FieldType:
        """Determine the primary type of a field based on occurrence counts"""
        
        if not type_counts:
            return FieldType.STRING
        
        # Get the most common type
        primary_type = max(type_counts.items(), key=lambda x: x[1])[0]
        
        type_map = {
            'string': FieldType.STRING,
            'number': FieldType.NUMBER,
            'boolean': FieldType.BOOLEAN,
            'array': FieldType.ARRAY,
            'object': FieldType.OBJECT
        }
        
        return type_map.get(primary_type, FieldType.STRING)
    
    def _detect_service_from_path(self, file_path: str) -> str:
        """Detect service based on file path - Enhanced for KubeSOS with caching"""
        if not file_path:
            return 'unknown'
        
        # Check cache first
        if file_path in self._service_cache:
            return self._service_cache[file_path]
        
        path_lower = file_path.lower()
        filename = path_lower.split('/')[-1] if '/' in path_lower else path_lower
        
        # Check for KubeSOS naming pattern: component_container.log
        if '_' in filename and filename.endswith('.log'):
            # Extract component from KubeSOS pattern
            component = filename.split('_')[0]
            # Map common component names to services
            component_mapping = {
                'webservice': 'webservice',
                'sidekiq': 'sidekiq',
                'gitaly': 'gitaly',
                'migrations': 'migrations',
                'toolbox': 'toolbox',
                'kas': 'kas',
                'registry': 'registry',
                'gitlab-shell': 'shell',
                'gitlab-exporter': 'exporter',
                'gitlab-runner': 'runner',
                'artifactory': 'artifactory',
                'minio': 'minio',
                'xray': 'xray',
                'grafana-agent': 'monitoring',
                'toolchain-api': 'toolchain'
            }
            if component in component_mapping:
                service = component_mapping[component]
                self._service_cache[file_path] = service
                return service
        
        # Check for Kubernetes resource files
        if self._is_kubernetes_resource_file(filename):
            service = 'kubernetes'
            self._service_cache[file_path] = service
            return service
        
        # GitLab Rails logs (from official docs)
        rails_logs = [
            'production_json.log', 'production.log', 'api_json.log', 'application_json.log',
            'application.log', 'integrations_json.log', 'kubernetes.log', 'git_json.log',
            'audit_json.log', 'importer.log', 'exporter.log', 'features_json.log',
            'ci_resource_groups_json.log', 'auth.log', 'auth_json.log', 'graphql_json.log',
            'migrations.log', 'web_hooks.log', 'elasticsearch.log', 'exceptions_json.log',
            'service_measurement.log', 'geo.log', 'update_mirror_service_json.log',
            'llm.log', 'database_load_balancing.log', 'clickhouse.log', 'zoekt.log',
            'repocheck.log', 'sidekiq_client.log', 'epic_work_item_sync.log',
            'secret_push_protection.log', 'active_context.log', 'performance_bar_json.log',
            'backup_json.log', 'product_usage_data.log'
        ]
        
        # Check for Rails logs
        if filename in rails_logs:
            service = 'rails'
            self._service_cache[file_path] = service
            return service
        
        # GitLab Shell logs
        if 'gitlab-shell.log' in filename or 'gitlab-shell' in path_lower:
            service = 'shell'
            self._service_cache[file_path] = service
            return service
        
        # Gitaly logs
        if ('gitaly' in path_lower and '/gitaly/' in path_lower) or filename == 'gitaly_hooks.log':
            service = 'gitaly'
            self._service_cache[file_path] = service
            return service
        
        # Workhorse logs
        if 'gitlab-workhorse' in path_lower or 'workhorse' in path_lower:
            service = 'workhorse'
            self._service_cache[file_path] = service
            return service
        
        # Puma logs
        if filename in ['puma_stdout.log', 'puma_stderr.log'] or '/puma/' in path_lower:
            service = 'puma'
            self._service_cache[file_path] = service
            return service
        
        # Sidekiq logs
        if ('/sidekiq/' in path_lower and filename == 'current') or filename == 'sidekiq.log':
            service = 'sidekiq'
            self._service_cache[file_path] = service
            return service
        
        # NGINX logs
        if '/nginx/' in path_lower or filename in ['gitlab_access.log', 'gitlab_error.log', 
                                                    'gitlab_pages_access.log', 'gitlab_pages_error.log',
                                                    'gitlab_registry_access.log', 'gitlab_registry_error.log']:
            service = 'nginx'
            self._service_cache[file_path] = service
            return service
        
        # Registry logs
        if '/registry/' in path_lower:
            service = 'registry'
            self._service_cache[file_path] = service
            return service
        
        # Pages logs
        if '/gitlab-pages/' in path_lower or 'pages' in filename:
            service = 'pages'
            self._service_cache[file_path] = service
            return service
        
        # PostgreSQL logs
        if '/postgresql/' in path_lower or '/postgres/' in path_lower:
            service = 'postgresql'
            self._service_cache[file_path] = service
            return service
        
        # Redis logs
        if '/redis/' in path_lower:
            service = 'redis'
            self._service_cache[file_path] = service
            return service
        
        # Prometheus logs
        if '/prometheus/' in path_lower:
            service = 'prometheus'
            self._service_cache[file_path] = service
            return service
        
        # Alertmanager logs
        if '/alertmanager/' in path_lower:
            service = 'alertmanager'
            self._service_cache[file_path] = service
            return service
        
        # Grafana logs
        if '/grafana/' in path_lower:
            service = 'grafana'
            self._service_cache[file_path] = service
            return service
        
        # Mail room logs
        if '/mailroom/' in path_lower or 'mail_room_json.log' in filename:
            service = 'mailroom'
            self._service_cache[file_path] = service
            return service
        
        # Patroni logs
        if '/patroni/' in path_lower:
            service = 'patroni'
            self._service_cache[file_path] = service
            return service
        
        # PgBouncer logs
        if '/pgbouncer/' in path_lower:
            service = 'pgbouncer'
            self._service_cache[file_path] = service
            return service
        
        # Praefect logs
        if '/praefect/' in path_lower:
            service = 'praefect'
            self._service_cache[file_path] = service
            return service
        
        # GitLab KAS logs
        if '/gitlab-kas/' in path_lower:
            service = 'kas'
            self._service_cache[file_path] = service
            return service
        
        # Sentinel logs
        if '/sentinel/' in path_lower:
            service = 'sentinel'
            self._service_cache[file_path] = service
            return service
        
        # Let's Encrypt logs
        if '/lets-encrypt/' in path_lower:
            service = 'letsencrypt'
            self._service_cache[file_path] = service
            return service
        
        # Mattermost logs
        if '/mattermost/' in path_lower:
            service = 'mattermost'
            self._service_cache[file_path] = service
            return service
        
        # GitLab Exporter logs
        if '/gitlab-exporter/' in path_lower:
            service = 'gitlab-exporter'
            self._service_cache[file_path] = service
            return service
        
        # LogRotate logs
        if '/logrotate/' in path_lower:
            service = 'logrotate'
            self._service_cache[file_path] = service
            return service
        
        # crond logs
        if '/crond/' in path_lower:
            service = 'crond'
            self._service_cache[file_path] = service
            return service
        
        # System logs
        if filename in ['syslog', 'messages', 'dmesg', 'mail.log']:
            service = 'system'
            self._service_cache[file_path] = service
            return service
        
        # Reconfigure logs
        if '/reconfigure/' in path_lower:
            service = 'reconfigure'
            self._service_cache[file_path] = service
            return service
        
        # GitLab SOS utility files (not actual service logs)
        sos_files = [
            'gitlab_status', 'gitlab_geo_status', 'gitlab_migrations', 'version-manifest.txt',
            'version-manifest.json', 'gitlabsos.log', 'schema_dump_result', 'ar_schema_dump_result',
            'ps', 'top_cpu', 'top_res', 'df_ht', 'free_m', 'meminfo', 'cpuinfo', 'mount',
            'uptime', 'date', 'hostname', 'uname', 'lscpu', 'lsblk', 'netstat', 'ifconfig',
            'ip_address', 'iostat', 'iotop', 'mpstat', 'pidstat', 'vmstat', 'sar_dev',
            'sar_tcp', 'sockstat', 'nfsstat', 'nfsiostat', 'ulimit', 'sysctl_a', 'dmesg',
            'systemctl_unit_files', 'systemd_detect_virt', 'getenforce', 'sestatus',
            'fstab', 'os-release', 'limits.conf', 'sshd_config', 'config',
            'pressure_cpu.txt', 'pressure_io.txt', 'pressure_mem.txt',
            'gitlab_geo_migrations', 'gitlab_system_status', 'ntpq', 'timedatectl',
            'user_uid', 'collation_diagnostics', 'btmp_size', 'license_info',
            'rpm_verify', 'gitaly_check', 'gitaly_internal_api_check',
            'zoekt_info', 'taggings_duplicates', 'gitlab_geo_check',
            'elastic_info', 'non_analyzed_tables', 'running_swappiness',
            'tainted', 'p_ci_build_tags_duplicates', 'df_inodes'
        ]
        
        if filename in sos_files:
            service = 'sos-metadata'
            self._service_cache[file_path] = service
            return service
        
        # Generic "current" file - check parent path
        if filename == 'current':
            # This is likely a runit service log
            # Try to extract service from parent directory
            path_parts = path_lower.split('/')
            for i in range(len(path_parts) - 1, -1, -1):
                part = path_parts[i]
                if part in ['sidekiq', 'gitaly', 'workhorse', 'redis', 'postgresql',
                           'nginx', 'registry', 'prometheus', 'alertmanager', 'grafana',
                           'gitlab-shell', 'gitlab-pages', 'gitlab-kas', 'praefect',
                           'patroni', 'pgbouncer', 'sentinel', 'mailroom', 'mattermost',
                           'gitlab-exporter', 'logrotate', 'crond']:
                    service = part.replace('gitlab-', '')
                    self._service_cache[file_path] = service
                    return service
            
            # If we can't determine, it's likely a system service
            service = 'system'
            self._service_cache[file_path] = service
            return service
        
        # Default to unknown for unrecognized files
        service = 'unknown'
        self._service_cache[file_path] = service
        return service
    
    def _generate_filter_suggestions(self, field_stats: Dict) -> List[Dict]:
        """Generate smart filter suggestions based on field analysis"""
        
        suggestions = []
        
        # Suggest filters for common error fields
        error_fields = ['severity', 'level', 'status', 'error', 'exception', 'TYPE', 'REASON']
        for field in error_fields:
            if field in field_stats:
                values = field_stats[field]['values']
                error_values = [v for v in values if any(err in v.lower() for err in ['error', 'fail', 'critical', 'warning'])]
                if error_values:
                    suggestions.append({
                        'name': f'{field.capitalize()} Errors',
                        'query': f'{field}:{error_values[0]}',
                        'description': f'Filter by {field} field for errors'
                    })
        
        # Suggest filters for HTTP status codes
        if 'status' in field_stats or 'status_code' in field_stats:
            suggestions.append({
                'name': 'Server Errors',
                'query': 'status>=500',
                'description': 'Find all 5xx server errors'
            })
            suggestions.append({
                'name': 'Client Errors',
                'query': 'status>=400 AND status<500',
                'description': 'Find all 4xx client errors'
            })
        
        # Suggest filters for performance
        duration_fields = ['duration', 'elapsed', 'response_time', 'time_ms', 'duration_s']
        for field in duration_fields:
            if field in field_stats:
                suggestions.append({
                    'name': 'Slow Requests',
                    'query': f'{field}>1000' if 'ms' in field else f'{field}>1',
                    'description': f'Find requests slower than 1 second'
                })
                break
        
        # Suggest filters for specific services
        if 'service' in field_stats:
            top_services = sorted(field_stats['service']['values'].items(), key=lambda x: x[1], reverse=True)[:3]
            for service, _ in top_services:
                suggestions.append({
                    'name': f'{service.capitalize()} Logs',
                    'query': f'service:{service}',
                    'description': f'Filter logs from {service} service'
                })
        
        # KubeSOS specific suggestions
        if 'TYPE' in field_stats and 'Warning' in field_stats['TYPE']['values']:
            suggestions.append({
                'name': 'Kubernetes Warnings',
                'query': 'TYPE:Warning',
                'description': 'Find all Kubernetes warning events'
            })
        
        if 'REASON' in field_stats:
            # Find common failure reasons
            failure_reasons = [r for r in field_stats['REASON']['values'] if 'fail' in r.lower()]
            if failure_reasons:
                suggestions.append({
                    'name': 'Pod Failures',
                    'query': f'REASON:{list(failure_reasons)[0]}',
                    'description': 'Find pod failure events'
                })
        
        # NOT operator suggestions
        if any(field in field_stats for field in ['severity', 'level']):
            suggestions.append({
                'name': 'Exclude Debug Logs',
                'query': 'NOT level:debug',
                'description': 'Exclude debug-level logs'
            })
        
        # Wildcard suggestions
        suggestions.append({
            'name': 'All Rails Logs',
            'query': 'service:rails:*',
            'description': 'All Rails service logs'
        })
        
        suggestions.append({
            'name': 'All Worker Services',
            'query': 'service:*worker*',
            'description': 'All worker-related services'
        })
        
        return suggestions
    
    def clear_caches(self):
        """Clear all internal caches to free memory"""
        with self._cache_lock:
            self._json_cache.clear()
        self._regex_cache.clear()
        self._service_cache.clear()
        logger.info("Cleared all caches")

class QueryBuilder:
    """
    Helper class to build complex queries programmatically
    """
    
    def __init__(self):
        self.query = SearchQuery()
    
    def add_filter(self, field: str, operator: str, value: Any, negate: bool = False):
        """Add a filter to the query"""
        op_map = {
            '=': Operator.EQ,
            '!=': Operator.NEQ,
            '>': Operator.GT,
            '>=': Operator.GTE,
            '<': Operator.LT,
            '<=': Operator.LTE,
            '~': Operator.CONTAINS,
            '!~': Operator.NOT_CONTAINS,
            '=~': Operator.REGEX
        }
        
        op = op_map.get(operator, Operator.EQ)
        self.query.filters.append(SearchFilter(field=field, operator=op, value=value, is_negated=negate))
        return self
    
    def and_(self):
        """Set logical operator to AND"""
        self.query.logical_op = Operator.AND
        return self
    
    def or_(self):
        """Set logical operator to OR"""
        self.query.logical_op = Operator.OR
        return self
    
    def not_(self):
        """Negate the next filter or sub-query"""
        # This would need to be implemented based on usage
        return self
    
    def add_sub_query(self, sub_query: SearchQuery, negate: bool = False):
        """Add a sub-query"""
        sub_query.is_negated = negate
        self.query.sub_queries.append(sub_query)
        return self
    
    def build(self) -> SearchQuery:
        """Build and return the query"""
        return self.query

# Async wrapper for compatibility
class AsyncPowerSearchEngine(PowerSearchEngine):
    """Async wrapper for PowerSearchEngine for backwards compatibility"""
    
    async def search_async(self, session_id: str, query: Union[str, SearchQuery], 
                          files: Dict[str, Any], limit: int = 1000,
                          context_lines: int = 0):
        """Async search interface"""
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        
        # Create async generator from sync generator
        def _search_wrapper():
            return self.search(session_id, query, files, limit, context_lines)
        
        # Run in executor
        with ThreadPoolExecutor(max_workers=1) as executor:
            results = await loop.run_in_executor(executor, list, _search_wrapper())
            
        for result in results:
            yield result
    
    async def analyze_log_structure_async(self, session_id: str, log_files: Dict[str, Any]):
        """Async interface for log structure analysis"""
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as executor:
            return await loop.run_in_executor(executor, self.analyze_log_structure, session_id, log_files)


class PowerSearchEngineOptimized(PowerSearchEngine):
    """
    Performance-optimized version of PowerSearchEngine
    Maintains all existing functionality with significant speed improvements
    """
    
    def __init__(self, max_workers: int = 4):
        super().__init__(max_workers)
        
        # Performance tuning parameters
        self.CHUNK_SIZE = 65536  # Increased from 8KB to 64KB
        self.MMAP_THRESHOLD = 102400  # Use mmap for files > 100KB (was 1MB)
        self.MAX_CACHE_SIZE = 1000  # Reduced from 10000
        self.BATCH_SIZE = 500  # For result streaming
        
        # Quick JSON detection pattern
        self.json_start_pattern = re.compile(r'^\s*[\[{]')
        
    def _try_parse_json_optimized(self, line: str) -> Optional[Dict]:
        """Optimized JSON parsing with quick rejection"""
        if not line or len(line) < 2:
            return None
        
        # Quick check - if doesn't start with { or timestamp pattern, skip
        line_stripped = line.strip()
        if not line_stripped:
            return None
            
        # Quick rejection for non-JSON lines
        first_char = line_stripped[0]
        if first_char not in '{[' and not line_stripped[:4].isdigit():
            return None
        
        # Now use the cached parsing
        return self._try_parse_json(line)
    
    def _search_regular_file_optimized(self, full_path: str, file_path: str, 
                                      query: SearchQuery, context_lines: int) -> Generator[Dict, None, None]:
        """Optimized file search with better memory management"""
        
        try:
            file_size = os.path.getsize(full_path)
            if file_size == 0:
                return
            
            # Use mmap for smaller files too (>100KB instead of >1MB)
            if file_size > self.MMAP_THRESHOLD:
                with open(full_path, 'rb') as f:
                    with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mmapped:
                        yield from self._search_mmap_file_optimized(
                            mmapped, file_path, query, context_lines, file_size
                        )
            else:
                # For small files, still read in chunks to avoid memory issues
                yield from self._search_small_file_optimized(
                    full_path, file_path, query, context_lines
                )
                
        except Exception as e:
            logger.error(f"Error searching file {file_path}: {e}")
    
    def _search_mmap_file_optimized(self, mmapped: mmap.mmap, file_path: str, 
                                   query: SearchQuery, context_lines: int, 
                                   file_size: int) -> Generator[Dict, None, None]:
        """Optimized mmap search with larger chunks and better line handling"""
        
        line_number = 0
        position = 0
        leftover = b""
        
        # Larger chunk size for better I/O performance
        chunk_size = min(self.CHUNK_SIZE, file_size)
        
        # Pre-compile service detection
        service = self._detect_service_from_path(file_path)
        
        # Context buffer optimization - use deque for O(1) operations
        context_buffer = deque(maxlen=context_lines * 2 + 1) if context_lines > 0 else None
        
        while position < len(mmapped):
            # Read larger chunks
            actual_chunk_size = min(chunk_size, len(mmapped) - position)
            chunk = leftover + mmapped[position:position + actual_chunk_size]
            position += actual_chunk_size
            
            # Find last complete line
            last_newline = chunk.rfind(b'\n')
            if last_newline == -1:
                leftover = chunk
                continue
            
            # Process lines in this chunk
            lines = chunk[:last_newline].split(b'\n')
            leftover = chunk[last_newline + 1:]
            
            for line_bytes in lines:
                line_number += 1
                
                # Skip empty lines quickly
                if not line_bytes or len(line_bytes) < 2:
                    continue
                
                try:
                    line = line_bytes.decode('utf-8', errors='ignore')
                except:
                    continue
                
                if not line.strip():
                    continue
                
                # Quick match check before detailed parsing
                matches, match_details = self._match_line_optimized(line, query, file_path)
                
                if matches:
                    result = {
                        'file': file_path,
                        'line_number': line_number,
                        'content': line,
                        'match_details': match_details,
                        'service': service,  # Pre-computed
                        'context': {}
                    }
                    
                    # Add context only if needed
                    if context_buffer:
                        result['context']['before'] = list(context_buffer)[-context_lines:]
                        result['context']['after'] = []  # Will be filled later if needed
                    
                    yield result
                
                # Update context buffer
                if context_buffer:
                    context_buffer.append(line)
        
        # Handle leftover
        if leftover:
            line_number += 1
            try:
                line = leftover.decode('utf-8', errors='ignore')
                matches, match_details = self._match_line_optimized(line, query, file_path)
                if matches:
                    yield {
                        'file': file_path,
                        'line_number': line_number,
                        'content': line,
                        'match_details': match_details,
                        'service': service,
                        'context': {}
                    }
            except:
                pass
    
    def _match_line_optimized(self, line: str, query: SearchQuery, file_path: str = None) -> Tuple[bool, Dict]:
        """Optimized line matching with early termination"""
        
        # Quick text search for simple queries
        if len(query.filters) == 1 and query.filters[0].field is None:
            # Simple text search - use fast string operations
            search_text = str(query.filters[0].value).lower()
            if query.filters[0].operator == Operator.CONTAINS:
                matched = search_text in line.lower()
            else:
                matched = search_text not in line.lower()
            
            if matched:
                return True, {'matched_filters': [{'value': search_text}]}
            return False, {}
        
        # For complex queries, use the original implementation
        return self._match_line(line, query, file_path)
    
    def _search_small_file_optimized(self, full_path: str, file_path: str,
                                    query: SearchQuery, context_lines: int) -> Generator[Dict, None, None]:
        """Optimized small file search using chunked reading"""
        
        service = self._detect_service_from_path(file_path)
        line_number = 0
        
        with open(full_path, 'rb') as f:
            leftover = b""
            
            while True:
                chunk = f.read(self.CHUNK_SIZE)
                if not chunk:
                    # Process final leftover
                    if leftover:
                        line_number += 1
                        try:
                            line = leftover.decode('utf-8', errors='ignore')
                            matches, match_details = self._match_line_optimized(line, query, file_path)
                            if matches:
                                yield {
                                    'file': file_path,
                                    'line_number': line_number,
                                    'content': line,
                                    'match_details': match_details,
                                    'service': service,
                                    'context': {}
                                }
                        except:
                            pass
                    break
                
                # Combine with leftover and find lines
                data = leftover + chunk
                lines = data.split(b'\n')
                
                # Keep last incomplete line
                if not chunk.endswith(b'\n'):
                    leftover = lines[-1]
                    lines = lines[:-1]
                else:
                    leftover = b""
                
                for line_bytes in lines:
                    line_number += 1
                    
                    if not line_bytes or len(line_bytes) < 2:
                        continue
                    
                    try:
                        line = line_bytes.decode('utf-8', errors='ignore')
                    except:
                        continue
                    
                    if not line.strip():
                        continue
                    
                    matches, match_details = self._match_line_optimized(line, query, file_path)
                    
                    if matches:
                        yield {
                            'file': file_path,
                            'line_number': line_number,
                            'content': line,
                            'match_details': match_details,
                            'service': service,
                            'context': {}  # Simplified for performance
                        }
    
    def search_parallel(self, session_id: str, query: Union[str, SearchQuery],
                       files: Dict[str, Any], limit: int = 1000,
                       context_lines: int = 0) -> Generator[Dict, None, None]:
        """
        Parallel search implementation for better performance on multi-core systems
        Maintains result ordering and stops when limit is reached
        """
        
        if isinstance(query, str):
            query = self.parse_query(query)
        
        # Pre-filter files
        filtered_files = self._pre_filter_files(query, files)
        
        result_count = 0
        
        # Use thread pool for parallel file searching
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit search tasks
            futures = []
            for file_path, file_info in filtered_files.items():
                if result_count >= limit:
                    break
                    
                full_path = file_info.get('full_path')
                if not full_path or not os.path.exists(full_path):
                    continue
                
                # Submit search task
                future = executor.submit(
                    self._search_file_worker,
                    full_path, file_path, query, context_lines, limit - result_count
                )
                futures.append(future)
            
            # Collect results as they complete
            for future in futures:
                try:
                    for result in future.result(timeout=30):
                        if result_count >= limit:
                            break
                        result_count += 1
                        yield result
                except Exception as e:
                    logger.error(f"Search worker error: {e}")
                
                if result_count >= limit:
                    # Cancel remaining futures
                    for f in futures:
                        f.cancel()
                    break
        
        # Force garbage collection after large search
        if result_count > 10000:
            gc.collect()
    
    def _search_file_worker(self, full_path: str, file_path: str,
                           query: SearchQuery, context_lines: int,
                           max_results: int) -> List[Dict]:
        """Worker function for parallel search"""
        results = []
        
        try:
            # Determine file type and search
            filename = Path(file_path).name
            if self._is_kubernetes_resource_file(filename):
                search_gen = self._search_kubernetes_resource(
                    full_path, filename, query, file_path
                )
            else:
                search_gen = self._search_regular_file_optimized(
                    full_path, file_path, query, context_lines
                )
            
            # Collect results up to limit
            for result in search_gen:
                results.append(result)
                if len(results) >= max_results:
                    break
                    
        except Exception as e:
            logger.error(f"Error in search worker for {file_path}: {e}")
        
        return results
    
    def _pre_filter_files(self, query: SearchQuery, files: Dict[str, Any]) -> Dict[str, Any]:
        """Pre-filter files based on service filters for efficiency"""
        
        service_filters = [f for f in query.filters if f.field == 'service']
        
        if not service_filters or query.logical_op != Operator.AND:
            return files
        
        filtered = {}
        for file_path, file_info in files.items():
            service = self._detect_service_from_path(file_path)
            filename = file_path.split('/')[-1].lower()
            
            matches_all = True
            for sf in service_filters:
                if sf.operator == Operator.IN:
                    matched_any = any(
                        self._match_service_pattern(service, filename, str(v))
                        for v in sf.value
                    )
                    if not matched_any:
                        matches_all = False
                        break
                else:
                    if not self._match_service_pattern(service, filename, str(sf.value)):
                        matches_all = False
                        break
            
            if matches_all:
                filtered[file_path] = file_info
        
        return filtered
    
    def _match_service_pattern(self, service: str, filename: str, pattern: str) -> bool:
        """Helper to match service patterns"""
        pattern_lower = pattern.lower()
        return (pattern_lower in service.lower() or 
                pattern_lower in filename)


def get_optimized_search_engine():
    """Factory function to get optimized search engine"""
    return PowerSearchEngineOptimized(max_workers=4)