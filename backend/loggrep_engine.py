#!/usr/bin/env python3
"""
LogGrep Engine - Multi-Algorithm Adaptive Log Clustering
=========================================================

A production-grade log analysis engine with intelligent algorithm selection:
- **Drain3**: For structured logs with consistent templates (Sidekiq, Rails)
- **LenMa**: For variable-length logs (PostgreSQL, NGINX errors)
- **Semantic Clustering**: For exception messages and error descriptions
- **Hybrid Strategy**: Combines multiple approaches for optimal results

Key Features:
- Automatic algorithm selection based on log type and format
- JSON-aware message extraction (no more flattening!)
- Exception-first clustering for error logs
- Adaptive similarity thresholds per component
- Zero hardcoded patterns - learns from structure

Based on research:
- Drain: "An Online Log Parsing Approach" (ICSE'19)
- LenMa: "Length Matters: Clustering System Logs Using Length of Words" (arXiv:1611.03213)
- Semantic: Sentence-BERT for log clustering

Author: SOSLab Team
Version: 2.0.0 - Complete Rewrite
"""

import os
import re
import json
import asyncio
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple, Iterator, Any, Union
from dataclasses import dataclass, field, asdict
from collections import defaultdict, Counter
from enum import Enum
import logging
import math
from concurrent.futures import ThreadPoolExecutor
import threading
from abc import ABC, abstractmethod

# Import GitLab intelligence layer
try:
    from gitlab_log_intelligence import GitLabLogEnricher, GitLabLogMetadata
    GITLAB_INTELLIGENCE_AVAILABLE = True
except ImportError:
    GITLAB_INTELLIGENCE_AVAILABLE = False
    GitLabLogEnricher = None
    GitLabLogMetadata = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("LogGrepEngine")


# ============================================================================
# CLUSTERING ALGORITHMS - MULTIPLE STRATEGIES
# ============================================================================

class ClusteringAlgorithm(Enum):
    """Available clustering algorithms"""
    DRAIN = "drain"              # Best for structured logs with templates
    LENMA = "lenma"              # Best for variable-length logs
    SEMANTIC = "semantic"        # Best for error messages/exceptions
    EXCEPTION_BASED = "exception"  # Group by exception class
    HYBRID = "hybrid"            # Combines multiple strategies


@dataclass
class ClusterInfo:
    """Information about a single cluster"""
    cluster_id: str
    template: str
    algorithm: str
    count: int
    log_indices: List[int] = field(default_factory=list)
    
    def add_log(self, idx: int):
        self.log_indices.append(idx)
        self.count += 1


class BaseClusterer(ABC):
    """Base class for all clustering algorithms"""
    
    @abstractmethod
    def add_log(self, message: str, log_idx: int) -> str:
        """Add a log message and return its cluster ID"""
        pass
    
    @abstractmethod
    def get_clusters(self) -> Dict[str, ClusterInfo]:
        """Get all clusters"""
        pass
    
    @abstractmethod
    def reset(self):
        """Reset the clusterer state"""
        pass


# ============================================================================
# DRAIN ALGORITHM - For Structured Logs
# ============================================================================

class DrainNode:
    """Node in the Drain parse tree"""
    def __init__(self):
        self.children: Dict[str, 'DrainNode'] = {}
        self.cluster_ids: List[str] = []


class DrainClusterer(BaseClusterer):
    """
    Drain algorithm - optimized for structured logs.
    
    Works best for:
    - Sidekiq job logs (consistent structure)
    - Rails request logs (controller/action patterns)
    - Gitaly gRPC logs (method/service patterns)
    """
    
    def __init__(self, depth: int = 4, sim_th: float = 0.6, max_children: int = 100):
        self.depth = depth
        self.sim_th = sim_th
        self.max_children = max_children
        
        self.root = DrainNode()
        self.clusters: Dict[str, ClusterInfo] = {}
        self.cluster_counter = 0
        
        # Patterns for variable detection
        self.var_patterns = [
            re.compile(r'^[a-fA-F0-9]{8,}$'),  # Hex IDs
            re.compile(r'^[a-fA-F0-9-]{36}$'),  # UUIDs
            re.compile(r'^\d+\.?\d*$'),         # Numbers
            re.compile(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}'),  # IPs
        ]
    
    def add_log(self, message: str, log_idx: int) -> str:
        tokens = self._tokenize(message)
        
        if not tokens:
            return "DRAIN_EMPTY"
        
        # Search for matching cluster
        matched_cluster_id = self._tree_search(tokens)
        
        if matched_cluster_id:
            cluster = self.clusters[matched_cluster_id]
            cluster.add_log(log_idx)
            # Update template by merging
            cluster.template = self._merge_template(cluster.template, ' '.join(tokens))
            return matched_cluster_id
        
        # Create new cluster
        cluster_id = f"DRAIN_{self.cluster_counter:04d}"
        self.cluster_counter += 1
        
        cluster = ClusterInfo(
            cluster_id=cluster_id,
            template=' '.join(tokens),
            algorithm="drain",
            count=1,
            log_indices=[log_idx]
        )
        self.clusters[cluster_id] = cluster
        
        # Add to tree
        self._add_to_tree(tokens, cluster_id)
        
        return cluster_id
    
    def _tokenize(self, message: str) -> List[str]:
        """Tokenize message and mark variables"""
        tokens = message.split()
        result = []
        
        for i, token in enumerate(tokens):
            # Check if token is a variable
            is_var = False
            
            # GitLab-specific variable patterns (CRITICAL FIX!)
            # JID can appear with or without colon
            if 'JID-' in token:  # Matches "JID-abc123" or "JID-abc123:"
                is_var = True
            elif re.match(r'^[a-f0-9]{32,}$', token):  # Correlation ID (32+ hex chars)
                is_var = True
            elif re.match(r'^\d+\.\d+$', token):  # Duration/timing like "0.5"
                is_var = True
            elif re.match(r'^\(\d+\):?$', token):  # Repository ID like "(6560):"
                is_var = True
            elif token.endswith('ms') or token.endswith('sec'):  # Time units
                is_var = True
            
            # Original variable patterns
            if not is_var:
                for pattern in self.var_patterns:
                    if pattern.match(token):
                        is_var = True
                        break
            
            # Also check length and digit ratio
            if not is_var and len(token) > 50:
                is_var = True
            elif not is_var and len(token) > 4:
                digit_ratio = sum(c.isdigit() for c in token) / len(token)
                if digit_ratio > 0.7:
                    is_var = True
            
            result.append('<*>' if is_var else token)
        
        return result
    
    def _tree_search(self, tokens: List[str]) -> Optional[str]:
        """Search tree for matching cluster"""
        token_count = str(len(tokens))
        
        if token_count not in self.root.children:
            return None
        
        current = self.root.children[token_count]
        
        # Navigate tree using first few tokens
        for i in range(min(self.depth - 1, len(tokens))):
            token = tokens[i]
            if token in current.children:
                current = current.children[token]
            elif '<*>' in current.children:
                current = current.children['<*>']
            else:
                return None
        
        # Find best matching cluster
        best_cluster_id = None
        best_sim = 0
        
        for cluster_id in current.cluster_ids:
            cluster = self.clusters[cluster_id]
            sim = self._similarity(cluster.template.split(), tokens)
            if sim >= self.sim_th and sim > best_sim:
                best_sim = sim
                best_cluster_id = cluster_id
        
        return best_cluster_id
    
    def _similarity(self, seq1: List[str], seq2: List[str]) -> float:
        """Calculate similarity between two token sequences"""
        if len(seq1) != len(seq2) or len(seq1) == 0:
            return 0.0
        
        matches = sum(1 for t1, t2 in zip(seq1, seq2) if t1 == t2 or t1 == '<*>' or t2 == '<*>')
        return matches / len(seq1)
    
    def _merge_template(self, template: str, new_log: str) -> str:
        """Merge template with new log to generalize"""
        t_tokens = template.split()
        n_tokens = new_log.split()
        
        if len(t_tokens) != len(n_tokens):
            return template
        
        merged = [t if t == n else '<*>' for t, n in zip(t_tokens, n_tokens)]
        return ' '.join(merged)
    
    def _add_to_tree(self, tokens: List[str], cluster_id: str):
        """Add cluster to parse tree"""
        token_count = str(len(tokens))
        
        if token_count not in self.root.children:
            self.root.children[token_count] = DrainNode()
        
        current = self.root.children[token_count]
        
        for i in range(min(self.depth - 1, len(tokens))):
            token = tokens[i]
            if token == '<*>':
                token = '<*>'
            
            if token not in current.children:
                if len(current.children) >= self.max_children:
                    token = '<*>'
                if token not in current.children:
                    current.children[token] = DrainNode()
            
            current = current.children[token]
        
        current.cluster_ids.append(cluster_id)
    
    def get_clusters(self) -> Dict[str, ClusterInfo]:
        return self.clusters
    
    def reset(self):
        self.root = DrainNode()
        self.clusters = {}
        self.cluster_counter = 0


# ============================================================================
# LENMA ALGORITHM - For Variable-Length Logs
# ============================================================================

