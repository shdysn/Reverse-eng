import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateSessionIdParam } from '../middleware/validateSession.js';
import { sessionService } from '../services/session.service.js';
import { fileService } from '../services/file.service.js';
import { manifestService } from '../services/manifest.service.js';
import { rebuildService } from '../services/rebuild.service.js';
import { packageService } from '../services/package.service.js';
import { gradleService } from '../services/gradle.service.js';
import { gradleBuildService } from '../services/gradle-build.service.js';
import { apkComparisonService } from '../services/apk-comparison.service.js';
import { ApiError } from '../utils/apiError.js';
import path from 'node:path';
import fsSync from 'node:fs';
import { createRequire } from 'node:module';
import type { ApiResponse, GradleTaskName, FinalExportArtifactType } from '../types/index.js';

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

export const sessionRouter = Router();

const fileWriteSchema = z.object({
  content: z.string(),
});

// GET /api/sessions/:sessionId - Get session metadata
sessionRouter.get(
  '/:sessionId',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const session = await sessionService.getSession(req.params.sessionId);
    res.json({
      success: true,
      data: session,
    });
  })
);

// GET /api/sessions/:sessionId/tree - Nested File Tree
sessionRouter.get(
  '/:sessionId/tree',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const treeData = await fileService.getFileTree(req.params.sessionId);
    const response: ApiResponse<typeof treeData> = {
      success: true,
      data: treeData,
    };
    res.json(response);
  })
);

// GET /api/sessions/:sessionId/file?path=relative/path - Read file
sessionRouter.get(
  '/:sessionId/file',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const targetPath = req.query.path as string;
    const fileData = await fileService.readFile(req.params.sessionId, targetPath);
    const response: ApiResponse<typeof fileData> = {
      success: true,
      data: fileData,
    };
    res.json(response);
  })
);

// PUT /api/sessions/:sessionId/file?path=relative/path - Write/Edit file
sessionRouter.put(
  '/:sessionId/file',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const targetPath = req.query.path as string;
    const { content } = fileWriteSchema.parse(req.body);
    const writeData = await fileService.writeFile(req.params.sessionId, targetPath, content);

    // If manifest was edited, re-scan manifest
    if (writeData.manifestRescanned) {
      try {
        await manifestService.scanManifest(req.params.sessionId);
      } catch (scanErr) {
        console.warn('Auto manifest scan error after save:', scanErr);
      }
    }

    const response: ApiResponse<typeof writeData> = {
      success: true,
      data: writeData,
    };
    res.json(response);
  })
);

// GET /api/sessions/:sessionId/download - Download Rebuilt Signed APK
sessionRouter.get(
  '/:sessionId/download',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { filePath } = await rebuildService.getSignedApkPath(req.params.sessionId);

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="rebuilt-signed.apk"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    res.sendFile(filePath);
  })
);

