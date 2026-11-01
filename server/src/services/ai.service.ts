import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AiPatchRequest,
  AiPatchResponse,
  AiProjectAnalyzeRequest,
  AiProjectSolutionResponse,
} from '@android-re/shared';
import { sessionService } from './session.service.js';
import { ApiError } from '../utils/apiError.js';

export class AiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim() !== '') {
      this.ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      return this.ai;
    }
    return null;
  }

  private getClient(): GoogleGenAI {
    if (!this.ai) {
      const client = this.initClient();
      if (!client) {
        throw ApiError.badRequest(
          'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your environment to enable AI code editing.',
          'GEMINI_KEY_MISSING'
        );
      }
    }
    return this.ai!;
  }

  /**
   * Performs surgical, dependency-preserving AI modification on the given file
   */
  public async patchFile(req: AiPatchRequest): Promise<AiPatchResponse> {
    const ai = this.getClient();

    const systemInstruction = `
You are an expert Android security engineer, byte-code surgeon, and reverse engineering specialist.
Your task is to modify the provided source code according to the user's instructions while strictly safeguarding surrounding code and application dependencies.

CRITICAL INTEGRITY & NON-BREAKING RULES:
1. PRESERVE DEPENDENCIES & SIGNATURES:
   - Never delete whole methods or variables that other classes/methods might be calling (doing so triggers NoSuchMethodError / VerifyError crashes at runtime).
   - If user asks to remove/bypass a check (e.g., Root Detection, SSL Pinning, Emulator Detection, Anti-Debug, License/Ads):
     Apply STUBBING/NEUTRALIZATION:
     - For boolean checks: make the method immediately return false (or true) without performing detection.
     - In Smali:
       .method public isDeviceRooted()Z
           .registers 2
           const/4 v0, 0x0
           return v0
       .end method
     - For void check methods (like verifySignature()V): replace body with "return-void".
   - Keep the original method signature intact so all external callers continue working without errors.

2. SMALI SYNTAX & REGISTERS DISCIPLINE:
   - Keep correct .registers or .locals count. If adding registers, ensure .locals is large enough.
   - Do not break branch labels (:cond_0, :goto_0, :try_start_0).
   - Maintain parameter registers (p0 for this, p1 for first param) and valid return instructions.

3. ANDROID MANIFEST DISCIPLINE:
   - Retain all root namespaces and required XML declarations.
   - When modifying exported flags, permissions, or security attributes (e.g. android:debuggable="true", android:usesCleartextTraffic="true"), maintain valid XML tags.

4. OUTPUT FORMAT:
   - Return valid JSON matching the schema.
   - modifiedContent must be the full, complete, production-ready code ready to be saved and compiled by apktool.
   - explanation must describe in clear terms what was changed and why.
   - actions array must list every specific change with its impact on dependencies.
`;

    const userPrompt = `
FILE NAME: ${req.fileName}
FILE PATH: ${req.filePath}
FILE TYPE: ${req.fileType || 'smali'}
USER INSTRUCTION: ${req.instruction}

${req.selectedSnippet ? `TARGET SELECTED SNIPPET TO FOCUS ON:\n\`\`\`\n${req.selectedSnippet}\n\`\`\`\n` : ''}

