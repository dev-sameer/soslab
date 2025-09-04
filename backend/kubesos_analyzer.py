#!/usr/bin/env python3
"""
KubeSOS Analyzer -  Kubernetes GitLab SOS archives
Handles dynamic log formats without hardcoding patterns
"""

import re
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import json
from datetime import datetime
import fnmatch

class KubeSOSAnalyzer:
    """Production-grade analyzer for KubeSOS archives"""
    
    def __init__(self):
        self.temp_dir = Path("data/extracted")
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Dynamic patterns - will be discovered from actual files
        self.discovered_log_patterns = set()
        self.discovered_components = {}
        
        # Known KubeSOS command outputs (not logs)
        self.command_output_patterns = {
            'describe_*', 'get_*', 'top_*', 'events', 'all_events',
            'helm_history', 'helm-version', 'kubectl-check', 'chart-version',
            'secrets', 'kubeSOS.info', '*values*.yaml'
        }
        
        # Component identification based on container names
        self.component_indicators = {
            'webservice': ['webservice', 'gitlab-workhorse'],
            'sidekiq': ['sidekiq'],
            'gitaly': ['gitaly'],
            'gitlab-shell': ['gitlab-shell'],
            'gitlab-exporter': ['gitlab-exporter'],
            'registry': ['registry'],
            'migrations': ['migrations'],
            'kas': ['kas'],
            'toolbox': ['toolbox'],
            'artifactory': ['artifactory'],
            'minio': ['minio'],
            'xray': ['xray'],
            'grafana-agent': ['grafana-agent'],
            'toolchain-api': ['toolchain-api'],
            'gitlab-runner': ['gitlab-runner']
        }
    
    def is_kubesos_archive(self, extracted_files: List[Dict]) -> bool:
        """Detect if this is a KubeSOS archive based on file structure"""
        filenames = [f['relative_path'] for f in extracted_files]
        
        # Core KubeSOS indicators
        kubesos_indicators = [
            'kubeSOS.info',
            'kubectl-check',
            'describe_pods',
            'get_pods',
            'events'
        ]
        
        # Also check for container log naming pattern
        container_log_pattern = False
        for filename in filenames:
            # KubeSOS logs follow pattern: podname_containername.log
            if '_' in filename and filename.endswith('.log'):
                parts = filename.split('_')
                if len(parts) >= 2:
                    container_log_pattern = True
                    break
        
        matches = sum(1 for indicator in kubesos_indicators 
                     if any(indicator in f for f in filenames))
        
        # Need at least 3 indicators OR container log pattern + 2 indicators
        return matches >= 3 or (container_log_pattern and matches >= 2)
    
    def analyze_file_structure(self, extracted_info: List[Dict]) -> Dict[str, List[str]]:
        """Dynamically analyze and categorize files"""
        categorized = {
            'pod_logs': [],
            'kubernetes_commands': [],
            'configuration': [],
            'events': [],
            'unknown': []
        }
        
        for file_info in extracted_info:
            path = file_info['relative_path']
            filename = Path(path).name
            
            # Kubernetes command outputs
            if any(fnmatch.fnmatch(filename, pattern) for pattern in self.command_output_patterns):
                if 'events' in filename:
                    categorized['events'].append(path)
                else:
                    categorized['kubernetes_commands'].append(path)
            
            # YAML configurations
            elif filename.endswith('.yaml') or filename.endswith('.yml'):
                categorized['configuration'].append(path)
            
            # Pod/container logs
            elif filename.endswith('.log'):
                categorized['pod_logs'].append(path)
                # Discover component from filename
                self._discover_component(filename)
            
            else:
                categorized['unknown'].append(path)
        
        return categorized
    
    def _discover_component(self, filename: str) -> str:
        """Dynamically discover component from filename"""
        # Remove .log extension
        name_parts = filename.replace('.log', '').replace('_previous', '')
        
        # Try to identify component
        for component, indicators in self.component_indicators.items():
            for indicator in indicators:
                if indicator in name_parts.lower():
                    self.discovered_components[filename] = component
                    return component
        
        # If not found, extract from pod name pattern
        if '_' in name_parts:
            parts = name_parts.split('_')
            # Last part is usually container name
            container_name = parts[-1]
            self.discovered_components[filename] = container_name
            return container_name
        
        return 'unknown'
    
    def parse_kubernetes_events(self, session_dir: Path) -> List[Dict]:
        """Parse Kubernetes events with dynamic field detection"""
        events = []
        events_file = session_dir / "events"
        
        if not events_file.exists():
            # Try alternative event files
            for alt in ["all_events", "get_events"]:
                alt_file = session_dir / alt
                if alt_file.exists():
                    events_file = alt_file
                    break
        
        if not events_file.exists():
            return events
        
        try:
            with open(events_file, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            
            if not lines:
                return events
            
            # Dynamically detect column structure from header
            header = lines[0].strip()
            columns = self._parse_column_positions(header)
            
            for line in lines[1:]:
                if not line.strip():
                    continue
                
                event = self._parse_event_line(line, columns)
                if event:
                    events.append(event)
        
        except Exception as e:
            print(f"Error parsing events: {e}")
        
        return events
    
    def _parse_column_positions(self, header: str) -> Dict[str, Tuple[int, int]]:
        """Dynamically detect column positions from header"""
        columns = {}
        
        # Common column names in Kubernetes events
        column_patterns = [
            'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'SUBOBJECT', 
            'MESSAGE', 'FIRST SEEN', 'COUNT', 'NAME', 'NAMESPACE'
        ]
        
        for col_name in column_patterns:
            pos = header.find(col_name)
            if pos != -1:
                # Find end position (next column or end of line)
                end_pos = len(header)
                for other_col in column_patterns:
                    if other_col != col_name:
                        other_pos = header.find(other_col, pos + len(col_name))
                        if other_pos != -1 and other_pos < end_pos:
                            end_pos = other_pos
                
                columns[col_name] = (pos, end_pos)
        
        return columns
    
    def _parse_event_line(self, line: str, columns: Dict[str, Tuple[int, int]]) -> Optional[Dict]:
        """Parse a single event line based on detected columns"""
        if not line.strip():
            return None
        
        event = {}
        
        for col_name, (start, end) in columns.items():
            if start < len(line):
                value = line[start:min(end, len(line))].strip()
                if value:
                    # Map to standardized field names
                    field_map = {
                        'LAST SEEN': 'last_seen',
                        'FIRST SEEN': 'first_seen',
                        'TYPE': 'type',
                        'REASON': 'reason',
                        'OBJECT': 'object_name',
                        'MESSAGE': 'message',
                        'COUNT': 'count',
                        'NAME': 'name'
                    }
                    
                    field_name = field_map.get(col_name, col_name.lower().replace(' ', '_'))
                    event[field_name] = value
        
        # Determine severity based on type
        if event.get('type'):
            event_type = event['type'].lower()
            if event_type in ['warning', 'error']:
                event['severity'] = event_type
            else:
                event['severity'] = 'info'
        
        return event if event else None
    
    def analyze_pod_logs(self, log_path: Path, filename: str) -> Dict[str, Any]:
        """Analyze pod logs with dynamic pattern detection"""
        stats = {
            'total_lines': 0,
            'errors': 0,
            'warnings': 0,
            'component': self._discover_component(filename),
            'log_format': 'unknown',
            'patterns': {},
            'timestamp_format': None
        }
        
        try:
            with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                # Sample first 100 lines to detect format
                sample_lines = []
                for i, line in enumerate(f):
                    if i < 100:
                        sample_lines.append(line)
                    stats['total_lines'] += 1
                
                # Detect log format from sample
                log_format = self._detect_log_format(sample_lines)
                stats['log_format'] = log_format
                
                # Reset file pointer
                f.seek(0)
                
                # Process entire file
                for line in f:
                    line_analysis = self._analyze_log_line(line, log_format)
                    
                    if line_analysis['severity'] == 'error':
                        stats['errors'] += 1
                    elif line_analysis['severity'] == 'warning':
                        stats['warnings'] += 1
                    
                    # Track patterns
                    if line_analysis.get('pattern'):
                        pattern = line_analysis['pattern']
                        if pattern not in stats['patterns']:
                            stats['patterns'][pattern] = {
                                'count': 0,
                                'severity': line_analysis['severity']
                            }
                        stats['patterns'][pattern]['count'] += 1
        
        except Exception as e:
            print(f"Error analyzing {filename}: {e}")
        
        return stats
    
    def _detect_log_format(self, sample_lines: List[str]) -> str:
        """Dynamically detect log format from sample lines"""
        json_count = 0
        structured_count = 0
        
        for line in sample_lines:
            line = line.strip()
            if not line:
                continue
            
            # Check for JSON
            if line.startswith('{') and line.endswith('}'):
                try:
                    json.loads(line)
                    json_count += 1
                except:
                    pass
            
            # Check for structured format (key=value)
            if '=' in line and not line.startswith('{'):
                structured_count += 1
        
        # Determine format based on majority
        total = len([l for l in sample_lines if l.strip()])
        if json_count > total * 0.7:
            return 'json'
        elif structured_count > total * 0.5:
            return 'structured'
        else:
            return 'plain'
    
    def _analyze_log_line(self, line: str, log_format: str) -> Dict[str, Any]:
        """Analyze a single log line based on detected format"""
        result = {
            'severity': 'info',
            'pattern': None,
            'fields': {}
        }
        
        if not line.strip():
            return result
        
        if log_format == 'json':
            try:
                data = json.loads(line)
                
                # Extract severity
                for field in ['severity', 'level', 'log_level']:
                    if field in data:
                        severity = str(data[field]).lower()
                        if 'error' in severity or 'fatal' in severity:
                            result['severity'] = 'error'
                        elif 'warn' in severity:
                            result['severity'] = 'warning'
                        break
                
                # Check for exceptions
                if 'exception.class' in data or 'exception' in data:
                    result['severity'] = 'error'
                    result['pattern'] = 'exception'
                
                # Extract key fields
                result['fields'] = data
                
            except:
                # Fallback to text analysis
                pass
        
        # Text-based analysis (for all formats)
        line_lower = line.lower()
        
        # Dynamic pattern detection
        if 'error' in line_lower or 'exception' in line_lower or 'failed' in line_lower:
            result['severity'] = 'error'
            
            # Extract error pattern
            if 'timeout' in line_lower:
                result['pattern'] = 'timeout_error'
            elif 'connection' in line_lower:
                result['pattern'] = 'connection_error'
            elif 'permission' in line_lower or 'denied' in line_lower:
                result['pattern'] = 'permission_error'
            elif 'memory' in line_lower or 'oom' in line_lower:
                result['pattern'] = 'memory_error'
            else:
                result['pattern'] = 'generic_error'
        
        elif 'warn' in line_lower:
            result['severity'] = 'warning'
            result['pattern'] = 'warning'
        
        return result
    
    def analyze_kubesos_structure(self, extracted_info: List[Dict], session_dir: Path) -> Dict:
        """Main analysis method for KubeSOS archives"""
        results = {
            "type": "kubesos",
            "kubernetes_info": {},
            "components": {},
            "pod_logs": {},
            "events": [],
            "insights": [],
            "file_categories": {}
        }
        
        # Categorize files
        results['file_categories'] = self.analyze_file_structure(extracted_info)
        
        # Read kubeSOS.info
        self._parse_kubesos_info(session_dir, results)
        
        # Parse Kubernetes events
        results['events'] = self.parse_kubernetes_events(session_dir)
        
        # Analyze pod descriptions
        self._analyze_pod_descriptions(session_dir, results)
        
        # Analyze each pod log
        for log_path in results['file_categories']['pod_logs']:
            full_path = session_dir / log_path
            if full_path.exists():
                log_stats = self.analyze_pod_logs(full_path, log_path)
                results['pod_logs'][log_path] = log_stats
                
                # Aggregate by component
                component = log_stats['component']
                if component not in results['components']:
                    results['components'][component] = {
                        'errors': 0,
                        'warnings': 0,
                        'total_lines': 0,
                        'files': []
                    }
                
                results['components'][component]['errors'] += log_stats['errors']
                results['components'][component]['warnings'] += log_stats['warnings']
                results['components'][component]['total_lines'] += log_stats['total_lines']
                results['components'][component]['files'].append(log_path)
        
        # Generate insights
        results['insights'] = self.generate_kubesos_insights(results)
        
        return results
    
    def _parse_kubesos_info(self, session_dir: Path, results: Dict):
        """Parse kubeSOS.info file dynamically"""
        info_file = session_dir / "kubeSOS.info"
        if not info_file.exists():
            return
        
        try:
            with open(info_file, 'r') as f:
                content = f.read()
            
            # Parse key-value pairs dynamically
            for line in content.split('\n'):
                if '=' in line and '[' in line and ']' in line:
                    key = line.split('=')[0].strip()
                    value_match = re.search(r'\[(.*?)\]', line)
                    if value_match:
                        value = value_match.group(1)
                        results['kubernetes_info'][key.lower()] = value
        
        except Exception as e:
            print(f"Error parsing kubeSOS.info: {e}")
    
    def _analyze_pod_descriptions(self, session_dir: Path, results: Dict):
        """Analyze pod descriptions for issues"""
        describe_file = session_dir / "describe_pods"
        if not describe_file.exists():
            return
        
        try:
            with open(describe_file, 'r') as f:
                content = f.read()
            
            # Count pods
            pod_sections = content.split('\n\n\n')
            results['kubernetes_info']['total_pods'] = len([s for s in pod_sections if s.strip()])
            
            # Look for common issues
            restart_counts = re.findall(r'Restart Count:\s*(\d+)', content)
            if restart_counts:
                high_restarts = sum(1 for r in restart_counts if int(r) > 5)
                if high_restarts > 0:
                    results['kubernetes_info']['pods_with_high_restarts'] = high_restarts
            
            # Check for pending/failed pods
            if 'Pending' in content:
                results['kubernetes_info']['has_pending_pods'] = True
            if 'Failed' in content or 'CrashLoopBackOff' in content:
                results['kubernetes_info']['has_failed_pods'] = True
        
        except Exception as e:
            print(f"Error analyzing pod descriptions: {e}")
    
    def generate_kubesos_insights(self, results: Dict) -> List[Dict]:
        """Generate insights specific to Kubernetes deployments"""
        insights = []
        
        # Event-based insights
        error_events = [e for e in results.get('events', []) if e.get('severity') == 'error']
        warning_events = [e for e in results.get('events', []) if e.get('severity') == 'warning']
        
        if len(error_events) > 0:
            # Group events by reason
            error_reasons = {}
            for event in error_events:
                reason = event.get('reason', 'Unknown')
                error_reasons[reason] = error_reasons.get(reason, 0) + 1
            
            top_reason = max(error_reasons.items(), key=lambda x: x[1])
            
            insights.append({
                "type": "critical",
                "title": f"Kubernetes Error Events: {len(error_events)}",
                "description": f"Most common error: {top_reason[0]} ({top_reason[1]} occurrences)",
                "recommendations": [
                    "Review error events for pod failures or resource issues",
                    "Check if errors are related to specific components",
                    "Verify resource limits and quotas"
                ]
            })
        
        if len(warning_events) > 10:
            insights.append({
                "type": "warning",
                "title": f"High Number of Warning Events: {len(warning_events)}",
                "description": "Multiple warning events may indicate cluster instability",
                "recommendations": [
                    "Review warning events for patterns",
                    "Check pod restart counts",
                    "Monitor resource utilization"
                ]
            })
        
        # Component-based insights
        for component, stats in results.get('components', {}).items():
            error_rate = stats['errors'] / max(stats['total_lines'], 1)
            
            if error_rate > 0.01:  # More than 1% errors
                insights.append({
                    "type": "critical",
                    "title": f"High Error Rate in {component}",
                    "description": f"{stats['errors']} errors in {stats['total_lines']} lines ({error_rate*100:.2f}%)",
                    "recommendations": [
                        f"Review {component} configuration and recent changes",
                        "Check for resource constraints or connectivity issues",
                        f"Analyze error patterns in {component} logs"
                    ]
                })
        
        # Pod health insights
        k8s_info = results.get('kubernetes_info', {})
        
        if k8s_info.get('pods_with_high_restarts', 0) > 0:
            insights.append({
                "type": "critical",
                "title": "Pods with High Restart Counts",
                "description": f"{k8s_info['pods_with_high_restarts']} pods have restarted more than 5 times",
                "recommendations": [
                    "Check pod logs for crash reasons",
                    "Review resource limits and requests",
                    "Verify application health checks"
                ]
            })
        
        if k8s_info.get('has_failed_pods'):
            insights.append({
                "type": "critical",
                "title": "Failed Pods Detected",
                "description": "One or more pods are in Failed or CrashLoopBackOff state",
                "recommendations": [
                    "Review describe_pods for failure reasons",
                    "Check container logs for errors",
                    "Verify image availability and configuration"
                ]
            })
        
        return insights
    
    def is_log_file(self, filepath: str) -> bool:
        """Check if file is a log file in KubeSOS context"""
        # All .log files and specific text outputs
        return (filepath.endswith('.log') or 
                filepath.endswith('_previous.log') or
                any(pattern in filepath for pattern in 
                    ['events', 'describe_', 'top_']))