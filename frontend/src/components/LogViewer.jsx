import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, FileText, Download, ChevronDown, ChevronRight,
  Folder, FolderOpen, AlertCircle, Loader, Trash2,
  Home, HardDrive
} from 'lucide-react';
import axios from 'axios';

function LogViewer({ sessionId, analysisData }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [fileContent, setFileContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [error, setError] = useState(null);
  const [fileCache, setFileCache] = useState({});
  const [treeView, setTreeView] = useState('tree');
  const [fileMetadata, setFileMetadata] = useState(null);

  // Lazy loading states
  const [lazyMode, setLazyMode] = useState(false);
  const [visibleLines, setVisibleLines] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [loadedChunks, setLoadedChunks] = useState(new Map());
  const containerRef = useRef(null);
  const linesCache = useRef(new Map());
  const scrollTimeout = useRef(null);
  const searchTimeout = useRef(null);

  const CHUNK_SIZE = 100;
  const BUFFER_SIZE = 50;
  const lineHeight = 20;

  // Build hierarchical file tree
  const fileTree = useMemo(() => {
    if (!analysisData?.log_files) return {};

    const tree = {};
    const rootName = sessionId ? sessionId.split('_').slice(2).join('_').replace(/\.(tar|gz|tgz|zip).*$/, '') : 'root';

    tree[rootName] = {
      type: 'folder',
      isRoot: true,
      children: {},
      path: '',
      fileCount: 0,
      totalSize: 0
    };

    const rootNode = tree[rootName];

    Object.entries(analysisData.log_files).forEach(([filePath, fileInfo]) => {
      const cleanPath = filePath.replace(/^\//, '');
      const parts = cleanPath.split('/').filter(p => p.length > 0);

      if (parts.length === 0) return;

      let currentNode = rootNode;
      let currentPath = '';

      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

        if (!currentNode.children[folderName]) {
          currentNode.children[folderName] = {
            type: 'folder',
            name: folderName,
            path: currentPath,
            children: {},
            fileCount: 0,
            totalSize: 0
          };
        }

        currentNode = currentNode.children[folderName];
      }

      const fileName = parts[parts.length - 1];
      currentNode.children[fileName] = {
        type: 'file',
        name: fileName,
        path: filePath,
        fullPath: filePath,
        service: fileInfo.service || 'unknown',
        size: fileInfo.size || 0,
        lines: fileInfo.lines || 0,
        fileType: fileInfo.file_type || 'log',
        isSuitable: fileInfo.is_suitable || false
      };

      let nodeToUpdate = currentNode;
      let pathParts = parts.slice(0, -1);

      while (nodeToUpdate) {
        nodeToUpdate.fileCount = (nodeToUpdate.fileCount || 0) + 1;
        nodeToUpdate.totalSize = (nodeToUpdate.totalSize || 0) + (fileInfo.size || 0);

        if (pathParts.length === 0) {
          nodeToUpdate = rootNode;
          rootNode.fileCount++;
          rootNode.totalSize += (fileInfo.size || 0);
          break;
        }

        pathParts.pop();
        nodeToUpdate = rootNode;
        for (const part of pathParts) {
          nodeToUpdate = nodeToUpdate.children[part];
        }
      }
    });

    const foldersToExpand = new Set([rootName]);

    const findImportantFolders = (node, path = '') => {
      if (node.type === 'folder' && node.children) {
        const childCount = Object.keys(node.children).length;
        const importantFolders = ['gitlab-rails', 'sidekiq', 'nginx', 'gitaly', 'var', 'log', 'postgresql', 'redis'];
        const folderName = path.split('/').pop() || path;

        if (importantFolders.includes(folderName.toLowerCase()) || childCount <= 5) {
          foldersToExpand.add(path);
        }

        Object.entries(node.children).forEach(([name, child]) => {
          const childPath = path ? `${path}/${name}` : name;
          if (child.type === 'folder') {
            findImportantFolders(child, childPath);
          }
        });
      }
    };

    findImportantFolders(rootNode, rootName);

    if (expandedFolders.size === 0) {
      setExpandedFolders(foldersToExpand);
    }

    return tree;
  }, [analysisData, sessionId]);

  const fileList = useMemo(() => {
    if (!analysisData?.log_files) return [];

    return Object.entries(analysisData.log_files).map(([path, info]) => ({
      path,
      name: path.split('/').pop() || path,
      ...info
    }));
  }, [analysisData]);

  // Load chunk for lazy mode with fallback
  const loadChunk = async (start, limit) => {
    const cacheKey = `${start}-${start + limit}`;

    if (loadedChunks.has(cacheKey)) {
      return;
    }

    try {
      // First try the chunk endpoint if it exists
      const response = await axios.get(
        `/api/logs/${sessionId}/${selectedFile}/chunk`,
        {
          params: {
            start,
            limit,
            search: searchTerm || undefined,
            severity: severityFilter !== 'all' ? severityFilter : undefined
          }
        }
      );

      response.data.lines.forEach((line, index) => {
        linesCache.current.set(start + index, line);
      });

      setLoadedChunks(prev => new Map(prev).set(cacheKey, true));

      return response.data.lines;
    } catch (err) {
      console.log(`Chunk endpoint failed, trying /more endpoint`);

      // Fallback to the /more endpoint that already exists
      try {
        const response = await axios.get(
          `/api/logs/${sessionId}/${selectedFile}/more`,
          {
            params: {
              offset: start,
              lines: limit
            }
          }
        );

        if (response.data && response.data.content) {
          response.data.content.forEach((line, index) => {
            linesCache.current.set(start + index, line);
          });

          setLoadedChunks(prev => new Map(prev).set(cacheKey, true));
          return response.data.content;
        }
      } catch (moreErr) {
        console.error(`Both endpoints failed for chunk ${start}-${start + limit}`);
      }

      return [];
    }
  };

  // Handle scroll for lazy loading
  const handleLazyScroll = useCallback(async () => {
    if (!containerRef.current || loading || !lazyMode) return;

    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const height = container.clientHeight;

    const startIndex = Math.floor(scrollTop / lineHeight);
    const endIndex = Math.ceil((scrollTop + height) / lineHeight);

    const bufferedStart = Math.max(0, startIndex - BUFFER_SIZE);
    const bufferedEnd = Math.min(totalLines, endIndex + BUFFER_SIZE);

    const chunksToLoad = [];
    for (let i = bufferedStart; i < bufferedEnd; i += CHUNK_SIZE) {
      const chunkStart = i;
      const chunkEnd = Math.min(i + CHUNK_SIZE, bufferedEnd);
      const cacheKey = `${chunkStart}-${chunkEnd}`;

      if (!loadedChunks.has(cacheKey)) {
        chunksToLoad.push({ start: chunkStart, limit: chunkEnd - chunkStart });
      }
    }

    if (chunksToLoad.length > 0) {
      setLoading(true);
      await Promise.all(
        chunksToLoad.map(chunk => loadChunk(chunk.start, chunk.limit))
      );
      setLoading(false);
    }

    const newVisibleLines = [];
    for (let i = startIndex; i < endIndex; i++) {
      if (linesCache.current.has(i)) {
        newVisibleLines.push({
          index: i,
          content: linesCache.current.get(i)
        });
      }
    }

    setVisibleLines(newVisibleLines);
  }, [loading, totalLines, searchTerm, severityFilter, lazyMode, selectedFile, sessionId]);

  // Load file content - OPTIMIZED TO NEVER LOAD FULL FILE
  useEffect(() => {
    if (!selectedFile || !sessionId) return;

    const loadFileContent = async () => {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setFileMetadata(null);
      setLazyMode(false);

      // Clear lazy mode caches
      linesCache.current.clear();
      setLoadedChunks(new Map());
      setVisibleLines([]);

      try {
        // ALWAYS check file size first - this is critical!
        let shouldUseLazyMode = false;
        let fileInfo = null;

        // Try to get file info from analysisData first (already available)
        if (analysisData?.log_files?.[selectedFile]) {
          fileInfo = analysisData.log_files[selectedFile];
          // Force lazy mode for large files based on what we already know
          shouldUseLazyMode = (fileInfo.size > 5 * 1024 * 1024) || (fileInfo.lines > 10000);
          console.log(`File info from analysis: size=${fileInfo.size}, lines=${fileInfo.lines}, lazy=${shouldUseLazyMode}`);
        }

        // If we already know it's a large file, go straight to lazy mode
        if (shouldUseLazyMode) {
          console.log('Large file detected - using lazy mode immediately');
          setLazyMode(true);
          setTotalLines(fileInfo.lines || 100000); // Use known lines or estimate

          // Try to get exact metadata if endpoint exists
          try {
            const metaResponse = await axios.get(`/api/logs/${sessionId}/${selectedFile}/metadata`);
            setFileMetadata(metaResponse.data);
            setTotalLines(metaResponse.data.estimated_lines);
          } catch (e) {
            console.log('Metadata endpoint not available, using estimates');
            // Create fake metadata from what we know
            setFileMetadata({
              size: fileInfo.size,
              estimated_lines: fileInfo.lines,
              size_mb: (fileInfo.size / (1024 * 1024)).toFixed(2)
            });
          }

          // Load initial chunk only
          await loadChunk(0, CHUNK_SIZE);

          // Trigger initial render
          setTimeout(() => {
            if (containerRef.current) {
              handleLazyScroll();
            }
          }, 100);

          return; // STOP HERE - don't load full file!
        }

        // For unknown files, try metadata endpoint first
        try {
          const metaResponse = await axios.get(`/api/logs/${sessionId}/${selectedFile}/metadata`);
          const metadata = metaResponse.data;
          setFileMetadata(metadata);

          // Check if we should use lazy mode based on metadata
          shouldUseLazyMode = metadata.size > 5 * 1024 * 1024 || metadata.estimated_lines > 10000;

          if (shouldUseLazyMode) {
            console.log('Metadata indicates large file - using lazy mode');
            setLazyMode(true);
            setTotalLines(metadata.estimated_lines);
            await loadChunk(0, CHUNK_SIZE);
            setTimeout(() => {
              if (containerRef.current) {
                handleLazyScroll();
              }
            }, 100);
            return; // STOP HERE - don't load full file!
          }
        } catch (metaErr) {
          console.log('Metadata endpoint not available');

          // CRITICAL: Without metadata, we must be conservative
          // Try to load just first chunk to test
          try {
            console.log('Testing with chunk endpoint first...');
            const testResponse = await axios.get(
              `/api/logs/${sessionId}/${selectedFile}/chunk`,
              { params: { start: 0, limit: 100 } }
            );

            if (testResponse.data && testResponse.data.lines) {
              // Chunk endpoint works! Use lazy mode to be safe
              console.log('Chunk endpoint available - using lazy mode for safety');
              setLazyMode(true);
              setTotalLines(fileInfo?.lines || 100000); // Estimate

              // Store the already loaded chunk
              testResponse.data.lines.forEach((line, index) => {
                linesCache.current.set(index, line);
              });
              setLoadedChunks(new Map([['0-100', true]]));

              setTimeout(() => {
                if (containerRef.current) {
                  handleLazyScroll();
                }
              }, 100);
              return;
            }
          } catch (chunkErr) {
            console.log('Chunk endpoint not available either');
          }
        }

        // Only load full file if we're SURE it's small
        // Check cache first
        if (fileCache[selectedFile]) {
          console.log('Using cached content');
          setFileContent(fileCache[selectedFile]);
          setLazyMode(false);
          return;
        }

        // LAST RESORT: Load full file only if we know it's small
        if (fileInfo && fileInfo.size < 1024 * 1024 && fileInfo.lines < 5000) {
          console.log('Small file confirmed - loading full content');
          const response = await axios.get(`/api/logs/${sessionId}/${selectedFile}`);
          setFileContent(response.data);

          // Cache small files
          setFileCache(prev => ({
            ...prev,
            [selectedFile]: response.data
          }));
        } else {
          // File size unknown or large - default to lazy mode for safety
          console.log('File size unknown - defaulting to lazy mode for safety');
          setLazyMode(true);
          setTotalLines(100000); // Default estimate
          setError('Large file detected. Showing first 100 lines. Scroll to load more.');

          // Try to load with the regular endpoint but with a limit
          try {
            const response = await axios.get(`/api/logs/${sessionId}/${selectedFile}/more`, {
              params: { offset: 0, lines: 100 }
            });

            if (response.data && response.data.content) {
              response.data.content.forEach((line, index) => {
                linesCache.current.set(index, line);
              });
              setLoadedChunks(new Map([['0-100', true]]));
            }
          } catch (e) {
            // Even this failed, show error
            setError('Unable to load file. It may be too large.');
          }

          setTimeout(() => {
            if (containerRef.current) {
              handleLazyScroll();
            }
          }, 100);
        }
      } catch (err) {
        console.error('Error loading file:', err);
        setError('Failed to load file content');
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [selectedFile, sessionId, analysisData]);

  // Setup scroll listener for lazy mode
  useEffect(() => {
    if (!lazyMode || !containerRef.current) return;

    const container = containerRef.current;

    const debouncedScroll = () => {
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(handleLazyScroll, 50);
    };

    container.addEventListener('scroll', debouncedScroll);
    handleLazyScroll(); // Initial load

    return () => {
      container.removeEventListener('scroll', debouncedScroll);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, [lazyMode, handleLazyScroll]);

  // Handle search change with debounce
  const handleSearchChange = useCallback((value) => {
    setSearchTerm(value);

    if (lazyMode) {
      // Clear cache and reload for lazy mode
      linesCache.current.clear();
      setLoadedChunks(new Map());
      setVisibleLines([]);

      clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        handleLazyScroll();
      }, 300);
    }
  }, [lazyMode, handleLazyScroll]);

  // Handle severity change
  const handleSeverityChange = useCallback((value) => {
    setSeverityFilter(value);

    if (lazyMode) {
      // Clear cache and reload for lazy mode
      linesCache.current.clear();
      setLoadedChunks(new Map());
      setVisibleLines([]);
      handleLazyScroll();
    }
  }, [lazyMode, handleLazyScroll]);

  // Get log level
  const getLogLevel = useCallback((line) => {
    if (typeof line !== 'string') return 'default';

    const lineLower = line.toLowerCase();

    if (lineLower.includes(' error ') || lineLower.includes(' error:') ||
      lineLower.includes(' fail ') || lineLower.includes('exception')) return 'error';
    if (lineLower.includes(' warn ') || lineLower.includes(' warning')) return 'warning';
    if (lineLower.includes(' info ')) return 'info';
    if (lineLower.includes(' debug ')) return 'debug';

    if (line.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.severity) {
          const severity = parsed.severity.toUpperCase();
          if (severity === 'ERROR' || severity === 'FATAL') return 'error';
          if (severity === 'WARN' || severity === 'WARNING') return 'warning';
          if (severity === 'INFO') return 'info';
          if (severity === 'DEBUG') return 'debug';
        }
      } catch {
        // Not JSON
      }
    }

    return 'default';
  }, []);

  // Filter content for normal mode
  const filteredContent = useMemo(() => {
    if (lazyMode) return []; // Don't filter in lazy mode
    if (!fileContent?.content || !Array.isArray(fileContent.content)) return [];

    let lines = fileContent.content;

    if (searchTerm) {
      lines = lines.filter(line =>
        typeof line === 'string' && line.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (severityFilter !== 'all') {
      lines = lines.filter(line => {
        if (typeof line !== 'string') return false;
        const level = getLogLevel(line);
        return level === severityFilter;
      });
    }

    return lines;
  }, [fileContent, searchTerm, severityFilter, getLogLevel, lazyMode]);

  const getLevelColor = useCallback((level) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      case 'debug': return 'text-gray-400';
      default: return 'text-gray-300';
    }
  }, []);

  const formatLogLine = useCallback((line) => {
    if (typeof line !== 'string') return String(line);

    // Skip JSON formatting for large content
    if ((lazyMode || filteredContent.length > 1000)) return line;

    if (line.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        return JSON.stringify(parsed, null, 2);
      } catch (e) {
        // Not valid JSON
      }
    }

    return line;
  }, [filteredContent.length, lazyMode]);

  const exportLogs = async () => {
    if (lazyMode) {
      // For lazy mode, try export endpoint first
      setLoading(true);
      try {
        const response = await axios.get(
          `/api/logs/${sessionId}/${selectedFile}/export`,
          {
            params: {
              search: searchTerm || undefined,
              severity: severityFilter !== 'all' ? severityFilter : undefined
            },
            responseType: 'blob'
          }
        );

        const url = URL.createObjectURL(response.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedFile?.split('/').pop() || 'logs'}_export.log`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.log('Export endpoint not available, using download endpoint');
        // Fallback to simple download
        const url = `/api/logs/${sessionId}/${selectedFile}/download`;
        window.open(url, '_blank');
      } finally {
        setLoading(false);
      }
    } else {
      // Normal export for small files
      const content = filteredContent.join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedFile?.split('/').pop() || 'logs'}_export.log`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const clearCache = () => {
    if (confirm('Clear all cached logs? You will need to reload files from the server.')) {
      setFileCache({});
      setFileContent(null);
      linesCache.current.clear();
      setLoadedChunks(new Map());
      localStorage.removeItem(`logCache_${sessionId}`);
    }
  };

  const toggleFolder = (folderPath) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFolderIcon = (name) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('gitlab')) return '🦊';
    if (lowerName.includes('nginx')) return '🌐';
    if (lowerName.includes('sidekiq')) return '⚡';
    if (lowerName.includes('redis')) return '📦';
    if (lowerName.includes('postgres')) return '🐘';
    if (lowerName.includes('git')) return '📚';
    if (lowerName === 'var' || lowerName === 'log') return '📁';
    return '📂';
  };

  const renderFileTree = (tree, basePath = '', level = 0) => {
    const items = [];

    const entries = Object.entries(tree).sort(([aName, aItem], [bName, bItem]) => {
      if (aItem.type === 'folder' && bItem.type === 'file') return -1;
      if (aItem.type === 'file' && bItem.type === 'folder') return 1;
      return aName.localeCompare(bName);
    });

    entries.forEach(([name, item]) => {
      const currentPath = basePath ? `${basePath}/${name}` : name;
      const paddingLeft = level * 20;

      if (item.type === 'folder') {
        const isExpanded = expandedFolders.has(currentPath) || expandedFolders.has(name);
        const hasChildren = Object.keys(item.children).length > 0;
        const isRoot = item.isRoot;

        items.push(
          <div key={currentPath}>
            <div
              className={`px-4 py-1.5 cursor-pointer flex items-center hover:bg-gray-700 transition-colors ${isRoot ? 'bg-gray-750 border-b border-gray-600 sticky top-0 z-10' : ''
                }`}
              style={{
                paddingLeft: `${16 + paddingLeft}px`,
                fontSize: '13px',
                fontWeight: '500',
                letterSpacing: '0.01em'
              }}
              onClick={() => toggleFolder(currentPath)}
            >
              {hasChildren && (
                isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 mr-1 flex-shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 mr-1 flex-shrink-0 text-gray-400" />
                )
              )}
              {!hasChildren && <div className="w-3.5 h-3.5 mr-1 flex-shrink-0" />}

              {isRoot ? (
                <HardDrive className="w-4 h-4 mr-2 flex-shrink-0 text-green-400" />
              ) : isExpanded ? (
                <FolderOpen className="w-4 h-4 mr-2 flex-shrink-0 text-blue-400" />
              ) : (
                <Folder className="w-4 h-4 mr-2 flex-shrink-0 text-blue-400" />
              )}

              <span className={`font-medium ${isRoot ? 'text-green-300' : 'text-gray-200'}`}>
                {isRoot && <span className="mr-1">{getFolderIcon(name)}</span>}
                {name}
              </span>

              <span className="ml-auto flex items-center gap-3" style={{ fontSize: '11px' }}>
                <span className="text-gray-400" style={{ letterSpacing: '0.02em' }}>
                  {item.fileCount || Object.keys(item.children).filter(k => item.children[k].type === 'file').length} files
                </span>
                {item.totalSize > 0 && (
                  <span className="text-gray-500" style={{ letterSpacing: '0.01em' }}>
                    {formatSize(item.totalSize)}
                  </span>
                )}
              </span>
            </div>

            {isExpanded && hasChildren && (
              <div className="relative">
                {level > 0 && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-px bg-gray-700"
                    style={{ left: `${28 + paddingLeft}px` }}
                  />
                )}
                {renderFileTree(item.children, currentPath, level + 1)}
              </div>
            )}
          </div>
        );
      } else if (item.type === 'file') {
        const isSelected = selectedFile === item.path;
        const isCached = fileCache[item.path] !== undefined;
        const fileIcon = item.fileType === 'json_log' ? '📊' :
          item.fileType === 'config' ? '⚙️' :
            item.fileType === 'command_output' ? '💻' : '📄';

        items.push(
          <div
            key={item.path}
            className={`px-4 py-1.5 cursor-pointer flex items-center transition-colors ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'
              }`}
            style={{
              paddingLeft: `${36 + paddingLeft}px`,
              fontSize: '12px',
              fontWeight: '500',
              letterSpacing: '0.01em'
            }}
            onClick={() => setSelectedFile(item.path)}
          >
            <span className="mr-2" style={{ fontSize: '11px' }}>{fileIcon}</span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className={`truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}
                style={{
                  fontSize: '12px',
                  letterSpacing: '0.01em'
                }}>
                {item.name}
              </span>
              {isCached && (
                <span className="px-1.5 py-0.5 bg-green-600 bg-opacity-20 text-green-400 rounded"
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    letterSpacing: '0.02em'
                  }}>
                  cached
                </span>
              )}
              {item.isSuitable && (
                <span className="px-1.5 py-0.5 bg-blue-600 bg-opacity-20 text-blue-400 rounded"
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    letterSpacing: '0.02em'
                  }}>
                  analyzed
                </span>
              )}
            </div>
            <div className="flex items-center gap-3" style={{ fontSize: '11px' }}>
              {item.lines > 0 && (
                <span className={isSelected ? 'text-blue-100' : 'text-gray-400'}
                  style={{ letterSpacing: '0.01em' }}>
                  {item.lines.toLocaleString()} lines
                </span>
              )}
              {item.size > 0 && (
                <span className={isSelected ? 'text-blue-100' : 'text-gray-500'}
                  style={{ letterSpacing: '0.01em' }}>
                  {formatSize(item.size)}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded ${isSelected ? 'bg-blue-700 text-blue-100' : 'bg-gray-700 text-gray-400'
                }`} style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  letterSpacing: '0.02em'
                }}>
                {item.service}
              </span>
            </div>
          </div>
        );
      }
    });

    return items;
  };

  const stats = useMemo(() => {
    if (lazyMode) {
      // Don't calculate stats in lazy mode
      return { total: totalLines, errors: 0, warnings: 0, info: 0, sampled: true };
    }

    if (!filteredContent) return { total: 0, errors: 0, warnings: 0, info: 0 };

    const sampleSize = filteredContent.length > 10000 ? 1000 : filteredContent.length;
    const sample = filteredContent.slice(0, sampleSize);

    let errors = 0, warnings = 0, info = 0;

    sample.forEach(line => {
      const level = getLogLevel(line);
      if (level === 'error') errors++;
      else if (level === 'warning') warnings++;
      else if (level === 'info') info++;
    });

    if (sampleSize < filteredContent.length) {
      const ratio = filteredContent.length / sampleSize;
      errors = Math.round(errors * ratio);
      warnings = Math.round(warnings * ratio);
      info = Math.round(info * ratio);
    }

    return {
      total: filteredContent.length,
      errors,
      warnings,
      info,
      sampled: sampleSize < filteredContent.length
    };
  }, [filteredContent, getLogLevel, lazyMode, totalLines]);

  return (
    <div className="h-full flex bg-gray-900">
      {/* File List Sidebar */}
      <div className="w-96 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-white" style={{
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '-0.01em'
              }}>Log Files</h3>
              <p className="text-gray-400 mt-1" style={{
                fontSize: '12px',
                letterSpacing: '0.01em'
              }}>
                {fileList.length} files • {Object.keys(fileTree).length > 0 && `${Object.keys(fileTree)[0]}`}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setTreeView(treeView === 'tree' ? 'flat' : 'tree')}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                title={`Switch to ${treeView === 'tree' ? 'flat' : 'tree'} view`}
              >
                {treeView === 'tree' ? <FileText className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
              </button>
              <button
                onClick={clearCache}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                title="Clear cache"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setExpandedFolders(new Set())}
              className="px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              style={{
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.02em'
              }}
            >
              Collapse All
            </button>
            <button
              onClick={() => {
                const allFolders = new Set();
                const collectFolders = (tree, path = '') => {
                  Object.entries(tree).forEach(([name, item]) => {
                    const currentPath = path ? `${path}/${name}` : name;
                    if (item.type === 'folder') {
                      allFolders.add(currentPath);
                      if (item.children) {
                        collectFolders(item.children, currentPath);
                      }
                    }
                  });
                };
                collectFolders(fileTree);
                setExpandedFolders(allFolders);
              }}
              className="px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              style={{
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.02em'
              }}
            >
              Expand All
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="py-1">
            {treeView === 'tree' ? (
              renderFileTree(fileTree)
            ) : (
              fileList.map(file => (
                <div
                  key={file.path}
                  className={`px-4 py-2 cursor-pointer flex items-center ${selectedFile === file.path ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'
                    }`}
                  style={{
                    fontSize: '12px',
                    fontWeight: '500',
                    letterSpacing: '0.01em'
                  }}
                  onClick={() => setSelectedFile(file.path)}
                >
                  <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium" style={{ fontSize: '12px' }}>{file.path}</div>
                    <div className="opacity-60" style={{
                      fontSize: '11px',
                      letterSpacing: '0.01em'
                    }}>
                      {file.lines?.toLocaleString()} lines • {file.service}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            {/* Header */}
            <div className="bg-gray-800 border-b border-gray-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white" style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    letterSpacing: '-0.01em'
                  }}>
                    {selectedFile.split('/').pop()}
                  </h2>
                  <p className="text-gray-400 font-mono" style={{
                    fontSize: '11px',
                    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                    letterSpacing: '0.02em'
                  }}>
                    {selectedFile}
                  </p>
                  {analysisData?.log_files?.[selectedFile] && (
                    <p className="text-gray-500 mt-1" style={{
                      fontSize: '11px',
                      letterSpacing: '0.01em'
                    }}>
                      Service: {analysisData.log_files[selectedFile].service} •
                      Type: {analysisData.log_files[selectedFile].file_type || 'log'}
                      {fileMetadata && (
                        <span> • Size: {fileMetadata.size_mb} MB</span>
                      )}
                    </p>
                  )}
                </div>
                <button
                  onClick={exportLogs}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 flex items-center disabled:opacity-50"
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    letterSpacing: '0.01em'
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </button>
              </div>

              {/* Search and Filters */}
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder={lazyMode ? "Search (server-side)..." : "Search in this file..."}
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{
                      fontSize: '12px',
                      letterSpacing: '0.01em'
                    }}
                  />
                </div>

                <select
                  value={severityFilter}
                  onChange={(e) => handleSeverityChange(e.target.value)}
                  className="px-4 py-2 bg-gray-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{
                    fontSize: '12px',
                    letterSpacing: '0.01em'
                  }}
                >
                  <option value="all">All Levels</option>
                  <option value="error">Errors</option>
                  <option value="warning">Warnings</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 mt-4" style={{ fontSize: '12px' }}>
                <span className="text-gray-400" style={{ letterSpacing: '0.01em' }}>
                  {lazyMode ? (
                    <>
                      Viewing {visibleLines.length} of {totalLines.toLocaleString()} lines
                      {searchTerm && ` (filtered by "${searchTerm}")`}
                    </>
                  ) : (
                    <>
                      {stats.total.toLocaleString()} lines
                      {searchTerm && ` matching "${searchTerm}"`}
                      {stats.sampled && ' (stats estimated)'}
                    </>
                  )}
                </span>
                {!lazyMode && stats.errors > 0 && (
                  <span className="text-red-400" style={{ fontSize: '11px' }}>
                    <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                    {stats.errors} errors
                  </span>
                )}
                {!lazyMode && stats.warnings > 0 && (
                  <span className="text-yellow-400" style={{ fontSize: '11px' }}>
                    <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                    {stats.warnings} warnings
                  </span>
                )}
                {!lazyMode && stats.info > 0 && (
                  <span className="text-blue-400" style={{ fontSize: '11px' }}>
                    <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                    {stats.info} info
                  </span>
                )}
                {(lazyMode || filteredContent.length > 10000) && (
                  <span className="ml-auto text-green-400" style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    letterSpacing: '0.02em'
                  }}>
                    ⚡ {lazyMode ? 'Lazy loading' : 'Performance'} mode active
                  </span>
                )}
              </div>
            </div>

            // Replace the log content rendering section (starting around line 1234)

            {/* Log Content */}
            <div
              ref={containerRef}
              className="flex-1 overflow-auto bg-gray-900"
              style={{ fontFamily: '"SF Mono", Monaco, Consolas, monospace' }}
            >
              {loading && !lazyMode ? (
                <div className="flex items-center justify-center h-full">
                  <Loader className="w-8 h-8 text-gray-400 animate-spin" />
                </div>
              ) : error ? (
                <div className="p-4 text-center text-red-400">
                  <AlertCircle className="w-12 h-12 mx-auto mb-2" />
                  <p style={{ fontSize: '13px' }}>{error}</p>
                </div>
              ) : lazyMode ? (
                // LAZY MODE RENDERING - Fixed sizes
                <div style={{ height: totalLines * 16, position: 'relative' }}>
                  <div
                    style={{
                      transform: `translateY(${Math.floor((containerRef.current?.scrollTop || 0) / 16) * 16}px)`,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0
                    }}
                  >
                    {visibleLines.map(({ index, content }) => {
                      const level = getLogLevel(content);
                      const color = getLevelColor(level);

                      return (
                        <div
                          key={index}
                          className="flex hover:bg-gray-800"
                          style={{ height: '16px', fontSize: '11px !important' }}
                        >
                          <span className="text-gray-600 flex-shrink-0 select-none text-right"
                            style={{
                              width: '50px',
                              paddingRight: '8px',
                              fontSize: '10px',
                              fontFamily: 'monospace',
                              color: '#6b7280'
                            }}>
                            {index + 1}
                          </span>
                          <pre className={`flex-1 px-1 ${color}`}
                            style={{
                              fontSize: '11px !important',
                              fontFamily: '"SF Mono", Monaco, Consolas, monospace',
                              lineHeight: '16px',
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              display: 'block'
                            }}>
                            {content}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                  {loading && (
                    <div className="fixed bottom-4 right-4 bg-gray-800 px-3 py-2 rounded shadow-lg">
                      <Loader className="w-4 h-4 text-blue-400 animate-spin inline mr-2" />
                      <span style={{ fontSize: '11px', color: '#d1d5db' }}>Loading chunks...</span>
                    </div>
                  )}
                </div>
              ) : filteredContent && filteredContent.length > 0 ? (
                // NORMAL MODE RENDERING - Fixed sizes
                <div className="p-2">
                  {filteredContent.map((line, index) => {
                    const level = getLogLevel(line);
                    const color = getLevelColor(level);
                    const formattedLine = formatLogLine(line);

                    return (
                      <div key={index} className="flex hover:bg-gray-800" style={{ minHeight: '16px', paddingTop: '1px', paddingBottom: '1px' }}>
                        <span
                          style={{
                            width: '50px',
                            flexShrink: 0,
                            textAlign: 'right',
                            paddingRight: '8px',
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            color: '#6b7280',
                            userSelect: 'none'
                          }}>
                          {index + 1}
                        </span>
                        <pre className={color}
                          style={{
                            flex: 1,
                            fontSize: '11px !important',
                            fontFamily: '"SF Mono", Monaco, Consolas, monospace',
                            lineHeight: '11px',
                            margin: 0,
                            padding: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            display: 'block'
                          }}>
                          {formattedLine}
                        </pre>
                      </div>
                    );
                  })}

                  {fileContent?.total_lines > filteredContent.length && (
                    <div className="mt-4 p-4 bg-gray-800 rounded text-center">
                      <p style={{ fontSize: '11px', color: '#9ca3af' }}>
                        Showing {filteredContent.length.toLocaleString()} lines of {fileContent.total_lines.toLocaleString()} total
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p style={{ fontSize: '13px', color: '#6b7280' }}>
                    {fileContent || lazyMode ? 'No logs match your filters' : 'Loading...'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p style={{
                fontSize: '16px',
                fontWeight: '500',
                letterSpacing: '-0.01em'
              }}>Select a log file to view its contents</p>
              <p className="mt-2" style={{
                fontSize: '13px',
                letterSpacing: '0.01em'
              }}>Navigate the directory tree on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LogViewer;