// GET /api/sessions/:sessionId/download-source - Download Java & Decompiled Source Code ZIP
sessionRouter.get(
  '/:sessionId/download-source',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionDir = sessionService.getSessionDir(sessionId);

    const baseName = session.originalFilename
      ? session.originalFilename.replace(/\.apk$/i, '')
      : 'android-app';
    const zipName = `${baseName}-source-code.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const archive = createZipArchive({
      zlib: { level: 6 },
    });

    archive.on('error', (err: any) => {
      console.error('ZIP archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: { message: err.message } });
      }
    });

    archive.pipe(res);

    // 1. Add Java source code (from JADX) if present
    const javaDir = path.join(sessionDir, 'java');
    if (fsSync.existsSync(javaDir)) {
      archive.directory(javaDir, 'java-src');
    }

    // 2. Add decoded resources, manifest, and smali if present
    const decodedDir = path.join(sessionDir, 'decoded');
    if (fsSync.existsSync(decodedDir)) {
      archive.directory(decodedDir, 'decompiled');
    }

    // 3. Add AI Recovered & Reconstructed source code if present
    const recoveredDir = path.join(sessionDir, 'recovered');
    if (fsSync.existsSync(recoveredDir)) {
      archive.directory(recoveredDir, 'ai-recovered-src');
    }

    await archive.finalize();
  })
);

// GET /api/sessions/:sessionId/download-gradle - Download Android Studio Gradle Project ZIP
sessionRouter.get(
  '/:sessionId/download-gradle',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    await gradleService.streamGradleProjectZip(req.params.sessionId, res);
  })
);

// GET /api/sessions/:sessionId/project-reconstruct - Get existing Phase 3 Android Studio Project Reconstruction report
sessionRouter.get(
  '/:sessionId/project-reconstruct',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const report = await gradleService.getProjectReconstructionReport(req.params.sessionId);
    res.json({
      success: true,
      data: report,
    });
  })
);

const generateProjectSchema = z.object({
  useKotlinDsl: z.boolean().optional(),
  prioritizeReconstructed: z.boolean().optional(),
  sanitizeUnrecoveredMethods: z.boolean().optional(),
  excludeThirdPartySdkSources: z.boolean().optional(),
});

// POST /api/sessions/:sessionId/project-reconstruct - Generate/Reconstruct Complete Android Studio Project
sessionRouter.post(
  '/:sessionId/project-reconstruct',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = generateProjectSchema.safeParse(req.body || {});
    const opts = parsed.success ? parsed.data : {};
    const report = await gradleService.reconstructAndroidStudioProject({
      sessionId: req.params.sessionId,
      ...opts,
    });
    res.json({
      success: true,
      data: report,
    });
  })
);

// POST /api/sessions/:sessionId/project-reconstruct/build-test - Run Gradle Validation & Compilation Test
sessionRouter.post(
  '/:sessionId/project-reconstruct/build-test',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const buildResult = await gradleService.runGradleBuildTest(req.params.sessionId);
    res.json({
      success: true,
      data: buildResult,
    });
  })
);

// GET /api/sessions/:sessionId/project-reconstruct/download-report - Download Reconstruction Report (.md or .json)
sessionRouter.get(
  '/:sessionId/project-reconstruct/download-report',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const format = req.query.format === 'json' ? 'json' : 'md';
    let report = await gradleService.getProjectReconstructionReport(sessionId);
    if (!report) {
      report = await gradleService.reconstructAndroidStudioProject({ sessionId });
    }
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${report.projectName}-reconstruction-report-${report.versionId}.json"`
      );
      res.send(JSON.stringify(report, null, 2));
    } else {
      const md = gradleService.formatMarkdownReport(report);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${report.projectName}-reconstruction-report-${report.versionId}.md"`
      );
      res.send(md);
    }
  })
);

// GET /api/sessions/:sessionId/project-reconstruct/download-reconstructed-src - Download Reconstructed Source Separately
sessionRouter.get(
  '/:sessionId/project-reconstruct/download-reconstructed-src',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    await gradleService.streamReconstructedSourcesZip(req.params.sessionId, res);
  })
);

// ============================================================================
// PHASE 4: AUTOMATIC GRADLE BUILD, ERROR DETECTION & AI-POWERED CODE REPAIR
// ============================================================================

// GET /api/sessions/:sessionId/gradle-build/state - Get full Phase 4 state (environment, latest build, errors, fixes, backups, APKs)
sessionRouter.get(
  '/:sessionId/gradle-build/state',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const state = await gradleBuildService.getBuildState(req.params.sessionId);
    res.json({
      success: true,
      data: state,
    });
  })
);

// GET /api/sessions/:sessionId/gradle-build/environment - Inspect JDK, Gradle Wrapper, Android SDK & AGP compatibility
sessionRouter.get(
  '/:sessionId/gradle-build/environment',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const envStatus = await gradleBuildService.inspectEnvironment(req.params.sessionId);
    res.json({
      success: true,
      data: envStatus,
    });
  })
);

// GET /api/sessions/:sessionId/gradle-build/stream - Live SSE stream for build progress, stages & logs
sessionRouter.get(
  '/:sessionId/gradle-build/stream',
  validateSessionIdParam(),
  (req, res) => {
    gradleBuildService.subscribeToBuildStream(req.params.sessionId, res);
  }
);

const startGradleBuildSchema = z.object({
  tasks: z
    .array(z.enum(['clean', 'assembleDebug', 'assembleRelease', 'test', 'lint']))
    .optional(),
  runStaticCompilerCheck: z.boolean().optional(),
});

