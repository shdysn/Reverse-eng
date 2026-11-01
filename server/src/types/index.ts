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
}

export interface ValidatedSessionPath {
  sessionRoot: string;
  targetPath: string;
  relativePath: string;
}
