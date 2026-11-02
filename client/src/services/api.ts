import type {
  ApiResponse,
  ApiErrorResponse,
  HealthData,
  UploadInitRequest,
  UploadInitData,
  UploadCompleteData,
  FileTreeData,
  FileData,
  FileWriteData,
  ManifestScanData,
  RebuildData,
  AiPatchRequest,
  AiPatchResponse,
  AiProjectAnalyzeRequest,
  AiProjectSolutionResponse,
  PackageNameInfo,
  RenamePackageRequest,
  RenamePackageResponse,
  RecoveryArchitectureAudit,
  RecoverSourceRequest,
  RecoverSourceResponse,
  ApplyRecoveredSourceRequest,
  ApplyRecoveredSourceResponse,
  RestoreOriginalSourceRequest,
  BatchRecoveryRequest,
  BatchRecoveryStatus,
  ProjectReconstructionReport,
  GenerateAndroidProjectRequest,
  GradleBuildTestResult,
  GradleBuildStateResponse,
  BuildEnvironmentStatus,
  GradleBuildRun,
  StartGradleBuildRequest,
  AiErrorFixProposal,
  AnalyzeBuildErrorsRequest,
  ApplyBuildFixesRequest,
  ApplyBuildFixesResponse,
  ProjectRepairBackup,
  AutoRebuildLoopRequest,
  AutoRebuildLoopResult,
  FinalComparisonReport,
  AiFinalRepairProposal,
  ApplyFinalRepairsRequest,
  ApplyFinalRepairsResponse,
  FinalExportArtifactType,
} from '../types/index.js';

class ApiService {
  private baseUrl: string;

  constructor() {
    // In browser environments (including GitHub Codespaces *.app.github.dev),
    // always use relative URL so requests hit same-origin /api and route through Vite's local proxy.
    // This completely eliminates cross-origin port 8000 cookie/privacy block in mobile browsers.
    if (typeof window !== 'undefined') {
      this.baseUrl = '';
      return;
    }

    const envUrl = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
    if (envUrl && envUrl.trim() !== '') {
      this.baseUrl = envUrl.replace(/\/+$/, '');
    } else {
      this.baseUrl = '';
    }
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    let json: ApiResponse<T> | ApiErrorResponse;
    try {
      json = await res.json();
    } catch {
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      }
      throw new Error('Invalid JSON response received from server');
    }

