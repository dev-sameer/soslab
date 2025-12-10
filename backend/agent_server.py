#!/usr/bin/env python3
"""
SOSLab Agent Server - GitLab Log Analysis Agent
Production-grade autonomous troubleshooting agent.

Features:
- Smart recursive file discovery
- Deep log analysis with pattern detection
- Cross-component correlation tracing
- Automatic error categorization

Author: GitLab Support Engineering
Version: 4.0.0
"""

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from collections import Counter, defaultdict
import logging
import time
import fnmatch

import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from enhanced_agent_tools import (
    enhanced_analyze_file,
    add_to_slate,
    get_slate,
    clear_slate,
    analyze_and_note,
    ENHANCED_TOOL_DEFINITIONS,
    slate_manager
)
from gitlab_error_patterns import (
    detect_log_type,
    COMPONENT_PATTERNS,
    FAST_ERROR_REGEX
)

# =============================================================================
# CONFIGURATION
# =============================================================================

LLM_TIMEOUT = 300      # 5 minutes for complex analysis
TOOL_TIMEOUT = 60      # 1 minute per tool
MAX_TURNS = 25         # Investigation depth
MAX_FILE_BYTES = 100_000_000  # 100MB max file size for analysis

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s'
)
logger = logging.getLogger("SOSLab-Agent")

# =============================================================================
# GITLAB DOMAIN KNOWLEDGE
# =============================================================================

GITLAB_LOG_KNOWLEDGE = {
    # Rails Application Logs
    "gitlab-rails": {
        "path": "var/log/gitlab/gitlab-rails",
        "files": {
            "production_json.log": "Structured Rails requests (JSON). Key fields: method, path, status, duration_s, correlation_id, exception.class, exception.message",
            "production.log": "Plain text Rails requests with SQL queries",
            "api_json.log": "API requests (JSON). Key fields: method, path, status, duration, route, user_id",
            "application_json.log": "Application events: user creation, project deletion",
            "exceptions_json.log": "All exceptions tracked by ErrorTracking. Key fields: exception.class, exception.message, exception.backtrace, correlation_id",
            "auth_json.log": "Rate limiting, protected paths, blocked requests",
            "audit_json.log": "Settings/membership changes for compliance",
            "graphql_json.log": "GraphQL queries with complexity and duration",
            "git_json.log": "Failed Git operations",
            "geo.log": "Geo replication sync attempts (Premium/Ultimate)",
            "sidekiq_client.log": "Jobs before Sidekiq processes them",
            "integrations_json.log": "Jira, Asana, webhook integrations",
            "web_hooks.log": "Webhook backoff, disable, re-enable events",
            "elasticsearch.log": "Advanced search errors (Premium/Ultimate)",
            "importer.log": "Project import progress",
            "exporter.log": "Project export progress",
            "database_load_balancing.log": "DB load balancing (Premium/Ultimate)",
        },
        "troubleshooting": "Start with exceptions_json.log for errors, production_json.log for request issues"
    },
    
    # Sidekiq Background Jobs
    "sidekiq": {
        "path": "var/log/gitlab/sidekiq",
        "files": {
            "current": "Background job processing. Key fields: class, jid, queue, job_status, duration, error_class, error_message, correlation_id",
        },
        "troubleshooting": "Check for job_status:fail, high duration, error_class fields. Common issues: timeouts, memory, DB connections"
    },
    
    # Gitaly - Git Storage
    "gitaly": {
        "path": "var/log/gitlab/gitaly",
        "files": {
            "current": "Git RPC operations. Key fields: grpc.method, grpc.code, grpc.time_ms, correlation_id, error",
            "gitaly_hooks.log": "Git hooks and GitLab API responses",
        },
        "troubleshooting": "Look for grpc.code != OK, high grpc.time_ms, connection errors"
    },
    
    # Praefect - Gitaly Cluster
    "praefect": {
        "path": "var/log/gitlab/praefect",
        "files": {
            "current": "Gitaly cluster routing. Key fields: grpc.method, virtual_storage, correlation_id, error, msg",
        },
        "troubleshooting": "Check for replication lag, node health, dial failures. Also check praefect_check file"
    },
    
    # PostgreSQL Database
    "postgresql": {
        "path": "var/log/gitlab/postgresql",
        "files": {
            "current": "Database logs. Look for: LOG, ERROR, FATAL, PANIC, slow queries (duration > 1000ms)",
        },
        "troubleshooting": "If Patroni is used, logs are in patroni/current instead. Check for connection errors, deadlocks, slow queries"
    },
    
    # Patroni - PostgreSQL HA
    "patroni": {
        "path": "var/log/gitlab/patroni",
        "files": {
            "current": "PostgreSQL HA cluster. Key fields: state, role, action, timeline",
        },
        "troubleshooting": "Check for failover events, timeline changes, role switches, connection to consul/etcd"
    },
    
    # PgBouncer - Connection Pooling
    "pgbouncer": {
        "path": "var/log/gitlab/pgbouncer",
        "files": {
            "current": "Connection pooling logs",
        },
        "troubleshooting": "Check for pool exhaustion, connection errors, client wait times"
    },
    
    # Nginx Web Server
    "nginx": {
        "path": "var/log/gitlab/nginx",
        "files": {
            "gitlab_access.log": "All HTTP requests to GitLab",
            "gitlab_error.log": "Nginx errors for GitLab",
            "gitlab_pages_access.log": "Pages static site requests",
            "gitlab_registry_access.log": "Container registry requests",
        },
        "troubleshooting": "Check for 502/504 errors (upstream timeout), high response times"
    },
    
    # Workhorse - Git HTTP
    "workhorse": {
        "path": "var/log/gitlab/gitlab-workhorse",
        "files": {
            "current": "Git HTTP/upload handling. Key fields: uri, status, duration_ms, correlation_id",
        },
        "troubleshooting": "Check for upload failures, Git operation errors, timeout issues"
    },
    
    # Puma Application Server
    "puma": {
        "path": "var/log/gitlab/puma",
        "files": {
            "puma_stdout.log": "Puma standard output",
            "puma_stderr.log": "Puma errors and worker issues",
        },
        "troubleshooting": "Check for worker crashes, memory issues, slow requests"
    },
    
    # Redis Cache
    "redis": {
        "path": "var/log/gitlab/redis",
        "files": {
            "current": "Redis cache/queue logs",
        },
        "troubleshooting": "Check for memory issues, connection refused, slow commands"
    },
    
    # Redis Sentinel
    "sentinel": {
        "path": "var/log/gitlab/sentinel",
        "files": {
            "current": "Redis HA sentinel logs",
        },
        "troubleshooting": "Check for failover events, quorum issues"
    },
    
    # Consul Service Discovery
    "consul": {
        "path": "var/log/gitlab/consul",
        "files": {
            "current": "Service discovery and health checks",
        },
        "troubleshooting": "Check for leader election, service registration failures"
    },
    
    # Container Registry
    "registry": {
        "path": "var/log/gitlab/registry",
        "files": {
            "current": "Container registry operations",
        },
        "troubleshooting": "Check for push/pull failures, auth errors, storage issues"
    },
    
    # GitLab Pages
    "pages": {
        "path": "var/log/gitlab/gitlab-pages",
        "files": {
            "current": "Static site serving",
        },
        "troubleshooting": "Check for domain resolution, certificate issues"
    },
    
    # GitLab Shell
    "gitlab-shell": {
        "path": "var/log/gitlab/gitlab-shell",
        "files": {
            "gitlab-shell.log": "SSH access and Git over SSH. Key fields: command, gl_project_path, user_id",
        },
        "troubleshooting": "Check for SSH auth failures, Git command errors"
    },
    
    # KAS - Kubernetes Agent
    "kas": {
        "path": "var/log/gitlab/gitlab-kas",
        "files": {
            "current": "Kubernetes agent server logs",
        },
        "troubleshooting": "Check for agent connection issues, tunnel errors"
    },
    
    # Prometheus Metrics
    "prometheus": {
        "path": "var/log/gitlab/prometheus",
        "files": {
            "current": "Metrics collection logs",
        },
        "troubleshooting": "Check for scrape failures, storage issues"
    },
    
    # Alertmanager
    "alertmanager": {
        "path": "var/log/gitlab/alertmanager",
        "files": {
            "current": "Alert routing and notification logs",
        },
        "troubleshooting": "Check for notification failures, silencing issues"
    },
    
    # Grafana
    "grafana": {
        "path": "var/log/gitlab/grafana",
        "files": {
            "current": "Dashboard and visualization logs",
        },
        "troubleshooting": "Check for datasource errors, dashboard loading issues"
    },
    
    # Mailroom
    "mailroom": {
        "path": "var/log/gitlab/mailroom",
        "files": {
            "current": "Incoming email processing",
        },
        "troubleshooting": "Check for IMAP connection issues, email parsing errors"
    },
    
    # Geo Secondary Logs
    "geo-logcursor": {
        "path": "var/log/gitlab/geo-logcursor",
        "files": {
            "current": "Geo event log cursor (secondary site)",
        },
        "troubleshooting": "Check for replication lag, event processing errors"
    },
    
    # Geo PostgreSQL
    "geo-postgresql": {
        "path": "var/log/gitlab/geo-postgresql",
        "files": {
            "current": "Geo tracking database logs",
        },
        "troubleshooting": "Check for sync status, tracking DB errors"
    },
}

# Request flow through GitLab components (for correlation tracing)
GITLAB_REQUEST_FLOW = [
    "nginx → workhorse → puma/rails → gitaly → postgresql",
    "nginx → workhorse → puma/rails → sidekiq → gitaly",
    "For Git SSH: gitlab-shell → gitaly → postgresql"
]

# Common troubleshooting patterns
GITLAB_TROUBLESHOOTING_GUIDE = {
    "500_errors": "Check: exceptions_json.log, production_json.log, sidekiq/current",
    "slow_requests": "Check: production_json.log (duration_s), gitaly (grpc.time_ms), postgresql (slow queries)",
    "git_operations": "Check: gitaly/current, gitlab-shell.log, workhorse/current",
    "ci_cd": "Check: sidekiq/current (Ci:: workers), production_json.log (CI endpoints)",
    "geo_replication": "Check: geo.log, geo-logcursor/current, geo-postgresql/current",
    "authentication": "Check: auth_json.log, production_json.log, audit_json.log",
    "database": "Check: postgresql/current OR patroni/current, pgbouncer/current",
    "registry": "Check: registry/current, nginx/gitlab_registry_*.log",
    "webhooks": "Check: web_hooks.log, sidekiq/current (WebHookWorker)",
    "s3_object_storage": "Check: exceptions_json.log for Fog/AWS errors, sidekiq for upload workers",
}

# =============================================================================
# KNOWLEDGE BASE (RAG)
# =============================================================================

RAG_AVAILABLE = False
try:
    import chromadb
    RAG_AVAILABLE = True
    logger.info("ChromaDB available")
except ImportError:
    logger.warning("ChromaDB not available - KB disabled")


class KnowledgeBase:
    """Knowledge Base with ChromaDB and Ollama embeddings"""
    
    def __init__(self, persist_directory: str = "complete_knowledge_base"):
        self.persist_directory = persist_directory
        self.embedding_model = "mxbai-embed-large:latest"
        self.ollama_url = "http://localhost:11434"
        self.client = None
        self.collection = None
        self.embedding_function = None
        self._ready = False
        self._doc_count = 0
        
        if RAG_AVAILABLE:
            self._initialize()
    
    def _initialize(self):
        from chromadb.utils import embedding_functions
        
        search_paths = [
            Path(self.persist_directory),
            Path("..") / self.persist_directory,
            Path("backend") / self.persist_directory,
            Path.cwd() / self.persist_directory,
            Path.cwd().parent / self.persist_directory,
        ]
        
        kb_path = None
        for path in search_paths:
            try:
                if path.exists() and path.is_dir():
                    if (path / "chroma.sqlite3").exists() or any(path.glob("*.bin")):
                        kb_path = path
                        break
            except:
                continue
        
        if not kb_path:
            logger.warning("Knowledge base directory not found")
            return
        
        logger.info(f"Found KB at: {kb_path}")
        
        try:
            self.embedding_function = embedding_functions.OllamaEmbeddingFunction(
                model_name=self.embedding_model,
                url=self.ollama_url
            )
            test_result = self.embedding_function(["test"])
            if not test_result:
                return
        except Exception as e:
            logger.error(f"Embedding initialization failed: {e}")
            return
        
        try:
            self.client = chromadb.PersistentClient(path=str(kb_path))
            collections = self.client.list_collections()
            if not collections:
                return
            
            self.collection = self.client.get_collection(
                name=collections[0].name,
                embedding_function=self.embedding_function
            )
            self._doc_count = self.collection.count()
            self._ready = self._doc_count > 0
            logger.info(f"KB ready: {self._doc_count} documents")
        except Exception as e:
            logger.error(f"ChromaDB error: {e}")
    
    def is_ready(self) -> bool:
        return self._ready
    
    def search(self, query: str, n_results: int = 5) -> str:
        if not self.is_ready():
            return "Knowledge base not available."
        
        # File extensions to skip (binary/image files)
        SKIP_EXTENSIONS = {'.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
                          '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav',
                          '.zip', '.tar', '.gz', '.bin', '.exe', '.dll', '.so'}
        
        try:
            # Request more results than needed so we can filter
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results * 3,  # Get extra to filter
                include=["documents", "metadatas", "distances"]
            )
            
            if not results.get('documents') or not results['documents'][0]:
                return f"No documentation found for: '{query}'"
            
            documents = results['documents'][0]
            metadatas = results['metadatas'][0] if results.get('metadatas') else [{}] * len(documents)
            distances = results['distances'][0] if results.get('distances') else [0] * len(documents)
            
            output = [f"**Knowledge Base Results: '{query}'**\n"]
            valid_count = 0
            
            for doc, meta, dist in zip(documents, metadatas, distances):
                if valid_count >= n_results:
                    break
                
                source = meta.get('file', meta.get('source', 'Unknown'))
                
                # Skip binary/image files
                source_lower = source.lower()
                if any(source_lower.endswith(ext) for ext in SKIP_EXTENSIONS):
                    continue
                
                # Skip if document looks like binary garbage
                if doc and len(doc) > 50:
                    # Check for high ratio of non-printable characters
                    printable = sum(1 for c in doc[:200] if c.isprintable() or c.isspace())
                    if printable < len(doc[:200]) * 0.7:
                        continue
                
                relevance = max(0, min(100, int((1 - dist) * 100)))
                output.append(f"**[{valid_count + 1}] {relevance}% match** | {source}")
                output.append(doc[:3000])
                output.append("-" * 40)
                valid_count += 1
            
            if valid_count == 0:
                return f"No relevant documentation found for: '{query}'"
            
            return "\n".join(output)
        except Exception as e:
            return f"Search error: {e}"
    
    def deep_search(self, topic: str) -> str:
        """Search with multiple query variations - no hardcoded expansions."""
        if not self.is_ready():
            return "Knowledge base not available."
        
        # Just search with the original query and simple variations
        queries = [topic]
        
        # Add word order variation for multi-word queries
        words = topic.split()
        if len(words) >= 2:
            queries.append(' '.join(reversed(words)))
            # Also try individual important words
            for word in words:
                if len(word) > 3:  # Skip short words
                    queries.append(word)
        
        all_results = []
        seen = set()
        
        for query in queries[:5]:
            try:
                result = self.search(query, n_results=5)
                for line in result.split('\n'):
                    key = line.strip()[:100]
                    if key and key not in seen:
                        seen.add(key)
                        all_results.append(line)
            except:
                continue
        
        if not all_results:
            return f"No documentation found for: '{topic}'"
        
        return f"**Deep Search Results: '{topic}'**\n\n" + "\n".join(all_results[:50])
    
    def get_stats(self) -> Dict:
        return {"ready": self._ready, "document_count": self._doc_count}


# =============================================================================
# SMART FILE FINDER - Recursive & Intelligent
# =============================================================================

