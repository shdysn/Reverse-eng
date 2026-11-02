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
  classCategory?: 'obfuscated' | 'synthetic' | 'anonymous_inner' | 'clear';
  unusualControlFlow?: boolean;
}

export interface TokenUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedHits: number;
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
  packageHierarchy: { packageName: string; classCount: number; unclearStructure?: boolean }[];
  assetsSummary: { path: string; size: number; type: string }[];
  recoveredFilesCount: number;
  syntheticClassesCount?: number;
  anonymousInnerClassesCount?: number;
  indexedClassesCount?: number;
  tokenUsage?: TokenUsageStats;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SymbolRenameSuggestion {
  id?: string;
  originalName: string;
  suggestedName: string;
  symbolType: 'class' | 'method' | 'field' | 'variable' | 'package';
  confidence: number; // 0-100
  confidenceLevel: ConfidenceLevel;
  reasoning: string;
  evidenceFromReferences: string;
  sourceFile: string;
  methodSignature?: string;
  unsafeToRenameExternally?: boolean;
  unsafeReason?: string; // e.g. 'Manifest Component', 'JNI Native', 'Reflection Target', 'Serialization @SerializedName', 'XML onClick'
}

export interface JadxSmaliMethodMapping {
  jadxMethodSignature: string;
  smaliDirectivesSignature: string;
  dexDescriptor: string;
  returnType: string;
  parameterTypes: string[];
  jadxComplete: boolean;
  reconstructedFromSmali: boolean;
  controlFlowNote?: string;
}

export interface RecoveryValidationCheck {
  checkName:
    | 'Java/Kotlin Syntax'
    | 'Class References'
    | 'Method Signatures'
    | 'Smali Mapping'
    | 'Package Consistency'
    | 'Resource References'
    | 'Dependency Compatibility';
  passed: boolean;
  details: string;
}

export interface RecoveryValidationReport {
  overallPassed: boolean;
  passedCount: number;
  totalChecks: number;
  checks: RecoveryValidationCheck[];
  unresolvedIssues: string[];
}

export interface RecoverSourceRequest {
  sessionId: string;
  filePath: string;
  jobId?: string;
  targetLanguage?: 'java' | 'kotlin';
  forceReanalyze?: boolean;
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
  methodMappings?: JadxSmaliMethodMapping[];
  validationReport?: RecoveryValidationReport;
  duplicatedLogicNotes?: string[];
  missingFunctionalityNotes?: string[];
  crossClassRelationships: string[];
  smaliComparisonNotes: string;
  architectureSummary: string;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; cached: boolean };
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
  acceptedSymbolIds?: string[];
  propagateCrossFileReferences?: boolean;
}

export interface ApplyRecoveredSourceResponse {
  savedPath: string;
  backupPath: string;
  propagatedFilesCount: number;
  propagatedFiles: string[];
  skippedUnsafeSymbols: { symbol: string; reason: string }[];
}

export interface RestoreOriginalSourceRequest {
  sessionId: string;
  filePath: string;
}

export interface BatchRecoveryRequest {
  sessionId: string;
  filePaths: string[];
  targetLanguage?: 'java' | 'kotlin';
}

export interface BatchRecoveryStatus {
  batchId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  results: { filePath: string; success: boolean; validationPassed: boolean; cached: boolean; error?: string }[];
  totalTokensUsed: number;
}

/**
 * Phase 3: Complete Android Studio Project Reconstruction
 */
export interface RestoredGradleDependency {
  group: string;
  artifact: string;
  version: string;
  coordinate: string; // e.g. "com.squareup.okhttp3:okhttp:4.11.0"
  category: string;
  versionSource: 'recovered-from-apk' | 'compatible-assumption';
  evidence: string;
  assumptionNote?: string;
}