    if (json.success) {
      return json.data;
    } else {
      const err = json.error;
      const detailsMsg = err.details && typeof err.details === 'string' ? ` (${err.details})` : '';
      const customErr = new Error(`${err.message}${detailsMsg}`);
      (customErr as unknown as { code: string }).code = err.code;
      throw customErr;
    }
  }

  /**
   * Health check and CLI tools detection
   */
  public async getHealth(): Promise<HealthData> {
    const res = await fetch(`${this.baseUrl}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse<HealthData>(res);
  }

  /**
   * Get Session metadata
   */
  public async getSession(sessionId: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<any>(res);
  }

  /**
   * Upload Session Initialization
   */
  public async initUpload(params: UploadInitRequest): Promise<UploadInitData> {
    const res = await fetch(`${this.baseUrl}/api/uploads/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<UploadInitData>(res);
  }

  /**
   * Upload single chunk
   */
  public async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    chunkBlob: Blob,
    signal?: AbortSignal
  ): Promise<{ sessionId: string; chunkIndex: number; receivedBytes: number }> {
    const formData = new FormData();
    formData.append('file', chunkBlob, `chunk_${chunkIndex}`);

    const res = await fetch(
      `${this.baseUrl}/api/uploads/${encodeURIComponent(sessionId)}/chunks/${chunkIndex}`,
      {
        method: 'PUT',
        body: formData,
        signal,
      }
    );
    return this.handleResponse(res);
  }

  /**
   * Complete upload and trigger decompilation
   */
  public async completeUpload(sessionId: string, signal?: AbortSignal): Promise<UploadCompleteData> {
    const res = await fetch(
      `${this.baseUrl}/api/uploads/${encodeURIComponent(sessionId)}/complete`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal,
      }
    );
    return this.handleResponse<UploadCompleteData>(res);
  }

  /**
   * Get File Tree
   */
  public async getFileTree(sessionId: string): Promise<FileTreeData> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/tree`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<FileTreeData>(res);
  }

  /**
   * Read File
   */
  public async readFile(sessionId: string, relativePath: string): Promise<FileData> {
    const params = new URLSearchParams({ path: relativePath });
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<FileData>(res);
  }

  /**
   * Save File
   */
  public async saveFile(sessionId: string, relativePath: string, content: string): Promise<FileWriteData> {
    const params = new URLSearchParams({ path: relativePath });
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    return this.handleResponse<FileWriteData>(res);
  }

  /**
   * Scan Manifest
   */
  public async scanManifest(sessionId: string): Promise<ManifestScanData> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/scan`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<ManifestScanData>(res);
  }

  /**
   * Rebuild & Sign APK
   */
  public async rebuildApk(sessionId: string): Promise<RebuildData> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/rebuild`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<RebuildData>(res);
  }

  /**
   * Get download URL for signed APK
   */
  public getDownloadUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/download`;
  }

  /**
   * Get download URL for decompiled source code ZIP
   */
  public getSourceDownloadUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/download-source`;
  }

  /**
   * Get download URL for Android Studio Gradle Project ZIP
   */
  public getGradleDownloadUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/download-gradle`;
  }

  /**
   * Get current package name & app info
   */
  public async getPackageInfo(sessionId: string): Promise<PackageNameInfo> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/package-info`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<PackageNameInfo>(res);
  }

  /**
   * Rename package name & app name across project
   */
  public async renamePackage(
    sessionId: string,
    payload: RenamePackageRequest
  ): Promise<RenamePackageResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/rename-package`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    return this.handleResponse<RenamePackageResponse>(res);
  }

  /**
   * Surgical AI Code Transformation
   */
  public async transformFileWithAi(params: AiPatchRequest): Promise<AiPatchResponse> {
    const res = await fetch(`${this.baseUrl}/api/ai/transform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<AiPatchResponse>(res);
  }

  /**
   * Project-Wide Multi-File AI Analysis
   */
  public async analyzeProjectWithAi(params: AiProjectAnalyzeRequest): Promise<AiProjectSolutionResponse> {
    const res = await fetch(`${this.baseUrl}/api/ai/project-analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<AiProjectSolutionResponse>(res);
  }

  /**
   * AI Source Code Recovery: Project Architecture, Obfuscation, Dependencies & Native Audit
   */
  public async getRecoveryAudit(sessionId: string): Promise<RecoveryArchitectureAudit> {
    const res = await fetch(
      `${this.baseUrl}/api/ai/recovery/audit/${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<RecoveryArchitectureAudit>(res);
  }

  /**
   * Get existing saved recovery artifact for a file (for resuming/inspecting)
   */
  public async getSavedRecoveryForFile(
    sessionId: string,
    filePath: string
  ): Promise<RecoverSourceResponse | null> {
    const params = new URLSearchParams({ path: filePath });
    const res = await fetch(
      `${this.baseUrl}/api/ai/recovery/file/${encodeURIComponent(sessionId)}?${params.toString()}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<RecoverSourceResponse | null>(res);
  }

  /**
   * Run AI Source Code Recovery & De-obfuscation on a file (supports AbortSignal cancellation)
   */
  public async recoverFileSource(
    params: RecoverSourceRequest,
    signal?: AbortSignal
  ): Promise<RecoverSourceResponse> {
    const res = await fetch(`${this.baseUrl}/api/ai/recovery/recover-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
      signal,
    });
    return this.handleResponse<RecoverSourceResponse>(res);
  }

  /**
   * Cancel an active recovery job on the backend
   */
  public async cancelRecoveryJob(jobId: string): Promise<{ cancelled: boolean; jobId: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/ai/recovery/cancel/${encodeURIComponent(jobId)}`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<{ cancelled: boolean; jobId: string }>(res);
  }

  /**
   * Explicitly apply a recovered version (analyzed or reconstructed) to the target file
   * while backing up the original decompiled file
   */
  public async applyRecoveredSource(
    params: ApplyRecoveredSourceRequest
  ): Promise<ApplyRecoveredSourceResponse> {
    const res = await fetch(`${this.baseUrl}/api/ai/recovery/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<ApplyRecoveredSourceResponse>(res);
  }

  /**
   * Restore original decompiled source from backup
   */
  public async restoreOriginalSource(
    params: RestoreOriginalSourceRequest
  ): Promise<{ restoredPath: string; content: string }> {
    const res = await fetch(`${this.baseUrl}/api/ai/recovery/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<{ restoredPath: string; content: string }>(res);
  }

  /**
   * Run Batch AI Source Code Recovery across multiple obfuscated classes
   */
  public async runBatchRecovery(params: BatchRecoveryRequest): Promise<BatchRecoveryStatus> {
    const res = await fetch(`${this.baseUrl}/api/ai/recovery/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<BatchRecoveryStatus>(res);
  }

  /**
   * Phase 3: Get existing Android Studio Project Reconstruction report
   */
  public async getProjectReconstructionReport(
    sessionId: string
  ): Promise<ProjectReconstructionReport | null> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/project-reconstruct`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<ProjectReconstructionReport | null>(res);
  }

  /**
   * Phase 3: Generate / Reconstruct Complete Android Studio Project
   */
  public async reconstructAndroidStudioProject(
    params: GenerateAndroidProjectRequest
  ): Promise<ProjectReconstructionReport> {
    const { sessionId, ...body } = params;
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/project-reconstruct`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    return this.handleResponse<ProjectReconstructionReport>(res);
  }

  /**
   * Phase 3: Run Gradle Validation & Compilation Build Test
   */
  public async runGradleBuildTest(sessionId: string): Promise<GradleBuildTestResult> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/project-reconstruct/build-test`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<GradleBuildTestResult>(res);
  }

  /**
   * Phase 3: Download URL for Reconstruction Report (.md or .json)
   */
  public getReconstructionReportDownloadUrl(
    sessionId: string,
    format: 'md' | 'json' = 'md'
  ): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/project-reconstruct/download-report?format=${format}`;
  }

  /**
   * Phase 3: Download URL for Standalone Reconstructed Sources ZIP
   */
  public getReconstructedSourcesDownloadUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/project-reconstruct/download-reconstructed-src`;
  }

  /**
   * Phase 4: Get full Gradle Build, Error Analysis, Fixes, Backups & APK state
   */
  public async getGradleBuildState(sessionId: string): Promise<GradleBuildStateResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/state`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<GradleBuildStateResponse>(res);
  }

  /**
   * Phase 4: Inspect Build Environment (JDK, Gradle Wrapper, Android SDK, AGP)
   */
  public async getGradleBuildEnvironment(sessionId: string): Promise<BuildEnvironmentStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/environment`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<BuildEnvironmentStatus>(res);
  }

  /**
   * Phase 4: Get SSE Live Build Stream URL
   */
  public getGradleBuildStreamUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/stream`;
  }

  /**
   * Phase 4: Start Gradle Build with allowlisted tasks
   */
  public async startGradleBuild(
    sessionId: string,
    params: StartGradleBuildRequest
  ): Promise<GradleBuildRun> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      }
    );
    return this.handleResponse<GradleBuildRun>(res);
  }

  /**
   * Phase 4: Cancel a running Gradle Build or Auto-Rebuild Loop
   */
  public async cancelGradleBuild(
    sessionId: string,
    buildId: string
  ): Promise<{ cancelled: boolean; buildId: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/${encodeURIComponent(buildId)}/cancel`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<{ cancelled: boolean; buildId: string }>(res);
  }

  /**
   * Phase 4: Run AI Error Analysis on detected build errors
   */
  public async analyzeGradleBuildErrors(
    sessionId: string,
    params: AnalyzeBuildErrorsRequest = {}
  ): Promise<AiErrorFixProposal[]> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/analyze-errors`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      }
    );
    return this.handleResponse<AiErrorFixProposal[]>(res);
  }

  /**
   * Phase 4: Create backup and apply selected AI Code Repair fixes
   */
  public async applyGradleBuildFixes(
    sessionId: string,
    params: ApplyBuildFixesRequest
  ): Promise<ApplyBuildFixesResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/apply-fixes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      }
    );
    return this.handleResponse<ApplyBuildFixesResponse>(res);
  }

  /**
   * Phase 4: Rollback a repair backup
   */
  public async rollbackGradleBuildBackup(
    sessionId: string,
    backupId: string
  ): Promise<{ restoredBackup: ProjectRepairBackup; restoredFiles: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/rollback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ backupId }),
      }
    );
    return this.handleResponse<{ restoredBackup: ProjectRepairBackup; restoredFiles: string[] }>(res);
  }

  /**
   * Phase 4: Run Automatic 10-Step Rebuild & AI Repair Loop
   */
  public async runAutoRebuildLoop(
    sessionId: string,
    params: AutoRebuildLoopRequest = {}
  ): Promise<AutoRebuildLoopResult> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/auto-loop`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      }
    );
    return this.handleResponse<AutoRebuildLoopResult>(res);
  }

  /**
   * Phase 4: Download URL for verified generated APK artifact
   */
  public getGeneratedApkDownloadUrl(sessionId: string, apkId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/download-apk/${encodeURIComponent(apkId)}`;
  }

  /**
   * Phase 4: Download URL for Gradle Build & Repair Report (.md or .json)
   */
  public getGradleBuildReportDownloadUrl(
    sessionId: string,
    format: 'md' | 'json' = 'md'
  ): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/gradle-build/download-report?format=${format}`;
  }

  /**
   * Phase 5: Get or run Original APK vs Reconstructed APK Comparison & Functional Verification report
   */
  public async getApkComparisonReport(
    sessionId: string,
    refresh = false
  ): Promise<FinalComparisonReport> {
    const query = refresh ? '?refresh=true' : '';
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/apk-comparison${query}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<FinalComparisonReport>(res);
  }

  /**
   * Phase 5: Execute fresh Original APK vs Reconstructed APK Comparison & Functional Verification
   */
  public async runApkComparison(sessionId: string): Promise<FinalComparisonReport> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/apk-comparison/run`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<FinalComparisonReport>(res);
  }

  /**
   * Phase 5: Generate AI-Assisted Final Repair proposals for confirmed differences
   */
  public async generateAiFinalRepairs(
    sessionId: string
  ): Promise<AiFinalRepairProposal[]> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/apk-comparison/ai-final-repair`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<AiFinalRepairProposal[]>(res);
  }

  /**
   * Phase 5: Backup files, apply selected Final Repair proposals, and optionally trigger Gradle rebuild
   */
  public async applyFinalRepairs(
    sessionId: string,
    params: ApplyFinalRepairsRequest
  ): Promise<ApplyFinalRepairsResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/apk-comparison/apply-final-repair`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
      }
    );
    return this.handleResponse<ApplyFinalRepairsResponse>(res);
  }

  /**
   * Phase 5: Get Download URL for Final Export Artifacts
   * ('comparison-report' | 'missing-components' | 'runtime-report' | 'build-logs' | 'recovery-history' | 'final-apk')
   */
  public getFinalExportDownloadUrl(
    sessionId: string,
    artifactType: FinalExportArtifactType,
    format: 'md' | 'json' = 'md'
  ): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/apk-comparison/export/${encodeURIComponent(artifactType)}?format=${format}`;
  }

  /**
   * Phase 6: List All Recovery Sessions with search and filters
   */
  public async listSessions(params?: {
    search?: string;
    status?: string;
    includeArchived?: boolean;
  }): Promise<{ sessions: import('@android-re/shared').RecoverySessionListItem[]; totalCount: number }> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.includeArchived) query.set('includeArchived', 'true');

    const res = await fetch(`${this.baseUrl}/api/sessions?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse<{ sessions: import('@android-re/shared').RecoverySessionListItem[]; totalCount: number }>(res);
  }

  /**
   * Phase 6: Storage Environment Diagnostics
   */
  public async getStorageInfo(): Promise<import('@android-re/shared').StorageEnvironmentInfo> {
    const res = await fetch(`${this.baseUrl}/api/sessions/storage/info`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse<import('@android-re/shared').StorageEnvironmentInfo>(res);
  }

  /**
   * Phase 6: Detailed Session Summary
   */
  public async getSessionSummary(sessionId: string): Promise<{
    session: any;
    stageInfo: any;
    stats: { sizeBytes: number; fileCount: number };
    versions: import('@android-re/shared').SessionVersionSnapshot[];
  }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/summary`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse(res);
  }

  /**
   * Phase 6: Resume Session
   */
  public async resumeSession(sessionId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse(res);
  }

  /**
   * Phase 6: Rename Session
   */
  public async renameSession(sessionId: string, displayName: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ displayName }),
    });
    return this.handleResponse(res);
  }

  /**
   * Phase 6: Archive / Unarchive Session
   */
  public async archiveSession(sessionId: string, isArchived: boolean): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ isArchived }),
    });
    return this.handleResponse(res);
  }

  /**
   * Phase 6: Duplicate Session
   */
  public async duplicateSession(sessionId: string, displayName?: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ displayName }),
    });
    return this.handleResponse(res);
  }

  /**
   * Phase 6: Get Session Manifest
   */
  public async getSessionManifest(sessionId: string): Promise<import('@android-re/shared').RecoverySessionManifest> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/manifest`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse<import('@android-re/shared').RecoverySessionManifest>(res);
  }

  /**
   * Phase 6: Get Session Export Bundle URL (.zip)
   */
  public getSessionExportBundleUrl(sessionId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/export-bundle`;
  }

  /**
   * Phase 6: List Version Snapshots
   */
  public async listSnapshots(sessionId: string): Promise<import('@android-re/shared').SessionVersionSnapshot[]> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return this.handleResponse<import('@android-re/shared').SessionVersionSnapshot[]>(res);
  }

  /**
   * Phase 6: Create Version Snapshot
   */
  public async createSnapshot(
    sessionId: string,
    params: import('@android-re/shared').CreateVersionSnapshotRequest
  ): Promise<import('@android-re/shared').SessionVersionSnapshot> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    return this.handleResponse<import('@android-re/shared').SessionVersionSnapshot>(res);
  }

  /**
   * Phase 6: Restore Version Snapshot
   */
  public async restoreSnapshot(
    sessionId: string,
    snapshotId: string
  ): Promise<{ restoredSnapshot: import('@android-re/shared').SessionVersionSnapshot; backupSnapshotId: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<{ restoredSnapshot: import('@android-re/shared').SessionVersionSnapshot; backupSnapshotId: string }>(res);
  }

  /**
   * Phase 6: Diff Snapshot with Current State
   */
  public async getSnapshotDiff(
    sessionId: string,
    snapshotId: string
  ): Promise<import('@android-re/shared').VersionDiffResult> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}/diff`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse<import('@android-re/shared').VersionDiffResult>(res);
  }

  /**
   * Phase 6: Get Snapshot Download URL
   */
  public getSnapshotDownloadUrl(sessionId: string, snapshotId: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}/download`;
  }

  /**
   * Phase 6: Import Full Session Bundle (.zip)
   */
  public async importSessionBundle(bundleFile: File): Promise<import('@android-re/shared').SessionImportResponse> {
    const formData = new FormData();
    formData.append('bundle', bundleFile);

    const res = await fetch(`${this.baseUrl}/api/sessions/import-bundle`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    return this.handleResponse<import('@android-re/shared').SessionImportResponse>(res);
  }

  /**
   * Delete Session
   */
  public async deleteSession(sessionId: string): Promise<{ deleted: boolean; sessionId: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      }
    );
    return this.handleResponse(res);
  }
}

export const api = new ApiService();

