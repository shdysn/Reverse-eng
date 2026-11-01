import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type {
  PackageNameInfo,
  RenamePackageRequest,
  RenamePackageResponse,
} from '@android-re/shared';
import { sessionService } from './session.service.js';
import { ApiError } from '../utils/apiError.js';

export class PackageService {
  /**
   * Extracts current package name, app label, and version info from decoded/AndroidManifest.xml and apktool.yml
   */
  public async getPackageInfo(sessionId: string): Promise<PackageNameInfo> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const manifestPath = path.join(sessionDir, 'decoded', 'AndroidManifest.xml');
    const apktoolYmlPath = path.join(sessionDir, 'decoded', 'apktool.yml');

    let packageName = 'com.example.app';
    let appName = '';
    let versionName = '1.0';
    let versionCode = '1';

    if (fsSync.existsSync(manifestPath)) {
      try {
        const xml = await fs.readFile(manifestPath, 'utf-8');
        const pkgMatch = xml.match(/\bpackage\s*=\s*["']([^"']+)["']/);
        if (pkgMatch?.[1]) packageName = pkgMatch[1];

        const labelMatch = xml.match(/android:label\s*=\s*["']([^"']+)["']/);
        if (labelMatch?.[1]) appName = labelMatch[1];

        const vNameMatch = xml.match(/android:versionName\s*=\s*["']([^"']+)["']/);
        if (vNameMatch?.[1]) versionName = vNameMatch[1];

        const vCodeMatch = xml.match(/android:versionCode\s*=\s*["']([^"']+)["']/);
        if (vCodeMatch?.[1]) versionCode = vCodeMatch[1];
      } catch {
        // ignore read error
      }
    }

    if (fsSync.existsSync(apktoolYmlPath)) {
      try {
        const yml = await fs.readFile(apktoolYmlPath, 'utf-8');
        const vNameYml = yml.match(/versionName:\s*['"]?([^'"\n\r]+)['"]?/);
        if (vNameYml?.[1]) versionName = vNameYml[1].trim();
        const vCodeYml = yml.match(/versionCode:\s*['"]?([^'"\n\r]+)['"]?/);
        if (vCodeYml?.[1]) versionCode = vCodeYml[1].trim();
      } catch {
        // ignore
      }
    }

    // If appName is @string/app_name, try looking up in res/values/strings.xml
    const stringsPath = path.join(sessionDir, 'decoded', 'res', 'values', 'strings.xml');
    if (appName.startsWith('@string/') && fsSync.existsSync(stringsPath)) {
      const stringKey = appName.replace('@string/', '');
      try {
        const stringsXml = await fs.readFile(stringsPath, 'utf-8');
        const regex = new RegExp(`<string\\s+name=["']${stringKey}["'][^>]*>([^<]+)</string>`);
        const match = stringsXml.match(regex);
        if (match?.[1]) {
          appName = match[1];
        }
      } catch {
        // ignore
      }
    }

    return {
      packageName,
      appName: appName || undefined,
      versionName,
      versionCode,
    };
  }

  /**
   * Renames package name safely across AndroidManifest.xml, apktool.yml, strings.xml (if newAppName provided),
   * and optionally deep-refactors Smali descriptors
   */
  public async renamePackage(
    sessionId: string,
    req: RenamePackageRequest
  ): Promise<RenamePackageResponse> {
    const newPkg = req.newPackageName.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(newPkg)) {
      throw ApiError.badRequest(
        'Invalid Android package name format (e.g. com.company.mynewapp)',
        'INVALID_PACKAGE_NAME'
      );
    }

    const currentInfo = await this.getPackageInfo(sessionId);
    const oldPkg = currentInfo.packageName;
    const sessionDir = sessionService.getSessionDir(sessionId);
    const updatedFiles: string[] = [];

    // 1. Update decoded/AndroidManifest.xml
    const manifestPath = path.join(sessionDir, 'decoded', 'AndroidManifest.xml');
    if (fsSync.existsSync(manifestPath)) {
      let xml = await fs.readFile(manifestPath, 'utf-8');

      // Expand shorthand component names starting with "." (e.g. android:name=".MainActivity")
      // so moving package name does not break class resolution in the original DEX/Smali!
      if (!req.deepRefactorSmali && oldPkg && oldPkg !== newPkg) {
        xml = xml.replace(
          /android:name\s*=\s*(["'])\.([a-zA-Z0-9_$]+)\1/g,
          `android:name=$1${oldPkg}.$2$1`
        );
      }

      // Replace package="..."
      xml = xml.replace(
        new RegExp(`\\bpackage\\s*=\\s*(["'])${oldPkg.replace(/\./g, '\\.')}\\1`),
        `package=$1${newPkg}$1`
      );

      // Also update provider authorities containing the old package name to prevent install conflicts
      if (oldPkg && oldPkg !== newPkg) {
        xml = xml.replace(
          new RegExp(`android:authorities\\s*=\\s*(["'])([^"']*?)${oldPkg.replace(/\./g, '\\.')}([^"']*?)\\1`, 'g'),
          `android:authorities=$1$2${newPkg}$3$1`
        );
      }

      // Update app label if requested and not a @string reference
      if (req.newAppName && req.newAppName.trim()) {
        const cleanAppName = req.newAppName.trim();
        const stringsPath = path.join(sessionDir, 'decoded', 'res', 'values', 'strings.xml');
        if (fsSync.existsSync(stringsPath)) {
          try {
            let stringsXml = await fs.readFile(stringsPath, 'utf-8');
            if (stringsXml.includes('name="app_name"')) {
              stringsXml = stringsXml.replace(
                /(<string\s+name=["']app_name["'][^>]*>)([^<]*)(<\/string>)/,
                `$1${cleanAppName}$3`
              );
              await fs.writeFile(stringsPath, stringsXml, 'utf-8');
              updatedFiles.push('decoded/res/values/strings.xml');
            }
          } catch {
            // ignore
          }
        }
      }

      await fs.writeFile(manifestPath, xml, 'utf-8');
      updatedFiles.push('decoded/AndroidManifest.xml');
    }

    // 2. Update decoded/apktool.yml (renameManifestPackage)
    const apktoolYmlPath = path.join(sessionDir, 'decoded', 'apktool.yml');
    if (fsSync.existsSync(apktoolYmlPath)) {
      let yml = await fs.readFile(apktoolYmlPath, 'utf-8');
      if (yml.includes('renameManifestPackage:')) {
        yml = yml.replace(
          /renameManifestPackage:\s*[^\r\n]+/,
          `renameManifestPackage: ${newPkg}`
        );
      } else if (yml.includes('packageInfo:')) {
        yml = yml.replace(
          /packageInfo:/,
          `packageInfo:\n  renameManifestPackage: ${newPkg}`
        );
      }
      await fs.writeFile(apktoolYmlPath, yml, 'utf-8');
      updatedFiles.push('decoded/apktool.yml');
    }

    // 3. Optional Deep Smali Refactoring
    if (req.deepRefactorSmali && oldPkg && oldPkg !== newPkg) {
      const oldSlash = oldPkg.replace(/\./g, '/');
      const newSlash = newPkg.replace(/\./g, '/');
      const smaliRoot = path.join(sessionDir, 'decoded', 'smali');

      const refactorSmaliDir = async (dir: string) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await refactorSmaliDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.smali')) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.includes(oldSlash) || content.includes(oldPkg)) {
                const updated = content
                  .split(`L${oldSlash}/`)
                  .join(`L${newSlash}/`)
                  .split(oldPkg)
                  .join(newPkg);
                await fs.writeFile(fullPath, updated, 'utf-8');
                const rel = path.relative(sessionDir, fullPath);
                if (updatedFiles.length < 50) {
                  updatedFiles.push(rel);
                }
              }
            } catch {
              // ignore
            }
          }
        }
      };

      if (fsSync.existsSync(smaliRoot)) {
        await refactorSmaliDir(smaliRoot);
      }
    }

    return {
      oldPackageName: oldPkg,
      newPackageName: newPkg,
      newAppName: req.newAppName?.trim() || currentInfo.appName,
      updatedFilesCount: updatedFiles.length,
      updatedFiles,
    };
  }
}

export const packageService = new PackageService();
