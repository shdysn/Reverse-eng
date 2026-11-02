import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileBox,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  FolderTree,
  Box,
  Binary,
  ShieldCheck,
  Terminal,
  FileText,
  Sparkles,
  ExternalLink,
  Layers,
  Cpu,
  Play,
  Square,
  Wrench,
  RotateCcw,
  Check,
  AlertOctagon,
  History,
  GitCompare,
} from 'lucide-react';
import { api } from '../services/api.js';
import { ApkComparisonTabPanel } from './ApkComparisonTabPanel.js';
import type {
  ProjectReconstructionReport,
  GradleTaskName,
  GradleBuildStateResponse,
  GradleBuildRun,
  AiErrorFixProposal,
  FinalComparisonReport,
} from '../types/index.js';

interface AndroidStudioProjectModalProps {
  isOpen: boolean;
  sessionId: string | null;
  onClose: () => void;
  onOpenFile?: (path: string, name: string) => void;
  onRefreshTree?: () => void;
  initialTab?:
    | 'validation'
    | 'structure'
    | 'dependencies'
    | 'config'
    | 'build'
    | 'errors_repair'
    | 'apk_comparison';
}

const ALL_GRADLE_TASKS: { id: GradleTaskName; label: string; desc: string }[] = [
  { id: 'clean', label: 'clean', desc: 'Delete build/ directory' },
  { id: 'assembleDebug', label: 'assembleDebug', desc: 'Build debug APK' },
  { id: 'assembleRelease', label: 'assembleRelease', desc: 'Build release APK' },
  { id: 'test', label: 'test', desc: 'Run unit tests' },
  { id: 'lint', label: 'lint', desc: 'Run Android lint checks' },
];

