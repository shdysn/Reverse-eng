import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Info,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Lock,
  Unlock,
  Radio,
  FileSpreadsheet,
} from 'lucide-react';
import type {
  ManifestScanData,
  FindingSeverity,
  SecurityFinding,
  ComponentFinding,
} from '../types/index.js';

interface ManifestScannerProps {
  scanData: ManifestScanData | null;
  isLoading: boolean;
  onRescan: () => void;
}

export const ManifestScanner: React.FC<ManifestScannerProps> = ({
  scanData,
  isLoading,
  onRescan,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getSeverityBadge = (severity: FindingSeverity) => {
    switch (severity) {
      case 'critical':
        return <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#f85149]/20 text-[#f85149] border border-[#f85149]/40">Critical</span>;
      case 'high':
        return <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#f85149]/20 text-[#f85149] border border-[#f85149]/40">High</span>;
      case 'medium':
        return <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40">Medium</span>;
      case 'low':
        return <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#2f81f7]/20 text-[#58a6ff] border border-[#2f81f7]/40">Low</span>;
      case 'informational':
      default:
        return <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">Info</span>;
    }
  };

  if (!scanData) {
    return (
      <div className="flex flex-col h-full bg-[#0d1117] border-l border-[#30363d] p-4 text-center justify-center select-none text-xs text-[#8b949e]">
        <ShieldCheck className="w-8 h-8 text-[#8b949e]/40 mx-auto mb-2" />
        <p>No manifest scan data available.</p>
        <p className="mt-1 text-[11px] text-[#8b949e]/60">
          Upload an APK with AndroidManifest.xml to view security findings.
        </p>
      </div>
    );
  }

  const { summary, dangerousPermissions, exportedComponents, applicationFlags, generalFindings, warnings } = scanData;
  const totalFindings =
    summary.critical + summary.high + summary.medium + summary.low + summary.informational;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-l border-[#30363d] overflow-hidden select-none">
      {/* Header */}
      <div className="p-3 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[#2f81f7]" />
          <span className="text-xs uppercase tracking-wider font-bold text-[#c9d1d9]">
            Manifest Security
          </span>
        </div>
        <button
          type="button"
          onClick={onRescan}
          disabled={isLoading}
          className="p-1 rounded text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
          title="Rescan Manifest"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#d29922]' : ''}`} />
        </button>
      </div>

      {/* Summary Scorecard */}
      <div className="p-3 border-b border-[#30363d] bg-[#010409]">
        <div className="flex items-center justify-between text-xs font-mono text-[#8b949e] mb-2">
          <span>Total Findings: {totalFindings}</span>
          <span className="text-[10px]">
            {new Date(scanData.scannedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1 text-center font-mono text-xs">
          <div className="bg-[#161b22] p-1.5 rounded border border-[#30363d]">
            <div className="text-[#f85149] font-bold">{summary.critical}</div>
            <div className="text-[9px] uppercase text-[#8b949e]">Crit</div>
          </div>
          <div className="bg-[#161b22] p-1.5 rounded border border-[#30363d]">
            <div className="text-[#f85149] font-bold">{summary.high}</div>
            <div className="text-[9px] uppercase text-[#8b949e]">High</div>
          </div>
          <div className="bg-[#161b22] p-1.5 rounded border border-[#30363d]">
            <div className="text-[#d29922] font-bold">{summary.medium}</div>
            <div className="text-[9px] uppercase text-[#8b949e]">Med</div>
          </div>
          <div className="bg-[#161b22] p-1.5 rounded border border-[#30363d]">
            <div className="text-[#58a6ff] font-bold">{summary.low}</div>
            <div className="text-[9px] uppercase text-[#8b949e]">Low</div>
          </div>
          <div className="bg-[#161b22] p-1.5 rounded border border-[#30363d]">
            <div className="text-[#3fb950] font-bold">{summary.informational}</div>
            <div className="text-[9px] uppercase text-[#8b949e]">Info</div>
          </div>
        </div>
      </div>

      {/* Findings Content List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs font-mono">
        {/* Notice */}
        <div className="text-[10px] text-[#8b949e] bg-[#161b22] p-2 rounded border border-[#30363d]/60 leading-relaxed">
          Static findings require manual verification and do not automatically prove exploitability.
        </div>

        {/* Application Flags Section */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-[#8b949e] font-bold mb-2">
            Application Flags
          </h4>
          <div className="space-y-1.5 bg-[#161b22] p-2 rounded border border-[#30363d]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8b949e]">debuggable</span>
              <span className={applicationFlags.debuggable ? 'text-[#f85149] font-bold' : 'text-[#3fb950]'}>
                {String(Boolean(applicationFlags.debuggable))}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8b949e]">allowBackup</span>
              <span className={applicationFlags.allowBackup ? 'text-[#d29922]' : 'text-[#3fb950]'}>
                {String(Boolean(applicationFlags.allowBackup))}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8b949e]">usesCleartextTraffic</span>
              <span className={applicationFlags.usesCleartextTraffic ? 'text-[#f85149]' : 'text-[#3fb950]'}>
                {String(Boolean(applicationFlags.usesCleartextTraffic))}
              </span>
            </div>
            {applicationFlags.sharedUserId && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#8b949e]">sharedUserId</span>
                <span className="text-[#d29922] truncate max-w-[150px]">
                  {String(applicationFlags.sharedUserId)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* General Flags & Warnings */}
        {generalFindings.length > 0 && (
          <div>
            <h4 className="text-[11px] uppercase tracking-wider text-[#8b949e] font-bold mb-2">
              Security Flags &amp; Config ({generalFindings.length})
            </h4>
            <div className="space-y-2">
              {generalFindings.map((finding) => (
                <div
                  key={finding.id}
                  onClick={() => toggleExpand(finding.id)}
                  className="bg-[#161b22] border border-[#30363d] rounded p-2 cursor-pointer hover:border-[#8b949e]/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="font-semibold text-[#c9d1d9] text-[11px] leading-tight">
                      {finding.title}
                    </span>
                    {getSeverityBadge(finding.severity)}
                  </div>
                  <p className="text-[11px] text-[#8b949e] line-clamp-2">
                    {finding.description}
                  </p>
                  {expandedId === finding.id && (
                    <div className="mt-2 pt-2 border-t border-[#30363d] text-[11px] space-y-1">
                      <div className="text-[#8b949e]">
                        Evidence: <code className="text-[#c9d1d9]">{finding.evidence}</code>
                      </div>
                      <div className="text-[#3fb950]">
                        Recommendation: {finding.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dangerous Permissions Section */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-[#8b949e] font-bold mb-2">
            Dangerous Permissions ({dangerousPermissions.length})
          </h4>
          {dangerousPermissions.length === 0 ? (
            <div className="text-[11px] text-[#3fb950] bg-[#161b22] p-2 rounded border border-[#30363d]">
              No standard dangerous permissions requested.
            </div>
          ) : (
            <div className="space-y-1.5">
              {dangerousPermissions.map((perm) => (
                <div
                  key={perm.id}
                  onClick={() => toggleExpand(perm.id)}
                  className="bg-[#161b22] border border-[#30363d] rounded p-2 cursor-pointer hover:border-[#8b949e]/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#c9d1d9] truncate text-[11px]">
                      {perm.title}
                    </span>
                    {getSeverityBadge(perm.severity)}
                  </div>
                  {expandedId === perm.id && (
                    <div className="mt-2 pt-2 border-t border-[#30363d] text-[11px] space-y-1">
                      <div className="text-[#8b949e]">{perm.description}</div>
                      <div className="text-[#3fb950]">{perm.recommendation}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Exported Components Section */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-[#8b949e] font-bold mb-2">
            Exported Components ({exportedComponents.length})
          </h4>
          {exportedComponents.length === 0 ? (
            <div className="text-[11px] text-[#8b949e] bg-[#161b22] p-2 rounded border border-[#30363d]">
              No exported components found.
            </div>
          ) : (
            <div className="space-y-2">
              {exportedComponents.map((comp, idx) => {
                const compKey = `${comp.type}_${comp.name}_${idx}`;
                const isExp = expandedId === compKey;

                return (
                  <div
                    key={compKey}
                    onClick={() => toggleExpand(compKey)}
                    className="bg-[#161b22] border border-[#30363d] rounded p-2 cursor-pointer hover:border-[#8b949e]/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="text-[10px] uppercase text-[#8b949e] font-mono">
                        {comp.type}
                      </span>
                      {getSeverityBadge(comp.severity)}
                    </div>
                    <div className="font-semibold text-[#c9d1d9] text-[11px] truncate mb-1" title={comp.name}>
                      {comp.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[#8b949e]">
                      {comp.permission ? (
                        <span className="flex items-center gap-1 text-[#3fb950]">
                          <Lock className="w-2.5 h-2.5" /> Protected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[#f85149]">
                          <Unlock className="w-2.5 h-2.5" /> Unprotected
                        </span>
                      )}
                      {comp.hasIntentFilter && <span>• Intent Filter</span>}
                    </div>

                    {isExp && (
                      <div className="mt-2 pt-2 border-t border-[#30363d] text-[11px] space-y-1">
                        <div className="text-[#8b949e]">{comp.explanation}</div>
                        {comp.permission && (
                          <div className="text-[#58a6ff]">
                            Permission: <code className="text-[#c9d1d9]">{comp.permission}</code>
                          </div>
                        )}
                        <div className="text-[#3fb950]">{comp.recommendation}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