class SmartFileFinder:
    """
    Intelligent file finder that searches recursively and tries multiple strategies.
    Never gives up easily - always tries to find what the user is looking for.
    """
    
    @staticmethod
    def find_file(name: str, search_root: Path, max_depth: int = 10) -> Optional[Path]:
        """
        Find a file by name, trying multiple strategies:
        1. Exact path from root
        2. Recursive search by exact name
        3. Recursive search by partial name match
        4. Glob pattern matching
        """
        if not search_root.exists():
            return None
        
        # Clean the name
        name = name.strip().strip('/')
        
        # Strategy 1: Exact path
        exact = search_root / name
        if exact.exists():
            return exact
        
        # Strategy 2: Just the filename, search recursively
        filename = Path(name).name
        for f in search_root.rglob(filename):
            if f.is_file():
                return f
        
        # Strategy 3: Partial match (contains the name)
        name_lower = filename.lower()
        for f in search_root.rglob("*"):
            if f.is_file() and name_lower in f.name.lower():
                return f
        
        # Strategy 4: Glob pattern
        if '*' in name or '?' in name:
            for f in search_root.rglob(name):
                if f.is_file():
                    return f
        
        # Strategy 5: Try without extension variations
        stem = Path(filename).stem
        for f in search_root.rglob(f"*{stem}*"):
            if f.is_file():
                return f
        
        return None
    
    @staticmethod
    def find_files(pattern: str, search_root: Path, max_results: int = 100) -> List[Path]:
        """Find all files matching a pattern recursively."""
        if not search_root.exists():
            return []
        
        results = []
        pattern_lower = pattern.lower().strip()
        
        # If it's a glob pattern
        if '*' in pattern or '?' in pattern:
            for f in search_root.rglob(pattern):
                if f.is_file() and not f.name.startswith('._'):
                    results.append(f)
                    if len(results) >= max_results:
                        break
        else:
            # Search for files containing the pattern
            for f in search_root.rglob("*"):
                if f.is_file() and not f.name.startswith('._'):
                    if pattern_lower in f.name.lower() or pattern_lower in str(f).lower():
                        results.append(f)
                        if len(results) >= max_results:
                            break
        
        return sorted(results, key=lambda x: -x.stat().st_size)
    
    @staticmethod
    def find_all_logs(search_root: Path, component: str = None) -> List[Path]:
        """Find all log files, optionally filtered by component."""
        if not search_root.exists():
            return []
        
        log_patterns = [
            "current", "*.log", "messages", "syslog",
            "production_json.log", "exceptions_json.log",
            "api_json.log", "application_json.log"
        ]
        
        discovered = set()
        
        # Search for each pattern
        for pattern in log_patterns:
            try:
                for f in search_root.rglob(pattern):
                    if f.is_file() and not f.name.startswith('._'):
                        # Filter by component if specified
                        if component:
                            comp_lower = component.lower()
                            # "all" means no filter
                            if comp_lower != "all" and comp_lower not in str(f).lower():
                                continue
                        discovered.add(f)
            except Exception:
                continue
        
        # Also find any file with 'log' or 'json' in the name
        try:
            for f in search_root.rglob("*"):
                if f.is_file() and not f.name.startswith('._'):
                    name_lower = f.name.lower()
                    if 'log' in name_lower or (name_lower.endswith('.json') and f.stat().st_size > 0):
                        if component and component.lower() != "all":
                            if component.lower() not in str(f).lower():
                                continue
                        discovered.add(f)
        except Exception:
            pass
        
        # Filter out non-log files
        valid_logs = []
        for f in discovered:
            if SmartFileFinder._is_log_file(f):
                valid_logs.append(f)
        
        return sorted(valid_logs, key=lambda x: -x.stat().st_size)
    
    @staticmethod
    def _is_log_file(path: Path) -> bool:
        """Check if a file is likely a log file."""
        if path.suffix in ['.gz', '.tar', '.zip', '.png', '.jpg', '.bin', '.so', '.dylib']:
            return False
        if path.stat().st_size == 0:
            return False
        name = path.name.lower()
        if name in ['current', 'messages', 'syslog']:
            return True
        if path.suffix in ['.log', '.txt', '.out']:
            return True
        if 'log' in name or 'json' in name:
            return True
        return False
    
    @staticmethod
    def get_component_logs(search_root: Path, component: str) -> List[Path]:
        """Get logs for a specific GitLab component."""
        comp_lower = component.lower()
        info = GITLAB_LOG_KNOWLEDGE.get(comp_lower, {})
        
        logs = []
        
        # Try known base path first
        base = info.get('base_path', '')
        if base:
            base_dir = search_root / base
            if base_dir.exists():
                for pattern in info.get('patterns', ['current', '*.log']):
                    if '*' in pattern:
                        logs.extend(base_dir.rglob(pattern))
                    else:
                        f = base_dir / pattern
                        if f.exists():
                            logs.append(f)
        
        # Also search by component name anywhere in path
        if not logs:
            for f in search_root.rglob("*"):
                if f.is_file() and comp_lower in str(f).lower():
                    if SmartFileFinder._is_log_file(f):
                        logs.append(f)
        
        return sorted(set(logs), key=lambda x: -x.stat().st_size)


# =============================================================================
# TOOL SYSTEM
# =============================================================================

@dataclass
class ToolParameter:
    name: str
    type: str
    description: str
    required: bool = False
    default: Any = None
    enum: List[str] = None


@dataclass 
class Tool:
    name: str
    description: str
    parameters: List[ToolParameter]
    handler: Callable
    
    def to_openai_schema(self) -> Dict:
        properties = {}
        required = []
        
        for param in self.parameters:
            prop = {"type": param.type, "description": param.description}
            if param.enum:
                prop["enum"] = param.enum
            if param.default is not None:
                prop["default"] = param.default
            properties[param.name] = prop
            if param.required:
                required.append(param.name)
        
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                }
            }
        }


# =============================================================================
# BUNDLE DISCOVERY - Makes the agent AWARE of what's actually in the bundle
# =============================================================================

@dataclass
class BundleMap:
    """
    Discovered knowledge about what's in the bundle.
    This is what makes the agent AGENTIC - it knows what exists.
    """
    sessions: Dict[str, Dict] = field(default_factory=dict)  # session_id -> {components, node_type, logs}
    components_available: set = field(default_factory=set)   # All components found across all sessions
    log_paths: Dict[str, List[str]] = field(default_factory=dict)  # component -> [list of actual paths]
    node_types: Dict[str, str] = field(default_factory=dict)  # session_id -> node type
    discovered: bool = False
    
    def get_summary(self) -> str:
        """Human-readable summary of what's in the bundle."""
        if not self.discovered:
            return "Bundle not yet discovered"
        
        lines = [f"**Bundle: {len(self.sessions)} sessions**"]
        lines.append(f"**Components:** {', '.join(sorted(self.components_available))}")
        
        # Group sessions by node type
        by_type = defaultdict(list)
        for sid, ntype in self.node_types.items():
            by_type[ntype].append(sid[:30] + "...")
        
        for ntype, sessions in sorted(by_type.items()):
            lines.append(f"  - {ntype}: {len(sessions)} nodes")
        
        return "\n".join(lines)
    
    def find_component_logs(self, user_query: str) -> List[str]:
        """
        SMART lookup: Given a user query like 'postgresql', find actual log paths.
        This is where the REASONING happens.
        """
        query_lower = user_query.lower().strip()
        
        # Direct match first
        if query_lower in self.log_paths:
            return self.log_paths[query_lower]
        
        # Semantic mappings - what the user MEANS vs what EXISTS
        SEMANTIC_MAP = {
            # PostgreSQL variants
            'postgresql': ['patroni', 'postgres', 'pgbouncer', 'postgres-exporter'],
            'postgres': ['patroni', 'postgres', 'pgbouncer', 'postgres-exporter'],
            'pg': ['patroni', 'postgres', 'pgbouncer'],
            'database': ['patroni', 'postgres', 'pgbouncer', 'praefect'],
            'db': ['patroni', 'postgres', 'pgbouncer'],
            
            # Git storage
            'git': ['gitaly', 'praefect', 'gitlab-shell', 'workhorse'],
            'repository': ['gitaly', 'praefect'],
            'repo': ['gitaly', 'praefect'],
            
            # Web/API
            'web': ['nginx', 'puma', 'workhorse', 'gitlab-rails'],
            'api': ['gitlab-rails', 'puma', 'workhorse'],
            'rails': ['gitlab-rails', 'puma', 'sidekiq'],
            
            # Background jobs
            'jobs': ['sidekiq'],
            'background': ['sidekiq'],
            'worker': ['sidekiq'],
            
            # Cache
            'cache': ['redis', 'sentinel'],
            
            # Geo
            'geo': ['geo', 'gitlab-rails', 'sidekiq', 'geotracking'],
            'replication': ['geo', 'patroni', 'praefect'],
            'sync': ['geo', 'praefect', 'gitaly'],
        }
        
        # Check semantic mappings
        candidates = SEMANTIC_MAP.get(query_lower, [query_lower])
        
        results = []
        for candidate in candidates:
            if candidate in self.log_paths:
                results.extend(self.log_paths[candidate])
        
        # Fallback: partial match on any component
        if not results:
            for comp, paths in self.log_paths.items():
                if query_lower in comp or comp in query_lower:
                    results.extend(paths)
        
        return results


class BundleDiscovery:
    """
    Discovers and indexes what's in a support bundle.
    This runs ONCE at the start and provides knowledge for all queries.
    """
    
    # GitLab component identification patterns
    COMPONENT_PATTERNS = {
        'sidekiq': ['sidekiq/current', 'sidekiq_current'],
        'gitaly': ['gitaly/current'],
        'praefect': ['praefect/current'],
        'patroni': ['patroni/current'],  # PostgreSQL HA!
        'pgbouncer': ['pgbouncer/current'],
        'postgres-exporter': ['postgres-exporter/current'],
        'consul': ['consul/current'],
        'redis': ['redis/current'],
        'sentinel': ['sentinel/current'],
        'nginx': ['nginx/gitlab_access.log', 'nginx/gitlab_error.log'],
        'puma': ['puma/puma_stdout.log', 'puma/puma_stderr.log'],
        'workhorse': ['gitlab-workhorse/current'],
        'gitlab-rails': ['gitlab-rails/production_json.log', 'gitlab-rails/exceptions_json.log'],
        'gitlab-exporter': ['gitlab-exporter/current'],
        'registry': ['registry/current'],
        'geo': ['gitlab-rails/geo.log'],
        'gitlab-shell': ['gitlab-shell/gitlab-shell.log'],
    }
    
    @classmethod
    async def discover(cls, sessions_dir: Path) -> BundleMap:
        """Discover all sessions and their components."""
        bundle_map = BundleMap()
        
        if not sessions_dir.exists():
            return bundle_map
        
        # Find all session directories
        for session_dir in sessions_dir.iterdir():
            if not session_dir.is_dir() or session_dir.name.startswith('.'):
                continue
            
            session_info = await cls._analyze_session(session_dir)
            if session_info:
                bundle_map.sessions[session_dir.name] = session_info
                bundle_map.components_available.update(session_info.get('components', []))
                bundle_map.node_types[session_dir.name] = session_info.get('node_type', 'unknown')
                
                # Index log paths by component
                for comp, paths in session_info.get('log_paths', {}).items():
                    if comp not in bundle_map.log_paths:
                        bundle_map.log_paths[comp] = []
                    bundle_map.log_paths[comp].extend(paths)
        
        bundle_map.discovered = True
        return bundle_map
    
    @classmethod
    async def _analyze_session(cls, session_dir: Path) -> Optional[Dict]:
        """Analyze a single session directory."""
        info = {
            'components': [],
            'log_paths': {},
            'node_type': 'unknown',
            'files_count': 0,
        }
        
        # Find the gitlabsos subdirectory
        gitlabsos_dir = None
        for child in session_dir.iterdir():
            if child.is_dir() and child.name.startswith('gitlabsos'):
                gitlabsos_dir = child
                break
        
        if not gitlabsos_dir:
            gitlabsos_dir = session_dir
        
        # Detect node type from session name
        session_name = session_dir.name.lower()
        if 'sidekiq' in session_name:
            info['node_type'] = 'sidekiq'
        elif 'gitaly' in session_name:
            info['node_type'] = 'gitaly'
        elif 'praefect' in session_name and 'postgres' in session_name:
            info['node_type'] = 'praefect-postgres'
        elif 'praefect' in session_name:
            info['node_type'] = 'praefect'
        elif 'postgres' in session_name or 'patroni' in session_name:
            info['node_type'] = 'postgres'
        elif 'pgbouncer' in session_name:
            info['node_type'] = 'pgbouncer'
        elif 'rails' in session_name or 'puma' in session_name:
            info['node_type'] = 'rails'
        elif 'consul' in session_name:
            info['node_type'] = 'consul'
        elif 'geo' in session_name:
            info['node_type'] = 'geo'
        
        # Find all 'current' and '.log' files
        try:
            for f in gitlabsos_dir.rglob('*'):
                if not f.is_file():
                    continue
                info['files_count'] += 1
                
                # Check if it's a log file
                if f.name == 'current' or f.suffix == '.log':
                    # Identify component from path
                    path_str = str(f)
                    for comp, patterns in cls.COMPONENT_PATTERNS.items():
                        for pattern in patterns:
                            if pattern in path_str:
                                if comp not in info['components']:
                                    info['components'].append(comp)
                                if comp not in info['log_paths']:
                                    info['log_paths'][comp] = []
                                info['log_paths'][comp].append(str(f))
                                break
        except Exception as e:
            logger.warning(f"Error analyzing session {session_dir.name}: {e}")
        
        return info if info['components'] else None


# =============================================================================
# AGENT CONTEXT
# =============================================================================

@dataclass
class AgentContext:
    """Runtime context with working memory."""
    session_path: Path
    session_id: str
    websocket: WebSocket
    kb: Optional[KnowledgeBase] = None
    sessions_dir: Optional[Path] = None  # Root directory containing all sessions
    bundle_map: Optional[BundleMap] = None  # Discovered bundle knowledge
    
    # Working memory
    findings: List[str] = field(default_factory=list)
    errors_found: Dict[str, int] = field(default_factory=dict)
    correlation_ids: List[str] = field(default_factory=list)
    files_analyzed: List[str] = field(default_factory=list)
    
    actions_taken: int = 0
    start_time: float = field(default_factory=time.time)
    
    def add_finding(self, finding: str):
        if finding and finding not in self.findings:
            self.findings.append(finding)
    
    def add_error(self, error_type: str, count: int = 1):
        self.errors_found[error_type] = self.errors_found.get(error_type, 0) + count
    
    def add_correlation_id(self, cid: str):
        if cid and cid not in self.correlation_ids:
            self.correlation_ids.append(cid)
    
    def get_summary(self) -> str:
        parts = []
        if self.findings:
            parts.append(f"Findings: {len(self.findings)}")
            for f in self.findings[-5:]:
                parts.append(f"  - {f}")
        if self.errors_found:
            parts.append(f"Errors found: {sum(self.errors_found.values())} total, {len(self.errors_found)} types")
        if self.correlation_ids:
            parts.append(f"Correlation IDs collected: {len(self.correlation_ids)}")
        return "\n".join(parts) if parts else ""


# =============================================================================
# INVESTIGATION AGENT
# =============================================================================

