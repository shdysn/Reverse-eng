import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Layers,
  FolderArchive,
  HardDrive,
  RefreshCw,
  Search,
  Upload,
  Download,
  Copy,
  Trash2,
  Edit2,
  Check,
  AlertTriangle,
  CheckCircle,
  Clock,
  GitCommit,
  GitBranch,
  ArrowRight,
  Archive,
  ArchiveRestore,
  Play,
  FileCode,
  ShieldCheck,
  AlertCircle,
  Plus,
  FileSpreadsheet,
} from 'lucide-react';
import { api } from '../services/api.js';
import type {
  RecoverySessionListItem,
  StorageEnvironmentInfo,
  SessionVersionSnapshot,
  VersionDiffResult,
  RecoveryWorkflowStage,
} from '../types/index.js';

interface SessionManagerModalProps {
  isOpen: boolean;
  currentSessionId: string | null;
  onClose: () => void;
  onSwitchSession: (sessionId: string, filename: string) => void;
  onOpenUpload: () => void;
  onAddNotification: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const SessionManagerModal: React.FC<SessionManagerModalProps> = ({
  isOpen,
  currentSessionId,
  onClose,
  onSwitchSession,
  onOpenUpload,
  onAddNotification,
}) => {
  const [activeTab, setActiveTab] = useState<'sessions' | 'snapshots' | 'storage'>('sessions');
  const [sessions, setSessions] = useState<RecoverySessionListItem[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageEnvironmentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Rename state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');

  // Delete confirmation
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Snapshots state
  const [snapshots, setSnapshots] = useState<SessionVersionSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [createSnapshotModalOpen, setCreateSnapshotModalOpen] = useState(false);
  const [newSnapshotTag, setNewSnapshotTag] = useState('checkpoint');
  const [newSnapshotLabel, setNewSnapshotLabel] = useState('');
  const [newSnapshotDesc, setNewSnapshotDesc] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);

  // Snapshot diff state
  const [diffResult, setDiffResult] = useState<VersionDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Bundle import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const loadSessionsData = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsRes, storageRes] = await Promise.all([
        api.listSessions({
          search: searchQuery.trim() || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          includeArchived,
        }),
        api.getStorageInfo().catch(() => null),
      ]);
      setSessions(sessionsRes.sessions);
      if (storageRes) setStorageInfo(storageRes);
    } catch (err) {
      onAddNotification('error', 'Failed to Load Sessions', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, includeArchived, onAddNotification]);

  const loadSnapshotsData = useCallback(async (sId: string) => {
    try {
      setSnapshotsLoading(true);
      const list = await api.listSnapshots(sId);
      setSnapshots(list);
    } catch (err) {
      onAddNotification('error', 'Failed to Load Snapshots', (err as Error).message);
    } finally {
      setSnapshotsLoading(false);
    }
  }, [onAddNotification]);

  useEffect(() => {
    if (isOpen) {
      loadSessionsData();
      if (currentSessionId) {
        loadSnapshotsData(currentSessionId);
      }
    }
  }, [isOpen, loadSessionsData, loadSnapshotsData, currentSessionId]);

  if (!isOpen) return null;

  const handleResumeSession = async (session: RecoverySessionListItem) => {
    try {
      await api.resumeSession(session.id);
      onSwitchSession(session.id, session.originalFilename);
      onAddNotification('success', 'Session Resumed', `Active session switched to ${session.displayName}`);
      onClose();
    } catch (err) {
      onAddNotification('error', 'Resume Failed', (err as Error).message);
    }
  };

  const handleRenameSubmit = async (sessionId: string) => {
    if (!renameInput.trim()) return;
    try {
      await api.renameSession(sessionId, renameInput.trim());
      setEditingSessionId(null);
      await loadSessionsData();
      onAddNotification('success', 'Session Renamed', `Updated to "${renameInput.trim()}"`);
    } catch (err) {
      onAddNotification('error', 'Rename Failed', (err as Error).message);
    }
  };

  const handleArchiveToggle = async (sessionId: string, currentArchived: boolean) => {
    try {
      await api.archiveSession(sessionId, !currentArchived);
      await loadSessionsData();
      onAddNotification(
        'info',
        currentArchived ? 'Session Unarchived' : 'Session Archived',
        `Recovery session ${sessionId.slice(0, 8)} status updated.`
      );
    } catch (err) {
      onAddNotification('error', 'Archive Failed', (err as Error).message);
    }
  };

  const handleDuplicate = async (session: RecoverySessionListItem) => {
    try {
      const duplicated = await api.duplicateSession(session.id);
      await loadSessionsData();
      onAddNotification(
        'success',
        'Session Duplicated',
        `Created cloned session: ${duplicated.displayName || duplicated.id}`
      );
    } catch (err) {
      onAddNotification('error', 'Duplicate Failed', (err as Error).message);
    }
  };

  const handleDeleteConfirm = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      setDeletingSessionId(null);
      await loadSessionsData();
      onAddNotification('info', 'Session Deleted', `Removed session ${sessionId.slice(0, 8)}`);
      if (currentSessionId === sessionId) {
        window.location.reload();
      }
    } catch (err) {
      onAddNotification('error', 'Delete Failed', (err as Error).message);
    }
  };

  const handleCreateSnapshotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSessionId || !newSnapshotLabel.trim()) return;
    try {
      setCreatingSnapshot(true);
      await api.createSnapshot(currentSessionId, {
        tag: newSnapshotTag.trim() || 'checkpoint',
        label: newSnapshotLabel.trim(),
        description: newSnapshotDesc.trim() || undefined,
      });
      setCreateSnapshotModalOpen(false);
      setNewSnapshotLabel('');
      setNewSnapshotDesc('');
      await loadSnapshotsData(currentSessionId);
      await loadSessionsData();
      onAddNotification('success', 'Snapshot Created', 'Project checkpoint saved successfully.');
    } catch (err) {
      onAddNotification('error', 'Snapshot Failed', (err as Error).message);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (snapshot: SessionVersionSnapshot) => {
    if (!currentSessionId) return;
    if (
      !window.confirm(
        `Restore snapshot "${snapshot.label}"?\n\nYour current project state will be automatically backed up before rollback.`
      )
    ) {
      return;
    }
    try {
      const result = await api.restoreSnapshot(currentSessionId, snapshot.id);
      await loadSnapshotsData(currentSessionId);
      onAddNotification(
        'success',
        'Snapshot Restored',
        `Project rolled back to "${snapshot.label}". Safety backup: ${result.backupSnapshotId}`
      );
      // reload workspace
      onSwitchSession(currentSessionId, snapshot.label);
      onClose();
    } catch (err) {
      onAddNotification('error', 'Restore Failed', (err as Error).message);
    }
  };

  const handleViewDiff = async (snapshotId: string) => {
    if (!currentSessionId) return;
    try {
      setDiffLoading(true);
      const diff = await api.getSnapshotDiff(currentSessionId, snapshotId);
      setDiffResult(diff);
    } catch (err) {
      onAddNotification('error', 'Diff Failed', (err as Error).message);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleImportBundleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsImporting(true);
      onAddNotification('info', 'Importing Session', `Unpacking and verifying ${file.name}...`);
      const res = await api.importSessionBundle(file);
      await loadSessionsData();
      onAddNotification(
        'success',
        'Session Imported Successfully',
        `Restored ${res.displayName} (${res.totalFilesRestored} files)`
      );
      onSwitchSession(res.sessionId, res.originalFilename);
      onClose();
    } catch (err) {
      onAddNotification('error', 'Import Failed', (err as Error).message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getWorkflowBadge = (stage: RecoveryWorkflowStage, interrupted?: boolean) => {
    if (interrupted) {
      return {
        label: 'Interrupted',
        bg: 'bg-[#d29922]/20 text-[#d29922] border-[#d29922]/40',
      };
    }
    switch (stage) {
      case 'compared':
        return { label: 'Compared & Verified', bg: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/50' };
      case 'gradle_built':
        return { label: 'Gradle Built', bg: 'bg-[#2f81f7]/20 text-[#58a6ff] border-[#2f81f7]/50' };
      case 'reconstructed':
        return { label: 'AS Project Reconstructed', bg: 'bg-[#a371f7]/20 text-[#d2a8ff] border-[#a371f7]/50' };
      case 'ai_analyzed':
        return { label: 'AI Analyzed & Deobfuscated', bg: 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/50' };
      case 'decompiled':
        return { label: 'Decompiled', bg: 'bg-[#21262d] text-[#c9d1d9] border-[#30363d]' };
      case 'uploaded':
        return { label: 'Uploaded', bg: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' };
      default:
        return { label: stage, bg: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[88vh] bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#c9d1d9] font-sans">
        {/* Header */}
        <header className="px-5 py-3.5 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#2f81f7]/15 border border-[#2f81f7]/30 flex items-center justify-center text-[#58a6ff]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-wide text-white">
                  Persistent Recovery Sessions &amp; State Management
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Phase 6 Ready
                </span>
              </div>
              <p className="text-[11px] text-[#8b949e]">
                Resumable project sessions, point-in-time version snapshots, and complete portable ZIP backups.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Environment Storage Notice Banner */}
        {storageInfo && (
          <div className="px-5 py-2 bg-[#21262d]/50 border-b border-[#30363d] flex items-center justify-between text-xs text-[#8b949e]">
            <div className="flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>
                <strong className="text-[#c9d1d9]">Workspace Storage:</strong> {storageInfo.storagePath} (
                {(storageInfo.totalDiskUsageBytes / 1024 / 1024).toFixed(1)} MB across {storageInfo.totalSessions} sessions)
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[#3fb950] flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Persistent
              </span>
              {storageInfo.isCodespace && (
                <span className="text-[#d29922] hidden sm:inline" title={storageInfo.warningMessage}>
                  Codespace Verified
                </span>
              )}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="h-11 bg-[#0d1117] border-b border-[#30363d] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('sessions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'sessions'
                  ? 'bg-[#21262d] text-white border border-[#30363d] shadow-xs'
                  : 'text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              <FolderArchive className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>All Sessions</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-[#30363d] text-[#c9d1d9]">
                {sessions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('snapshots');
                if (currentSessionId) loadSnapshotsData(currentSessionId);
              }}
              disabled={!currentSessionId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'snapshots'
                  ? 'bg-[#21262d] text-white border border-[#30363d] shadow-xs'
                  : currentSessionId
                  ? 'text-[#8b949e] hover:text-[#c9d1d9]'
                  : 'text-[#8b949e]/40 cursor-not-allowed'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-[#a371f7]" />
              <span>Version Snapshots</span>
              {currentSessionId && snapshots.length > 0 && (
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-[#30363d] text-[#c9d1d9]">
                  {snapshots.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('storage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'storage'
                  ? 'bg-[#21262d] text-white border border-[#30363d] shadow-xs'
                  : 'text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-[#3fb950]" />
              <span>Storage &amp; Backup</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSessionsData}
              disabled={loading}
              className="p-1.5 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] rounded transition-colors"
              title="Refresh sessions list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Hidden Input for Bundle Import */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportBundleFile}
              accept=".zip"
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] rounded transition-colors"
              title="Import previously exported session bundle (.zip)"
            >
              <Upload className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>{isImporting ? 'Importing...' : 'Import Bundle (.zip)'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenUpload();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#238636] hover:bg-[#2ea043] text-white rounded font-medium transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload New APK</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Sessions List */}
        {activeTab === 'sessions' && (
          <div className="flex-1 flex flex-col overflow-hidden p-5">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4 shrink-0">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8b949e]" />
                <input
                  type="text"
                  placeholder="Search by session name, package ID, APK filename, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#c9d1d9] placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#c9d1d9] focus:outline-hidden focus:border-[#58a6ff]"
                >
                  <option value="all">All Stages</option>
                  <option value="uploaded">Uploaded</option>
                  <option value="decompiled">Decompiled</option>
                  <option value="ai_analyzed">AI Analyzed</option>
                  <option value="reconstructed">Reconstructed</option>
                  <option value="gradle_built">Gradle Built</option>
                  <option value="compared">Compared &amp; Verified</option>
                  <option value="interrupted">Interrupted</option>
                </select>

                <label className="flex items-center gap-1.5 text-xs text-[#8b949e] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(e) => setIncludeArchived(e.target.checked)}
                    className="rounded bg-[#0d1117] border-[#30363d] text-[#2f81f7] focus:ring-0"
                  />
                  <span>Show Archived</span>
                </label>
              </div>
            </div>

            {/* Sessions Cards Container */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {loading && sessions.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-xs text-[#8b949e]">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading recovery sessions...
                </div>
              ) : sessions.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#30363d] rounded-lg">
                  <FolderArchive className="w-8 h-8 text-[#8b949e] mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-[#c9d1d9]">No Recovery Sessions Found</p>
                  <p className="text-xs text-[#8b949e] mt-1 max-w-sm">
                    {searchQuery || statusFilter !== 'all'
                      ? 'No sessions match your search filter.'
                      : 'Upload an APK or import an existing recovery bundle (.zip) to begin.'}
                  </p>
                </div>
              ) : (
                sessions.map((sess) => {
                  const isCurrent = sess.id === currentSessionId;
                  const badge = getWorkflowBadge(sess.workflowStage, sess.isInterrupted);
                  const isEditing = editingSessionId === sess.id;

                  return (
                    <div
                      key={sess.id}
                      className={`p-4 rounded-lg border transition-all ${
                        isCurrent
                          ? 'bg-[#1f2937]/40 border-[#388bfd]/60 shadow-md'
                          : sess.isArchived
                          ? 'bg-[#161b22]/40 border-[#30363d]/40 opacity-75'
                          : 'bg-[#0d1117] border-[#30363d] hover:border-[#388bfd]/40'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        {/* Title and ID */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                className="px-2 py-0.5 bg-[#161b22] border border-[#58a6ff] rounded text-xs text-white"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleRenameSubmit(sess.id)}
                                className="p-1 text-[#3fb950] hover:bg-[#21262d] rounded"
                                title="Save name"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSessionId(null)}
                                className="p-1 text-[#8b949e] hover:bg-[#21262d] rounded"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-[#c9d1d9]">
                                {sess.displayName}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSessionId(sess.id);
                                  setRenameInput(sess.displayName);
                                }}
                                className="text-[#8b949e] hover:text-[#58a6ff] p-0.5 rounded transition-colors"
                                title="Rename session"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {isCurrent && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 uppercase">
                              Active Workspace
                            </span>
                          )}

                          {sess.isArchived && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#30363d] text-[#8b949e]">
                              Archived
                            </span>
                          )}
                        </div>

                        {/* Workflow Badge */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[11px] font-mono font-medium px-2 py-0.5 rounded-full border ${badge.bg}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      </div>

                      {/* Metadata Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-[#8b949e] mb-3 font-mono">
                        <div>
                          <span className="text-[#6e7681]">APK:</span>{' '}
                          <span className="text-[#c9d1d9] truncate inline-block max-w-[120px] align-bottom">
                            {sess.originalFilename}
                          </span>{' '}
                          ({(sess.fileSize / 1024 / 1024).toFixed(1)} MB)
                        </div>
                        <div>
                          <span className="text-[#6e7681]">Package:</span>{' '}
                          <span className="text-[#c9d1d9]">{sess.packageName || 'Unknown'}</span>
                        </div>
                        <div>
                          <span className="text-[#6e7681]">Disk:</span>{' '}
                          <span className="text-[#c9d1d9]">
                            {(sess.totalDiskSizeBytes / 1024 / 1024).toFixed(1)} MB ({sess.fileCount} files)
                          </span>
                        </div>
                        <div>
                          <span className="text-[#6e7681]">Updated:</span>{' '}
                          <span className="text-[#c9d1d9]">
                            {new Date(sess.lastAccessedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-[11px] font-mono text-[#8b949e] mb-1">
                          <span>Workflow Completion</span>
                          <span className="text-[#58a6ff] font-semibold">{sess.progressPercent}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              sess.isInterrupted
                                ? 'bg-[#d29922]'
                                : sess.progressPercent === 100
                                ? 'bg-[#2ea043]'
                                : 'bg-[#2f81f7]'
                            }`}
                            style={{ width: `${sess.progressPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Interrupted Warning Banner */}
                      {sess.isInterrupted && (
                        <div className="mb-3 p-2 rounded bg-[#d29922]/10 border border-[#d29922]/30 flex items-center justify-between text-xs text-[#d29922]">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>
                              Session had an operation interrupted during environment restart. All generated files are safe.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleResumeSession(sess)}
                            className="px-2 py-0.5 rounded bg-[#d29922]/20 hover:bg-[#d29922]/30 text-white font-medium text-[11px]"
                          >
                            Resume Now
                          </button>
                        </div>
                      )}

                      {/* Action Buttons Row */}
                      <div className="flex items-center justify-between pt-2 border-t border-[#30363d]/60">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {!isCurrent ? (
                            <button
                              type="button"
                              onClick={() => handleResumeSession(sess)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[#2f81f7] hover:bg-[#388bfd] text-white rounded font-medium transition-colors"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Resume / Switch</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('snapshots');
                                loadSnapshotsData(sess.id);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded border border-[#30363d] transition-colors"
                            >
                              <GitCommit className="w-3 h-3 text-[#a371f7]" />
                              <span>Snapshots ({sess.versionsCount})</span>
                            </button>
                          )}

                          <a
                            href={api.getSessionExportBundleUrl(sess.id)}
                            download={`${sess.displayName}-recovery-bundle.zip`}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] rounded border border-[#30363d] transition-colors"
                            title="Download full project & artifacts as portable ZIP"
                          >
                            <Download className="w-3 h-3" />
                            <span className="hidden sm:inline">Export Bundle</span>
                          </a>

                          <button
                            type="button"
                            onClick={() => handleDuplicate(sess)}
                            className="p-1 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] rounded transition-colors"
                            title="Duplicate session"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleArchiveToggle(sess.id, sess.isArchived)}
                            className="p-1 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] rounded transition-colors"
                            title={sess.isArchived ? 'Unarchive session' : 'Archive session'}
                          >
                            {sess.isArchived ? (
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            ) : (
                              <Archive className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        <div>
                          {deletingSessionId === sess.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[#f85149]">Confirm delete?</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteConfirm(sess.id)}
                                className="px-2 py-0.5 rounded bg-[#f85149] text-white text-[11px] font-semibold"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingSessionId(null)}
                                className="px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeletingSessionId(sess.id)}
                              className="p-1 text-[#8b949e] hover:text-[#f85149] hover:bg-[#21262d] rounded transition-colors"
                              title="Delete session"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Version Snapshots */}
        {activeTab === 'snapshots' && (
          <div className="flex-1 flex flex-col overflow-hidden p-5">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-white">Project Version Snapshots</h3>
                <p className="text-xs text-[#8b949e]">
                  Point-in-time checkpoints of the reconstructed Android Studio project and AI modifications.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCreateSnapshotModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-xs font-semibold shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Checkpoint</span>
              </button>
            </div>

            {/* Create Snapshot Form Modal */}
            {createSnapshotModalOpen && (
              <form
                onSubmit={handleCreateSnapshotSubmit}
                className="mb-4 p-4 rounded-lg bg-[#0d1117] border border-[#388bfd] animate-in fade-in"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white">New Snapshot Checkpoint</span>
                  <button
                    type="button"
                    onClick={() => setCreateSnapshotModalOpen(false)}
                    className="text-[#8b949e] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] text-[#8b949e] mb-1">Tag (identifier)</label>
                    <input
                      type="text"
                      value={newSnapshotTag}
                      onChange={(e) => setNewSnapshotTag(e.target.value)}
                      placeholder="e.g. pre-repair, v1.0-clean"
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#c9d1d9] focus:outline-hidden focus:border-[#58a6ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8b949e] mb-1">
                      Label / Title <span className="text-[#f85149]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={newSnapshotLabel}
                      onChange={(e) => setNewSnapshotLabel(e.target.value)}
                      placeholder="e.g. Before AI Symbol Renaming"
                      className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#c9d1d9] focus:outline-hidden focus:border-[#58a6ff]"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-[11px] text-[#8b949e] mb-1">Notes / Description (Optional)</label>
                  <input
                    type="text"
                    value={newSnapshotDesc}
                    onChange={(e) => setNewSnapshotDesc(e.target.value)}
                    placeholder="Details about what was changed or state of the code..."
                    className="w-full px-2.5 py-1.5 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#c9d1d9] focus:outline-hidden focus:border-[#58a6ff]"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateSnapshotModalOpen(false)}
                    className="px-3 py-1 bg-[#21262d] text-[#8b949e] rounded text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingSnapshot}
                    className="px-3 py-1 bg-[#238636] text-white rounded text-xs font-semibold"
                  >
                    {creatingSnapshot ? 'Saving...' : 'Save Checkpoint'}
                  </button>
                </div>
              </form>
            )}

            {/* Snapshots List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {snapshotsLoading ? (
                <div className="h-40 flex items-center justify-center text-xs text-[#8b949e]">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading snapshots...
                </div>
              ) : snapshots.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#30363d] rounded-lg">
                  <GitCommit className="w-8 h-8 text-[#8b949e] mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-[#c9d1d9]">No Snapshots Yet</p>
                  <p className="text-xs text-[#8b949e] mt-1 max-w-sm">
                    Create a checkpoint anytime to freeze the current Android Studio project before applying AI repairs or major builds.
                  </p>
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white">{snap.label}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#30363d] text-[#8b949e]">
                          {snap.tag}
                        </span>
                        {snap.isAutomatic && (
                          <span className="text-[9px] font-mono px-1 rounded bg-[#2f81f7]/20 text-[#58a6ff]">
                            Auto Rollback
                          </span>
                        )}
                      </div>
                      {snap.description && (
                        <p className="text-xs text-[#8b949e] mt-0.5">{snap.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] font-mono text-[#6e7681]">
                        <span>{new Date(snap.createdAt).toLocaleString()}</span>
                        <span>•</span>
                        <span>{snap.fileCount} files</span>
                        <span>•</span>
                        <span>{(snap.totalSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                        <span>•</span>
                        <span>SHA: {snap.sha256}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleViewDiff(snap.id)}
                        className="px-2.5 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] rounded"
                      >
                        View Diff
                      </button>

                      <a
                        href={api.getSnapshotDownloadUrl(currentSessionId!, snap.id)}
                        download={`${snap.tag}-${snap.id}.zip`}
                        className="p-1.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#58a6ff] rounded"
                        title="Download snapshot ZIP"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>

                      <button
                        type="button"
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[#238636] hover:bg-[#2ea043] text-white rounded font-medium shadow-xs"
                        title="Restore this snapshot (current state will be backed up automatically)"
                      >
                        <RotateCcwIcon className="w-3 h-3" />
                        <span>Restore</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Diff Viewer Drawer */}
            {diffResult && (
              <div className="mt-4 p-4 rounded-lg bg-[#0d1117] border border-[#30363d] max-h-56 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-white">
                    Diff vs Current State: {diffResult.snapshotLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDiffResult(null)}
                    className="text-[#8b949e] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-xs font-mono space-y-1">
                  {diffResult.addedFiles.map((f) => (
                    <div key={f} className="text-[#3fb950]">
                      + [Added] {f}
                    </div>
                  ))}
                  {diffResult.modifiedFiles.map((f) => (
                    <div key={f} className="text-[#d29922]">
                      ~ [Modified] {f}
                    </div>
                  ))}
                  {diffResult.deletedFiles.map((f) => (
                    <div key={f} className="text-[#f85149]">
                      - [Removed] {f}
                    </div>
                  ))}
                  {diffResult.addedFiles.length === 0 &&
                    diffResult.modifiedFiles.length === 0 &&
                    diffResult.deletedFiles.length === 0 && (
                      <div className="text-[#8b949e]">No file differences detected with current project.</div>
                    )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Storage & Backup */}
        {activeTab === 'storage' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d]">
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#58a6ff]" />
                Persistence &amp; Storage Architecture
              </h3>
              <p className="text-xs text-[#8b949e] leading-relaxed">
                The reverse engineering workspace stores full decompiled trees, smali bytecode, Android Studio Gradle
                projects, and version snapshots directly on the workspace filesystem. Sessions survive browser
                reloads, internet disconnections, and Codespaces pauses without data loss.
              </p>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                <div className="p-3 rounded bg-[#161b22] border border-[#30363d]">
                  <div className="text-[#6e7681]">Storage Directory</div>
                  <div className="text-white font-semibold truncate mt-1">
                    {storageInfo?.storagePath || '/sessions'}
                  </div>
                </div>

                <div className="p-3 rounded bg-[#161b22] border border-[#30363d]">
                  <div className="text-[#6e7681]">Active Sessions</div>
                  <div className="text-white font-semibold mt-1">
                    {storageInfo?.totalSessions || sessions.length} sessions
                  </div>
                </div>

                <div className="p-3 rounded bg-[#161b22] border border-[#30363d]">
                  <div className="text-[#6e7681]">Total Disk Footprint</div>
                  <div className="text-white font-semibold mt-1">
                    {storageInfo ? (storageInfo.totalDiskUsageBytes / 1024 / 1024).toFixed(1) : '0'} MB
                  </div>
                </div>
              </div>
            </div>

            {/* Backup & Portability Actions */}
            <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d]">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <FolderArchive className="w-4 h-4 text-[#a371f7]" />
                Portable Recovery Bundles
              </h3>
              <p className="text-xs text-[#8b949e] leading-relaxed mb-4">
                Exporting a bundle packages the original APK, SHA-256 checksums, decoded resources, recovered Java
                sources, Android Studio project, build logs, and comparison report into a single portable{' '}
                <code className="text-[#58a6ff]">.zip</code>. You can import this archive at any time to resume
                recovery on another machine or container.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                {currentSessionId && (
                  <a
                    href={api.getSessionExportBundleUrl(currentSessionId)}
                    download="recovery-bundle.zip"
                    className="flex items-center gap-2 px-3 py-2 bg-[#2f81f7] hover:bg-[#388bfd] text-white rounded-md text-xs font-semibold shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Active Session Bundle (.zip)</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="flex items-center gap-2 px-3 py-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] rounded-md text-xs font-semibold"
                >
                  <Upload className="w-4 h-4 text-[#58a6ff]" />
                  <span>{isImporting ? 'Importing Bundle...' : 'Import External Bundle (.zip)'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="px-5 py-3 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between text-xs text-[#8b949e] shrink-0">
          <div className="flex items-center gap-2">
            <span>Current Workspace:</span>
            <span className="font-mono text-[#c9d1d9]">
              {currentSessionId ? currentSessionId.slice(0, 16) + '...' : 'None selected'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded-md font-medium transition-colors"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};

function RotateCcwIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
