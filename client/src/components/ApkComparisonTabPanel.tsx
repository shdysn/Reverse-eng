import React, { useState } from 'react';
import {
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Wrench,
  Download,
  FileText,
  FileBox,
  Layers,
  Code2,
  Cpu,
  Smartphone,
  Terminal,
  ShieldCheck,
  ExternalLink,
  Check,
  Binary,
} from 'lucide-react';
import { api } from '../services/api.js';
import type {
  FinalComparisonReport,
  VerificationCheckStatus,
  ScoreMetricDetail,
  AiFinalRepairProposal,
} from '../types/index.js';

interface ApkComparisonTabPanelProps {
  sessionId: string;
  comparisonReport: FinalComparisonReport | null;
  isLoadingComparison: boolean;
  onRunComparison: (forceRefresh: boolean) => Promise<void>;
  onOpenFile?: (path: string, name: string) => void;
  onCloseModal?: () => void;
  onRefreshBuildState?: () => Promise<void>;
}

export const ApkComparisonTabPanel: React.FC<ApkComparisonTabPanelProps> = ({
  sessionId,
  comparisonReport,
  isLoadingComparison,
  onRunComparison,
  onOpenFile,
  onCloseModal,
  onRefreshBuildState,
}) => {
  const [subSection, setSubSection] = useState<
    | 'overview'
    | 'metadata'
    | 'resources'
    | 'source'
    | 'functionality'
    | 'ui_runtime'
    | 'final_repair'
  >('overview');

  const [isGeneratingRepairs, setIsGeneratingRepairs] = useState(false);
  const [isApplyingRepairs, setIsApplyingRepairs] = useState(false);
  const [triggerRebuildOnApply, setTriggerRebuildOnApply] = useState(true);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const renderStatusBadge = (status: VerificationCheckStatus) => {
    switch (status) {
      case 'PASS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
            <CheckCircle2 className="w-3 h-3" />
            PASS
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40">
            <AlertTriangle className="w-3 h-3" />
            WARNING
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40">
            <XCircle className="w-3 h-3" />
            FAIL
          </span>
        );
      case 'NOT_TESTED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#30363d]/60 text-[#8b949e] border border-[#30363d]">
            <HelpCircle className="w-3 h-3" />
            NOT_TESTED
          </span>
        );
    }
  };

  const handleGenerateAiFinalRepairs = async () => {
    if (isGeneratingRepairs) return;
    try {
      setIsGeneratingRepairs(true);
      setActionError(null);
      setActionMessage(null);
      const proposals = await api.generateAiFinalRepairs(sessionId);
      await onRunComparison(false);
      const pending = proposals.filter((p) => p.status === 'pending').map((p) => p.id);
      setSelectedProposalIds(new Set(pending));
      setSubSection('final_repair');
      setActionMessage(
        `Generated ${proposals.length} AI Final Repair proposal(s) from Original vs Reconstructed comparison.`
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setIsGeneratingRepairs(false);
    }
  };

  const handleApplyFinalRepairs = async () => {
    if (isApplyingRepairs || selectedProposalIds.size === 0) return;
    try {
      setIsApplyingRepairs(true);
      setActionError(null);
      setActionMessage(null);
      const res = await api.applyFinalRepairs(sessionId, {
        proposalIds: Array.from(selectedProposalIds),
        triggerRebuildAfterApply: triggerRebuildOnApply,
      });
      await onRunComparison(true);
      if (onRefreshBuildState) {
        await onRefreshBuildState();
      }
      setSelectedProposalIds(new Set());
      setActionMessage(
        `Backed up ${res.backup.modifiedFiles.length} file(s) (${res.backup.backupId}), applied ${res.appliedProposals.length} final repair(s)${
          res.rebuildRun ? `, and executed Gradle rebuild (${res.rebuildRun.status})` : ''
        }.`
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setIsApplyingRepairs(false);
    }
  };

  const toggleProposal = (id: string) => {
    setSelectedProposalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoadingComparison && !comparisonReport) {
    return (
      <div className="p-10 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-[#58a6ff]/30 border-t-[#58a6ff] rounded-full animate-spin mx-auto" />
        <p className="text-sm font-semibold text-white">
          Comparing Original APK vs Reconstructed APK &amp; Project...
        </p>
        <p className="text-xs text-[#8b949e] max-w-lg mx-auto">
          Inspecting Manifest &amp; Gradle metadata, 11 resource categories, JADX &amp; Smali class
          signatures, 11 functional domains, XML layout hierarchies, and probing isolated runtime
          devices...
        </p>
      </div>
    );
  }

  if (!comparisonReport) {
    return (
      <div className="p-8 text-center bg-[#161b22] border border-[#30363d] rounded-lg space-y-3">
        <GitCompare className="w-8 h-8 text-[#58a6ff] mx-auto" />
        <h4 className="text-sm font-bold text-white">
          Phase 5: Original APK vs Reconstructed APK Comparison &amp; Functional Verification
        </h4>
        <p className="text-xs text-[#8b949e] max-w-xl mx-auto">
          Run a comprehensive side-by-side verification comparing your original APK (
          <code>decoded/</code> &amp; <code>java/</code>) with the reconstructed Android Studio
          project (<code>android-studio-project/</code>).
        </p>
        <button
          type="button"
          onClick={() => onRunComparison(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow"
        >
          <GitCompare className="w-4 h-4" />
          <span>Run Full APK Comparison &amp; Verification</span>
        </button>
      </div>
    );
  }

  const scoreCards: ScoreMetricDetail[] = [
    comparisonReport.scores.metadataSimilarity,
    comparisonReport.scores.resourceSimilarity,
    comparisonReport.scores.sourceStructureSimilarity,
    comparisonReport.scores.uiSimilarity,
    comparisonReport.scores.runtimeTestCoverage,
    comparisonReport.scores.functionalVerification,
  ];

  const pendingProposals = comparisonReport.aiFinalRepairProposals.filter(
    (p) => p.status === 'pending' || p.status === 'approved'
  );

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded bg-[#2f81f7]/20 text-[#58a6ff] border border-[#58a6ff]/40">
            <GitCompare className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Original APK vs Reconstructed APK Verification
              </span>
              {renderStatusBadge(comparisonReport.overallStatus)}
              <span className="text-[10px] font-mono text-[#8b949e]">
                Reconstructed Source: {comparisonReport.reconstructedApkInfo.path} (
                {comparisonReport.reconstructedApkInfo.source})
              </span>
            </div>
            <p className="text-[11px] text-[#8b949e] mt-0.5">
              {comparisonReport.scores.disclaimer}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isGeneratingRepairs}
            onClick={handleGenerateAiFinalRepairs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#a371f7]/50 text-[#d2a8ff] text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isGeneratingRepairs
                ? 'Analyzing Differences...'
                : `AI Final Repair (${comparisonReport.aiFinalRepairProposals.length})`}
            </span>
          </button>

          <button
            type="button"
            disabled={isLoadingComparison}
            onClick={() => onRunComparison(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingComparison ? 'animate-spin' : ''}`} />
            <span>{isLoadingComparison ? 'Comparing...' : 'Re-Run Comparison'}</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-2.5 rounded bg-[#f85149]/15 border border-[#f85149]/40 text-[#ff7b72] text-xs flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="underline text-[10px]">
            Dismiss
          </button>
        </div>
      )}

      {actionMessage && (
        <div className="p-2.5 rounded bg-[#238636]/15 border border-[#3fb950]/40 text-[#3fb950] text-xs flex items-center justify-between">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)} className="underline text-[10px]">
            Dismiss
          </button>
        </div>
      )}

      {/* 6 Separate Evidence-Based Functionality Scores Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        {scoreCards.map((sc) => (
          <div
            key={sc.key}
            className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between space-y-2"
          >
            <div className="flex items-start justify-between gap-1">
              <span className="text-[11px] font-bold text-white leading-tight">{sc.label}</span>
              {renderStatusBadge(sc.status)}
            </div>

            <div>
              <div className="text-xl font-bold font-mono text-white">
                {sc.score === null ? (
                  <span className="text-xs text-[#8b949e]">NOT_TESTED</span>
                ) : (
                  `${sc.score}%`
                )}
              </div>
              {sc.score !== null && (
                <div className="w-full h-1.5 bg-[#0d1117] rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full ${
                      sc.status === 'PASS'
                        ? 'bg-[#3fb950]'
                        : sc.status === 'WARNING'
                        ? 'bg-[#e3b341]'
                        : 'bg-[#f85149]'
                    }`}
                    style={{ width: `${Math.max(5, sc.score)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="inline-block text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d1117] text-[#58a6ff] border border-[#21262d]">
                Basis: {sc.verificationBasis}
              </span>
              <p className="text-[10px] text-[#8b949e] leading-snug">{sc.evidenceSummary}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-Navigation Pills */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#161b22] p-1.5 rounded-lg border border-[#30363d]">
        {[
          {
            id: 'overview',
            label: 'Overview & Final Exports (7)',
            icon: <FileText className="w-3.5 h-3.5 text-[#3fb950]" />,
          },
          {
            id: 'metadata',
            label: `1. APK Metadata (${comparisonReport.metadataComparison.summary.passedCount}/${comparisonReport.metadataComparison.summary.totalFields})`,
            icon: <ShieldCheck className="w-3.5 h-3.5 text-[#58a6ff]" />,
          },
          {
            id: 'resources',
            label: `2. Resources (${comparisonReport.resourceComparison.differences.length} diffs)`,
            icon: <Layers className="w-3.5 h-3.5 text-[#a371f7]" />,
          },
          {
            id: 'source',
            label: `3. Source Code (${comparisonReport.sourceCodeComparison.metrics.reconstructedAppClasses}/${comparisonReport.sourceCodeComparison.metrics.originalAppClasses} classes)`,
            icon: <Code2 className="w-3.5 h-3.5 text-[#e3b341]" />,
          },
          {
            id: 'functionality',
            label: `4. Functionality (${comparisonReport.functionalityAnalysis.summary.preservedDomains}/${comparisonReport.functionalityAnalysis.summary.applicableDomains})`,
            icon: <Cpu className="w-3.5 h-3.5 text-[#7ee787]" />,
          },
          {
            id: 'ui_runtime',
            label: `5 & 6. UI (${comparisonReport.uiComparison.summary.matchedLayouts}/${comparisonReport.uiComparison.summary.totalLayouts}) & Runtime (${comparisonReport.automatedTesting.status})`,
            icon: <Smartphone className="w-3.5 h-3.5 text-[#79c0ff]" />,
          },
          {
            id: 'final_repair',
            label: `9. AI Final Repair (${pendingProposals.length} pending)`,
            icon: <Wrench className="w-3.5 h-3.5 text-[#d2a8ff]" />,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubSection(tab.id as any)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold transition-colors ${
              subSection === tab.id
                ? 'bg-[#21262d] text-white border border-[#58a6ff]/50 shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ================= SUBSECTION: OVERVIEW & FINAL EXPORTS ================= */}
      {subSection === 'overview' && (
        <div className="space-y-4">
          {/* 10. Final Export Suite (All 7 Required Artifacts) */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#238636]/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-[#3fb950]" />
                  10. Final Export Suite — Download Verified Project, APK &amp; Verification Reports
                </h4>
                <p className="text-[11px] text-[#8b949e]">
                  Export the reconstructed Android Studio project, final APK, comparison report,
                  missing components report, runtime testing report, build logs, and recovery
                  history.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
              <a
                href={api.getGradleDownloadUrl(sessionId)}
                download="reconstructed-android-studio-project.zip"
                className="p-2.5 rounded bg-[#238636]/20 hover:bg-[#238636]/30 border border-[#3fb950]/50 text-white flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileBox className="w-4 h-4 text-[#3fb950] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-bold">1. Reconstructed Project</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">Android Studio ZIP</div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'final-apk')}
                download="final-application.apk"
                className="p-2.5 rounded bg-[#2f81f7]/20 hover:bg-[#2f81f7]/30 border border-[#58a6ff]/50 text-white flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Binary className="w-4 h-4 text-[#58a6ff] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-bold">2. Final APK Binary</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">
                      {comparisonReport.reconstructedApkInfo.exists
                        ? comparisonReport.reconstructedApkInfo.source
                        : 'Original / Fallback APK'}
                    </div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'comparison-report', 'md')}
                download="comparison-report.md"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-[#7ee787] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">3. Comparison Report</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">Markdown (.md)</div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'missing-components', 'md')}
                download="missing-components-report.md"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-[#e3b341] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">4. Missing Components</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">
                      {comparisonReport.missingComponents.length} items (.md)
                    </div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'runtime-report', 'md')}
                download="runtime-testing-report.md"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Smartphone className="w-4 h-4 text-[#79c0ff] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">5. Runtime Test Report</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">
                      Status: {comparisonReport.automatedTesting.status} (.md)
                    </div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'build-logs', 'md')}
                download="build-logs.txt"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="w-4 h-4 text-[#d2a8ff] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">6. Gradle Build Logs</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">Full Console Logs (.txt)</div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'recovery-history', 'md')}
                download="recovery-history.md"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-[#3fb950] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">7. AI Recovery History</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">Phases 1–5 Audit (.md)</div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>

              <a
                href={api.getFinalExportDownloadUrl(sessionId, 'comparison-report', 'json')}
                download="comparison-report.json"
                className="p-2.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Code2 className="w-4 h-4 text-[#58a6ff] shrink-0" />
                  <div className="truncate">
                    <div className="text-[11px] font-semibold">JSON Verification Bundle</div>
                    <div className="text-[9px] text-[#8b949e] font-mono">Machine-Readable (.json)</div>
                  </div>
                </div>
                <Download className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
              </a>
            </div>
          </div>

          {/* Unresolved Issues & Recommended Fixes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                Unresolved Issues ({comparisonReport.unresolvedIssues.length})
              </h4>
              {comparisonReport.unresolvedIssues.length === 0 ? (
                <p className="text-[11px] text-[#3fb950]">
                  Zero unresolved metadata, resource, or source issues detected!
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {comparisonReport.unresolvedIssues.map((iss) => (
                    <div
                      key={iss.id}
                      className="p-2 rounded bg-[#0d1117] border border-[#30363d] space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-[#c9d1d9] text-[10px]">
                          {iss.category}
                        </span>
                        {renderStatusBadge(iss.severity)}
                      </div>
                      <p className="text-[11px] text-[#8b949e]">{iss.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                Recommended Fixes ({comparisonReport.recommendedFixes.length})
              </h4>
              {comparisonReport.recommendedFixes.length === 0 ? (
                <p className="text-[11px] text-[#3fb950]">No additional fixes required.</p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {comparisonReport.recommendedFixes.map((fix) => (
                    <div
                      key={fix.id}
                      className="p-2 rounded bg-[#0d1117] border border-[#30363d] space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white text-[11px]">{fix.title}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#21262d] text-[#e3b341]">
                          {fix.priority}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#8b949e]">{fix.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Missing vs Reconstructed Components Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                Missing Components ({comparisonReport.missingComponents.length})
              </h4>
              {comparisonReport.missingComponents.length === 0 ? (
                <p className="text-[11px] text-[#3fb950]">
                  All original manifest components, classes, and resources are present in the
                  reconstructed project.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                  {comparisonReport.missingComponents.map((mc, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-mono text-[11px] text-[#ff7b72]">{mc.identifier}</div>
                        <div className="text-[10px] text-[#8b949e]">
                          {mc.category} — {mc.impact}
                        </div>
                      </div>
                      {renderStatusBadge(mc.status)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                Verified Reconstructed Components ({comparisonReport.reconstructedComponents.length})
              </h4>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {comparisonReport.reconstructedComponents.slice(0, 40).map((rc, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] text-[#3fb950] truncate">
                        {rc.identifier}
                      </div>
                      <div className="text-[10px] text-[#8b949e]">
                        {rc.category} ({rc.sourceOrigin})
                      </div>
                    </div>
                    {renderStatusBadge(rc.status)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 1: METADATA COMPARISON ================= */}
      {subSection === 'metadata' && (
        <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                1. APK Metadata Comparison (14 Categories)
              </h4>
              <p className="text-[10px] text-[#8b949e]">
                Comparing <code>{comparisonReport.metadataComparison.originalSource}</code> vs{' '}
                <code>{comparisonReport.metadataComparison.reconstructedSource}</code>
              </p>
            </div>
            {renderStatusBadge(comparisonReport.metadataComparison.status)}
          </div>

          <div className="space-y-2">
            {comparisonReport.metadataComparison.fields.map((field) => (
              <div
                key={field.field}
                className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">{field.label}</span>
                  {renderStatusBadge(field.status)}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="p-2 rounded bg-[#161b22] border border-[#21262d]">
                    <div className="text-[#8b949e] mb-0.5">Original APK:</div>
                    <div className="text-[#c9d1d9] break-all">
                      {Array.isArray(field.originalValue)
                        ? field.originalValue.length > 0
                          ? field.originalValue.join(', ')
                          : 'None'
                        : field.originalValue}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#161b22] border border-[#21262d]">
                    <div className="text-[#8b949e] mb-0.5">Reconstructed Project:</div>
                    <div className="text-[#58a6ff] break-all">
                      {Array.isArray(field.reconstructedValue)
                        ? field.reconstructedValue.length > 0
                          ? field.reconstructedValue.join(', ')
                          : 'None'
                        : field.reconstructedValue}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-[#8b949e]">{field.notes}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 2: RESOURCE COMPARISON ================= */}
      {subSection === 'resources' && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                2. Resource Category Summary (11 Categories)
              </h4>
              {renderStatusBadge(comparisonReport.resourceComparison.status)}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-[#30363d] text-[#8b949e] font-mono text-[10px]">
                    <th className="py-1.5 px-2">Category</th>
                    <th className="py-1.5 px-2">Original</th>
                    <th className="py-1.5 px-2">Reconstructed</th>
                    <th className="py-1.5 px-2">Matched</th>
                    <th className="py-1.5 px-2">Missing</th>
                    <th className="py-1.5 px-2">Modified</th>
                    <th className="py-1.5 px-2">New</th>
                    <th className="py-1.5 px-2">Duplicates</th>
                    <th className="py-1.5 px-2">Naming Diff</th>
                    <th className="py-1.5 px-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d] font-mono">
                  {comparisonReport.resourceComparison.categories.map((cat) => (
                    <tr key={cat.category} className="hover:bg-[#0d1117]/60">
                      <td className="py-2 px-2 font-sans font-semibold text-white">{cat.label}</td>
                      <td className="py-2 px-2">{cat.originalCount}</td>
                      <td className="py-2 px-2">{cat.reconstructedCount}</td>
                      <td className="py-2 px-2 text-[#3fb950]">{cat.matchedCount}</td>
                      <td className="py-2 px-2 text-[#ff7b72]">{cat.missingCount}</td>
                      <td className="py-2 px-2 text-[#e3b341]">{cat.modifiedCount}</td>
                      <td className="py-2 px-2 text-[#58a6ff]">{cat.newlyGeneratedCount}</td>
                      <td className="py-2 px-2 text-[#d2a8ff]">{cat.duplicateCount}</td>
                      <td className="py-2 px-2 text-[#8b949e]">{cat.namingDiffCount}</td>
                      <td className="py-2 px-2">{renderStatusBadge(cat.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resource Differences List */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Detailed Resource Differences ({comparisonReport.resourceComparison.differences.length})
            </h4>
            {comparisonReport.resourceComparison.differences.length === 0 ? (
              <p className="text-[11px] text-[#3fb950]">
                All resources match identically between <code>decoded/res</code> and{' '}
                <code>android-studio-project/app/src/main/res</code>!
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                {comparisonReport.resourceComparison.differences.map((diff, i) => (
                  <div
                    key={i}
                    className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div>
                      <span className="font-mono font-bold text-white">{diff.resourceName}</span>{' '}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#21262d] text-[#58a6ff]">
                        {diff.category} • {diff.type}
                      </span>
                      <div className="text-[10px] text-[#8b949e] mt-0.5">{diff.details}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 3: SOURCE CODE COMPARISON ================= */}
      {subSection === 'source' && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                3. Source Code Structural &amp; Semantic Comparison
              </h4>
              {renderStatusBadge(comparisonReport.sourceCodeComparison.status)}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
              <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-sm font-bold text-[#3fb950]">
                  {comparisonReport.sourceCodeComparison.metrics.reconstructedAppClasses}/
                  {comparisonReport.sourceCodeComparison.metrics.originalAppClasses}
                </div>
                <div className="text-[10px] text-[#8b949e]">App Classes Recovered</div>
              </div>
              <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-sm font-bold text-[#58a6ff]">
                  {comparisonReport.sourceCodeComparison.metrics.matchedMethodSignaturesTotal}/
                  {comparisonReport.sourceCodeComparison.metrics.originalMethodsTotal}
                </div>
                <div className="text-[10px] text-[#8b949e]">Method Signatures</div>
              </div>
              <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-sm font-bold text-[#e3b341]">
                  {comparisonReport.sourceCodeComparison.metrics.matchedFieldsTotal}/
                  {comparisonReport.sourceCodeComparison.metrics.originalFieldsTotal}
                </div>
                <div className="text-[10px] text-[#8b949e]">Field Declarations</div>
              </div>
              <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="text-sm font-bold text-[#d2a8ff]">
                  {comparisonReport.sourceCodeComparison.metrics.compilerGeneratedIgnored} Ignored /{' '}
                  {comparisonReport.sourceCodeComparison.metrics.obfuscatedClassesMapped} Deobf
                </div>
                <div className="text-[10px] text-[#8b949e]">Synthetic &amp; Obfuscated</div>
              </div>
            </div>

            {/* Class-by-Class Table */}
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {comparisonReport.sourceCodeComparison.classComparisons.map((cls) => (
                <div
                  key={cls.className}
                  className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-white">{cls.className}</span>
                      {cls.reconstructedClassName &&
                        cls.reconstructedClassName !== cls.className && (
                          <span className="text-[#3fb950]">→ {cls.reconstructedClassName}</span>
                        )}
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#58a6ff]">
                        {cls.role} • {cls.reconstructedLanguage}
                      </span>
                    </div>
                    {renderStatusBadge(cls.status)}
                  </div>
                  <div className="text-[10px] text-[#8b949e]">{cls.notes}</div>
                  {cls.missingMethodSignatures.length > 0 && (
                    <div className="text-[10px] font-mono text-[#ff7b72]">
                      Missing Methods: {cls.missingMethodSignatures.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 4: FUNCTIONALITY ANALYSIS ================= */}
      {subSection === 'functionality' && (
        <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                4. Functional Capability Analysis (11 Domains)
              </h4>
              <p className="text-[10px] text-[#8b949e]">
                Explicitly distinguishes <code>verified_runtime</code> behavior from{' '}
                <code>inferred_from_source</code> static evidence.
              </p>
            </div>
            {renderStatusBadge(comparisonReport.functionalityAnalysis.status)}
          </div>

          <div className="space-y-2">
            {comparisonReport.functionalityAnalysis.capabilities.map((cap) => (
              <div
                key={cap.domain}
                className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{cap.label}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                        cap.verificationBasis === 'verified_runtime'
                          ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
                          : cap.verificationBasis === 'inferred_from_source'
                          ? 'bg-[#2f81f7]/20 text-[#58a6ff] border-[#58a6ff]/40'
                          : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
                      }`}
                    >
                      {cap.verificationBasis}
                    </span>
                  </div>
                  {renderStatusBadge(cap.status)}
                </div>
                <p className="text-[11px] text-[#c9d1d9]">{cap.notes}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 5 & 6: UI & AUTOMATED RUNTIME TESTING ================= */}
      {subSection === 'ui_runtime' && (
        <div className="space-y-3">
          {/* 5. UI Comparison */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                  5. UI Layout &amp; Screen Structure Comparison
                </h4>
                <p className="text-[10px] text-[#8b949e]">
                  {comparisonReport.uiComparison.emulatorDiagnostic}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[#8b949e]">Live Capture:</span>
                {renderStatusBadge(comparisonReport.uiComparison.liveScreenCaptureStatus)}
                <span className="text-[10px] font-mono text-[#8b949e]">Static XML:</span>
                {renderStatusBadge(comparisonReport.uiComparison.staticXmlComparisonStatus)}
              </div>
            </div>

            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {comparisonReport.uiComparison.screens.map((scr) => (
                <div
                  key={scr.layoutName}
                  className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs font-bold text-white">
                      {scr.layoutName}.xml{' '}
                      {scr.associatedComponent && (
                        <span className="text-[#58a6ff] font-normal">
                          (bound to {scr.associatedComponent})
                        </span>
                      )}
                    </div>
                    {renderStatusBadge(scr.status)}
                  </div>
                  <div className="text-[10px] font-mono text-[#8b949e]">
                    View Tags: {scr.reconstructedViewTags.length}/{scr.originalViewTags.length} •
                    View IDs: {scr.reconstructedViewIds.length}/{scr.originalViewIds.length} •
                    Strings: {scr.textReferencesMatched ? 'Match' : 'Diff'} • Icons:{' '}
                    {scr.iconReferencesMatched ? 'Match' : 'Diff'} • Colors:{' '}
                    {scr.colorReferencesMatched ? 'Match' : 'Diff'}
                  </div>
                  <div className="text-[10px] text-[#c9d1d9]">{scr.differences.join(' | ')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 6. Automated Runtime Testing */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                  6. Automated Runtime Testing &amp; Logcat Verification
                </h4>
                <p className="text-[10px] text-[#8b949e]">
                  {comparisonReport.automatedTesting.summary}
                </p>
              </div>
              {renderStatusBadge(comparisonReport.automatedTesting.status)}
            </div>

            <div className="space-y-1.5">
              {comparisonReport.automatedTesting.steps.map((st) => (
                <div
                  key={st.stepId}
                  className="p-2 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">{st.name}</div>
                    <div className="text-[10px] text-[#8b949e]">{st.details}</div>
                  </div>
                  {renderStatusBadge(st.status)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= SUBSECTION 9: AI-ASSISTED FINAL REPAIR ================= */}
      {subSection === 'final_repair' && (
        <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-[#d2a8ff]" />
                9. AI-Assisted Final Repair ({comparisonReport.aiFinalRepairProposals.length})
              </h4>
              <p className="text-[10px] text-[#8b949e]">
                Creates a snapshot backup in <code>.repair-backups/</code> before applying minimal
                patches to <code>android-studio-project/</code>. Never modifies{' '}
                <code>original.apk</code>, <code>decoded/</code>, or <code>java/</code>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-[#c9d1d9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={triggerRebuildOnApply}
                  onChange={(e) => setTriggerRebuildOnApply(e.target.checked)}
                  className="accent-[#238636]"
                />
                <span>Rebuild Project After Apply</span>
              </label>

              <button
                type="button"
                disabled={isApplyingRepairs || selectedProposalIds.size === 0}
                onClick={handleApplyFinalRepairs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {isApplyingRepairs
                    ? 'Applying & Rebuilding...'
                    : `Apply Approved Repairs (${selectedProposalIds.size})`}
                </span>
              </button>
            </div>
          </div>

          {comparisonReport.aiFinalRepairProposals.length === 0 ? (
            <div className="p-4 rounded bg-[#0d1117] border border-[#30363d] text-center space-y-2">
              <p className="text-xs text-[#c9d1d9]">
                No AI Final Repair proposals are currently needed or queued.
              </p>
              <button
                type="button"
                onClick={handleGenerateAiFinalRepairs}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#a371f7]/50 text-[#d2a8ff] text-xs font-semibold"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Scan Confirmed Differences with AI Final Repair</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {comparisonReport.aiFinalRepairProposals.map((prop: AiFinalRepairProposal) => {
                const isApplied = prop.status === 'applied';
                const isChecked = selectedProposalIds.has(prop.id);
                return (
                  <div
                    key={prop.id}
                    className="p-3 rounded bg-[#0d1117] border border-[#30363d] space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={isApplied}
                          checked={isChecked}
                          onChange={() => toggleProposal(prop.id)}
                          className="accent-[#238636]"
                        />
                        <span className="font-bold text-white text-xs">{prop.issueTitle}</span>
                        <code className="text-[10px] font-mono text-[#58a6ff]">
                          {prop.affectedFilePath}
                        </code>
                      </label>

                      <div className="flex items-center gap-1.5 font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950]">
                          Confidence: {prop.confidenceScore}% ({prop.confidenceLevel})
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded uppercase ${
                            isApplied
                              ? 'bg-[#238636] text-white'
                              : 'bg-[#21262d] text-[#8b949e]'
                          }`}
                        >
                          {prop.status}
                        </span>
                        {onOpenFile && (
                          <button
                            type="button"
                            onClick={() => {
                              const fullRel = `android-studio-project/${prop.affectedFilePath}`;
                              const name =
                                prop.affectedFilePath.split('/').pop() || prop.affectedFilePath;
                              onOpenFile(fullRel, name);
                              if (onCloseModal) onCloseModal();
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
                          >
                            <ExternalLink className="w-3 h-3 text-[#58a6ff]" />
                            <span>Open</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-[#c9d1d9]">
                      <strong>Root Cause:</strong> {prop.rootCause}
                    </div>
                    <div className="text-[11px] text-[#8b949e]">
                      <strong>Explanation:</strong> {prop.explanation}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[10px]">
                      <div className="p-2 rounded bg-[#f85149]/10 border border-[#f85149]/30 overflow-x-auto">
                        <div className="text-[#ff7b72] font-bold mb-1">- Current Reconstructed</div>
                        <pre className="text-[#c9d1d9] whitespace-pre-wrap">
                          {prop.originalSnippet}
                        </pre>
                      </div>
                      <div className="p-2 rounded bg-[#238636]/10 border border-[#3fb950]/30 overflow-x-auto">
                        <div className="text-[#3fb950] font-bold mb-1">+ Proposed Repair</div>
                        <pre className="text-[#c9d1d9] whitespace-pre-wrap">
                          {prop.replacementSnippet}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
