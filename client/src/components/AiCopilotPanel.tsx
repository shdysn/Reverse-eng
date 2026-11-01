import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Check,
  Zap,
  Code2,
  FileCode,
  Lock,
  Radio,
  FileSpreadsheet,
  ArrowRight,
  ShieldCheck,
  Globe2,
  Layers,
  FileText,
  Search,
  ExternalLink,
  Cpu,
  Box,
  GitCompare,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Binary,
  FolderGit2,
} from 'lucide-react';
import { EditorTab } from '../types/index.js';
import {
  AiPatchAction,
  AiPatchResponse,
  AiProjectSolutionResponse,
  AiProjectFileProposal,
  RecoveryArchitectureAudit,
  RecoverSourceResponse,
} from '@android-re/shared';
import { api } from '../services/api.js';
import { RecoveryDiffModal } from './RecoveryDiffModal.js';

interface AiCopilotPanelProps {
  activeTab: EditorTab | null;
  sessionId: string | null;
  onApplyChanges: (newContent: string) => void;
  onRevertChanges?: () => void;
  onTransform: (instruction: string, selectedSnippet?: string) => Promise<AiPatchResponse | null>;
  onProjectTransform?: (query: string) => Promise<AiProjectSolutionResponse | null>;
  onApplyProjectFile?: (proposal: AiProjectFileProposal) => Promise<void>;
  onOpenFile?: (path: string, name: string) => void;
  onRefreshTree?: () => void;
  isProcessing: boolean;
  lastAiResult: AiPatchResponse | null;
  projectAiResult?: AiProjectSolutionResponse | null;
  onClearAiResult: () => void;
  onClearProjectAiResult?: () => void;
}