class InvestigationAgent:
    """
    Production-grade GitLab log analysis agent.
    Uses smart recursive search and deep analysis.
    """
    
    def __init__(self):
        self.base_url = "http://localhost:11434/v1"
        self.model = "gpt-oss:20b"
        
        # Try multiple possible session directories
        possible_dirs = [
            Path("data/extracted"),
            Path("backend/data/extracted"),
            Path("../data/extracted"),
            Path.cwd() / "data" / "extracted",
        ]
        
        self.sessions_dir = None
        for d in possible_dirs:
            resolved = d.resolve()
            if resolved.exists() and resolved.is_dir():
                self.sessions_dir = resolved
                break
        
        if not self.sessions_dir:
            self.sessions_dir = Path("data/extracted").resolve()
        
        self.conversations: Dict[str, List[Dict]] = {}
        
        self.kb = KnowledgeBase() if RAG_AVAILABLE else None
        self.kb_ready = self.kb.is_ready() if self.kb else False
        
        self.tools: Dict[str, Tool] = {}
        self._register_tools()
        
        logger.info(f"Agent initialized | Model: {self.model} | KB: {self.kb_ready} | Tools: {len(self.tools)} | Sessions: {self.sessions_dir} (exists: {self.sessions_dir.exists()})")
        
        # Bundle discovery cache
        self._bundle_map: Optional[BundleMap] = None
    
    async def _ensure_bundle_discovered(self, sessions_dir: Path) -> BundleMap:
        """Ensure bundle is discovered (cached)."""
        if self._bundle_map is None or not self._bundle_map.discovered:
            logger.info(f"Discovering bundle at {sessions_dir}...")
            self._bundle_map = await BundleDiscovery.discover(sessions_dir)
            logger.info(f"Bundle discovered: {len(self._bundle_map.sessions)} sessions, components: {self._bundle_map.components_available}")
        return self._bundle_map
    
    def _build_system_prompt(self, ctx: AgentContext) -> str:
        kb_info = "Available - use hunt_knowledge to search documentation" if self.kb_ready else "Not available"
        context_summary = ctx.get_summary()
        
        # Build log location reference
        log_ref = self._get_log_reference()
        troubleshooting_ref = self._get_troubleshooting_reference()
        
        # Bundle awareness section
        bundle_info = ""
        if ctx.bundle_map and ctx.bundle_map.discovered:
            components = sorted(ctx.bundle_map.components_available)
            bundle_info = f"""
## Bundle Discovery (WHAT'S ACTUALLY IN THIS BUNDLE)

This bundle contains **{len(ctx.bundle_map.sessions)} sessions** with these components:
**Available:** {', '.join(components)}

**IMPORTANT - Component Mapping:**
- "postgresql" → Use `patroni` (this bundle uses PostgreSQL HA!) or `pgbouncer`
- "database" → Check `patroni`, `pgbouncer`, `postgres-exporter`  
- "git"/"repository" → Check `gitaly`, `praefect`
- Log files are named `current`, NOT `component.log`

**Available log paths per component:**
{self._format_bundle_paths(ctx.bundle_map)}
"""
        
        return f"""You are a GitLab support engineer helping analyze log files from a support bundle.

## Session
- Path: {ctx.session_path.name}
- Knowledge Base: {kb_info}
{bundle_info}

## Available Tools

**Discovery:**
- `discover_bundle` - See what components are in the bundle (auto-runs on first query)

**Single Session:**
- Reading: `read_file`, `tail`, `find_file`, `list_files`, `discover_logs`
- Analysis: `analyze_file`, `cluster_errors`, `parse_backtraces`, `grep`, `search_json`
- Tracing: `trace_correlation_id`, `search_across_components`

**Multi-Session (Cluster-Wide):**
- `find_all` - Find files across ALL sessions (uses discovered bundle map)
- `analyze_all` - Analyze logs across ALL sessions, returns aggregated errors
- `grep_all` - Search for text/patterns across ALL sessions

**Troubleshooting Slate:**
- `add_to_slate(title, content, severity, source)`: Add a finding to the persistent slate
- `get_slate()`: View current slate contents
- `clear_slate()`: Clear all slate entries
- `analyze_and_note(file_path, note_title)`: Analyze AND add findings to slate

The Slate is a persistent note-taking area that survives across sessions.
Use it to accumulate findings when analyzing multiple files.
When the user asks you to analyze files and track findings, use `analyze_and_note`
or manually `add_to_slate` with your observations.

**Documentation:** `hunt_knowledge`

## GitLab Log Locations

{log_ref}

## Troubleshooting Guide

{troubleshooting_ref}

## CRITICAL Guidelines

1. **Use bundle discovery**: The bundle_map knows what exists - use it!
2. **Semantic mapping**: 
   - "postgresql" often means `patroni` (HA) or `pgbouncer` (pooling)
   - Files are named `current`, not `component.log`
3. **Path structure**: `/var/log/gitlab/<component>/current`

{f"## Progress: {context_summary}" if context_summary else ""}"""
    
    def _format_bundle_paths(self, bundle_map: BundleMap) -> str:
        """Format discovered paths for the prompt."""
        lines = []
        for comp in sorted(bundle_map.log_paths.keys())[:10]:
            paths = bundle_map.log_paths[comp]
            lines.append(f"- `{comp}`: {len(paths)} files")
        return '\n'.join(lines) if lines else "No paths discovered yet"

    def _get_log_reference(self) -> str:
        """Build compact log location reference."""
        lines = []
        for component, info in list(GITLAB_LOG_KNOWLEDGE.items())[:12]:  # Top 12 most important
            files = list(info.get('files', {}).keys())[:3]  # Top 3 files per component
            files_str = ', '.join(files) if files else 'current'
            lines.append(f"- **{component}**: {info['path']} ({files_str})")
        return '\n'.join(lines)
    
    def _get_troubleshooting_reference(self) -> str:
        """Build troubleshooting quick reference."""
        lines = []
        for issue, logs in GITLAB_TROUBLESHOOTING_GUIDE.items():
            lines.append(f"- **{issue.replace('_', ' ')}**: {logs}")
        return '\n'.join(lines)

    def _register_tools(self):
        """Register all investigation tools."""
        
        # Discovery
        self.tools["discover_logs"] = Tool(
            name="discover_logs",
            description="Find all log files in the session. Returns files grouped by GitLab component.",
            parameters=[
                ToolParameter("component", "string", 
                             "Filter by component name (e.g., 'sidekiq', 'gitaly'). Leave empty for all.", 
                             required=False, default=""),
            ],
            handler=self._tool_discover_logs
        )
        
        # Bundle Discovery - THE KEY TO BEING AGENTIC
        self.tools["discover_bundle"] = Tool(
            name="discover_bundle",
            description="Discover what components and logs are in this bundle. Returns a map of all sessions and their available log files. RUN THIS FIRST before searching for logs!",
            parameters=[],
            handler=self._tool_discover_bundle
        )
        
        self.tools["list_files"] = Tool(
            name="list_files",
            description="List files in a directory. Searches recursively if path not found directly.",
            parameters=[
                ToolParameter("path", "string", "Directory path to list", default="."),
                ToolParameter("pattern", "string", "Filter pattern (e.g., '*.log', 'exception')", required=False),
            ],
            handler=self._tool_list_files
        )
        
        self.tools["find_file"] = Tool(
            name="find_file",
            description="Find a specific file by name. Searches recursively through all directories.",
            parameters=[
                ToolParameter("name", "string", "File name or partial name to find", required=True),
            ],
            handler=self._tool_find_file
        )
        
        # Deep Analysis
        self.tools["analyze_file"] = Tool(
            name="analyze_file",
            description="Deep analysis of a log file. Scans entire file, categorizes all errors by type, extracts patterns and correlation IDs. Use this for comprehensive understanding.",
            parameters=[
                ToolParameter("file_path", "string", "File to analyze (searches recursively if not found)", required=True),
            ],
            handler=self._tool_analyze_file
        )
        
        # Troubleshooting Slate Tools
        self.tools["add_to_slate"] = Tool(
            name="add_to_slate",
            description="Add a finding to the persistent troubleshooting slate.",
            parameters=[
                ToolParameter("title", "string", "Title of the finding", required=True),
                ToolParameter("content", "string", "Detailed content/observation", required=True),
                ToolParameter("severity", "string", "Severity (info, warning, error, critical)", default="info"),
                ToolParameter("source", "string", "Source of finding (e.g., file name)", default="agent"),
            ],
            handler=self._tool_add_to_slate
        )
        
        self.tools["get_slate"] = Tool(
            name="get_slate",
            description="Get the current troubleshooting slate contents.",
            parameters=[],
            handler=self._tool_get_slate
        )
        
        self.tools["clear_slate"] = Tool(
            name="clear_slate",
            description="Clear the troubleshooting slate.",
            parameters=[],
            handler=self._tool_clear_slate
        )
        
        self.tools["analyze_and_note"] = Tool(
            name="analyze_and_note",
            description="Analyze a file and automatically add findings to the slate.",
            parameters=[
                ToolParameter("file_path", "string", "File to analyze", required=True),
                ToolParameter("note_title", "string", "Title for the slate entry", required=False),
            ],
            handler=self._tool_analyze_and_note
        )
        
        self.tools["categorize_errors"] = Tool(
            name="categorize_errors",
            description="Group all errors in a file by exception class/type with counts and samples.",
            parameters=[
                ToolParameter("file_path", "string", "File to analyze", required=True),
                ToolParameter("limit", "integer", "Max categories to show", default=20),
            ],
            handler=self._tool_categorize_errors
        )
        
        # Correlation Tracing
        self.tools["trace_correlation_id"] = Tool(
            name="trace_correlation_id",
            description="Trace a correlation ID across all log files. Shows request flow through components.",
            parameters=[
                ToolParameter("correlation_id", "string", "Correlation ID to trace", required=True),
            ],
            handler=self._tool_trace_correlation_id
        )
        
        # Search Tools
        self.tools["grep"] = Tool(
            name="grep",
            description="Search for a pattern in log files. Searches recursively.",
            parameters=[
                ToolParameter("pattern", "string", "Search pattern", required=True),
                ToolParameter("files", "string", "File/directory to search, or component name", default="."),
                ToolParameter("context", "integer", "Lines of context around matches", default=2),
                ToolParameter("max_results", "integer", "Maximum results to return", default=100),
            ],
            handler=self._tool_grep
        )
        
        self.tools["search_json"] = Tool(
            name="search_json",
            description="Search JSON log files by field value. Example: field='status', operator='=', value='500'",
            parameters=[
                ToolParameter("field", "string", "JSON field (supports nested: 'exception.class')", required=True),
                ToolParameter("operator", "string", "Comparison: =, !=, >, <, contains", default="="),
                ToolParameter("value", "string", "Value to match", required=False, default=""),
                ToolParameter("file_path", "string", "File or pattern to search", default="*.log"),
                ToolParameter("search", "string", "Alias for 'value' parameter", required=False, default=""),
            ],
            handler=self._tool_search_json
        )
        
        self.tools["search_across_components"] = Tool(
            name="search_across_components",
            description="Search for a term across all GitLab components. Shows results in request flow order.",
            parameters=[
                ToolParameter("query", "string", "Search query", required=True),
            ],
            handler=self._tool_search_across_components
        )
        
        # File Reading
        self.tools["read_file"] = Tool(
            name="read_file",
            description="Read a section of a file. Searches recursively if file not found directly.",
            parameters=[
                ToolParameter("file_path", "string", "File path", required=True),
                ToolParameter("start_line", "integer", "Starting line (1-indexed)", default=1),
                ToolParameter("num_lines", "integer", "Number of lines to read", default=200),
            ],
            handler=self._tool_read_file
        )
        
        self.tools["tail"] = Tool(
            name="tail",
            description="Show last N lines of a file.",
            parameters=[
                ToolParameter("file_path", "string", "File path", required=True),
                ToolParameter("lines", "integer", "Number of lines", default=100),
            ],
            handler=self._tool_tail
        )
        
        # Knowledge Base - Smart Search
        if self.kb_ready:
            self.tools["hunt_knowledge"] = Tool(
                name="hunt_knowledge",
                description="Aggressively search documentation until useful information is found. Extracts search terms, searches multiple rounds, follows leads from results. Use this when you need to find solutions or understand errors.",
                parameters=[
                    ToolParameter("topic", "string", "Error message, topic, or question to research", required=True),
                    ToolParameter("max_rounds", "integer", "Maximum search rounds (default 5)", default=5),
                ],
                handler=self._tool_hunt_knowledge
            )
        
        # Error Analysis - Advanced
        self.tools["cluster_errors"] = Tool(
            name="cluster_errors",
            description="Group related errors together by analyzing patterns, backtraces, and context. Shows distinct issues vs noise. Use after analyze_file to understand what's really happening.",
            parameters=[
                ToolParameter("file_path", "string", "Log file to analyze", required=True),
                ToolParameter("limit", "integer", "Max clusters to show", default=15),
            ],
            handler=self._tool_cluster_errors
        )
        
        self.tools["parse_backtraces"] = Tool(
            name="parse_backtraces",
            description="Extract and analyze stack traces from errors. Groups by code path, identifies failing components. Useful for understanding WHERE code is failing.",
            parameters=[
                ToolParameter("file_path", "string", "Log file with errors", required=True),
                ToolParameter("limit", "integer", "Max backtrace patterns to show", default=10),
            ],
            handler=self._tool_parse_backtraces
        )
        
        # Shell
        self.tools["shell"] = Tool(
            name="shell",
            description="Execute a shell command for advanced analysis (awk, sed, jq, etc).",
            parameters=[
                ToolParameter("command", "string", "Command to execute", required=True),
            ],
            handler=self._tool_shell
        )
        
        # Multi-session tools - NOW TRULY AGENTIC
        self.tools["find_all"] = Tool(
            name="find_all",
            description="Find files across ALL sessions. AGENTIC: Uses discovered bundle map for smart semantic lookup. 'postgresql' will find 'patroni' if that's what the bundle has (PostgreSQL HA). Auto-discovers bundle on first use.",
            parameters=[
                ToolParameter("pattern", "string", "Component name (postgresql, sidekiq, geo), path, or filename. Uses semantic mapping!", required=True),
            ],
            handler=self._tool_find_all
        )
        
        self.tools["analyze_all"] = Tool(
            name="analyze_all",
            description="Analyze logs across ALL sessions. AGENTIC: Auto-discovers bundle components. 'database' finds patroni/pgbouncer. Returns aggregated error summary.",
            parameters=[
                ToolParameter("pattern", "string", "Component name (uses semantic mapping) or filename", required=True),
                ToolParameter("max_files", "integer", "Maximum files to analyze (default: 20)", required=False, default=20),
            ],
            handler=self._tool_analyze_all
        )
        
        self.tools["grep_all"] = Tool(
            name="grep_all",
            description="Search for text across ALL sessions. AGENTIC: Uses bundle map for smart file filtering. 'postgresql' finds patroni logs if that's what exists.",
            parameters=[
                ToolParameter("search", "string", "Text or regex to search for", required=True),
                ToolParameter("file_pattern", "string", "Component name (uses semantic mapping) or filename pattern", required=False, default=""),
                ToolParameter("max_matches", "integer", "Maximum matches to return (default: 50)", required=False, default=50),
            ],
            handler=self._tool_grep_all
        )
    
    def get_tools_schema(self) -> List[Dict]:
        return [tool.to_openai_schema() for tool in self.tools.values()]
    
    # =========================================================================
    # TOOL IMPLEMENTATIONS
    # =========================================================================
    
    async def _tool_discover_logs(self, ctx: AgentContext, component: str = "") -> str:
        """Find all log files, optionally filtered by component."""
        # Handle "all" as meaning no filter
        if component and component.lower() == "all":
            component = ""
        
        logs = SmartFileFinder.find_all_logs(ctx.session_path, component if component else None)
        
        if not logs:
            # Try harder - search for anything that looks like a log
            all_files = list(ctx.session_path.rglob("*"))
            logs = [f for f in all_files if f.is_file() and SmartFileFinder._is_log_file(f)]
        
        if not logs:
            return f"No log files found in {ctx.session_path.name}. The session may be empty or in an unexpected format."
        
        # Group by component
        by_component = defaultdict(list)
        for log in logs:
            comp = "other"
            path_str = str(log).lower()
            for c in GITLAB_LOG_KNOWLEDGE.keys():
                if c.replace('-', '') in path_str.replace('-', '') or c in path_str:
                    comp = c
                    break
            by_component[comp].append(log)
        
        output = [f"**Found {len(logs)} log files**\n"]
        
        for comp in sorted(by_component.keys()):
            files = by_component[comp]
            info = GITLAB_LOG_KNOWLEDGE.get(comp, {})
            desc = info.get('description', '')
            
            output.append(f"\n**{comp.upper()}** ({len(files)} files){f' - {desc}' if desc else ''}")
            
            for f in sorted(files, key=lambda x: -x.stat().st_size)[:10]:
                size = self._format_size(f.stat().st_size)
                rel_path = str(f.relative_to(ctx.session_path)) if ctx.session_path in f.parents or f.parent == ctx.session_path else f.name
                output.append(f"  - `{f.name}` ({size}) - {rel_path}")
        
        return "\n".join(output)
    
    async def _tool_discover_bundle(self, ctx: AgentContext) -> str:
        """Discover what's in the bundle - THE KEY TO BEING AGENTIC."""
        if not ctx.sessions_dir or not ctx.sessions_dir.exists():
            return "No sessions directory found. Cannot discover bundle."
        
        # Run discovery (or get from cache)
        bundle_map = await self._ensure_bundle_discovered(ctx.sessions_dir)
        ctx.bundle_map = bundle_map
        
        if not bundle_map.discovered or not bundle_map.sessions:
            return "Bundle discovery failed - no sessions found."
        
        # Build comprehensive output
        output = [f"# Bundle Discovery Complete\n"]
        output.append(f"**Sessions:** {len(bundle_map.sessions)}")
        output.append(f"**Components Found:** {', '.join(sorted(bundle_map.components_available))}\n")
        
        # Group sessions by node type
        output.append("## Sessions by Node Type\n")
        by_type = defaultdict(list)
        for sid, ntype in bundle_map.node_types.items():
            by_type[ntype].append(sid)
        
        for ntype, sessions in sorted(by_type.items()):
            output.append(f"**{ntype}:** {len(sessions)} nodes")
            for sid in sessions[:3]:
                output.append(f"  - {sid[:50]}...")
            if len(sessions) > 3:
                output.append(f"  ... and {len(sessions) - 3} more")
        
        # Show available log paths per component
        output.append("\n## Log Files by Component\n")
        for comp in sorted(bundle_map.log_paths.keys()):
            paths = bundle_map.log_paths[comp]
            output.append(f"**{comp}:** {len(paths)} files")
        
        # Add usage hints
        output.append("\n## How to Search\n")
        output.append("Now you can use the discovered components:")
        output.append("- `find_all('patroni')` → Find all PostgreSQL HA logs")
        output.append("- `find_all('sidekiq')` → Find all Sidekiq logs")
        output.append("- `analyze_all('gitaly')` → Analyze all Gitaly logs")
        output.append("- `grep_all('error', 'patroni')` → Search for 'error' in Patroni logs")
        
        # Show component mapping hints
        output.append("\n## Component Mapping (IMPORTANT!)\n")
        if 'patroni' in bundle_map.components_available:
            output.append("- **PostgreSQL:** This bundle uses Patroni (HA). Use `patroni` not `postgresql`!")
        if 'pgbouncer' in bundle_map.components_available:
            output.append("- **Connection Pooling:** PgBouncer available. Use `pgbouncer`")
        if 'praefect' in bundle_map.components_available:
            output.append("- **Git Cluster:** Praefect (Gitaly Cluster) available. Use `praefect`")
        
        return "\n".join(output)
    
    async def _tool_list_files(self, ctx: AgentContext, path: str = ".", pattern: str = None) -> str:
        """List files in a directory."""
        target = None
        
        # Try to find the path
        if path and path != ".":
            # 1. Check if it's an absolute path
            abs_path = Path(path)
            if abs_path.is_absolute() and abs_path.exists():
                target = abs_path if abs_path.is_dir() else abs_path.parent
            
            # 2. Check if it's relative to sessions_dir (for cross-session navigation)
            if not target and ctx.sessions_dir:
                sessions_path = ctx.sessions_dir / path
                if sessions_path.exists():
                    target = sessions_path if sessions_path.is_dir() else sessions_path.parent
            
            # 3. Try SmartFileFinder in current session
            if not target:
                found = SmartFileFinder.find_file(path, ctx.session_path)
                if found:
                    target = found if found.is_dir() else found.parent
            
            # 4. Search for directory by name in current session
            if not target:
                for d in ctx.session_path.rglob("*"):
                    if d.is_dir() and path.lower() in d.name.lower():
                        target = d
                        break
            
            # 5. Fall back to current session root
            if not target:
                target = ctx.session_path
        else:
            target = ctx.session_path
        
        if not target.exists():
            return f"Path not found: {path}. Listing current session root instead.\n" + await self._tool_list_files(ctx, ".")
        
        items = []
        try:
            if target.is_dir():
                items = list(target.iterdir())
            else:
                items = list(target.parent.iterdir())
                target = target.parent
        except Exception as e:
            return f"Error listing directory: {e}"
        
        # Apply pattern filter
        if pattern:
            pattern_lower = pattern.lower()
            if '*' in pattern or '?' in pattern:
                items = [i for i in items if fnmatch.fnmatch(i.name.lower(), pattern_lower)]
            else:
                items = [i for i in items if pattern_lower in i.name.lower()]
        
        dirs = sorted([i for i in items if i.is_dir()], key=lambda x: x.name)[:30]
        files = sorted([i for i in items if i.is_file()], key=lambda x: -x.stat().st_size)[:50]
        
        # Show path relative to sessions_dir if outside current session
        try:
            if ctx.sessions_dir and ctx.sessions_dir in target.parents or target == ctx.sessions_dir:
                rel_path = str(target.relative_to(ctx.sessions_dir))
            elif ctx.session_path in target.parents or target == ctx.session_path:
                rel_path = str(target.relative_to(ctx.session_path))
            else:
                rel_path = str(target)
        except:
            rel_path = str(target)
        
        output = [f"**Contents of: {rel_path}**\n"]
        
        for d in dirs:
            output.append(f"[DIR] {d.name}/")
        for f in files:
            size = self._format_size(f.stat().st_size)
            output.append(f"[FILE] {f.name} ({size})")
        
        if not dirs and not files:
            output.append("(empty directory)")
        
        return "\n".join(output)
    
    async def _tool_find_file(self, ctx: AgentContext, name: str = "", **kwargs) -> str:
        """Find a file by name."""
        
        # Handle LLM hallucinating wrong parameter names
        if not name:
            name = (
                kwargs.get('file') or 
                kwargs.get('filename') or 
                kwargs.get('file_name') or 
                kwargs.get('path') or 
                kwargs.get('file_path') or
                ""
            )
        
        if not name:
            return "❌ Error: 'name' parameter is required."
        
        found = None
        
        # 1. Check if it's an absolute path
        abs_path = Path(name)
        if abs_path.is_absolute() and abs_path.exists():
            found = abs_path
        
        # 2. Check if it's relative to sessions_dir
        if not found and ctx.sessions_dir:
            sessions_path = ctx.sessions_dir / name
            if sessions_path.exists():
                found = sessions_path
        
        # 3. Fall back to SmartFileFinder
        if not found:
            found = SmartFileFinder.find_file(name, ctx.session_path)
        
        if found:
            size = self._format_size(found.stat().st_size)
            try:
                if ctx.sessions_dir and (ctx.sessions_dir in found.parents or found.parent == ctx.sessions_dir):
                    rel_path = str(found.relative_to(ctx.sessions_dir))
                elif ctx.session_path in found.parents:
                    rel_path = str(found.relative_to(ctx.session_path))
                else:
                    rel_path = str(found)
            except:
                rel_path = str(found)
            return f"**Found:** `{found.name}` ({size})\n**Path:** {rel_path}"
        
        # Try to find similar files
        similar = SmartFileFinder.find_files(f"*{name}*", ctx.session_path, max_results=10)
        if similar:
            output = [f"File '{name}' not found exactly, but found similar files:\n"]
            for f in similar[:10]:
                size = self._format_size(f.stat().st_size)
                output.append(f"  - `{f.name}` ({size})")
            return "\n".join(output)
        
        return f"File '{name}' not found. Try `discover_logs` to see available files."
    
    async def _tool_analyze_file(self, ctx: AgentContext, file_path: str = "",
                                 max_lines: int = 50000, focus: str = None, **kwargs) -> str:
        """Enhanced file analysis with real error detection."""
        
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('file?') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        # Resolve path
        resolved_path = self._resolve_path(file_path, ctx)
        if not resolved_path.exists():
            return f"❌ File not found: {file_path}"
        
        try:
            # Use the enhanced analysis
            result = await enhanced_analyze_file(
                file_path=resolved_path,
                max_lines=max_lines,
                sample_errors=15
            )
            
            if result.get('error'):
                return f"❌ Analysis failed: {result['error']}"
            
            # Format output
            summary = result.get('summary', {})
            output = []
            
            output.append(f"📊 **Analysis: {result.get('file', 'unknown')}**")
            output.append(f"   Component: {result.get('component', 'unknown')}")
            output.append(f"   Type: {'JSON log' if result.get('is_json_log') else 'Text log'}")
            output.append("")
            
            # Summary
            output.append("**Summary:**")
            output.append(f"   📄 Total lines: {summary.get('total_lines', 0):,}")
            output.append(f"   🔴 Errors: {summary.get('error_count', 0)}")
            output.append(f"   ⚠️ Warnings: {summary.get('warning_count', 0)}")
            output.append(f"   📈 Error rate: {summary.get('error_rate', '0%')}")
            output.append("")
            
            # Severity breakdown
            sev = summary.get('severity_breakdown', {})
            if sev.get('critical', 0) > 0:
                output.append(f"   🔴 CRITICAL: {sev['critical']}")
            
            # Top patterns
            patterns = summary.get('top_error_patterns', [])
            if patterns:
                output.append("")
                output.append("**Top Error Patterns:**")
                for pattern, count in patterns[:5]:
                    output.append(f"   • `{pattern}`: {count}")
            
            # Sample errors
            errors = result.get('errors', [])
            if errors:
                output.append("")
                output.append(f"**Sample Errors ({len(errors)} shown):**")
                for err in errors[:5]:
                    line_num = err.get('line_number', '?')
                    content = err.get('content', '')[:120]
                    output.append(f"   Line {line_num}: `{content}`...")
            
            # Recommendations
            recs = result.get('recommendations', [])
            if recs:
                output.append("")
                output.append("**Recommendations:**")
                for rec in recs:
                    output.append(f"   {rec}")
            
            # Health status
            health = result.get('analysis', {}).get('health', 'unknown')
            health_icon = {'critical': '🔴', 'error': '❌', 'warning': '⚠️', 'healthy': '✅'}.get(health, '❓')
            output.append("")
            output.append(f"**Health: {health_icon} {health.upper()}**")
            
            return '\n'.join(output)
            
        except Exception as e:
            return f"❌ Analysis error: {str(e)}"

    async def _tool_add_to_slate(self, ctx: AgentContext, title: str = "", content: str = "",
                                 severity: str = "info", source: str = None, **kwargs) -> str:
        """Add a finding to the troubleshooting slate."""
        
        # Handle LLM hallucinating wrong parameter names
        if not title:
            title = kwargs.get('name') or kwargs.get('heading') or "Finding"
        if not content:
            content = kwargs.get('text') or kwargs.get('body') or kwargs.get('description') or ""
        
        if not content:
            return "❌ Error: 'content' parameter is required."
        
        result = await add_to_slate(
            title=title,
            content=content,
            severity=severity,
            source=source or "agent",
            metadata={'session': ctx.session_path.name if ctx.session_path else None}
        )
        
        # Send to frontend via WebSocket!
        try:
            slate_entry = {
                'title': title,
                'content': content,
                'severity': severity,
                'source': source or "agent"
            }
            await ctx.websocket.send_json({
                "type": "slate_update",
                "action": "add",
                "entry": slate_entry
            })
        except Exception as e:
            logger.warning(f"Failed to send slate update to frontend: {e}")
        
        return f"✅ Added to slate: '{title}' (Total entries: {result['total_entries']})"


    async def _tool_get_slate(self, ctx: AgentContext) -> str:
        """Get the current troubleshooting slate contents."""
        
        result = await get_slate()
        
        if result['total_entries'] == 0:
            return "📋 Slate is empty. Use `add_to_slate` to add findings."
        
        return result['summary']


    async def _tool_clear_slate(self, ctx: AgentContext) -> str:
        """Clear the troubleshooting slate."""
        
        result = await clear_slate()
        return f"🗑️ Slate cleared. Removed {result['entries_removed']} entries."


    async def _tool_analyze_and_note(self, ctx: AgentContext, file_path: str = "",
                                      note_title: str = None, **kwargs) -> str:
        """Analyze a file and add findings to the slate."""
        
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('file?') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                kwargs.get('file_name') or
                kwargs.get('filename') or
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        resolved_path = self._resolve_path(file_path, ctx)
        if not resolved_path.exists():
            return f"❌ File not found: {file_path}"
        
        result = await analyze_and_note(
            file_path=resolved_path,
            add_to_notes=True,
            note_title=note_title
        )
        
        if result.get('error'):
            return f"❌ Analysis failed: {result['error']}"
        
        summary = result.get('summary', {})
        errors = summary.get('error_count', 0)
        warnings = summary.get('warning_count', 0)
        
        # Send to frontend via WebSocket if we added to slate
        if result.get('slate_entry'):
            try:
                entry = result['slate_entry'].get('entry', {})
                await ctx.websocket.send_json({
                    "type": "slate_update",
                    "action": "add",
                    "entry": {
                        'title': entry.get('title', note_title or f"Analysis: {resolved_path.name}"),
                        'content': entry.get('content', f"Errors: {errors}, Warnings: {warnings}"),
                        'severity': entry.get('severity', 'info'),
                        'source': str(resolved_path.name)
                    }
                })
            except Exception as e:
                logger.warning(f"Failed to send slate update to frontend: {e}")
        
        slate_added = "✅ Added to slate" if result.get('slate_entry') else "ℹ️ No issues to note"
        
        return f"""📊 **Analyzed: {result.get('file')}**
       Errors: {errors} | Warnings: {warnings}
       {slate_added}"""
        
        try:
            file_size = target.stat().st_size
            if file_size > MAX_FILE_BYTES:
                return f"File too large ({self._format_size(file_size)}). Use `grep` or `search_json` for targeted searches."
            
            with open(target, 'r', errors='ignore') as f:
                for line_num, line in enumerate(f, 1):
                    total_lines += 1
                    line = line.strip()
                    if not line:
                        continue
                    
                    # JSON log
                    if line.startswith('{'):
                        try:
                            data = json.loads(line)
                            
                            # Handle different severity field names and cases
                            # GitLab Rails uses: "severity": "ERROR"
                            # Praefect/Gitaly use: "level": "error"
                            sev_raw = data.get('severity') or data.get('level') or 'UNKNOWN'
                            sev = sev_raw.upper() if isinstance(sev_raw, str) else 'UNKNOWN'
                            severities[sev] += 1
                            
                            status = data.get('status')
                            if status:
                                status_codes[str(status)] += 1
                            
                            # Check for errors - handle multiple formats
                            is_error = (
                                sev in ['ERROR', 'FATAL', 'CRITICAL', 'WARN', 'WARNING'] or 
                                'exception' in line.lower() or
                                data.get('error_class') or
                                data.get('exception.class') or
                                isinstance(data.get('exception'), dict) or
                                (data.get('error') and isinstance(data.get('error'), str))  # Praefect error field
                            )
                            
                            if is_error:
                                error_lines += 1
                                
                                # Extract exception class - handle multiple formats
                                exc_class = None
                                
                                # Try nested exception object first (Rails style)
                                if isinstance(data.get('exception'), dict):
                                    exc_class = data['exception'].get('class')
                                
                                # Try flat fields
                                if not exc_class:
                                    exc_class = data.get('exception.class')
                                if not exc_class:
                                    exc_class = data.get('error_class')
                                if not exc_class and isinstance(data.get('error'), dict):
                                    exc_class = data['error'].get('class')
                                
                                # For praefect/gitaly style logs, use component or grpc.method as class
                                if not exc_class:
                                    component = data.get('component', '')
                                    grpc_method = data.get('grpc.method', '')
                                    if component:
                                        exc_class = component
                                    elif grpc_method:
                                        exc_class = f"grpc.{grpc_method}"
                                
                                exc_class = exc_class or 'UnknownError'
                                error_classes[exc_class] += 1
                                
                                # Extract error message - handle multiple formats
                                exc_message = None
                                if isinstance(data.get('exception'), dict):
                                    exc_message = data['exception'].get('message')
                                if not exc_message:
                                    exc_message = (
                                        data.get('exception.message') or 
                                        data.get('error_message') or 
                                        data.get('error') or  # Praefect uses 'error' field directly
                                        data.get('msg') or    # Praefect uses 'msg' field
                                        data.get('message', '')
                                    )
                                
                                if exc_class not in sample_errors:
                                    sample_errors[exc_class] = {
                                        'message': str(exc_message)[:300] if exc_message else '',
                                        'correlation_id': data.get('correlation_id', ''),
                                        'caller': data.get('meta.caller_id') or data.get('grpc.request.fullMethod') or data.get('class', ''),
                                        'path': data.get('path') or data.get('uri') or data.get('grpc.request.fullMethod', ''),
                                        'line': line_num
                                    }
                                
                                # Collect correlation ID
                                cid = data.get('correlation_id')
                                if cid:
                                    correlation_ids.append(cid)
                                    ctx.add_correlation_id(cid)
                            
                            # Track callers
                            caller = data.get('meta.caller_id') or data.get('class', '')
                            if caller:
                                callers[caller] += 1
                            
                            # Track slow requests
                            duration = data.get('duration_s') or data.get('duration', 0)
                            try:
                                if float(duration) > 5:
                                    slow_requests.append({
                                        'duration': float(duration),
                                        'path': data.get('path') or data.get('uri', ''),
                                        'correlation_id': data.get('correlation_id', '')
                                    })
                            except (ValueError, TypeError):
                                pass
                                
                        except json.JSONDecodeError:
                            pass
                    else:
                        # Plain text log
                        if any(x in line.upper() for x in ['ERROR', 'FATAL', 'EXCEPTION', 'FAILED']):
                            error_lines += 1
                            severities['ERROR'] += 1
        
        except Exception as e:
            return f"Error reading file: {e}"
        
        # Update context
        for exc_class, count in error_classes.most_common(5):
            ctx.add_error(exc_class, count)
            ctx.add_finding(f"{exc_class}: {count} occurrences")
        
        # Build report
        output = [
            f"**Analysis: {target.name}**",
            f"Total lines: {total_lines:,}",
            f"Error lines: {error_lines:,} ({100*error_lines/max(1,total_lines):.1f}%)",
            ""
        ]
        
        if severities:
            output.append("**Severity Distribution:**")
            for sev, count in severities.most_common():
                output.append(f"  - {sev}: {count:,}")
        
        if status_codes:
            output.append(f"\n**HTTP Status Codes:**")
            for status, count in status_codes.most_common(10):
                output.append(f"  - {status}: {count:,}")
        
        if error_classes:
            output.append(f"\n**Error Categories ({len(error_classes)} types):**")
            for exc_class, count in error_classes.most_common(20):
                pct = 100 * count / max(1, error_lines)
                output.append(f"\n**{exc_class}**: {count:,} ({pct:.1f}%)")
                if exc_class in sample_errors:
                    s = sample_errors[exc_class]
                    if s['message']:
                        output.append(f"  Message: `{s['message'][:200]}`")
                    if s['caller']:
                        output.append(f"  Caller: `{s['caller']}`")
                    if s['correlation_id']:
                        output.append(f"  Correlation ID: `{s['correlation_id']}`")
        
        if callers:
            output.append(f"\n**Top Callers:**")
            for caller, count in callers.most_common(10):
                output.append(f"  - {caller}: {count:,}")
        
        if slow_requests:
            slow_requests.sort(key=lambda x: -x['duration'])
            output.append(f"\n**Slow Requests (>5s): {len(slow_requests)}**")
            for req in slow_requests[:5]:
                output.append(f"  - {req['duration']:.1f}s: {req['path'][:50]}")
        
        if correlation_ids:
            unique_cids = list(dict.fromkeys(correlation_ids))[:5]
            output.append(f"\n**Correlation IDs to trace ({len(set(correlation_ids))} unique):**")
            for cid in unique_cids:
                output.append(f"  - `{cid}`")
        
        return "\n".join(output)
    
    async def _tool_categorize_errors(self, ctx: AgentContext, file_path: str = "", limit: int = 20, **kwargs) -> str:
        """Categorize errors by type."""
        
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        target = SmartFileFinder.find_file(file_path, ctx.session_path)
        
        if not target:
            return f"File not found: {file_path}"
        
        categories = Counter()
        samples = {}
        total_errors = 0
        
        try:
            with open(target, 'r', errors='ignore') as f:
                for line_num, line in enumerate(f, 1):
                    if not line.strip().startswith('{'):
                        continue
                    
                    try:
                        data = json.loads(line)
                        
                        # Handle different severity field names and cases
                        sev_raw = data.get('severity') or data.get('level') or ''
                        sev = sev_raw.upper() if isinstance(sev_raw, str) else ''
                        
                        # Check for errors - multiple formats
                        is_error = (
                            sev in ['ERROR', 'FATAL', 'CRITICAL', 'WARN', 'WARNING'] or 
                            'exception' in line.lower() or
                            isinstance(data.get('exception'), dict) or
                            (data.get('error') and isinstance(data.get('error'), str))
                        )
                        
                        if is_error:
                            total_errors += 1
                            
                            # Extract exception class - handle multiple formats
                            exc_class = None
                            if isinstance(data.get('exception'), dict):
                                exc_class = data['exception'].get('class')
                            if not exc_class:
                                exc_class = data.get('exception.class')
                            if not exc_class:
                                exc_class = data.get('error_class')
                            if not exc_class:
                                # For praefect/gitaly, use component
                                exc_class = data.get('component') or data.get('grpc.method')
                            exc_class = exc_class or 'UnknownError'
                            
                            categories[exc_class] += 1
                            
                            # Extract message - handle multiple formats
                            exc_message = None
                            if isinstance(data.get('exception'), dict):
                                exc_message = data['exception'].get('message')
                            if not exc_message:
                                exc_message = (
                                    data.get('exception.message') or 
                                    data.get('error_message') or
                                    data.get('error') or
                                    data.get('msg') or
                                    ''
                                )
                            
                            if exc_class not in samples:
                                samples[exc_class] = {
                                    'message': str(exc_message)[:300] if exc_message else '',
                                    'correlation_id': data.get('correlation_id', ''),
                                    'caller': data.get('meta.caller_id') or data.get('grpc.request.fullMethod', ''),
                                }
                    except:
                        continue
        
        except Exception as e:
            return f"Error: {e}"
        
        if not categories:
            return f"No errors found in {target.name}"
        
        # Update context
        for exc_class, count in categories.most_common(5):
            ctx.add_error(exc_class, count)
        
        output = [
            f"**Error Categories in {target.name}**",
            f"Total errors: {total_errors:,}",
            f"Unique types: {len(categories)}",
            ""
        ]
        
        for exc_class, count in categories.most_common(limit):
            pct = 100 * count / total_errors
            output.append(f"\n**{exc_class}** - {count:,} ({pct:.1f}%)")
            if exc_class in samples:
                s = samples[exc_class]
                if s['message']:
                    output.append(f"  Message: `{s['message'][:200]}`")
                if s['correlation_id']:
                    output.append(f"  Correlation ID: `{s['correlation_id']}`")
                    ctx.add_correlation_id(s['correlation_id'])
        
        return "\n".join(output)
    
    async def _tool_trace_correlation_id(self, ctx: AgentContext, correlation_id: str) -> str:
        """Trace a correlation ID across all logs."""
        logs = SmartFileFinder.find_all_logs(ctx.session_path)
        events = []
        
        for log in logs:
            try:
                cmd = f"grep -n '{correlation_id}' '{log}' 2>/dev/null | head -30"
                output = await self._run_shell(cmd, ctx.session_path, timeout=30)
                
                if output and output.strip():
                    # Determine component
                    comp = "other"
                    for c in GITLAB_LOG_KNOWLEDGE.keys():
                        if c in str(log).lower():
                            comp = c
                            break
                    
                    for line in output.strip().split('\n')[:20]:
                        ts_match = re.search(r'(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})', line)
                        ts = ts_match.group(1) if ts_match else "0000-00-00T00:00:00"
                        
                        events.append({
                            'ts': ts,
                            'comp': comp,
                            'file': log.name,
                            'line': line.strip()[:400]
                        })
            except:
                continue
        
        if not events:
            return f"No traces found for correlation ID: {correlation_id}"
        
        events.sort(key=lambda x: x['ts'])
        components = list(dict.fromkeys(e['comp'] for e in events))
        
        output = [
            f"**Request Trace: {correlation_id}**",
            f"Events: {len(events)} across {len(components)} components",
            f"Flow: {' -> '.join(components)}",
            ""
        ]
        
        current_comp = None
        for e in events[:40]:
            if e['comp'] != current_comp:
                current_comp = e['comp']
                output.append(f"\n**[{current_comp.upper()}]** - {e['file']}")
            
            # Try to parse and format nicely
            try:
                if '{' in e['line']:
                    json_start = e['line'].index('{')
                    data = json.loads(e['line'][json_start:])
                    ts = data.get('time', e['ts'])
                    msg = data.get('message', data.get('msg', ''))[:80]
                    status = data.get('status', '')
                    duration = data.get('duration_s', data.get('duration', ''))
                    
                    parts = [f"  {ts}"]
                    if status:
                        parts.append(f"status={status}")
                    if duration:
                        parts.append(f"duration={duration}s")
                    if msg:
                        parts.append(msg)
                    output.append(" | ".join(parts))
                else:
                    output.append(f"  {e['ts']} | {e['line'][:150]}")
            except:
                output.append(f"  {e['ts']} | {e['line'][:150]}")
        
        if len(events) > 40:
            output.append(f"\n... and {len(events) - 40} more events")
        
        ctx.add_finding(f"Traced {correlation_id} through {' -> '.join(components)}")
        
        return "\n".join(output)
    
    async def _tool_grep(self, ctx: AgentContext, pattern: str = "", files: str = ".", 
                         context: int = 2, max_results: int = 100, **kwargs) -> str:
        """Search for pattern in files."""
        
        # Handle LLM hallucinating wrong parameter names
        if not pattern:
            pattern = (
                kwargs.get('search') or 
                kwargs.get('query') or 
                kwargs.get('text') or 
                kwargs.get('regex') or
                ""
            )
        
        if not pattern:
            return "❌ Error: 'pattern' parameter is required."
        
        # Determine what to search
        if files == "." or not files:
            target_files = SmartFileFinder.find_all_logs(ctx.session_path)
        elif files.lower() in GITLAB_LOG_KNOWLEDGE:
            target_files = SmartFileFinder.get_component_logs(ctx.session_path, files)
        else:
            found = SmartFileFinder.find_file(files, ctx.session_path)
            if found:
                if found.is_dir():
                    target_files = SmartFileFinder.find_all_logs(found)
                else:
                    target_files = [found]
            else:
                target_files = SmartFileFinder.find_files(files, ctx.session_path)
        
        if not target_files:
            return f"No files found matching: {files}"
        
        results = []
        total_matches = 0
        
        for f in target_files[:30]:
            try:
                cmd = f"grep -n -i -C{context} '{pattern}' '{f}' 2>/dev/null | head -{max_results}"
                output = await self._run_shell(cmd, ctx.session_path, timeout=30)
                
                if output and output.strip():
                    count = output.count('\n') + 1
                    total_matches += count
                    results.append(f"**{f.name}** ({count} matches):\n```\n{output.strip()[:3000]}\n```")
                    
                    if total_matches >= max_results:
                        break
            except:
                continue
        
        if not results:
            return f"No matches for pattern: {pattern}"
        
        return f"**Search: '{pattern}'** | {total_matches} matches in {len(results)} files\n\n" + "\n\n".join(results[:10])
    
    async def _tool_search_json(self, ctx: AgentContext, field: str, value: str = "",
                                 operator: str = "=", file_path: str = "*.log",
                                 search: str = "") -> str:
        """Search JSON logs by field value."""
        # Handle LLM sometimes using 'search' instead of 'value'
        if not value and search:
            value = search
        
        if not value:
            return "Error: 'value' parameter is required. Example: search_json(field='status', value='500')"
        
        # Find files to search
        if '*' in file_path or '?' in file_path:
            files = SmartFileFinder.find_files(file_path, ctx.session_path)
        else:
            found = SmartFileFinder.find_file(file_path, ctx.session_path)
            files = [found] if found else SmartFileFinder.find_files("*json*.log", ctx.session_path)
        
        if not files:
            files = [f for f in SmartFileFinder.find_all_logs(ctx.session_path) if 'json' in f.name.lower()]
        
        results = []
        
        for f in files[:20]:
            try:
                with open(f, 'r', errors='ignore') as fp:
                    for line_num, line in enumerate(fp, 1):
                        if not line.strip().startswith('{'):
                            continue
                        try:
                            data = json.loads(line)
                            
                            # Get field value (support nested fields)
                            field_val = data
                            for key in field.split('.'):
                                if isinstance(field_val, dict):
                                    field_val = field_val.get(key)
                                else:
                                    field_val = None
                                    break
                            
                            if field_val is None:
                                continue
                            
                            # Compare
                            match = False
                            try:
                                if operator == "=":
                                    match = str(field_val).lower() == str(value).lower()
                                elif operator == "!=":
                                    match = str(field_val).lower() != str(value).lower()
                                elif operator == ">":
                                    match = float(field_val) > float(value)
                                elif operator == "<":
                                    match = float(field_val) < float(value)
                                elif operator == "contains":
                                    match = str(value).lower() in str(field_val).lower()
                            except:
                                pass
                            
                            if match:
                                results.append(f"`{f.name}:{line_num}` | {line.strip()[:250]}")
                                if len(results) >= 200:
                                    break
                        except:
                            continue
            except:
                continue
            
            if len(results) >= 200:
                break
        
        if not results:
            return f"No matches for {field} {operator} {value}"
        
        return f"**JSON Search: {field} {operator} {value}** | {len(results)} matches\n\n" + "\n".join(results[:100])
    
    async def _tool_search_across_components(self, ctx: AgentContext, query: str) -> str:
        """Search across all GitLab components."""
        results_by_comp = {}
        
        for comp in GITLAB_LOG_KNOWLEDGE.keys():
            logs = SmartFileFinder.get_component_logs(ctx.session_path, comp)
            if not logs:
                continue
            
            comp_results = []
            for log in logs[:5]:
                try:
                    cmd = f"grep -n -i -C2 '{query}' '{log}' 2>/dev/null | head -30"
                    output = await self._run_shell(cmd, ctx.session_path, timeout=15)
                    
                    if output and output.strip():
                        comp_results.append(f"`{log.name}`:\n{output.strip()[:1500]}")
                except:
                    continue
            
            if comp_results:
                results_by_comp[comp] = comp_results
        
        if not results_by_comp:
            return f"No matches for: {query}"
        
        output = [f"**Cross-Component Search: '{query}'** | Found in {len(results_by_comp)} components\n"]
        
        # Show in request flow order
        for comp in GITLAB_REQUEST_FLOW:
            if comp in results_by_comp:
                output.append(f"\n**[{comp.upper()}]**")
                for r in results_by_comp[comp][:2]:
                    output.append(r[:1200])
        
        # Then others
        for comp in results_by_comp:
            if comp not in GITLAB_REQUEST_FLOW:
                output.append(f"\n**[{comp.upper()}]**")
                for r in results_by_comp[comp][:2]:
                    output.append(r[:1200])
        
        return "\n".join(output)
    
    async def _tool_read_file(self, ctx: AgentContext, file_path: str = "", 
                               start_line: int = 1, num_lines: int = 200, **kwargs) -> str:
        """Read a section of a file."""
        
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        # Try multiple ways to find the file
        target = None
        
        # 1. Check if it's an absolute path that exists
        abs_path = Path(file_path)
        if abs_path.is_absolute() and abs_path.exists():
            target = abs_path
        
        # 2. Check if it's relative to sessions_dir (for cross-session access)
        if not target and ctx.sessions_dir:
            sessions_path = ctx.sessions_dir / file_path
            if sessions_path.exists():
                target = sessions_path
        
        # 3. Fall back to SmartFileFinder for current session
        if not target:
            target = SmartFileFinder.find_file(file_path, ctx.session_path)
        
        if not target:
            return f"File not found: {file_path}. Use `find_all` to locate files across sessions."
        
        try:
            with open(target, 'r', errors='ignore') as f:
                lines = []
                for i, line in enumerate(f, 1):
                    if i >= start_line:
                        lines.append(f"{i}: {line.rstrip()}")
                    if i >= start_line + num_lines:
                        break
                
                if not lines:
                    return f"No content at lines {start_line}-{start_line + num_lines} in {target.name}"
                
                return f"**{target.name}** (lines {start_line}-{start_line + len(lines) - 1}):\n\n" + "\n".join(lines)
        except Exception as e:
            return f"Error reading file: {e}"
    
    async def _tool_tail(self, ctx: AgentContext, file_path: str = "", lines: int = 100, **kwargs) -> str:
        """Show last N lines of a file."""
        
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        # Try multiple ways to find the file
        target = None
        
        # 1. Check if it's an absolute path
        abs_path = Path(file_path)
        if abs_path.is_absolute() and abs_path.exists():
            target = abs_path
        
        # 2. Check if it's relative to sessions_dir
        if not target and ctx.sessions_dir:
            sessions_path = ctx.sessions_dir / file_path
            if sessions_path.exists():
                target = sessions_path
        
        # 3. Fall back to SmartFileFinder
        if not target:
            target = SmartFileFinder.find_file(file_path, ctx.session_path)
        
        if not target:
            return f"File not found: {file_path}. Use `find_all` to locate files across sessions."
        
        try:
            with open(target, 'r', errors='ignore') as f:
                all_lines = f.readlines()
                content = "".join(all_lines[-lines:])
                return f"**Last {min(lines, len(all_lines))} lines of {target.name}:**\n\n{content}"
        except Exception as e:
            return f"Error: {e}"
    
    async def _tool_hunt_knowledge(self, ctx: AgentContext, topic: str = "", max_rounds: int = 5, **kwargs) -> str:
        """
        Aggressively hunt through KB until we find useful information.
        Doesn't give up after one search - extracts terms, follows leads.
        """
        # Handle LLM hallucinating wrong parameter names
        if not topic:
            topic = (
                kwargs.get('query') or 
                kwargs.get('search') or 
                kwargs.get('question') or 
                ""
            )
        
        # Handle 'limit' being used instead of 'max_rounds'
        if 'limit' in kwargs:
            max_rounds = kwargs['limit']
        
        if not topic:
            return "❌ Error: 'topic' parameter is required."
        
        if not ctx.kb or not ctx.kb.is_ready():
            return "Knowledge base not available."
        
        all_findings = []
        searched_terms = set()
        
        # Step 1: Extract initial search terms from input
        terms_to_search = self._extract_search_terms(topic)
        
        if not terms_to_search:
            terms_to_search = [topic]  # Fallback to original input
        
        round_num = 0
        while round_num < max_rounds and terms_to_search:
            round_num += 1
            current_term = terms_to_search.pop(0)
            
            # Skip if already searched
            if current_term.lower() in searched_terms:
                continue
            searched_terms.add(current_term.lower())
            
            # Search KB
            try:
                results = ctx.kb.search(current_term, n_results=5)
            except:
                continue
            
            if not results or "No documentation found" in results:
                continue
            
            # Check if results are relevant
            if self._is_result_useful(results, topic, list(searched_terms)):
                all_findings.append({
                    'term': current_term,
                    'results': results
                })
                
                # Extract new terms from this result to explore further
                new_terms = self._extract_terms_from_result(results, searched_terms)
                for t in new_terms:
                    if t.lower() not in searched_terms and t not in terms_to_search:
                        terms_to_search.append(t)
            
            # If we have enough good findings, we can stop
            if len(all_findings) >= 3:
                break
        
        # Format output
        if not all_findings:
            return f"No relevant documentation found for: '{topic}'. Searched: {', '.join(list(searched_terms)[:10])}"
        
        output = [f"**Knowledge Hunt: '{topic}'**"]
        output.append(f"Searched {len(searched_terms)} terms across {round_num} rounds\n")
        
        for finding in all_findings:
            output.append(f"---\n**Found via: '{finding['term']}'**\n")
            output.append(finding['results'][:4000])  # Limit per finding
        
        return "\n".join(output)
    
    def _extract_search_terms(self, text: str) -> List[str]:
        """Extract useful search terms from error message or topic."""
        terms = []
        
        # Extract error class (e.g., ArgumentError, SSLError, NoMethodError)
        error_classes = re.findall(r'\b([A-Z][a-z]+(?:Error|Exception|Failure))\b', text)
        terms.extend(error_classes)
        
        # Extract Ruby/GitLab class names (e.g., Gitlab::Ci::Trace, Ci::ArchiveTraceWorker)
        class_names = re.findall(r'\b([A-Z][a-z]+(?:::[A-Z][a-z]+)+)\b', text)
        for name in class_names:
            terms.append(name)
            # Also add the last part (e.g., "ArchiveTraceWorker" from "Ci::ArchiveTraceWorker")
            parts = name.split('::')
            if len(parts) > 1:
                terms.append(parts[-1])
        
        # Extract snake_case identifiers (config keys, method names)
        snake_case = re.findall(r'\b([a-z]+_[a-z_]+)\b', text.lower())
        # Filter out very common ones
        common = {'error_message', 'stack_trace', 'class_name', 'file_path'}
        terms.extend([s for s in snake_case if s not in common and len(s) > 5])
        
        # Extract quoted strings (often important identifiers)
        quoted = re.findall(r"['\"]([^'\"]+)['\"]", text)
        terms.extend([q for q in quoted if len(q) > 3 and len(q) < 50])
        
        # Extract significant standalone words (longer, not common)
        words = re.findall(r'\b([a-zA-Z]{7,})\b', text)
        common_words = {'missing', 'required', 'arguments', 'returned', 'failed', 
                        'error', 'exception', 'invalid', 'undefined', 'connection'}
        terms.extend([w for w in words if w.lower() not in common_words])
        
        # Deduplicate while preserving order
        seen = set()
        unique_terms = []
        for t in terms:
            if t.lower() not in seen:
                seen.add(t.lower())
                unique_terms.append(t)
        
        return unique_terms[:15]  # Limit to prevent too many searches
    
    def _is_result_useful(self, result: str, original_topic: str, searched_terms: List[str]) -> bool:
        """Check if search result is actually relevant."""
        result_lower = result.lower()
        topic_lower = original_topic.lower()
        
        # Check if result contains key terms from original topic
        topic_words = set(re.findall(r'\b[a-z]{4,}\b', topic_lower))
        result_words = set(re.findall(r'\b[a-z]{4,}\b', result_lower))
        
        overlap = topic_words & result_words
        
        # Result is useful if:
        # 1. Has significant overlap with topic words
        # 2. Contains configuration syntax (gitlab.rb, yml patterns)
        # 3. Contains command examples
        
        has_overlap = len(overlap) >= 2
        has_config = any(x in result_lower for x in ["gitlab.rb", "gitlab_rails[", "gitlab['", ".yml", ".yaml"])
        has_commands = any(x in result for x in ["gitlab-ctl", "gitlab-rake", "kubectl", "docker"])
        
        return has_overlap or has_config or has_commands
    
    def _extract_terms_from_result(self, result: str, already_searched: set) -> List[str]:
        """Extract new search terms from a result to explore further."""
        new_terms = []
        
        # Extract gitlab.rb configuration keys
        config_keys = re.findall(r"gitlab_rails\['([^']+)'\]", result)
        new_terms.extend(config_keys)
        
        # Extract feature/component names
        components = re.findall(r'\b(object.storage|artifacts?|registry|pages|mattermost|gitaly|praefect|consul|patroni|pgbouncer|sidekiq|puma|workhorse)\b', result.lower())
        new_terms.extend(components)
        
        # Extract documentation section references
        sections = re.findall(r'(?:see|refer to|check)\s+["\']?([^"\'.,]+)["\']?', result.lower())
        new_terms.extend([s.strip() for s in sections if len(s) > 5])
        
        # Filter out already searched
        return [t for t in new_terms if t.lower() not in already_searched][:5]
    
    async def _tool_cluster_errors(self, ctx: AgentContext, file_path: str = "", limit: int = 15, **kwargs) -> str:
        """
        Group related errors together by analyzing patterns.
        Shows distinct issues vs noise.
        """
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        target = SmartFileFinder.find_file(file_path, ctx.session_path)
        
        if not target:
            return f"File not found: {file_path}"
        
        # Collect errors with full context
        errors = []
        
        try:
            with open(target, 'r', errors='ignore') as f:
                for line_num, line in enumerate(f, 1):
                    if not line.strip().startswith('{'):
                        continue
                    
                    try:
                        data = json.loads(line)
                        
                        # Handle different severity field names and cases
                        sev_raw = data.get('severity') or data.get('level') or ''
                        sev = sev_raw.upper() if isinstance(sev_raw, str) else ''
                        
                        # Check for errors - multiple formats
                        is_error = (
                            sev in ['ERROR', 'FATAL', 'CRITICAL', 'WARN', 'WARNING'] or 
                            'exception' in line.lower() or
                            isinstance(data.get('exception'), dict) or
                            (data.get('error') and isinstance(data.get('error'), str))
                        )
                        
                        if is_error:
                            # Extract error class - handle multiple formats
                            exc_class = None
                            if isinstance(data.get('exception'), dict):
                                exc_class = data['exception'].get('class')
                            if not exc_class:
                                exc_class = data.get('exception.class') or data.get('error_class')
                            if not exc_class:
                                # For praefect/gitaly, use component
                                exc_class = data.get('component') or data.get('grpc.method')
                            exc_class = exc_class or 'UnknownError'
                            
                            # Extract message - handle multiple formats
                            exc_message = None
                            if isinstance(data.get('exception'), dict):
                                exc_message = data['exception'].get('message', '')
                            if not exc_message:
                                exc_message = (
                                    data.get('exception.message') or 
                                    data.get('error_message') or 
                                    data.get('error') or
                                    data.get('msg') or
                                    ''
                                )
                            
                            # Extract backtrace signature (top 3 frames)
                            backtrace = []
                            if isinstance(data.get('exception'), dict):
                                backtrace = data['exception'].get('backtrace', [])[:3]
                            elif isinstance(data.get('exception.backtrace'), list):
                                backtrace = data.get('exception.backtrace', [])[:3]
                            
                            backtrace_sig = '|'.join(backtrace) if backtrace else ''
                            
                            errors.append({
                                'class': exc_class,
                                'message': exc_message[:200] if exc_message else '',
                                'message_normalized': self._normalize_error_message(exc_message),
                                'backtrace_sig': backtrace_sig,
                                'caller': data.get('meta.caller_id') or data.get('grpc.request.fullMethod') or data.get('class', ''),
                                'user': data.get('meta.user') or data.get('username', ''),
                                'project': data.get('meta.project', ''),
                                'correlation_id': data.get('correlation_id', ''),
                                'line': line_num
                            })
                    except:
                        continue
        
        except Exception as e:
            return f"Error reading file: {e}"
        
        if not errors:
            return f"No errors found in {target.name}"
        
        # Cluster by: error_class + normalized_message + backtrace_signature
        clusters = defaultdict(list)
        for err in errors:
            # Create cluster key from multiple signals
            cluster_key = f"{err['class']}|{err['message_normalized'][:100]}|{err['backtrace_sig'][:200]}"
            clusters[cluster_key].append(err)
        
        # Sort clusters by size
        sorted_clusters = sorted(clusters.items(), key=lambda x: -len(x[1]))
        
        # Build output
        output = [
            f"**Error Clustering: {target.name}**",
            f"Total errors: {len(errors)}",
            f"Distinct issues: {len(clusters)}",
            ""
        ]
        
        for i, (key, cluster) in enumerate(sorted_clusters[:limit], 1):
            sample = cluster[0]
            affected_users = len(set(e['user'] for e in cluster if e['user']))
            affected_projects = len(set(e['project'] for e in cluster if e['project']))
            callers = Counter(e['caller'] for e in cluster if e['caller'])
            
            output.append(f"\n**Cluster {i}: {sample['class']}** ({len(cluster)} occurrences)")
            output.append(f"  Message: `{sample['message'][:150]}`")
            
            if affected_users:
                output.append(f"  Affected users: {affected_users}")
            if affected_projects:
                output.append(f"  Affected projects: {affected_projects}")
            if callers:
                top_caller = callers.most_common(1)[0]
                output.append(f"  Primary caller: {top_caller[0]} ({top_caller[1]}x)")
            if sample['correlation_id']:
                output.append(f"  Example trace ID: `{sample['correlation_id']}`")
        
        if len(clusters) > limit:
            output.append(f"\n... and {len(clusters) - limit} more distinct error patterns")
        
        return "\n".join(output)
    
    def _normalize_error_message(self, message: str) -> str:
        """Normalize error message for clustering (remove dynamic parts)."""
        if not message:
            return ""
        
        normalized = message
        
        # Replace IDs, numbers, hashes with placeholders
        normalized = re.sub(r'\b[0-9a-f]{8,}\b', '<ID>', normalized)  # Hex IDs
        normalized = re.sub(r'\b\d{4,}\b', '<NUM>', normalized)  # Long numbers
        normalized = re.sub(r'\b\d+\.\d+\.\d+\.\d+\b', '<IP>', normalized)  # IPs
        normalized = re.sub(r':\d+', ':<PORT>', normalized)  # Ports
        normalized = re.sub(r'/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+', '/<PATH>', normalized)  # Paths
        normalized = re.sub(r'@[a-zA-Z0-9._-]+', '@<HOST>', normalized)  # Hostnames
        
        return normalized.strip().lower()
    
    async def _tool_parse_backtraces(self, ctx: AgentContext, file_path: str = "", limit: int = 10, **kwargs) -> str:
        """
        Extract and analyze stack traces from errors.
        Groups by code path to identify failing components.
        """
        # Handle LLM hallucinating wrong parameter names
        if not file_path:
            file_path = (
                kwargs.get('file') or 
                kwargs.get('path') or 
                kwargs.get('filepath') or 
                ""
            )
        
        if not file_path:
            return "❌ Error: 'file_path' parameter is required."
        
        target = SmartFileFinder.find_file(file_path, ctx.session_path)
        
        if not target:
            return f"File not found: {file_path}"
        
        backtrace_patterns = Counter()
        backtrace_samples = {}
        
        try:
            with open(target, 'r', errors='ignore') as f:
                for line in f:
                    if not line.strip().startswith('{'):
                        continue
                    
                    try:
                        data = json.loads(line)
                        
                        # Extract backtrace
                        backtrace = None
                        if isinstance(data.get('exception'), dict):
                            backtrace = data['exception'].get('backtrace', [])
                        elif isinstance(data.get('exception.backtrace'), list):
                            backtrace = data.get('exception.backtrace', [])
                        
                        if not backtrace or not isinstance(backtrace, list):
                            continue
                        
                        # Create signature from top frames (skip common Rails/Sidekiq frames)
                        significant_frames = []
                        for frame in backtrace[:10]:
                            # Skip common framework frames
                            if any(x in frame.lower() for x in ['sidekiq', 'activesupport', 'activerecord/connection', 'rack/', 'puma/']):
                                continue
                            significant_frames.append(frame)
                            if len(significant_frames) >= 3:
                                break
                        
                        if not significant_frames:
                            significant_frames = backtrace[:3]
                        
                        # Create signature
                        sig = ' -> '.join(self._simplify_frame(f) for f in significant_frames)
                        backtrace_patterns[sig] += 1
                        
                        if sig not in backtrace_samples:
                            exc_class = None
                            if isinstance(data.get('exception'), dict):
                                exc_class = data['exception'].get('class')
                            exc_class = exc_class or data.get('exception.class') or 'UnknownError'
                            
                            backtrace_samples[sig] = {
                                'class': exc_class,
                                'full_trace': backtrace[:8],
                                'correlation_id': data.get('correlation_id', '')
                            }
                    except:
                        continue
        
        except Exception as e:
            return f"Error reading file: {e}"
        
        if not backtrace_patterns:
            return f"No backtraces found in {target.name}"
        
        output = [
            f"**Backtrace Analysis: {target.name}**",
            f"Unique code paths: {len(backtrace_patterns)}",
            ""
        ]
        
        for sig, count in backtrace_patterns.most_common(limit):
            sample = backtrace_samples.get(sig, {})
            
            output.append(f"\n**Pattern ({count}x): {sample.get('class', 'Unknown')}**")
            output.append(f"  Path: `{sig}`")
            
            if sample.get('full_trace'):
                output.append("  Full trace:")
                for frame in sample['full_trace'][:5]:
                    output.append(f"    - {frame[:100]}")
            
            if sample.get('correlation_id'):
                output.append(f"  Trace ID: `{sample['correlation_id']}`")
        
        return "\n".join(output)
    
    def _simplify_frame(self, frame: str) -> str:
        """Simplify a backtrace frame to essential parts."""
        # Extract file and method: "app/models/ci/build.rb:89:in `archive_trace'" -> "ci/build.rb:archive_trace"
        match = re.search(r'([^/]+\.rb):(\d+):in [`\']([^\'`]+)', frame)
        if match:
            return f"{match.group(1)}:{match.group(3)}"
        
        # Fallback: just return truncated frame
        return frame[:60]
    
    async def _tool_shell(self, ctx: AgentContext, command: str) -> str:
        """Execute shell command."""
        # Block dangerous commands
        dangerous = ['rm -rf /', 'mkfs', 'dd if=', '> /dev/', 'chmod 777 /']
        for d in dangerous:
            if d in command:
                return "Command blocked for safety."
        
        return await self._run_shell(command, ctx.session_path, timeout=TOOL_TIMEOUT)
    
    async def _tool_find_all(self, ctx: AgentContext, pattern: str) -> str:
        """Find files matching pattern across ALL sessions. Uses discovered bundle map for smart search."""
        base_dir = await self._find_sessions_root_shell(ctx)
        base_dir = base_dir.resolve()
        
        # AGENTIC: Ensure bundle is discovered first
        if not ctx.bundle_map or not ctx.bundle_map.discovered:
            bundle_map = await self._ensure_bundle_discovered(base_dir)
            ctx.bundle_map = bundle_map
        else:
            bundle_map = ctx.bundle_map
        
        results = []
        search_pattern = pattern.lower().strip()
        
        # STRATEGY 1: Use bundle_map semantic lookup (THE SMART WAY)
        if bundle_map and bundle_map.discovered:
            semantic_paths = bundle_map.find_component_logs(search_pattern)
            if semantic_paths:
                results = semantic_paths
                logger.info(f"Bundle map found {len(results)} files for '{pattern}'")
        
        # STRATEGY 2: Direct component match in discovered paths
        if not results and bundle_map and bundle_map.discovered:
            for comp, paths in bundle_map.log_paths.items():
                if search_pattern in comp or comp in search_pattern:
                    results.extend(paths)
        
        # STRATEGY 3: Fall back to grep-based search
        if not results:
            # Convert user query to likely path patterns
            cmd = f"find '{base_dir}' -type f \\( -name 'current' -o -name '*.log' \\) 2>/dev/null | grep -i '{pattern}'"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        # STRATEGY 4: Path pattern with slash
        if not results and '/' in pattern:
            grep_pattern = pattern.replace('/', '.*')
            cmd = f"find '{base_dir}' -type f 2>/dev/null | grep -iE '{grep_pattern}'"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        # STRATEGY 5: Partial filename match
        if not results and '*' not in pattern:
            cmd = f"find '{base_dir}' -type f -name '*{pattern}*' 2>/dev/null"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        if not results:
            # Show what's available from bundle_map
            available_info = ""
            if bundle_map and bundle_map.discovered:
                components = sorted(bundle_map.components_available)
                available_info = f"""
**Available components in this bundle:**
{', '.join(components)}

**Hint:** If you asked for "postgresql", try `patroni` instead (this bundle uses PostgreSQL HA).
"""
            else:
                available_info = """
**Bundle not discovered.** Run `discover_bundle` first to see what's available.
"""
            
            return f"""No files matching '{pattern}' found.
{available_info}
**How to search:**
- Use component names: `find_all('patroni')`, `find_all('sidekiq')`
- Use path patterns: `find_all('patroni/current')`
- Or search content: `grep_all("error text")`"""
        
        files = results[:500]
        
        # Group by session
        sessions = defaultdict(list)
        for full_path in files:
            try:
                rel = Path(full_path).relative_to(base_dir)
                session = rel.parts[0] if rel.parts else "unknown"
                sessions[session].append(full_path)
            except:
                sessions["unknown"].append(full_path)
        
        output = [f"**Found {len(files)} files matching '{pattern}' across {len(sessions)} sessions:**"]
        output.append(f"**Sessions dir:** `{base_dir}`\n")
        
        for session, session_files in sorted(sessions.items()):
            comp = "unknown"
            for c in ['sidekiq', 'gitaly', 'praefect', 'rails', 'postgres', 'redis', 'consul', 'pgbouncer', 'nginx', 'pages', 'geo', 'patroni']:
                if c in session.lower():
                    comp = c
                    break
            
            output.append(f"\n**{session}** ({comp}, {len(session_files)} files):")
            for full_path in session_files[:10]:
                output.append(f"  `{full_path}`")
            if len(session_files) > 10:
                output.append(f"  ... and {len(session_files) - 10} more")
        
        output.append(f"\n**Usage:** `analyze_all('{pattern}')` to analyze all {len(files)} files")
        
        return "\n".join(output)
    
    async def _find_sessions_root_shell(self, ctx: AgentContext) -> Path:
        """
        Find the root directory containing all sessions.
        Uses sessions_dir if available, otherwise walks up the directory tree.
        """
        # If we have sessions_dir from context, use it directly
        if ctx.sessions_dir:
            resolved = ctx.sessions_dir.resolve() if not ctx.sessions_dir.is_absolute() else ctx.sessions_dir
            if resolved.exists():
                return resolved
        
        # Get absolute path of session
        abs_path = ctx.session_path.resolve()
        
        # Walk up to find parent with multiple session directories
        current = abs_path
        for _ in range(10):
            parent = current.parent
            if parent == current:
                break
            
            # Check if parent has multiple subdirs that look like sessions
            try:
                subdirs = list(parent.iterdir())
                if len(subdirs) > 3:
                    return parent
                # Also check for known names
                if parent.name.lower() in ['extracted', 'data', 'sessions', 'bundles', 'uploads']:
                    return parent
            except:
                pass
            
            current = parent
        
        # Fallback: go up 2 levels
        return abs_path.parent.parent if abs_path.parent.parent.exists() else abs_path.parent
    
    async def _tool_analyze_all(self, ctx: AgentContext, pattern: str, max_files: int = 20) -> str:
        """Analyze files matching pattern across ALL sessions. Uses bundle_map for smart lookup."""
        base_dir = await self._find_sessions_root_shell(ctx)
        base_dir = base_dir.resolve()
        
        # AGENTIC: Ensure bundle is discovered first
        if not ctx.bundle_map or not ctx.bundle_map.discovered:
            bundle_map = await self._ensure_bundle_discovered(base_dir)
            ctx.bundle_map = bundle_map
        else:
            bundle_map = ctx.bundle_map
        
        results = []
        search_pattern = pattern.lower().strip()
        
        # STRATEGY 1: Use bundle_map semantic lookup (THE SMART WAY)
        if bundle_map and bundle_map.discovered:
            semantic_paths = bundle_map.find_component_logs(search_pattern)
            if semantic_paths:
                results = semantic_paths
                logger.info(f"Bundle map found {len(results)} files for analysis: '{pattern}'")
        
        # STRATEGY 2: Direct component match in discovered paths
        if not results and bundle_map and bundle_map.discovered:
            for comp, paths in bundle_map.log_paths.items():
                if search_pattern in comp or comp in search_pattern:
                    results.extend(paths)
        
        # STRATEGY 3: Fall back to grep-based search
        if not results:
            cmd = f"find '{base_dir}' -type f \\( -name 'current' -o -name '*.log' \\) 2>/dev/null | grep -i '{pattern}'"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        # STRATEGY 4: Path pattern
        if not results and '/' in pattern:
            grep_pattern = pattern.replace('/', '.*')
            cmd = f"find '{base_dir}' -type f 2>/dev/null | grep -iE '{grep_pattern}'"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        # STRATEGY 5: All logs
        if not results and pattern in ['*', '*.*', 'all', 'logs', 'current']:
            cmd = f"find '{base_dir}' -type f \\( -name '*.log' -o -name 'current' \\) 2>/dev/null | head -100"
            shell_results = (await self._run_shell(cmd, base_dir, timeout=60)).strip().split('\n')
            results = [r for r in shell_results if r.strip()]
        
        if not results:
            available = ', '.join(sorted(bundle_map.components_available)) if bundle_map and bundle_map.discovered else "unknown"
            return f"""No files matching '{pattern}' found.

**Available components:** {available}
**Hint:** If you asked for "postgresql", try `patroni` instead (PostgreSQL HA).
**Run:** `discover_bundle` to see what's in this bundle."""
        
        files = [Path(f) for f in results[:max_files] if f.strip()]
        
        # Aggregate analysis
        total_lines = 0
        total_errors = 0
        all_error_classes = Counter()
        all_callers = Counter()
        session_summaries = []
        sample_correlation_ids = []
        
        for file_path in files:
            try:
                # Extract session name
                try:
                    rel = file_path.relative_to(base_dir)
                    session = rel.parts[0] if rel.parts else "unknown"
                except:
                    session = "unknown"
                
                # Quick analysis (reuse analyze_file logic but lighter)
                error_count = 0
                line_count = 0
                error_classes = Counter()
                
                with open(file_path, 'r', errors='ignore') as f:
                    for line in f:
                        line_count += 1
                        if line_count > 50000:  # Limit per file
                            break
                        
                        # Check if error
                        is_error = False
                        data = {}
                        
                        if line.startswith('{'):
                            try:
                                data = json.loads(line)
                                sev_raw = data.get('severity') or data.get('level') or ''
                                sev = sev_raw.upper() if isinstance(sev_raw, str) else ''
                                
                                is_error = (
                                    sev in ['ERROR', 'FATAL', 'CRITICAL', 'WARN', 'WARNING'] or
                                    isinstance(data.get('exception'), dict) or
                                    (data.get('error') and isinstance(data.get('error'), str))
                                )
                            except:
                                pass
                        else:
                            is_error = any(x in line.upper() for x in ['ERROR', 'FATAL', 'EXCEPTION', 'FAILED'])
                        
                        if is_error:
                            error_count += 1
                            
                            # Extract error class
                            exc_class = None
                            if data:
                                exc = data.get('exception', {})
                                if isinstance(exc, dict):
                                    exc_class = exc.get('class')
                                if not exc_class:
                                    exc_class = data.get('exception.class') or data.get('error_class')
                                if not exc_class:
                                    exc_class = data.get('component') or data.get('class', 'Unknown')
                                
                                # Get caller
                                caller = data.get('meta.caller_id') or data.get('class', '')
                                if caller:
                                    all_callers[caller] += 1
                                
                                # Sample correlation ID
                                cid = data.get('correlation_id')
                                if cid and len(sample_correlation_ids) < 10:
                                    sample_correlation_ids.append(cid)
                            else:
                                exc_class = 'Unknown'
                            
                            if exc_class:
                                error_classes[exc_class] += 1
                                all_error_classes[exc_class] += 1
                
                total_lines += line_count
                total_errors += error_count
                
                if error_count > 0:
                    top_error = error_classes.most_common(1)[0][0] if error_classes else 'Unknown'
                    session_summaries.append({
                        'session': session,
                        'file': file_path.name,
                        'lines': line_count,
                        'errors': error_count,
                        'top_error': top_error
                    })
            
            except Exception as e:
                session_summaries.append({
                    'session': session if 'session' in dir() else 'unknown',
                    'file': file_path.name,
                    'errors': 0,
                    'error_msg': str(e)
                })
        
        # Build output
        output = [f"**Cluster-Wide Analysis: '{pattern}'**\n"]
        output.append(f"**Files Analyzed:** {len(files)} (from {base_dir})")
        output.append(f"**Total Lines:** {total_lines:,}")
        output.append(f"**Total Errors:** {total_errors:,}")
        
        if total_lines > 0:
            error_rate = (total_errors / total_lines) * 100
            output.append(f"**Error Rate:** {error_rate:.2f}%\n")
        else:
            output.append("")
        
        # Sessions with errors
        sessions_with_errors = [s for s in session_summaries if s.get('errors', 0) > 0]
        output.append(f"**Sessions with Errors:** {len(sessions_with_errors)}/{len(files)}")
        
        # Top error classes
        if all_error_classes:
            output.append("\n**Top Error Types (Cluster-Wide):**")
            for cls, count in all_error_classes.most_common(10):
                output.append(f"  - `{cls}`: {count:,}")
        else:
            output.append("\n**No errors found in analyzed files.**")
        
        # Top callers
        if all_callers:
            output.append("\n**Top Callers:**")
            for caller, count in all_callers.most_common(5):
                output.append(f"  - `{caller}`: {count:,}")
        
        # Per-session breakdown
        if sessions_with_errors:
            output.append("\n**Per-Session Breakdown:**")
            for s in sorted(sessions_with_errors, key=lambda x: x.get('errors', 0), reverse=True)[:15]:
                output.append(f"  - **{s['session'][:50]}** ({s['file']}): {s['errors']:,} errors - `{s.get('top_error', 'N/A')}`")
        
        # Sample correlation IDs
        if sample_correlation_ids:
            output.append("\n**Sample Correlation IDs (for tracing):**")
            for cid in sample_correlation_ids[:5]:
                output.append(f"  - `{cid}`")
        
        # List all files that were analyzed
        output.append("\n**Files Analyzed:**")
        for fp in files[:20]:
            output.append(f"  - `{fp}`")
        if len(files) > 20:
            output.append(f"  ... and {len(files) - 20} more")
        
        return "\n".join(output)
    
    async def _tool_grep_all(self, ctx: AgentContext, search: str, file_pattern: str = "", max_matches: int = 50) -> str:
        """Grep across ALL sessions. Uses bundle_map for smart file lookup."""
        base_dir = await self._find_sessions_root_shell(ctx)
        base_dir = base_dir.resolve()
        
        # AGENTIC: Ensure bundle is discovered first
        if not ctx.bundle_map or not ctx.bundle_map.discovered:
            bundle_map = await self._ensure_bundle_discovered(base_dir)
            ctx.bundle_map = bundle_map
        else:
            bundle_map = ctx.bundle_map
        
        target_files = []
        
        # STRATEGY 1: Use bundle_map for file_pattern lookup
        if file_pattern and bundle_map and bundle_map.discovered:
            semantic_paths = bundle_map.find_component_logs(file_pattern.lower().strip())
            if semantic_paths:
                target_files = semantic_paths[:100]
                logger.info(f"Bundle map found {len(target_files)} files for grep: '{file_pattern}'")
        
        # STRATEGY 2: Fall back to grep-based search
        if not target_files and file_pattern:
            # Try grep-based lookup
            cmd = f"find '{base_dir}' -type f \\( -name 'current' -o -name '*.log' \\) 2>/dev/null | grep -i '{file_pattern}'"
            files_result = await self._run_shell(cmd, base_dir, timeout=60)
            if files_result.strip():
                target_files = [f.strip() for f in files_result.strip().split('\n') if f.strip()][:100]
        
        # STRATEGY 3: All log files if no pattern
        if not target_files and not file_pattern:
            find_cmd = f"find '{base_dir}' -type f \\( -name '*.log' -o -name 'current' -o -name '*_json.log' \\) 2>/dev/null | head -100"
            files_result = await self._run_shell(find_cmd, base_dir, timeout=60)
            if files_result.strip():
                target_files = [f.strip() for f in files_result.strip().split('\n') if f.strip()]
        
        if not target_files:
            available = ', '.join(sorted(bundle_map.components_available)) if bundle_map and bundle_map.discovered else "unknown"
            return f"""No log files found matching '{file_pattern or 'all logs'}'.

**Available components:** {available}
**Hint:** If you asked for "postgresql", try `patroni` instead."""
        
        # Now grep each file
        matches = []
        files_with_matches = []
        
        for file_path in target_files:
            cmd = f"grep -l '{search}' '{file_path}' 2>/dev/null"
            result = await self._run_shell(cmd, base_dir, timeout=10)
            if result.strip():
                files_with_matches.append(file_path)
        
        if not files_with_matches:
            return f"No matches for '{search}' in {len(target_files)} files."
        
        # Get actual matches
        for file_path in files_with_matches[:20]:
            cmd = f"grep -n '{search}' '{file_path}' 2>/dev/null | head -10"
            result = await self._run_shell(cmd, base_dir, timeout=30)
            
            if result.strip():
                try:
                    rel = Path(file_path).relative_to(base_dir)
                    session = rel.parts[0] if rel.parts else "unknown"
                except:
                    session = "unknown"
                
                for line in result.strip().split('\n')[:5]:
                    matches.append({
                        'session': session,
                        'file': Path(file_path).name,
                        'match': line[:200]
                    })
                    
                    if len(matches) >= max_matches:
                        break
            
            if len(matches) >= max_matches:
                break
        
        # Build output
        output = [f"**Search Results: '{search}'**\n"]
        output.append(f"**Files with Matches:** {len(files_with_matches)}")
        output.append(f"**Showing:** {len(matches)} matches\n")
        
        # Group by session
        by_session = defaultdict(list)
        for m in matches:
            by_session[m['session']].append(m)
        
        for session, session_matches in sorted(by_session.items()):
            output.append(f"\n**{session}:**")
            for m in session_matches[:10]:
                output.append(f"  [{m['file']}] {m['match']}")
        
        if len(files_with_matches) > 20:
            output.append(f"\n... and {len(files_with_matches) - 20} more files with matches")
        
        return "\n".join(output)
    
    # =========================================================================
    # HELPERS
    # =========================================================================
    
    def _resolve_path(self, file_path: str, ctx: AgentContext) -> Path:
        """
        Resolve a file path using multiple strategies.
        Tries absolute path, sessions_dir relative, and SmartFileFinder.
        """
        # 1. Check if it's an absolute path that exists
        abs_path = Path(file_path)
        if abs_path.is_absolute() and abs_path.exists():
            return abs_path
        
        # 2. Check if it's relative to sessions_dir (for cross-session access)
        if ctx.sessions_dir:
            sessions_path = ctx.sessions_dir / file_path
            if sessions_path.exists():
                return sessions_path
        
        # 3. Check if it's relative to current session path
        if ctx.session_path:
            session_rel = ctx.session_path / file_path
            if session_rel.exists():
                return session_rel
        
        # 4. Fall back to SmartFileFinder for current session
        if ctx.session_path:
            found = SmartFileFinder.find_file(file_path, ctx.session_path)
            if found:
                return found
        
        # 5. Return the path as-is (caller should handle non-existence)
        return Path(file_path)
    
    async def _run_shell(self, cmd: str, cwd: Path, timeout: int = TOOL_TIMEOUT) -> str:
        """Execute shell command."""
        try:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(cwd)
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode('utf-8', errors='ignore')
            return output if output else ""
        except asyncio.TimeoutError:
            return f"Command timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"
    
    def _format_size(self, size: int) -> str:
        """Format file size."""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.1f}{unit}"
            size /= 1024
        return f"{size:.1f}TB"
    
    def _parse_tool_args(self, args_str: str) -> Dict:
        """Parse tool arguments with repair for common LLM JSON errors."""
        if not args_str or args_str.strip() == "":
            return {}
        
        # Try direct parse first
        try:
            return json.loads(args_str)
        except json.JSONDecodeError:
            pass
        
        # Try common repairs
        repaired = args_str.strip()
        
        # Fix trailing quote before closing brace: 20"} -> 20}
        repaired = re.sub(r'(\d)"(\s*})', r'\1\2', repaired)
        
        # Fix missing closing brace
        if repaired.count('{') > repaired.count('}'):
            repaired += '}'
        
        # Fix trailing comma before closing brace
        repaired = re.sub(r',\s*}', '}', repaired)
        
        # Fix single quotes to double quotes
        repaired = repaired.replace("'", '"')
        
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass
        
        # Try extracting key-value pairs manually
        try:
            result = {}
            # Find all "key": value patterns
            pattern = r'"(\w+)":\s*(?:"([^"]*)"|([\d.]+)|(\w+))'
            for match in re.finditer(pattern, args_str):
                key = match.group(1)
                if match.group(2) is not None:
                    result[key] = match.group(2)
                elif match.group(3) is not None:
                    val = match.group(3)
                    result[key] = float(val) if '.' in val else int(val)
                elif match.group(4) is not None:
                    val = match.group(4)
                    if val == 'true':
                        result[key] = True
                    elif val == 'false':
                        result[key] = False
                    else:
                        result[key] = val
            if result:
                return result
        except:
            pass
        
        logger.warning(f"Failed to parse tool args: {args_str[:100]}")
        return {}
    
    def get_session_path(self, session_id: str) -> Optional[Path]:
        """Get session path by ID."""
        if not self.sessions_dir.exists():
            return None
        
        exact = self.sessions_dir / session_id
        if exact.exists():
            return exact.resolve()
        
        # Partial match
        for d in self.sessions_dir.iterdir():
            if session_id in d.name and d.is_dir():
                return d.resolve()
        
        return None
    
    # =========================================================================
    # MAIN AGENT LOOP
    # =========================================================================
    
    async def run(self, message: str, session_id: str, websocket: WebSocket):
        """Main agent loop."""
        start_time = time.time()
        
        session_path = self.get_session_path(session_id)
        if not session_path:
            await websocket.send_json({
                "type": "response", 
                "content": f"Session not found: {session_id}. Please upload a GitLab SOS bundle first."
            })
            await websocket.send_json({"type": "complete"})
            return
        
        ctx = AgentContext(
            session_path=session_path,
            session_id=session_id,
            websocket=websocket,
            kb=self.kb,
            sessions_dir=self.sessions_dir
        )
        
        # Conversation history
        if session_id not in self.conversations:
            self.conversations[session_id] = []
        history = self.conversations[session_id][-10:]
        
        # Build messages
        system_prompt = self._build_system_prompt(ctx)
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": message})
        
        tools = self.get_tools_schema()
        
        await websocket.send_json({"type": "thinking", "content": "Analyzing..."})
        
        turn = 0
        retry_count = 0
        max_retries = 3
        
        try:
            while turn < MAX_TURNS:
                turn += 1
                logger.info(f"Turn {turn}/{MAX_TURNS} | Actions: {ctx.actions_taken}")
                
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.post(
                            f"{self.base_url}/chat/completions",
                            json={
                                "model": self.model,
                                "messages": messages,
                                "tools": tools,
                                "tool_choice": "auto",
                                "stream": False,
                                "temperature": 0
                            },
                            headers={"Authorization": "Bearer ollama"},
                            timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT)
                        ) as resp:
                            
                            if resp.status != 200:
                                error_text = await resp.text()
                                logger.error(f"LLM error: {error_text}")
                                
                                # Check if it's a tool parsing error
                                is_tool_error = "parsing tool" in error_text.lower() or "tool call" in error_text.lower()
                                
                                if retry_count < max_retries:
                                    retry_count += 1
                                    await asyncio.sleep(2)
                                    continue
                                
                                # If tool parsing keeps failing, try without tools
                                if is_tool_error:
                                    logger.info("Tool parsing failed, trying direct response")
                                    try:
                                        simple_messages = messages.copy()
                                        simple_messages[0]["content"] += "\n\nIMPORTANT: Respond directly without using tools. Analyze what you know and provide your best answer."
                                        
                                        async with aiohttp.ClientSession() as simple_session:
                                            async with simple_session.post(
                                                f"{self.base_url}/chat/completions",
                                                json={
                                                    "model": self.model,
                                                    "messages": simple_messages,
                                                    "stream": False,
                                                    "temperature": 0
                                                },
                                                headers={"Authorization": "Bearer ollama"},
                                                timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT)
                                            ) as simple_resp:
                                                if simple_resp.status == 200:
                                                    simple_data = await simple_resp.json()
                                                    content = simple_data["choices"][0]["message"].get("content", "")
                                                    if content:
                                                        for i in range(0, len(content), 20):
                                                            await websocket.send_json({
                                                                "type": "response",
                                                                "content": content[i:i+20]
                                                            })
                                                            await asyncio.sleep(0.002)
                                                        break
                                    except Exception as e:
                                        logger.error(f"Fallback also failed: {e}")
                                
                                await websocket.send_json({
                                    "type": "response", 
                                    "content": "The AI model had trouble processing that request. Please try rephrasing your question."
                                })
                                break
                            
                            retry_count = 0
                            data = await resp.json()
                            
                            # Check for error in response body
                            if "error" in data:
                                error_msg = data.get("error", {}).get("message", str(data["error"]))
                                logger.error(f"API error in response: {error_msg}")
                                await websocket.send_json({
                                    "type": "response",
                                    "content": f"Model error: {error_msg[:200]}. Please try again."
                                })
                                break
                            
                            if "choices" not in data or not data["choices"]:
                                logger.error(f"Unexpected response format: {str(data)[:200]}")
                                await websocket.send_json({
                                    "type": "response",
                                    "content": "Unexpected response from AI model. Please try again."
                                })
                                break
                            
                            msg = data["choices"][0]["message"]
                            
                            # Handle tool calls
                            if msg.get("tool_calls"):
                                messages.append({
                                    "role": "assistant",
                                    "content": msg.get("content"),
                                    "tool_calls": msg["tool_calls"]
                                })
                                
                                for tool_call in msg["tool_calls"]:
                                    func = tool_call["function"]
                                    tool_name = func["name"]
                                    
                                    # Parse arguments with repair for common LLM JSON errors
                                    args = self._parse_tool_args(func.get("arguments", "{}"))
                                    
                                    logger.info(f"Tool: {tool_name} | Args: {json.dumps(args)[:150]}")
                                    
                                    await websocket.send_json({
                                        "type": "tool_call",
                                        "tool": tool_name,
                                        "params": args
                                    })
                                    
                                    tool = self.tools.get(tool_name)
                                    if tool:
                                        result = await tool.handler(ctx, **args)
                                    else:
                                        result = f"Unknown tool: {tool_name}"
                                    
                                    ctx.actions_taken += 1
                                    
                                    # Send result to UI (truncated)
                                    await websocket.send_json({
                                        "type": "tool_result",
                                        "result": result[:4000] if len(result) > 4000 else result
                                    })
                                    
                                    # Add full result to messages
                                    messages.append({
                                        "role": "tool",
                                        "tool_call_id": tool_call["id"],
                                        "content": result[:50000]
                                    })
                                
                                # Update system prompt with progress
                                messages[0]["content"] = self._build_system_prompt(ctx)
                                
                                await websocket.send_json({
                                    "type": "thinking",
                                    "content": f"Investigating... ({ctx.actions_taken} tools used)"
                                })
                                continue
                            
                            # Final response
                            else:
                                content = msg.get("content", "")
                                
                                if content:
                                    elapsed = time.time() - start_time
                                    
                                    # Add summary if we did work
                                    if ctx.actions_taken > 0:
                                        content += f"\n\n---\n*Investigation: {ctx.actions_taken} tools, {elapsed:.1f}s*"
                                    
                                    # Stream response
                                    chunk_size = 20
                                    for i in range(0, len(content), chunk_size):
                                        await websocket.send_json({
                                            "type": "response", 
                                            "content": content[i:i+chunk_size]
                                        })
                                        await asyncio.sleep(0.002)
                                    
                                    # Save to history
                                    self.conversations[session_id].append({
                                        "role": "user", 
                                        "content": message
                                    })
                                    self.conversations[session_id].append({
                                        "role": "assistant", 
                                        "content": content
                                    })
                                
                                break
                
                except asyncio.TimeoutError:
                    logger.warning(f"LLM timeout on turn {turn}")
                    if retry_count < max_retries:
                        retry_count += 1
                        await websocket.send_json({
                            "type": "thinking",
                            "content": f"Processing... (retry {retry_count})"
                        })
                        continue
                    await websocket.send_json({
                        "type": "response",
                        "content": "Analysis timed out. Try a more specific question."
                    })
                    break
        
        except Exception as e:
            logger.error(f"Agent error: {e}")
            import traceback
            traceback.print_exc()
            await websocket.send_json({
                "type": "response", 
                "content": f"Error during analysis: {str(e)}"
            })
        
        elapsed = time.time() - start_time
        logger.info(f"Complete: {ctx.actions_taken} tools, {elapsed:.1f}s")
        
        await websocket.send_json({"type": "complete"})


