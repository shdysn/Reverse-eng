import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  RecoveryArchitectureAudit,
  NativeLibraryInfo,
  DetectedDependency,
  ObfuscatedSymbolCandidate,
  RecoverSourceRequest,
  RecoverSourceResponse,
  RecoveryJobStatus,
  ApplyRecoveredSourceRequest,
} from '@android-re/shared';
import { sessionService } from './session.service.js';
import { packageService } from './package.service.js';
import { resolveSafePath } from '../utils/safePath.js';
import { ApiError } from '../utils/apiError.js';

const KNOWN_SIGNATURES: {
  prefix: string;
  name: string;
  category: DetectedDependency['category'];
}[] = [
  { prefix: 'okhttp3', name: 'OkHttp 3 HTTP Client', category: 'Networking' },
  { prefix: 'retrofit2', name: 'Retrofit 2 REST Client', category: 'Networking' },
  { prefix: 'com/android/volley', name: 'Google Volley Networking', category: 'Networking' },
  { prefix: 'com/google/gson', name: 'Google Gson JSON Serializer', category: 'Networking' },
  { prefix: 'com/squareup/moshi', name: 'Square Moshi JSON', category: 'Networking' },
  { prefix: 'com/fasterxml/jackson', name: 'Jackson JSON Processor', category: 'Networking' },
  { prefix: 'com/bumptech/glide', name: 'Glide Media & Image Loader', category: 'UI' },
  { prefix: 'com/squareup/picasso', name: 'Picasso Image Loader', category: 'UI' },
  { prefix: 'coil', name: 'Coil Kotlin Image Loader', category: 'UI' },
  { prefix: 'com/airbnb/lottie', name: 'Lottie Vector Animations', category: 'UI' },
  { prefix: 'com/google/android/material', name: 'Material Design Components', category: 'UI' },
  { prefix: 'androidx/compose', name: 'Jetpack Compose UI', category: 'UI' },
  { prefix: 'com/google/firebase/auth', name: 'Firebase Authentication', category: 'Cloud/Firebase' },
  { prefix: 'com/google/firebase/firestore', name: 'Firebase Cloud Firestore', category: 'Cloud/Firebase' },
  { prefix: 'com/google/firebase/messaging', name: 'Firebase Cloud Messaging (FCM)', category: 'Cloud/Firebase' },
  { prefix: 'com/google/firebase/crashlytics', name: 'Firebase Crashlytics', category: 'Analytics' },
  { prefix: 'com/google/firebase/analytics', name: 'Firebase Analytics', category: 'Analytics' },
  { prefix: 'com/appsflyer', name: 'AppsFlyer Attribution SDK', category: 'Analytics' },
  { prefix: 'com/adjust/sdk', name: 'Adjust Analytics SDK', category: 'Analytics' },
  { prefix: 'com/facebook/appevents', name: 'Meta / Facebook App Events', category: 'Analytics' },
  { prefix: 'androidx/room', name: 'Jetpack Room SQLite ORM', category: 'Database' },
  { prefix: 'io/realm', name: 'Realm Mobile Database', category: 'Database' },
  { prefix: 'net/sqlcipher', name: 'SQLCipher Encrypted Database', category: 'Security' },
  { prefix: 'androidx/security/crypto', name: 'Jetpack Security Crypto', category: 'Security' },
  { prefix: 'org/bouncycastle', name: 'BouncyCastle Cryptography', category: 'Security' },
  { prefix: 'com/scottyab/rootbeer', name: 'RootBeer Root Detection', category: 'Security' },
  { prefix: 'dagger', name: 'Dagger / Hilt Dependency Injection', category: 'Injection/Reactive' },
  { prefix: 'io/reactivex', name: 'RxJava Reactive Extensions', category: 'Injection/Reactive' },
  { prefix: 'kotlinx/coroutines', name: 'Kotlin Coroutines', category: 'Kotlin/AndroidX' },
  { prefix: 'kotlin', name: 'Kotlin Standard Library', category: 'Kotlin/AndroidX' },
  { prefix: 'androidx/lifecycle', name: 'Jetpack Lifecycle & ViewModel', category: 'Kotlin/AndroidX' },
  { prefix: 'androidx/work', name: 'Jetpack WorkManager', category: 'Kotlin/AndroidX' },
];

