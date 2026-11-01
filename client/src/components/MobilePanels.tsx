import React from 'react';
import { X } from 'lucide-react';
import { FileTree } from './FileTree.js';
import { ManifestScanner } from './ManifestScanner.js';
import { AiCopilotPanel } from './AiCopilotPanel.js';
import type { FileTreeData, ManifestScanData, EditorTab } from '../types/index.js';
import type { AiPatchResponse } from '@android-re/shared';

interface MobilePanelsProps {
  explorerOpen: boolean;
  securityOpen: boolean;
  aiOpen: boolean;
  onCloseExplorer: () => void;
  onCloseSecurity: () => void;
  onCloseAi: () => void;
  treeData: FileTreeData | null;
  treeLoading: boolean;
  activePath: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  manifestData: ManifestScanData | null;
  manifestLoading: boolean;
  onRescanManifest: () => void;
  activeTab: EditorTab | null;
  onApplyChanges: (newContent: string) => void;
  onTransform: (instruction: string, selectedSnippet?: string) => Promise<AiPatchResponse | null>;
  isAiProcessing: boolean;
  lastAiResult: AiPatchResponse | null;
  onClearAiResult: () => void;
}

export const MobilePanels: React.FC<MobilePanelsProps> = ({
  explorerOpen,
  securityOpen,
  aiOpen,
  onCloseExplorer,
  onCloseSecurity,
  onCloseAi,
  treeData,
  treeLoading,
  activePath,
  expandedFolders,
  onToggleFolder,
  onOpenFile,
  manifestData,
  manifestLoading,
  onRescanManifest,
  activeTab,
  onApplyChanges,
  onTransform,
  isAiProcessing,
  lastAiResult,
  onClearAiResult,
}) => {
  if (!explorerOpen && !securityOpen && !aiOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={() => {
          if (explorerOpen) onCloseExplorer();
          if (securityOpen) onCloseSecurity();
          if (aiOpen) onCloseAi();
        }}
      />

      {/* Explorer Drawer */}
      {explorerOpen && (
        <div className="relative z-50 w-4/5 max-w-sm h-full bg-[#0d1117] flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
          <div className="h-12 bg-[#161b22] border-b border-[#30363d] px-3 flex items-center justify-between">
            <span className="font-semibold text-xs uppercase tracking-wider text-[#c9d1d9]">
              Explorer
            </span>
            <button
              type="button"
              onClick={onCloseExplorer}
              className="p-2 text-[#8b949e] hover:text-[#c9d1d9] rounded"
              aria-label="Close Explorer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <FileTree
              treeData={treeData}
              isLoading={treeLoading}
              activePath={activePath}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onOpenFile={(path, name) => {
                onOpenFile(path, name);
                onCloseExplorer();
              }}
            />
          </div>
        </div>
      )}

      {/* Security Drawer */}
      {securityOpen && (
        <div className="relative z-50 w-4/5 max-w-sm h-full bg-[#0d1117] ml-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="h-12 bg-[#161b22] border-b border-[#30363d] px-3 flex items-center justify-between">
            <span className="font-semibold text-xs uppercase tracking-wider text-[#c9d1d9]">
              Security Scanner
            </span>
            <button
              type="button"
              onClick={onCloseSecurity}
              className="p-2 text-[#8b949e] hover:text-[#c9d1d9] rounded"
              aria-label="Close Security Scanner"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ManifestScanner
              scanData={manifestData}
              isLoading={manifestLoading}
              onRescan={onRescanManifest}
            />
          </div>
        </div>
      )}

      {/* AI Copilot Drawer */}
      {aiOpen && (
        <div className="relative z-50 w-4/5 max-w-md h-full bg-[#0d1117] ml-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="h-12 bg-[#161b22] border-b border-[#30363d] px-3 flex items-center justify-between">
            <span className="font-semibold text-xs uppercase tracking-wider text-[#c9d1d9] flex items-center gap-1.5">
              AI Bytecode Copilot
            </span>
            <button
              type="button"
              onClick={onCloseAi}
              className="p-2 text-[#8b949e] hover:text-[#c9d1d9] rounded"
              aria-label="Close AI Copilot"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <AiCopilotPanel
              activeTab={activeTab}
              onApplyChanges={onApplyChanges}
              onTransform={onTransform}
              isProcessing={isAiProcessing}
              lastAiResult={lastAiResult}
              onClearAiResult={onClearAiResult}
            />
          </div>
        </div>
      )}
    </div>
  );
};
