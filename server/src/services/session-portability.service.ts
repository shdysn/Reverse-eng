import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { createRequire } from 'node:module';
import { sessionService } from './session.service.js';
import { ApiError } from '../utils/apiError.js';
import type {
  RecoverySessionManifest,
  SessionVersionSnapshot,
  SessionManifestFileEntry,
  RecoveryWorkflowStage,
  VersionDiffResult,
  SessionImportResponse,
} from '@android-re/shared';

const require = createRequire(import.meta.url);
const archiverMod = require('archiver');

function createZipArchive(options: Record<string, unknown> = { zlib: { level: 6 } }): any {
  if (typeof archiverMod === 'function') {
    return archiverMod('zip', options);
  }
  if (typeof archiverMod?.default === 'function') {
    return archiverMod.default('zip', options);
  }
  if (typeof archiverMod?.ZipArchive === 'function') {
    return new archiverMod.ZipArchive(options);
  }
  throw new Error('Unable to initialize ZipArchive stream');
}

export class SessionPortabilityService {
  /**
   * Computes SHA-256 hash of a file
   */
  public async computeFileSha256(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Calculates total directory size and file count
   */
  public async getDirStats(dirPath: string): Promise<{ sizeBytes: number; fileCount: number }> {
    let sizeBytes = 0;
    let fileCount = 0;

    const traverse = async (current: string) => {
      try {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await traverse(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
            try {
              const stat = await fs.stat(fullPath);
              sizeBytes += stat.size;
            } catch {
              // ignore stat error
            }
          }
        }
      } catch {
        // ignore missing directory
      }
    };

    await traverse(dirPath);
    return { sizeBytes, fileCount };
  }

  /**
   * Infers the current recovery workflow stage and progress percentage
   */
  public async inferWorkflowStage(sessionId: string): Promise<{
    stage: RecoveryWorkflowStage;
    progressPercent: number;
    hasDecompiledCode: boolean;
    hasSmaliCode: boolean;
    hasAiRecovery: boolean;
    hasReconstructedProject: boolean;
    hasGradleBuild: boolean;
    hasComparisonReport: boolean;
  }> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const session = await sessionService.getSession(sessionId);

    const hasInputApk = fsSync.existsSync(path.join(sessionDir, 'input.apk'));
    const hasDecoded = fsSync.existsSync(path.join(sessionDir, 'decoded', 'AndroidManifest.xml'));
    const hasSmali = fsSync.existsSync(path.join(sessionDir, 'decoded', 'smali'));
    const hasJava = fsSync.existsSync(path.join(sessionDir, 'java'));
    const hasAiRecovery =
      fsSync.existsSync(path.join(sessionDir, 'recovery-state.json')) ||
      fsSync.existsSync(path.join(sessionDir, 'ai-renamed-symbols.json'));
    const hasReconstructed = fsSync.existsSync(path.join(sessionDir, 'android-studio-project', 'app', 'build.gradle')) ||
      fsSync.existsSync(path.join(sessionDir, 'android-studio-project', 'build.gradle'));
    const hasGradleBuild = fsSync.existsSync(path.join(sessionDir, 'build-runs.json'));
    const hasComparison = fsSync.existsSync(path.join(sessionDir, 'comparison-report.json'));

    if (session?.error && session.stage === 'failed') {
      return {
        stage: 'failed',
        progressPercent: 10,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery,
        hasReconstructedProject: hasReconstructed,
        hasGradleBuild,
        hasComparisonReport: hasComparison,
      };
    }

    if (session?.interrupted) {
      return {
        stage: 'interrupted',
        progressPercent: 35,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery,
        hasReconstructedProject: hasReconstructed,
        hasGradleBuild,
        hasComparisonReport: hasComparison,
      };
    }

    if (hasComparison) {
      return {
        stage: 'compared',
        progressPercent: 100,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery,
        hasReconstructedProject: hasReconstructed,
        hasGradleBuild,
        hasComparisonReport: true,
      };
    }

    if (hasGradleBuild) {
      return {
        stage: 'gradle_built',
        progressPercent: 85,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery,
        hasReconstructedProject: hasReconstructed,
        hasGradleBuild: true,
        hasComparisonReport: false,
      };
    }

    if (hasReconstructed) {
      return {
        stage: 'reconstructed',
        progressPercent: 65,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery,
        hasReconstructedProject: true,
        hasGradleBuild: false,
        hasComparisonReport: false,
      };
    }

