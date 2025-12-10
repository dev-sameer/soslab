#!/usr/bin/env python3
"""
GitLab-Specific Log Intelligence Layer
=======================================

Adds deep GitLab knowledge to the clustering engine:
- Extracts GitLab-specific metadata (correlation_id, meta.caller_id, etc.)
- Understands Sidekiq job lifecycle (start -> done/fail)
- Recognizes Gitaly gRPC patterns
- Handles Geo replication state transitions
- Tracks request flows across components

This layer sits on top of the base clustering algorithms and adds
GitLab domain knowledge for smarter clustering.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Any
from collections import defaultdict
import re


@dataclass
class GitLabLogMetadata:
    """GitLab-specific metadata extracted from logs"""
    
    # Universal fields (present in most GitLab logs)
    correlation_id: Optional[str] = None
    
    # Meta fields (Rails/Sidekiq)
    meta_caller_id: Optional[str] = None
    meta_feature_category: Optional[str] = None
    meta_user: Optional[str] = None
    meta_project: Optional[str] = None
    meta_root_namespace: Optional[str] = None
    meta_client_id: Optional[str] = None
    
    # Sidekiq-specific
    jid: Optional[str] = None  # Job ID
    queue: Optional[str] = None
    worker_class: Optional[str] = None
    job_status: Optional[str] = None  # start, done, fail
    retry_count: Optional[int] = None
    duration_s: Optional[float] = None
    scheduling_latency_s: Optional[float] = None
    
    # Gitaly/Praefect gRPC
    grpc_method: Optional[str] = None
    grpc_service: Optional[str] = None
    grpc_code: Optional[str] = None  # OK, Unavailable, DeadlineExceeded, etc.
    grpc_request_repo_storage: Optional[str] = None
    grpc_request_repo_path: Optional[str] = None
    
    # Geo-specific
    registry_id: Optional[int] = None
    model_record_id: Optional[int] = None
    replicable_name: Optional[str] = None
    sync_state_from: Optional[str] = None
    sync_state_to: Optional[str] = None
    verification_state: Optional[str] = None
    
    # Performance metrics
    db_duration_s: Optional[float] = None
    redis_calls: Optional[int] = None
    redis_duration_s: Optional[float] = None
    cpu_s: Optional[float] = None
    
    # HTTP/API
    controller: Optional[str] = None
    action: Optional[str] = None
    method: Optional[str] = None  # GET, POST, etc.
    path: Optional[str] = None
    status: Optional[int] = None  # HTTP status code


class GitLabLogEnricher:
    """
    Enriches parsed log lines with GitLab-specific intelligence.
    
    This understands:
    - Sidekiq job lifecycle patterns
    - Gitaly gRPC error codes
    - Geo replication states
    - Rails request patterns
    - Correlation ID tracking
    """
    
    def __init__(self):
        # Track job lifecycles by JID
        self.job_lifecycles: Dict[str, List[str]] = defaultdict(list)
        
        # Track correlation flows
        self.correlation_flows: Dict[str, List[str]] = defaultdict(list)
        
        # Known problematic patterns
        self.known_issues = self._build_known_issues()
    
    def extract_metadata(self, structured_data: Dict[str, Any]) -> GitLabLogMetadata:
        """Extract GitLab-specific metadata from structured log data"""
        meta = GitLabLogMetadata()
        
        # Universal fields
        meta.correlation_id = structured_data.get('correlation_id')
        
        # Meta fields (can be nested or flat)
        meta.meta_caller_id = (
            structured_data.get('meta.caller_id') or 
            structured_data.get('meta', {}).get('caller_id')
        )
        meta.meta_feature_category = (
            structured_data.get('meta.feature_category') or
            structured_data.get('meta', {}).get('feature_category')
        )
        meta.meta_user = (
            structured_data.get('meta.user') or
            structured_data.get('meta', {}).get('user')
        )
        meta.meta_project = (
            structured_data.get('meta.project') or
            structured_data.get('meta', {}).get('project')
        )
        meta.meta_root_namespace = (
            structured_data.get('meta.root_namespace') or
            structured_data.get('meta', {}).get('root_namespace')
        )
        
        # Sidekiq fields
        meta.jid = structured_data.get('jid')
        meta.queue = structured_data.get('queue')
        meta.worker_class = structured_data.get('class')
        meta.job_status = structured_data.get('job_status')
        meta.retry_count = structured_data.get('retry')
        meta.duration_s = structured_data.get('duration_s')
        meta.scheduling_latency_s = structured_data.get('scheduling_latency_s')
        
        # Gitaly/Praefect gRPC
        meta.grpc_method = (
            structured_data.get('grpc.method') or
            structured_data.get('grpc', {}).get('method')
        )
        meta.grpc_service = (
            structured_data.get('grpc.service') or
            structured_data.get('grpc', {}).get('service')
        )
        meta.grpc_code = (
            structured_data.get('grpc.code') or
            structured_data.get('grpc', {}).get('code')
        )
        meta.grpc_request_repo_storage = (
            structured_data.get('grpc.request.repoStorage') or
            structured_data.get('grpc', {}).get('request', {}).get('repoStorage')
        )
        
        # Geo fields
        meta.registry_id = structured_data.get('registry_id')
        meta.model_record_id = structured_data.get('model_record_id')
        meta.replicable_name = structured_data.get('replicable_name')
        
        # State transitions
        if 'from' in structured_data and 'to' in structured_data:
            meta.sync_state_from = structured_data.get('from')
            meta.sync_state_to = structured_data.get('to')
        
        # Performance
        meta.db_duration_s = structured_data.get('db_duration_s')
        meta.redis_calls = structured_data.get('redis_calls')
        meta.redis_duration_s = structured_data.get('redis_duration_s')
        meta.cpu_s = structured_data.get('cpu_s')
        
        # HTTP/Rails
        meta.controller = structured_data.get('controller')
        meta.action = structured_data.get('action')
        meta.method = structured_data.get('method')
        meta.path = structured_data.get('path')
        meta.status = structured_data.get('status')
        
        return meta
    
    def enrich_cluster_key(
        self, 
        base_cluster_key: str, 
        metadata: GitLabLogMetadata,
        component: str
    ) -> str:
        """
        Enhance cluster key with GitLab-specific intelligence.
        
        Examples:
        - Sidekiq jobs: Group by worker class + job_status
        - Gitaly: Group by gRPC method + code
        - Geo: Group by state transition pattern
        - Rails: Group by controller + action
        """
        
        # Sidekiq: Cluster by worker class + status
        if component == 'sidekiq' and metadata.worker_class:
            if metadata.job_status == 'fail':
                return f"sidekiq_fail:{metadata.worker_class}"
            elif metadata.job_status == 'done' and metadata.duration_s and metadata.duration_s > 60:
                return f"sidekiq_slow:{metadata.worker_class}"
            elif metadata.job_status:
                return f"sidekiq_{metadata.job_status}:{metadata.worker_class}"
        
        # Gitaly/Praefect: Cluster by gRPC method + error code
        if component in ['gitaly', 'praefect']:
            if metadata.grpc_method and metadata.grpc_code:
                if metadata.grpc_code != 'OK':
                    return f"grpc_error:{metadata.grpc_service or 'unknown'}.{metadata.grpc_method}:{metadata.grpc_code}"
                else:
                    return f"grpc_ok:{metadata.grpc_service or 'unknown'}.{metadata.grpc_method}"
        
        # Geo: Cluster by state transition
        if component == 'geo':
            if metadata.sync_state_from and metadata.sync_state_to:
                return f"geo_transition:{metadata.sync_state_from}→{metadata.sync_state_to}"
        
        # Rails: Cluster by controller + action + status
        if component == 'rails':
            if metadata.controller and metadata.action:
                if metadata.status and metadata.status >= 500:
                    return f"rails_5xx:{metadata.controller}#{metadata.action}"
                elif metadata.status and metadata.status >= 400:
                    return f"rails_4xx:{metadata.controller}#{metadata.action}"
                else:
                    return f"rails_ok:{metadata.controller}#{metadata.action}"
        
        # Fallback to base cluster key
        return base_cluster_key
    
    def _build_known_issues(self) -> Dict[str, Dict[str, Any]]:
        """
        Build a database of known GitLab issues and their patterns.
        
        This is learned from GitLab's codebase and common support issues.
        """
        return {
            # Sidekiq issues
            'sidekiq_redis_connection': {
                'pattern': r'Redis::.*Error|READONLY You can\'t write',
                'severity': 'critical',
                'description': 'Sidekiq cannot connect to Redis',
                'impact': 'Background jobs not processing',
                'resolution': 'Check Redis connectivity and failover status'
            },
            
            'sidekiq_memory_killer': {
                'pattern': r'MemoryKiller|memory exceeded|RSS.*exceeded',
                'severity': 'warning',
                'description': 'Sidekiq process killed due to memory',
                'impact': 'Jobs interrupted, may need retry',
                'resolution': 'Increase sidekiq_memory_killer_max_rss or add more Sidekiq workers'
            },
            
            # Gitaly issues
            'gitaly_unavailable': {
                'pattern': r'grpc\.code.*Unavailable|connection refused|dial.*failed',
                'severity': 'critical',
                'description': 'Gitaly server unavailable',
                'impact': 'Git operations failing',
                'resolution': 'Check Gitaly service status and network connectivity'
            },
            
            'gitaly_deadline_exceeded': {
                'pattern': r'grpc\.code.*DeadlineExceeded|context deadline exceeded',
                'severity': 'error',
                'description': 'Gitaly operation timeout',
                'impact': 'Slow Git operations',
                'resolution': 'Check Gitaly performance, disk I/O, and timeout settings'
            },
            
            # Geo issues
            'geo_sync_failed': {
                'pattern': r'Sync state transition.*to.*failed|SyncFailed',
                'severity': 'error',
                'description': 'Geo synchronization failure',
                'impact': 'Secondary site out of sync',
                'resolution': 'Check network, storage, and Geo logs for root cause'
            },
            
            'geo_verification_failed': {
                'pattern': r'Verification.*failed|checksum mismatch',
                'severity': 'error',
                'description': 'Geo verification failure',
                'impact': 'Data integrity issue on secondary',
                'resolution': 'Re-sync affected repositories'
            },
            
            # Database issues
            'pg_connection_bad': {
                'pattern': r'PG::ConnectionBad|could not connect to server',
                'severity': 'critical',
                'description': 'PostgreSQL connection failure',
                'impact': 'Application cannot access database',
                'resolution': 'Check PostgreSQL service and connection pool'
            },
            
            'pg_deadlock': {
                'pattern': r'deadlock detected|PG::DeadlockDetected',
                'severity': 'warning',
                'description': 'Database deadlock',
                'impact': 'Transaction rolled back, may retry',
                'resolution': 'Review query patterns and transaction isolation'
            },
        }
    
    def identify_issue(self, message: str, metadata: GitLabLogMetadata) -> Optional[Dict[str, Any]]:
        """Identify if this log matches a known GitLab issue"""
        for issue_key, issue_info in self.known_issues.items():
            if re.search(issue_info['pattern'], message, re.I):
                return {
                    'issue_key': issue_key,
                    **issue_info
                }
        return None
    
    def build_enhanced_template(
        self,
        base_template: str,
        metadata: GitLabLogMetadata,
        component: str
    ) -> str:
        """
        Build an enhanced template that includes GitLab context.
        
        Examples:
        - "Sidekiq job failed" -> "Geo::EventWorker failed (geo_replication)"
        - "gRPC error" -> "FindCommit failed with Unavailable (gitaly.CommitService)"
        """
        
        # Sidekiq: Add worker class and feature category
        if component == 'sidekiq' and metadata.worker_class:
            template = f"{metadata.worker_class}"
            if metadata.job_status:
                template += f" [{metadata.job_status}]"
            if metadata.meta_feature_category:
                template += f" ({metadata.meta_feature_category})"
            return template
        
        # Gitaly: Add gRPC method and service
        if component in ['gitaly', 'praefect']:
            if metadata.grpc_method:
                template = f"{metadata.grpc_method}"
                if metadata.grpc_code and metadata.grpc_code != 'OK':
                    template += f" → {metadata.grpc_code}"
                if metadata.grpc_service:
                    template += f" ({metadata.grpc_service})"
                return template
        
        # Geo: Add replicable type and state
        if component == 'geo':
            if metadata.sync_state_from and metadata.sync_state_to:
                template = f"Sync: {metadata.sync_state_from} → {metadata.sync_state_to}"
                if metadata.replicable_name:
                    template += f" ({metadata.replicable_name})"
                return template
        
        # Rails: Add controller and action
        if component == 'rails':
            if metadata.controller and metadata.action:
                template = f"{metadata.controller}#{metadata.action}"
                if metadata.status:
                    template += f" [{metadata.status}]"
                if metadata.meta_feature_category:
                    template += f" ({metadata.meta_feature_category})"
                return template
        
        # Fallback to base template
        return base_template
    
    def should_merge_clusters(
        self,
        cluster1_meta: GitLabLogMetadata,
        cluster2_meta: GitLabLogMetadata,
        component: str
    ) -> bool:
        """
        Determine if two clusters should be merged based on GitLab semantics.
        
        For example:
        - Same Sidekiq worker with different JIDs -> MERGE
        - Same gRPC method with different correlation IDs -> MERGE
        - Different Geo state transitions -> DON'T MERGE
        """
        
        # Sidekiq: Merge if same worker class and status
        if component == 'sidekiq':
            if (cluster1_meta.worker_class == cluster2_meta.worker_class and
                cluster1_meta.job_status == cluster2_meta.job_status):
                return True
        
        # Gitaly: Merge if same gRPC method and error code
        if component in ['gitaly', 'praefect']:
            if (cluster1_meta.grpc_method == cluster2_meta.grpc_method and
                cluster1_meta.grpc_code == cluster2_meta.grpc_code):
                return True
        
        # Geo: Merge if same state transition
        if component == 'geo':
            if (cluster1_meta.sync_state_from == cluster2_meta.sync_state_from and
                cluster1_meta.sync_state_to == cluster2_meta.sync_state_to):
                return True
        
        return False
    
    def get_cluster_priority(
        self,
        metadata: GitLabLogMetadata,
        component: str,
        severity: str
    ) -> int:
        """
        Assign priority score to clusters for sorting.
        
        Higher score = more important to investigate.
        """
        score = 0
        
        # Base severity score
        severity_scores = {
            'CRITICAL': 100,
            'FATAL': 100,
            'ERROR': 80,
            'WARNING': 50,
            'WARN': 50,
            'INFO': 20,
            'DEBUG': 10
        }
        score += severity_scores.get(severity, 0)
        
        # Sidekiq: Failed jobs are high priority
        if component == 'sidekiq':
            if metadata.job_status == 'fail':
                score += 50
            # Slow jobs (>60s) are medium priority
            if metadata.duration_s and metadata.duration_s > 60:
                score += 30
            # High scheduling latency
            if metadata.scheduling_latency_s and metadata.scheduling_latency_s > 10:
                score += 20
        
        # Gitaly: gRPC errors are high priority
        if component in ['gitaly', 'praefect']:
            if metadata.grpc_code in ['Unavailable', 'DeadlineExceeded', 'Internal']:
                score += 60
            elif metadata.grpc_code and metadata.grpc_code != 'OK':
                score += 40
        
        # Geo: Sync failures are high priority
        if component == 'geo':
            if metadata.sync_state_to == 'failed':
                score += 50
            if 'verification' in (metadata.sync_state_to or '').lower():
                score += 30
        
        # Rails: 5xx errors are high priority
        if component == 'rails':
            if metadata.status and metadata.status >= 500:
                score += 70
            elif metadata.status and metadata.status >= 400:
                score += 40
            # Slow requests
            if metadata.duration_s and metadata.duration_s > 5:
                score += 30
            # DB-heavy requests
            if metadata.db_duration_s and metadata.db_duration_s > 2:
                score += 25
        
        return score
    
    def get_investigation_hints(
        self,
        metadata: GitLabLogMetadata,
        component: str,
        message: str
    ) -> List[str]:
        """
        Provide investigation hints based on GitLab knowledge.
        """
        hints = []
        
        # Sidekiq hints
        if component == 'sidekiq':
            if metadata.job_status == 'fail':
                hints.append(f"Check Sidekiq queue: {metadata.queue}")
                hints.append(f"Search for JID: {metadata.jid}")
                if metadata.meta_feature_category:
                    hints.append(f"Feature category: {metadata.meta_feature_category}")
            
            if metadata.scheduling_latency_s and metadata.scheduling_latency_s > 10:
                hints.append(f"High scheduling latency ({metadata.scheduling_latency_s}s) - check Sidekiq queue depth")
        
        # Gitaly hints
        if component in ['gitaly', 'praefect']:
            if metadata.grpc_code == 'Unavailable':
                hints.append("Gitaly server may be down or unreachable")
                hints.append("Check network connectivity and Gitaly service status")
            elif metadata.grpc_code == 'DeadlineExceeded':
                hints.append("Operation timed out - check Gitaly performance")
                hints.append("Review disk I/O and repository size")
        
        # Geo hints
        if component == 'geo':
            if metadata.sync_state_to == 'failed':
                hints.append(f"Sync failed for registry {metadata.registry_id}")
                hints.append("Check network between primary and secondary")
                hints.append("Verify storage availability on secondary")
        
        # Rails hints
        if component == 'rails':
            if metadata.status and metadata.status >= 500:
                hints.append(f"5xx error in {metadata.controller}#{metadata.action}")
                hints.append("Check application logs and database connectivity")
            
            if metadata.db_duration_s and metadata.db_duration_s > 2:
                hints.append(f"Slow database query ({metadata.db_duration_s}s)")
                hints.append("Review query performance and indexes")
        
        return hints


# Export for use in main engine
__all__ = ['GitLabLogMetadata', 'GitLabLogEnricher']