COMPLETE FILE CONTENT:
\`\`\`
${req.content}
\`\`\`

Perform the requested modification surgically. Ensure all callers and related code remain 100% valid and won't crash when reassembled by apktool.
`;

    const targetModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    const config = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          modifiedContent: {
            type: Type.STRING,
            description: 'The complete modified file content with all surgical changes applied.',
          },
          explanation: {
            type: Type.STRING,
            description: 'Clear, plain-language summary of what changes were performed and why.',
          },
          actions: {
            type: Type.ARRAY,
            description: 'List of specific surgical actions performed.',
            items: {
              type: Type.OBJECT,
              properties: {
                target: {
                  type: Type.STRING,
                  description: 'Name of the method, tag, or code segment modified.',
                },
                changeType: {
                  type: Type.STRING,
                  description: 'Type of change: neutralized, modified, removed, or added.',
                },
                description: {
                  type: Type.STRING,
                  description: 'What exact change was made.',
                },
                impactOnDependencies: {
                  type: Type.STRING,
                  description: 'How surrounding callers and variables were preserved safely.',
                },
              },
              required: ['target', 'changeType', 'description', 'impactOnDependencies'],
            },
          },
          integrityVerified: {
            type: Type.BOOLEAN,
            description: 'True if method signatures, registers, and dependencies were validated.',
          },
          safetyNote: {
            type: Type.STRING,
            description: 'Guidance and advice on rebuilding and verifying the modification.',
          },
        },
        required: ['modifiedContent', 'explanation', 'actions', 'integrityVerified', 'safetyNote'],
      },
    };

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents: userPrompt,
          config,
        });
      } catch (err: any) {
        // If 3.5 flash lite string returns 404 in current SDK region, seamlessly fall back to flash lite alias
        if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('not found')) {
          console.warn(`Model ${targetModel} not found, retrying with gemini-3.1-flash-lite...`);
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: userPrompt,
            config,
          });
        } else {
          throw err;
        }
      }

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error('Gemini API returned an empty response.');
      }

      const parsed = JSON.parse(jsonText);

      return {
        originalContent: req.content,
        modifiedContent: parsed.modifiedContent || req.content,
        explanation: parsed.explanation || 'File modified according to instructions.',
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        integrityVerified: Boolean(parsed.integrityVerified),
        safetyNote: parsed.safetyNote || 'Ready to save and rebuild with apktool.',
      };
    } catch (err) {
      if ((err as Error).name === 'ApiError') throw err;
      throw ApiError.internal(`AI Code Modification failed: ${(err as Error).message}`, 'AI_GEN_ERROR');
    }
  }

  /**
   * Analyzes the entire decompiled Android project (manifest, smali, and java files)
   * to locate cross-file dependencies and generate multi-file coordinated solutions.
   */
  public async analyzeProject(req: AiProjectAnalyzeRequest): Promise<AiProjectSolutionResponse> {
    const ai = this.getClient();
    const sessionDir = sessionService.getSessionDir(req.sessionId);

    // 1. Read AndroidManifest.xml
    const manifestPath = path.join(sessionDir, 'decoded', 'AndroidManifest.xml');
    let manifestContent = '';
    try {
      manifestContent = await fs.readFile(manifestPath, 'utf-8');
      if (manifestContent.length > 50000) {
        manifestContent = manifestContent.slice(0, 50000) + '\n<!-- ... truncated -->';
      }
    } catch {
      // ignore
    }

    // 2. Discover candidate files matching the user's intent keywords
    const keywords = req.query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length >= 3 && !['the', 'and', 'with', 'for', 'this', 'that', 'all', 'how', 'can'].includes(w));

    // Also include common security and hook keywords if query mentions bypass/root/ssl
    if (req.query.toLowerCase().includes('root')) {
      keywords.push('root', 'su', 'supersu', 'magisk', 'busybox', 'test-keys');
    }
    if (req.query.toLowerCase().includes('ssl') || req.query.toLowerCase().includes('cert')) {
      keywords.push('trustmanager', 'certificatepinner', 'checkservertrusted', 'x509', 'hostnameverifier');
    }

    const candidateFiles: { relPath: string; content: string }[] = [];
    const maxFilesToCollect = 6;
    const maxTotalBytes = 150000;
    let totalBytesCollected = 0;

    const scanDirectory = async (dirPath: string, relPrefix = '') => {
      if (candidateFiles.length >= maxFilesToCollect || totalBytesCollected >= maxTotalBytes) return;

      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (candidateFiles.length >= maxFilesToCollect || totalBytesCollected >= maxTotalBytes) break;
        if (entry.name === 'build' || entry.name === 'chunks' || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.smali' || ext === '.java' || (ext === '.xml' && entry.name !== 'AndroidManifest.xml')) {
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size > 80000) continue; // skip oversized single files

              const fileText = await fs.readFile(fullPath, 'utf-8');
              const lowerText = fileText.toLowerCase();

              const matches = keywords.some((kw) => lowerText.includes(kw));
              if (matches || candidateFiles.length < 2) {
                candidateFiles.push({ relPath, content: fileText });
                totalBytesCollected += fileText.length;
              }
            } catch {
              // ignore
            }
          }
        }
      }
    };

    // Scan decoded/smali and java/
    await scanDirectory(path.join(sessionDir, 'decoded', 'smali'), 'decoded/smali');
    if (candidateFiles.length < maxFilesToCollect) {
      await scanDirectory(path.join(sessionDir, 'java'), 'java');
    }

    const systemInstruction = `
You are an elite Android application security architect and cross-file reverse engineer.
The user wants to achieve a target across their ENTIRE decompiled Android project.
You have access to AndroidManifest.xml and relevant source files across the project packages.

YOUR GOAL:
1. Conduct a holistic, project-wide architectural analysis. Locate the exact root cause or implementation across multiple files.
2. Determine ALL files that need to be modified (e.g. Smali bytecode stubs, AndroidManifest.xml flags, network configs).
3. For each affected file, provide the COMPLETE, pristine modified content.
4. Strictly protect application stability:
   - Use method stubbing / neutralization instead of deleting callers to avoid NoSuchMethodError.
   - Maintain correct Smali registers and branch labels.
5. Provide a clear summary and recommendation for reassembling the APK.
`;

    const userPrompt = `
USER GOAL / QUERY ACROSS PROJECT:
"${req.query}"

=== ANDROID MANIFEST (decoded/AndroidManifest.xml) ===
${manifestContent || '(Not available)'}

=== PROJECT SOURCE CANDIDATE FILES (${candidateFiles.length} files scanned) ===
${candidateFiles
  .map(
    (f, idx) => `
