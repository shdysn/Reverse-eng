import React, { useState, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  X,
  Check,
  ShieldCheck,
  FileCode,
  ArrowRight,
  Layers,
  GitCompare,
  Eye,
  Code2,
  RotateCcw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Cpu,
  Globe2,
} from 'lucide-react';
import type { RecoverSourceResponse } from '../types/index.js';

interface RecoveryDiffModalProps {
  isOpen: boolean;
  recoveryData: RecoverSourceResponse | null;
  onClose: () => void;
  onApplyVersion: (
    version: 'analyzed' | 'reconstructed',
    acceptedSymbolIds: string[],
    propagateCrossFileReferences: boolean
  ) => Promise<void>;
  onRestoreOriginal?: () => Promise<void>;
  onOpenRecoveredFile?: (path: string, name: string) => void;
}

export const RecoveryDiffModal: React.FC<RecoveryDiffModalProps> = ({
  isOpen,
  recoveryData,
  onClose,
  onApplyVersion,
  onRestoreOriginal,
  onOpenRecoveredFile,
}) => {
  const [selectedRightVersion, setSelectedRightVersion] = useState<'reconstructed' | 'analyzed'>(
    'reconstructed'
  );
  const [viewMode, setViewMode] = useState<'diff' | 'single' | 'inspector'>('diff');
  const [singleTab, setSingleTab] = useState<'original' | 'analyzed' | 'reconstructed'>(
    'reconstructed'
  );
  const [acceptedSymbolIds, setAcceptedSymbolIds] = useState<Set<string>>(new Set());
  const [propagateCrossFileReferences, setPropagateCrossFileReferences] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (recoveryData) {
      // Pre-select HIGH and MEDIUM confidence symbols by default
      const initialIds = new Set<string>();
      recoveryData.symbolMappings.forEach((sym, idx) => {
        const id = sym.id || `sym_${idx}`;
        if (sym.confidenceLevel !== 'LOW' && sym.confidence >= 55) {
          initialIds.add(id);
        }
      });
      setAcceptedSymbolIds(initialIds);
      setStatusMessage(null);
    }
  }, [recoveryData]);

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

  const toggleSymbolSelection = (id: string) => {
    setAcceptedSymbolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllSymbols = () => {
    const all = new Set<string>();
    recoveryData.symbolMappings.forEach((sym, idx) => {
      all.add(sym.id || `sym_${idx}`);
    });
    setAcceptedSymbolIds(all);
  };

  const deselectAllSymbols = () => {
    setAcceptedSymbolIds(new Set());
  };

  const handleApply = async (version: 'analyzed' | 'reconstructed') => {
    try {
      setIsApplying(true);
      setStatusMessage(null);
      await onApplyVersion(
        version,
        Array.from(acceptedSymbolIds),
        propagateCrossFileReferences
      );
      onClose();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRestore = async () => {
    if (!onRestoreOriginal) return;
    try {
      setIsRestoring(true);
      setStatusMessage(null);
      await onRestoreOriginal();
      setStatusMessage('Original decompiled file restored from backup.');
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleExportSource = () => {
    const contentToExport =
      viewMode === 'single' ? singleContent : rightContent;
    const blob = new Blob([contentToExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = recoveryData.fileName.replace(/\.(java|smali|kt)$/i, '');
    const ext = recoveryData.recoveredFilePath.endsWith('.kt') ? 'kt' : 'java';
    a.download = `${baseName}_reconstructed.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getConfidenceBadge = (level?: string, score?: number) => {
    const lvl = level || (score && score >= 80 ? 'HIGH' : score && score >= 55 ? 'MEDIUM' : 'LOW');
    if (lvl === 'HIGH') {
      return 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/50';
    }
    if (lvl === 'MEDIUM') {
      return 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/50';
    }
    return 'bg-[#f85149]/20 text-[#ff7b72] border-[#f85149]/50';
  };

  const validationPassed = recoveryData.validationReport?.overallPassed !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none">
      <div className="w-full max-w-6xl h-[90vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Bar */}
        <div className="px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
              <GitCompare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  AI Deobfuscation &amp; 3-Version Inspector
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] border border-[#30363d]">
                  {recoveryData.fileName}
                </span>
                {recoveryData.hasSmaliReference && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40">
                    Smali Correlated ({recoveryData.methodMappings?.length || 0} methods)
                  </span>
                )}
                {recoveryData.validationReport && (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
                      validationPassed
                        ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
                        : 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40'
                    }`}
                  >
                    {validationPassed ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {validationPassed ? '7/7 Validation Passed' : 'Validation Review'}
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
              <button
                type="button"
                onClick={() => setViewMode('inspector')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors ${
                  viewMode === 'inspector'
                    ? 'bg-[#21262d] text-white'
                    : 'text-[#8b949e] hover:text-[#c9d1d9]'
                }`}
              >
                <Cpu className="w-3.5 h-3.5 text-[#e3b341]" />
                <span>
                  Symbols, Smali &amp; Validation ({acceptedSymbolIds.size}/
                  {recoveryData.symbolMappings.length})
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportSource}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#c9d1d9]"
              title="Export Modified Source File"
            >
              <Download className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Export</span>
            </button>

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
        {viewMode !== 'inspector' && (
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
            <div className="flex items-center gap-3 text-[11px] font-mono text-[#8b949e]">
              <button
                type="button"
                onClick={() => setViewMode('inspector')}
                className="text-[#58a6ff] hover:underline"
              >
                Select/Reject Symbols ({acceptedSymbolIds.size}/{recoveryData.symbolMappings.length})
              </button>
            </div>
          </div>
        )}

        {/* Main Editor or Inspector Area */}
        <div className="flex-1 relative overflow-hidden bg-[#0d1117]">
          {viewMode === 'diff' ? (
            <DiffEditor
              theme="vs-dark"
              language={recoveryData.recoveredFilePath.endsWith('.kt') ? 'kotlin' : 'java'}
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
          ) : viewMode === 'single' ? (
            <textarea
              readOnly
              value={singleContent}
              className="w-full h-full bg-[#0d1117] text-[#c9d1d9] font-mono text-xs p-4 focus:outline-none resize-none leading-relaxed"
            />
          ) : (
            <div className="w-full h-full overflow-y-auto p-4 space-y-5 text-xs">
              {/* Section 1: 7-Point Automated Validation Suite */}
              {recoveryData.validationReport && (
                <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#3fb950]" />
                      7-Point Reconstruction Validation Suite
                    </h4>
                    <span className="text-[11px] font-mono text-[#8b949e]">
                      {recoveryData.validationReport.passedCount}/
                      {recoveryData.validationReport.totalChecks} checks passed
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {recoveryData.validationReport.checks.map((chk, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-start gap-2"
                      >
                        {chk.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#3fb950] shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#e3b341] shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-white">{chk.checkName}</div>
                          <div className="text-[10px] text-[#8b949e] leading-snug">
                            {chk.details}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: Interactive Symbol Selection with Confidence Scoring */}
              <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      Deobfuscation Symbol Suggestions ({acceptedSymbolIds.size} of{' '}
                      {recoveryData.symbolMappings.length} Accepted)
                    </h4>
                    <p className="text-[11px] text-[#8b949e]">
                      Accept or reject individual symbol renames. Rejected symbols keep their original names when applied.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllSymbols}
                      className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[11px] text-[#c9d1d9]"
                    >
                      Accept All
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllSymbols}
                      className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[11px] text-[#8b949e]"
                    >
                      Reject All
                    </button>
                  </div>
                </div>

                {recoveryData.symbolMappings.length === 0 ? (
                  <p className="text-[11px] text-[#8b949e]">
                    No obfuscated symbol renames required for this file.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recoveryData.symbolMappings.map((sym, idx) => {
                      const symId = sym.id || `sym_${idx}`;
                      const isAccepted = acceptedSymbolIds.has(symId);
                      return (
                        <div
                          key={symId}
                          onClick={() => toggleSymbolSelection(symId)}
                          className={`p-2.5 rounded border cursor-pointer transition-colors flex items-start gap-3 ${
                            isAccepted
                              ? 'bg-[#0d1117] border-[#3fb950]/50'
                              : 'bg-[#0d1117]/50 border-[#30363d] opacity-65'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isAccepted}
                            onChange={() => {}}
                            className="mt-1 accent-[#238636]"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-mono text-xs flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] text-[10px] uppercase">
                                  {sym.symbolType}
                                </span>
                                <span className="text-[#ff7b72]">{sym.originalName}</span>
                                <span className="text-[#8b949e]">→</span>
                                <strong className="text-[#3fb950]">{sym.suggestedName}</strong>
                                {sym.methodSignature && (
                                  <span className="text-[10px] text-[#8b949e] ml-1">
                                    [{sym.methodSignature}]
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                {sym.unsafeToRenameExternally && (
                                  <span
                                    title={sym.unsafeReason || 'External JNI/Manifest/Reflection lock'}
                                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40 flex items-center gap-1"
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>External Lock: {sym.unsafeReason || 'Protected API'}</span>
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getConfidenceBadge(
                                    sym.confidenceLevel,
                                    sym.confidence
                                  )}`}
                                >
                                  {sym.confidenceLevel || 'HIGH'} ({sym.confidence}%)
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-[#c9d1d9]">{sym.reasoning}</p>
                            {sym.evidenceFromReferences && (
                              <p className="text-[10px] font-mono text-[#8b949e]">
                                Evidence: {sym.evidenceFromReferences}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 3: JADX <-> Smali Method Correlation Table */}
              {recoveryData.methodMappings && recoveryData.methodMappings.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    JADX ↔ Smali Bytecode Method Correlation ({recoveryData.methodMappings.length})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-[#30363d] text-[#8b949e]">
                          <th className="py-1.5 px-2">JADX Method</th>
                          <th className="py-1.5 px-2">Smali Descriptor</th>
                          <th className="py-1.5 px-2">Return Type</th>
                          <th className="py-1.5 px-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recoveryData.methodMappings.map((m, i) => (
                          <tr key={i} className="border-b border-[#21262d] text-[#c9d1d9]">
                            <td className="py-1.5 px-2 text-[#58a6ff]">{m.jadxMethodSignature}</td>
                            <td className="py-1.5 px-2 text-[#e3b341] truncate max-w-[300px]">
                              {m.dexDescriptor}
                            </td>
                            <td className="py-1.5 px-2">{m.returnType}</td>
                            <td className="py-1.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  m.jadxComplete
                                    ? 'bg-[#238636]/20 text-[#3fb950]'
                                    : 'bg-[#d29922]/20 text-[#e3b341]'
                                }`}
                              >
                                {m.jadxComplete ? 'Verified' : 'Reconstructed from Smali'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Section 4: Duplicated Logic & Missing Functionality Notes */}
              {((recoveryData.duplicatedLogicNotes && recoveryData.duplicatedLogicNotes.length > 0) ||
                (recoveryData.missingFunctionalityNotes &&
                  recoveryData.missingFunctionalityNotes.length > 0)) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {recoveryData.duplicatedLogicNotes &&
                    recoveryData.duplicatedLogicNotes.length > 0 && (
                      <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                        <h5 className="text-[11px] font-bold uppercase text-[#8b949e] mb-1">
                          Duplicated Logic Analysis
                        </h5>
                        <ul className="list-disc list-inside text-[11px] text-[#c9d1d9] space-y-1">
                          {recoveryData.duplicatedLogicNotes.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {recoveryData.missingFunctionalityNotes &&
                    recoveryData.missingFunctionalityNotes.length > 0 && (
                      <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                        <h5 className="text-[11px] font-bold uppercase text-[#8b949e] mb-1">
                          Missing / Incomplete Logic Analysis
                        </h5>
                        <ul className="list-disc list-inside text-[11px] text-[#c9d1d9] space-y-1">
                          {recoveryData.missingFunctionalityNotes.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Action Footer */}
        <div className="px-4 py-3 bg-[#161b22] border-t border-[#30363d] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-[#8b949e]">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#3fb950] shrink-0" />
              <span>
                Backed up in <code className="text-[#c9d1d9]">recovered/originals/</code>
              </span>
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-[#c9d1d9]">
              <input
                type="checkbox"
                checked={propagateCrossFileReferences}
                onChange={(e) => setPropagateCrossFileReferences(e.target.checked)}
                className="accent-[#238636]"
              />
              <Globe2 className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Propagate Safe Renames Across Project (Protects JNI/Manifest/Reflection)</span>
            </label>

            {statusMessage && (
              <span className="text-[#3fb950] font-mono text-[11px]">{statusMessage}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onRestoreOriginal && (
              <button
                type="button"
                disabled={isRestoring}
                onClick={handleRestore}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-white font-medium"
                title="Restore Original Decompiled File from Backup"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isRestoring ? 'Restoring...' : 'Restore Original'}</span>
              </button>
            )}

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
                <span>Open Standalone</span>
              </button>
            )}

            <button
              type="button"
              disabled={isApplying}
              onClick={() => handleApply('analyzed')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border border-[#58a6ff]/50 text-[#58a6ff] font-semibold"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Apply Analyzed</span>
            </button>

            <button
              type="button"
              disabled={isApplying}
              onClick={() => handleApply('reconstructed')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold shadow"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {isApplying
                  ? 'Applying...'
                  : `Apply Selected (${acceptedSymbolIds.size} Symbols)`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
