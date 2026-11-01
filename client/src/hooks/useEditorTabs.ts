import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api.js';
import type { EditorTab } from '../types/index.js';

export function useEditorTabs(
  sessionId: string | null,
  onNotify: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void,
  onManifestSaved?: () => void
) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  // Open file from tree
  const openFile = useCallback(
    async (filePath: string, fileName: string) => {
      if (!sessionId) return;

      // If already open, just switch to it
      const existing = tabs.find((t) => t.path === filePath);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      try {
        setIsLoadingFile(true);
        const data = await api.readFile(sessionId, filePath);
        const newTab: EditorTab = {
          id: filePath,
          name: fileName,
          path: filePath,
          content: data.content,
          savedContent: data.content,
          language: data.language,
          isDirty: false,
          editable: data.editable,
          size: data.size,
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
      } catch (err) {
        onNotify('error', 'Cannot Open File', (err as Error).message);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [sessionId, tabs, onNotify]
  );

  // Update content of active tab
  const updateContent = useCallback((newContent: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id === activeTabId) {
          const isDirty = newContent !== tab.savedContent;
          return { ...tab, content: newContent, isDirty };
        }
        return tab;
      })
    );
  }, [activeTabId]);

  // Save current active tab
  const saveCurrentFile = useCallback(async () => {
    if (!sessionId || !activeTab) return;
    if (!activeTab.editable) {
      onNotify('warning', 'Read-Only File', 'This file is marked read-only and cannot be saved.');
      return;
    }
    if (!activeTab.isDirty) return;

    try {
      setIsSaving(true);
      const writeResult = await api.saveFile(sessionId, activeTab.path, activeTab.content);

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id === activeTab.id) {
            return {
              ...tab,
              savedContent: tab.content,
              isDirty: false,
              size: writeResult.size,
            };
          }
          return tab;
        })
      );

      onNotify('success', 'File Saved', `Successfully saved ${activeTab.name}`);

      if (writeResult.manifestRescanned && onManifestSaved) {
        onManifestSaved();
      }
    } catch (err) {
      onNotify('error', 'Save Failed', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, activeTab, onNotify, onManifestSaved]);

  // Close a specific tab
  const closeTab = useCallback(
    (tabId: string, force = false) => {
      const tabToClose = tabs.find((t) => t.id === tabId);
      if (!tabToClose) return;

      if (tabToClose.isDirty && !force) {
        const confirmClose = window.confirm(
          `Do you want to discard unsaved changes to '${tabToClose.name}'?`
        );
        if (!confirmClose) return;
      }

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          // Select nearby tab
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const nextTab = filtered[closedIndex] || filtered[closedIndex - 1] || null;
          setActiveTabId(nextTab ? nextTab.id : null);
        }
        return filtered;
      });
    },
    [tabs, activeTabId]
  );

  // Close others
  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const dirtyOthers = tabs.filter((t) => t.id !== tabId && t.isDirty);
      if (dirtyOthers.length > 0) {
        const confirm = window.confirm(
          `There are ${dirtyOthers.length} unsaved tab(s). Discard changes and close others?`
        );
        if (!confirm) return;
      }
      setTabs((prev) => prev.filter((t) => t.id === tabId));
      setActiveTabId(tabId);
    },
    [tabs]
  );

  // Close all
  const closeAllTabs = useCallback(() => {
    const dirtyTabs = tabs.filter((t) => t.isDirty);
    if (dirtyTabs.length > 0) {
      const confirm = window.confirm(
        `There are ${dirtyTabs.length} unsaved tab(s). Discard all changes and close all tabs?`
      );
      if (!confirm) return;
    }
    setTabs([]);
    setActiveTabId(null);
  }, [tabs]);

  // Global Ctrl+S or Cmd+S shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentFile]);

  return {
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
  };
}
