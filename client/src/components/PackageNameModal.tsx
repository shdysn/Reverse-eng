import React, { useState, useEffect } from 'react';
import {
  X,
  Package,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { RenamePackageResponse } from '../types/index.js';

interface PackageNameModalProps {
  isOpen: boolean;
  sessionId: string | null;
  onClose: () => void;
  onSuccess: (result: RenamePackageResponse) => void;
}

export const PackageNameModal: React.FC<PackageNameModalProps> = ({
  isOpen,
  sessionId,
  onClose,
  onSuccess,
}) => {
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [currentPkg, setCurrentPkg] = useState('');
  const [newPkg, setNewPkg] = useState('');
  const [newAppName, setNewAppName] = useState('');
  const [deepRefactorSmali, setDeepRefactorSmali] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenamePackageResponse | null>(null);

  useEffect(() => {
    if (isOpen && sessionId) {
      setError(null);
      setResult(null);
      setLoadingInfo(true);
      api
        .getPackageInfo(sessionId)
        .then((info) => {
          setCurrentPkg(info.packageName);
          setNewPkg(info.packageName);
          setNewAppName(info.appName || '');
        })
        .catch((err) => {
          setError((err as Error).message);
        })
        .finally(() => {
          setLoadingInfo(false);
        });
    }
  }, [isOpen, sessionId]);

  if (!isOpen) return null;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !newPkg.trim()) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await api.renamePackage(sessionId, {
        newPackageName: newPkg.trim(),
        newAppName: newAppName.trim() || undefined,
        deepRefactorSmali,
      });
      setResult(res);
      setCurrentPkg(res.newPackageName);
      onSuccess(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 bg-[#21262d] border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#2f81f7]/20 text-[#58a6ff] border border-[#2f81f7]/40">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Package Name Editor &amp; App Cloner
              </h3>
              <p className="text-[10px] text-[#8b949e]">
                Safely clone APK or change application ID across manifest &amp; resources
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#8b949e] hover:text-white p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleRename} className="p-4 space-y-4 text-xs">
          {loadingInfo ? (
            <div className="py-8 text-center text-[#8b949e] font-mono">
              Reading AndroidManifest.xml &amp; apktool.yml...
            </div>
          ) : (
            <>
              {/* Current Package */}
              <div className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-between">
                <span className="text-[#8b949e]">Current Package ID:</span>
                <span className="font-mono text-[#58a6ff] font-semibold truncate max-w-[230px]">
                  {currentPkg || 'Unknown'}
                </span>
              </div>

              {/* New Package Name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#c9d1d9] mb-1">
                  New Package Name (Application ID)
                </label>
                <input
                  type="text"
                  required
                  value={newPkg}
                  onChange={(e) => setNewPkg(e.target.value)}
                  placeholder="com.example.myclonedapp"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-white font-mono text-xs focus:outline-none focus:border-[#58a6ff]"
                />
                <p className="text-[10px] text-[#8b949e] mt-1">
                  Automatically expands relative activity names (e.g. <code>.MainActivity</code>) so original classes never crash.
                </p>
              </div>

              {/* Optional App Display Name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#c9d1d9] mb-1">
                  App Display Name (Optional)
                </label>
                <input
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="My Custom App Name"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-white text-xs focus:outline-none focus:border-[#58a6ff]"
                />
              </div>

              {/* Deep Smali Refactoring Toggle */}
              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#0d1117] border border-[#30363d] cursor-pointer hover:border-[#8b949e]/50">
                <input
                  type="checkbox"
                  checked={deepRefactorSmali}
                  onChange={(e) => setDeepRefactorSmali(e.target.checked)}
                  className="mt-0.5 rounded border-[#30363d] bg-[#161b22] text-[#2f81f7]"
                />
                <div className="flex-1">
                  <div className="font-semibold text-[#c9d1d9] flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-[#d29922]" />
                    <span>Deep Smali Bytecode Refactoring</span>
                  </div>
                  <p className="text-[10px] text-[#8b949e] mt-0.5 leading-relaxed">
                    Leave unchecked for safe App Cloning (recommended). Check only if you also want to replace package strings inside all <code>.smali</code> files.
                  </p>
                </div>
              </label>

              {/* Error Alert */}
              {error && (
                <div className="p-2.5 rounded bg-[#f85149]/10 border border-[#f85149]/40 text-[#ff7b72] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Success Result */}
              {result && (
                <div className="p-3 rounded bg-[#238636]/15 border border-[#238636]/50 text-[#3fb950] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Package Successfully Updated!</span>
                  </div>
                  <div className="text-[11px] text-[#c9d1d9] font-mono">
                    {result.oldPackageName} → <strong className="text-[#56d364]">{result.newPackageName}</strong>
                  </div>
                  <div className="text-[10px] text-[#8b949e] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
                    <span>Updated {result.updatedFilesCount} configuration/source files. Ready to Rebuild APK!</span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 border-t border-[#30363d] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] font-medium"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newPkg.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold shadow disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Applying...' : 'Apply Package Name'}</span>
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
