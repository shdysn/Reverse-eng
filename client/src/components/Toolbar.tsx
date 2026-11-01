import React from 'react';
import {
  Upload,
  Save,
  RefreshCw,
  Hammer,
  Download,
  FolderTree,
  ShieldAlert,
  Terminal,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { RebuildData } from '../types/index.js';

interface ToolbarProps {
  hasSession: boolean;
  canSave: boolean;
  isSaving: boolean;
  isRebuilding: boolean;
  rebuildResult: RebuildData | null;
  onOpenUpload: () => void;
  onSaveFile: () => void;
  onRescanManifest: () => void;
  onRebuild: () => void;
  onResetWorkspace: () => void;
  onToggleMobileExplorer: () => void;
  onToggleMobileSecurity: () => void;
  onToggleAiCopilot?: () => void;
  aiCopilotOpen?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  hasSession,
  canSave,
  isSaving,
  isRebuilding,
  rebuildResult,
  onOpenUpload,
  onSaveFile,
  onRescanManifest,
  onRebuild,
  onResetWorkspace,
  onToggleMobileExplorer,
  onToggleMobileSecurity,
  onToggleAiCopilot,
  aiCopilotOpen = false,
}) => {
  return (
    <header className="h-14 bg-[#161b22] border-b border-[#30363d] px-3 flex items-center justify-between select-none shrink-0 z-20">
      {/* Brand & Subtitle */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#2f81f7]/15 border border-[#2f81f7]/30 flex items-center justify-center text-[#2f81f7] font-mono font-bold text-base shadow-sm">
          <Terminal className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-wide text-[#c9d1d9]">APK Studio</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 uppercase tracking-wider flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" />
              Authorized Use Only
            </span>
          </div>
          <p className="text-[11px] text-[#8b949e] hidden sm:block">
            Authorized Analysis &amp; Security Workspace
          </p>
        </div>
      </div>

      {/* Main Action Controls */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Mobile View Toggles */}
        <button
          type="button"
          onClick={onToggleMobileExplorer}
          className="md:hidden p-2 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] rounded transition-colors"
          title="Toggle Explorer"
          aria-label="Toggle File Explorer Drawer"
        >
          <FolderTree className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onToggleMobileSecurity}
          className="lg:hidden p-2 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] rounded transition-colors"
          title="Toggle Security Scanner"
          aria-label="Toggle Security Scanner Drawer"
        >
          <ShieldAlert className="w-4 h-4" />
        </button>

        {/* Upload Button */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white rounded border border-[#30363d] text-xs font-medium transition-all shadow-sm active:scale-95"
          title="Upload and decompile an APK"
        >
          <Upload className="w-3.5 h-3.5 text-[#2f81f7]" />
          <span className="hidden sm:inline">Upload APK</span>
        </button>

        {/* Save Button */}
        <button
          type="button"
          onClick={onSaveFile}
          disabled={!canSave || isSaving}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all shadow-sm ${
            canSave && !isSaving
              ? 'bg-[#238636] hover:bg-[#2ea043] border-[#3fb950]/50 text-white active:scale-95'
              : 'bg-[#21262d]/50 border-[#30363d]/50 text-[#8b949e]/50 cursor-not-allowed'
          }`}
          title={canSave ? 'Save Current File (Ctrl+S)' : 'No modified file to save'}
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save File'}</span>
        </button>

        {/* Rescan Manifest */}
        <button
          type="button"
          onClick={onRescanManifest}
          disabled={!hasSession}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all shadow-sm ${
            hasSession
              ? 'bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#c9d1d9] active:scale-95'
              : 'bg-[#21262d]/50 border-[#30363d]/50 text-[#8b949e]/50 cursor-not-allowed'
          }`}
          title={hasSession ? 'Rescan AndroidManifest.xml' : 'No active decompiled session'}
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#d29922]" />
          <span className="hidden md:inline">Rescan Manifest</span>
        </button>

        {/* AI Copilot Toggle */}
        <button
          type="button"
          onClick={onToggleAiCopilot}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all shadow-sm active:scale-95 ${
            aiCopilotOpen
              ? 'bg-gradient-to-r from-[#238636] to-[#2f81f7] text-white border-transparent'
              : 'bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#c9d1d9] hover:text-white'
          }`}
          title="Toggle Gemini AI Bytecode Copilot (Surgical Patcher)"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#e3b341]" />
          <span className="hidden sm:inline">AI Copilot</span>
        </button>

        {/* Rebuild APK */}
        <button
          type="button"
          onClick={onRebuild}
          disabled={!hasSession || isRebuilding}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all shadow-sm ${
            hasSession && !isRebuilding
              ? 'bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border-[#2f81f7]/50 text-[#58a6ff] active:scale-95'
              : 'bg-[#21262d]/50 border-[#30363d]/50 text-[#8b949e]/50 cursor-not-allowed'
          }`}
          title={hasSession ? 'Rebuild, align, and sign APK with disposable test key' : 'Upload an APK first'}
        >
          <Hammer className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isRebuilding ? 'Rebuilding...' : 'Rebuild APK'}</span>
        </button>

        {/* Download Signed APK */}
        {rebuildResult && (
          <a
            href={rebuildResult.downloadUrl}
            download="rebuilt-signed.apk"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#238636] hover:bg-[#2ea043] border border-[#3fb950] text-white rounded text-xs font-medium transition-all shadow-sm animate-pulse active:scale-95"
            title="Download verified signed APK"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Signed APK</span>
          </a>
        )}

        {/* Reset Workspace */}
        {hasSession && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset workspace and remove all session files?')) {
                onResetWorkspace();
              }
            }}
            className="p-1.5 text-[#8b949e] hover:text-[#f85149] hover:bg-[#21262d] rounded transition-colors"
            title="Reset Workspace & Delete Session"
            aria-label="Reset Workspace"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
