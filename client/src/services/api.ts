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
