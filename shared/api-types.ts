/**
 * Standard API Response Structure
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

/**
 * Health & Tool Status
 */
export interface ToolStatusMap {
  apktool: boolean;
  jadx: boolean;
  zipalign: boolean;
  apksigner: boolean;
  java: boolean;
}

export interface HealthData {
  status: 'healthy' | 'degraded';
  version: string;
  node: string;
  tools: ToolStatusMap;
  toolsAvailable: boolean;
}

/**
 * Upload & Session
 */
export interface UploadInitRequest {
  filename: string;
  size: number;
  chunks: number;
}

export interface UploadInitData {
  sessionId: string;
  chunkSize: number;
}

export type ProcessingStage =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'joining'
  | 'validating'
  | 'apktool'
  | 'jadx'
  | 'manifest'
  | 'ready'
  | 'failed';

export interface SessionMetadata {
  sessionId: string;
  filename: string;
  fileSize: number;
  createdAt: string;
  stage: ProcessingStage;
  error?: string;
  partialJadx?: boolean;
  rebuilt?: boolean;
}

export interface UploadCompleteData {
  sessionId: string;
  filename: string;
  size: number;
  stage: ProcessingStage;
  partialJadx?: boolean;
  treeNodesCount: number;
}

/**
 * File Tree
 */
export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  editable?: boolean;
  binary?: boolean;
  isImage?: boolean;
  children?: TreeNode[];
}

export interface FileTreeData {
  sessionId: string;
  tree: TreeNode[];
  truncated: boolean;
  totalNodes: number;
}

/**
 * File Read / Write
 */
export interface FileData {
  path: string;
  content: string;
  language: string;
  editable: boolean;
  size: number;
  isImage?: boolean;
  mimeType?: string;
}

export interface FileWriteRequest {
  content: string;
}

export interface FileWriteData {
  path: string;
  size: number;
  updatedAt: string;
  manifestRescanned?: boolean;
}

/**
 * Security Findings & Manifest Scanner
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface SecurityFinding {
  id: string;
  title: string;
  category: 'permission' | 'component' | 'flag' | 'storage' | 'network' | 'manifest';
  severity: FindingSeverity;
  description: string;
  evidence: string;
  componentName?: string;
  protectingPermission?: string;
  recommendation: string;
}

export interface ComponentFinding {
  type: 'activity' | 'activity-alias' | 'service' | 'receiver' | 'provider';
  name: string;
  exported: boolean;
  permission?: string;
  hasIntentFilter: boolean;
  severity: FindingSeverity;
  explanation: string;
  recommendation: string;
}

export interface ManifestScannerSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
}

export interface ManifestScanData {
  sessionId: string;
  scannedAt: string;
  summary: ManifestScannerSummary;
  dangerousPermissions: SecurityFinding[];
  exportedComponents: ComponentFinding[];
  applicationFlags: Record<string, boolean | string | number>;
  warnings: SecurityFinding[];
  generalFindings: SecurityFinding[];
}

/**
 * Rebuild & Signing
 */
export interface RebuildData {
  downloadUrl: string;
  filename: string;
  size: number;
  verified: boolean;
  logs?: string[];
}

/**
 * AI Copilot & Surgical Patcher
 */
export interface AiPatchRequest {
  filePath: string;
  fileName: string;
  content: string;
  instruction: string;
  selectedSnippet?: string;
  fileType?: 'smali' | 'xml' | 'java' | 'other';
}

export interface AiPatchAction {
  target: string;
  changeType: 'removed' | 'added' | 'modified' | 'neutralized';
  description: string;
  impactOnDependencies: string;
}

export interface AiPatchResponse {
  originalContent: string;
  modifiedContent: string;
  explanation: string;
  actions: AiPatchAction[];
  integrityVerified: boolean;
  safetyNote: string;
}

/**
 * Project-Wide Multi-File AI Analysis
 */
export interface AiProjectAnalyzeRequest {
  sessionId: string;
  query: string;
}

export interface AiProjectFileProposal {
  filePath: string;
  fileName: string;
  reason: string;
  modifiedContent: string;
  explanation: string;
}

export interface AiProjectSolutionResponse {
  summary: string;
  rootCause: string;
  affectedFiles: AiProjectFileProposal[];
  recommendation: string;
}

/**
 * Package Name Editor / App Cloner
 */
export interface PackageNameInfo {
  packageName: string;
  appName?: string;
  versionName?: string;
  versionCode?: string;
}

export interface RenamePackageRequest {
  newPackageName: string;
  newAppName?: string;
  deepRefactorSmali?: boolean;
}

export interface RenamePackageResponse {
  oldPackageName: string;
  newPackageName: string;
  newAppName?: string;
  updatedFilesCount: number;
  updatedFiles: string[];
}

/**
 * AI Source Code Recovery Module
 */
export interface NativeLibraryInfo {
  name: string;
  path: string;
  architecture: string;
  size: number;
  knownLibrary?: string;
}

export interface DetectedDependency {
  name: string;
  packagePrefix: string;
  category: 'Networking' | 'Analytics' | 'Database' | 'UI' | 'Security' | 'Cloud/Firebase' | 'Injection/Reactive' | 'Kotlin/AndroidX' | 'Other';
  confidence: 'high' | 'medium';
}

export interface ObfuscatedSymbolCandidate {
  filePath: string;
  className: string;
  obfuscationScore: number; // 0-100
  shortIdentifiersCount: number;
  incompleteDecompilation: boolean;
  correspondingSmaliPath?: string;
}

export interface RecoveryArchitectureAudit {
  sessionId: string;
  auditedAt: string;
  packageName: string;
  totalJavaFiles: number;
  totalSmaliFiles: number;
  totalXmlFiles: number;
  totalAssets: number;
  overallObfuscationScore: number; // 0-100
  obfuscationLevel: 'Low' | 'Moderate' | 'High' | 'Heavy (ProGuard/R8)';
  nativeLibraries: NativeLibraryInfo[];
  detectedDependencies: DetectedDependency[];
  obfuscatedCandidates: ObfuscatedSymbolCandidate[];
  packageHierarchy: { packageName: string; classCount: number }[];
  assetsSummary: { path: string; size: number; type: string }[];
  recoveredFilesCount: number;
}

export interface SymbolRenameSuggestion {
  originalName: string;
  suggestedName: string;
  symbolType: 'class' | 'method' | 'field' | 'variable';
  confidence: number;
  reasoning: string;
}

export interface RecoverSourceRequest {
  sessionId: string;
  filePath: string;
  jobId?: string;
  targetLanguage?: 'java' | 'kotlin';
}

export interface RecoverSourceResponse {
  sessionId: string;
  filePath: string;
  fileName: string;
  correspondingSmaliPath?: string;
  hasSmaliReference: boolean;
  originalContent: string;
  analyzedContent: string;
  reconstructedContent: string;
  recoveredFilePath: string;
  obfuscationDetected: boolean;
  incompleteDecompilationFixed: boolean;
  symbolMappings: SymbolRenameSuggestion[];
  crossClassRelationships: string[];
  smaliComparisonNotes: string;
  architectureSummary: string;
  recoveredAt: string;
}

export interface RecoveryJobStatus {
  jobId: string;
  sessionId: string;
  filePath: string;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  stage: string;
  progress: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
  result?: RecoverSourceResponse;
}

export interface ApplyRecoveredSourceRequest {
  sessionId: string;
  filePath: string;
  version: 'analyzed' | 'reconstructed';
  customContent?: string;
}