export interface RecoveredAndroidConfig {
  applicationId: string;
  namespace: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  sdkSource: 'apktool-yml' | 'manifest' | 'compatible-default';
  applicationClass?: string;
  permissions: string[];
  activities: string[];
  services: string[];
  receivers: string[];
  providers: string[];
  deepLinks: { scheme: string; host?: string; pathPrefix?: string; component: string }[];
  metaData: { name: string; value: string }[];
  networkSecurityConfig?: string;
  usesCleartextTraffic?: boolean;
  kotlinDetected: boolean;
  agpVersion: string;
  gradleVersion: string;
  kotlinVersion?: string;
  javaCompatibility: string;
}

export interface RestoredResourceSummary {
  totalFilesRestored: number;
  categories: {
    layouts: number;
    drawables: number;
    mipmaps: number;
    values: number;
    animations: number;
    menus: number;
    fonts: number;
    raw: number;
    xml: number;
    other: number;
  };
  assetsCount: number;
  resolvedConflicts: string[];
}

export interface NativeLibraryRestorationInfo {
  abiFolders: string[];
  restoredLibraries: { abi: string; fileName: string; size: number; relativePath: string }[];
  referencedByLoadLibrary: string[];
  missingNativeLibraries: string[];
}

export interface ProjectValidationItem {
  id: string;
  category:
    | 'Project Structure'
    | 'Source File Paths'
    | 'Package Declarations'
    | 'Imports'
    | 'Missing Classes'
    | 'Resource References'
    | 'Dependency Declarations'
    | 'Manifest Consistency'
    | 'Native Library Paths'
    | 'Gradle Configuration';
  passed: boolean;
  severity: 'ok' | 'warning' | 'blocker';
  details: string;
}

export interface UnrecoveredClassEntry {
  className: string;
  originalPath: string;
  reason: string;
  unresolvedMethods: string[];
  actionTaken: 'sanitized-stub' | 'excluded-third-party-sdk' | 'smali-only-missing-java';
}

export interface ProjectVersionSnapshot {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  projectDirPath: string;
  reconstructedSourcesUsed: number;
  totalJavaKotlinFiles: number;
  validationPassedCount: number;
}

export interface GradleBuildTestResult {
  testedAt: string;
  executed: boolean;
  status: 'compiled_success' | 'compile_failed' | 'not_compiled_missing_sdk' | 'not_compiled_missing_gradle';
  gradleAvailable: boolean;
  androidSdkAvailable: boolean;
  javaAvailable: boolean;
  commandRun?: string;
  exitCode?: number | null;
  summary: string;
  logs: string[];
  errors: string[];
}

export interface ProjectReconstructionReport {
  sessionId: string;
  projectName: string;
  versionId: string;
  generatedAt: string;
  projectRootRelativePath: string;
  directories: {
    originalDecompiledDir: string;
    aiAnalyzedDir: string;
    reconstructedProjectDir: string;
  };
  androidConfig: RecoveredAndroidConfig;
  sourceIntegration: {
    totalAppClasses: number;
    aiReconstructedFilesUsed: number;
    aiReconstructedFilesList: string[];
    cleanJadxFilesUsed: number;
    sanitizedJadxFilesCount: number;
    excludedThirdPartySdkFilesCount: number;
    unrecoveredClasses: UnrecoveredClassEntry[];
  };
  resources: RestoredResourceSummary;
  dependencies: RestoredGradleDependency[];
  nativeSupport: NativeLibraryRestorationInfo;
  validation: {
    overallValid: boolean;
    passedCount: number;
    totalChecks: number;
    checks: ProjectValidationItem[];
    configurationAssumptions: string[];
    potentialBuildBlockers: string[];
  };
  projectStructurePreview: {
    path: string;
    type: 'file' | 'directory';
    description?: string;
  }[];
  versions: ProjectVersionSnapshot[];
  lastBuildTest?: GradleBuildTestResult;
}

export interface GenerateAndroidProjectRequest {
  sessionId: string;
  useKotlinDsl?: boolean;
  prioritizeReconstructed?: boolean;
  sanitizeUnrecoveredMethods?: boolean;
  excludeThirdPartySdkSources?: boolean;
}

/**
 * Phase 4: Automatic Gradle Build, Error Detection, and AI-Powered Code Repair
 */
