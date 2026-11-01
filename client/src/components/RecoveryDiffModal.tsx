import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  X,
  Check,
  ShieldCheck,
  Sparkles,
  FileCode,
  ArrowRight,
  Layers,
  GitCompare,
  Eye,
  Code2,
} from 'lucide-react';
import type { RecoverSourceResponse } from '../types/index.js';

interface RecoveryDiffModalProps {
  isOpen: boolean;
  recoveryData: RecoverSourceResponse | null;
  onClose: () => void;
  onApplyVersion: (version: 'analyzed' | 'reconstructed') => Promise<void>;
  onOpenRecoveredFile?: (path: string, name: string) => void;
}

export const RecoveryDiffModal: React.FC<RecoveryDiffModalProps> = ({
  isOpen,
  recoveryData,
  onClose,
  onApplyVersion,
  onOpenRecoveredFile,
}) => {
  const [selectedRightVersion, setSelectedRightVersion] = useState<'reconstructed' | 'analyzed'>(
    'reconstructed'
  );
  const [viewMode, setViewMode] = useState<'diff' | 'single'>('diff');
  const [singleTab, setSingleTab] = useState<'original' | 'analyzed' | 'reconstructed'>(
    'reconstructed'
  );
  const [isApplying, setIsApplying] = useState(false);

  if (!isOpen || !recoveryData) return null;

  const rightContent =
    selectedRightVersion === 'reconstructed'
      ? recoveryData.reconstructedContent
      : recoveryData.analyzedContent;

  const singleContent =
    singleTab === 'original'
      ? recoveryData.originalContent
      : singleTab === 'analyzed'
      ? recoveryData.analyzedContent
      : recoveryData.reconstructedContent;

  const handleApply = async (version: 'analyzed' | 'reconstructed') => {
    try {
      setIsApplying(true);
      await onApplyVersion(version);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none">
      <div className="w-full max-w-6xl h-[88vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Bar */}
        <div className="px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
              <GitCompare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  AI Source Code Recovery &amp; 3-Version Inspector
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] border border-[#30363d]">
                  {recoveryData.fileName}
                </span>
                {recoveryData.hasSmaliReference && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40">
                    Smali Cross-Verified
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#8b949e]">
                Original file is preserved untouched. Saved to{' '}
                <code className="text-[#3fb950]">{recoveryData.recoveredFilePath}</code>
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('diff')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors ${
                  viewMode === 'diff'
                    ? 'bg-[#21262d] text-white'
                    : 'text-[#8b949e] hover:text-[#c9d1d9]'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5 text-[#58a6ff]" />
                <span>Side-by-Side Diff</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('single')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors ${
                  viewMode === 'single'
                    ? 'bg-[#21262d] text-white'
                    : 'text-[#8b949e] hover:text-[#c9d1d9]'
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-[#3fb950]" />
                <span>3-Version Tabs</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8b949e] hover:text-white rounded hover:bg-[#21262d]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Version Sub-Toolbar */}
        <div className="px-4 py-2 bg-[#0d1117] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          {viewMode === 'diff' ? (
            <div className="flex items-center gap-3">
              <span className="text-[#8b949e] font-mono flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-[#f85149]" />
                Left: <strong className="text-[#c9d1d9]">Original Decompiled Source</strong>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[#8b949e]" />
              <div className="flex items-center gap-1.5">
                <span className="text-[#8b949e] font-mono">Right:</span>
                <button
                  type="button"
                  onClick={() => setSelectedRightVersion('reconstructed')}
                  className={`px-2.5 py-1 rounded font-medium border transition-colors ${
                    selectedRightVersion === 'reconstructed'
                      ? 'bg-[#238636]/20 border-[#3fb950] text-[#3fb950]'
                      : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                  }`}
                >
                  Reconstructed Source (De-obfuscated)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRightVersion('analyzed')}
                  className={`px-2.5 py-1 rounded font-medium border transition-colors ${
                    selectedRightVersion === 'analyzed'
                      ? 'bg-[#2f81f7]/20 border-[#58a6ff] text-[#58a6ff]'
                      : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                  }`}
                >
                  AI Analyzed Source (Annotated)
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSingleTab('original')}
                className={`px-3 py-1 rounded font-medium border transition-colors ${
                  singleTab === 'original'
                    ? 'bg-[#21262d] border-[#f85149] text-white'
                    : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                }`}
              >
                1. Original Decompiled Source
              </button>
              <button
                type="button"
                onClick={() => setSingleTab('analyzed')}
                className={`px-3 py-1 rounded font-medium border transition-colors ${
                  singleTab === 'analyzed'
                    ? 'bg-[#2f81f7]/20 border-[#58a6ff] text-[#58a6ff]'
                    : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                }`}
              >
                2. AI Analyzed Source (Annotated)
              </button>
              <button
                type="button"
                onClick={() => setSingleTab('reconstructed')}
                className={`px-3 py-1 rounded font-medium border transition-colors ${
                  singleTab === 'reconstructed'
                    ? 'bg-[#238636]/20 border-[#3fb950] text-[#3fb950]'
                    : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                }`}
              >
                3. Reconstructed Source (Clean Java/Kotlin)
              </button>
            </div>
          )}

          {/* Symbol Mappings Summary Pill */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#8b949e]">
            <span>
              Symbols Recovered:{' '}
              <strong className="text-[#3fb950]">{recoveryData.symbolMappings.length}</strong>
            </span>
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 relative overflow-hidden bg-[#0d1117]">
          {viewMode === 'diff' ? (
            <DiffEditor
              theme="vs-dark"
              language="java"
              original={recoveryData.originalContent}
              modified={rightContent}
              options={{
                readOnly: true,
                renderSideBySide: true,
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
              }}
            />
          ) : (
            <textarea
              readOnly
              value={singleContent}
              className="w-full h-full bg-[#0d1117] text-[#c9d1d9] font-mono text-xs p-4 focus:outline-none resize-none leading-relaxed"
            />
          )}
        </div>

        {/* Bottom Action Footer */}
        <div className="px-4 py-3 bg-[#161b22] border-t border-[#30363d] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 text-[#8b949e]">
            <ShieldCheck className="w-4 h-4 text-[#3fb950] shrink-0" />
            <span>
              Code Safety Guarantee: Original decompiled file is backed up in{' '}
              <code className="text-[#c9d1d9]">recovered/originals/</code> before applying any change.
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenRecoveredFile && (
              <button
                type="button"
                onClick={() => {
                  onOpenRecoveredFile(
                    recoveryData.recoveredFilePath,
                    `[Recovered] ${recoveryData.fileName}`
                  );
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] font-medium"
              >
                <Code2 className="w-3.5 h-3.5 text-[#58a6ff]" />
                <span>Open Standalone in Editor</span>
              </button>
            )}

            <button
              type="button"
              disabled={isApplying}
              onClick={() => handleApply('analyzed')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border border-[#58a6ff]/50 text-[#58a6ff] font-semibold"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Apply Analyzed Source</span>
            </button>

            <button
              type="button"
              disabled={isApplying}
              onClick={() => handleApply('reconstructed')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold shadow"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isApplying ? 'Applying...' : 'Apply Reconstructed Source'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
