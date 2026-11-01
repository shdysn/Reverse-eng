import React, { useState } from 'react';
import { Toolbar } from './components/Toolbar.js';
import { StatusBar } from './components/StatusBar.js';
import { FileTree } from './components/FileTree.js';
import { EditorTabs } from './components/EditorTabs.js';
import { CodeWorkspace } from './components/CodeWorkspace.js';
import { ManifestScanner } from './components/ManifestScanner.js';
import { AiCopilotPanel } from './components/AiCopilotPanel.js';
import { ApkUpload } from './components/ApkUpload.js';
import { PackageNameModal } from './components/PackageNameModal.js';
import { MobilePanels } from './components/MobilePanels.js';
import { useSession } from './hooks/useSession.js';
import { useEditorTabs } from './hooks/useEditorTabs.js';
import { api } from './services/api.js';
import {
  X,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import type {
  AiPatchResponse,
  AiProjectSolutionResponse,
  AiProjectFileProposal,
} from '@android-re/shared';

export function App() {
  const {
    health,
    sessionId,
    treeData,
    treeLoading,
    expandedFolders,
    toggleFolder,
    manifestData,
    manifestLoading,
    loadManifest,
    isRebuilding,
    rebuildResult,
    triggerRebuild,
    resetWorkspace,
    activateSession,
    notifications,
    addNotification,
    dismissNotification,
    mobileExplorerOpen,
    setMobileExplorerOpen,
    mobileSecurityOpen,
    setMobileSecurityOpen,
    uploadModalOpen,
    setUploadModalOpen,
  } = useSession();

  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [rightPanelTab, setRightPanelTab] = useState<'ai' | 'security'>('ai');
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [lastAiResult, setLastAiResult] = useState<AiPatchResponse | null>(null);
  const [projectAiResult, setProjectAiResult] = useState<AiProjectSolutionResponse | null>(null);

  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    isLoadingFile,
    isSaving,
    openFile,
    updateContent,
    saveCurrentFile,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
  } = useEditorTabs(sessionId, addNotification, () => {
    if (sessionId) loadManifest(sessionId);
  });

  const handleAiTransform = async (instruction: string, selectedSnippet?: string): Promise<AiPatchResponse | null> => {
    if (!activeTab) {
      addNotification('warning', 'No File Selected', 'Please open a file in the editor to modify.');
      return null;
    }

    const fileType = activeTab.name.endsWith('.smali')
      ? 'smali'
      : activeTab.name.endsWith('.xml')
      ? 'xml'
      : activeTab.name.endsWith('.java')
      ? 'java'
      : 'other';

    try {
      setIsAiProcessing(true);
      addNotification('info', 'AI Copilot Active', 'Analyzing dependencies and generating surgical patch...');

      const result = await api.transformFileWithAi({
        filePath: activeTab.path,
        fileName: activeTab.name,
        content: activeTab.content,
        instruction,
        selectedSnippet,
        fileType,
      });

      setLastAiResult(result);
      // Immediately reflect live modification in the Monaco editor
      updateContent(result.modifiedContent);

      addNotification(
        'success',
        'AI Patch Ready',
        'Surgical modifications applied in editor. Review the audit report below.'
      );

      return result;
    } catch (err) {
      addNotification('error', 'AI Modification Failed', (err as Error).message);
      return null;
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleApplyAiChanges = (newContent: string) => {
    if (activeTab) {
      updateContent(newContent);
      saveCurrentFile();
      addNotification('success', 'Changes Saved', `Applied and saved AI modifications to ${activeTab.name}`);
    }
  };

  const handleProjectAiTransform = async (query: string): Promise<AiProjectSolutionResponse | null> => {
    if (!sessionId) {
      addNotification('warning', 'No Active Project', 'Please upload an APK first to analyze project files.');
      return null;
    }

    try {
      setIsAiProcessing(true);
      addNotification('info', 'Project AI Scan Active', 'Scanning Manifest, Smali, and Java across the entire project...');

      const result = await api.analyzeProjectWithAi({
        sessionId,
        query,
      });

      setProjectAiResult(result);
      addNotification(
        'success',
        'Project Solution Ready',
        `Analyzed project architecture. Found ${result.affectedFiles.length} file(s) to patch.`
      );

      return result;
    } catch (err) {
      addNotification('error', 'Project Analysis Failed', (err as Error).message);
      return null;
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleApplyProjectFile = async (proposal: AiProjectFileProposal) => {
    if (!sessionId) return;
    try {
      await api.saveFile(sessionId, proposal.filePath, proposal.modifiedContent);
      // If currently open in editor, update active content
      if (activeTab && activeTab.path === proposal.filePath) {
        updateContent(proposal.modifiedContent);
      }
      addNotification('success', 'File Patched', `Applied project patch to ${proposal.fileName}`);
    } catch (err) {
      addNotification('error', 'Patch Failed', (err as Error).message);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      {/* Notifications Toast Overlay */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`pointer-events-auto p-3 rounded-lg border shadow-xl flex items-start gap-2.5 text-xs font-mono transition-all animate-in slide-in-from-top duration-200 ${
              n.type === 'error'
                ? 'bg-[#161b22] border-[#f85149]/60 text-[#f85149]'
                : n.type === 'warning'
                ? 'bg-[#161b22] border-[#d29922]/60 text-[#d29922]'
                : n.type === 'success'
                ? 'bg-[#161b22] border-[#238636]/60 text-[#3fb950]'
                : 'bg-[#161b22] border-[#2f81f7]/60 text-[#58a6ff]'
            }`}
          >
            {n.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            {n.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            {n.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            {n.type === 'info' && <Info className="w-4 h-4 shrink-0 mt-0.5" />}

            <div className="flex-1">
              <div className="font-semibold text-[#c9d1d9]">{n.title}</div>
              <div className="mt-0.5 text-[#8b949e] leading-relaxed text-[11px]">{n.message}</div>
            </div>

            <button
              type="button"
              onClick={() => dismissNotification(n.id)}
              className="text-[#8b949e] hover:text-[#c9d1d9] p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Top Toolbar */}
      <Toolbar
        hasSession={Boolean(sessionId)}
        canSave={Boolean(activeTab?.isDirty && activeTab?.editable)}
        isSaving={isSaving}
        isRebuilding={isRebuilding}
        rebuildResult={rebuildResult}
        sourceDownloadUrl={sessionId ? api.getSourceDownloadUrl(sessionId) : null}
        gradleDownloadUrl={sessionId ? api.getGradleDownloadUrl(sessionId) : null}
        onOpenUpload={() => setUploadModalOpen(true)}
        onOpenPackageModal={() => setPackageModalOpen(true)}
        onSaveFile={saveCurrentFile}
        onRescanManifest={() => {
          if (sessionId) loadManifest(sessionId);
        }}
        onRebuild={triggerRebuild}
        onResetWorkspace={resetWorkspace}
        onToggleMobileExplorer={() => setMobileExplorerOpen((prev) => !prev)}
        onToggleMobileSecurity={() => setMobileSecurityOpen((prev) => !prev)}
        onToggleAiCopilot={() => {
          setMobileAiOpen((prev) => !prev);
          setRightPanelTab('ai');
        }}
        aiCopilotOpen={rightPanelTab === 'ai' || mobileAiOpen}
      />

      {/* Main Workspace Layout */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left: Desktop File Tree Explorer (~270px) */}
        <aside className="hidden md:flex w-[270px] shrink-0 h-full">
          <FileTree
            treeData={treeData}
            isLoading={treeLoading}
            activePath={activeTab?.path || null}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onOpenFile={openFile}
          />
        </aside>

        {/* Center: Multi-tab Monaco Editor */}
        <section className="flex-1 flex flex-col h-full overflow-hidden bg-[#0d1117] min-w-0">
          <EditorTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={closeTab}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
          />
          <CodeWorkspace
            activeTab={activeTab}
            isLoadingFile={isLoadingFile}
            onContentChange={updateContent}
            onSave={saveCurrentFile}
            onCursorChange={(line, column) => setCursorPos({ line, column })}
          />
        </section>

        {/* Right: Desktop Tabbed Panel (~340px) - AI Copilot & Security Scanner */}
        <aside className="hidden lg:flex w-[340px] shrink-0 h-full flex-col bg-[#0d1117] border-l border-[#30363d]">
          {/* Panel Selector Tabs */}
          <div className="h-10 bg-[#161b22] border-b border-[#30363d] px-2 flex items-center gap-1 shrink-0 select-none">
            <button
              type="button"
              onClick={() => setRightPanelTab('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded text-xs font-semibold transition-all ${
                rightPanelTab === 'ai'
                  ? 'bg-[#21262d] text-white shadow-xs border border-[#30363d]'
                  : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#e3b341]" />
              <span>AI Copilot</span>
              <span className="text-[9px] px-1 rounded bg-[#238636]/30 text-[#3fb950] font-mono">
                Gemini
              </span>
            </button>

            <button
              type="button"
              onClick={() => setRightPanelTab('security')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded text-xs font-semibold transition-all ${
                rightPanelTab === 'security'
                  ? 'bg-[#21262d] text-white shadow-xs border border-[#30363d]'
                  : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]/50'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-[#f85149]" />
              <span>Security</span>
              {manifestData && manifestData.summary.critical + manifestData.summary.high > 0 && (
                <span className="text-[9px] px-1 rounded bg-[#f85149]/20 text-[#ff7b72] font-mono">
                  {manifestData.summary.critical + manifestData.summary.high}
                </span>
              )}
            </button>
          </div>

          {/* Panel Body */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'ai' ? (
              <AiCopilotPanel
                activeTab={activeTab}
                sessionId={sessionId}
                onApplyChanges={handleApplyAiChanges}
                onTransform={handleAiTransform}
                onProjectTransform={handleProjectAiTransform}
                onApplyProjectFile={handleApplyProjectFile}
                onOpenFile={openFile}
                isProcessing={isAiProcessing}
                lastAiResult={lastAiResult}
                projectAiResult={projectAiResult}
                onClearAiResult={() => setLastAiResult(null)}
                onClearProjectAiResult={() => setProjectAiResult(null)}
              />
            ) : (
              <ManifestScanner
                scanData={manifestData}
                isLoading={manifestLoading}
                onRescan={() => {
                  if (sessionId) loadManifest(sessionId);
                }}
              />
            )}
          </div>
        </aside>
      </main>

      {/* Bottom Status Bar */}
      <StatusBar health={health} activeTab={activeTab} cursorPos={cursorPos} />

      {/* Upload Modal */}
      <ApkUpload
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={(sId, filename, partialJadx) => {
          activateSession(sId, filename, partialJadx);
          setTimeout(() => {
            openFile('decoded/AndroidManifest.xml', 'AndroidManifest.xml').catch(() => {});
          }, 300);
        }}
      />

      {/* Package Name Editor & App Cloner Modal */}
      <PackageNameModal
        isOpen={packageModalOpen}
        sessionId={sessionId}
        onClose={() => setPackageModalOpen(false)}
        onSuccess={(res) => {
          addNotification(
            'success',
            'Package Name Updated',
            `Renamed ${res.oldPackageName} → ${res.newPackageName} across ${res.updatedFilesCount} files.`
          );
          if (sessionId) {
            loadManifest(sessionId);
          }
          // If AndroidManifest.xml is currently open, reload its content
          if (activeTab && activeTab.path === 'decoded/AndroidManifest.xml' && sessionId) {
            api
              .readFile(sessionId, 'decoded/AndroidManifest.xml')
              .then((data) => updateContent(data.content))
              .catch(() => {});
          }
        }}
      />

      {/* Responsive Mobile Drawers */}
      <MobilePanels
        explorerOpen={mobileExplorerOpen}
        securityOpen={mobileSecurityOpen}
        aiOpen={mobileAiOpen}
        onCloseExplorer={() => setMobileExplorerOpen(false)}
        onCloseSecurity={() => setMobileSecurityOpen(false)}
        onCloseAi={() => setMobileAiOpen(false)}
        treeData={treeData}
        treeLoading={treeLoading}
        activePath={activeTab?.path || null}
        expandedFolders={expandedFolders}
        onToggleFolder={toggleFolder}
        onOpenFile={openFile}
        manifestData={manifestData}
        manifestLoading={manifestLoading}
        onRescanManifest={() => {
          if (sessionId) loadManifest(sessionId);
        }}
        sessionId={sessionId}
        activeTab={activeTab}
        onApplyChanges={handleApplyAiChanges}
        onTransform={handleAiTransform}
        onProjectTransform={handleProjectAiTransform}
        onApplyProjectFile={handleApplyProjectFile}
        isAiProcessing={isAiProcessing}
        lastAiResult={lastAiResult}
        projectAiResult={projectAiResult}
        onClearAiResult={() => setLastAiResult(null)}
        onClearProjectAiResult={() => setProjectAiResult(null)}
      />
    </div>
  );
}

export default App;