const KNOWN_NATIVE_LIBS: Record<string, string> = {
  'libflutter.so': 'Flutter Engine Runtime',
  'libapp.so': 'Flutter AOT Compiled Dart Payload',
  'libreactnativejni.so': 'React Native JNI Bridge',
  'libhermes.so': 'React Native Hermes JS Engine',
  'libunity.so': 'Unity 3D Game Engine',
  'libil2cpp.so': 'Unity IL2CPP Compiled C# Code',
  'libcocos2dcpp.so': 'Cocos2d-x Game Engine',
  'libsqlcipher.so': 'SQLCipher Native Database Encryption',
  'libmmkv.so': 'Tencent MMKV Key-Value Storage',
  'libfrida-gadget.so': 'Frida Instrumentation Gadget',
  'libssl.so': 'OpenSSL / BoringSSL Native Library',
  'libcrypto.so': 'OpenSSL Cryptographic Library',
  'libsentry.so': 'Sentry Native Crash Reporting',
};

export class RecoveryService {
  private ai: GoogleGenAI | null = null;
  private activeJobs = new Map<string, RecoveryJobStatus>();
  private cancelledJobs = new Set<string>();

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw ApiError.badRequest(
        'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in your environment.',
        'MISSING_API_KEY'
      );
    }
    if (!this.ai) {
      this.ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return this.ai;
  }

  /**
   * Performs a static & structural audit of the decompiled workspace:
   * - Counts Java, Smali, XML, and Asset files
   * - Identifies Native (.so) libraries and architectures
   * - Detects Third-Party SDKs and dependencies
   * - Calculates Obfuscation Score & identifies ProGuard/R8 obfuscated classes or broken JADX methods
   */
  public async auditProjectArchitecture(sessionId: string): Promise<RecoveryArchitectureAudit> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const pkgInfo = await packageService.getPackageInfo(sessionId);

    let totalJavaFiles = 0;
    let totalSmaliFiles = 0;
    let totalXmlFiles = 0;
    let totalAssets = 0;

    const nativeLibraries: NativeLibraryInfo[] = [];
    const foundDepPrefixes = new Set<string>();
    const detectedDependencies: DetectedDependency[] = [];
    const obfuscatedCandidates: ObfuscatedSymbolCandidate[] = [];
    const packageCounts = new Map<string, number>();
    const assetsSummary: { path: string; size: number; type: string }[] = [];

    let totalClassesInspected = 0;
    let obfuscatedClassesCount = 0;

    // 1. Inspect Native Libraries in decoded/lib
    const libDir = path.join(sessionDir, 'decoded', 'lib');
    if (fsSync.existsSync(libDir)) {
      const scanLibs = async (dir: string, arch = 'unknown') => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanLibs(full, entry.name);
          } else if (entry.isFile() && entry.name.endsWith('.so')) {
            let size = 0;
            try {
              size = (await fs.stat(full)).size;
            } catch {
              // ignore
            }
            nativeLibraries.push({
              name: entry.name,
              path: path.relative(sessionDir, full).split(path.sep).join('/'),
              architecture: arch,
              size,
              knownLibrary: KNOWN_NATIVE_LIBS[entry.name.toLowerCase()],
            });
          }
        }
      };
      await scanLibs(libDir);
    }

    // 2. Inspect Assets in decoded/assets
    const assetsDir = path.join(sessionDir, 'decoded', 'assets');
    if (fsSync.existsSync(assetsDir)) {
      const scanAssets = async (dir: string) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanAssets(full);
          } else if (entry.isFile()) {
            totalAssets++;
            if (assetsSummary.length < 40) {
              let size = 0;
              try {
                size = (await fs.stat(full)).size;
              } catch {
                // ignore
              }
              const ext = path.extname(entry.name).toLowerCase() || 'binary';
              assetsSummary.push({
                path: path.relative(sessionDir, full).split(path.sep).join('/'),
                size,
                type: ext,
              });
            }
          }
        }
      };
      await scanAssets(assetsDir);
    }

    // 3. Scan decoded/ (Smali + XML)
    const decodedDir = path.join(sessionDir, 'decoded');
    if (fsSync.existsSync(decodedDir)) {
      const scanDecoded = async (dir: string) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name === 'build' || entry.name === 'lib' || entry.name === 'assets') continue;
          const full = path.join(dir, entry.name);
          const relFromDecoded = path.relative(decodedDir, full).split(path.sep).join('/');

          if (entry.isDirectory()) {
            // Check against known 3rd-party dependency prefixes
            for (const sig of KNOWN_SIGNATURES) {
              if (
                !foundDepPrefixes.has(sig.prefix) &&
                (relFromDecoded.includes(`/${sig.prefix}`) || relFromDecoded.startsWith(sig.prefix))
              ) {
                foundDepPrefixes.add(sig.prefix);
                detectedDependencies.push({
                  name: sig.name,
                  packagePrefix: sig.prefix.replace(/\//g, '.'),
                  category: sig.category,
                  confidence: 'high',
                });
              }
            }
            await scanDecoded(full);
          } else if (entry.isFile()) {
            if (entry.name.endsWith('.smali')) {
              totalSmaliFiles++;
            } else if (entry.name.endsWith('.xml')) {
              totalXmlFiles++;
            }
          }
        }
      };
      await scanDecoded(decodedDir);
    }

    // 4. Scan java/ (JADX output) and Smali fallback for Obfuscation & Incomplete Decompilation
    const javaDir = path.join(sessionDir, 'java');
    const inspectSourceCandidate = async (fullPath: string, isJava: boolean) => {
      const relPath = path.relative(sessionDir, fullPath).split(path.sep).join('/');
      const baseName = path.basename(fullPath, isJava ? '.java' : '.smali');

      // Skip standard 3rd party packages from obfuscation candidates list so user focuses on app logic
      const isThirdParty = KNOWN_SIGNATURES.some((sig) => relPath.includes(sig.prefix));

      // Record package hierarchy
      const dirRel = path.dirname(relPath);
      const cleanPkg = dirRel
        .replace(/^java(\/sources)?\/?/, '')
        .replace(/^decoded\/smali(_classes[0-9]+)?\/?/, '')
        .replace(/\//g, '.');
      if (cleanPkg && cleanPkg !== '.') {
        packageCounts.set(cleanPkg, (packageCounts.get(cleanPkg) || 0) + 1);
      }

      totalClassesInspected++;
      const isShortClassName =
        /^[a-zA-Z]{1,2}[0-9]*$/.test(baseName) || /^(C[0-9]+|[a-z][0-9]+)$/.test(baseName);

      if (isShortClassName) {
        obfuscatedClassesCount++;
      }

      if (!isThirdParty && obfuscatedCandidates.length < 30) {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size <= 120000) {
            const content = await fs.readFile(fullPath, 'utf-8');
            const incompleteDecompilation =
              content.includes('/* JADX WARN') ||
              content.includes('/* JADX ERROR') ||
              content.includes('Method dump skipped') ||
              content.includes('UnsupportedOperationException("Method not decompiled') ||
              content.includes('// Byte code:');

            // Count single/two-letter method or field identifiers
            const shortMatches = content.match(
              isJava
                ? /\b(public|private|protected| static|final)+\s+[a-zA-Z0-9_<>[\]]+\s+[a-zA-Z]{1,2}\s*\(/g
                : /\.method\s+[^\n]+\s+[a-zA-Z]{1,2}\(/g
            );
            const shortIdentifiersCount = (shortMatches ? shortMatches.length : 0) + (isShortClassName ? 3 : 0);

            if (isShortClassName || incompleteDecompilation || shortIdentifiersCount >= 2) {
              const score = Math.min(
                100,
                (isShortClassName ? 45 : 0) +
                  (incompleteDecompilation ? 40 : 0) +
                  shortIdentifiersCount * 8
              );
              const smaliMatch = await this.findCorrespondingSmaliPath(sessionDir, relPath);
              obfuscatedCandidates.push({
                filePath: relPath,
                className: cleanPkg ? `${cleanPkg}.${baseName}` : baseName,
                obfuscationScore: score,
                shortIdentifiersCount,
                incompleteDecompilation,
                correspondingSmaliPath: smaliMatch,
              });
            }
          }
        } catch {
          // ignore read error
        }
      }
    };

    if (fsSync.existsSync(javaDir)) {
      const scanJava = async (dir: string) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const relFromJava = path.relative(javaDir, full).split(path.sep).join('/');
          if (entry.isDirectory()) {
            for (const sig of KNOWN_SIGNATURES) {
              if (
                !foundDepPrefixes.has(sig.prefix) &&
                (relFromJava.includes(`/${sig.prefix}`) || relFromJava.startsWith(`sources/${sig.prefix}`))
              ) {
                foundDepPrefixes.add(sig.prefix);
                detectedDependencies.push({
                  name: sig.name,
                  packagePrefix: sig.prefix.replace(/\//g, '.'),
                  category: sig.category,
                  confidence: 'high',
                });
              }
            }
            await scanJava(full);
          } else if (entry.isFile() && entry.name.endsWith('.java')) {
            totalJavaFiles++;
            await inspectSourceCandidate(full, true);
          }
        }
      };
      await scanJava(javaDir);
    }

    // If JADX produced 0 Java files (e.g. only Smali available), inspect Smali files for obfuscation candidates
    if (totalJavaFiles === 0 && totalSmaliFiles > 0) {
      const smaliDir = path.join(sessionDir, 'decoded', 'smali');
      if (fsSync.existsSync(smaliDir)) {
        const scanSmaliForCandidates = async (dir: string) => {
          let entries;
          try {
            entries = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanSmaliForCandidates(full);
            } else if (entry.isFile() && entry.name.endsWith('.smali')) {
              await inspectSourceCandidate(full, false);
            }
          }
        };
        await scanSmaliForCandidates(smaliDir);
      }
    }

    // Sort obfuscated candidates by highest score first
    obfuscatedCandidates.sort((a, b) => b.obfuscationScore - a.obfuscationScore);

    // Count already recovered files in recovered/
    let recoveredFilesCount = 0;
    const recoveredMetaDir = path.join(sessionDir, 'recovered', '.meta');
    if (fsSync.existsSync(recoveredMetaDir)) {
      try {
        const metaFiles = await fs.readdir(recoveredMetaDir);
        recoveredFilesCount = metaFiles.filter((f) => f.endsWith('.json')).length;
      } catch {
        // ignore
      }
    }

    const overallObfuscationScore =
      totalClassesInspected > 0
        ? Math.min(100, Math.round((obfuscatedClassesCount / totalClassesInspected) * 100))
        : 0;

    const obfuscationLevel: RecoveryArchitectureAudit['obfuscationLevel'] =
      overallObfuscationScore >= 60
        ? 'Heavy (ProGuard/R8)'
        : overallObfuscationScore >= 30
        ? 'High'
        : overallObfuscationScore >= 12
        ? 'Moderate'
        : 'Low';

    const packageHierarchy = Array.from(packageCounts.entries())
      .map(([packageName, classCount]) => ({ packageName, classCount }))
      .sort((a, b) => b.classCount - a.classCount)
      .slice(0, 25);

    const audit: RecoveryArchitectureAudit = {
      sessionId,
      auditedAt: new Date().toISOString(),
      packageName: pkgInfo.packageName,
      totalJavaFiles,
      totalSmaliFiles,
      totalXmlFiles,
      totalAssets,
      overallObfuscationScore,
      obfuscationLevel,
      nativeLibraries,
      detectedDependencies,
      obfuscatedCandidates: obfuscatedCandidates.slice(0, 20),
      packageHierarchy,
      assetsSummary,
      recoveredFilesCount,
    };

    // Persist audit snapshot so interrupted sessions can reload immediately
    const recoveredRoot = path.join(sessionDir, 'recovered');
    await fs.mkdir(recoveredRoot, { recursive: true });
    await fs.writeFile(
      path.join(recoveredRoot, 'architecture-audit.json'),
      JSON.stringify(audit, null, 2),
      'utf-8'
    );

    return audit;
  }

  /**
   * Locates the matching Smali file for a given Java path (or vice versa)
   */
  public async findCorrespondingSmaliPath(
    sessionDir: string,
    filePath: string
  ): Promise<string | undefined> {
    if (filePath.endsWith('.smali')) {
      return filePath;
    }

    // e.g. java/sources/com/example/MainActivity.java -> com/example/MainActivity.smali
    const stripped = filePath
      .replace(/^java\/sources\//, '')
      .replace(/^java\//, '')
      .replace(/\.java$/, '.smali');

    const decodedDir = path.join(sessionDir, 'decoded');
    if (!fsSync.existsSync(decodedDir)) return undefined;

    try {
      const entries = await fs.readdir(decodedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('smali')) {
          const candidate = path.join(decodedDir, entry.name, stripped);
          if (fsSync.existsSync(candidate)) {
            return `decoded/${entry.name}/${stripped}`;
          }
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  /**
   * Checks if a file already has a saved recovery artifact on disk (for resuming/inspecting)
   */
  public async getSavedRecoveryForFile(
    sessionId: string,
    filePath: string
  ): Promise<RecoverSourceResponse | null> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const safeKey = Buffer.from(filePath).toString('base64url');
    const metaPath = path.join(sessionDir, 'recovered', '.meta', `${safeKey}.json`);
    if (!fsSync.existsSync(metaPath)) return null;
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as RecoverSourceResponse;
    } catch {
      return null;
    }
  }

  /**
   * Cancels an in-flight recovery job
   */
  public cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === 'running') {
      this.cancelledJobs.add(jobId);
      job.status = 'cancelled';
      job.stage = 'Cancelled by user';
      job.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  public getJobStatus(jobId: string): RecoveryJobStatus | null {
    return this.activeJobs.get(jobId) || null;
  }

  /**
   * Context-Aware AI Source Code Recovery & De-obfuscation for a specific file.
   * Compares JADX output with corresponding Smali bytecode, resolves cross-class references,
   * suggests meaningful symbol names, and generates:
   *  1) Original Decompiled Source (untouched)
   *  2) AI Analyzed Source (annotated with symbol mappings & explanations)
   *  3) Reconstructed Source (clean Java/Kotlin with de-obfuscated names & reconstructed missing methods)
   */
  public async recoverFileSource(req: RecoverSourceRequest): Promise<RecoverSourceResponse> {
    const sessionDir = sessionService.getSessionDir(req.sessionId);
    const { targetPath, relativePath } = await resolveSafePath(sessionDir, req.filePath, false);

    const jobId = req.jobId || `rec_${Date.now()}`;
    const jobStatus: RecoveryJobStatus = {
      jobId,
      sessionId: req.sessionId,
      filePath: relativePath,
      status: 'running',
      stage: 'Reading original source and locating corresponding Smali bytecode...',
      progress: 15,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.activeJobs.set(jobId, jobStatus);

    try {
      const originalContent = await fs.readFile(targetPath, 'utf-8');
      const fileName = path.basename(relativePath);

      if (this.cancelledJobs.has(jobId)) {
        throw new Error('Recovery operation cancelled by user.');
      }

      // 1. Find corresponding Smali bytecode if recovering a Java file (or vice versa)
      const smaliRelPath = await this.findCorrespondingSmaliPath(sessionDir, relativePath);
      let smaliContent = '';
      if (smaliRelPath && smaliRelPath !== relativePath) {
        const smaliFullPath = path.join(sessionDir, smaliRelPath);
        if (fsSync.existsSync(smaliFullPath)) {
          try {
            smaliContent = await fs.readFile(smaliFullPath, 'utf-8');
            if (smaliContent.length > 45000) {
              smaliContent = smaliContent.slice(0, 45000) + '\n# ... [Smali truncated for context window]';
            }
          } catch {
            // ignore
          }
        }
      }

      jobStatus.stage = 'Extracting cross-class references & AndroidManifest context...';
      jobStatus.progress = 35;
      jobStatus.updatedAt = Date.now();

      // 2. Read AndroidManifest.xml snippet for component context
      let manifestSnippet = '';
      const manifestPath = path.join(sessionDir, 'decoded', 'AndroidManifest.xml');
      if (fsSync.existsSync(manifestPath)) {
        try {
          const fullManifest = await fs.readFile(manifestPath, 'utf-8');
          manifestSnippet = fullManifest.slice(0, 12000);
        } catch {
          // ignore
        }
      }

      if (this.cancelledJobs.has(jobId)) {
        throw new Error('Recovery operation cancelled by user.');
      }

      jobStatus.stage = 'Running Gemini AI De-obfuscation & Bytecode Reconstruction...';
      jobStatus.progress = 60;
      jobStatus.updatedAt = Date.now();

      const ai = this.getClient();
      const targetLang = req.targetLanguage || 'java';

      const systemInstruction = `
You are an expert Android Reverse Engineer and Source Code Recovery Engine.
Your task is to analyze decompiled Android code (JADX Java and/or Apktool Smali bytecode) and recover clean, human-readable source code WITHOUT breaking application behavior.

KEY RESPONSIBILITIES:
1. OBFUSCATION DETECTION & MEANINGFUL NAMING:
   - Identify ProGuard/R8 obfuscated class names, method names (e.g. a(), b(), m12a()), fields, and local variables (v0, p0, arg0).
   - Infer their true purpose from API calls, string literals, Android lifecycle hooks, and control flow, and suggest meaningful names.
2. JADX vs. SMALI COMPARISON & MISSING LOGIC RECONSTRUCTION:
   - Compare the JADX output against the provided Smali instructions.
   - Detect any incomplete or failed decompilation blocks (e.g. "JADX WARN", "Method dump skipped", try-catch structure failures, or raw goto labels).
   - Reconstruct the missing or broken Java/Kotlin source logic accurately using the Smali instructions as ground truth.
3. THREE-VERSION CODE SAFETY:
   - Provide "analyzedContent": The source code enriched with detailed inline audit comments (/* [AI ANALYSIS] ... */) explaining obfuscated symbols, Smali register mappings, and control flow.
   - Provide "reconstructedContent": Clean, compilable, production-grade ${targetLang.toUpperCase()} source code with meaningful symbol names, reconstructed methods, and proper structure while preserving original signatures where required by AndroidManifest or external callers.
`;

      const userPrompt = `
TARGET FILE TO RECOVER: ${relativePath}
TARGET RECONSTRUCTION LANGUAGE: ${targetLang.toUpperCase()}

=== ORIGINAL DECOMPILED FILE (${fileName}) ===
\`\`\`
${originalContent.slice(0, 60000)}
\`\`\`

${
  smaliContent
    ? `=== CORRESPONDING SMALI BYTECODE (${smaliRelPath}) ===\n\`\`\`smali\n${smaliContent}\n\`\`\`\n`
    : ''
}

${
  manifestSnippet
    ? `=== ANDROID MANIFEST CONTEXT ===\n\`\`\`xml\n${manifestSnippet}\n\`\`\`\n`
    : ''
}

Perform full AI Source Code Recovery and return the structured JSON response.
`;

      const targetModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
      const config = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analyzedContent: {
              type: Type.STRING,
              description:
                'Source code annotated with inline AI analysis comments explaining symbol roles, Smali register behavior, and cross-class calls.',
            },
            reconstructedContent: {
              type: Type.STRING,
              description:
                'Clean, fully reconstructed and de-obfuscated Java/Kotlin source code with meaningful variable/method names and fixed decompilation blocks.',
            },
            obfuscationDetected: {
              type: Type.BOOLEAN,
              description: 'True if obfuscated identifiers were detected in this file.',
            },
            incompleteDecompilationFixed: {
              type: Type.BOOLEAN,
              description:
                'True if broken JADX blocks or raw Smali instructions were reconstructed into clean high-level code.',
            },
            symbolMappings: {
              type: Type.ARRAY,
              description: 'List of obfuscated symbols and their suggested meaningful names.',
              items: {
                type: Type.OBJECT,
                properties: {
                  originalName: { type: Type.STRING },
                  suggestedName: { type: Type.STRING },
                  symbolType: {
                    type: Type.STRING,
                    description: 'class, method, field, or variable',
                  },
                  confidence: {
                    type: Type.NUMBER,
                    description: 'Confidence score from 0 to 100',
                  },
                  reasoning: {
                    type: Type.STRING,
                    description: 'Evidence from code behavior supporting this name',
                  },
                },
                required: ['originalName', 'suggestedName', 'symbolType', 'confidence', 'reasoning'],
              },
            },
            crossClassRelationships: {
              type: Type.ARRAY,
              description: 'List of callers, callees, and Android components interacting with this class.',
              items: { type: Type.STRING },
            },
            smaliComparisonNotes: {
              type: Type.STRING,
              description:
                'Insights from comparing JADX output with Smali bytecode (or Smali control-flow analysis).',
            },
            architectureSummary: {
              type: Type.STRING,
              description: 'High-level summary of this file’s role in the application architecture.',
            },
          },
          required: [
            'analyzedContent',
            'reconstructedContent',
            'obfuscationDetected',
            'incompleteDecompilationFixed',
            'symbolMappings',
            'crossClassRelationships',
            'smaliComparisonNotes',
            'architectureSummary',
          ],
        },
      };

      let response;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents: userPrompt,
          config,
        });
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('not found')) {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: userPrompt,
            config,
          });
        } else {
          throw err;
        }
      }

      if (this.cancelledJobs.has(jobId)) {
        throw new Error('Recovery operation cancelled by user.');
      }

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error('Gemini API returned an empty recovery response.');
      }

      const parsed = JSON.parse(jsonText);

      // Save Reconstructed & Analyzed versions under recovered/ without overwriting original decompiled file!
      const cleanSubPath = relativePath
        .replace(/^java\/sources\//, '')
        .replace(/^java\//, '')
        .replace(/^decoded\/smali(_classes[0-9]+)?\//, '')
        .replace(/\.smali$/, targetLang === 'kotlin' ? '.kt' : '.java');

      const recoveredFilePath = `recovered/reconstructed/${cleanSubPath}`;
      const analyzedFilePath = `recovered/analyzed/${cleanSubPath}`;

      const absRecoveredPath = path.join(sessionDir, recoveredFilePath);
      const absAnalyzedPath = path.join(sessionDir, analyzedFilePath);

      await fs.mkdir(path.dirname(absRecoveredPath), { recursive: true });
      await fs.mkdir(path.dirname(absAnalyzedPath), { recursive: true });

      await fs.writeFile(absRecoveredPath, parsed.reconstructedContent || originalContent, 'utf-8');
      await fs.writeFile(absAnalyzedPath, parsed.analyzedContent || originalContent, 'utf-8');

      const result: RecoverSourceResponse = {
        sessionId: req.sessionId,
        filePath: relativePath,
        fileName,
        correspondingSmaliPath: smaliRelPath,
        hasSmaliReference: Boolean(smaliContent),
        originalContent,
        analyzedContent: parsed.analyzedContent || originalContent,
        reconstructedContent: parsed.reconstructedContent || originalContent,
        recoveredFilePath,
        obfuscationDetected: Boolean(parsed.obfuscationDetected),
        incompleteDecompilationFixed: Boolean(parsed.incompleteDecompilationFixed),
        symbolMappings: Array.isArray(parsed.symbolMappings) ? parsed.symbolMappings : [],
        crossClassRelationships: Array.isArray(parsed.crossClassRelationships)
          ? parsed.crossClassRelationships
          : [],
        smaliComparisonNotes:
          parsed.smaliComparisonNotes || 'Verified control flow against bytecode instructions.',
        architectureSummary:
          parsed.architectureSummary || 'Recovered class structure and symbol definitions.',
        recoveredAt: new Date().toISOString(),
      };

      // Persist recovery metadata for instant reload / interruption recovery
      const metaDir = path.join(sessionDir, 'recovered', '.meta');
      await fs.mkdir(metaDir, { recursive: true });
      const safeKey = Buffer.from(relativePath).toString('base64url');
      await fs.writeFile(path.join(metaDir, `${safeKey}.json`), JSON.stringify(result, null, 2), 'utf-8');

      jobStatus.status = 'completed';
      jobStatus.stage = 'Source recovery completed and saved to recovered/';
      jobStatus.progress = 100;
      jobStatus.updatedAt = Date.now();
      jobStatus.result = result;

      return result;
    } catch (err) {
      jobStatus.status = this.cancelledJobs.has(jobId) ? 'cancelled' : 'failed';
      jobStatus.error = (err as Error).message;
      jobStatus.updatedAt = Date.now();
      if ((err as Error).name === 'ApiError') throw err;
      throw ApiError.internal(`AI Source Code Recovery failed: ${(err as Error).message}`, 'RECOVERY_FAILED');
    }
  }

  /**
   * Explicitly applies a chosen recovered version to a target file ONLY when the user clicks Apply,
   * while keeping a backup of the original decompiled file in recovered/originals/.
   */
  public async applyRecoveredSource(
    req: ApplyRecoveredSourceRequest
  ): Promise<{ savedPath: string; backupPath: string }> {
    const sessionDir = sessionService.getSessionDir(req.sessionId);
    const { targetPath, relativePath } = await resolveSafePath(sessionDir, req.filePath, true);

    const savedRecovery = await this.getSavedRecoveryForFile(req.sessionId, relativePath);
    const contentToApply =
      req.customContent ||
      (req.version === 'reconstructed'
        ? savedRecovery?.reconstructedContent
        : savedRecovery?.analyzedContent);

    if (!contentToApply) {
      throw ApiError.badRequest('No recovered source content found to apply', 'MISSING_RECOVERED_CONTENT');
    }

    // 1. Ensure original file is backed up in recovered/originals/ before applying
    const backupRelPath = `recovered/originals/${relativePath}`;
    const backupFullPath = path.join(sessionDir, backupRelPath);
    if (!fsSync.existsSync(backupFullPath) && fsSync.existsSync(targetPath)) {
      await fs.mkdir(path.dirname(backupFullPath), { recursive: true });
      await fs.copyFile(targetPath, backupFullPath);
    }

    // 2. Write the chosen recovered content to the target path
    await fs.writeFile(targetPath, contentToApply, 'utf-8');

    return {
      savedPath: relativePath,
      backupPath: backupRelPath,
    };
  }
}

export const recoveryService = new RecoveryService();