# =============================================================================
# FASTAPI APPLICATION
# =============================================================================

app = FastAPI(
    title="SOSLab Agent",
    description="GitLab Log Analysis Agent",
    version="4.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

agent = InvestigationAgent()


@app.websocket("/ws/agent")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected")
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data["type"] == "chat":
                message = data["message"]
                context = data.get("context", {})
                session_id = context.get("session_id", "default")
                await agent.run(message, session_id, websocket)
            
            elif data["type"] == "get_history":
                session_id = data.get("session_id", "default")
                history = agent.conversations.get(session_id, [])
                formatted = [
                    {"type": "user" if m["role"] == "user" else "assistant", "content": m["content"]}
                    for m in history[-20:]
                ]
                await websocket.send_json({"type": "history", "messages": formatted})
            
            elif data["type"] == "get_metrics":
                kb_stats = agent.kb.get_stats() if agent.kb else {}
                await websocket.send_json({
                    "type": "metrics",
                    "data": {
                        "model": agent.model,
                        "tools": len(agent.tools),
                        "timeout": LLM_TIMEOUT,
                        "knowledge_base": kb_stats
                    }
                })
            
            elif data["type"] == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif data["type"] == "clear_history":
                session_id = data.get("session_id", "default")
                if session_id in agent.conversations:
                    agent.conversations[session_id] = []
                await websocket.send_json({"type": "history_cleared"})
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": "4.0.0",
        "model": agent.model,
        "tools": len(agent.tools),
        "timeout_seconds": LLM_TIMEOUT,
        "knowledge_base": agent.kb.get_stats() if agent.kb else {"status": "unavailable"}
    }


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    
    print("""
╔═══════════════════════════════════════════════════════════════════╗
║  SOSLab Agent Server v4.0.0                                       ║
║  GitLab Log Analysis Agent                                        ║
║                                                                   ║
║  Endpoints:                                                       ║
║    WebSocket: ws://localhost:8001/ws/agent                        ║
║    Health:    http://localhost:8001/health                        ║
╚═══════════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run(app, host="127.0.0.1", port=8001)