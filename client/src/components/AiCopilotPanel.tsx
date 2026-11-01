import React, { useState } from 'react';
import {
  Sparkles,
  ShieldAlert,
  Send,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Check,
  Zap,
  Code2,
  FileCode,
  Lock,
  Radio,
  FileSpreadsheet,
  HelpCircle,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { EditorTab } from '../types/index.js';
import { AiPatchAction, AiPatchResponse } from '@android-re/shared';

interface AiCopilotPanelProps {
  activeTab: EditorTab | null;
  onApplyChanges: (newContent: string) => void;
  onRevertChanges?: () => void;
  onTransform: (instruction: string, selectedSnippet?: string) => Promise<AiPatchResponse | null>;
  isProcessing: boolean;
  lastAiResult: AiPatchResponse | null;
  onClearAiResult: () => void;
}

export const AiCopilotPanel: React.FC<AiCopilotPanelProps> = ({
  activeTab,
  onApplyChanges,
  onTransform,
  isProcessing,
  lastAiResult,
  onClearAiResult,
}) => {
  const [prompt, setPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [hasApplied, setHasApplied] = useState(false);

  // Quick preset actions tailored for Android Reverse Engineering
  const presets = [
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
    {
      id: 'explain-logic',
      label: 'Explain Method Logic',
      icon: <HelpCircle className="w-3.5 h-3.5 text-[#bc8cff]" />,
      desc: 'Decompile bytecode logic into plain English explanations',
      prompt:
        'Explain the exact logic of the methods in this file in plain English. Detail what inputs they accept, what checks they perform, and what they return.',
    },
  ];

  const handleRunPreset = (presetPrompt: string, id: string) => {
    setSelectedPreset(id);
    setPrompt(presetPrompt);
    handleExecute(presetPrompt);
  };

  const handleExecute = async (overridePrompt?: string) => {
    const textToRun = (overridePrompt || prompt).trim();
    if (!textToRun || isProcessing || !activeTab) return;

    setHasApplied(false);
    await onTransform(textToRun);
  };

  const handleAccept = () => {
    if (lastAiResult) {
      onApplyChanges(lastAiResult.modifiedContent);
      setHasApplied(true);
    }
  };

  const handleReject = () => {
    if (lastAiResult) {
      onApplyChanges(lastAiResult.originalContent);
      onClearAiResult();
      setHasApplied(false);
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
      <div className="p-3 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-gradient-to-tr from-[#238636] to-[#2f81f7] text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
              AI Bytecode Copilot
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 font-mono normal-case">
                3.5 Flash Lite
              </span>
            </h3>
            <p className="text-[10px] text-[#8b949e]">Surgical, non-breaking modifications</p>
          </div>
        </div>

        {activeTab && (
          <div className="flex items-center gap-1 text-[11px] font-mono text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d] max-w-[140px] truncate" title={activeTab.path}>
            <FileCode className="w-3 h-3 text-[#58a6ff] shrink-0" />
            <span className="truncate">{activeTab.name}</span>
          </div>
        )}
      </div>

      {/* Content Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {!activeTab ? (
          <div className="p-6 text-center text-[#8b949e] border border-dashed border-[#30363d] rounded-lg bg-[#161b22]/50">
            <Code2 className="w-8 h-8 text-[#8b949e]/40 mx-auto mb-2" />
            <p className="text-xs font-medium text-white">No file selected in editor</p>
            <p className="text-[11px] text-[#8b949e] mt-1">
              Open a Smali class, AndroidManifest.xml, or Java file from the Explorer to begin AI surgical editing.
            </p>
          </div>
        ) : (
          <>
            {/* Quick Presets Section */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] block mb-2 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-[#e3b341]" />
                One-Click Quick Patches
              </label>

              <div className="grid grid-cols-1 gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleRunPreset(preset.prompt, preset.id)}
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
                <span>Custom Instruction</span>
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
                    Dependency-Safe Stubs
                  </span>

                  <button
                    type="button"
                    onClick={() => handleExecute()}
                    disabled={isProcessing || !prompt.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Surgically Patching...</span>
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

            {/* Live Progress Indicator */}
            {isProcessing && (
              <div className="p-3 bg-[#161b22] border border-[#58a6ff]/30 rounded-lg animate-pulse">
                <div className="flex items-center gap-2 text-xs text-[#58a6ff] font-medium mb-1">
                  <div className="w-2 h-2 rounded-full bg-[#58a6ff] animate-ping" />
                  Gemini 3.5 Flash Lite Analyzing Code & Dependencies...
                </div>
                <p className="text-[11px] text-[#8b949e]">
                  Scanning bytecode registers, branch labels, and method callers to guarantee no runtime crash.
                </p>
              </div>
            )}

            {/* AI Action & Audit Report (End Explanation) */}
            {lastAiResult && (
              <div className="border border-[#30363d] rounded-lg bg-[#161b22] overflow-hidden shadow-lg animate-in fade-in duration-300">
                {/* Audit Header */}
                <div className="p-2.5 border-b border-[#30363d] bg-[#21262d] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <CheckCircle2 className="w-4 h-4 text-[#3fb950]" />
                    <span>AI Action & Integrity Report</span>
                  </div>
                  {lastAiResult.integrityVerified && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3fb950]/20 text-[#56d364] border border-[#3fb950]/40 font-mono">
                      Verified Safe
                    </span>
                  )}
                </div>

                {/* Audit Body */}
                <div className="p-3 space-y-3 text-xs">
                  {/* Explanation Paragraph */}
                  <div>
                    <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
                      Summary of Changes:
                    </h4>
                    <p className="text-[#c9d1d9] leading-relaxed text-[11px] bg-[#0d1117] p-2 rounded border border-[#30363d]">
                      {lastAiResult.explanation}
                    </p>
                  </div>

                  {/* Surgical Actions Breakdown */}
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

                  {/* Safety Advice Note */}
                  {lastAiResult.safetyNote && (
                    <div className="p-2 rounded bg-[#58a6ff]/10 border border-[#58a6ff]/20 text-[11px] text-[#79c0ff]">
                      <strong>Advice:</strong> {lastAiResult.safetyNote}
                    </div>
                  )}

                  {/* Accept / Reject Action Buttons */}
                  <div className="pt-2 border-t border-[#30363d] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={hasApplied}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-colors ${
                        hasApplied
                          ? 'bg-[#238636]/40 text-[#3fb950] border border-[#238636]/60 cursor-default'
                          : 'bg-[#238636] hover:bg-[#2ea043] text-white shadow'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      {hasApplied ? 'Changes Accepted & Applied' : 'Accept & Apply Changes'}
                    </button>

                    <button
                      type="button"
                      onClick={handleReject}
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
      </div>
    </div>
  );
};
