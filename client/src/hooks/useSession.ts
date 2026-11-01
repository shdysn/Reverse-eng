import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';
import type {
  HealthData,
  FileTreeData,
  TreeNode,
  ManifestScanData,
  RebuildData,
  NotificationItem,
} from '../types/index.js';

export function useSession() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);

  const [treeData, setTreeData] = useState<FileTreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [manifestData, setManifestData] = useState<ManifestScanData | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<RebuildData | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const [mobileSecurityOpen, setMobileSecurityOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const addNotification = useCallback(
    (type: NotificationItem['type'], title: string, message: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setNotifications((prev) => [...prev, { id, type, title, message, timestamp: Date.now() }]);

      // Auto dismiss success and info after 6s
      if (type === 'success' || type === 'info') {
        setTimeout(() => {
          setNotifications((current) => current.filter((n) => n.id !== id));
        }, 6000);
      }
    },
    []
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Check health on mount
  const checkHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      const data = await api.getHealth();
      setHealth(data);
      if (!data.toolsAvailable) {
        addNotification(
          'warning',
          'External Android Tools Not Installed',
          'Required APK tools (apktool/java) are unavailable in this environment. Run setup-codespace.sh in Codespaces or Ubuntu to install them.'
        );
      }
    } catch (err) {
      addNotification('error', 'Backend Unavailable', (err as Error).message);
    } finally {
      setHealthLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Load tree
  const loadTree = useCallback(
    async (sId: string) => {
      try {
        setTreeLoading(true);
        const data = await api.getFileTree(sId);
        setTreeData(data);
        // Expand root top-level directories by default
        const initialExpanded = new Set<string>();
        data.tree.forEach((node) => {
          if (node.type === 'directory') {
            initialExpanded.add(node.path);
          }
        });
        setExpandedFolders(initialExpanded);
      } catch (err) {
        addNotification('error', 'Failed to Load File Tree', (err as Error).message);
      } finally {
        setTreeLoading(false);
      }
    },
    [addNotification]
  );

  // Load manifest
  const loadManifest = useCallback(
    async (sId: string) => {
      try {
        setManifestLoading(true);
        const data = await api.scanManifest(sId);
        setManifestData(data);
      } catch (err) {
        addNotification('error', 'Manifest Scan Error', (err as Error).message);
      } finally {
        setManifestLoading(false);
      }
    },
    [addNotification]
  );

  // Set active session
  const activateSession = useCallback(
    (sId: string, filename: string, partialJadx?: boolean) => {
      setSessionId(sId);
      setOriginalFilename(filename);
      setRebuildResult(null);
      loadTree(sId);
      loadManifest(sId);

      if (partialJadx) {
        addNotification(
          'warning',
          'JADX Decompilation Note',
          'Apktool succeeded with Smali & resources. JADX Java source decompilation completed with warnings or is not installed.'
        );
      } else {
        addNotification('success', 'APK Decompiled Successfully', `Ready to inspect and analyze ${filename}`);
      }
    },
    [loadTree, loadManifest, addNotification]
  );

  // Rebuild
  const triggerRebuild = useCallback(async () => {
    if (!sessionId) return;
    try {
      setIsRebuilding(true);
      addNotification('info', 'Rebuild Started', 'Running apktool assemble, 4-byte zipalign, and apksigner...');
      const result = await api.rebuildApk(sessionId);
      setRebuildResult(result);
      addNotification(
        'success',
        'Signed APK Ready',
        `Rebuilt and signed with disposable test key (${(result.size / 1024 / 1024).toFixed(2)} MB). Verified successfully!`
      );
    } catch (err) {
      addNotification('error', 'Rebuild Failed', (err as Error).message);
    } finally {
      setIsRebuilding(false);
    }
  }, [sessionId, addNotification]);

  // Reset / Delete Session
  const resetWorkspace = useCallback(async () => {
    if (sessionId) {
      try {
        await api.deleteSession(sessionId);
        addNotification('info', 'Workspace Reset', 'Active session and temporary files removed.');
      } catch (err) {
        console.warn('Session delete warning:', err);
      }
    }
    setSessionId(null);
    setOriginalFilename(null);
    setTreeData(null);
    setManifestData(null);
    setRebuildResult(null);
  }, [sessionId, addNotification]);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  return {
    health,
    healthLoading,
    checkHealth,
    sessionId,
    originalFilename,
    treeData,
    treeLoading,
    expandedFolders,
    toggleFolder,
    loadTree,
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
  };
}
