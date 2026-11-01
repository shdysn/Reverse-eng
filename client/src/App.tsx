import React, { useState } from 'react';
import { Toolbar } from './components/Toolbar.js';
import { StatusBar } from './components/StatusBar.js';
import { FileTree } from './components/FileTree.js';
import { EditorTabs } from './components/EditorTabs.js';
import { CodeWorkspace } from './components/CodeWorkspace.js';
import { ManifestScanner } from './components/ManifestScanner.js';
import { ApkUpload } from './components/ApkUpload.js';
import { MobilePanels } from './components/MobilePanels.js';
import { useSession } from './hooks/useSession.js';
import { useEditorTabs } from './hooks/useEditorTabs.js';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

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
        onOpenUpload={() => setUploadModalOpen(true)}
        onSaveFile={saveCurrentFile}
        onRescanManifest={() => {
          if (sessionId) loadManifest(sessionId);
        }}
        onRebuild={triggerRebuild}
        onResetWorkspace={resetWorkspace}
        onToggleMobileExplorer={() => setMobileExplorerOpen((prev) => !prev)}
        onToggleMobileSecurity={() => setMobileSecurityOpen((prev) => !prev)}
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

        {/* Right: Desktop Security Scanner Panel (~320px) */}
        <aside className="hidden lg:flex w-[320px] shrink-0 h-full">
          <ManifestScanner
            scanData={manifestData}
            isLoading={manifestLoading}
            onRescan={() => {
              if (sessionId) loadManifest(sessionId);
            }}
          />
        </aside>
      </main>

      {/* Bottom Status Bar */}
      <StatusBar health={health} activeTab={activeTab} cursorPos={cursorPos} />

      {/* Upload Modal */}
      <ApkUpload
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={activateSession}
      />

      {/* Responsive Mobile Drawers */}
      <MobilePanels
        explorerOpen={mobileExplorerOpen}
        securityOpen={mobileSecurityOpen}
        onCloseExplorer={() => setMobileExplorerOpen(false)}
        onCloseSecurity={() => setMobileSecurityOpen(false)}
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
      />
    </div>
  );
}

export default App;
