import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { 
  AlertTriangle, TrendingUp, FileSearch, Activity, ChevronRight, 
  Database, Server, GitBranch, Shield, AlertCircle, Info,
  CheckCircle, XCircle, Clock, Zap, RefreshCw, Sparkles
} from 'lucide-react';

function AnalysisDashboard({ data, sessionId }) {
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [enhancedAnalysis, setEnhancedAnalysis] = useState(null);
  const [enhancedStatus, setEnhancedStatus] = useState('not_started');
  const [isPolling, setIsPolling] = useState(false);

  // Prepare data for visualizations
  const patternData = Object.values(data?.patterns || {})
    .slice(0, 10)
    .map(p => ({
      name: p.template.substring(0, 30) + '...',
      count: p.count,
      severity: p.severity
    }));

  // Get component data for pie chart
  const componentData = Object.entries(data?.component_analysis || {})
    .map(([name, stats]) => ({
      name,
      value: stats.total_logs,
      errors: stats.error_count + stats.critical_count
    }))
    .filter(c => c.value > 0);

  // Get all error patterns
  const errorPatterns = Object.values(
    enhancedAnalysis?.patterns || data?.patterns || {}
  )
    .filter(p => p.severity === 'error' || p.severity === 'critical')
    .sort((a, b) => b.count - a.count);

  // GitLab insights - use enhanced if available
  const gitlabInsights = enhancedAnalysis?.gitlab_insights || data?.gitlab_insights || [];

  // Check enhanced analysis status on mount
  useEffect(() => {
    checkEnhancedStatus();
  }, [sessionId]);

  // Poll for enhanced analysis status
  useEffect(() => {
    let interval;
    if (isPolling) {
      interval = setInterval(checkEnhancedStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [isPolling, sessionId]);

  const checkEnhancedStatus = async () => {
    try {
      const response = await fetch(`/api/enhanced-analysis/${sessionId}/status`);
      const status = await response.json();
      
      setEnhancedStatus(status.status);
      
      if (status.status === 'completed' && status.has_results) {
        // Fetch enhanced results
        const resultsResponse = await fetch(`/api/enhanced-analysis/${sessionId}/results`);
        const results = await resultsResponse.json();
        setEnhancedAnalysis(results);
        setIsPolling(false);
      } else if (status.status === 'failed') {
        setIsPolling(false);
      }
    } catch (error) {
      console.error('Error checking enhanced status:', error);
    }
  };

  const startEnhancedAnalysis = async () => {
    try {
      const response = await fetch(`/api/enhanced-analysis/${sessionId}`, {
        method: 'POST'
      });
      const result = await response.json();
      
      if (result.status === 'started' || result.status === 'already_running') {
        setEnhancedStatus('running');
        setIsPolling(true);
      }
    } catch (error) {
      console.error('Error starting enhanced analysis:', error);
    }
  };

  // Severity colors
  const SEVERITY_COLORS = {
    critical: '#dc2626',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };

  const getComponentIcon = (component) => {
    const icons = {
      'gitlab-rails': <Server className="w-5 h-5" />,
      'postgresql': <Database className="w-5 h-5" />,
      'redis': <Database className="w-5 h-5" />,
      'gitaly': <GitBranch className="w-5 h-5" />,
      'nginx': <Shield className="w-5 h-5" />,
      'sidekiq': <Zap className="w-5 h-5" />
    };
    return icons[component] || <Server className="w-5 h-5" />;
  };

  const getInsightIcon = (type) => {
    const icons = {
      'database': <Database className="w-5 h-5" />,
      'cache': <Database className="w-5 h-5" />,
      'git_operations': <GitBranch className="w-5 h-5" />,
      'security': <Shield className="w-5 h-5" />,
      'component_health': <Activity className="w-5 h-5" />
    };
    return icons[type] || <Info className="w-5 h-5" />;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Enhanced Analysis Button */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6 rounded-lg shadow-lg text-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6" />
              GitLab Pattern Analysis
            </h3>
            <p className="text-sm mt-1 opacity-90">
              Use 20,000+ GitLab-specific patterns for deep analysis
            </p>
          </div>
          
          {enhancedStatus === 'not_started' && (
            <button
              onClick={startEnhancedAnalysis}
              className="px-6 py-3 bg-white text-purple-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Run Enhanced Analysis
            </button>
          )}
          
          {enhancedStatus === 'running' && (
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="font-semibold">Analyzing...</span>
            </div>
          )}
          
          {enhancedStatus === 'completed' && (
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">Analysis Complete</span>
            </div>
          )}
          
          {enhancedStatus === 'failed' && (
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5" />
              <span className="font-semibold">Analysis Failed</span>
            </div>
          )}
        </div>
        
        {enhancedStatus === 'completed' && enhancedAnalysis && (
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="bg-white/20 p-3 rounded">
              <p className="text-sm opacity-90">Patterns Matched</p>
              <p className="text-2xl font-bold">{Object.keys(enhancedAnalysis.patterns || {}).length}</p>
            </div>
            <div className="bg-white/20 p-3 rounded">
              <p className="text-sm opacity-90">Components Analyzed</p>
              <p className="text-2xl font-bold">{Object.keys(enhancedAnalysis.component_analysis || {}).length}</p>
            </div>
            <div className="bg-white/20 p-3 rounded">
              <p className="text-sm opacity-90">GitLab Insights</p>
              <p className="text-2xl font-bold">{enhancedAnalysis.gitlab_insights?.length || 0}</p>
            </div>
            <div className="bg-white/20 p-3 rounded">
              <p className="text-sm opacity-90">Pattern Coverage</p>
              <p className="text-2xl font-bold">
                {enhancedAnalysis.pattern_statistics?.pattern_match_rate 
                  ? `${(enhancedAnalysis.pattern_statistics.pattern_match_rate * 100).toFixed(1)}%`
                  : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Files</p>
              <p className="text-2xl font-bold">{data?.files_processed || 0}</p>
            </div>
            <FileSearch className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-gray-500">Log Lines</p>
              <p className="text-2xl font-bold">{(data?.total_lines || 0).toLocaleString()}</p>
            </div>
            <Activity className="w-8 h-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-gray-500">Error Patterns</p>
              <p className="text-2xl font-bold">{errorPatterns.length}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-gray-500">Components</p>
              <p className="text-2xl font-bold">{componentData.length}</p>
            </div>
            <Server className="w-8 h-8 text-purple-500" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-gray-500">Anomalies</p>
              <p className="text-2xl font-bold">{data?.anomalies?.length || 0}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-orange-500" />
          </div>
        </div>
      </div>

      {/* GitLab Insights Section - Show if available from either analysis */}
      {gitlabInsights.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            GitLab-Specific Insights
            {enhancedAnalysis && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full ml-2">Enhanced</span>}
          </h3>
          <div className="space-y-3">
            {gitlabInsights.map((insight, idx) => (
              <div
                key={idx}
                className={`border rounded-lg p-4 cursor-pointer transition-all ${
                  expandedInsight === idx ? 'bg-gray-50' : 'hover:bg-gray-50'
                }`}
                onClick={() => setExpandedInsight(expandedInsight === idx ? null : idx)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      insight.severity === 'critical' ? 'bg-red-100' :
                      insight.severity === 'high' ? 'bg-orange-100' :
                      insight.severity === 'medium' ? 'bg-yellow-100' :
                      'bg-blue-100'
                    }`}>
                      {getInsightIcon(insight.type)}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{insight.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{insight.details}</p>
                      {expandedInsight === idx && (
                        <div className="mt-3 text-sm">
                          <p className="text-gray-700">
                            <span className="font-medium">Affected Components:</span>{' '}
                            {insight.components?.join(', ')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${
                    expandedInsight === idx ? 'rotate-90' : ''
                  }`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Component Analysis */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Component Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={componentData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name} (${entry.value})`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {componentData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'][index % 5]}
                    onClick={() => setSelectedComponent(entry.name)}
                    style={{ cursor: 'pointer' }}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Top Error Patterns</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={patternData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill={(entry) => SEVERITY_COLORS[entry.severity] || '#8884d8'} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Enhanced Component Details */}
      {selectedComponent && (enhancedAnalysis?.component_analysis?.[selectedComponent] || data?.component_analysis?.[selectedComponent]) && (
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {getComponentIcon(selectedComponent)}
              {selectedComponent} Component Analysis
              {enhancedAnalysis?.component_analysis?.[selectedComponent] && 
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full ml-2">Enhanced</span>
              }
            </h3>
            <button
              onClick={() => setSelectedComponent(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded">
              <p className="text-sm text-gray-500">Total Logs</p>
              <p className="text-2xl font-bold">
                {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).total_logs}
              </p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded">
              <p className="text-sm text-gray-500">Critical Errors</p>
              <p className="text-2xl font-bold text-red-600">
                {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).critical_count}
              </p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded">
              <p className="text-sm text-gray-500">Errors</p>
              <p className="text-2xl font-bold text-orange-600">
                {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).error_count}
              </p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded">
              <p className="text-sm text-gray-500">Warnings</p>
              <p className="text-2xl font-bold text-yellow-600">
                {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).warning_count}
              </p>
            </div>
          </div>

          {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).top_errors?.length > 0 && (
            <div>
              <h4 className="font-medium mb-3">Top Errors in {selectedComponent}:</h4>
              <div className="space-y-2">
                {(enhancedAnalysis?.component_analysis?.[selectedComponent] || data.component_analysis[selectedComponent]).top_errors.map((error, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 rounded text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`px-2 py-1 text-xs rounded font-medium ${
                        error.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {error.severity}
                      </span>
                      <span className="text-gray-500">{error.count} occurrences</span>
                    </div>
                    <code className="text-xs text-gray-700 break-all">{error.template}</code>
                    {error.error_types?.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs text-gray-500">Error types: </span>
                        <span className="text-xs text-gray-700">{error.error_types.join(', ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Patterns with GitLab Context */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">
              GitLab Error Patterns Analysis
              {enhancedAnalysis && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full ml-2">Enhanced</span>}
            </h3>
            <p className="text-sm text-gray-500">
              {errorPatterns.length} error patterns with {errorPatterns.reduce((sum, p) => sum + p.count, 0)} total occurrences
            </p>
          </div>
        </div>
        
        <div className="border rounded-lg max-h-[600px] overflow-y-auto">
          <div className="divide-y divide-gray-100">
            {errorPatterns.map((pattern, idx) => (
              <div
                key={idx}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className={`text-center px-3 py-1 rounded-lg ${
                      pattern.count >= 10 ? 'bg-red-100 text-red-700' :
                      pattern.count >= 5 ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      <div className="text-lg font-bold">{pattern.count}</div>
                      <div className="text-xs">times</div>
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        pattern.severity === 'critical' 
                          ? 'bg-red-100 text-red-700' 
                          : 'bg-red-50 text-red-600'
                      }`}>
                        {pattern.severity}
                      </span>
                      {pattern.component && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 font-medium">
                          {pattern.component}
                        </span>
                      )}
                      {pattern.pattern_confidence && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 font-medium">
                          {(pattern.pattern_confidence * 100).toFixed(0)}% match
                        </span>
                      )}
                      {pattern.files && pattern.files.length > 0 && (
                        <span className="text-xs text-gray-500">
                          in {pattern.files.length} file{pattern.files.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <code className="text-sm font-mono text-gray-700 break-all block">
                      {pattern.template}
                    </code>
                    {pattern.error_types && pattern.error_types.length > 0 && (
                      <div className="mt-2 text-xs text-gray-600">
                        <span className="font-medium">Error classes:</span> {pattern.error_types.join(', ')}
                      </div>
                    )}
                    {pattern.gitlab_pattern && (
                      <div className="mt-1 text-xs text-green-600">
                        <span className="font-medium">GitLab pattern:</span> {pattern.gitlab_pattern}
                      </div>
                    )}
                  </div>
                  
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 group-hover:text-blue-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalysisDashboard;