import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { commandService } from './command.service.js';
import { sessionService } from './session.service.js';
import { manifestService } from './manifest.service.js';
import type { SessionRecord } from '../types/index.js';

export class ApkService {
  /**
   * Validates APK/ZIP container without arbitrary command execution or unsafe extraction
   */
  public async validateApk(apkPath: string, expectedSize: number): Promise<void> {
    const stat = await fs.stat(apkPath);
    if (stat.size !== expectedSize) {
      throw ApiError.badRequest(
        `Declared file size (${expectedSize}) does not match joined file size (${stat.size})`,
        'SIZE_MISMATCH'
      );
    }

    if (stat.size < 30) {
      throw ApiError.badRequest('File is too small to be a valid APK', 'INVALID_APK');
    }

    // Read the first 4 bytes for ZIP magic bytes (PK\x03\x04 or PK\x05\x06)
    const fileHandle = await fs.open(apkPath, 'r');
    const headerBuf = Buffer.alloc(4);
    await fileHandle.read(headerBuf, 0, 4, 0);
    await fileHandle.close();

    const isZip =
      (headerBuf[0] === 0x50 && headerBuf[1] === 0x4b && headerBuf[2] === 0x03 && headerBuf[3] === 0x04) ||
      (headerBuf[0] === 0x50 && headerBuf[1] === 0x4b && headerBuf[2] === 0x05 && headerBuf[3] === 0x06);

    if (!isZip) {
      throw ApiError.badRequest('File does not have valid ZIP / APK magic bytes', 'INVALID_APK_MAGIC');
    }

    // Inspect ZIP entries safely
    await this.inspectZipEntries(apkPath);
  }

  /**
   * Scans ZIP entries directly from local file headers to verify structure and reject zip slips
   */
  private async inspectZipEntries(apkPath: string): Promise<void> {
    const MAX_ENTRIES = 50000;
    let entryCount = 0;
    let foundManifest = false;

    // Scan Central Directory from End of Central Directory Record (EOCD)
    const stat = await fs.stat(apkPath);
    const fileHandle = await fs.open(apkPath, 'r');

    try {
      // Look for EOCD signature (0x06054b50) in last 65KB + 22 bytes
      const searchLen = Math.min(stat.size, 65557);
      const searchBuf = Buffer.alloc(searchLen);
      const readOffset = stat.size - searchLen;
      await fileHandle.read(searchBuf, 0, searchLen, readOffset);

      let eocdOffset = -1;
      for (let i = searchBuf.length - 22; i >= 0; i--) {
        if (
          searchBuf[i] === 0x50 &&
          searchBuf[i + 1] === 0x4b &&
          searchBuf[i + 2] === 0x05 &&
          searchBuf[i + 3] === 0x06
        ) {
          eocdOffset = readOffset + i;
          break;
        }
      }

      if (eocdOffset !== -1) {
        // Read central directory offset and total entries from EOCD
        const eocdBuf = Buffer.alloc(22);
        await fileHandle.read(eocdBuf, 0, 22, eocdOffset);
        const totalEntries = eocdBuf.readUInt16LE(10);
        const cdSize = eocdBuf.readUInt32LE(12);
        const cdOffset = eocdBuf.readUInt32LE(16);

        if (totalEntries > MAX_ENTRIES) {
          throw ApiError.badRequest(
            `APK contains too many ZIP entries (${totalEntries} > ${MAX_ENTRIES})`,
            'ZIP_BOMB_SUSPECTED'
          );
        }

        if (cdOffset + cdSize <= stat.size) {
          const cdBuf = Buffer.alloc(Math.min(cdSize, 10 * 1024 * 1024)); // cap reading CD to 10MB
          await fileHandle.read(cdBuf, 0, cdBuf.length, cdOffset);

          let offset = 0;
          while (offset + 46 <= cdBuf.length) {
            // Central directory file header signature: 0x02014b50
            if (
              cdBuf[offset] !== 0x50 ||
              cdBuf[offset + 1] !== 0x4b ||
              cdBuf[offset + 2] !== 0x01 ||
              cdBuf[offset + 3] !== 0x02
            ) {
              break;
            }

            const fileNameLen = cdBuf.readUInt16LE(offset + 28);
            const extraLen = cdBuf.readUInt16LE(offset + 30);
            const commentLen = cdBuf.readUInt16LE(offset + 32);

            const fileNameStart = offset + 46;
            if (fileNameStart + fileNameLen <= cdBuf.length) {
              const entryName = cdBuf.toString('utf-8', fileNameStart, fileNameStart + fileNameLen);
              entryCount++;

              // Reject directory traversal or absolute paths in ZIP entries (Zip Slip prevention)
              if (
                entryName.startsWith('/') ||
                entryName.startsWith('\\') ||
                entryName.includes('../') ||
                entryName.includes('..\\')
              ) {
                throw ApiError.badRequest(
                  `Malicious or invalid ZIP entry path detected: ${entryName}`,
                  'ZIP_SLIP_DETECTED'
                );
              }

              if (entryName === 'AndroidManifest.xml') {
                foundManifest = true;
              }
            }

            offset += 46 + fileNameLen + extraLen + commentLen;
          }
        }
      }
    } finally {
      await fileHandle.close();
    }

    if (!foundManifest) {
      throw ApiError.badRequest(
        'APK container is missing AndroidManifest.xml',
        'MISSING_MANIFEST'
      );
    }
  }

  /**
   * Decompiles the joined input.apk through apktool and JADX
   */
  public async decompileApk(sessionId: string): Promise<{ partialJadx?: boolean }> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const inputApk = path.join(sessionDir, 'input.apk');
    const decodedDir = path.join(sessionDir, 'decoded');
    const javaDir = path.join(sessionDir, 'java');

    // 1 & 2. Run apktool if available, or fall back to container extraction
    const apktoolExists = await commandService.checkExecutable(env.APKTOOL_BIN, ['-version']);
    if (apktoolExists) {
      await sessionService.updateStage(sessionId, 'apktool');
      const apktoolRes = await commandService.execute(
        env.APKTOOL_BIN,
        ['d', '-f', inputApk, '-o', decodedDir],
        { cwd: sessionDir }
      );

      if (apktoolRes.exitCode !== 0) {
        // Save diagnostic log
        await fs.writeFile(
          path.join(sessionDir, 'apktool_error.log'),
          `Exit Code: ${apktoolRes.exitCode}\nSTDOUT:\n${apktoolRes.stdout}\nSTDERR:\n${apktoolRes.stderr}`,
          'utf-8'
        );
        throw ApiError.badRequest(
          `apktool failed to decode APK: ${apktoolRes.stderr.slice(0, 500) || apktoolRes.stdout.slice(0, 500)}`,
          'APKTOOL_DECODE_FAILED'
        );
      }
    } else {
      // Graceful fallback for preview / container environments without apktool installed
      await sessionService.updateStage(sessionId, 'apktool');
      try {
        await commandService.execute('unzip', ['-q', '-o', inputApk, '-d', decodedDir], {
          cwd: sessionDir,
        });
      } catch (unzipErr) {
        console.warn('Unzip fallback error:', unzipErr);
      }
    }

    // 3. Run JADX jadx -d JAVA_DIRECTORY INPUT_APK
    let partialJadx = false;
    await sessionService.updateStage(sessionId, 'jadx');
    const jadxExists = await commandService.checkExecutable(env.JADX_BIN, ['-v']);

    if (jadxExists) {
      try {
        const jadxRes = await commandService.execute(
          env.JADX_BIN,
          ['-d', javaDir, inputApk],
          { cwd: sessionDir, timeoutMs: env.COMMAND_TIMEOUT_MS }
        );

        if (jadxRes.exitCode !== 0) {
          partialJadx = true;
          await fs.writeFile(
            path.join(sessionDir, 'jadx_warning.log'),
            `Exit Code: ${jadxRes.exitCode}\nSTDOUT:\n${jadxRes.stdout}\nSTDERR:\n${jadxRes.stderr}`,
            'utf-8'
          );
        }
      } catch (jadxErr) {
        partialJadx = true;
        await fs.writeFile(
          path.join(sessionDir, 'jadx_warning.log'),
          `JADX Exception: ${(jadxErr as Error).message}`,
          'utf-8'
        );
      }
    } else {
      // JADX is optional or not installed
      partialJadx = true;
      await fs.writeFile(
        path.join(sessionDir, 'jadx_warning.log'),
        `JADX binary ('${env.JADX_BIN}') was not found. Smali and resource files are available from apktool.`,
        'utf-8'
      );
    }

    // 4. Initial Manifest Scan
    await sessionService.updateStage(sessionId, 'manifest');
    try {
      await manifestService.scanManifest(sessionId);
    } catch (scanErr) {
      console.warn('Initial manifest scan non-fatal error:', scanErr);
    }

    await sessionService.updateSession(sessionId, {
      stage: 'ready',
      partialJadx,
    });

    return { partialJadx };
  }
}

export const apkService = new ApkService();
