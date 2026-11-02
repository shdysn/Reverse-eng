import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sessionService } from './session.service.js';

export class ResourceSanitizerService {
  /**
   * Sanitizes resource filenames in decoded/res to comply with Android [a-z0-9_.] requirements
   * and updates all references across the project.
   */
  public async sanitizeAllResources(sessionId: string): Promise<{ sanitizedCount: number; filesUpdated: number }> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const resDir = path.join(sessionDir, 'decoded', 'res');

    if (!fsSync.existsSync(resDir)) {
      return { sanitizedCount: 0, filesUpdated: 0 };
    }

    const renameMap: Record<string, string> = {};
    let sanitizedCount = 0;

    const scanAndRename = async (currentDir: string) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scanAndRename(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const baseName = path.basename(entry.name, ext);

          // Android resource naming rules: [a-z0-9_.]
          // Also must start with a letter or underscore
          if (/[^a-z0-9_.]/.test(baseName) || /^[0-9]/.test(baseName) || /[A-Z]/.test(baseName)) {
            let safeName = baseName
              .toLowerCase()
              .replace(/[^a-z0-9_.]/g, '_')
              .replace(/^([0-9])/, 'res_$1');

            // Handle potential collisions
            let finalSafeName = safeName;
            let counter = 1;
            while (fsSync.existsSync(path.join(currentDir, finalSafeName + ext)) && finalSafeName !== baseName.toLowerCase()) {
              finalSafeName = `${safeName}_${counter++}`;
            }

            if (finalSafeName !== baseName) {
              const newPath = path.join(currentDir, finalSafeName + ext);
              await fs.rename(fullPath, newPath);
              renameMap[baseName] = finalSafeName;
              sanitizedCount++;
            }
          }
        }
      }
    };

    await scanAndRename(resDir);

    if (sanitizedCount === 0) {
      return { sanitizedCount: 0, filesUpdated: 0 };
    }

    // Now update references in all XML and Smali files
    let filesUpdated = 0;
    const decodedDir = path.join(sessionDir, 'decoded');

    const updateReferences = async (currentDir: string) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await updateReferences(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.xml' || ext === '.smali' || ext === '.yml' || ext === '.txt') {
            try {
              let content = await fs.readFile(fullPath, 'utf-8');
              let changed = false;

              for (const [oldName, newName] of Object.entries(renameMap)) {
                // We need to be surgical with replacements to avoid breaking unrelated strings
                // In XML: @drawable/name, @layout/name, name="name"
                // In Smali: ->name:I
                // In yml: name

                // XML/YML pattern: Look for name surrounded by common delimiters
                const xmlRegex = new RegExp(`(?<=[\\/\\="'])${this.escapeRegExp(oldName)}(?=[\\s"';<>\\.])`, 'g');
                if (xmlRegex.test(content)) {
                  content = content.replace(xmlRegex, newName);
                  changed = true;
                }

                // Smali pattern: ->name:
                const smaliRegex = new RegExp(`->${this.escapeRegExp(oldName)}:`, 'g');
                if (smaliRegex.test(content)) {
                  content = content.replace(smaliRegex, `->${newName}:`);
                  changed = true;
                }
              }

              if (changed) {
                await fs.writeFile(fullPath, content, 'utf-8');
                filesUpdated++;
              }
            } catch {
              // ignore binary or unreadable files
            }
          }
        }
      }
    };

    await updateReferences(decodedDir);

    return { sanitizedCount, filesUpdated };
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const resourceSanitizerService = new ResourceSanitizerService();