class LenMaClusterer(BaseClusterer):
    """
    LenMa (Length Matters) algorithm - optimized for variable-length logs.
    
    Works best for:
    - PostgreSQL logs (queries of varying length)
    - NGINX error logs (variable error descriptions)
    - Unstructured text logs
    
    Key insight: Logs with similar lengths often have similar templates.
    """
    
    def __init__(self, length_tolerance: int = 5, sim_th: float = 0.5):
        self.length_tolerance = length_tolerance
        self.sim_th = sim_th
        
        # Group clusters by message length
        self.length_groups: Dict[int, List[str]] = defaultdict(list)
        self.clusters: Dict[str, ClusterInfo] = {}
        self.cluster_counter = 0
    
    def add_log(self, message: str, log_idx: int) -> str:
        tokens = message.split()
        msg_length = len(tokens)
        
        # Search in nearby length groups
        matched_cluster_id = None
        best_sim = 0
        
        for length in range(msg_length - self.length_tolerance, 
                           msg_length + self.length_tolerance + 1):
            if length not in self.length_groups:
                continue
            
            for cluster_id in self.length_groups[length]:
                cluster = self.clusters[cluster_id]
                sim = self._calculate_similarity(cluster.template, message)
                
                if sim >= self.sim_th and sim > best_sim:
                    best_sim = sim
                    matched_cluster_id = cluster_id
        
        if matched_cluster_id:
            cluster = self.clusters[matched_cluster_id]
            cluster.add_log(log_idx)
            # Update template
            cluster.template = self._merge_messages(cluster.template, message)
            return matched_cluster_id
        
        # Create new cluster
        cluster_id = f"LENMA_{self.cluster_counter:04d}"
        self.cluster_counter += 1
        
        cluster = ClusterInfo(
            cluster_id=cluster_id,
            template=message,
            algorithm="lenma",
            count=1,
            log_indices=[log_idx]
        )
        
        self.clusters[cluster_id] = cluster
        self.length_groups[msg_length].append(cluster_id)
        
        return cluster_id
    
    def _calculate_similarity(self, template: str, message: str) -> float:
        """Calculate word-level similarity"""
        t_tokens = set(template.split())
        m_tokens = set(message.split())
        
        if not t_tokens or not m_tokens:
            return 0.0
        
        intersection = len(t_tokens & m_tokens)
        union = len(t_tokens | m_tokens)
        
        return intersection / union if union > 0 else 0.0
    
    def _merge_messages(self, template: str, message: str) -> str:
        """Merge template with new message"""
        t_tokens = template.split()
        m_tokens = message.split()
        
        # If lengths differ significantly, keep original template
        if abs(len(t_tokens) - len(m_tokens)) > self.length_tolerance:
            return template
        
        # Simple merge: keep common words
        common = []
        for t, m in zip(t_tokens, m_tokens):
            if t == m:
                common.append(t)
            else:
                common.append('<*>')
        
        return ' '.join(common) if common else template
    
    def get_clusters(self) -> Dict[str, ClusterInfo]:
        return self.clusters
    
    def reset(self):
        self.length_groups = defaultdict(list)
        self.clusters = {}
        self.cluster_counter = 0


# ============================================================================
# SEMANTIC CLUSTERING - For Error Messages
# ============================================================================

class SemanticClusterer(BaseClusterer):
    """
    Semantic clustering using simple keyword-based similarity.
    
    Works best for:
    - Exception messages
    - Error descriptions
    - Human-readable log messages
    
    Note: For production, this could use sentence-transformers,
    but we keep it simple with keyword matching for now.
    """
    
    def __init__(self, sim_th: float = 0.4):
        self.sim_th = sim_th
        self.clusters: Dict[str, ClusterInfo] = {}
        self.cluster_counter = 0
        
        # Stop words to ignore
        self.stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
            'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
            'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their'
        }
    
    def add_log(self, message: str, log_idx: int) -> str:
        # Extract keywords
        keywords = self._extract_keywords(message)
        
        if not keywords:
            return "SEMANTIC_EMPTY"
        
        # Find best matching cluster
        matched_cluster_id = None
        best_sim = 0
        
        for cluster_id, cluster in self.clusters.items():
            cluster_keywords = self._extract_keywords(cluster.template)
            sim = self._keyword_similarity(keywords, cluster_keywords)
            
            if sim >= self.sim_th and sim > best_sim:
                best_sim = sim
                matched_cluster_id = cluster_id
        
        if matched_cluster_id:
            cluster = self.clusters[matched_cluster_id]
            cluster.add_log(log_idx)
            return matched_cluster_id
        
        # Create new cluster
        cluster_id = f"SEMANTIC_{self.cluster_counter:04d}"
        self.cluster_counter += 1
        
        cluster = ClusterInfo(
            cluster_id=cluster_id,
            template=message,
            algorithm="semantic",
            count=1,
            log_indices=[log_idx]
        )
        
        self.clusters[cluster_id] = cluster
        return cluster_id
    
    def _extract_keywords(self, message: str) -> Set[str]:
        """Extract meaningful keywords from message"""
        # Lowercase and split
        words = message.lower().split()
        
        # Remove stop words and short words
        keywords = {
            w for w in words 
            if len(w) > 3 and w not in self.stop_words and w.isalpha()
        }
        
        return keywords
    
    def _keyword_similarity(self, kw1: Set[str], kw2: Set[str]) -> float:
        """Calculate Jaccard similarity between keyword sets"""
        if not kw1 or not kw2:
            return 0.0
        
        intersection = len(kw1 & kw2)
        union = len(kw1 | kw2)
        
        return intersection / union if union > 0 else 0.0
    
    def get_clusters(self) -> Dict[str, ClusterInfo]:
        return self.clusters
    
    def reset(self):
        self.clusters = {}
        self.cluster_counter = 0


# ============================================================================
# EXCEPTION-BASED CLUSTERING - For Error Logs
# ============================================================================

class ExceptionClusterer(BaseClusterer):
    """
    Exception-based clustering - groups by exception class.
    
    Works best for:
    - Rails exception logs
    - Sidekiq failed jobs
    - Any logs with exception.class field
    
    This is the most precise clustering for errors.
    """
    
    def __init__(self):
        self.clusters: Dict[str, ClusterInfo] = {}
    
    def add_log(self, exception_class: str, log_idx: int) -> str:
        """Add log by exception class"""
        if not exception_class:
            return "EXCEPTION_NONE"
        
        cluster_id = f"EXC_{exception_class}"
        
        if cluster_id not in self.clusters:
            self.clusters[cluster_id] = ClusterInfo(
                cluster_id=cluster_id,
                template=exception_class,
                algorithm="exception",
                count=0
            )
        
        self.clusters[cluster_id].add_log(log_idx)
        return cluster_id
    
    def get_clusters(self) -> Dict[str, ClusterInfo]:
        return self.clusters
    
    def reset(self):
        self.clusters = {}


# ============================================================================
# ADAPTIVE CLUSTERING STRATEGY
# ============================================================================

class AdaptiveClusterer:
    """
    Adaptive clustering that selects the best algorithm based on log characteristics.
    
    Strategy:
    1. If exception.class exists -> ExceptionClusterer (most precise)
    2. If JSON with consistent structure -> DrainClusterer
    3. If variable-length text -> LenMaClusterer
    4. If error message -> SemanticClusterer
    5. Default -> DrainClusterer
    """
    
    def __init__(self, component: str = "unknown", log_format: str = "unknown"):
        self.component = component
        self.log_format = log_format
        
        # Initialize all clusterers
        self.exception_clusterer = ExceptionClusterer()
        self.drain_clusterer = DrainClusterer(depth=4, sim_th=self._get_drain_threshold())
        self.lenma_clusterer = LenMaClusterer(length_tolerance=5, sim_th=0.5)
        self.semantic_clusterer = SemanticClusterer(sim_th=0.4)
        
        # Track which clusterer was used for each log
        self.log_to_clusterer: Dict[int, str] = {}
    
    def _get_drain_threshold(self) -> float:
        """Get component-specific Drain similarity threshold"""
        thresholds = {
            'sidekiq': 0.7,      # Sidekiq logs are very structured
            'rails': 0.6,        # Rails logs have some variation
            'gitaly': 0.7,       # gRPC logs are structured
            'praefect': 0.7,
            'postgresql': 0.5,   # SQL queries vary a lot
            'nginx': 0.5,        # Error messages vary
            'redis': 0.6,
        }
        return thresholds.get(self.component, 0.6)
    
    def add_log(
        self, 
        message: str, 
        log_idx: int,
        exception_class: Optional[str] = None,
        is_json: bool = False
    ) -> Tuple[str, str]:
        """
        Add a log and return (cluster_id, algorithm_used).
        
        Args:
            message: The log message to cluster
            log_idx: Index of the log
            exception_class: Exception class if available
            is_json: Whether this is a JSON log
            
        Returns:
            (cluster_id, algorithm_name)
        """
        
        # Strategy 1: Exception-based (highest priority for errors)
        if exception_class:
            cluster_id = self.exception_clusterer.add_log(exception_class, log_idx)
            self.log_to_clusterer[log_idx] = 'exception'
            return cluster_id, 'exception'
        
        # Strategy 2: For JSON logs with structure, use Drain
        if is_json or self.log_format == 'json':
            cluster_id = self.drain_clusterer.add_log(message, log_idx)
            self.log_to_clusterer[log_idx] = 'drain'
            return cluster_id, 'drain'
        
        # Strategy 3: For PostgreSQL/NGINX, use LenMa
        if self.component in ['postgresql', 'nginx', 'redis']:
            cluster_id = self.lenma_clusterer.add_log(message, log_idx)
            self.log_to_clusterer[log_idx] = 'lenma'
            return cluster_id, 'lenma'
        
        # Strategy 4: For error messages, try semantic first
        if any(keyword in message.lower() for keyword in ['error', 'fail', 'exception', 'fatal']):
            cluster_id = self.semantic_clusterer.add_log(message, log_idx)
            self.log_to_clusterer[log_idx] = 'semantic'
            return cluster_id, 'semantic'
        
        # Strategy 5: Default to Drain
        cluster_id = self.drain_clusterer.add_log(message, log_idx)
        self.log_to_clusterer[log_idx] = 'drain'
        return cluster_id, 'drain'
    
    def get_all_clusters(self) -> Dict[str, ClusterInfo]:
        """Get all clusters from all clusterers"""
        all_clusters = {}
        
        all_clusters.update(self.exception_clusterer.get_clusters())
        all_clusters.update(self.drain_clusterer.get_clusters())
        all_clusters.update(self.lenma_clusterer.get_clusters())
        all_clusters.update(self.semantic_clusterer.get_clusters())
        
        return all_clusters
    
    def get_statistics(self) -> Dict[str, int]:
        """Get statistics about algorithm usage"""
        stats = Counter(self.log_to_clusterer.values())
        return dict(stats)
    
    def reset(self):
        """Reset all clusterers"""
        self.exception_clusterer.reset()
        self.drain_clusterer.reset()
        self.lenma_clusterer.reset()
        self.semantic_clusterer.reset()
        self.log_to_clusterer = {}