export type GradleTaskName = 'clean' | 'assembleDebug' | 'assembleRelease' | 'test' | 'lint';

export type BuildErrorCategory =
  | 'java_compilation'
  | 'kotlin_compilation'
  | 'missing_dependency'
  | 'incorrect_import'
  | 'missing_class'
  | 'unresolved_reference'
  | 'manifest_error'
  | 'resource_linking'
  | 'duplicate_class'
  | 'sdk_compatibility'
  | 'gradle_configuration'
  | 'native_library_conflict'
  | 'dex_packaging'
  | 'environment_missing'
  | 'unknown';

export type GradleBuildStage =
  | 'initializing'
  | 'environment_check'
  | 'validating_config'
  | 'executing_gradle'
  | 'error_detection'
  | 'verifying_apk'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'environment_blocked';

export type GradleBuildOutcomeStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'environment_missing'
  | 'partially_recovered'
  | 'unresolved_errors';

export interface BuildEnvironmentStatus {
  checkedAt: string;
  osPlatform: string;
  projectExists: boolean;
  projectRootPath: string;
  gradleWrapperAvailable: boolean;
  gradleWrapperJarAvailable: boolean;
  gradleCliAvailable: boolean;
  gradleVersion?: string;
  javaAvailable: boolean;
  javacAvailable: boolean;
  javaVersion?: string;
  javaHome?: string;
  androidSdkAvailable: boolean;
  androidSdkPath?: string;
  buildToolsAvailable: boolean;
  platformsInstalled: string[];
  agpVersion: string;
  agpCompatible: boolean;
  agpCompatibilityNote: string;
  availableTasks: GradleTaskName[];
  missingComponents: string[];
  setupInstructions: string[];
  canExecuteFullGradleBuild: boolean;
}

export interface DetectedBuildError {
  id: string;
  category: BuildErrorCategory;
  categoryLabel: string;
  severity: 'error' | 'warning';
  filePath?: string; // relative to android-studio-project
  line?: number;
  column?: number;
  message: string;
  rawOutput: string;
  codeSnippet?: string;
  sourceOrigin?: 'gradle_compiler' | 'static_verifier';
}

export interface AiErrorFixProposal {
  id: string;
  errorId: string;
  category: BuildErrorCategory;
  categoryLabel: string;
  rootCause: string;
  affectedFilePath: string; // relative to android-studio-project
  relatedFiles: string[];
  jadxEvidenceSummary: string;
  smaliEvidenceSummary: string;
  originalSnippet: string;
  replacementSnippet: string;
  startLine?: number;
  endLine?: number;
  explanation: string;
  confidenceScore: number; // 0-100
  confidenceLevel: ConfidenceLevel;
  isMinimalPatch: boolean;
  validationChecks: {
    importsValid: boolean;
    referencesValid: boolean;
    dependenciesChecked: boolean;
    unrelatedCodePreserved: boolean;
    details: string;
  };
  status: 'pending' | 'approved' | 'applied' | 'rejected' | 'rolled_back' | 'failed';
  createdAt: string;
  appliedAt?: string;
  backupId?: string;
}

export interface ProjectRepairBackup {
  backupId: string;
  createdAt: string;
  reason: string;
  modifiedFiles: string[];
  fixIds: string[];
  restored?: boolean;
  restoredAt?: string;
}

export interface GeneratedApkArtifact {
  id: string;
  variant: 'debug' | 'release' | 'other';
  filename: string;
  relativePath: string;
  sizeBytes: number;
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  verifiedZipStructure: boolean;
  hasAndroidManifest: boolean;
  hasClassesDex: boolean;
  dexCount: number;
  nativeLibrariesCount: number;
  createdAt: string;
}

