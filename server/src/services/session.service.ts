import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { ABSOLUTE_WORK_ROOT, env } from '../config/env.js';
import type {
  SessionRecord,
  ProcessingStage,
  RecoverySessionListItem,
  StorageEnvironmentInfo,
} from '../types/index.js';
import { ApiError } from '../utils/apiError.js';
import { sessionPortabilityService } from './session-portability.service.js';

export const SESSION_ID_REGEX = /^[0-9a-f]{32}$/;

export class SessionService {
  private activeOperations = new Map<string, string>(); // sessionId -> operation description

  public async initialize(): Promise<void> {
    try {
      await fs.mkdir(ABSOLUTE_WORK_ROOT, { recursive: true });
      await this.cleanupExpiredSessions();
    } catch (err) {
      console.error('Failed to initialize session directory:', err);
    }
  }

  public generateSessionId(): string {
    return randomUUID().replace(/-/g, '');
  }

  public getSessionDir(sessionId: string): string {
    if (!SESSION_ID_REGEX.test(sessionId)) {
      throw ApiError.badRequest('Invalid session ID format', 'INVALID_SESSION_ID');
    }
    return path.join(ABSOLUTE_WORK_ROOT, sessionId);
  }

  public async createSession(originalFilename: string, fileSize: number): Promise<SessionRecord> {
    const id = this.generateSessionId();
    const sessionDir = this.getSessionDir(id);

    // Create session directories
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'chunks'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'decoded'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'java'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'build'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'snapshots'), { recursive: true });

    const now = Date.now();
    const meta: SessionRecord = {
      id,
      originalFilename: path.basename(originalFilename),
      displayName: path.basename(originalFilename),
      fileSize,
      createdAt: now,
      lastAccessedAt: now,
      stage: 'preparing',
      workflowStage: 'uploaded',
      isArchived: false,
    };

    await this.saveMetadata(id, meta);
    return meta;
  }

  public async getSession(sessionId: string): Promise<SessionRecord | null> {
    try {
      const sessionDir = this.getSessionDir(sessionId);
      const metaPath = path.join(sessionDir, 'meta.json');
      const data = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(data) as SessionRecord;
      meta.lastAccessedAt = Date.now();
      await this.saveMetadata(sessionId, meta);
      return meta;
    } catch {
      return null;
    }
  }

  public async updateSession(
    sessionId: string,
    updates: Partial<SessionRecord>
  ): Promise<SessionRecord> {
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    const updated: SessionRecord = {
      ...existing,
      ...updates,
      lastAccessedAt: Date.now(),
    };

    await this.saveMetadata(sessionId, updated);
    return updated;
  }

  public async updateStage(sessionId: string, stage: ProcessingStage, error?: string): Promise<void> {
    await this.updateSession(sessionId, { stage, error });
  }

  private async saveMetadata(sessionId: string, meta: SessionRecord): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    const metaPath = path.join(sessionDir, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  public isOperationActive(sessionId: string): boolean {
    return this.activeOperations.has(sessionId);
  }

  public setOperationActive(sessionId: string, opName: string): void {
    if (this.activeOperations.has(sessionId)) {
      throw ApiError.conflict(
        `Session is currently busy with: ${this.activeOperations.get(sessionId)}`,
        'CONCURRENT_OPERATION'
      );
    }
    this.activeOperations.set(sessionId, opName);
  }

  public clearOperationActive(sessionId: string): void {
    this.activeOperations.delete(sessionId);
  }

  public async deleteSession(sessionId: string): Promise<void> {
    if (this.isOperationActive(sessionId)) {
      throw ApiError.conflict('Cannot delete session while an operation is in progress', 'SESSION_BUSY');
    }

    const sessionDir = this.getSessionDir(sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Error deleting session directory ${sessionId}:`, err);
      throw ApiError.internal('Failed to remove session directory');
    }
  }

  /**
   * Phase 6: List all recovery sessions with metadata, stage indicators, and storage stats
   */
  public async listAllSessions(options?: {
    search?: string;
    status?: string;
    includeArchived?: boolean;
  }): Promise<{ sessions: RecoverySessionListItem[]; totalCount: number }> {
    const entries = await fs.readdir(ABSOLUTE_WORK_ROOT, { withFileTypes: true });
    const list: RecoverySessionListItem[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_REGEX.test(entry.name)) {
        continue;
      }
      const sId = entry.name;
      const sessionDir = path.join(ABSOLUTE_WORK_ROOT, sId);
      const metaPath = path.join(sessionDir, 'meta.json');

      let meta: SessionRecord | null = null;
      try {
        const raw = await fs.readFile(metaPath, 'utf-8');
        meta = JSON.parse(raw) as SessionRecord;
      } catch {
        // Fallback meta if file missing
        meta = {
          id: sId,
          originalFilename: 'unknown.apk',
          fileSize: 0,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          stage: 'failed',
          error: 'Missing meta.json',
        };
      }

      // Check if active operation is currently registered
      const isBusy = this.isOperationActive(sId);
      const busyOperation = this.activeOperations.get(sId);

      // Check for interrupted operations (e.g., server restarted while decompile or build was running)
      let isInterrupted = meta.interrupted || false;
      const inFlightStages: ProcessingStage[] = ['preparing', 'uploading', 'joining', 'validating', 'apktool', 'jadx'];
      if (!isBusy && inFlightStages.includes(meta.stage)) {
        isInterrupted = true;
      }

      // Infer workflow stage
      const stageInfo = await sessionPortabilityService.inferWorkflowStage(sId);
      const stats = await sessionPortabilityService.getDirStats(sessionDir);
      const versions = await sessionPortabilityService.listVersionSnapshots(sId);

      const isArchived = Boolean(meta.isArchived);
      if (!options?.includeArchived && isArchived) {
        continue;
      }

      const item: RecoverySessionListItem = {
        id: sId,
        displayName: meta.displayName || meta.originalFilename,
        originalFilename: meta.originalFilename,
        fileSize: meta.fileSize,
        originalSha256: meta.originalSha256,
        packageName: meta.packageName,
        versionName: meta.versionName,
        createdAt: meta.createdAt,
        lastAccessedAt: meta.lastAccessedAt,
        stage: meta.stage,
        workflowStage: isInterrupted ? 'interrupted' : stageInfo.stage,
        progressPercent: isInterrupted ? 35 : stageInfo.progressPercent,
        isArchived,
        isBusy,
        busyOperation,
        isInterrupted,
        totalDiskSizeBytes: stats.sizeBytes,
        fileCount: stats.fileCount,
        hasReconstructedProject: stageInfo.hasReconstructedProject,
        hasComparisonReport: stageInfo.hasComparisonReport,
        hasGradleBuild: stageInfo.hasGradleBuild,
        versionsCount: versions.length,
        error: meta.error,
      };

      // Search filtering
      if (options?.search) {
        const q = options.search.toLowerCase();
        const matches =
          item.displayName.toLowerCase().includes(q) ||
          item.originalFilename.toLowerCase().includes(q) ||
          (item.packageName && item.packageName.toLowerCase().includes(q)) ||
          item.id.toLowerCase().includes(q);
        if (!matches) continue;
      }

      // Status filtering
      if (options?.status && options.status !== 'all') {
        if (options.status === 'archived' && !item.isArchived) continue;
        if (options.status === 'active' && item.isArchived) continue;
        if (options.status !== 'archived' && options.status !== 'active' && item.workflowStage !== options.status) {
          continue;
        }
      }

      list.push(item);
    }

    // Sort by lastAccessedAt descending
    list.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

    return {
      sessions: list,
      totalCount: list.length,
    };
  }

  /**
   * Phase 6: Rename a recovery session
   */
  public async renameSession(sessionId: string, newDisplayName: string): Promise<SessionRecord> {
    const trimmed = newDisplayName.trim();
    if (!trimmed) {
      throw ApiError.badRequest('Session display name cannot be blank', 'INVALID_NAME');
    }
    return this.updateSession(sessionId, { displayName: trimmed });
  }

  /**
   * Phase 6: Archive or unarchive a recovery session
   */
  public async archiveSession(sessionId: string, isArchived: boolean): Promise<SessionRecord> {
    return this.updateSession(sessionId, { isArchived });
  }

  /**
   * Phase 6: Duplicate an existing recovery session
   */
  public async duplicateSession(sessionId: string, newDisplayName?: string): Promise<SessionRecord> {
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    const srcDir = this.getSessionDir(sessionId);
    const newSessionId = this.generateSessionId();
    const destDir = this.getSessionDir(newSessionId);

    // Deep copy session directory
    await fs.cp(srcDir, destDir, { recursive: true });

    // Update meta.json with new ID and display name
    const now = Date.now();
    const duplicatedMeta: SessionRecord = {
      ...existing,
      id: newSessionId,
      displayName: newDisplayName?.trim() || `${existing.displayName || existing.originalFilename} (Copy)`,
      createdAt: now,
      lastAccessedAt: now,
      interrupted: false,
    };

    await fs.writeFile(
      path.join(destDir, 'meta.json'),
      JSON.stringify(duplicatedMeta, null, 2),
      'utf-8'
    );

    // Update manifest if exists
    try {
      await sessionPortabilityService.generateManifest(newSessionId);
    } catch {
      // ignore manifest generation error
    }

    return duplicatedMeta;
  }

  /**
   * Phase 6: Resume an existing or interrupted session
   */
  public async resumeSession(sessionId: string): Promise<SessionRecord> {
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    // Clear stale locks
    this.clearOperationActive(sessionId);

    // Reset interrupted flag
    const updated = await this.updateSession(sessionId, {
      interrupted: false,
      lastAccessedAt: Date.now(),
    });

    return updated;
  }

  /**
   * Phase 6: Environment and storage diagnostics
   */
  public async getStorageEnvironmentInfo(): Promise<StorageEnvironmentInfo> {
    const isCodespace = Boolean(
      process.env.CODESPACES || process.env.GITHUB_CODESPACE_TOKEN || process.env.CODESPACE_NAME
    );

    let totalSessions = 0;
    let totalDiskUsageBytes = 0;

    try {
      const entries = await fs.readdir(ABSOLUTE_WORK_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && SESSION_ID_REGEX.test(entry.name)) {
          totalSessions++;
          const stats = await sessionPortabilityService.getDirStats(path.join(ABSOLUTE_WORK_ROOT, entry.name));
          totalDiskUsageBytes += stats.sizeBytes;
        }
      }
    } catch {
      // ignore
    }

    let freeDiskBytes: number | undefined;
    try {
      const fsStat = await fs.statfs(ABSOLUTE_WORK_ROOT);
      freeDiskBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
    } catch {
      // statfs fallback
    }

    let warningMessage = 'Workspace filesystem is verified. All recovery state, files, and snapshots are persisted.';
    if (isCodespace) {
      warningMessage =
        'GitHub Codespaces environment detected. Sessions are persisted in the container workspace, but exporting session bundles (.zip) is recommended before rebuilding the devcontainer.';
    }

    return {
      storagePath: ABSOLUTE_WORK_ROOT,
      isPersistentVolume: true,
      isCodespace,
      warningMessage,
      totalSessions,
      totalDiskUsageBytes,
      freeDiskBytes,
    };
  }

  public async cleanupExpiredSessions(): Promise<number> {
    const ttlMs = env.SESSION_TTL_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;

    try {
      const entries = await fs.readdir(ABSOLUTE_WORK_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !SESSION_ID_REGEX.test(entry.name)) {
          continue;
        }

        const sessionId = entry.name;
        if (this.isOperationActive(sessionId)) {
          continue; // Do not delete currently active sessions
        }

        try {
          const metaPath = path.join(ABSOLUTE_WORK_ROOT, sessionId, 'meta.json');
          const data = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(data) as SessionRecord;

          // Never auto-clean archived sessions or sessions with reconstructed projects
          if (meta.isArchived) {
            continue;
          }

          if (now - meta.lastAccessedAt > ttlMs) {
            await fs.rm(path.join(ABSOLUTE_WORK_ROOT, sessionId), { recursive: true, force: true });
            cleanedCount++;
          }
        } catch {
          // If meta.json is corrupt or missing and directory is older than TTL, clean it up
          try {
            const stat = await fs.stat(path.join(ABSOLUTE_WORK_ROOT, sessionId));
            if (now - stat.mtimeMs > ttlMs) {
              await fs.rm(path.join(ABSOLUTE_WORK_ROOT, sessionId), { recursive: true, force: true });
              cleanedCount++;
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    } catch (err) {
      console.error('Error during expired sessions cleanup:', err);
    }

    return cleanedCount;
  }
}

export const sessionService = new SessionService();
