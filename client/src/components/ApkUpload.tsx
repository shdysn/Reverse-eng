import React, { useRef, useState } from 'react';
import {
  Upload,
  FileCheck,
  AlertCircle,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useApkUpload } from '../hooks/useApkUpload.js';
import type { ProcessingStage } from '../types/index.js';

interface ApkUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (sessionId: string, filename: string, partialJadx?: boolean) => void;
}

export const ApkUpload: React.FC<ApkUploadProps> = ({ isOpen, onClose, onSuccess }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const {
    selectedFile,
    selectFile,
    stage,
    progress,
    currentChunk,
    totalChunks,
    errorMessage,
    formatFileSize,
    startUpload,
    cancelUpload,
    reset,
    isUploading,
  } = useApkUpload((sessionId, filename, partialJadx) => {
    onSuccess(sessionId, filename, partialJadx);
    onClose();
  });

  if (!isOpen) return null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isUploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const stageDescriptions: Record<ProcessingStage, { label: string; detail: string }> = {
    idle: { label: 'Ready to Upload', detail: 'Select an APK package to begin' },
    preparing: { label: 'Preparing Session', detail: 'Allocating sandbox workspace' },
    uploading: {
      label: 'Uploading Chunks',
      detail: totalChunks > 0 ? `Transferring chunk ${currentChunk} of ${totalChunks} (8 MiB chunks)` : 'Uploading...',
    },
    joining: { label: 'Joining Chunks', detail: 'Assembling streamed byte chunks into input.apk' },
    validating: { label: 'Validating APK', detail: 'Verifying ZIP magic bytes & checking for zip slip vulnerabilities' },
    apktool: { label: 'Running apktool', detail: 'Disassembling resources & decoding Dalvik bytecode to Smali' },
    jadx: { label: 'Running JADX', detail: 'Decompiling bytecode to Java source files' },
    manifest: { label: 'Scanning Manifest', detail: 'Auditing exported components and security permissions' },
    ready: { label: 'Decompilation Ready', detail: 'Workspace initialized' },
    failed: { label: 'Processing Failed', detail: 'Check error details below' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#2f81f7]/15 text-[#2f81f7]">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#c9d1d9]">Upload Android APK</h3>
              <p className="text-[11px] text-[#8b949e]">
                Authorized reverse engineering and security testing only
              </p>
            </div>
          </div>
          {!isUploading && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Dropzone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => {
              if (!isUploading) fileInputRef.current?.click();
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              isDragOver
                ? 'border-[#2f81f7] bg-[#2f81f7]/10'
                : selectedFile
                ? 'border-[#238636]/60 bg-[#238636]/5'
                : 'border-[#30363d] bg-[#0d1117]/60 hover:border-[#8b949e]/50 hover:bg-[#21262d]/20'
            } ${isUploading ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".apk"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  selectFile(e.target.files[0]);
                }
              }}
              disabled={isUploading}
            />

            {selectedFile ? (
              <div className="space-y-2">
                <FileCheck className="w-10 h-10 text-[#3fb950] mx-auto" />
                <div className="font-mono text-sm text-[#c9d1d9] font-medium truncate max-w-sm mx-auto">
                  {selectedFile.name}
                </div>
                <div className="text-xs text-[#8b949e]">
                  {formatFileSize(selectedFile.size)}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-10 h-10 text-[#8b949e] mx-auto" />
                <p className="text-xs text-[#c9d1d9] font-medium">
                  Drag and drop an .apk file here, or click to browse
                </p>
                <p className="text-[11px] text-[#8b949e]">
                  Chunked upload with 8 MiB parts. Max 1 GiB.
                </p>
              </div>
            )}
          </div>

          {/* Progress and Pipeline Stages */}
          {isUploading && (
            <div className="space-y-3 bg-[#0d1117] p-3.5 rounded-lg border border-[#30363d]">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#58a6ff] flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {stageDescriptions[stage].label}
                </span>
                <span className="text-[#8b949e]">{progress}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#21262d] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#2f81f7] h-2 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="text-[11px] text-[#8b949e] font-mono">
                {stageDescriptions[stage].detail}
              </p>
            </div>
          )}

          {/* Error notice */}
          {errorMessage && (
            <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/40 rounded-lg flex items-start gap-2.5 text-xs text-[#f85149]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold">Error</div>
                <div className="mt-0.5 leading-relaxed">{errorMessage}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#30363d] bg-[#161b22] flex items-center justify-between">
          <div>
            {isUploading && (
              <button
                type="button"
                onClick={cancelUpload}
                className="px-3 py-1.5 text-xs text-[#f85149] hover:bg-[#f85149]/10 rounded border border-[#f85149]/30 transition-colors"
              >
                Cancel Upload
              </button>
            )}
            {!isUploading && selectedFile && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-[#8b949e] hover:text-[#c9d1d9]"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isUploading && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] rounded border border-[#30363d] transition-colors"
              >
                Close
              </button>
            )}

            <button
              type="button"
              onClick={startUpload}
              disabled={!selectedFile || isUploading}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded transition-all shadow-sm ${
                selectedFile && !isUploading
                  ? 'bg-[#238636] hover:bg-[#2ea043] text-white active:scale-95'
                  : 'bg-[#21262d] text-[#8b949e] border border-[#30363d] cursor-not-allowed'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>Start Decompilation</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