export interface GradleBuildRun {
  buildId: string;
  sessionId: string;
  tasks: GradleTaskName[];
  command: string;
  workingDirectory: string;
  stage: GradleBuildStage;
  status: GradleBuildOutcomeStatus;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  exitCode: number | null;
  logs: string[];
  errors: DetectedBuildError[];
  warnings: DetectedBuildError[];
  environment: BuildEnvironmentStatus;
  apkArtifacts: GeneratedApkArtifact[];
  apkVerification: {
    verified: boolean;
    gradleExitedZero: boolean;
    apkExistsOnDisk: boolean;
    apkNonEmpty: boolean;
    zipStructureValid: boolean;
    packageInfoVerified: boolean;
    details: string;
  };
  summary: string;
}

export interface AutoRebuildIteration {
  attempt: number;
  buildId: string;
  status: GradleBuildOutcomeStatus;
  errorsDetected: number;
  errorsAnalyzed: number;
  fixesGenerated: number;
  fixesValidated: number;
  fixesApplied: string[];
  backupId?: string;
  remainingErrors: number;
  summary: string;
}

export interface AutoRebuildLoopResult {
  loopId: string;
  sessionId: string;
  tasks: GradleTaskName[];
  maxRetries: number;
  attemptsUsed: number;
  startedAt: string;
  completedAt: string;
  finalStatus: GradleBuildOutcomeStatus;
  iterations: AutoRebuildIteration[];
  finalBuildRun: GradleBuildRun;
  allProposals: AiErrorFixProposal[];
  unresolvedReasons: string[];
  summary: string;
}

export interface GradleBuildStateResponse {
  sessionId: string;
  environment: BuildEnvironmentStatus;
  currentBuild: GradleBuildRun | null;
  buildHistory: GradleBuildRun[];
  fixProposals: AiErrorFixProposal[];
  backups: ProjectRepairBackup[];
  apkArtifacts: GeneratedApkArtifact[];
  lastAutoLoop: AutoRebuildLoopResult | null;
}

export interface StartGradleBuildRequest {
  tasks: GradleTaskName[];
  runStaticCompilerCheck?: boolean;
}

export interface AnalyzeBuildErrorsRequest {
  buildId?: string;
  errorIds?: string[];
}

export interface ApplyBuildFixesRequest {
  fixIds: string[];
}

export interface ApplyBuildFixesResponse {
  backup: ProjectRepairBackup;
  appliedFixes: AiErrorFixProposal[];
  skippedFixes: { fixId: string; reason: string }[];
}

export interface RollbackBuildBackupRequest {
  backupId: string;
}

export interface AutoRebuildLoopRequest {
  tasks?: GradleTaskName[];
  maxRetries?: number;
  autoApplyMinConfidence?: number;
}

/**
 * Phase 5: Original APK vs Reconstructed APK Comparison and Functional Verification
 */
export type VerificationCheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_TESTED';

export interface MetadataFieldComparison {
  field: string;
  label: string;
  originalValue: string | string[];
  reconstructedValue: string | string[];
  status: VerificationCheckStatus;
  missingInReconstructed: string[];
  addedInReconstructed: string[];
  notes: string;
}

export interface MetadataComparisonReport {
  status: VerificationCheckStatus;
  originalSource: string;
  reconstructedSource: string;
  fields: MetadataFieldComparison[];
  summary: {
    totalFields: number;
    passedCount: number;
    warningCount: number;
    failedCount: number;
  };
}

export type ResourceCategoryKey =
  | 'drawable'
  | 'mipmap'
  | 'layout'
  | 'strings'
  | 'colors'
  | 'dimensions'
  | 'themes'
  | 'fonts'
  | 'animations'
  | 'assets'
  | 'raw';

export interface ResourceCategorySummary {
  category: ResourceCategoryKey;
  label: string;
  originalCount: number;
  reconstructedCount: number;
  matchedCount: number;
  missingCount: number;
  modifiedCount: number;
  newlyGeneratedCount: number;
  duplicateCount: number;
  namingDiffCount: number;
  status: VerificationCheckStatus;
}