    if (hasAiRecovery) {
      return {
        stage: 'ai_analyzed',
        progressPercent: 50,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery: true,
        hasReconstructedProject: false,
        hasGradleBuild: false,
        hasComparisonReport: false,
      };
    }

    if (hasDecoded || hasJava) {
      return {
        stage: 'decompiled',
        progressPercent: 35,
        hasDecompiledCode: hasDecoded,
        hasSmaliCode: hasSmali,
        hasAiRecovery: false,
        hasReconstructedProject: false,
        hasGradleBuild: false,
        hasComparisonReport: false,
      };
    }

    if (hasInputApk) {
      return {
        stage: 'uploaded',
        progressPercent: 15,
        hasDecompiledCode: false,
        hasSmaliCode: false,
        hasAiRecovery: false,
        hasReconstructedProject: false,
        hasGradleBuild: false,
        hasComparisonReport: false,
      };
    }

    return {
      stage: 'uploaded',
      progressPercent: 5,
      hasDecompiledCode: false,
      hasSmaliCode: false,
      hasAiRecovery: false,
      hasReconstructedProject: false,
      hasGradleBuild: false,
      hasComparisonReport: false,
    };
  }

  /**
   * Generates a complete RecoverySessionManifest representing the full project state
   */
  public async generateManifest(sessionId: string): Promise<RecoverySessionManifest> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    const inputApk = path.join(sessionDir, 'input.apk');
    const originalSha256 = fsSync.existsSync(inputApk)
      ? await this.computeFileSha256(inputApk)
      : session.originalSha256 || '';

    const stageInfo = await this.inferWorkflowStage(sessionId);
    const versions = await this.listVersionSnapshots(sessionId);

    // Collect key artifacts
    const keyArtifacts: SessionManifestFileEntry[] = [];
    const checkArtifact = async (relPath: string) => {
      const fullPath = path.join(sessionDir, relPath);
      if (fsSync.existsSync(fullPath)) {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isFile()) {
            const hash = await this.computeFileSha256(fullPath);
            keyArtifacts.push({
              path: relPath,
              sizeBytes: stat.size,
              sha256: hash,
            });
          }
        } catch {
          // ignore stat error
        }
      }
    };

    await checkArtifact('input.apk');
    await checkArtifact('decoded/AndroidManifest.xml');
    await checkArtifact('decoded/apktool.yml');
    await checkArtifact('comparison-report.json');
    await checkArtifact('build-runs.json');
    await checkArtifact('android-studio-project/app/build.gradle');
    await checkArtifact('android-studio-project/app/src/main/AndroidManifest.xml');

    const manifest: RecoverySessionManifest = {
      manifestVersion: '1.0.0',
      sessionId: session.id,
      displayName: session.displayName || session.originalFilename,
      originalFilename: session.originalFilename,
      originalSha256,
      fileSize: session.fileSize,
      packageName: session.packageName,
      versionName: session.versionName,
      versionCode: session.versionCode,
      createdAt: new Date(session.createdAt).toISOString(),
      lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
      workflowStage: stageInfo.stage,
      progressPercent: stageInfo.progressPercent,
      hasDecompiledCode: stageInfo.hasDecompiledCode,
      hasSmaliCode: stageInfo.hasSmaliCode,
      hasAiRecovery: stageInfo.hasAiRecovery,
      hasReconstructedProject: stageInfo.hasReconstructedProject,
      hasGradleBuild: stageInfo.hasGradleBuild,
      hasComparisonReport: stageInfo.hasComparisonReport,
      versions,
      keyArtifacts,
      environment: {
        exportTimestamp: new Date().toISOString(),
        nodeVersion: process.version,
      },
    };

    // Save manifest in session dir
    await fs.writeFile(
      path.join(sessionDir, 'session-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    return manifest;
  }

  /**
   * Version Snapshots Management
   */
  private getSnapshotsDir(sessionId: string): string {
    const sessionDir = sessionService.getSessionDir(sessionId);
    return path.join(sessionDir, 'snapshots');
  }

  private async getSnapshotsIndex(sessionId: string): Promise<SessionVersionSnapshot[]> {
    const snapshotsDir = this.getSnapshotsDir(sessionId);
    const indexPath = path.join(snapshotsDir, 'index.json');
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data) as SessionVersionSnapshot[];
    } catch {
      return [];
    }
  }

  private async saveSnapshotsIndex(sessionId: string, snapshots: SessionVersionSnapshot[]): Promise<void> {
    const snapshotsDir = this.getSnapshotsDir(sessionId);
    await fs.mkdir(snapshotsDir, { recursive: true });
    const indexPath = path.join(snapshotsDir, 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(snapshots, null, 2), 'utf-8');
  }

  public async listVersionSnapshots(sessionId: string): Promise<SessionVersionSnapshot[]> {
    return this.getSnapshotsIndex(sessionId);
  }

  /**
   * Creates a point-in-time version snapshot of the editable source and reconstructed project
   */
  public async createVersionSnapshot(
    sessionId: string,
    tag: string,
    label: string,
    description?: string,
    isAutomatic = false
  ): Promise<SessionVersionSnapshot> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const snapshotsDir = this.getSnapshotsDir(sessionId);
    await fs.mkdir(snapshotsDir, { recursive: true });

    const snapshotId = `snap_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const targetSnapshotDir = path.join(snapshotsDir, snapshotId);
    await fs.mkdir(targetSnapshotDir, { recursive: true });

    // Source directories to capture in snapshot:
    // 1. android-studio-project (if exists)
    // 2. decoded modifications (or key files)
    const projectDir = path.join(sessionDir, 'android-studio-project');
    if (fsSync.existsSync(projectDir)) {
      await fs.cp(projectDir, path.join(targetSnapshotDir, 'android-studio-project'), {
        recursive: true,
      });
    }

    // Capture comparison report & build logs if present
    const copyIfExists = async (fileName: string) => {
      const src = path.join(sessionDir, fileName);
      if (fsSync.existsSync(src)) {
        await fs.cp(src, path.join(targetSnapshotDir, fileName), { recursive: true });
      }
    };
    await copyIfExists('comparison-report.json');
    await copyIfExists('build-runs.json');
    await copyIfExists('recovery-state.json');

    // Calculate snapshot stats & hash
    const stats = await this.getDirStats(targetSnapshotDir);
    const hash = crypto
      .createHash('sha256')
      .update(`${snapshotId}_${stats.sizeBytes}_${stats.fileCount}`)
      .digest('hex')
      .slice(0, 16);

    const stageInfo = await this.inferWorkflowStage(sessionId);

    const snapshot: SessionVersionSnapshot = {
      id: snapshotId,
      tag: tag || 'checkpoint',
      label: label || `Snapshot ${new Date().toLocaleTimeString()}`,
      description,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      workflowStage: stageInfo.stage,
      fileCount: stats.fileCount,
      totalSizeBytes: stats.sizeBytes,
      sha256: hash,
      isAutomatic,
    };

    const existing = await this.getSnapshotsIndex(sessionId);
    existing.unshift(snapshot);
    await this.saveSnapshotsIndex(sessionId, existing);

    return snapshot;
  }

  /**
   * Restores a previously created snapshot, with automatic safety backup
   */
  public async restoreVersionSnapshot(
    sessionId: string,
    snapshotId: string
  ): Promise<{ restoredSnapshot: SessionVersionSnapshot; backupSnapshotId: string }> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const snapshotsDir = this.getSnapshotsDir(sessionId);
    const targetSnapshotDir = path.join(snapshotsDir, snapshotId);

    if (!fsSync.existsSync(targetSnapshotDir)) {
      throw ApiError.notFound(`Snapshot ${snapshotId} not found`, 'SNAPSHOT_NOT_FOUND');
    }

    const index = await this.getSnapshotsIndex(sessionId);
    const snapshot = index.find((s) => s.id === snapshotId);
    if (!snapshot) {
      throw ApiError.notFound(`Snapshot metadata not found for ${snapshotId}`, 'SNAPSHOT_NOT_FOUND');
    }

    // 1. Create automatic rollback safety snapshot first!
    const autoBackup = await this.createVersionSnapshot(
      sessionId,
      'pre-restore-backup',
      `Auto Backup before restoring "${snapshot.label}"`,
      `Created automatically prior to rolling back to snapshot ${snapshotId}`,
      true
    );

    // 2. Restore android-studio-project
    const snapProject = path.join(targetSnapshotDir, 'android-studio-project');
    const currentProject = path.join(sessionDir, 'android-studio-project');
    if (fsSync.existsSync(snapProject)) {
      if (fsSync.existsSync(currentProject)) {
        await fs.rm(currentProject, { recursive: true, force: true });
      }
      await fs.cp(snapProject, currentProject, { recursive: true });
    }

    // 3. Restore comparison & build history if present in snapshot
    const restoreIfExists = async (fileName: string) => {
      const src = path.join(targetSnapshotDir, fileName);
      if (fsSync.existsSync(src)) {
        await fs.cp(src, path.join(sessionDir, fileName), { recursive: true });
      }
    };
    await restoreIfExists('comparison-report.json');
    await restoreIfExists('build-runs.json');
    await restoreIfExists('recovery-state.json');

    await sessionService.updateSession(sessionId, {
      lastAccessedAt: Date.now(),
    });

    return {
      restoredSnapshot: snapshot,
      backupSnapshotId: autoBackup.id,
    };
  }

  /**
   * Compares the files in a snapshot with the current active state
   */
  public async getSnapshotDiff(sessionId: string, snapshotId: string): Promise<VersionDiffResult> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const snapshotsDir = this.getSnapshotsDir(sessionId);
    const targetSnapshotDir = path.join(snapshotsDir, snapshotId);

    if (!fsSync.existsSync(targetSnapshotDir)) {
      throw ApiError.notFound(`Snapshot ${snapshotId} not found`, 'SNAPSHOT_NOT_FOUND');
    }

    const index = await this.getSnapshotsIndex(sessionId);
    const snapshot = index.find((s) => s.id === snapshotId);

    const snapProject = path.join(targetSnapshotDir, 'android-studio-project');
    const curProject = path.join(sessionDir, 'android-studio-project');

    const getFilesMap = async (dir: string): Promise<Map<string, { size: number; mtime: number }>> => {
      const map = new Map<string, { size: number; mtime: number }>();
      const walk = async (sub: string, rel: string) => {
        try {
          const items = await fs.readdir(sub, { withFileTypes: true });
          for (const item of items) {
            const itemRel = rel ? `${rel}/${item.name}` : item.name;
            const itemFull = path.join(sub, item.name);
            if (item.isDirectory()) {
              await walk(itemFull, itemRel);
            } else if (item.isFile()) {
              const stat = await fs.stat(itemFull);
              map.set(itemRel, { size: stat.size, mtime: stat.mtimeMs });
            }
          }
        } catch {
          // ignore missing
        }
      };
      if (fsSync.existsSync(dir)) {
        await walk(dir, '');
      }
      return map;
    };

    const snapFiles = await getFilesMap(snapProject);
    const curFiles = await getFilesMap(curProject);

    const addedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];
    let unchangedFilesCount = 0;

    for (const [filePath, curMeta] of curFiles.entries()) {
      if (!snapFiles.has(filePath)) {
        addedFiles.push(filePath);
      } else {
        const snapMeta = snapFiles.get(filePath)!;
        if (curMeta.size !== snapMeta.size) {
          modifiedFiles.push(filePath);
        } else {
          unchangedFilesCount++;
        }
      }
    }

    for (const filePath of snapFiles.keys()) {
      if (!curFiles.has(filePath)) {
        deletedFiles.push(filePath);
      }
    }

    return {
      snapshotId,
      snapshotLabel: snapshot?.label || snapshotId,
      snapshotCreatedAt: snapshot?.createdAt || new Date().toISOString(),
      addedFiles,
      modifiedFiles,
      deletedFiles,
      unchangedFilesCount,
    };
  }

  /**
   * Exports the entire session state and artifacts as a portable ZIP stream
   */
  public async exportSessionBundle(sessionId: string, outputStream: any): Promise<void> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    // Ensure manifest is up-to-date
    const manifest = await this.generateManifest(sessionId);

    const archive = createZipArchive({ zlib: { level: 6 } });
    archive.pipe(outputStream);

    // 1. Append session-manifest.json
    archive.append(JSON.stringify(manifest, null, 2), { name: 'session-manifest.json' });

    // 2. Append meta.json
    const metaPath = path.join(sessionDir, 'meta.json');
    if (fsSync.existsSync(metaPath)) {
      archive.file(metaPath, { name: 'meta.json' });
    }

    // 3. Append input.apk (original APK)
    const inputApk = path.join(sessionDir, 'input.apk');
    if (fsSync.existsSync(inputApk)) {
      archive.file(inputApk, { name: 'input.apk' });
    }

    // 4. Append decoded resources & smali
    const decodedDir = path.join(sessionDir, 'decoded');
    if (fsSync.existsSync(decodedDir)) {
      archive.directory(decodedDir, 'decoded');
    }

    // 5. Append decompiled java
    const javaDir = path.join(sessionDir, 'java');
    if (fsSync.existsSync(javaDir)) {
      archive.directory(javaDir, 'java');
    }

    // 6. Append reconstructed Android Studio project
    const projectDir = path.join(sessionDir, 'android-studio-project');
    if (fsSync.existsSync(projectDir)) {
      archive.directory(projectDir, 'android-studio-project');
    }

    // 7. Append reports and snapshots
    const filesToInclude = [
      'comparison-report.json',
      'build-runs.json',
      'recovery-state.json',
      'ai-renamed-symbols.json',
    ];
    for (const f of filesToInclude) {
      const full = path.join(sessionDir, f);
      if (fsSync.existsSync(full)) {
        archive.file(full, { name: f });
      }
    }

    const snapshotsDir = path.join(sessionDir, 'snapshots');
    if (fsSync.existsSync(snapshotsDir)) {
      archive.directory(snapshotsDir, 'snapshots');
    }

    await archive.finalize();
  }

  /**
   * Imports a recovery session bundle ZIP file with strict zip-slip protection
   */
  public async importSessionBundle(zipFilePath: string): Promise<SessionImportResponse> {
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      throw ApiError.badRequest('Uploaded session archive is empty', 'EMPTY_ARCHIVE');
    }

    // 1. Strict Path Traversal & Zip Slip Prevention
    for (const entry of zipEntries) {
      const name = entry.entryName;
      if (
        name.startsWith('/') ||
        name.startsWith('\\') ||
        name.includes('../') ||
        name.includes('..\\') ||
        path.isAbsolute(name)
      ) {
        throw ApiError.badRequest(
          `Security violation: Archive contains forbidden path traversal entry: ${name}`,
          'ZIP_SLIP_DETECTED'
        );
      }
    }

    // 2. Read or construct manifest
    let manifest: RecoverySessionManifest | null = null;
    const manifestEntry = zipEntries.find((e) => e.entryName === 'session-manifest.json');
    if (manifestEntry) {
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as RecoverySessionManifest;
      } catch (err) {
        console.warn('Failed to parse session-manifest.json from imported zip:', err);
      }
    }

    // 3. Allocate fresh session ID
    const newSessionId = sessionService.generateSessionId();
    const targetSessionDir = sessionService.getSessionDir(newSessionId);
    await fs.mkdir(targetSessionDir, { recursive: true });

    // 4. Safely extract all entries
    let totalFilesRestored = 0;
    for (const entry of zipEntries) {
      if (entry.isDirectory) {
        continue;
      }
      const resolvedTarget = path.resolve(targetSessionDir, entry.entryName);
      if (!resolvedTarget.startsWith(targetSessionDir)) {
        throw ApiError.badRequest('Invalid destination path inside session', 'SECURITY_ERROR');
      }

      await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
      await fs.writeFile(resolvedTarget, entry.getData());
      totalFilesRestored++;
    }

    // 5. Restore or create meta.json
    const originalFilename = manifest?.originalFilename || 'imported-project.apk';
    const inputApk = path.join(targetSessionDir, 'input.apk');
    let fileSize = manifest?.fileSize || 0;
    if (fsSync.existsSync(inputApk)) {
      const stat = await fs.stat(inputApk);
      fileSize = stat.size;
    }

    const now = Date.now();
    const meta = {
      id: newSessionId,
      originalFilename,
      displayName: manifest?.displayName ? `${manifest.displayName} (Imported)` : `Imported ${originalFilename}`,
      fileSize,
      createdAt: now,
      lastAccessedAt: now,
      stage: 'ready' as const,
      workflowStage: manifest?.workflowStage || 'reconstructed',
      packageName: manifest?.packageName,
      versionName: manifest?.versionName,
      versionCode: manifest?.versionCode,
      originalSha256: manifest?.originalSha256,
      rebuilt: manifest?.hasGradleBuild || false,
    };

    await fs.writeFile(
      path.join(targetSessionDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );

    // Regenerate manifest in target dir to sync with new session ID
    const regeneratedManifest = await this.generateManifest(newSessionId);

    // Remove uploaded temporary ZIP
    try {
      await fs.unlink(zipFilePath);
    } catch {
      // ignore unlink error
    }

    return {
      sessionId: newSessionId,
      displayName: meta.displayName,
      originalFilename,
      workflowStage: regeneratedManifest.workflowStage,
      totalFilesRestored,
      manifest: regeneratedManifest,
    };
  }
}

export const sessionPortabilityService = new SessionPortabilityService();
