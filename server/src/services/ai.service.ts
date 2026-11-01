import { GoogleGenAI, Type } from '@google/genai';
import { AiPatchRequest, AiPatchResponse } from '@android-re/shared';
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
}

export const aiService = new AiService();
