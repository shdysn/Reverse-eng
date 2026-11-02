export * from '@android-re/shared';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

export interface SessionRecord {
  id: string;
  originalFilename: string;
  fileSize: number;
  createdAt: number;
  lastAccessedAt: number;
  stage: import('@android-re/shared').ProcessingStage;
  error?: string;
  partialJadx?: boolean;
  rebuilt?: boolean;
  displayName?: string;
  isArchived?: boolean;
  workflowStage?: import('@android-re/shared').RecoveryWorkflowStage;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  originalSha256?: string;
  interrupted?: boolean;
  activeOperation?: string;
  operationStartedAt?: number;
}

export interface ValidatedSessionPath {
  sessionRoot: string;
  targetPath: string;
  relativePath: string;
}