export const AndroidStudioProjectModal: React.FC<AndroidStudioProjectModalProps> = ({
  isOpen,
  sessionId,
  onClose,
  onOpenFile,
  onRefreshTree,
  initialTab,
}) => {
  const [report, setReport] = useState<ProjectReconstructionReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    | 'validation'
    | 'structure'
    | 'dependencies'
    | 'config'
    | 'build'
    | 'errors_repair'
    | 'apk_comparison'
  >(initialTab || 'validation');

  // Phase 3 Reconstruction options
  const [useKotlinDsl, setUseKotlinDsl] = useState(false);
  const [prioritizeReconstructed, setPrioritizeReconstructed] = useState(true);
  const [sanitizeUnrecoveredMethods, setSanitizeUnrecoveredMethods] = useState(true);
  const [excludeThirdPartySdkSources, setExcludeThirdPartySdkSources] = useState(true);

  // Phase 4 Build, Error Detection & AI Code Repair states
  const [buildState, setBuildState] = useState<GradleBuildStateResponse | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<GradleTaskName[]>(['assembleDebug']);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isAnalyzingErrors, setIsAnalyzingErrors] = useState(false);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);
  const [isRunningAutoLoop, setIsRunningAutoLoop] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [selectedFixIds, setSelectedFixIds] = useState<Set<string>>(new Set());
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [liveStage, setLiveStage] = useState<string>('');
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Phase 5 Original APK vs Reconstructed APK Comparison state
  const [comparisonReport, setComparisonReport] = useState<FinalComparisonReport | null>(null);
  const [isLoadingComparison, setIsLoadingComparison] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (isOpen && sessionId) {
      loadOrGenerateProject(false);
      loadPhase4BuildState();
      loadPhase5Comparison(false);
    }
  }, [isOpen, sessionId]);

  // Connect to Live SSE Build Stream while modal is open
  useEffect(() => {
    if (!isOpen || !sessionId) return;

    const streamUrl = api.getGradleBuildStreamUrl(sessionId);
    const es = new EventSource(streamUrl);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.eventType === 'snapshot' && parsed.payload) {
          const st = parsed.payload as GradleBuildStateResponse;
          setBuildState(st);
          if (st.currentBuild) {
            setLiveLogs(st.currentBuild.logs || []);
            setLiveStage(st.currentBuild.stage);
          }
        } else if (parsed.eventType === 'log' && parsed.payload) {
          setLiveLogs((prev) => [...prev.slice(-250), parsed.payload.line]);
          if (parsed.payload.stage) {
            setLiveStage(parsed.payload.stage);
          }
        } else if (parsed.eventType === 'stage' && parsed.payload) {
          setLiveStage(parsed.payload.stage);
        } else if (parsed.eventType === 'completed' && parsed.payload) {
          const completedBuild = parsed.payload as GradleBuildRun;
          setLiveLogs(completedBuild.logs || []);
          setLiveStage(completedBuild.stage);
          loadPhase4BuildState();
        } else if (
          parsed.eventType === 'proposals' ||
          parsed.eventType === 'fixes_applied' ||
          parsed.eventType === 'rollback' ||
          parsed.eventType === 'auto_loop_completed'
        ) {
          loadPhase4BuildState();
        }
      } catch {
        // ignore SSE parse errors
      }
    };

    return () => {
      es.close();
    };
  }, [isOpen, sessionId]);

  // Auto-scroll live logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [liveLogs]);

  const loadPhase4BuildState = async () => {
    if (!sessionId) return;
    try {
      const st = await api.getGradleBuildState(sessionId);
      setBuildState(st);
      if (st.currentBuild) {
        setLiveLogs(st.currentBuild.logs || []);
        setLiveStage(st.currentBuild.stage);
      }
      // Auto-select pending fixes
      const pendingIds = st.fixProposals
        .filter((f) => f.status === 'pending' || f.status === 'approved')
        .map((f) => f.id);
      if (pendingIds.length > 0) {
        setSelectedFixIds(new Set(pendingIds));
      }
    } catch {
      // ignore initial state load error
    }
  };

  const loadPhase5Comparison = async (forceRefresh: boolean) => {
    if (!sessionId) return;
    try {
      setIsLoadingComparison(true);
      const rep = forceRefresh
        ? await api.runApkComparison(sessionId)
        : await api.getApkComparisonReport(sessionId, false);
      setComparisonReport(rep);
    } catch {
      // ignore initial load error
    } finally {
      setIsLoadingComparison(false);
    }
  };

  const loadOrGenerateProject = async (forceRegenerate: boolean) => {
    if (!sessionId) return;
    try {
      setIsGenerating(true);
      setError(null);
      if (!forceRegenerate) {
        const existing = await api.getProjectReconstructionReport(sessionId);
        if (existing) {
          setReport(existing);
          setIsGenerating(false);
          return;
        }
      }
      const generated = await api.reconstructAndroidStudioProject({
        sessionId,
        useKotlinDsl,
        prioritizeReconstructed,
        sanitizeUnrecoveredMethods,
        excludeThirdPartySdkSources,
      });
      setReport(generated);
      if (onRefreshTree) onRefreshTree();
      await loadPhase4BuildState();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleGradleTask = (task: GradleTaskName) => {
    setSelectedTasks((prev) => {
      if (prev.includes(task)) {
        const next = prev.filter((t) => t !== task);
        return next.length > 0 ? next : ['assembleDebug'];
      }
      return [...prev, task];
    });
  };

  const handleStartGradleBuild = async () => {
    if (!sessionId || isBuilding || isRunningAutoLoop) return;
    try {
      setIsBuilding(true);
      setError(null);
      setFeedbackMsg(null);
      setLiveLogs([]);
      setActiveTab('build');
      const run = await api.startGradleBuild(sessionId, {
        tasks: selectedTasks,
        runStaticCompilerCheck: true,
      });
      setLiveLogs(run.logs || []);
      await loadPhase4BuildState();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleCancelBuild = async () => {
    if (!sessionId || !buildState?.currentBuild) return;
    try {
      await api.cancelGradleBuild(sessionId, buildState.currentBuild.buildId);
      setIsBuilding(false);
      setIsRunningAutoLoop(false);
      setFeedbackMsg('Build cancelled safely.');
      await loadPhase4BuildState();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAnalyzeErrorsWithAi = async () => {
    if (!sessionId || isAnalyzingErrors) return;
    try {
      setIsAnalyzingErrors(true);
      setError(null);
      setFeedbackMsg(null);
      const proposals = await api.analyzeGradleBuildErrors(sessionId, {
        buildId: buildState?.currentBuild?.buildId,
      });
      await loadPhase4BuildState();
      setSelectedFixIds(new Set(proposals.map((p) => p.id)));
      setActiveTab('errors_repair');
      setFeedbackMsg(
        `AI analyzed build errors and generated ${proposals.length} targeted minimal repair proposal(s).`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsAnalyzingErrors(false);
    }
  };

  const handleApplySelectedFixes = async () => {
    if (!sessionId || isApplyingFixes || selectedFixIds.size === 0) return;
    try {
      setIsApplyingFixes(true);
      setError(null);
      setFeedbackMsg(null);
      const res = await api.applyGradleBuildFixes(sessionId, {
        fixIds: Array.from(selectedFixIds),
      });
      await loadPhase4BuildState();
      if (onRefreshTree) onRefreshTree();
      setFeedbackMsg(
        `Created backup ${res.backup.backupId} and applied ${res.appliedFixes.length} minimal fix(es) to android-studio-project/. Click "Rebuild Project" to verify!`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsApplyingFixes(false);
    }
  };

  const handleRunAutoRebuildLoop = async () => {
    if (!sessionId || isRunningAutoLoop || isBuilding) return;
    try {
      setIsRunningAutoLoop(true);
      setError(null);
      setFeedbackMsg(null);
      setActiveTab('build');
      const loopRes = await api.runAutoRebuildLoop(sessionId, {
        tasks: selectedTasks,
        maxRetries,
        autoApplyMinConfidence: 70,
      });
      await loadPhase4BuildState();
      if (onRefreshTree) onRefreshTree();
      setFeedbackMsg(loopRes.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRunningAutoLoop(false);
    }
  };

  const handleRollbackBackup = async (backupId: string) => {
    if (!sessionId || isRollingBack) return;
    try {
      setIsRollingBack(backupId);
      setError(null);
      const res = await api.rollbackGradleBuildBackup(sessionId, backupId);
      await loadPhase4BuildState();
      if (onRefreshTree) onRefreshTree();
      setFeedbackMsg(
        `Rolled back ${res.restoredFiles.length} file(s) from snapshot ${backupId}.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRollingBack(null);
    }
  };

  const toggleSelectFix = (fixId: string) => {
    setSelectedFixIds((prev) => {
      const next = new Set(prev);
      if (next.has(fixId)) next.delete(fixId);
      else next.add(fixId);
      return next;
    });
  };

  if (!isOpen || !sessionId) return null;

  const currentBuild = buildState?.currentBuild;
  const codeErrorsCount =
    currentBuild?.errors.filter((e) => e.category !== 'environment_missing').length || 0;
  const pendingFixesCount =
    buildState?.fixProposals.filter((f) => f.status === 'pending' || f.status === 'approved')
      .length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs select-none">
      <div className="w-full max-w-6xl h-[92vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
              <FileBox className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Android Studio Project Reconstruction &amp; Automatic Gradle Build / AI Repair
                </h3>
                {report && (
                  <>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] border border-[#30363d]">
                      {report.projectName} ({report.versionId})
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
                        report.validation.overallValid
                          ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
                          : 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {report.validation.passedCount}/{report.validation.totalChecks} Checks Passed
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-[#8b949e]">
                Preserves Original (<code className="text-[#c9d1d9]">decoded/ &amp; java/</code>), AI
                Analyzed (<code className="text-[#58a6ff]">recovered/analyzed/</code>), and
                Reconstructed Android Studio Project (
                <code className="text-[#3fb950]">android-studio-project/</code>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isGenerating || isBuilding || isRunningAutoLoop}
              onClick={() => loadOrGenerateProject(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Reconstructing...' : 'Reconstruct New Version'}</span>
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

        {/* Phase 4 Action Toolbar: Build Project | Analyze Errors | Review AI Fixes | Auto-Rebuild Loop */}
        <div className="px-4 py-2 bg-[#0d1117] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#c9d1d9] shrink-0">
          {/* Task Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase text-[#8b949e] mr-1">
              Gradle Tasks:
            </span>
            {ALL_GRADLE_TASKS.map((t) => {
              const active = selectedTasks.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleGradleTask(t.id)}
                  title={t.desc}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border transition-colors ${
                    active
                      ? 'bg-[#2f81f7]/20 text-[#58a6ff] border-[#58a6ff]/50 font-semibold'
                      : 'bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-white'
                  }`}
                >
                  :{t.label}
                </button>
              );
            })}
          </div>

          {/* Primary Build & Repair Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {!isBuilding && !isRunningAutoLoop ? (
              <button
                type="button"
                onClick={handleStartGradleBuild}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold shadow"
              >
                <Play className="w-3 h-3" />
                <span>{currentBuild ? 'Rebuild Project' : 'Build Project'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancelBuild}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#f85149]/20 hover:bg-[#f85149]/30 border border-[#f85149]/50 text-[#ff7b72] font-semibold"
              >
                <Square className="w-3 h-3" />
                <span>Cancel Build</span>
              </button>
            )}

            <button
              type="button"
              disabled={isAnalyzingErrors || isBuilding || isRunningAutoLoop}
              onClick={handleAnalyzeErrorsWithAi}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#d29922]/50 text-[#e3b341] font-semibold disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" />
              <span>
                {isAnalyzingErrors
                  ? 'Analyzing Errors...'
                  : `Analyze Errors (${codeErrorsCount})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('errors_repair')}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#a371f7]/50 text-[#d2a8ff] font-semibold"
            >
              <Wrench className="w-3 h-3" />
              <span>Review AI Fixes ({buildState?.fixProposals.length || 0})</span>
            </button>

            <div className="flex items-center gap-1 bg-[#161b22] border border-[#58a6ff]/40 rounded px-1.5 py-0.5">
              <select
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="bg-transparent text-[10px] font-mono text-[#c9d1d9] focus:outline-none"
                title="Maximum Automatic Rebuild & Repair Iterations"
              >
                <option value={1} className="bg-[#0d1117]">
                  1x Retry
                </option>
                <option value={2} className="bg-[#0d1117]">
                  2x Retries
                </option>
                <option value={3} className="bg-[#0d1117]">
                  3x Retries
                </option>
                <option value={4} className="bg-[#0d1117]">
                  4x Retries
                </option>
                <option value={5} className="bg-[#0d1117]">
                  5x Retries
                </option>
              </select>
              <button
                type="button"
                disabled={isRunningAutoLoop || isBuilding}
                onClick={handleRunAutoRebuildLoop}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#2f81f7] hover:bg-[#388bfd] text-white font-semibold text-[10px] disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRunningAutoLoop ? 'animate-spin' : ''}`} />
                <span>{isRunningAutoLoop ? 'Auto-Repairing...' : 'Auto-Rebuild Loop'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveTab('apk_comparison');
                if (!comparisonReport) {
                  loadPhase5Comparison(true);
                }
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#238636]/20 hover:bg-[#238636]/30 border border-[#3fb950]/50 text-[#3fb950] font-semibold"
            >
              <GitCompare className="w-3 h-3" />
              <span>Compare &amp; Verify APKs</span>
            </button>
          </div>
        </div>

        {/* Navigation Sub-Tabs */}
        <div className="px-4 bg-[#161b22] border-b border-[#30363d] flex items-center gap-1.5 text-xs overflow-x-auto shrink-0">
          {[
            {
              id: 'validation',
              label: '1. Validation & Overview',
              icon: <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />,
            },
            {
              id: 'structure',
              label: `2. Project Structure & Sources (${report?.sourceIntegration.totalAppClasses || 0})`,
              icon: <FolderTree className="w-3.5 h-3.5 text-[#58a6ff]" />,
            },
            {
              id: 'dependencies',
              label: `3. Dependencies (${report?.dependencies.length || 0}) & Native`,
              icon: <Box className="w-3.5 h-3.5 text-[#e3b341]" />,
            },
            {
              id: 'config',
              label: `4. Config & Resources (${report?.resources.totalFilesRestored || 0})`,
              icon: <Layers className="w-3.5 h-3.5 text-[#a371f7]" />,
            },
            {
              id: 'build',
              label: `5. Live Gradle Build & APK Output`,
              icon: <Terminal className="w-3.5 h-3.5 text-[#79c0ff]" />,
            },
            {
              id: 'errors_repair',
              label: `6. Error Detection, AI Fixes (${pendingFixesCount}) & Rollback (${buildState?.backups.length || 0})`,
              icon: <Wrench className="w-3.5 h-3.5 text-[#ff7b72]" />,
            },
            {
              id: 'apk_comparison',
              label: `7. APK Comparison & Functional Verification (${comparisonReport?.overallStatus || 'Phase 5'})`,
              icon: <GitCompare className="w-3.5 h-3.5 text-[#3fb950]" />,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center gap-1.5 py-2.5 px-2.5 border-b-2 font-medium whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? 'border-[#3fb950] text-white'
                  : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded bg-[#f85149]/15 border border-[#f85149]/40 text-[#ff7b72] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-[10px] underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {feedbackMsg && (
            <div className="p-2.5 rounded bg-[#238636]/15 border border-[#3fb950]/40 text-[#3fb950] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedbackMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackMsg(null)}
                className="text-[10px] underline"
              >
                Close
              </button>
            </div>
          )}

          {isGenerating && !report ? (
            <div className="p-12 text-center space-y-2 text-[#8b949e]">
              <RefreshCw className="w-7 h-7 text-[#3fb950] animate-spin mx-auto" />
              <p className="text-sm font-semibold text-white">
                Reconstructing Complete Android Studio Project...
              </p>
              <p className="text-xs">
                Integrating verified AI-reconstructed sources, restoring XML resources &amp; jniLibs,
                resolving Gradle dependencies, and running 10-point validation...
              </p>
            </div>
          ) : report ? (
            <>
              {/* TAB 1: VALIDATION & OVERVIEW */}
              {activeTab === 'validation' && (
                <div className="space-y-4">
                  {/* Reconstruction Options Bar */}
                  <div className="p-2.5 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-wrap items-center justify-between gap-3 text-[11px]">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prioritizeReconstructed}
                          onChange={(e) => setPrioritizeReconstructed(e.target.checked)}
                          className="accent-[#238636]"
                        />
                        <span>Prioritize Verified AI-Reconstructed Sources</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={excludeThirdPartySdkSources}
                          onChange={(e) => setExcludeThirdPartySdkSources(e.target.checked)}
                          className="accent-[#238636]"
                        />
                        <span>Exclude 3rd-Party SDK Classes (Use Gradle Dependencies)</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sanitizeUnrecoveredMethods}
                          onChange={(e) => setSanitizeUnrecoveredMethods(e.target.checked)}
                          className="accent-[#238636]"
                        />
                        <span>Sanitize Broken JADX Method Dumps</span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useKotlinDsl}
                          onChange={(e) => setUseKotlinDsl(e.target.checked)}
                          className="accent-[#238636]"
                        />
                        <span>Kotlin DSL (build.gradle.kts)</span>
                      </label>
                    </div>
                  </div>

                  {/* Top Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                      <div className="text-[10px] uppercase text-[#8b949e]">App Classes</div>
                      <div className="text-lg font-bold text-white mt-0.5">
                        {report.sourceIntegration.totalAppClasses}
                      </div>
                      <div className="text-[10px] text-[#3fb950] font-mono">
                        {report.sourceIntegration.aiReconstructedFilesUsed} AI Reconstructed
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                      <div className="text-[10px] uppercase text-[#8b949e]">Resources &amp; Assets</div>
                      <div className="text-lg font-bold text-[#7ee787] mt-0.5">
                        {report.resources.totalFilesRestored}
                      </div>
                      <div className="text-[10px] text-[#8b949e] font-mono">
                        +{report.resources.assetsCount} Assets
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                      <div className="text-[10px] uppercase text-[#8b949e]">Gradle Dependencies</div>
                      <div className="text-lg font-bold text-[#58a6ff] mt-0.5">
                        {report.dependencies.length}
                      </div>
                      <div className="text-[10px] text-[#8b949e] font-mono">
                        {
                          report.dependencies.filter(
                            (d) => d.versionSource === 'recovered-from-apk'
                          ).length
                        }{' '}
                        Exact APK Versions
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                      <div className="text-[10px] uppercase text-[#8b949e]">Native (.so) Libs</div>
                      <div className="text-lg font-bold text-[#d2a8ff] mt-0.5">
                        {report.nativeSupport.restoredLibraries.length}
                      </div>
                      <div className="text-[10px] text-[#8b949e] font-mono">
                        ABIs: {report.nativeSupport.abiFolders.join(', ') || 'None'}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                      <div className="text-[10px] uppercase text-[#8b949e]">SDK Target</div>
                      <div className="text-lg font-bold text-[#e3b341] mt-0.5">
                        API {report.androidConfig.targetSdk}
                      </div>
                      <div className="text-[10px] text-[#8b949e] font-mono">
                        minSdk {report.androidConfig.minSdk} • compileSdk{' '}
                        {report.androidConfig.compileSdk}
                      </div>
                    </div>
                  </div>

                  {/* 10-Point Project Validation Checklist */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#3fb950]" />
                        10-Point Pre-Export Project Validation Suite
                      </h4>
                      <span className="text-[11px] font-mono text-[#3fb950]">
                        {report.validation.passedCount}/{report.validation.totalChecks} Checks Passed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {report.validation.checks.map((chk) => (
                        <div
                          key={chk.id}
                          className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] flex items-start gap-2.5"
                        >
                          {chk.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-[#3fb950] shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-[#e3b341] shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="text-xs font-semibold text-white">{chk.category}</div>
                            <div className="text-[11px] text-[#8b949e] mt-0.5">{chk.details}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Potential Build Blockers & Assumptions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#e3b341]">
                        Configuration &amp; Dependency Assumptions (
                        {report.validation.configurationAssumptions.length})
                      </h4>
                      <ul className="space-y-1.5 text-[11px] text-[#c9d1d9] list-disc list-inside max-h-[160px] overflow-y-auto">
                        {report.validation.configurationAssumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#ff7b72]">
                        Potential Build Blockers &amp; Warnings (
                        {report.validation.potentialBuildBlockers.length})
                      </h4>
                      {report.validation.potentialBuildBlockers.length === 0 ? (
                        <p className="text-[11px] text-[#3fb950]">
                          No build blockers detected. All classes and native libraries accounted for.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-[11px] text-[#c9d1d9] list-disc list-inside max-h-[160px] overflow-y-auto">
                          {report.validation.potentialBuildBlockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: PROJECT STRUCTURE & SOURCES */}
              {activeTab === 'structure' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Generated Android Studio Project Structure (Click any file to open in Editor)
                      </h4>
                      <span className="text-[11px] font-mono text-[#3fb950]">
                        Root: {report.projectRootRelativePath}/
                      </span>
                    </div>

                    <div className="divide-y divide-[#21262d] bg-[#0d1117] rounded border border-[#30363d]">
                      {report.projectStructurePreview.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-2 flex items-center justify-between gap-2 hover:bg-[#161b22]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">
                              {item.type}
                            </span>
                            <code className="text-[#58a6ff] font-mono truncate">{item.path}</code>
                            {item.description && (
                              <span className="text-[#8b949e] text-[11px] hidden sm:inline">
                                — {item.description}
                              </span>
                            )}
                          </div>

                          {item.type === 'file' && onOpenFile && (
                            <button
                              type="button"
                              onClick={() => {
                                const name = item.path.split('/').pop() || item.path;
                                onOpenFile(item.path, name);
                                onClose();
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-[10px] font-medium shrink-0"
                            >
                              <ExternalLink className="w-3 h-3 text-[#58a6ff]" />
                              <span>Open in Editor</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Prioritized AI-Reconstructed Sources */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#3fb950] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Prioritized Verified AI-Reconstructed Files (
                      {report.sourceIntegration.aiReconstructedFilesList.length})
                    </h4>
                    {report.sourceIntegration.aiReconstructedFilesList.length === 0 ? (
                      <p className="text-[11px] text-[#8b949e]">
                        No AI-reconstructed files integrated yet. Recover obfuscated classes in the
                        Recovery panel and click &ldquo;Reconstruct New Version&rdquo; to integrate
                        them automatically.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {report.sourceIntegration.aiReconstructedFilesList.map((f, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              if (onOpenFile) {
                                const fullPath = `android-studio-project/app/src/main/java/${f}`;
                                onOpenFile(fullPath, f.split('/').pop() || f);
                                onClose();
                              }
                            }}
                            className="px-2 py-1 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#238636]/50 text-[#3fb950] font-mono text-[11px]"
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Unrecovered / Sanitized Classes Report */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#e3b341]">
                      Unrecovered / Partially Decompiled Classes (
                      {report.sourceIntegration.unrecoveredClasses.length})
                    </h4>
                    {report.sourceIntegration.unrecoveredClasses.length === 0 ? (
                      <p className="text-[11px] text-[#3fb950]">
                        All application classes were cleanly decompiled or AI-reconstructed!
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                        {report.sourceIntegration.unrecoveredClasses.map((u, i) => (
                          <div
                            key={i}
                            className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-mono text-white font-semibold truncate">
                                {u.className}
                              </div>
                              <div className="text-[10px] text-[#8b949e]">
                                {u.reason} • Action: <code>{u.actionTaken}</code>
                                {u.unresolvedMethods.length > 0 &&
                                  ` • Methods: ${u.unresolvedMethods.join(', ')}`}
                              </div>
                            </div>
                            {onOpenFile && (
                              <button
                                type="button"
                                onClick={() => {
                                  const name = u.originalPath.split('/').pop() || u.className;
                                  onOpenFile(u.originalPath, name);
                                  onClose();
                                }}
                                className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] text-[10px] font-medium shrink-0"
                              >
                                Inspect &amp; Recover
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: DEPENDENCIES & NATIVE (.SO) */}
              {activeTab === 'dependencies' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                      Restored Gradle Dependencies ({report.dependencies.length})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse font-mono text-[11px]">
                        <thead>
                          <tr className="border-b border-[#30363d] text-[#8b949e]">
                            <th className="py-1.5 px-2">Gradle Coordinate</th>
                            <th className="py-1.5 px-2">Category</th>
                            <th className="py-1.5 px-2">Version Source</th>
                            <th className="py-1.5 px-2">Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.dependencies.map((d, i) => (
                            <tr key={i} className="border-b border-[#21262d] text-[#c9d1d9]">
                              <td className="py-1.5 px-2 text-[#58a6ff]">{d.coordinate}</td>
                              <td className="py-1.5 px-2">{d.category}</td>
                              <td className="py-1.5 px-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    d.versionSource === 'recovered-from-apk'
                                      ? 'bg-[#238636]/20 text-[#3fb950]'
                                      : 'bg-[#d29922]/20 text-[#e3b341]'
                                  }`}
                                >
                                  {d.versionSource}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-[#8b949e]">{d.evidence}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Native Libraries jniLibs */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                        <Binary className="w-4 h-4 text-[#d2a8ff]" />
                        Native Libraries Restored to app/src/main/jniLibs (
                        {report.nativeSupport.restoredLibraries.length})
                      </h4>
                      <span className="text-[11px] font-mono text-[#8b949e]">
                        ABIs: {report.nativeSupport.abiFolders.join(', ') || 'None'}
                      </span>
                    </div>

                    {report.nativeSupport.restoredLibraries.length === 0 ? (
                      <p className="text-[11px] text-[#8b949e]">
                        No native <code>.so</code> binaries present in this APK.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
                        {report.nativeSupport.restoredLibraries.map((lib, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between font-mono text-[11px]"
                          >
                            <span className="text-[#d2a8ff] truncate">{lib.relativePath}</span>
                            <span className="text-[#8b949e] shrink-0">
                              {lib.abi} • {(lib.size / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: ANDROID CONFIG & RESOURCES */}
              {activeTab === 'config' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Recovered Android Configuration
                      </h4>
                      <div className="space-y-1 text-[11px] font-mono">
                        <div>
                          <span className="text-[#8b949e]">Application ID:</span>{' '}
                          <span className="text-[#58a6ff]">{report.androidConfig.applicationId}</span>
                        </div>
                        <div>
                          <span className="text-[#8b949e]">Version:</span>{' '}
                          <span className="text-white">
                            {report.androidConfig.versionName} (code {report.androidConfig.versionCode})
                          </span>
                        </div>
                        <div>
                          <span className="text-[#8b949e]">SDK Levels:</span>{' '}
                          <span className="text-[#3fb950]">
                            minSdk {report.androidConfig.minSdk} / targetSdk{' '}
                            {report.androidConfig.targetSdk} / compileSdk{' '}
                            {report.androidConfig.compileSdk}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#8b949e]">Components:</span>{' '}
                          <span>
                            {report.androidConfig.activities.length} Activities,{' '}
                            {report.androidConfig.services.length} Services,{' '}
                            {report.androidConfig.receivers.length} Receivers,{' '}
                            {report.androidConfig.providers.length} Providers
                          </span>
                        </div>
                        <div>
                          <span className="text-[#8b949e]">Permissions:</span>{' '}
                          <span>{report.androidConfig.permissions.length} declared</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Restored Resources Breakdown ({report.resources.totalFilesRestored})
                      </h4>
                      <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[11px]">
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">
                            {report.resources.categories.layouts}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Layouts</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">
                            {report.resources.categories.drawables}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Drawables</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">
                            {report.resources.categories.values}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Values/XML</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">
                            {report.resources.categories.mipmaps}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Mipmaps</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">
                            {report.resources.categories.animations}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Animations</div>
                        </div>
                        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="font-bold text-white">{report.resources.assetsCount}</div>
                          <div className="text-[9px] text-[#8b949e]">Assets</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: PHASE 4 LIVE GRADLE BUILD MONITORING & APK OUTPUT */}
              {activeTab === 'build' && (
                <div className="space-y-4">
                  {/* Environment Compatibility Card */}
                  {buildState?.environment && (
                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-[#58a6ff]" />
                          Build Environment &amp; Prerequisite Verification
                        </h4>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            buildState.environment.canExecuteFullGradleBuild
                              ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
                              : 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40'
                          }`}
                        >
                          {buildState.environment.canExecuteFullGradleBuild
                            ? 'Full Android SDK & JDK Ready'
                            : 'Static Compiler Active (Missing Host SDK/JDK)'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
                        <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-[9px] text-[#8b949e] uppercase">JDK / Javac</div>
                          <div
                            className={
                              buildState.environment.javaAvailable
                                ? 'text-[#3fb950] font-semibold'
                                : 'text-[#f85149] font-semibold'
                            }
                          >
                            {buildState.environment.javaAvailable
                              ? buildState.environment.javaVersion || 'Installed'
                              : 'Not Installed'}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-[9px] text-[#8b949e] uppercase">Gradle Wrapper</div>
                          <div
                            className={
                              buildState.environment.gradleWrapperAvailable
                                ? 'text-[#3fb950] font-semibold'
                                : 'text-[#f85149] font-semibold'
                            }
                          >
                            {buildState.environment.gradleWrapperAvailable
                              ? './gradlew Present'
                              : 'Missing'}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-[9px] text-[#8b949e] uppercase">Android SDK</div>
                          <div
                            className={
                              buildState.environment.androidSdkAvailable
                                ? 'text-[#3fb950] font-semibold truncate'
                                : 'text-[#f85149] font-semibold'
                            }
                            title={buildState.environment.androidSdkPath}
                          >
                            {buildState.environment.androidSdkAvailable
                              ? buildState.environment.androidSdkPath
                              : 'Not Found'}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                          <div className="text-[9px] text-[#8b949e] uppercase">AGP Compatibility</div>
                          <div
                            className={
                              buildState.environment.agpCompatible
                                ? 'text-[#3fb950] font-semibold'
                                : 'text-[#e3b341] font-semibold'
                            }
                          >
                            AGP {buildState.environment.agpVersion}
                          </div>
                        </div>
                      </div>

                      {buildState.environment.setupInstructions.length > 0 && (
                        <div className="p-2.5 rounded bg-[#0d1117] border border-[#d29922]/40 text-[11px] space-y-1">
                          <div className="font-semibold text-[#e3b341]">
                            Host Environment Setup Procedure (Never simulates APK builds when tools are missing):
                          </div>
                          <ul className="list-disc list-inside text-[#c9d1d9] font-mono text-[10px] space-y-0.5">
                            {buildState.environment.setupInstructions.map((inst, idx) => (
                              <li key={idx}>{inst}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live Build Status & Terminal */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                            <Terminal className="w-4 h-4 text-[#79c0ff]" />
                            Live Gradle Build Monitor
                          </h4>
                          {currentBuild && (
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${
                                currentBuild.status === 'succeeded'
                                  ? 'bg-[#238636]/20 text-[#3fb950] border-[#3fb950]/50'
                                  : currentBuild.status === 'running'
                                  ? 'bg-[#2f81f7]/20 text-[#58a6ff] border-[#58a6ff]/50 animate-pulse'
                                  : currentBuild.status === 'environment_missing'
                                  ? 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/50'
                                  : 'bg-[#f85149]/20 text-[#ff7b72] border-[#f85149]/50'
                              }`}
                            >
                              {currentBuild.status}
                            </span>
                          )}
                        </div>
                        {currentBuild && (
                          <div className="text-[11px] font-mono text-[#8b949e]">
                            Command: <code className="text-[#79c0ff]">{currentBuild.command}</code> •
                            Stage: <strong className="text-white">{liveStage || currentBuild.stage}</strong> •
                            Duration: <strong>{(currentBuild.durationMs / 1000).toFixed(2)}s</strong> •
                            Errors: <strong className="text-[#ff7b72]">{codeErrorsCount}</strong> •
                            Warnings: <strong className="text-[#e3b341]">{currentBuild.warnings.length}</strong>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <a
                          href={api.getGradleBuildReportDownloadUrl(sessionId, 'md')}
                          download="gradle-build-report.md"
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] text-[11px] font-medium"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#e3b341]" />
                          <span>Download Build Report (.md)</span>
                        </a>
                      </div>
                    </div>

                    {currentBuild && (
                      <div className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] text-[11px] text-[#c9d1d9]">
                        <strong>Outcome Summary:</strong> {currentBuild.summary}
                      </div>
                    )}

                    {/* Live Log Terminal */}
                    <div
                      ref={logContainerRef}
                      className="p-3 rounded bg-[#05070a] border border-[#30363d] font-mono text-[11px] text-[#c9d1d9] h-[220px] overflow-y-auto space-y-1"
                    >
                      {liveLogs.length === 0 ? (
                        <div className="text-[#8b949e]">
                          Click &ldquo;Build Project&rdquo; or &ldquo;Auto-Rebuild Loop&rdquo; in the
                          toolbar above to execute Gradle tasks and stream live build output.
                        </div>
                      ) : (
                        liveLogs.map((line, idx) => (
                          <div
                            key={idx}
                            className={
                              line.includes('[SUCCESS]')
                                ? 'text-[#3fb950]'
                                : line.includes('[ERROR]') ||
                                  line.includes('[FAILED]') ||
                                  line.includes('error:')
                                ? 'text-[#ff7b72]'
                                : line.includes('[STAGE') || line.includes('[DIAGNOSTICS]')
                                ? 'text-[#58a6ff]'
                                : 'text-[#c9d1d9]'
                            }
                          >
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Auto-Rebuild Loop Iteration Summary */}
                  {buildState?.lastAutoLoop && (
                    <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#58a6ff]/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#58a6ff] flex items-center gap-1.5">
                          <RefreshCw className="w-3.5 h-3.5" />
                          10-Step Automatic Rebuild &amp; Repair Loop (
                          {buildState.lastAutoLoop.attemptsUsed}/
                          {buildState.lastAutoLoop.maxRetries} Iterations)
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#21262d] text-white">
                          Final Status: {buildState.lastAutoLoop.finalStatus}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#c9d1d9]">{buildState.lastAutoLoop.summary}</p>
                      <div className="space-y-1">
                        {buildState.lastAutoLoop.iterations.map((it) => (
                          <div
                            key={it.attempt}
                            className="p-2 rounded bg-[#0d1117] border border-[#30363d] text-[11px] font-mono flex items-center justify-between gap-2"
                          >
                            <span>{it.summary}</span>
                            <span className="text-[#8b949e] shrink-0">
                              Remaining Errors: {it.remainingErrors}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Verified APK Outputs Management */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                        <FileBox className="w-4 h-4 text-[#3fb950]" />
                        Verified Generated APK Artifacts ({buildState?.apkArtifacts.length || 0})
                      </h4>
                      {currentBuild && (
                        <span className="text-[10px] font-mono text-[#8b949e]">
                          {currentBuild.apkVerification.details}
                        </span>
                      )}
                    </div>

                    {!buildState?.apkArtifacts || buildState.apkArtifacts.length === 0 ? (
                      <p className="text-[11px] text-[#8b949e]">
                        No verified Gradle APK binary present yet. An APK is only listed here when
                        Gradle exits with code 0, the file is non-empty, and its internal ZIP
                        structure (<code>AndroidManifest.xml</code> + <code>classes.dex</code>) is
                        verified.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {buildState.apkArtifacts.map((apk) => (
                          <div
                            key={apk.id}
                            className="p-2.5 rounded bg-[#0d1117] border border-[#238636]/50 flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-mono font-bold text-white flex items-center gap-1.5">
                                <span>{apk.filename}</span>
                                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950]">
                                  {apk.variant}
                                </span>
                              </div>
                              <div className="text-[10px] text-[#8b949e] font-mono mt-0.5">
                                {apk.packageName} v{apk.versionName} ({apk.versionCode}) •{' '}
                                {(apk.sizeBytes / 1024).toFixed(1)} KB • {apk.dexCount} DEX
                              </div>
                            </div>
                            <a
                              href={api.getGeneratedApkDownloadUrl(sessionId, apk.id)}
                              download={apk.filename}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-[11px] font-semibold shrink-0"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download APK</span>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 6: INTELLIGENT ERROR DETECTION, AI FIXES & ROLLBACK */}
              {activeTab === 'errors_repair' && (
                <div className="space-y-4">
                  {/* Detected Compilation / Build Errors */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                        <AlertOctagon className="w-4 h-4 text-[#ff7b72]" />
                        Classified Build &amp; Compiler Errors ({codeErrorsCount})
                      </h4>
                      <button
                        type="button"
                        disabled={isAnalyzingErrors || codeErrorsCount === 0}
                        onClick={handleAnalyzeErrorsWithAi}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-[11px] font-semibold disabled:opacity-50"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>
                          {isAnalyzingErrors ? 'Analyzing with AI...' : 'Analyze Errors with AI'}
                        </span>
                      </button>
                    </div>

                    {!currentBuild ? (
                      <p className="text-[11px] text-[#8b949e]">
                        Click &ldquo;Build Project&rdquo; above to run Gradle &amp; compiler error
                        detection.
                      </p>
                    ) : codeErrorsCount === 0 ? (
                      <div className="p-3 rounded bg-[#238636]/15 border border-[#3fb950]/40 text-[#3fb950] flex items-center gap-2 text-[11px]">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          Zero source, manifest, resource, or dependency errors detected in the
                          reconstructed Android Studio project!
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                        {currentBuild.errors
                          .filter((e) => e.category !== 'environment_missing')
                          .map((err) => (
                            <div
                              key={err.id}
                              className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40 font-mono text-[10px] font-semibold">
                                    {err.categoryLabel}
                                  </span>
                                  {err.filePath && (
                                    <code className="text-[#58a6ff] font-mono text-[11px]">
                                      {err.filePath}:{err.line || 1}
                                    </code>
                                  )}
                                </div>
                                {err.filePath && onOpenFile && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const fullRel = `android-studio-project/${err.filePath}`;
                                      const name = err.filePath!.split('/').pop() || err.filePath!;
                                      onOpenFile(fullRel, name);
                                      onClose();
                                    }}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-[10px]"
                                  >
                                    <ExternalLink className="w-3 h-3 text-[#58a6ff]" />
                                    <span>Open File</span>
                                  </button>
                                )}
                              </div>
                              <div className="text-[11px] text-white">{err.message}</div>
                              {err.codeSnippet && (
                                <pre className="p-2 rounded bg-[#05070a] border border-[#21262d] font-mono text-[10px] text-[#8b949e] overflow-x-auto">
                                  {err.codeSnippet}
                                </pre>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* AI Error Fix Proposals Review & Approval */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                          <Wrench className="w-4 h-4 text-[#d2a8ff]" />
                          Review AI Code Repair Proposals ({buildState?.fixProposals.length || 0})
                        </h4>
                        <p className="text-[10px] text-[#8b949e]">
                          Creates an automatic backup in <code>.repair-backups/</code> before
                          applying minimal patches. Original decompiled files are never modified.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isApplyingFixes || selectedFixIds.size === 0}
                        onClick={handleApplySelectedFixes}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {isApplyingFixes
                            ? 'Applying Fixes...'
                            : `Apply Selected Fixes (${selectedFixIds.size})`}
                        </span>
                      </button>
                    </div>

                    {!buildState?.fixProposals || buildState.fixProposals.length === 0 ? (
                      <p className="text-[11px] text-[#8b949e]">
                        No AI repair proposals generated yet. Click &ldquo;Analyze Errors with
                        AI&rdquo; to inspect compilation errors against JADX &amp; Smali evidence.
                      </p>
                    ) : (
                      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                        {buildState.fixProposals.map((fix: AiErrorFixProposal) => {
                          const isChecked = selectedFixIds.has(fix.id);
                          const isApplied = fix.status === 'applied';
                          return (
                            <div
                              key={fix.id}
                              className="p-3 rounded bg-[#0d1117] border border-[#30363d] space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    disabled={isApplied}
                                    checked={isChecked}
                                    onChange={() => toggleSelectFix(fix.id)}
                                    className="accent-[#238636]"
                                  />
                                  <span className="font-mono font-bold text-[#58a6ff]">
                                    {fix.affectedFilePath}
                                  </span>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#21262d] text-[#c9d1d9]">
                                    {fix.categoryLabel}
                                  </span>
                                </label>

                                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                                  <span
                                    className={`px-1.5 py-0.5 rounded ${
                                      fix.confidenceLevel === 'HIGH'
                                        ? 'bg-[#238636]/20 text-[#3fb950]'
                                        : 'bg-[#d29922]/20 text-[#e3b341]'
                                    }`}
                                  >
                                    Confidence: {fix.confidenceScore}% ({fix.confidenceLevel})
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded uppercase ${
                                      fix.status === 'applied'
                                        ? 'bg-[#238636] text-white'
                                        : fix.status === 'rolled_back'
                                        ? 'bg-[#f85149]/20 text-[#ff7b72]'
                                        : 'bg-[#21262d] text-[#8b949e]'
                                    }`}
                                  >
                                    {fix.status}
                                  </span>
                                </div>
                              </div>

                              <div className="text-[11px] text-[#c9d1d9]">
                                <strong>Root Cause:</strong> {fix.rootCause}
                              </div>
                              <div className="text-[11px] text-[#8b949e]">
                                <strong>Explanation:</strong> {fix.explanation}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[10px]">
                                <div className="p-2 rounded bg-[#f85149]/10 border border-[#f85149]/30 overflow-x-auto">
                                  <div className="text-[#ff7b72] font-bold mb-1">
                                    - Original Snippet
                                  </div>
                                  <pre className="text-[#c9d1d9] whitespace-pre-wrap">
                                    {fix.originalSnippet}
                                  </pre>
                                </div>
                                <div className="p-2 rounded bg-[#238636]/10 border border-[#3fb950]/30 overflow-x-auto">
                                  <div className="text-[#3fb950] font-bold mb-1">
                                    + Proposed Minimal Fix
                                  </div>
                                  <pre className="text-[#c9d1d9] whitespace-pre-wrap">
                                    {fix.replacementSnippet}
                                  </pre>
                                </div>
                              </div>

                              <div className="text-[10px] font-mono text-[#3fb950] flex items-center gap-2">
                                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                                <span>{fix.validationChecks.details}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Backups & Rollback Manager */}
                  <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <History className="w-4 h-4 text-[#e3b341]" />
                      Safe Code Repair Backups &amp; Rollback ({buildState?.backups.length || 0})
                    </h4>
                    {!buildState?.backups || buildState.backups.length === 0 ? (
                      <p className="text-[11px] text-[#8b949e]">
                        No repair backups created yet. Backups are automatically created before any
                        AI code repair is applied.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {buildState.backups.map((bkp) => (
                          <div
                            key={bkp.backupId}
                            className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex flex-wrap items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="font-mono">
                              <span className="text-[#e3b341] font-bold">{bkp.backupId}</span> —{' '}
                              <span className="text-[#c9d1d9]">{bkp.reason}</span> (
                              <span className="text-[#8b949e]">
                                {bkp.modifiedFiles.join(', ')}
                              </span>
                              )
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(bkp.restored) || isRollingBack === bkp.backupId}
                              onClick={() => handleRollbackBackup(bkp.backupId)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#f85149]/20 hover:text-[#ff7b72] border border-[#30363d] text-[#c9d1d9] text-[10px] font-semibold disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{bkp.restored ? 'Rolled Back' : 'Rollback'}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===================== TAB 7: PHASE 5 APK COMPARISON & FUNCTIONAL VERIFICATION ===================== */}
              {activeTab === 'apk_comparison' && (
                <ApkComparisonTabPanel
                  sessionId={sessionId}
                  comparisonReport={comparisonReport}
                  isLoadingComparison={isLoadingComparison}
                  onRunComparison={loadPhase5Comparison}
                  onOpenFile={onOpenFile}
                  onCloseModal={onClose}
                  onRefreshBuildState={loadPhase4BuildState}
                />
              )}
            </>
          ) : null}
        </div>

        {/* Footer Export Actions */}
        <div className="px-4 py-3 bg-[#161b22] border-t border-[#30363d] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="text-[11px] text-[#8b949e] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#3fb950]" />
            <span>
              Original decompiled files remain untouched. All builds and repairs operate inside{' '}
              <code>android-studio-project/</code>.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={api.getGradleBuildReportDownloadUrl(sessionId, 'md')}
              download="GRADLE_BUILD_REPORT.md"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] font-medium"
            >
              <FileText className="w-3.5 h-3.5 text-[#79c0ff]" />
              <span>Download Build Report (.md)</span>
            </a>

            <a
              href={api.getReconstructionReportDownloadUrl(sessionId, 'md')}
              download="RECONSTRUCTION_REPORT.md"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] font-medium"
            >
              <FileText className="w-3.5 h-3.5 text-[#e3b341]" />
              <span>Reconstruction Report (.md)</span>
            </a>

            <a
              href={api.getReconstructedSourcesDownloadUrl(sessionId)}
              download="reconstructed-sources.zip"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border border-[#58a6ff]/50 text-[#58a6ff] font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Reconstructed Source (ZIP)</span>
            </a>

            <a
              href={api.getGradleDownloadUrl(sessionId)}
              download="android-studio-project.zip"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold shadow"
            >
              <FileBox className="w-3.5 h-3.5" />
              <span>Download Android Studio Project (ZIP)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