export const AiCopilotPanel: React.FC<AiCopilotPanelProps> = ({
  activeTab,
  sessionId,
  onApplyChanges,
  onTransform,
  onProjectTransform,
  onApplyProjectFile,
  onOpenFile,
  onRefreshTree,
  isProcessing,
  lastAiResult,
  projectAiResult,
  onClearAiResult,
}) => {
  const [scope, setScope] = useState<'file' | 'project' | 'recovery'>('recovery');
  const [prompt, setPrompt] = useState('');
  const [projectPrompt, setProjectPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [hasApplied, setHasApplied] = useState(false);
  const [appliedFiles, setAppliedFiles] = useState<Set<string>>(new Set());

  // AI Source Code Recovery states
  const [auditData, setAuditData] = useState<RecoveryArchitectureAudit | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<'java' | 'kotlin'>('java');
  const [recoveryResult, setRecoveryResult] = useState<RecoverSourceResponse | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load Project Architecture Audit when session changes or switching to recovery tab
  useEffect(() => {
    if (sessionId && scope === 'recovery' && !auditData && !isAuditing) {
      runArchitectureAudit();
    }
  }, [sessionId, scope]);

  // Check if activeTab already has a saved recovery artifact on disk (Recovery from interrupted/previous session)
  useEffect(() => {
    if (sessionId && activeTab && !activeTab.isImage) {
      api
        .getSavedRecoveryForFile(sessionId, activeTab.path)
        .then((saved) => {
          if (saved) {
            setRecoveryResult(saved);
          } else {
            setRecoveryResult(null);
          }
        })
        .catch(() => {
          setRecoveryResult(null);
        });
    } else {
      setRecoveryResult(null);
    }
  }, [sessionId, activeTab?.path]);

  const runArchitectureAudit = async () => {
    if (!sessionId) return;
    try {
      setIsAuditing(true);
      setRecoveryError(null);
      const res = await api.getRecoveryAudit(sessionId);
      setAuditData(res);
    } catch (err) {
      setRecoveryError((err as Error).message);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleStartFileRecovery = async (overrideFilePath?: string) => {
    const fileToRecover = overrideFilePath || activeTab?.path;
    if (!sessionId || !fileToRecover || isRecovering) return;

    const jobId = `rec_${Date.now()}`;
    setActiveJobId(jobId);
    setIsRecovering(true);
    setRecoveryError(null);
    setRecoveryStage('Comparing JADX output with Smali instructions & de-obfuscating symbols...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await api.recoverFileSource(
        {
          sessionId,
          filePath: fileToRecover,
          jobId,
          targetLanguage,
        },
        controller.signal
      );
      setRecoveryResult(res);
      if (onRefreshTree) onRefreshTree();
      // Refresh audit count
      api.getRecoveryAudit(sessionId).then(setAuditData).catch(() => {});
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setRecoveryError('Source recovery cancelled by user.');
      } else {
        setRecoveryError((err as Error).message);
      }
    } finally {
      setIsRecovering(false);
      setActiveJobId(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancelRecovery = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (activeJobId) {
      try {
        await api.cancelRecoveryJob(activeJobId);
      } catch {
        // ignore
      }
    }
    setIsRecovering(false);
    setRecoveryStage('Cancelled');
  };

  const handleApplyRecoveredVersion = async (version: 'analyzed' | 'reconstructed') => {
    if (!sessionId || !recoveryResult) return;
    await api.applyRecoveredSource({
      sessionId,
      filePath: recoveryResult.filePath,
      version,
    });
    const newContent =
      version === 'reconstructed'
        ? recoveryResult.reconstructedContent
        : recoveryResult.analyzedContent;
    if (activeTab && activeTab.path === recoveryResult.filePath) {
      onApplyChanges(newContent);
    }
    if (onRefreshTree) onRefreshTree();
  };

  // Quick preset actions for SINGLE FILE
  const filePresets = [
    {
      id: 'root-bypass',
      label: 'Bypass Root Detection',
      icon: <Lock className="w-3.5 h-3.5 text-[#e3b341]" />,
      desc: 'Neutralize root/jailbreak checks by returning false safely',
      prompt:
        'Surgically bypass all root detection checks in this file. Do not delete the methods to prevent crashes—neutralize them by making them immediately return false (0x0) or return-void while keeping method signatures and registers intact.',
    },
    {
      id: 'ssl-bypass',
      label: 'Bypass SSL Pinning',
      icon: <Radio className="w-3.5 h-3.5 text-[#58a6ff]" />,
      desc: 'Stub out CertificatePinner or custom TrustManager checks',
      prompt:
        'Bypass SSL certificate pinning or custom TrustManager validation in this file. Stub out the checkServerTrusted or CertificatePinner methods so they do not throw CertificateException, keeping caller execution intact.',
    },
    {
      id: 'debug-manifest',
      label: 'Enable App Debugging',
      icon: <FileSpreadsheet className="w-3.5 h-3.5 text-[#7ee787]" />,
      desc: 'Set android:debuggable="true" and allow cleartext HTTP traffic',
      prompt:
        'Update this AndroidManifest.xml: set android:debuggable="true" and android:usesCleartextTraffic="true" on the <application> tag while preserving all namespaces, activities, and permissions.',
    },
    {
      id: 'neutralize-analytics',
      label: 'Neutralize Trackers/Ads',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-[#f85149]" />,
      desc: 'Safely stub out analytics logging and advertising IDs',
      prompt:
        'Neutralize telemetry, analytics tracking, and ad initialization calls in this file. Stub the methods with return-void or dummy responses so the rest of the application runs without disruption.',
    },
  ];

  // Quick preset actions for ENTIRE PROJECT
  const projectPresets = [
    {
      id: 'proj-root',
      label: 'Global Root & Tamper Bypass',
      icon: <Lock className="w-3.5 h-3.5 text-[#e3b341]" />,
      desc: 'Scan all Smali classes and stub out root/su checks across the APK',
      prompt:
        'Find all root detection, su binary checks, Magisk detection, and test-keys verifications across the entire project and stub them out safely so app runs cleanly.',
    },
    {
      id: 'proj-ssl',
      label: 'Global SSL Pinning Bypass',
      icon: <Radio className="w-3.5 h-3.5 text-[#58a6ff]" />,
      desc: 'Locate OkHttp CertificatePinner & TrustManager and disable pinning',
      prompt:
        'Locate and disable SSL Certificate Pinning and custom TrustManager checks across all classes in the project so HTTPS proxies (Burp/Charles) can inspect traffic.',
    },
    {
      id: 'proj-debug',
      label: 'Full Project Debug Re-configuration',
      icon: <FileSpreadsheet className="w-3.5 h-3.5 text-[#7ee787]" />,
      desc: 'Patch AndroidManifest.xml and network security config across project',
      prompt:
        'Make the entire project debuggable: update AndroidManifest.xml to enable debugging, backup, cleartext HTTP, and configure network security config.',
    },
    {
      id: 'proj-urls',
      label: 'Locate API Endpoints & Auth Keys',
      icon: <Search className="w-3.5 h-3.5 text-[#bc8cff]" />,
      desc: 'Extract backend base URLs, headers, and API keys across classes',
      prompt:
        'Search the entire project for backend API endpoints, base URLs, secret tokens, and authentication headers. Detail where they are used and how to modify them.',
    },
  ];

  const handleRunFilePreset = (presetPrompt: string, id: string) => {
    setSelectedPreset(id);
    setPrompt(presetPrompt);
    handleExecuteFile(presetPrompt);
  };

  const handleRunProjectPreset = (presetPrompt: string, id: string) => {
    setSelectedPreset(id);
    setProjectPrompt(presetPrompt);
    handleExecuteProject(presetPrompt);
  };

  const handleExecuteFile = async (overridePrompt?: string) => {
    const textToRun = (overridePrompt || prompt).trim();
    if (!textToRun || isProcessing || !activeTab) return;

    setHasApplied(false);
    await onTransform(textToRun);
  };

  const handleExecuteProject = async (overridePrompt?: string) => {
    const textToRun = (overridePrompt || projectPrompt).trim();
    if (!textToRun || isProcessing || !onProjectTransform || !sessionId) return;

    await onProjectTransform(textToRun);
  };

  const handleAcceptFile = () => {
    if (lastAiResult) {
      onApplyChanges(lastAiResult.modifiedContent);
      setHasApplied(true);
    }
  };

  const handleRejectFile = () => {
    if (lastAiResult) {
      onApplyChanges(lastAiResult.originalContent);
      onClearAiResult();
      setHasApplied(false);
    }
  };

  const handleApplySingleProjectFile = async (file: AiProjectFileProposal) => {
    if (onApplyProjectFile) {
      await onApplyProjectFile(file);
      setAppliedFiles((prev) => new Set(prev).add(file.filePath));
    }
  };

  const getActionBadgeColor = (type: AiPatchAction['changeType']) => {
    switch (type) {
      case 'neutralized':
        return 'bg-[#bc8cff]/20 text-[#d2a8ff] border-[#bc8cff]/40';
      case 'modified':
        return 'bg-[#58a6ff]/20 text-[#79c0ff] border-[#58a6ff]/40';
      case 'added':
        return 'bg-[#3fb950]/20 text-[#56d364] border-[#3fb950]/40';
      case 'removed':
        return 'bg-[#f85149]/20 text-[#ff7b72] border-[#f85149]/40';
      default:
        return 'bg-[#30363d] text-[#c9d1d9] border-[#30363d]';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden select-none">
      {/* Header */}
      <div className="p-3 border-b border-[#30363d] bg-[#161b22] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-gradient-to-tr from-[#238636] to-[#2f81f7] text-white">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                AI Copilot &amp; Recovery
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 font-mono normal-case">
                  3.5 Flash Lite
                </span>
              </h3>
            </div>
          </div>

          {activeTab && (
            <div
              className="flex items-center gap-1 text-[11px] font-mono text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d] max-w-[125px] truncate"
              title={activeTab.path}
            >
              <FileCode className="w-3 h-3 text-[#58a6ff] shrink-0" />
              <span className="truncate">{activeTab.name}</span>
            </div>
          )}
        </div>

        {/* 3-Mode Scope Selector: Source Recovery | Current File | Entire Project */}
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#0d1117] border border-[#30363d] rounded">
          <button
            type="button"
            onClick={() => setScope('recovery')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-semibold transition-all ${
              scope === 'recovery'
                ? 'bg-[#238636]/25 text-[#3fb950] border border-[#238636]/50 shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title="AI Source Code Recovery, De-obfuscation & Architecture Audit"
          >
            <FolderGit2 className="w-3 h-3 shrink-0" />
            <span className="truncate">Recovery</span>
          </button>

          <button
            type="button"
            onClick={() => setScope('file')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-medium transition-all ${
              scope === 'file'
                ? 'bg-[#21262d] text-white border border-[#30363d] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title="Surgical File Patcher"
          >
            <FileText className="w-3 h-3 shrink-0" />
            <span className="truncate">File Patch</span>
          </button>

          <button
            type="button"
            onClick={() => setScope('project')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-medium transition-all ${
              scope === 'project'
                ? 'bg-[#21262d] text-white border border-[#30363d] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title="Cross-File Project Analyzer"
          >
            <Globe2 className="w-3 h-3 text-[#58a6ff] shrink-0" />
            <span className="truncate">Project</span>
          </button>
        </div>
      </div>

      {/* Content Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {/* ===================== MODE 0: AI SOURCE CODE RECOVERY ===================== */}
        {scope === 'recovery' && (
          <>
            {!sessionId ? (
              <div className="p-6 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-lg bg-[#161b22]/50">
                <FolderGit2 className="w-8 h-8 text-[#3fb950]/50 mx-auto mb-2" />
                <p className="text-xs font-medium text-white">AI Source Code Recovery Engine</p>
                <p className="text-[11px] text-[#8b949e] mt-1">
                  Upload an APK to analyze obfuscated classes, compare JADX &amp; Smali bytecode, detect 3rd-party SDKs, and reconstruct missing Java/Kotlin source logic safely.
                </p>
              </div>
            ) : (
              <>
                {/* 1. Active File Recovery Box */}
                <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#3fb950]" />
                      Context-Aware File Recovery
                    </span>
                    <div className="flex items-center gap-1 bg-[#0d1117] border border-[#30363d] rounded p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setTargetLanguage('java')}
                        className={`px-1.5 py-0.5 rounded font-mono ${
                          targetLanguage === 'java' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'
                        }`}
                      >
                        Java
                      </button>
                      <button
                        type="button"
                        onClick={() => setTargetLanguage('kotlin')}
                        className={`px-1.5 py-0.5 rounded font-mono ${
                          targetLanguage === 'kotlin' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'
                        }`}
                      >
                        Kotlin
                      </button>
                    </div>
                  </div>

                  {!activeTab || activeTab.isImage ? (
                    <p className="text-[11px] text-[#8b949e] bg-[#0d1117] p-2 rounded border border-[#30363d]">
                      Select any <code>.java</code>, <code>.smali</code>, or <code>.xml</code> file in the Explorer (or click an obfuscated class below) to de-obfuscate and reconstruct its source.
                    </p>
                  ) : (
                    <>
                      <div className="text-[11px] bg-[#0d1117] p-2 rounded border border-[#30363d] flex items-center justify-between gap-2">
                        <span className="font-mono text-[#58a6ff] truncate">{activeTab.path}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] font-mono shrink-0">
                          Safe 3-Version Mode
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {!isRecovering ? (
                          <button
                            type="button"
                            onClick={() => handleStartFileRecovery()}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded shadow transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              {recoveryResult ? 'Re-Run Source Recovery' : 'Recover & De-obfuscate File'}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleCancelRecovery}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#f85149]/20 hover:bg-[#f85149]/30 border border-[#f85149]/50 text-[#ff7b72] text-xs font-semibold rounded transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel Recovery</span>
                          </button>
                        )}

                        {recoveryResult && (
                          <button
                            type="button"
                            onClick={() => setDiffModalOpen(true)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border border-[#58a6ff]/50 text-[#58a6ff] text-xs font-semibold rounded"
                            title="Compare Original vs Analyzed vs Reconstructed Source"
                          >
                            <GitCompare className="w-3.5 h-3.5" />
                            <span>Compare (3)</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {/* Recovery Progress */}
                  {isRecovering && (
                    <div className="p-2.5 bg-[#0d1117] border border-[#58a6ff]/40 rounded animate-pulse space-y-1">
                      <div className="flex items-center gap-2 text-[11px] text-[#58a6ff] font-medium">
                        <div className="w-2 h-2 rounded-full bg-[#58a6ff] animate-ping" />
                        <span>{recoveryStage}</span>
                      </div>
                      <p className="text-[10px] text-[#8b949e]">
                        Original file remains untouched. Output will be saved to <code>recovered/</code>.
                      </p>
                    </div>
                  )}

                  {/* Recovery Error */}
                  {recoveryError && (
                    <div className="p-2 rounded bg-[#f85149]/10 border border-[#f85149]/40 text-[11px] text-[#ff7b72] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{recoveryError}</span>
                    </div>
                  )}
                </div>

                {/* 2. File Recovery Result Report (if available for current file) */}
                {recoveryResult && (
                  <div className="border border-[#238636]/50 rounded-lg bg-[#161b22] overflow-hidden shadow-lg space-y-2.5 p-3">
                    <div className="flex items-center justify-between border-b border-[#30363d] pb-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <CheckCircle2 className="w-4 h-4 text-[#3fb950]" />
                        <span>Recovered Source Ready</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDiffModalOpen(true)}
                        className="text-[11px] font-semibold text-[#58a6ff] hover:underline flex items-center gap-1"
                      >
                        <GitCompare className="w-3 h-3" />
                        Inspect Diff &amp; Apply
                      </button>
                    </div>

                    <p className="text-[11px] text-[#c9d1d9] bg-[#0d1117] p-2 rounded border border-[#30363d] leading-relaxed">
                      {recoveryResult.architectureSummary}
                    </p>

                    {recoveryResult.hasSmaliReference && (
                      <div className="text-[10px] text-[#e3b341] bg-[#d29922]/10 border border-[#d29922]/30 p-2 rounded">
                        <strong>JADX vs. Smali Verification:</strong> {recoveryResult.smaliComparisonNotes}
                      </div>
                    )}

                    {/* Symbol Rename Suggestions */}
                    {recoveryResult.symbolMappings.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-1">
                          De-obfuscated Symbols ({recoveryResult.symbolMappings.length}):
                        </h4>
                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
                          {recoveryResult.symbolMappings.map((sym, i) => (
                            <div
                              key={i}
                              className="p-1.5 rounded bg-[#0d1117] border border-[#30363d] text-[10px] flex flex-col gap-0.5"
                            >
                              <div className="flex items-center justify-between font-mono">
                                <span>
                                  <span className="text-[#ff7b72]">{sym.originalName}</span>
                                  <span className="text-[#8b949e] mx-1">→</span>
                                  <strong className="text-[#3fb950]">{sym.suggestedName}</strong>
                                </span>
                                <span className="text-[9px] px-1 rounded bg-[#21262d] text-[#8b949e]">
                                  {sym.symbolType} ({sym.confidence}%)
                                </span>
                              </div>
                              <span className="text-[#8b949e]">{sym.reasoning}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Cross-Class Relationships */}
                    {recoveryResult.crossClassRelationships.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-1">
                          Cross-Class Relationships:
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {recoveryResult.crossClassRelationships.map((rel, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#c9d1d9]"
                            >
                              {rel}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Project Architecture, Obfuscation & Dependencies Audit */}
                <div className="border border-[#30363d] rounded-lg bg-[#161b22] overflow-hidden">
                  <div className="p-2.5 bg-[#21262d] border-b border-[#30363d] flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />
                      Project Recovery &amp; Obfuscation Audit
                    </span>
                    <button
                      type="button"
                      onClick={runArchitectureAudit}
                      disabled={isAuditing}
                      className="p-1 text-[#8b949e] hover:text-white rounded"
                      title="Refresh Project Audit"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isAuditing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {isAuditing && !auditData ? (
                    <div className="p-4 text-center text-[#8b949e] text-xs font-mono">
                      Auditing Java, Smali, Native (.so), and 3rd-party SDKs...
                    </div>
                  ) : auditData ? (
                    <div className="p-3 space-y-3 text-xs">
                      {/* Stats Grid */}
                      <div className="grid grid-cols-4 gap-1.5 text-center">
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-xs font-bold text-[#e36209]">{auditData.totalJavaFiles}</div>
                          <div className="text-[9px] text-[#8b949e]">Java</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-xs font-bold text-[#d29922]">{auditData.totalSmaliFiles}</div>
                          <div className="text-[9px] text-[#8b949e]">Smali</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-xs font-bold text-[#7ee787]">{auditData.totalXmlFiles}</div>
                          <div className="text-[9px] text-[#8b949e]">XML</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-xs font-bold text-[#3fb950]">{auditData.recoveredFilesCount}</div>
                          <div className="text-[9px] text-[#8b949e]">Recovered</div>
                        </div>
                      </div>

                      {/* Obfuscation Score Bar */}
                      <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-[#8b949e]">Obfuscation Level:</span>
                          <span className="font-semibold text-[#e3b341]">
                            {auditData.obfuscationLevel} ({auditData.overallObfuscationScore}%)
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#3fb950] via-[#d29922] to-[#f85149]"
                            style={{ width: `${Math.max(8, auditData.overallObfuscationScore)}%` }}
                          />
                        </div>
                      </div>

                      {/* Obfuscated / Broken Decompilation Candidates */}
                      {auditData.obfuscatedCandidates.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-1.5 flex items-center justify-between">
                            <span>Obfuscated / Incomplete Classes</span>
                            <span className="font-mono">{auditData.obfuscatedCandidates.length}</span>
                          </h4>
                          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                            {auditData.obfuscatedCandidates.map((cand, idx) => (
                              <div
                                key={idx}
                                className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-mono text-white truncate" title={cand.className}>
                                    {cand.className}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-[#8b949e]">
                                    <span>Score: {cand.obfuscationScore}%</span>
                                    {cand.incompleteDecompilation && (
                                      <span className="text-[#f85149]">• Incomplete JADX</span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onOpenFile) {
                                      const name = cand.filePath.split('/').pop() || cand.className;
                                      onOpenFile(cand.filePath, name);
                                    }
                                    handleStartFileRecovery(cand.filePath);
                                  }}
                                  disabled={isRecovering}
                                  className="px-2 py-1 rounded bg-[#238636]/20 hover:bg-[#238636] text-[#3fb950] hover:text-white border border-[#238636]/40 text-[10px] font-semibold shrink-0 transition-colors"
                                >
                                  Recover
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Detected Third-Party Libraries & SDKs */}
                      {auditData.detectedDependencies.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-1.5 flex items-center gap-1">
                            <Box className="w-3 h-3 text-[#58a6ff]" />
                            <span>Detected Libraries &amp; SDKs ({auditData.detectedDependencies.length})</span>
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {auditData.detectedDependencies.map((dep, i) => (
                              <span
                                key={i}
                                title={`Package: ${dep.packagePrefix} (${dep.category})`}
                                className="text-[10px] px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#c9d1d9]"
                              >
                                {dep.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Native (.so) Libraries */}
                      {auditData.nativeLibraries.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-1.5 flex items-center gap-1">
                            <Binary className="w-3 h-3 text-[#a371f7]" />
                            <span>Native Libraries ({auditData.nativeLibraries.length})</span>
                          </h4>
                          <div className="space-y-1 max-h-[110px] overflow-y-auto pr-1">
                            {auditData.nativeLibraries.map((lib, i) => (
                              <div
                                key={i}
                                className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between text-[10px] font-mono"
                              >
                                <span className="text-[#d2a8ff] truncate">{lib.name}</span>
                                <span className="text-[#8b949e] shrink-0">
                                  {lib.architecture} • {lib.knownLibrary || `${(lib.size / 1024).toFixed(0)} KB`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}

        {/* ===================== MODE 1: CURRENT FILE ===================== */}
        {scope === 'file' && (
          <>
            {!activeTab ? (
              <div className="p-6 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-lg bg-[#161b22]/50">
                <Code2 className="w-8 h-8 text-[#8b949e]/40 mx-auto mb-2" />
                <p className="text-xs font-medium text-white">No file open in editor</p>
                <p className="text-[11px] text-[#8b949e] mt-1">
                  Open a file from Explorer, or switch to <strong>"Recovery"</strong> or <strong>"Project"</strong> mode above.
                </p>
              </div>
            ) : (
              <>
                {/* Quick Presets */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] block mb-2 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-[#e3b341]" />
                    Single-File Quick Patches
                  </label>

                  <div className="grid grid-cols-1 gap-1.5">
                    {filePresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleRunFilePreset(preset.prompt, preset.id)}
                        className={`flex items-start gap-2.5 p-2 rounded border text-left transition-all ${
                          selectedPreset === preset.id
                            ? 'bg-[#21262d] border-[#58a6ff] text-white shadow-sm'
                            : 'bg-[#161b22] border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] hover:border-[#8b949e]/50'
                        } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className="p-1 rounded bg-[#0d1117] border border-[#30363d] shrink-0 mt-0.5">
                          {preset.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{preset.label}</div>
                          <div className="text-[10px] text-[#8b949e] line-clamp-1">{preset.desc}</div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-[#8b949e] shrink-0 opacity-40 self-center" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Instruction Box */}
                <div className="pt-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] block mb-1.5 flex items-center justify-between">
                    <span>File Instruction</span>
                    <span className="text-[10px] text-[#8b949e]/60 font-mono">Preserves callers</span>
                  </label>

                  <div className="relative">
                    <textarea
                      rows={3}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={isProcessing}
                      placeholder="e.g. Bypass checkServerTrusted, remove ad banner logic, make debuggable..."
                      className="w-full bg-[#161b22] border border-[#30363d] rounded p-2.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#58a6ff] resize-none"
                    />

                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-[#8b949e] flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
                        Dependency-Safe
                      </span>

                      <button
                        type="button"
                        onClick={() => handleExecuteFile()}
                        disabled={isProcessing || !prompt.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow"
                      >
                        {isProcessing ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Patching...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Apply AI Patch</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Progress */}
                {isProcessing && (
                  <div className="p-3 bg-[#161b22] border border-[#58a6ff]/30 rounded-lg animate-pulse">
                    <div className="flex items-center gap-2 text-xs text-[#58a6ff] font-medium mb-1">
                      <div className="w-2 h-2 rounded-full bg-[#58a6ff] animate-ping" />
                      Gemini 3.5 Flash Lite Analyzing Code &amp; Dependencies...
                    </div>
                    <p className="text-[11px] text-[#8b949e]">
                      Scanning bytecode registers, branch labels, and method callers to guarantee no runtime crash.
                    </p>
                  </div>
                )}

                {/* Audit Report */}
                {lastAiResult && (
                  <div className="border border-[#30363d] rounded-lg bg-[#161b22] overflow-hidden shadow-lg animate-in fade-in duration-300">
                    <div className="p-2.5 border-b border-[#30363d] bg-[#21262d] flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <CheckCircle2 className="w-4 h-4 text-[#3fb950]" />
                        <span>AI Action &amp; Integrity Report</span>
                      </div>
                      {lastAiResult.integrityVerified && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3fb950]/20 text-[#56d364] border border-[#3fb950]/40 font-mono">
                          Verified Safe
                        </span>
                      )}
                    </div>

                    <div className="p-3 space-y-3 text-xs">
                      <div>
                        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
                          Summary:
                        </h4>
                        <p className="text-[#c9d1d9] leading-relaxed text-[11px] bg-[#0d1117] p-2 rounded border border-[#30363d]">
                          {lastAiResult.explanation}
                        </p>
                      </div>

                      {lastAiResult.actions && lastAiResult.actions.length > 0 && (
                        <div>
                          <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">
                            Surgical Changes ({lastAiResult.actions.length}):
                          </h4>
                          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                            {lastAiResult.actions.map((act, idx) => (
                              <div
                                key={idx}
                                className="p-2 rounded bg-[#0d1117] border border-[#30363d] text-[11px]"
                              >
                                <div className="flex items-center justify-between gap-1 mb-1">
                                  <span className="font-mono text-white font-medium truncate">{act.target}</span>
                                  <span
                                    className={`text-[9px] uppercase px-1.5 py-0.2 rounded border font-mono shrink-0 ${getActionBadgeColor(
                                      act.changeType
                                    )}`}
                                  >
                                    {act.changeType}
                                  </span>
                                </div>
                                <div className="text-[#8b949e] leading-tight mb-1">{act.description}</div>
                                <div className="text-[10px] text-[#3fb950] font-mono flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3 shrink-0" />
                                  <span>{act.impactOnDependencies}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-[#30363d] flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAcceptFile}
                          disabled={hasApplied}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-colors ${
                            hasApplied
                              ? 'bg-[#238636]/40 text-[#3fb950] border border-[#238636]/60 cursor-default'
                              : 'bg-[#238636] hover:bg-[#2ea043] text-white shadow'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          {hasApplied ? 'Changes Saved' : 'Accept & Apply Changes'}
                        </button>

                        <button
                          type="button"
                          onClick={handleRejectFile}
                          title="Discard AI modifications and restore original file"
                          className="px-2.5 py-1.5 bg-[#21262d] hover:bg-[#f85149]/20 hover:text-[#ff7b72] text-[#8b949e] border border-[#30363d] hover:border-[#f85149]/40 rounded text-xs transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ===================== MODE 2: ENTIRE PROJECT ===================== */}
        {scope === 'project' && (
          <>
            {!sessionId ? (
              <div className="p-6 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-lg bg-[#161b22]/50">
                <Layers className="w-8 h-8 text-[#8b949e]/40 mx-auto mb-2" />
                <p className="text-xs font-medium text-white">No active APK uploaded</p>
                <p className="text-[11px] text-[#8b949e] mt-1">
                  Upload an APK to let Gemini analyze the entire cross-file project architecture.
                </p>
              </div>
            ) : (
              <>
                {/* Project Presets */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] block mb-2 flex items-center gap-1">
                    <Globe2 className="w-3.5 h-3.5 text-[#58a6ff]" />
                    Project-Wide Automated Goals
                  </label>

                  <div className="grid grid-cols-1 gap-1.5">
                    {projectPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleRunProjectPreset(preset.prompt, preset.id)}
                        className={`flex items-start gap-2.5 p-2 rounded border text-left transition-all ${
                          selectedPreset === preset.id
                            ? 'bg-[#21262d] border-[#58a6ff] text-white shadow-sm'
                            : 'bg-[#161b22] border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] hover:border-[#8b949e]/50'
                        } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className="p-1 rounded bg-[#0d1117] border border-[#30363d] shrink-0 mt-0.5">
                          {preset.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{preset.label}</div>
                          <div className="text-[10px] text-[#8b949e] line-clamp-1">{preset.desc}</div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-[#8b949e] shrink-0 opacity-40 self-center" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Project Query */}
                <div className="pt-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] block mb-1.5 flex items-center justify-between">
                    <span>Project-Wide Goal / Query</span>
                    <span className="text-[10px] text-[#58a6ff] font-mono">Scans all files</span>
                  </label>

                  <div className="relative">
                    <textarea
                      rows={3}
                      value={projectPrompt}
                      onChange={(e) => setProjectPrompt(e.target.value)}
                      disabled={isProcessing}
                      placeholder="e.g. Find where root check is implemented and bypass it across all classes..."
                      className="w-full bg-[#161b22] border border-[#30363d] rounded p-2.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#58a6ff] resize-none"
                    />

                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-[#8b949e] flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-[#58a6ff]" />
                        Cross-File Correlation
                      </span>

                      <button
                        type="button"
                        onClick={() => handleExecuteProject()}
                        disabled={isProcessing || !projectPrompt.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2f81f7] hover:bg-[#388bfd] text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow"
                      >
                        {isProcessing ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Scanning Project...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-3.5 h-3.5" />
                            <span>Analyze Whole Project</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Progress for Project Scan */}
                {isProcessing && (
                  <div className="p-3 bg-[#161b22] border border-[#58a6ff]/30 rounded-lg animate-pulse">
                    <div className="flex items-center gap-2 text-xs text-[#58a6ff] font-medium mb-1">
                      <div className="w-2 h-2 rounded-full bg-[#58a6ff] animate-ping" />
                      Scanning Smali, Manifest, and Java Packages...
                    </div>
                    <p className="text-[11px] text-[#8b949e]">
                      Gemini 3.5 Flash Lite is correlating callers across packages to identify the root cause and coordinated patches.
                    </p>
                  </div>
                )}

                {/* Project-Wide Solution Card */}
                {projectAiResult && (
                  <div className="border border-[#30363d] rounded-lg bg-[#161b22] overflow-hidden shadow-lg animate-in fade-in duration-300">
                    <div className="p-2.5 border-b border-[#30363d] bg-[#21262d] flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Globe2 className="w-4 h-4 text-[#58a6ff]" />
                        <span>Project Architecture Solution</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#58a6ff]/20 text-[#79c0ff] border border-[#58a6ff]/40 font-mono">
                        {projectAiResult.affectedFiles.length} Files Affected
                      </span>
                    </div>

                    <div className="p-3 space-y-3 text-xs">
                      {/* Summary */}
                      <div>
                        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
                          Holistic Plan:
                        </h4>
                        <p className="text-[#c9d1d9] leading-relaxed text-[11px] bg-[#0d1117] p-2.5 rounded border border-[#30363d]">
                          {projectAiResult.summary}
                        </p>
                      </div>

                      {/* Root cause */}
                      <div>
                        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
                          Root Cause Identified:
                        </h4>
                        <div className="text-[11px] text-[#e3b341] bg-[#e3b341]/10 border border-[#e3b341]/30 p-2 rounded">
                          {projectAiResult.rootCause}
                        </div>
                      </div>

                      {/* Affected Files List */}
                      {projectAiResult.affectedFiles.length > 0 && (
                        <div>
                          <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">
                            Files to Patch ({projectAiResult.affectedFiles.length}):
                          </h4>
                          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                            {projectAiResult.affectedFiles.map((file, idx) => {
                              const isApplied = appliedFiles.has(file.filePath);
                              return (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] text-[11px]"
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className="font-mono text-[#58a6ff] font-semibold truncate">
                                      {file.fileName}
                                    </span>
                                    <span className="text-[9px] text-[#8b949e] font-mono truncate max-w-[150px]">
                                      {file.filePath}
                                    </span>
                                  </div>

                                  <p className="text-[#8b949e] text-[10px] mb-2">{file.explanation}</p>

                                  <div className="flex items-center gap-2">
                                    {onOpenFile && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenFile(file.filePath, file.fileName)}
                                        className="flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded text-[10px] font-medium"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        Open File
                                      </button>
                                    )}

                                    {onApplyProjectFile && (
                                      <button
                                        type="button"
                                        disabled={isApplied}
                                        onClick={() => handleApplySingleProjectFile(file)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                                          isApplied
                                            ? 'bg-[#238636]/30 text-[#3fb950] border border-[#238636]/50'
                                            : 'bg-[#238636] hover:bg-[#2ea043] text-white shadow'
                                        }`}
                                      >
                                        <Check className="w-3 h-3" />
                                        {isApplied ? 'Patched' : 'Apply Patch'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Recommendation */}
                      {projectAiResult.recommendation && (
                        <div className="p-2 rounded bg-[#2f81f7]/10 border border-[#2f81f7]/30 text-[11px] text-[#79c0ff]">
                          <strong>Rebuild Tip:</strong> {projectAiResult.recommendation}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Side-by-Side 3-Version Recovery Comparison Modal */}
      <RecoveryDiffModal
        isOpen={diffModalOpen}
        recoveryData={recoveryResult}
        onClose={() => setDiffModalOpen(false)}
        onApplyVersion={handleApplyRecoveredVersion}
        onOpenRecoveredFile={onOpenFile}
      />
    </div>
  );
};