--- File ${idx + 1}: ${f.relPath} ---
\`\`\`
${f.content}
\`\`\`
`
  )
  .join('\n')}

Analyze the entire project architecture and return a coordinated, multi-file solution adhering to the JSON schema.
`;

    const targetModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    const config = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Comprehensive high-level summary of how the solution works across the whole project.',
          },
          rootCause: {
            type: Type.STRING,
            description: 'Where the target behavior or checks are located in the project architecture.',
          },
          affectedFiles: {
            type: Type.ARRAY,
            description: 'List of files that must be modified to achieve the solution.',
            items: {
              type: Type.OBJECT,
              properties: {
                filePath: {
                  type: Type.STRING,
                  description: 'Relative path of the file (e.g. decoded/AndroidManifest.xml or decoded/smali/com/app/Security.smali).',
                },
                fileName: {
                  type: Type.STRING,
                  description: 'File name (e.g. Security.smali).',
                },
                reason: {
                  type: Type.STRING,
                  description: 'Why this file must be modified.',
                },
                modifiedContent: {
                  type: Type.STRING,
                  description: 'The complete, production-ready modified content of the file.',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Explanation of changes made in this file.',
                },
              },
              required: ['filePath', 'fileName', 'reason', 'modifiedContent', 'explanation'],
            },
          },
          recommendation: {
            type: Type.STRING,
            description: 'Next steps for rebuilding and testing the project.',
          },
        },
        required: ['summary', 'rootCause', 'affectedFiles', 'recommendation'],
      },
    };

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents: userPrompt,
          config,
        });
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('not found')) {
          console.warn(`Model ${targetModel} not found, retrying with gemini-3.1-flash-lite...`);
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: userPrompt,
            config,
          });
        } else {
          throw err;
        }
      }

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error('Gemini API returned an empty response.');
      }

      const parsed = JSON.parse(jsonText);

      return {
        summary: parsed.summary || 'Project-wide analysis complete.',
        rootCause: parsed.rootCause || 'Identified implementation across project source files.',
        affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
        recommendation: parsed.recommendation || 'Save modified files and rebuild APK.',
      };
    } catch (err) {
      if ((err as Error).name === 'ApiError') throw err;
      throw ApiError.internal(`Project-wide AI analysis failed: ${(err as Error).message}`, 'AI_PROJECT_ERROR');
    }
  }
}

export const aiService = new AiService();
