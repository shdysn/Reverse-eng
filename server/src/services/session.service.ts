import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ABSOLUTE_WORK_ROOT, env } from '../config/env.js';
import type { SessionRecord, ProcessingStage } from '../types/index.js';
import { ApiError } from '../utils/apiError.js';

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

    const now = Date.now();
    const meta: SessionRecord = {
      id,
      originalFilename: path.basename(originalFilename),
      fileSize,
      createdAt: now,
      lastAccessedAt: now,
      stage: 'preparing',
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