// POST /api/sessions/:sessionId/gradle-build/start - Execute allowlisted Gradle tasks & detect errors
sessionRouter.post(
  '/:sessionId/gradle-build/start',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = startGradleBuildSchema.safeParse(req.body || {});
    const tasks: GradleTaskName[] =
      parsed.success && parsed.data.tasks && parsed.data.tasks.length > 0
        ? parsed.data.tasks
        : ['assembleDebug'];
    const buildRun = await gradleBuildService.startGradleBuild(req.params.sessionId, {
      tasks,
      runStaticCompilerCheck: parsed.success ? parsed.data.runStaticCompilerCheck : true,
    });
    res.json({
      success: true,
      data: buildRun,
    });
  })
);

// POST /api/sessions/:sessionId/gradle-build/:buildId/cancel - Cancel running Gradle build or loop safely
sessionRouter.post(
  '/:sessionId/gradle-build/:buildId/cancel',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const result = await gradleBuildService.cancelBuild(
      req.params.sessionId,
      req.params.buildId
    );
    res.json({
      success: true,
      data: result,
    });
  })
);

const analyzeBuildErrorsSchema = z.object({
  buildId: z.string().optional(),
  errorIds: z.array(z.string()).optional(),
});

// POST /api/sessions/:sessionId/gradle-build/analyze-errors - Run AI Error Analysis & generate minimal repair proposals
sessionRouter.post(
  '/:sessionId/gradle-build/analyze-errors',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = analyzeBuildErrorsSchema.safeParse(req.body || {});
    const proposals = await gradleBuildService.analyzeBuildErrors(
      req.params.sessionId,
      parsed.success ? parsed.data : {}
    );
    res.json({
      success: true,
      data: proposals,
    });
  })
);

const applyBuildFixesSchema = z.object({
  fixIds: z.array(z.string()).min(1, 'At least one fix ID is required'),
});

// POST /api/sessions/:sessionId/gradle-build/apply-fixes - Backup files & apply selected AI fixes
sessionRouter.post(
  '/:sessionId/gradle-build/apply-fixes',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = applyBuildFixesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw ApiError.badRequest('Please select at least one AI fix proposal to apply.', 'INVALID_FIX_IDS');
    }
    const result = await gradleBuildService.applyBuildFixes(req.params.sessionId, parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

const rollbackBackupSchema = z.object({
  backupId: z.string().min(1, 'backupId is required'),
});

// POST /api/sessions/:sessionId/gradle-build/rollback - Rollback a repair backup
sessionRouter.post(
  '/:sessionId/gradle-build/rollback',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = rollbackBackupSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw ApiError.badRequest('backupId is required for rollback.', 'INVALID_BACKUP_ID');
    }
    const result = await gradleBuildService.rollbackBackup(
      req.params.sessionId,
      parsed.data.backupId
    );
    res.json({
      success: true,
      data: result,
    });
  })
);

const autoRebuildLoopSchema = z.object({
  tasks: z
    .array(z.enum(['clean', 'assembleDebug', 'assembleRelease', 'test', 'lint']))
    .optional(),
  maxRetries: z.number().int().min(1).max(5).optional(),
  autoApplyMinConfidence: z.number().int().min(50).max(100).optional(),
});

// POST /api/sessions/:sessionId/gradle-build/auto-loop - Run 10-step Automatic Rebuild & Repair Loop
sessionRouter.post(
  '/:sessionId/gradle-build/auto-loop',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = autoRebuildLoopSchema.safeParse(req.body || {});
    const result = await gradleBuildService.runAutoRebuildLoop(
      req.params.sessionId,
      parsed.success ? parsed.data : {}
    );
    res.json({
      success: true,
      data: result,
    });
  })
);

// GET /api/sessions/:sessionId/gradle-build/download-apk/:apkId - Download verified generated APK
sessionRouter.get(
  '/:sessionId/gradle-build/download-apk/:apkId',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { fullPath, artifact } = await gradleBuildService.getGeneratedApkDownloadPath(
      req.params.sessionId,
      req.params.apkId
    );
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(fullPath);
  })
);

// GET /api/sessions/:sessionId/gradle-build/download-report - Download Phase 4 Build & Repair Report (.md or .json)
sessionRouter.get(
  '/:sessionId/gradle-build/download-report',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const format = req.query.format === 'json' ? 'json' : 'md';
    const { projectName, markdown, json } = await gradleBuildService.generateBuildReportMarkdown(
      req.params.sessionId
    );
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${projectName}-gradle-build-report.json"`
      );
      res.send(JSON.stringify(json, null, 2));
    } else {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${projectName}-gradle-build-report.md"`
      );
      res.send(markdown);
    }
  })
);

