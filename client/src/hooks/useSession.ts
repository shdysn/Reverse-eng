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

  const SESSION_STORAGE_KEY = 'android_re_active_session_id';
  const FILENAME_STORAGE_KEY = 'android_re_active_filename';

  // Check health and restore active session on mount with automatic retry for server startup
  const checkHealth = useCallback(
    async (retriesLeft = 3, delayMs = 1200) => {
      try {
        setHealthLoading(true);
        const data = await api.getHealth();
        setHealth(data);
        // Clear any previous "Backend Unavailable" notifications when backend becomes online
        setNotifications((prev) => prev.filter((n) => n.title !== 'Backend Unavailable'));
        if (!data.toolsAvailable) {
          addNotification(
            'warning',
            'External Android Tools Not Installed',
            'Required APK tools (apktool/java) are unavailable in this environment. Run setup-codespace.sh in Codespaces or Ubuntu to install them.'
          );
        }
      } catch (err) {
        if (retriesLeft > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return checkHealth(retriesLeft - 1, delayMs * 1.5);
        }
        addNotification('error', 'Backend Unavailable', (err as Error).message);
      } finally {
        setHealthLoading(false);
      }
    },
    [addNotification]
  );

  // Load tree
  const loadTree = useCallback(
    async (sId: string) => {
      try {
        setTreeLoading(true);
        const data = await api.getFileTree(sId);
        setTreeData(data);
        // Expand root and second-level directories by default so files are immediately visible
        const initialExpanded = new Set<string>();
        const expandDirs = (nodes: TreeNode[], depth = 0) => {
          nodes.forEach((node) => {
            if (node.type === 'directory') {
              initialExpanded.add(node.path);
              if (depth < 2 && node.children) {
                expandDirs(node.children, depth + 1);
              }
            }
          });
        };
        expandDirs(data.tree, 0);
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

  useEffect(() => {
    checkHealth();

    // Restore existing session from localStorage if user reloads the page
    try {
      const savedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      const savedFilename = localStorage.getItem(FILENAME_STORAGE_KEY);
      if (savedSessionId) {
        api
          .getSession(savedSessionId)
          .then((sess) => {
            if (sess && sess.id) {
              setSessionId(sess.id);
              setOriginalFilename(savedFilename || sess.originalFilename || 'app.apk');
              loadTree(sess.id);
              loadManifest(sess.id);
            } else {
              localStorage.removeItem(SESSION_STORAGE_KEY);
              localStorage.removeItem(FILENAME_STORAGE_KEY);
            }
          })
          .catch(() => {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            localStorage.removeItem(FILENAME_STORAGE_KEY);
          });
      }
    } catch {
      // ignore localStorage error
    }
  }, [checkHealth, loadTree, loadManifest]);

  // Set active session
  const activateSession = useCallback(
    (sId: string, filename: string, partialJadx?: boolean) => {
      setSessionId(sId);
      setOriginalFilename(filename);
      setRebuildResult(null);
      loadTree(sId);
      loadManifest(sId);

      try {
        localStorage.setItem(SESSION_STORAGE_KEY, sId);
        localStorage.setItem(FILENAME_STORAGE_KEY, filename);
      } catch {
        // ignore storage error
      }

      // Automatically open the mobile explorer drawer so files are visible immediately on phones
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setMobileExplorerOpen(true);
      }

      if (partialJadx) {
        addNotification(
          'info',
          'Files Extracted Successfully',
          'APK contents decompiled and ready to inspect in File Explorer.'
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
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(FILENAME_STORAGE_KEY);
    } catch {
      // ignore storage error
    }

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
