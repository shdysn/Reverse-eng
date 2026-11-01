import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileSpreadsheet,
  File,
  ChevronRight,
  ChevronDown,
  Lock,
  Layers,
  Sparkles,
  Search,
} from 'lucide-react';
import type { TreeNode, FileTreeData } from '../types/index.js';

interface FileTreeProps {
  treeData: FileTreeData | null;
  isLoading: boolean;
  activePath: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  treeData,
  isLoading,
  activePath,
  expandedFolders,
  onToggleFolder,
  onOpenFile,
}) => {
  const [filterText, setFilterText] = useState('');

  const getFileIcon = (fileName: string) => {
    const lower = fileName.toLowerCase();
    if (lower === 'androidmanifest.xml') {
      return <Layers className="w-4 h-4 text-[#58a6ff] shrink-0" />;
    }
    if (lower.endsWith('.smali')) {
      return <Sparkles className="w-4 h-4 text-[#d29922] shrink-0" />;
    }
    if (lower.endsWith('.java')) {
      return <FileCode className="w-4 h-4 text-[#e36209] shrink-0" />;
    }
    if (lower.endsWith('.xml')) {
      return <FileSpreadsheet className="w-4 h-4 text-[#7ee787] shrink-0" />;
    }
    if (lower.endsWith('.json')) {
      return <FileText className="w-4 h-4 text-[#f0883e] shrink-0" />;
    }
    return <File className="w-4 h-4 text-[#8b949e] shrink-0" />;
  };

  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = activePath === node.path;

    if (filterText) {
      // If filtering, only display matching files or directories containing matching files
      const match = node.name.toLowerCase().includes(filterText.toLowerCase());
      if (node.type === 'file' && !match) return null;
    }

    if (node.type === 'directory') {
      const hasChildren = node.children && node.children.length > 0;

      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => onToggleFolder(node.path)}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
            className={`flex items-center gap-1.5 py-1 px-2 text-xs font-mono rounded cursor-pointer transition-colors ${
              isActive
                ? 'bg-[#21262d] text-white'
                : 'text-[#c9d1d9] hover:bg-[#161b22] hover:text-white'
            }`}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-[#2f81f7] shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-[#2f81f7] shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>

          {/* Children container */}
          {isExpanded && (
            <div>
              {hasChildren ? (
                node.children!.map((child) => renderNode(child, depth + 1))
              ) : (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
                  className="py-1 text-[11px] text-[#8b949e]/60 italic font-mono"
                >
                  (empty)
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // File Node
    return (
      <div
        key={node.path}
        onClick={() => {
          if (!node.binary) {
            onOpenFile(node.path, node.name);
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 18}px` }}
        className={`flex items-center justify-between py-1 px-2 text-xs font-mono rounded transition-colors ${
          node.binary ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        } ${
          isActive
            ? 'bg-[#2f81f7]/20 text-[#58a6ff] font-medium'
            : 'text-[#c9d1d9] hover:bg-[#161b22] hover:text-white'
        }`}
        title={node.binary ? `${node.name} (Binary file - non-editable)` : node.path}
      >
        <div className="flex items-center gap-1.5 truncate">
          {getFileIcon(node.name)}
          <span className="truncate">{node.name}</span>
        </div>

        {node.binary && (
          <span className="flex items-center gap-0.5 text-[9px] uppercase px-1 py-0.2 bg-[#30363d] text-[#8b949e] rounded shrink-0">
            <Lock className="w-2.5 h-2.5" />
            bin
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-r border-[#30363d] overflow-hidden select-none">
      {/* Header & Search */}
      <div className="p-2 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wider font-bold text-[#8b949e]">
            Explorer
          </span>
          {treeData?.truncated && (
            <span className="text-[10px] text-[#d29922]" title="Tree truncated to maximum limits">
              (Truncated)
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2 top-2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-7 pr-2 py-1 text-xs bg-[#010409] text-[#c9d1d9] border border-[#30363d] rounded focus:outline-none focus:border-[#2f81f7]"
          />
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-1 text-xs">
        {isLoading && (
          <div className="p-4 text-center text-[#8b949e] font-mono text-xs">
            Loading file tree...
          </div>
        )}

        {!isLoading && (!treeData || treeData.tree.length === 0) && (
          <div className="p-6 text-center text-[#8b949e] text-xs">
            <p>No decompiled files.</p>
            <p className="mt-1 text-[11px] text-[#8b949e]/60">Upload an APK to begin analysis.</p>
          </div>
        )}

        {!isLoading && treeData && treeData.tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
};