// ============================================================================
// PHASE 5: ORIGINAL APK VS RECONSTRUCTED APK COMPARISON & FUNCTIONAL VERIFICATION
// ============================================================================

// GET /api/sessions/:sessionId/apk-comparison - Get cached or run Phase 5 comparison report
sessionRouter.get(
  '/:sessionId/apk-comparison',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const force = req.query.refresh === 'true';
    const report = await apkComparisonService.getOrRunComparison(
      req.params.sessionId,
      force
    );
    res.json({
      success: true,
      data: report,
    });
  })
);

// POST /api/sessions/:sessionId/apk-comparison/run - Execute fresh Phase 5 comparison & functional verification
sessionRouter.post(
  '/:sessionId/apk-comparison/run',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const report = await apkComparisonService.runFullComparison(req.params.sessionId);
    res.json({
      success: true,
      data: report,
    });
  })
);

// POST /api/sessions/:sessionId/apk-comparison/ai-final-repair - Generate AI Final Repair proposals for confirmed differences
sessionRouter.post(
  '/:sessionId/apk-comparison/ai-final-repair',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const proposals = await apkComparisonService.generateFinalRepairProposals(
      req.params.sessionId
    );
    res.json({
      success: true,
      data: proposals,
    });
  })
);

const applyFinalRepairsSchema = z.object({
  proposalIds: z.array(z.string()).min(1, 'At least one proposalId is required'),
  triggerRebuildAfterApply: z.boolean().optional(),
});

// POST /api/sessions/:sessionId/apk-comparison/apply-final-repair - Backup files, apply selected final repairs, and optionally rebuild
sessionRouter.post(
  '/:sessionId/apk-comparison/apply-final-repair',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = applyFinalRepairsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw ApiError.badRequest(
        'Please select at least one AI Final Repair proposal to apply.',
        'INVALID_PROPOSAL_IDS'
      );
    }
    const result = await apkComparisonService.applyFinalRepairs(
      req.params.sessionId,
      parsed.data
    );
    res.json({
      success: true,
      data: result,
    });
  })
);

// GET /api/sessions/:sessionId/apk-comparison/export/:artifactType - Download Phase 5 final exports
sessionRouter.get(
  '/:sessionId/apk-comparison/export/:artifactType',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const allowed: FinalExportArtifactType[] = [
      'comparison-report',
      'missing-components',
      'runtime-report',
      'build-logs',
      'recovery-history',
      'final-apk',
    ];
    const artifactType = req.params.artifactType as FinalExportArtifactType;
    if (!allowed.includes(artifactType)) {
      throw ApiError.badRequest(
        `Invalid export artifact type: ${artifactType}`,
        'INVALID_EXPORT_ARTIFACT'
      );
    }
    const format = req.query.format === 'json' ? 'json' : 'md';
    const exported = await apkComparisonService.generateExportArtifact(
      req.params.sessionId,
      artifactType,
      format
    );
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exported.filename}"`
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    if (exported.filePath) {
      res.sendFile(exported.filePath);
    } else {
      res.send(exported.content || '');
    }
  })
);


// GET /api/sessions/:sessionId/package-info - Get current package name and app metadata
sessionRouter.get(
  '/:sessionId/package-info',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const info = await packageService.getPackageInfo(req.params.sessionId);
    res.json({
      success: true,
      data: info,
    });
  })
);

const renamePackageSchema = z.object({
  newPackageName: z.string().min(3, 'Package name is required'),
  newAppName: z.string().optional(),
  deepRefactorSmali: z.boolean().optional(),
});

// POST /api/sessions/:sessionId/rename-package - Rename package across Manifest, apktool.yml, and optional Smali
sessionRouter.post(
  '/:sessionId/rename-package',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = renamePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        `Invalid package rename payload: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_PACKAGE_RENAME'
      );
    }

    const result = await packageService.renamePackage(req.params.sessionId, parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

// DELETE /api/sessions/:sessionId - Delete session
sessionRouter.delete(
  '/:sessionId',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    await sessionService.deleteSession(req.params.sessionId);
    res.json({
      success: true,
      data: {
        deleted: true,
        sessionId: req.params.sessionId,
      },
    });
  })
);
