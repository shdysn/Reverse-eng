import fs from 'node:fs/promises';
import path from 'node:path';
import { env, ABSOLUTE_TEST_KEYSTORE } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { commandService } from './command.service.js';
import { sessionService } from './session.service.js';
import { resourceSanitizerService } from './resource-sanitizer.service.js';
import type { RebuildData } from '../types/index.js';

export class RebuildService {
  /**
   * Executes the rebuild, alignment, signing, and verification pipeline
   */
  public async rebuildApk(sessionId: string): Promise<RebuildData> {
    if (sessionService.isOperationActive(sessionId)) {
      throw ApiError.conflict('Another operation or rebuild is already running for this session', 'REBUILD_IN_PROGRESS');
    }

    sessionService.setOperationActive(sessionId, 'Rebuilding APK');

    try {
      const sessionDir = sessionService.getSessionDir(sessionId);
      const decodedDir = path.join(sessionDir, 'decoded');
      const buildDir = path.join(sessionDir, 'build');

      // Verify decoded directory exists
      try {
        const stat = await fs.stat(decodedDir);
        if (!stat.isDirectory()) {
          throw new Error('decoded directory is not present');
        }
      } catch {
        throw ApiError.badRequest('No decoded APK found. Please upload and decompile an APK first.', 'NO_DECODED_DATA');
      }

      // Check external tools
      const apktoolExists = await commandService.checkExecutable(env.APKTOOL_BIN, ['-version']);
      const zipalignExists = await commandService.checkExecutable(env.ZIPALIGN_BIN, ['-h']);
      const apksignerExists = await commandService.checkExecutable(env.APKSIGNER_BIN, ['--version']);

      if (!apktoolExists || !zipalignExists || !apksignerExists) {
        const missing: string[] = [];
        if (!apktoolExists) missing.push(`apktool (${env.APKTOOL_BIN})`);
        if (!zipalignExists) missing.push(`zipalign (${env.ZIPALIGN_BIN})`);
        if (!apksignerExists) missing.push(`apksigner (${env.APKSIGNER_BIN})`);
        throw ApiError.badRequest(
          `Cannot rebuild APK because required CLI tools are missing in this environment: ${missing.join(', ')}. Use GitHub Codespaces or Ubuntu with setup-codespace.sh.`,
          'TOOLS_MISSING'
        );
      }

      // Ensure test keystore exists
      try {
        await fs.access(ABSOLUTE_TEST_KEYSTORE);
      } catch {
        throw ApiError.badRequest(
          `Test keystore was not found at '${env.TEST_KEYSTORE}'. Run setup-codespace.sh to generate the disposable test keystore.`,
          'KEYSTORE_MISSING'
        );
      }

      const logs: string[] = [];

      // 0. Sanitize resource filenames (Fixes "Invalid file name" errors)
      logs.push('[0/4] Sanitizing resource filenames for Android compliance...');
      const sanitizeRes = await resourceSanitizerService.sanitizeAllResources(sessionId);
      if (sanitizeRes.sanitizedCount > 0) {
        logs.push(`   - Sanitized ${sanitizeRes.sanitizedCount} resource(s) and updated references in ${sanitizeRes.filesUpdated} file(s).`);
      }

      // Clean up previous build outputs
      await fs.rm(buildDir, { recursive: true, force: true });
      await fs.mkdir(buildDir, { recursive: true });

      const unsignedApk = path.join(buildDir, 'unsigned.apk');
      const alignedApk = path.join(buildDir, 'aligned.apk');
      const signedApk = path.join(buildDir, 'signed.apk');

      // 1. apktool b DECODED_DIRECTORY -o UNSIGNED_APK
      logs.push('[1/4] Running apktool b to assemble unsigned APK...');
      const apktoolRes = await commandService.execute(
        env.APKTOOL_BIN,
        ['b', decodedDir, '-o', unsignedApk],
        { cwd: sessionDir }
      );

      if (apktoolRes.exitCode !== 0) {
        throw ApiError.badRequest(
          `apktool build failed:\n${apktoolRes.stderr || apktoolRes.stdout || 'Unknown error'}`,
          'APKTOOL_BUILD_FAILED'
        );
      }

      // 2. zipalign -f -p 4 UNSIGNED_APK ALIGNED_APK
      logs.push('[2/4] Running zipalign 4-byte page alignment...');
      const zipalignRes = await commandService.execute(
        env.ZIPALIGN_BIN,
        ['-f', '-p', '4', unsignedApk, alignedApk],
        { cwd: sessionDir }
      );

      if (zipalignRes.exitCode !== 0) {
        throw ApiError.badRequest(
          `zipalign failed:\n${zipalignRes.stderr || zipalignRes.stdout || 'Unknown error'}`,
          'ZIPALIGN_FAILED'
        );
      }

      // 3. apksigner sign --ks TEST_KEYSTORE ...
      logs.push('[3/4] Signing aligned APK with disposable test key...');
      const apksignerRes = await commandService.execute(
        env.APKSIGNER_BIN,
        [
          'sign',
          '--ks',
          ABSOLUTE_TEST_KEYSTORE,
          '--ks-key-alias',
          env.TEST_KEY_ALIAS,
          '--ks-pass',
          `pass:${env.TEST_KEY_PASSWORD}`,
          '--key-pass',
          `pass:${env.TEST_KEY_PASSWORD}`,
          '--out',
          signedApk,
          alignedApk,
        ],
        { cwd: sessionDir }
      );

      if (apksignerRes.exitCode !== 0) {
        throw ApiError.badRequest(
          `apksigner signing failed:\n${commandService.maskSecrets(apksignerRes.stderr || apksignerRes.stdout)}`,
          'APKSIGNER_FAILED'
        );
      }

      // 4. apksigner verify --verbose SIGNED_APK
      logs.push('[4/4] Verifying APK signature...');
      const verifyRes = await commandService.execute(
        env.APKSIGNER_BIN,
        ['verify', '--verbose', signedApk],
        { cwd: sessionDir }
      );

      if (verifyRes.exitCode !== 0) {
        throw ApiError.badRequest(
          `APK signature verification failed:\n${verifyRes.stderr || verifyRes.stdout}`,
          'SIGNATURE_VERIFY_FAILED'
        );
      }

      // Verify signed.apk exists and is not empty
      const signedStat = await fs.stat(signedApk);
      if (signedStat.size <= 0) {
        throw ApiError.internal('Generated signed APK is empty', 'EMPTY_SIGNED_APK');
      }

      await sessionService.updateSession(sessionId, { rebuilt: true });

      return {
        downloadUrl: `/api/sessions/${sessionId}/download`,
        filename: 'rebuilt-signed.apk',
        size: signedStat.size,
        verified: true,
        logs,
      };
    } finally {
      sessionService.clearOperationActive(sessionId);
    }
  }

  /**
   * Retrieves signed APK file path if verified
   */
  public async getSignedApkPath(sessionId: string): Promise<{ filePath: string; size: number }> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const signedApk = path.join(sessionDir, 'build', 'signed.apk');

    try {
      const stat = await fs.stat(signedApk);
      if (stat.size <= 0) {
        throw new Error('Signed APK is empty');
      }
      return { filePath: signedApk, size: stat.size };
    } catch {
      throw ApiError.notFound('No signed APK build exists for this session', 'NO_SIGNED_BUILD');
    }
  }
}

export const rebuildService = new RebuildService();