export interface ResourceDifferenceItem {
  category: ResourceCategoryKey;
  type: 'missing' | 'modified' | 'newly_generated' | 'duplicate' | 'naming_difference';
  resourceName: string;
  originalPath?: string;
  reconstructedPath?: string;
  details: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ResourceComparisonReport {
  status: VerificationCheckStatus;
  categories: ResourceCategorySummary[];
  differences: ResourceDifferenceItem[];
  totals: {
    originalTotal: number;
    reconstructedTotal: number;
    missingCount: number;
    modifiedCount: number;
    newlyGeneratedCount: number;
    duplicateCount: number;
    namingDiffCount: number;
  };
}

export interface ClassStructuralComparison {
  className: string;
  reconstructedClassName?: string;
  packageName: string;
  role: 'activity' | 'fragment' | 'service' | 'receiver' | 'provider' | 'database' | 'network' | 'model_or_util';
  originalOrigin: 'jadx_and_smali' | 'jadx_only' | 'smali_only';
  reconstructedLanguage: 'java' | 'kotlin' | 'missing';
  isObfuscatedOriginal: boolean;
  isCompilerGenerated: boolean;
  originalMethodsCount: number;
  reconstructedMethodsCount: number;
  matchedMethodSignatures: number;
  missingMethodSignatures: string[];
  originalFieldsCount: number;
  reconstructedFieldsCount: number;
  matchedFieldDeclarations: number;
  methodReferencesPreserved: boolean;
  classDependenciesPreserved: boolean;
  status: VerificationCheckStatus;
  notes: string;
}

export interface SourceCodeComparisonReport {
  status: VerificationCheckStatus;
  metrics: {
    originalAppClasses: number;
    reconstructedAppClasses: number;
    compilerGeneratedIgnored: number;
    obfuscatedClassesMapped: number;
    javaToKotlinConverted: number;
    originalMethodsTotal: number;
    reconstructedMethodsTotal: number;
    matchedMethodSignaturesTotal: number;
    originalFieldsTotal: number;
    reconstructedFieldsTotal: number;
    matchedFieldsTotal: number;
    packagesOriginal: string[];
    packagesReconstructed: string[];
    databaseClassesOriginal: string[];
    databaseClassesReconstructed: string[];
    networkInterfacesOriginal: string[];
    networkInterfacesReconstructed: string[];
    activitiesAndFragmentsOriginal: string[];
    activitiesAndFragmentsReconstructed: string[];
  };
  classComparisons: ClassStructuralComparison[];
  unrecoveredClasses: string[];
  unrecoveredMethods: { className: string; methodSignature: string; reason: string }[];
}

export type FunctionalDomainKey =
  | 'app_startup'
  | 'authentication'
  | 'navigation'
  | 'database_operations'
  | 'api_communication'
  | 'file_handling'
  | 'notifications'
  | 'background_services'
  | 'camera_functionality'
  | 'permissions_handling'
  | 'custom_features';

export interface FunctionalCapabilityItem {
  domain: FunctionalDomainKey;
  label: string;
  presentInOriginal: boolean;
  preservedInReconstructed: boolean;
  verificationBasis: 'verified_runtime' | 'inferred_from_source' | 'not_applicable';
  status: VerificationCheckStatus;
  originalEvidence: string[];
  reconstructedEvidence: string[];
  missingElements: string[];
  notes: string;
}

export interface FunctionalityAnalysisReport {
  status: VerificationCheckStatus;
  capabilities: FunctionalCapabilityItem[];
  summary: {
    applicableDomains: number;
    preservedDomains: number;
    verifiedRuntimeCount: number;
    inferredFromSourceCount: number;
    warningsCount: number;
    failedCount: number;
  };
}

export interface LayoutScreenComparison {
  layoutName: string;
  originalPath: string;
  reconstructedPath?: string;
  associatedComponent?: string;
  originalViewTags: string[];
  reconstructedViewTags: string[];
  originalViewIds: string[];
  reconstructedViewIds: string[];
  missingViewIds: string[];
  textReferencesMatched: boolean;
  iconReferencesMatched: boolean;
  colorReferencesMatched: boolean;
  navigationBindingsPreserved: boolean;
  emulatorScreenshotCaptured: boolean;
  status: VerificationCheckStatus;
  differences: string[];
}

export interface UiComparisonReport {
  status: VerificationCheckStatus;
  emulatorAvailable: boolean;
  emulatorDiagnostic: string;
  liveScreenCaptureStatus: VerificationCheckStatus;
  staticXmlComparisonStatus: VerificationCheckStatus;
  screens: LayoutScreenComparison[];
  summary: {
    totalLayouts: number;
    matchedLayouts: number;
    modifiedLayouts: number;
    missingLayouts: number;
  };
}

export interface RuntimeTestStepResult {
  stepId: string;
  name: string;
  status: VerificationCheckStatus;
  executedOnDevice: boolean;
  details: string;
  logcatExcerpt?: string[];
}

export interface AutomatedTestingReport {
  status: VerificationCheckStatus;
  testedAt: string;
  adbAvailable: boolean;
  connectedDevices: string[];
  isolatedEnvironmentReady: boolean;
  originalApkInstalled: boolean;
  reconstructedApkAvailable: boolean;
  reconstructedApkPath?: string;
  reconstructedApkInstalled: boolean;
  steps: RuntimeTestStepResult[];
  detectedRuntimeExceptions: string[];
  missingRuntimeClassesOrResources: string[];
  logcatOutput: string[];
  summary: string;
}

export interface ScoreMetricDetail {
  key:
    | 'metadataSimilarity'
    | 'resourceSimilarity'
    | 'sourceStructureSimilarity'
    | 'uiSimilarity'
    | 'runtimeTestCoverage'
    | 'functionalVerification';
  label: string;
  score: number | null; // 0-100 or null when NOT_TESTED
  status: VerificationCheckStatus;
  verificationBasis: 'static_evidence' | 'runtime_evidence' | 'inferred_source_evidence' | 'not_tested';
  formulaExplanation: string;
  evidenceSummary: string;
}

export interface FunctionalityScoresBreakdown {
  disclaimer: string;
  metadataSimilarity: ScoreMetricDetail;
  resourceSimilarity: ScoreMetricDetail;
  sourceStructureSimilarity: ScoreMetricDetail;
  uiSimilarity: ScoreMetricDetail;
  runtimeTestCoverage: ScoreMetricDetail;
  functionalVerification: ScoreMetricDetail;
}

export interface AiFinalRepairProposal {
  id: string;
  sourceSection: 'metadata' | 'resources' | 'source_code' | 'functionality' | 'ui';
  issueTitle: string;
  rootCause: string;
  affectedFilePath: string; // relative to android-studio-project
  originalDecompiledEvidence: string;
  originalSnippet: string;
  replacementSnippet: string;
  explanation: string;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  status: 'pending' | 'approved' | 'applied' | 'rejected' | 'failed';
  backupId?: string;
  createdAt: string;
  appliedAt?: string;
}

export type FinalExportArtifactType =
  | 'comparison-report'
  | 'missing-components'
  | 'runtime-report'
  | 'build-logs'
  | 'recovery-history'
  | 'final-apk';

export interface FinalComparisonReport {
  sessionId: string;
  projectName: string;
  generatedAt: string;
  overallStatus: VerificationCheckStatus;
  originalApkInfo: {
    path: string;
    exists: boolean;
    sizeBytes: number;
  };
  reconstructedApkInfo: {
    path: string;
    source: 'gradle_build' | 'apktool_rebuild' | 'project_sources_only';
    exists: boolean;
    sizeBytes: number;
  };
  scores: FunctionalityScoresBreakdown;
  metadataComparison: MetadataComparisonReport;
  resourceComparison: ResourceComparisonReport;
  sourceCodeComparison: SourceCodeComparisonReport;
  functionalityAnalysis: FunctionalityAnalysisReport;
  uiComparison: UiComparisonReport;
  automatedTesting: AutomatedTestingReport;
  missingComponents: {
    category: string;
    identifier: string;
    impact: string;
    status: VerificationCheckStatus;
  }[];
  reconstructedComponents: {
    category: string;
    identifier: string;
    sourceOrigin: string;
    status: VerificationCheckStatus;
  }[];
  unresolvedIssues: {
    id: string;
    category: string;
    severity: 'FAIL' | 'WARNING';
    description: string;
    affectedPath?: string;
  }[];
  recommendedFixes: {
    id: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    action: string;
    targetFile?: string;
  }[];
  aiFinalRepairProposals: AiFinalRepairProposal[];
}

export interface ApplyFinalRepairsRequest {
  proposalIds: string[];
  triggerRebuildAfterApply?: boolean;
}

export interface ApplyFinalRepairsResponse {
  backup: ProjectRepairBackup;
  appliedProposals: AiFinalRepairProposal[];
  skippedProposals: { proposalId: string; reason: string }[];
  rebuildRun?: GradleBuildRun | null;
  updatedComparisonReport: FinalComparisonReport;
}

/**
 * Phase 6: Persistent Recovery Sessions and Project State Management Types
 */
export type RecoveryWorkflowStage =
  | 'uploaded'
  | 'decompiled'
  | 'ai_analyzed'
  | 'reconstructed'
  | 'gradle_built'
  | 'compared'
  | 'interrupted'
  | 'failed';

export interface SessionVersionSnapshot {
  id: string;
  tag: string;
  label: string;
  description?: string;
  createdAt: string;
  createdAtMs: number;
  workflowStage: RecoveryWorkflowStage;
  fileCount: number;
  totalSizeBytes: number;
  sha256: string;
  isAutomatic?: boolean;
}

export interface SessionManifestFileEntry {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface RecoverySessionManifest {
  manifestVersion: string;
  sessionId: string;
  displayName: string;
  originalFilename: string;
  originalSha256: string;
  fileSize: number;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  createdAt: string;
  lastAccessedAt: string;
  workflowStage: RecoveryWorkflowStage;
  progressPercent: number;
  hasDecompiledCode: boolean;
  hasSmaliCode: boolean;
  hasAiRecovery: boolean;
  hasReconstructedProject: boolean;
  hasGradleBuild: boolean;
  hasComparisonReport: boolean;
  versions: SessionVersionSnapshot[];
  keyArtifacts: SessionManifestFileEntry[];
  environment: {
    exportTimestamp: string;
    nodeVersion: string;
  };
}

export interface RecoverySessionListItem {
  id: string;
  displayName: string;
  originalFilename: string;
  fileSize: number;
  originalSha256?: string;
  packageName?: string;
  versionName?: string;
  createdAt: number;
  lastAccessedAt: number;
  stage: ProcessingStage;
  workflowStage: RecoveryWorkflowStage;
  progressPercent: number;
  isArchived: boolean;
  isBusy: boolean;
  busyOperation?: string;
  isInterrupted?: boolean;
  totalDiskSizeBytes: number;
  fileCount: number;
  hasReconstructedProject: boolean;
  hasComparisonReport: boolean;
  hasGradleBuild: boolean;
  versionsCount: number;
  error?: string;
}

export interface StorageEnvironmentInfo {
  storagePath: string;
  isPersistentVolume: boolean;
  isCodespace: boolean;
  warningMessage?: string;
  totalSessions: number;
  totalDiskUsageBytes: number;
  freeDiskBytes?: number;
}

export interface VersionDiffResult {
  snapshotId: string;
  snapshotLabel: string;
  snapshotCreatedAt: string;
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  unchangedFilesCount: number;
}

export interface CreateVersionSnapshotRequest {
  tag: string;
  label: string;
  description?: string;
}

export interface RenameSessionRequest {
  displayName: string;
}

export interface ArchiveSessionRequest {
  isArchived: boolean;
}

export interface DuplicateSessionRequest {
  displayName?: string;
}

export interface SessionImportResponse {
  sessionId: string;
  displayName: string;
  originalFilename: string;
  workflowStage: RecoveryWorkflowStage;
  totalFilesRestored: number;
  manifest: RecoverySessionManifest;
}





