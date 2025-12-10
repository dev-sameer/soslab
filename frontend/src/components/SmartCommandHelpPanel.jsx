import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search, X, AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useSmartCommandHelp, useMetricEvaluation } from '../hooks/useSmartCommandHelp';
import { SEVERITY } from '../utils/smartCommandDatabase';

/**
 * Smart Command Help Panel
 * Dynamic, responsive, feature-rich help system
 */
const SmartCommandHelpPanel = ({
  cmdName,
  isOpen = false,
  onClose,
  currentValues = {},
  showSearch = true,
  showSummary = true,
  compact = false
}) => {
  const {
    help,
    expandedSections,
    searchQuery,
    evaluations,
    filteredSections,
    toggleSection,
    expandAll,
    collapseAll,
    setSearchQuery,
    getHealthSummary,
    getWorstSeverity,
    updateValues
  } = useSmartCommandHelp(cmdName);

  // Update values when props change
  React.useEffect(() => {
    updateValues(currentValues);
  }, [currentValues, updateValues]);

  const healthSummary = useMemo(() => getHealthSummary(), [getHealthSummary]);
  const worstSeverity = useMemo(() => getWorstSeverity(), [getWorstSeverity]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-lg shadow-xl ${compact ? 'max-w-2xl' : 'max-w-4xl'} w-full max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 flex justify-between items-start">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{cmdName.toUpperCase()}</h2>
            <p className="text-blue-100">{help.description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-blue-800 rounded-full p-2 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Health Summary */}
        {showSummary && healthSummary.total > 0 && (
          <div className="bg-gray-50 border-b p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-700 mb-2">Health Summary</p>
                <div className="flex gap-4">
                  {healthSummary.good > 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-600">{healthSummary.good} Good</span>
                    </div>
                  )}
                  {healthSummary.warning > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      <span className="text-sm text-gray-600">{healthSummary.warning} Warning</span>
                    </div>
                  )}
                  {healthSummary.critical > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-gray-600">{healthSummary.critical} Critical</span>
                    </div>
                  )}
                </div>
              </div>
              <div className={`px-3 py-1 rounded text-sm font-semibold text-white`}
                style={{ background: getSeverityColor(worstSeverity) }}>
                {worstSeverity.toUpperCase()}
              </div>
            </div>
          </div>
        )}

        {/* Search Bar */}
        {showSearch && (
          <div className="bg-white border-b p-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search metrics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={expandAll}
                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
              >
                Collapse All
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {filteredSections.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No metrics found matching "{searchQuery}"</p>
            </div>
          ) : (
            filteredSections.map((section, sectionIdx) => (
              <Section
                key={sectionIdx}
                section={section}
                isExpanded={expandedSections.has(section.title)}
                onToggle={() => toggleSection(section.title)}
                evaluations={evaluations}
                compact={compact}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 border-t p-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 transition font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Section Component
 */
const Section = ({ section, isExpanded, onToggle, evaluations, compact }) => {
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full bg-gray-100 hover:bg-gray-200 p-4 flex items-center justify-between transition"
      >
        <div className="flex items-center gap-3 text-left flex-1">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-gray-600" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-600" />
          )}
          <div>
            <h3 className="font-bold text-gray-900">{section.title}</h3>
            {!compact && <p className="text-sm text-gray-600 mt-1">{section.explanation}</p>}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="bg-white p-4 space-y-4 border-t">
          {!compact && <p className="text-sm text-gray-600 mb-4">{section.explanation}</p>}
          {section.metrics.map((metric, metricIdx) => (
            <Metric
              key={metricIdx}
              metric={metric}
              evaluation={evaluations[metric.name]}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Metric Component
 */
const Metric = ({ metric, evaluation, compact }) => {
  const { color, icon } = useMetricEvaluation(metric, evaluation?.value);

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      {/* Metric Name and Status */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-gray-900">{metric.name}</h4>
        {evaluation && (
          <div className="flex items-center gap-2">
            <span style={{ color }} className="text-lg">{icon}</span>
            <span
              className="text-sm font-semibold px-2 py-1 rounded"
              style={{
                background: color + '20',
                color: color
              }}
            >
              {evaluation.message}
            </span>
          </div>
        )}
      </div>

      {/* Good/Bad Thresholds */}
      {!compact && (
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <p className="text-xs text-green-700 font-semibold mb-1">✓ GOOD</p>
            <p className="text-sm text-green-900 font-mono">{metric.good}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <p className="text-xs text-red-700 font-semibold mb-1">✗ BAD</p>
            <p className="text-sm text-red-900 font-mono">{metric.bad}</p>
          </div>
        </div>
      )}

      {/* Meaning */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-xs text-blue-700 font-semibold mb-1">💡 WHAT IT MEANS</p>
        <p className="text-sm text-blue-900 leading-relaxed">{metric.meaning}</p>
      </div>

      {/* Examples */}
      {metric.examples && metric.examples.length > 0 && !compact && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-gray-600 font-semibold mb-2">EXAMPLES</p>
          <ul className="text-sm text-gray-700 space-y-1">
            {metric.examples.map((example, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>{example}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unit */}
      {metric.unit && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-gray-600 font-semibold">UNIT: {metric.unit}</p>
        </div>
      )}
    </div>
  );
};

/**
 * Helper function to get severity color
 */
const getSeverityColor = (severity) => {
  const colors = {
    good: '#10b981',
    warning: '#f59e0b',
    critical: '#dc2626',
    info: '#6b7280'
  };
  return colors[severity] || colors.info;
};

/**
 * Smart Help Button
 */
export const SmartHelpButton = ({ cmdName, onClick, className = '' }) => {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-gray-200 transition ${className}`}
      title={`Help for ${cmdName}`}
    >
      <Info className="w-4 h-4 text-gray-600" />
    </button>
  );
};

/**
 * Inline Smart Help Card
 */
export const SmartInlineHelpCard = ({ cmdName, maxHeight = '400px', compact = false }) => {
  const {
    help,
    expandedSections,
    toggleSection,
    evaluations,
    filteredSections,
    setSearchQuery,
    searchQuery
  } = useSmartCommandHelp(cmdName);

  return (
    <div
      className="border rounded-lg bg-white overflow-hidden"
      style={{ maxHeight, overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="bg-blue-50 border-b p-4">
        <h3 className="font-bold text-gray-900">{cmdName.toUpperCase()}</h3>
        <p className="text-sm text-gray-600 mt-1">{help.description}</p>
      </div>

      {/* Search */}
      <div className="bg-white border-b p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Sections */}
      <div className="divide-y">
        {filteredSections.map((section, sectionIdx) => (
          <div key={sectionIdx} className="border-b last:border-b-0">
            <button
              onClick={() => toggleSection(section.title)}
              className="w-full bg-gray-50 hover:bg-gray-100 p-3 flex items-center justify-between transition text-left"
            >
              <div className="flex items-center gap-2 flex-1">
                {expandedSections.has(section.title) ? (
                  <ChevronDown className="w-4 h-4 text-gray-600" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                )}
                <h4 className="font-semibold text-sm text-gray-900">{section.title}</h4>
              </div>
            </button>

            {expandedSections.has(section.title) && (
              <div className="p-3 space-y-3 bg-white">
                {!compact && <p className="text-xs text-gray-600">{section.explanation}</p>}
                {section.metrics.map((metric, metricIdx) => (
                  <div key={metricIdx} className="text-xs border-l-2 border-blue-300 pl-3">
                    <p className="font-semibold text-gray-900">{metric.name}</p>
                    <p className="text-gray-600 mt-1">
                      <span className="text-green-700">✓ {metric.good}</span>
                      {' | '}
                      <span className="text-red-700">✗ {metric.bad}</span>
                    </p>
                    <p className="text-gray-700 mt-1">{metric.meaning}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartCommandHelpPanel;