# ============================================================================
# GITLAB LOG TYPE REGISTRY
# ============================================================================

class LogFormat(Enum):
    """Supported log formats"""
    JSON = "json"
    SYSLOG = "syslog"
    NGINX = "nginx"
    PLAIN = "plain"


@dataclass
class GitLabLogConfig:
    """Configuration for a specific GitLab log type"""
    name: str
    format: LogFormat
    file_patterns: List[str]
    
    # For JSON logs
    message_fields: List[str] = field(default_factory=lambda: ['message'])
    exception_class_field: Optional[str] = 'exception.class'
    exception_message_field: Optional[str] = 'exception.message'
    timestamp_field: str = 'time'
    severity_field: str = 'severity'
    key_fields: List[str] = field(default_factory=list)
    
    # For non-JSON logs
    line_pattern: Optional[str] = None
    
    # Component identification
    component: str = "unknown"
    
    # Recommended clustering algorithm
    preferred_algorithm: ClusteringAlgorithm = ClusteringAlgorithm.HYBRID
    
    # Smart patterns for this log type
    smart_patterns: List[Dict[str, str]] = field(default_factory=list)


# Comprehensive GitLab log type registry with algorithm recommendations
GITLAB_LOG_REGISTRY: Dict[str, GitLabLogConfig] = {
    # ========== RAILS LOGS ==========
    "gitlab-rails/production.log": GitLabLogConfig(
        name="Rails Production",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/production.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/production_json.log": GitLabLogConfig(
        name="Rails Production JSON",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/production_json.log*"],
        message_fields=['message'],
        key_fields=['controller', 'action', 'status', 'method', 'path'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/api_json.log": GitLabLogConfig(
        name="Rails API JSON",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/api_json.log*"],
        message_fields=['message'],
        key_fields=['method', 'path', 'status'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/application.log": GitLabLogConfig(
        name="Rails Application",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/application.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/application_json.log": GitLabLogConfig(
        name="Rails Application JSON",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/application_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/auth.log": GitLabLogConfig(
        name="Rails Auth",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/auth.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.SEMANTIC,
    ),
    
    "gitlab-rails/auth_json.log": GitLabLogConfig(
        name="Rails Auth JSON",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/auth_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.SEMANTIC,
    ),
    
    "gitlab-rails/integrations_json.log": GitLabLogConfig(
        name="Rails Integrations",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/integrations_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/graphql_json.log": GitLabLogConfig(
        name="Rails GraphQL",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/graphql_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/exceptions_json.log": GitLabLogConfig(
        name="Rails Exceptions",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/exceptions_json.log*"],
        message_fields=['exception.message', 'message'],
        exception_class_field='exception.class',
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.EXCEPTION_BASED,
    ),
    
    "gitlab-rails/audit_json.log": GitLabLogConfig(
        name="Rails Audit",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/audit_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/geo.log": GitLabLogConfig(
        name="Geo Replication",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/geo.log*"],
        message_fields=['message', 'exception.message'],
        exception_class_field='exception.class',
        component="geo",
        preferred_algorithm=ClusteringAlgorithm.HYBRID,
    ),
    
    "gitlab-rails/llm.log": GitLabLogConfig(
        name="Rails LLM",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/llm.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.SEMANTIC,
    ),
    
    "gitlab-rails/migrations.log": GitLabLogConfig(
        name="Rails Migrations",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/migrations.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/mail_room_json.log": GitLabLogConfig(
        name="Rails Mail Room",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-rails/mail_room_json.log*"],
        message_fields=['message'],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/web_hooks.log": GitLabLogConfig(
        name="Rails Web Hooks",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/web_hooks.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-rails/clickhouse.log": GitLabLogConfig(
        name="Rails ClickHouse",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails/clickhouse.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    # ========== SIDEKIQ LOGS ==========
    "sidekiq.log": GitLabLogConfig(
        name="Sidekiq Main",
        format=LogFormat.PLAIN,
        file_patterns=["**/sidekiq.log*"],
        component="sidekiq",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "sidekiq/current": GitLabLogConfig(
        name="Sidekiq Current",
        format=LogFormat.JSON,
        file_patterns=["**/sidekiq/current", "**/sidekiq/current.*.log"],
        message_fields=['message', 'exception.message'],
        exception_class_field='exception.class',
        key_fields=['class', 'queue', 'job_status', 'jid'],
        component="sidekiq",
        preferred_algorithm=ClusteringAlgorithm.HYBRID,
        smart_patterns=[
            {"name": "Failed Jobs", "pattern": r'"job_status"\s*:\s*"fail"'},
            {"name": "Exceptions", "pattern": r'"exception\.class"'},
        ]
    ),
    
    "sidekiq_exporter.log": GitLabLogConfig(
        name="Sidekiq Exporter",
        format=LogFormat.PLAIN,
        file_patterns=["**/sidekiq_exporter.log*"],
        component="sidekiq",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "cron.log": GitLabLogConfig(
        name="Cron Jobs",
        format=LogFormat.PLAIN,
        file_patterns=["**/cron.log*"],
        component="sidekiq",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    # ========== GITALY & RELATED ==========
    "gitaly/current": GitLabLogConfig(
        name="Gitaly Main",
        format=LogFormat.JSON,
        file_patterns=["**/gitaly/current", "**/gitaly/current.*.log"],
        message_fields=['msg', 'message', 'error'],
        key_fields=['grpc.method', 'grpc.service', 'grpc.code'],
        component="gitaly",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitaly.log": GitLabLogConfig(
        name="Gitaly Log",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitaly.log*"],
        component="gitaly",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "praefect/current": GitLabLogConfig(
        name="Praefect Main",
        format=LogFormat.JSON,
        file_patterns=["**/praefect/current", "**/praefect/current.*.log"],
        message_fields=['msg', 'message', 'error'],
        key_fields=['grpc.method', 'grpc.service', 'grpc.code'],
        component="praefect",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    # ========== WORKHORSE & SHELL ==========
    "gitlab-workhorse.log": GitLabLogConfig(
        name="GitLab Workhorse",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-workhorse.log*"],
        message_fields=['message', 'msg'],
        component="workhorse",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-shell.log": GitLabLogConfig(
        name="GitLab Shell",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-shell.log*"],
        component="shell",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-kas.log": GitLabLogConfig(
        name="GitLab KAS",
        format=LogFormat.JSON,
        file_patterns=["**/gitlab-kas.log*"],
        message_fields=['message', 'msg'],
        component="kas",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    # ========== PAGES & REGISTRY ==========
    "gitlab-pages.log": GitLabLogConfig(
        name="GitLab Pages",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-pages.log*"],
        component="pages",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "gitlab-pages-daemon.log": GitLabLogConfig(
        name="GitLab Pages Daemon",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-pages-daemon.log*"],
        component="pages",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "registry.log": GitLabLogConfig(
        name="Registry",
        format=LogFormat.JSON,
        file_patterns=["**/registry.log*"],
        message_fields=['message', 'msg'],
        component="registry",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    # ========== DATABASE & CACHE ==========
    "postgresql/current": GitLabLogConfig(
        name="PostgreSQL",
        format=LogFormat.SYSLOG,
        file_patterns=["**/postgresql/current", "**/postgresql/postgresql.log*"],
        component="postgresql",
        preferred_algorithm=ClusteringAlgorithm.LENMA,
    ),
    
    "postgresql.log": GitLabLogConfig(
        name="PostgreSQL Log",
        format=LogFormat.PLAIN,
        file_patterns=["**/postgresql.log*"],
        component="postgresql",
        preferred_algorithm=ClusteringAlgorithm.LENMA,
    ),
    
    "patroni.log": GitLabLogConfig(
        name="Patroni",
        format=LogFormat.PLAIN,
        file_patterns=["**/patroni.log*"],
        component="postgresql",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "redis.log": GitLabLogConfig(
        name="Redis",
        format=LogFormat.SYSLOG,
        file_patterns=["**/redis.log*", "**/redis/current", "**/redis/*.log"],
        component="redis",
        preferred_algorithm=ClusteringAlgorithm.LENMA,
    ),
    
    # ========== WEB SERVERS ==========
    "puma.log": GitLabLogConfig(
        name="Puma",
        format=LogFormat.PLAIN,
        file_patterns=["**/puma.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "puma_stderr.log": GitLabLogConfig(
        name="Puma Stderr",
        format=LogFormat.PLAIN,
        file_patterns=["**/puma_stderr.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.SEMANTIC,
    ),
    
    "puma_stdout.log": GitLabLogConfig(
        name="Puma Stdout",
        format=LogFormat.PLAIN,
        file_patterns=["**/puma_stdout.log*"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "nginx-access.log": GitLabLogConfig(
        name="NGINX Access",
        format=LogFormat.NGINX,
        file_patterns=["**/nginx-access.log*", "**/nginx/access.log*"],
        component="nginx",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
    
    "nginx-error.log": GitLabLogConfig(
        name="NGINX Errors",
        format=LogFormat.NGINX,
        file_patterns=["**/nginx-error.log*", "**/nginx/error.log*", "**/nginx/gitlab_error.log*"],
        component="nginx",
        preferred_algorithm=ClusteringAlgorithm.SEMANTIC,
    ),
    
    # ========== MIGRATIONS & UTILITIES ==========
    "gitlab-rails-db-migrate.log": GitLabLogConfig(
        name="DB Migrations",
        format=LogFormat.PLAIN,
        file_patterns=["**/gitlab-rails-db-migrate*.log"],
        component="rails",
        preferred_algorithm=ClusteringAlgorithm.DRAIN,
    ),
}


def detect_log_type(file_path: str) -> Optional[GitLabLogConfig]:
    """Detect log type from file path"""
    file_path_lower = file_path.lower()
    
    for log_id, config in GITLAB_LOG_REGISTRY.items():
        for pattern in config.file_patterns:
            regex_pattern = pattern.replace('**/', '.*').replace('*', '[^/]*').replace('.', r'\.')
            if re.search(regex_pattern, file_path_lower):
                return config
    
    return None


# ============================================================================
# LOG LINE PARSER - SMART MESSAGE EXTRACTION
# ============================================================================

@dataclass
class ParsedLogLine:
    """Represents a parsed log line with metadata"""
    raw: str
    line_number: int
    session_id: str
    file_path: str
    relative_path: str
    log_type: Optional[str]
    component: str
    
    # Parsed fields
    timestamp: Optional[str] = None
    severity: Optional[str] = None
    message: str = ""  # THE ACTUAL MESSAGE TO CLUSTER
    exception_class: Optional[str] = None
    exception_message: Optional[str] = None
    
    # Original structured data (for JSON logs)
    structured_data: Dict[str, Any] = field(default_factory=dict)
    is_json: bool = False
    
    # GitLab-specific metadata (NEW!)
    gitlab_metadata: Optional[Any] = None  # GitLabLogMetadata
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            'raw': self.raw,  # DON'T TRUNCATE - let frontend decide
            'line_number': self.line_number,
            'session_id': self.session_id,
            'file_path': self.file_path,
            'relative_path': self.relative_path,
            'log_type': self.log_type,
            'component': self.component,
            'timestamp': self.timestamp,
            'severity': self.severity,
            'message': self.message,  # DON'T TRUNCATE
            'exception_class': self.exception_class,
        }
        
        # Add GitLab metadata if available
        if self.gitlab_metadata and GITLAB_INTELLIGENCE_AVAILABLE:
            result['gitlab_meta'] = {
                'correlation_id': self.gitlab_metadata.correlation_id,
                'caller_id': self.gitlab_metadata.meta_caller_id,
                'feature_category': self.gitlab_metadata.meta_feature_category,
                'worker_class': self.gitlab_metadata.worker_class,
                'job_status': self.gitlab_metadata.job_status,
                'grpc_method': self.gitlab_metadata.grpc_method,
                'grpc_code': self.gitlab_metadata.grpc_code,
            }
        
        return result


class GitLabLogParser:
    """Parser for GitLab log files - SMART MESSAGE EXTRACTION"""
    
    def __init__(self):
        self.parsers = {
            LogFormat.JSON: self._parse_json_line,
            LogFormat.SYSLOG: self._parse_syslog_line,
            LogFormat.NGINX: self._parse_nginx_line,
            LogFormat.PLAIN: self._parse_plain_line,
        }
        
        # Initialize GitLab enricher if available
        self.gitlab_enricher = GitLabLogEnricher() if GITLAB_INTELLIGENCE_AVAILABLE else None
    
    def parse_line(
        self,
        raw_line: str,
        line_number: int,
        session_id: str,
        file_path: str,
        config: Optional[GitLabLogConfig] = None
    ) -> ParsedLogLine:
        """Parse a single log line and extract the ACTUAL MESSAGE"""
        
        relative_path = self._get_relative_path(file_path, session_id)
        
        if config is None:
            config = detect_log_type(file_path)
        
        parsed = ParsedLogLine(
            raw=raw_line,
            line_number=line_number,
            session_id=session_id,
            file_path=file_path,
            relative_path=relative_path,
            log_type=config.name if config else None,
            component=config.component if config else "unknown"
        )
        
        if config is None:
            parsed = self._try_auto_detect(parsed, raw_line)
        else:
            parser = self.parsers.get(config.format, self._parse_plain_line)
            parsed = parser(parsed, raw_line, config)
        
        # CRITICAL FIX: Strip JIDs and other variables from message BEFORE clustering
        if parsed.message:
            parsed.message = self._normalize_message(parsed.message)
        
        return parsed
    
    def _normalize_message(self, message: str) -> str:
        """
        Normalize message by removing variable parts that shouldn't affect clustering.
        
        This is CRITICAL for proper clustering!
        """
        # Remove Sidekiq JIDs (most common issue)
        message = re.sub(r'\bJID-[a-f0-9]{24}\b', '<JID>', message)
        
        # Remove correlation IDs (32 hex chars)
        message = re.sub(r'\b[a-f0-9]{32}\b', '<CORRELATION_ID>', message)
        
        # Remove UUIDs
        message = re.sub(r'\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b', '<UUID>', message)
        
        # Remove timestamps
        message = re.sub(r'\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?', '<TIMESTAMP>', message)
        
        # Remove repository IDs like "(6560):"
        message = re.sub(r'\(\d+\):', '(<ID>):', message)
        
        # Remove durations but keep the pattern
        message = re.sub(r'\b\d+\.\d+\s*(?:sec|ms|s)\b', '<DURATION>', message)
        
        # Remove large numbers (likely IDs)
        message = re.sub(r'\b\d{6,}\b', '<ID>', message)
        
        return message
    
    def _get_relative_path(self, file_path: str, session_id: str) -> str:
        """Extract relative path from full file path"""
        try:
            if session_id in file_path:
                idx = file_path.index(session_id) + len(session_id)
                return file_path[idx:].lstrip('/')
        except:
            pass
        return Path(file_path).name
    
    def _try_auto_detect(self, parsed: ParsedLogLine, raw_line: str) -> ParsedLogLine:
        """Try to auto-detect format and parse"""
        stripped = raw_line.strip()
        
        if stripped.startswith('{') and stripped.endswith('}'):
            try:
                return self._parse_json_line(parsed, raw_line, None)
            except:
                pass
        
        return self._parse_plain_line(parsed, raw_line, None)
    
    def _get_nested_field(self, data: Dict, field_path: str) -> Optional[str]:
        """Get nested field like 'exception.class' from dict"""
        if not field_path:
            return None
        
        parts = field_path.split('.')
        current = data
        
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
                if current is None:
                    return None
            else:
                return None
        
        return str(current) if current is not None else None
    
    def _parse_json_line(
        self,
        parsed: ParsedLogLine,
        raw_line: str,
        config: Optional[GitLabLogConfig]
    ) -> ParsedLogLine:
        """
        Parse JSON log - EXTRACT THE ACTUAL MESSAGE, DON'T FLATTEN!
        
        This is the KEY FIX: We extract the semantic message content
        from JSON, not the entire JSON structure.
        """
        try:
            data = json.loads(raw_line.strip())
            parsed.structured_data = data
            parsed.is_json = True
            
            # Extract timestamp
            if config and config.timestamp_field:
                parsed.timestamp = self._get_nested_field(data, config.timestamp_field)
            else:
                parsed.timestamp = data.get('time') or data.get('timestamp')
            
            # Extract severity
            if config and config.severity_field:
                parsed.severity = self._get_nested_field(data, config.severity_field)
            else:
                parsed.severity = data.get('severity') or data.get('level')
            
            if parsed.severity:
                parsed.severity = parsed.severity.upper()
            
            # Extract exception info (CRITICAL for clustering)
            if config:
                parsed.exception_class = self._get_nested_field(data, config.exception_class_field)
                parsed.exception_message = self._get_nested_field(data, config.exception_message_field)
            else:
                parsed.exception_class = self._get_nested_field(data, 'exception.class')
                parsed.exception_message = self._get_nested_field(data, 'exception.message')
            
            # Extract THE ACTUAL MESSAGE (not the JSON structure!)
            message_fields = config.message_fields if config else ['message', 'msg', 'error']
            for field in message_fields:
                msg = self._get_nested_field(data, field)
                if msg:
                    parsed.message = msg
                    break
            
            # Fallback: use exception message or build from key fields
            if not parsed.message:
                if parsed.exception_message:
                    parsed.message = parsed.exception_message
                elif parsed.exception_class:
                    parsed.message = parsed.exception_class
                else:
                    # Build a meaningful message from key fields
                    if config and config.key_fields:
                        parts = []
                        for field in config.key_fields[:3]:
                            val = self._get_nested_field(data, field)
                            if val and not self._is_variable_value(val):
                                parts.append(f"{field}={val}")
                        if parts:
                            parsed.message = ' '.join(parts)
                        else:
                            # Last resort: use first non-variable string value
                            parsed.message = self._extract_first_meaningful_value(data)
            
            # GITLAB INTELLIGENCE: Extract GitLab-specific metadata
            if self.gitlab_enricher:
                try:
                    parsed.gitlab_metadata = self.gitlab_enricher.extract_metadata(data)
                    
                    # Build enhanced template using GitLab context
                    enhanced_template = self.gitlab_enricher.build_enhanced_template(
                        parsed.message,
                        parsed.gitlab_metadata,
                        parsed.component
                    )
                    
                    # If we got a better template, use it
                    if enhanced_template != parsed.message and len(enhanced_template) > 5:
                        parsed.message = enhanced_template
                except Exception as e:
                    # Silently fail - don't break parsing
                    logger.debug(f"GitLab enrichment failed: {e}")
            
        except json.JSONDecodeError:
            return self._parse_plain_line(parsed, raw_line, config)
        
        return parsed
    
    def _is_variable_value(self, value: str) -> bool:
        """Check if a value is likely a variable (ID, timestamp, etc.)"""
        if not isinstance(value, str):
            return True
        
        # Check for IDs, timestamps, etc.
        if len(value) > 40:
            return True
        if re.match(r'^[a-fA-F0-9-]{8,}$', value):
            return True
        if re.match(r'^\d{4}-\d{2}-\d{2}', value):
            return True
        
        return False
    
    def _extract_first_meaningful_value(self, data: Dict) -> str:
        """Extract first meaningful string value from JSON"""
        for key, value in data.items():
            if isinstance(value, str) and len(value) > 5 and not self._is_variable_value(value):
                return value
        return "unknown"
    
    def _parse_syslog_line(
        self,
        parsed: ParsedLogLine,
        raw_line: str,
        config: Optional[GitLabLogConfig]
    ) -> ParsedLogLine:
        """Parse syslog-formatted log line"""
        if config and config.line_pattern:
            match = re.match(config.line_pattern, raw_line.strip())
            if match:
                groups = match.groupdict()
                parsed.timestamp = groups.get('timestamp')
                parsed.severity = groups.get('level', '').upper()
                parsed.message = groups.get('content', raw_line)
                return parsed
        
        # Generic syslog parsing
        parts = raw_line.split(':', 2)
        if len(parts) >= 2:
            parsed.message = parts[-1].strip()
        else:
            parsed.message = raw_line
        
        return parsed
    
    def _parse_nginx_line(
        self,
        parsed: ParsedLogLine,
        raw_line: str,
        config: Optional[GitLabLogConfig]
    ) -> ParsedLogLine:
        """Parse NGINX log line"""
        if config and config.line_pattern:
            match = re.match(config.line_pattern, raw_line.strip())
            if match:
                groups = match.groupdict()
                parsed.timestamp = groups.get('timestamp')
                parsed.severity = groups.get('level', '').upper()
                parsed.message = groups.get('content', raw_line)
                return parsed
        
        parsed.message = raw_line
        return parsed
    
    def _parse_plain_line(
        self,
        parsed: ParsedLogLine,
        raw_line: str,
        config: Optional[GitLabLogConfig]
    ) -> ParsedLogLine:
        """Parse plain text log line"""
        parsed.message = raw_line.strip()
        
        # Try to extract severity
        severity_patterns = [
            (r'\b(ERROR|ERR)\b', 'ERROR'),
            (r'\b(WARN|WARNING)\b', 'WARNING'),
            (r'\b(INFO)\b', 'INFO'),
            (r'\b(DEBUG)\b', 'DEBUG'),
            (r'\b(FATAL|CRITICAL)\b', 'CRITICAL'),
        ]
        
        for pattern, severity in severity_patterns:
            if re.search(pattern, raw_line, re.I):
                parsed.severity = severity
                break
        
        return parsed


# ============================================================================
# SESSION MANAGER (keeping existing implementation)
# ============================================================================

@dataclass
class LogFile:
    """Represents a discovered log file"""
    session_id: str
    relative_path: str
    absolute_path: str
    config: Optional[GitLabLogConfig]
    component: str
    size_bytes: int = 0


@dataclass
class Session:
    """Represents an analysis session (SOS bundle)"""
    session_id: str
    root_path: str
    log_files: Dict[str, LogFile] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    discovered_at: str = field(default_factory=lambda: datetime.now().isoformat())


class SessionManager:
    """Manages SOS bundle sessions and recursive log file discovery"""
    
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.extracted_dir = self.data_dir / "extracted"
        self.sessions_metadata_dir = self.data_dir / "sessions"
        
        self.extracted_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_metadata_dir.mkdir(parents=True, exist_ok=True)
        
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()
        
        self.log_extensions = {'.log', '.txt', '.json', '.gz', ''}
        self.log_names = {'current', 'messages', 'syslog', 'access', 'error'}
    
    def discover_sessions(self, force_rescan: bool = False) -> List[Session]:
        """Discover all sessions in the extracted directory"""
        with self._lock:
            if self._sessions and not force_rescan:
                return list(self._sessions.values())
            
            self._sessions = {}
            
            if not self.extracted_dir.exists():
                return []
            
            for entry in self.extracted_dir.iterdir():
                if entry.is_dir():
                    session = self._scan_session(entry)
                    if session and session.log_files:
                        self._sessions[session.session_id] = session
            
            return list(self._sessions.values())
    
    def _scan_session(self, session_path: Path) -> Optional[Session]:
        """Scan a single session directory for log files"""
        session_id = session_path.name
        session = Session(
            session_id=session_id,
            root_path=str(session_path)
        )
        
        for file_path in session_path.rglob('*'):
            if not file_path.is_file():
                continue
            
            if not self._is_log_file(file_path):
                continue
            
            relative_path = str(file_path.relative_to(session_path))
            config = detect_log_type(relative_path)
            
            log_file = LogFile(
                session_id=session_id,
                relative_path=relative_path,
                absolute_path=str(file_path),
                config=config,
                component=config.component if config else self._guess_component(relative_path),
                size_bytes=file_path.stat().st_size
            )
            
            session.log_files[relative_path] = log_file
        
        return session if session.log_files else None
    
    def _is_log_file(self, file_path: Path) -> bool:
        """
        Check if a file looks like a log file.
        
        MUCH MORE PERMISSIVE - we want to catch ALL potential log files!
        """
        file_name = file_path.name.lower()
        file_path_str = str(file_path).lower()
        
        # 1. Check if it's in a known log directory
        if '/var/log/' in file_path_str or '\\var\\log\\' in file_path_str:
            # Exclude binary/archive files
            if file_path.suffix.lower() not in {'.gz', '.bz2', '.xz', '.zip', '.tar'}:
                return True
        
        # 2. Check file extension
        suffix = file_path.suffix.lower()
        if suffix in {'.log', '.txt', '.json'}:
            return True
        
        # 3. Check if filename contains 'log'
        if 'log' in file_name:
            return True
        
        # 4. Check for known log file names (no extension)
        if file_name in {'current', 'messages', 'syslog', 'access', 'error', 'debug', 
                         'info', 'warn', 'warning', 'stderr', 'stdout'}:
            return True
        
        # 5. Check if parent directory is a known log component
        parent_name = file_path.parent.name.lower()
        if parent_name in {'sidekiq', 'gitaly', 'praefect', 'postgresql', 'postgres',
                          'redis', 'nginx', 'consul', 'patroni', 'gitlab-rails', 
                          'gitlab-workhorse', 'registry', 'puma', 'gitlab-exporter',
                          'logrotate', 'reconfigure', 'unicorn'}:
            # In these directories, accept files without extensions
            if suffix == '' or suffix in {'.log', '.txt', '.json'}:
                return True
        
        # 6. Check path contains known log directories
        path_parts = file_path_str.split('/')
        log_indicators = {'gitlab-rails', 'gitlab-workhorse', 'sidekiq', 'gitaly', 
                         'praefect', 'postgresql', 'nginx', 'redis', 'puma'}
        if any(indicator in path_parts for indicator in log_indicators):
            # If it's in a GitLab component directory and has no extension or .log/.txt
            if suffix in {'', '.log', '.txt', '.json'}:
                return True
        
        return False
    
    def _guess_component(self, path: str) -> str:
        """
        Guess component from path - IMPROVED DETECTION.
        
        Checks path parts in order of specificity.
        """
        path_lower = path.lower()
        
        # More specific patterns first (to avoid false matches)
        components = [
            ('gitlab-rails', 'rails'),
            ('gitlab-workhorse', 'workhorse'),
            ('gitlab-exporter', 'rails'),
            ('sidekiq', 'sidekiq'),
            ('gitaly', 'gitaly'),
            ('praefect', 'praefect'),
            ('postgresql', 'postgresql'),
            ('postgres', 'postgresql'),
            ('patroni', 'postgresql'),
            ('pgbouncer', 'postgresql'),
            ('redis-sentinel', 'redis'),
            ('redis', 'redis'),
            ('nginx', 'nginx'),
            ('puma', 'rails'),
            ('unicorn', 'rails'),
            ('workhorse', 'workhorse'),
            ('registry', 'registry'),
            ('consul', 'consul'),
            ('geo', 'geo'),
            ('pages', 'pages'),
            ('rails', 'rails'),
        ]
        
        for keyword, component in components:
            if keyword in path_lower:
                return component
        
        # Check filename patterns for better detection
        filename = Path(path).name.lower()
        
        # Production logs are usually Rails
        if 'production' in filename and 'json' in filename:
            return 'rails'
        
        # Exception logs are Rails
        if 'exception' in filename:
            return 'rails'
        
        # API logs are Rails
        if 'api' in filename:
            return 'rails'
        
        # Check if it's a system log
        if '/var/log/messages' in path_lower or '/var/log/syslog' in path_lower:
            return 'system'
        if '/var/log/mail' in path_lower:
            return 'system'
        if 'dmesg' in path_lower:
            return 'system'
        if 'cadvisor' in path_lower or 'falcon-sensor' in path_lower or 'sssd' in path_lower:
            return 'system'
        
        # If in /var/log/ but not matched above, check the parent directory name
        if '/var/log/' in path_lower:
            # Extract the immediate parent directory
            parts = path_lower.split('/var/log/')
            if len(parts) > 1:
                subpath = parts[1]
                first_dir = subpath.split('/')[0] if '/' in subpath else None
                
                # Map common /var/log subdirectories to components
                var_log_mapping = {
                    'gitlab': 'rails',
                    'postgresql': 'postgresql',
                    'postgres': 'postgresql',
                    'nginx': 'nginx',
                    'redis': 'redis',
                }
                
                if first_dir and first_dir in var_log_mapping:
                    return var_log_mapping[first_dir]
            
            return 'system'
        
        # LAST RESORT: Try to infer from file content patterns in filename
        # If filename has 'current' it's likely a GitLab service log
        if filename == 'current':
            # Check parent directory
            parent = Path(path).parent.name.lower()
            if parent in ['sidekiq', 'gitaly', 'praefect', 'redis', 'postgresql']:
                return parent
        
        # If we still don't know, return 'unknown' but log it for debugging
        logger.debug(f"Could not determine component for: {path}")
        return 'unknown'
    
    def get_session(self, session_id: str) -> Optional[Session]:
        """Get a specific session by ID"""
        with self._lock:
            if session_id in self._sessions:
                return self._sessions[session_id]
        
        session_path = self.extracted_dir / session_id
        if session_path.exists() and session_path.is_dir():
            session = self._scan_session(session_path)
            if session:
                with self._lock:
                    self._sessions[session_id] = session
                return session
        
        return None
    
    def get_log_files(
        self,
        session_ids: Optional[List[str]] = None,
        components: Optional[List[str]] = None,
        log_types: Optional[List[str]] = None,
        file_patterns: Optional[List[str]] = None
    ) -> List[LogFile]:
        """Get log files matching the specified filters"""
        results = []
        
        if not self._sessions:
            self.discover_sessions()
        
        with self._lock:
            sessions_to_search = (
                [self._sessions[sid] for sid in session_ids if sid in self._sessions]
                if session_ids
                else list(self._sessions.values())
            )
        
        for session in sessions_to_search:
            for rel_path, log_file in session.log_files.items():
                if components and log_file.component not in components:
                    continue
                
                if log_types and (not log_file.config or log_file.config.name not in log_types):
                    continue
                
                if file_patterns:
                    matched = False
                    for pattern in file_patterns:
                        if pattern.lower() in rel_path.lower():
                            matched = True
                            break
                    if not matched:
                        continue
                
                results.append(log_file)
        
        return results
    
    def get_available_components(self) -> List[Dict[str, Any]]:
        """Get list of available components across all sessions"""
        if not self._sessions:
            self.discover_sessions()
        
        components = defaultdict(lambda: {'count': 0, 'sessions': set(), 'files': []})
        
        with self._lock:
            for session in self._sessions.values():
                for log_file in session.log_files.values():
                    comp = log_file.component
                    components[comp]['count'] += 1
                    components[comp]['sessions'].add(session.session_id)
                    if log_file.relative_path not in components[comp]['files']:
                        components[comp]['files'].append(log_file.relative_path)
        
        return [
            {
                'name': comp,
                'file_count': data['count'],
                'session_count': len(data['sessions']),
                'sessions': list(data['sessions']),
                'sample_files': data['files'][:5]
            }
            for comp, data in sorted(components.items())
        ]
    
    def get_available_log_types(self) -> List[Dict[str, Any]]:
        """
        Get list of available log types (more granular than components).
        
        Returns specific log types like:
        - "Rails Production" instead of just "rails"
        - "Sidekiq Main" instead of just "sidekiq"
        - "Geo Replication" for geo.log
        """
        if not self._sessions:
            self.discover_sessions()
        
        log_types = defaultdict(lambda: {
            'count': 0, 
            'sessions': set(), 
            'component': None,
            'files': [],
            'format': None
        })
        
        with self._lock:
            for session in self._sessions.values():
                for log_file in session.log_files.values():
                    if log_file.config:
                        # Use the specific log type name
                        name = log_file.config.name
                        log_types[name]['count'] += 1
                        log_types[name]['sessions'].add(session.session_id)
                        log_types[name]['component'] = log_file.config.component
                        log_types[name]['format'] = log_file.config.format.value
                        if log_file.relative_path not in log_types[name]['files']:
                            log_types[name]['files'].append(log_file.relative_path)
                    else:
                        # For unrecognized files, use component + filename
                        filename = Path(log_file.relative_path).name
                        name = f"{log_file.component.title()} - {filename}"
                        log_types[name]['count'] += 1
                        log_types[name]['sessions'].add(session.session_id)
                        log_types[name]['component'] = log_file.component
                        log_types[name]['format'] = 'unknown'
                        if log_file.relative_path not in log_types[name]['files']:
                            log_types[name]['files'].append(log_file.relative_path)
        
        return [
            {
                'name': name,
                'component': data['component'],
                'format': data['format'],
                'file_count': data['count'],
                'session_count': len(data['sessions']),
                'sample_files': data['files'][:3]
            }
            for name, data in sorted(log_types.items(), key=lambda x: x[1]['count'], reverse=True)
        ]


# ============================================================================
# GREP ENGINE (keeping existing implementation)
# ============================================================================

@dataclass
class GrepStep:
    """Represents a single step in a grep pipeline"""
    pattern: str
    is_inverse: bool = False
    is_case_insensitive: bool = True
    is_regex: bool = True


@dataclass
class GrepPipeline:
    """A pipeline of grep operations"""
    steps: List[GrepStep]
    context_lines: int = 0


class GrepEngine:
    """High-performance grep engine with cross-session support"""
    
    def __init__(self, session_manager: SessionManager):
        self.session_manager = session_manager
        self.parser = GitLabLogParser()
        self._rg_available = self._check_ripgrep()
        self._executor = ThreadPoolExecutor(max_workers=4)
    
    def _check_ripgrep(self) -> bool:
        """Check if ripgrep is available"""
        try:
            result = subprocess.run(['rg', '--version'], capture_output=True, timeout=5)
            return result.returncode == 0
        except:
            return False
    
    def execute_pipeline(
        self,
        pipeline: GrepPipeline,
        session_ids: Optional[List[str]] = None,
        components: Optional[List[str]] = None,
        log_types: Optional[List[str]] = None,
        file_patterns: Optional[List[str]] = None,
        max_results: Optional[int] = None
    ) -> Iterator[ParsedLogLine]:
        """Execute a grep pipeline across multiple sessions"""
        log_files = self.session_manager.get_log_files(
            session_ids=session_ids,
            components=components,
            log_types=log_types,
            file_patterns=file_patterns
        )
        
        if not log_files:
            return
        
        results_count = 0
        
        for log_file in log_files:
            if max_results and results_count >= max_results:
                break
            
            try:
                remaining = (max_results - results_count) if max_results else None
                for parsed_line in self._grep_file(pipeline, log_file, remaining):
                    yield parsed_line
                    results_count += 1
                    if max_results and results_count >= max_results:
                        break
            except Exception as e:
                logger.error(f"Error processing file {log_file.absolute_path}: {e}")
    
    def _grep_file(
        self,
        pipeline: GrepPipeline,
        log_file: LogFile,
        max_results: int
    ) -> Iterator[ParsedLogLine]:
        """Grep a single file and yield parsed lines"""
        file_path = log_file.absolute_path
        
        if not os.path.exists(file_path):
            return
        
        if self._rg_available and len(pipeline.steps) == 1 and pipeline.steps[0].is_regex:
            yield from self._grep_with_ripgrep(pipeline, log_file, max_results)
        else:
            yield from self._grep_with_python(pipeline, log_file, max_results)
    
    def _grep_with_ripgrep(
        self,
        pipeline: GrepPipeline,
        log_file: LogFile,
        max_results: int
    ) -> Iterator[ParsedLogLine]:
        """Use ripgrep for fast searching"""
        step = pipeline.steps[0]
        
        cmd = ['rg', '--no-heading', '--line-number', '--with-filename']
        
        if step.is_case_insensitive:
            cmd.append('-i')
        if step.is_inverse:
            cmd.append('-v')
        
        if max_results:
            cmd.extend(["-m", str(max_results)])
        cmd.append(step.pattern)
        cmd.append(log_file.absolute_path)
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            for line in result.stdout.splitlines():
                if not line.strip():
                    continue
                
                parts = line.split(':', 2)
                if len(parts) >= 3:
                    try:
                        line_num = int(parts[1])
                        content = parts[2]
                        
                        parsed = self.parser.parse_line(
                            content,
                            line_num,
                            log_file.session_id,
                            log_file.absolute_path,
                            log_file.config
                        )
                        yield parsed
                    except ValueError:
                        continue
                        
        except subprocess.TimeoutExpired:
            logger.warning(f"Ripgrep timeout on {log_file.absolute_path}")
        except Exception as e:
            logger.error(f"Ripgrep error: {e}")
    
    def _grep_with_python(
        self,
        pipeline: GrepPipeline,
        log_file: LogFile,
        max_results: int
    ) -> Iterator[ParsedLogLine]:
        """Use Python regex for searching (fallback)"""
        compiled_steps = []
        for step in pipeline.steps:
            flags = re.IGNORECASE if step.is_case_insensitive else 0
            try:
                if step.is_regex:
                    pattern = re.compile(step.pattern, flags)
                else:
                    pattern = re.compile(re.escape(step.pattern), flags)
                compiled_steps.append((pattern, step.is_inverse))
            except re.error as e:
                logger.error(f"Invalid regex pattern '{step.pattern}': {e}")
                return
        
        results_count = 0
        
        try:
            with open(log_file.absolute_path, 'r', errors='replace') as f:
                for line_num, line in enumerate(f, 1):
                    if max_results and results_count >= max_results:
                        break
                    
                    matches = True
                    for pattern, is_inverse in compiled_steps:
                        found = bool(pattern.search(line))
                        if is_inverse:
                            found = not found
                        if not found:
                            matches = False
                            break
                    
                    if matches:
                        parsed = self.parser.parse_line(
                            line.rstrip('\n'),
                            line_num,
                            log_file.session_id,
                            log_file.absolute_path,
                            log_file.config
                        )
                        yield parsed
                        results_count += 1
                        
        except Exception as e:
            logger.error(f"Error reading file {log_file.absolute_path}: {e}")


# ============================================================================
# CLUSTERING ENGINE - ADAPTIVE MULTI-ALGORITHM
# ============================================================================

@dataclass
class ClusterResult:
    """Result of clustering grep matches"""
    cluster_id: str
    template: str
    algorithm: str  # Which algorithm was used
    severity: str
    count: int
    sessions: Dict[str, int]
    files: Dict[str, int]
    components: Set[str]
    time_range: Dict[str, Optional[str]]
    exception_class: Optional[str]
    samples: List[ParsedLogLine]
    log_indices: List[int]


@dataclass
class ClusteringResult:
    """Complete clustering result"""
    clusters: List[ClusterResult]
    total_lines: int
    total_clusters: int
    by_session: Dict[str, int]
    by_component: Dict[str, int]
    by_severity: Dict[str, int]
    by_algorithm: Dict[str, int]  # NEW: Track which algorithms were used
    processing_time_ms: float


class ClusteringEngine:
    """
    Adaptive multi-algorithm clustering engine.
    
    Automatically selects the best algorithm based on:
    - Log component (sidekiq, rails, postgresql, etc.)
    - Log format (JSON, syslog, plain text)
    - Presence of exception data
    """
    
    def __init__(self):
        # Component-specific clusterers
        self.clusterers: Dict[str, AdaptiveClusterer] = {}
        
        # GitLab intelligence enricher
        self.gitlab_enricher = GitLabLogEnricher() if GITLAB_INTELLIGENCE_AVAILABLE else None
    
    def cluster_lines(
        self,
        lines: List[ParsedLogLine],
        max_samples_per_cluster: int = 5
    ) -> ClusteringResult:
        """
        Cluster parsed log lines using adaptive multi-algorithm approach.
        
        This is the MAIN FIX: We use different algorithms for different log types!
        """
        start_time = datetime.now()
        
        # Reset clusterers
        self.clusterers = {}
        
        # Group lines by component for component-specific clustering
        lines_by_component: Dict[str, List[Tuple[int, ParsedLogLine]]] = defaultdict(list)
        for idx, line in enumerate(lines):
            lines_by_component[line.component].append((idx, line))
        
        # Cluster each component separately with appropriate algorithm
        all_clusters: Dict[str, Dict[str, Any]] = {}
        algorithm_usage = Counter()
        
        for component, component_lines in lines_by_component.items():
            # Get log format from first line
            log_format = "json" if component_lines[0][1].is_json else "unknown"
            
            # Create component-specific clusterer
            clusterer = AdaptiveClusterer(component=component, log_format=log_format)
            self.clusterers[component] = clusterer
            
            # Cluster all lines for this component
            for idx, line in component_lines:
                cluster_id, algorithm = clusterer.add_log(
                    message=line.message,
                    log_idx=idx,
                    exception_class=line.exception_class,
                    is_json=line.is_json
                )
                
                algorithm_usage[algorithm] += 1
                
                # Track cluster metadata
                if cluster_id not in all_clusters:
                    all_clusters[cluster_id] = {
                        'algorithm': algorithm,
                        'severity': line.severity or 'UNKNOWN',
                        'count': 0,
                        'sessions': defaultdict(int),
                        'files': defaultdict(int),
                        'components': set(),
                        'exception_class': line.exception_class,
                        'samples': [],
                        'log_indices': [],
                        'first_timestamp': line.timestamp,
                        'last_timestamp': line.timestamp,
                    }
                
                cluster = all_clusters[cluster_id]
                cluster['count'] += 1
                cluster['sessions'][line.session_id] += 1
                cluster['files'][line.relative_path] += 1
                cluster['components'].add(line.component)
                cluster['log_indices'].append(idx)
                
                if line.timestamp:
                    if cluster['first_timestamp'] is None or line.timestamp < cluster['first_timestamp']:
                        cluster['first_timestamp'] = line.timestamp
                    if cluster['last_timestamp'] is None or line.timestamp > cluster['last_timestamp']:
                        cluster['last_timestamp'] = line.timestamp
                
                if line.severity:
                    cluster['severity'] = self._max_severity(cluster['severity'], line.severity)
                
                if len(cluster['samples']) < max_samples_per_cluster:
                    cluster['samples'].append(line)
        
        # Get templates from clusterers
        for component, clusterer in self.clusterers.items():
            component_clusters = clusterer.get_all_clusters()
            for cluster_id, cluster_info in component_clusters.items():
                if cluster_id in all_clusters:
                    all_clusters[cluster_id]['template'] = cluster_info.template
        
        # Convert to ClusterResult objects
        cluster_results = []
        for cluster_id, data in all_clusters.items():
            cluster_results.append(ClusterResult(
                cluster_id=cluster_id,
                template=data.get('template', cluster_id),
                algorithm=data['algorithm'],
                severity=data['severity'],
                count=data['count'],
                sessions=dict(data['sessions']),
                files=dict(data['files']),
                components=data['components'],
                time_range={
                    'first': data['first_timestamp'],
                    'last': data['last_timestamp']
                },
                exception_class=data['exception_class'],
                samples=data['samples'],
                log_indices=data['log_indices'][:100]
            ))
        
        # SMART SORTING: Priority-based, not just by count!
        if self.gitlab_enricher:
            # Calculate priority for each cluster
            for cluster in cluster_results:
                try:
                    # Get GitLab metadata from first sample
                    if cluster.samples and hasattr(cluster.samples[0], 'gitlab_metadata') and cluster.samples[0].gitlab_metadata:
                        priority = self.gitlab_enricher.get_cluster_priority(
                            cluster.samples[0].gitlab_metadata,
                            list(cluster.components)[0] if cluster.components else 'unknown',
                            cluster.severity
                        )
                    else:
                        # Fallback to severity-based priority
                        severity_scores = {'CRITICAL': 100, 'FATAL': 100, 'ERROR': 80, 'WARNING': 50, 'INFO': 20, 'DEBUG': 10}
                        priority = severity_scores.get(cluster.severity, 0)
                    
                    # Store priority for sorting
                    cluster.priority = priority
                except Exception as e:
                    # Fallback priority
                    logger.debug(f"Priority calculation failed: {e}")
                    cluster.priority = 0
            
            # Sort by priority first, then count
            cluster_results.sort(key=lambda x: (getattr(x, 'priority', 0), x.count), reverse=True)
        else:
            # Fallback: Sort by count only
            cluster_results.sort(key=lambda x: x.count, reverse=True)
        
        # Assign sequential IDs
        for idx, cluster in enumerate(cluster_results):
            cluster.cluster_id = f"C{idx+1:04d}"
        
        # Statistics
        by_session = defaultdict(int)
        by_component = defaultdict(int)
        by_severity = defaultdict(int)
        
        for line in lines:
            by_session[line.session_id] += 1
            by_component[line.component] += 1
            if line.severity:
                by_severity[line.severity] += 1
        
        processing_time = (datetime.now() - start_time).total_seconds() * 1000
        
        return ClusteringResult(
            clusters=cluster_results,
            total_lines=len(lines),
            total_clusters=len(cluster_results),
            by_session=dict(by_session),
            by_component=dict(by_component),
            by_severity=dict(by_severity),
            by_algorithm=dict(algorithm_usage),
            processing_time_ms=processing_time
        )
    
    def _max_severity(self, sev1: str, sev2: str) -> str:
        """Return the higher severity level"""
        severity_order = {
            'CRITICAL': 5,
            'FATAL': 5,
            'ERROR': 4,
            'WARNING': 3,
            'WARN': 3,
            'INFO': 2,
            'DEBUG': 1,
            'UNKNOWN': 0
        }
        
        s1 = severity_order.get(sev1.upper(), 0)
        s2 = severity_order.get(sev2.upper(), 0)
        
        return sev1 if s1 >= s2 else sev2


# ============================================================================
# DUO AI INTEGRATION (keeping existing implementation)
# ============================================================================

@dataclass
class DuoAnalysisRequest:
    """Request for Duo AI analysis"""
    cluster_id: str
    template: str
    algorithm: str
    severity: str
    count: int
    component: str
    sessions: List[str]
    samples: List[Dict[str, Any]]
    exception_class: Optional[str] = None
    user_question: Optional[str] = None


@dataclass
class DuoAnalysisResult:
    """Result from Duo AI analysis"""
    cluster_id: str
    status: str
    response: Optional[str] = None
    error: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class DuoAnalyzer:
    """Integration with GitLab Duo for AI-powered log analysis"""
    
    def __init__(self, gitlab_token: Optional[str] = None, gitlab_url: Optional[str] = None):
        self.gitlab_token = gitlab_token or os.environ.get('GITLAB_TOKEN')
        self.gitlab_url = gitlab_url or os.environ.get('GITLAB_URL', 'https://gitlab.com')
        self.enabled = bool(self.gitlab_token)
        
        self._last_call_time = None
        self._min_interval = 0.5
        self._cache: Dict[str, DuoAnalysisResult] = {}
    
    def build_analysis_prompt(self, request: DuoAnalysisRequest) -> str:
        """Build a prompt for Duo analysis"""
        samples_text = ""
        for i, sample in enumerate(request.samples[:3], 1):
            raw = sample.get('raw', '')[:300]
            samples_text += f"\nSample {i}:\n```\n{raw}\n```\n"
        
        prompt = f"""GitLab Error Pattern Analysis

## Pattern Details
- **Pattern ID**: {request.cluster_id}
- **Component**: {request.component}
- **Clustering Algorithm**: {request.algorithm}
- **Severity**: {request.severity}
- **Occurrences**: {request.count}
- **Sessions Affected**: {', '.join(request.sessions[:5])}
{f'- **Exception Class**: {request.exception_class}' if request.exception_class else ''}

## Error Template
```
{request.template}
```

## Sample Log Lines
{samples_text}

## Analysis Request
{request.user_question or 'Analyze this error pattern and provide:'}

1. **Root Cause**: What is causing this error?
2. **Impact Assessment**: How severe is this?
3. **Resolution Steps**: Provide specific commands and configuration changes.
4. **Prevention**: How to prevent this in the future?

Please be technical and specific to GitLab."""

        if len(prompt) > 3500:
            prompt = prompt[:3500] + "\n\n[Truncated for length]"
        
        return prompt
    
    async def analyze_cluster(self, request: DuoAnalysisRequest) -> DuoAnalysisResult:
        """Analyze a single cluster using Duo API"""
        if not self.enabled:
            return DuoAnalysisResult(
                cluster_id=request.cluster_id,
                status='failed',
                error='GitLab Duo not configured. Set GITLAB_TOKEN environment variable.'
            )
        
        cache_key = f"{request.cluster_id}:{request.template[:50]}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        if self._last_call_time:
            elapsed = (datetime.now() - self._last_call_time).total_seconds()
            if elapsed < self._min_interval:
                await asyncio.sleep(self._min_interval - elapsed)
        
        try:
            import aiohttp
            
            prompt = self.build_analysis_prompt(request)
            
            url = f"{self.gitlab_url}/api/v4/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.gitlab_token}",
                "Content-Type": "application/json"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json={"content": prompt},
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as response:
                    self._last_call_time = datetime.now()
                    
                    if response.status in [200, 201]:
                        result_text = await response.text()
                        
                        result = DuoAnalysisResult(
                            cluster_id=request.cluster_id,
                            status='completed',
                            response=result_text
                        )
                        self._cache[cache_key] = result
                        return result
                    else:
                        error_text = await response.text()
                        return DuoAnalysisResult(
                            cluster_id=request.cluster_id,
                            status='failed',
                            error=f"API error {response.status}: {error_text[:200]}"
                        )
                        
        except asyncio.TimeoutError:
            return DuoAnalysisResult(
                cluster_id=request.cluster_id,
                status='failed',
                error='Request timed out'
            )
        except Exception as e:
            return DuoAnalysisResult(
                cluster_id=request.cluster_id,
                status='failed',
                error=str(e)
            )
    
    async def analyze_clusters(
        self,
        clusters: List[ClusterResult],
        max_concurrent: int = 3,
        user_question: Optional[str] = None
    ) -> List[DuoAnalysisResult]:
        """Analyze multiple clusters concurrently"""
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def analyze_with_semaphore(cluster: ClusterResult) -> DuoAnalysisResult:
            async with semaphore:
                request = DuoAnalysisRequest(
                    cluster_id=cluster.cluster_id,
                    template=cluster.template,
                    algorithm=cluster.algorithm,
                    severity=cluster.severity,
                    count=cluster.count,
                    component=list(cluster.components)[0] if cluster.components else 'unknown',
                    sessions=list(cluster.sessions.keys()),
                    samples=[s.to_dict() for s in cluster.samples],
                    exception_class=cluster.exception_class,
                    user_question=user_question
                )
                return await self.analyze_cluster(request)
        
        tasks = [analyze_with_semaphore(cluster) for cluster in clusters]
        return await asyncio.gather(*tasks)


# ============================================================================
# MAIN LOGGREP ENGINE
# ============================================================================

class LogGrepEngine:
    """
    Main entry point for LogGrep functionality.
    
    NOW WITH ADAPTIVE MULTI-ALGORITHM CLUSTERING!
    """
    
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.session_manager = SessionManager(data_dir)
        self.grep_engine = GrepEngine(self.session_manager)
        self.clustering_engine = ClusteringEngine()
        self.duo_analyzer = DuoAnalyzer()
        
        self._last_grep_results: List[ParsedLogLine] = []
        self._last_clustering_result: Optional[ClusteringResult] = None
    
    def get_sessions(self) -> List[Dict[str, Any]]:
        """Get all available sessions with metadata"""
        sessions = self.session_manager.discover_sessions()
        
        return [
            {
                'session_id': s.session_id,
                'file_count': len(s.log_files),
                'components': list(set(lf.component for lf in s.log_files.values())),
                'total_size': sum(lf.size_bytes for lf in s.log_files.values()),
            }
            for s in sessions
        ]
    
    def get_components(self) -> List[Dict[str, Any]]:
        """Get available components"""
        return self.session_manager.get_available_components()
    
    def get_log_types(self) -> List[Dict[str, Any]]:
        """Get available log types (more granular than components)"""
        return self.session_manager.get_available_log_types()
    
    def execute_search(
        self,
        pipeline: List[Dict[str, Any]],
        session_ids: Optional[List[str]] = None,
        components: Optional[List[str]] = None,
        log_types: Optional[List[str]] = None,
        file_patterns: Optional[List[str]] = None,
        max_results: Optional[int] = None,
        enable_clustering: bool = True
    ) -> Dict[str, Any]:
        """Execute a search with adaptive multi-algorithm clustering"""
        start_time = datetime.now()
        
        grep_steps = [
            GrepStep(
                pattern=step['pattern'],
                is_inverse=step.get('inverse', False),
                is_case_insensitive=step.get('case_insensitive', True),
                is_regex=step.get('regex', True)
            )
            for step in pipeline
        ]
        grep_pipeline = GrepPipeline(steps=grep_steps)
        
        grep_results = list(self.grep_engine.execute_pipeline(
            grep_pipeline,
            session_ids=session_ids,
            components=components,
            log_types=log_types,
            file_patterns=file_patterns,
            max_results=max_results
        ))
        
        self._last_grep_results = grep_results
        
        clustering_result = None
        clusters_data = []
        
        if enable_clustering and grep_results:
            clustering_result = self.clustering_engine.cluster_lines(grep_results)
            self._last_clustering_result = clustering_result
            
            clusters_data = [
                {
                    'cluster_id': c.cluster_id,
                    'template': c.template,
                    'algorithm': c.algorithm,  # NEW: Show which algorithm was used
                    'severity': c.severity,
                    'count': c.count,
                    'sessions': c.sessions,
                    'files': c.files,
                    'components': list(c.components),
                    'time_range': c.time_range,
                    'exception_class': c.exception_class,
                    'samples': [s.to_dict() for s in c.samples],
                }
                for c in clustering_result.clusters
            ]
        
        processing_time = (datetime.now() - start_time).total_seconds() * 1000
        
        return {
            'success': True,
            'total_matches': len(grep_results),
            'clusters': clusters_data,
            'cluster_count': len(clusters_data),
            'statistics': {
                'by_session': clustering_result.by_session if clustering_result else {},
                'by_component': clustering_result.by_component if clustering_result else {},
                'by_severity': clustering_result.by_severity if clustering_result else {},
                'by_algorithm': clustering_result.by_algorithm if clustering_result else {},  # NEW!
            },
            'processing_time_ms': processing_time,
            'truncated': max_results and len(grep_results) >= max_results
        }
    
    async def analyze_with_duo(
        self,
        cluster_ids: List[str],
        user_question: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze specified clusters with Duo AI"""
        if not self._last_clustering_result:
            return {
                'success': False,
                'error': 'No clustering results available. Run a search first.'
            }
        
        clusters_to_analyze = [
            c for c in self._last_clustering_result.clusters
            if c.cluster_id in cluster_ids
        ]
        
        if not clusters_to_analyze:
            return {
                'success': False,
                'error': f'No matching clusters found for IDs: {cluster_ids}'
            }
        
        results = await self.duo_analyzer.analyze_clusters(
            clusters_to_analyze,
            user_question=user_question
        )
        
        return {
            'success': True,
            'analyses': [
                {
                    'cluster_id': r.cluster_id,
                    'status': r.status,
                    'response': r.response,
                    'error': r.error,
                    'timestamp': r.timestamp
                }
                for r in results
            ]
        }
    
    def get_raw_lines(
        self,
        cluster_id: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get raw log lines for a specific cluster"""
        if not self._last_clustering_result:
            return []
        
        cluster = None
        for c in self._last_clustering_result.clusters:
            if c.cluster_id == cluster_id:
                cluster = c
                break
        
        if not cluster:
            return []
        
        lines = []
        for idx in cluster.log_indices[:limit]:
            if idx < len(self._last_grep_results):
                lines.append(self._last_grep_results[idx].to_dict())
        
        return lines


# ============================================================================
# FASTAPI INTEGRATION
# ============================================================================

def create_loggrep_routes(app, engine: LogGrepEngine):
    """Create FastAPI routes for LogGrep functionality"""
    from fastapi import APIRouter, HTTPException
    from pydantic import BaseModel
    from typing import List, Optional
    
    router = APIRouter(prefix="/api/loggrep", tags=["loggrep"])
    
    class SearchRequest(BaseModel):
        pipeline: List[dict]
        session_ids: Optional[List[str]] = None
        components: Optional[List[str]] = None
        log_types: Optional[List[str]] = None
        file_patterns: Optional[List[str]] = None
        max_results: Optional[int] = None
        enable_clustering: bool = True
    
    class AnalyzeRequest(BaseModel):
        cluster_ids: List[str]
        user_question: Optional[str] = None
    
    @router.get("/sessions")
    async def get_sessions():
        return engine.get_sessions()
    
    @router.get("/components")
    async def get_components():
        return engine.get_components()
    
    @router.get("/log-types")
    async def get_log_types():
        """Get available log types (more granular than components)"""
        return engine.get_log_types()
    
    @router.post("/search")
    async def execute_search(request: SearchRequest):
        try:
            return engine.execute_search(
                pipeline=request.pipeline,
                session_ids=request.session_ids,
                components=request.components,
                log_types=request.log_types,
                file_patterns=request.file_patterns,
                max_results=request.max_results,
                enable_clustering=request.enable_clustering
            )
        except Exception as e:
            logger.error(f"Search error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.post("/analyze")
    async def analyze_clusters(request: AnalyzeRequest):
        try:
            return await engine.analyze_with_duo(
                cluster_ids=request.cluster_ids,
                user_question=request.user_question
            )
        except Exception as e:
            logger.error(f"Analysis error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/cluster/{cluster_id}/lines")
    async def get_cluster_lines(cluster_id: str, limit: int = 100):
        return engine.get_raw_lines(cluster_id, limit)
    
    @router.post("/refresh")
    async def refresh_sessions():
        engine.session_manager.discover_sessions(force_rescan=True)
        return {"success": True, "sessions": len(engine.get_sessions())}
    
    app.include_router(router)
    return router


if __name__ == "__main__":
    import asyncio
    
    engine = LogGrepEngine(data_dir="data")
    
    sessions = engine.get_sessions()
    print(f"Found {len(sessions)} sessions")
    
    for session in sessions:
        print(f"  - {session['session_id']}: {session['file_count']} files")
    
    components = engine.get_components()
    print(f"\nAvailable components:")
    for comp in components:
        print(f"  - {comp['name']}: {comp['file_count']} files")
    
    if sessions:
        result = engine.execute_search(
            pipeline=[
                {'pattern': 'error|fail|exception', 'case_insensitive': True, 'regex': True},
            ],
            max_results=1000,
            enable_clustering=True
        )
        
        print(f"\nSearch results:")
        print(f"  Total matches: {result['total_matches']}")
        print(f"  Clusters: {result['cluster_count']}")
        print(f"  Processing time: {result['processing_time_ms']:.2f}ms")
        
        if result.get('statistics', {}).get('by_algorithm'):
            print(f"\n  Algorithm usage:")
            for algo, count in result['statistics']['by_algorithm'].items():
                print(f"    - {algo}: {count} logs")
        
        if result['clusters']:
            print(f"\nTop clusters:")
            for cluster in result['clusters'][:5]:
                print(f"  - {cluster['cluster_id']} [{cluster['algorithm']}]: {cluster['template'][:60]}... ({cluster['count']}x)")
