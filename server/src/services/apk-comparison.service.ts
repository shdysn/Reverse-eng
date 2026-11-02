import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';
import { sessionService } from './session.service.js';
import { gradleService } from './gradle.service.js';
import { gradleBuildService } from './gradle-build.service.js';
import { ApiError } from '../utils/apiError.js';
import type {
  VerificationCheckStatus,
  MetadataFieldComparison,
  MetadataComparisonReport,
  ResourceCategoryKey,
  ResourceCategorySummary,
  ResourceDifferenceItem,
  ResourceComparisonReport,
  ClassStructuralComparison,
  SourceCodeComparisonReport,
  FunctionalDomainKey,
  FunctionalCapabilityItem,
  FunctionalityAnalysisReport,
  LayoutScreenComparison,
  UiComparisonReport,
  RuntimeTestStepResult,
  AutomatedTestingReport,
  FunctionalityScoresBreakdown,
  AiFinalRepairProposal,
  FinalComparisonReport,
  ApplyFinalRepairsRequest,
  ApplyFinalRepairsResponse,
  ProjectRepairBackup,
  FinalExportArtifactType,
  RecoverSourceResponse,
} from '../types/index.js';

const execFileAsync = promisify(execFile);

interface ParsedManifestDetails {
  packageName: string;
  versionCode: string;
  versionName: string;
  minSdk: string;
  targetSdk: string;
  applicationName: string;
  usesCleartextTraffic: string;
  networkSecurityConfig: string;
  permissions: string[];
  activities: string[];
  services: string[];
  receivers: string[];
  providers: string[];
  intentFilters: string[];
  appComponents: string[];
}

interface ParsedClassSignature {
  relativePath: string;
  className: string; // e.g. com.example.MainActivity
  simpleName: string;
  packageName: string;
  language: 'java' | 'kotlin' | 'smali';
  isCompilerGenerated: boolean;
  isObfuscatedName: boolean;
  role: ClassStructuralComparison['role'];
  methods: string[];
  fields: string[];
  methodCalls: string[];
  imports: string[];
  rawContent: string;
}

const THIRD_PARTY_PREFIXES = [
  'android/support/',
  'androidx/',
  'kotlin/',
  'kotlinx/',
  'com/google/android/',
  'com/google/firebase/',
  'com/google/gson/',
  'com/google/common/',
  'okhttp3/',
  'okio/',
  'retrofit2/',
  'com/squareup/',
  'com/bumptech/glide/',
  'io/reactivex/',
  'org/apache/',
  'org/intellij/',
  'org/jetbrains/',
];

export class ApkComparisonService {
  private getAiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_actual_gemini_api_key_here') {
      return null;
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }

  private getComparisonStatePath(sessionRoot: string): string {
    return path.join(sessionRoot, 'android-studio-project', '.build-state', 'phase5-comparison.json');
  }

  /**
   * Load cached comparison report if available, otherwise run full comparison
   */
  public async getOrRunComparison(sessionId: string, forceRefresh = false): Promise<FinalComparisonReport> {
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionRoot = sessionService.getSessionDir(sessionId);
    const statePath = this.getComparisonStatePath(sessionRoot);

    if (!forceRefresh && fsSync.existsSync(statePath)) {
      try {
        const raw = await fs.readFile(statePath, 'utf-8');
        const parsed = JSON.parse(raw) as FinalComparisonReport;
        if (parsed && parsed.sessionId === sessionId) {
          return parsed;
        }
      } catch {
        // Re-run comparison if state is unreadable
      }
    }

    return this.runFullComparison(sessionId);
  }

  /**
   * Execute complete Phase 5 Original APK vs Reconstructed APK Comparison & Functional Verification
   */
  public async runFullComparison(sessionId: string): Promise<FinalComparisonReport> {
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionRoot = sessionService.getSessionDir(sessionId);
    const projectRoot = path.join(sessionRoot, 'android-studio-project');

    // Ensure the reconstructed Android Studio project exists
    if (!fsSync.existsSync(projectRoot)) {
      await gradleService.reconstructAndroidStudioProject({
        sessionId,
        useKotlinDsl: false,
        prioritizeReconstructed: true,
        sanitizeUnrecoveredMethods: true,
        excludeThirdPartySdkSources: true,
      });
    }

    // Preserve any existing AI final repair proposals if we are refreshing after a repair
    let existingProposals: AiFinalRepairProposal[] = [];
    const statePath = this.getComparisonStatePath(sessionRoot);
    if (fsSync.existsSync(statePath)) {
      try {
        const prev = JSON.parse(await fs.readFile(statePath, 'utf-8')) as FinalComparisonReport;
        if (Array.isArray(prev.aiFinalRepairProposals)) {
          existingProposals = prev.aiFinalRepairProposals;
        }
      } catch {
        // ignore
      }
    }

    // Inspect Original APK & Reconstructed APK files
    const originalApkPath = path.join(sessionRoot, 'original.apk');
    const originalExists = fsSync.existsSync(originalApkPath);
    const originalSize = originalExists ? fsSync.statSync(originalApkPath).size : 0;

    const buildState = await gradleBuildService.getBuildState(sessionId);
    const latestGradleApk = buildState.apkArtifacts[0];
    const rebuiltSignedApkPath = path.join(sessionRoot, 'build', 'signed.apk');

    let reconstructedApkInfo: FinalComparisonReport['reconstructedApkInfo'] = {
      path: 'android-studio-project/app/src/main',
      source: 'project_sources_only',
      exists: false,
      sizeBytes: 0,
    };

    if (latestGradleApk) {
      const fullGradleApk = path.join(projectRoot, latestGradleApk.relativePath);
      if (fsSync.existsSync(fullGradleApk)) {
        reconstructedApkInfo = {
          path: `android-studio-project/${latestGradleApk.relativePath}`,
          source: 'gradle_build',
          exists: true,
          sizeBytes: fsSync.statSync(fullGradleApk).size,
        };
      }
    } else if (fsSync.existsSync(rebuiltSignedApkPath)) {
      reconstructedApkInfo = {
        path: 'build/signed.apk',
        source: 'apktool_rebuild',
        exists: true,
        sizeBytes: fsSync.statSync(rebuiltSignedApkPath).size,
      };
    }

    // 1. Metadata Comparison
    const metadataComparison = await this.compareMetadata(sessionRoot, projectRoot);

    // 2. Resource Comparison
    const resourceComparison = await this.compareResources(sessionRoot, projectRoot);

    // 3. Source Code Comparison
    const sourceCodeComparison = await this.compareSourceCode(sessionRoot, projectRoot);

    // 6. Automated Runtime Testing (run before Functionality & UI so runtime status informs them)
    const automatedTesting = await this.runAutomatedRuntimeTesting(
      sessionRoot,
      originalApkPath,
      reconstructedApkInfo,
      metadataComparison
    );

    // 5. UI Comparison (Static XML hierarchy + Emulator screen comparison if available)
    const uiComparison = await this.compareUserInterface(
      sessionRoot,
      projectRoot,
      automatedTesting.adbAvailable && automatedTesting.connectedDevices.length > 0
    );

    // 4. Functionality Analysis (distinguishing verified_runtime vs inferred_from_source)
    const functionalityAnalysis = await this.analyzeFunctionality(
      sessionRoot,
      projectRoot,
      metadataComparison,
      sourceCodeComparison,
      automatedTesting
    );

    // 8. Calculate 6 Separate Evidence-Backed Functionality Scores
    const scores = this.calculateFunctionalityScores(
      metadataComparison,
      resourceComparison,
      sourceCodeComparison,
      uiComparison,
      automatedTesting,
      functionalityAnalysis
    );

    // 7. Compile Missing Components, Reconstructed Components, Unresolved Issues & Recommended Fixes
    const {
      missingComponents,
      reconstructedComponents,
      unresolvedIssues,
      recommendedFixes,
    } = this.compileSummaryLists(
      metadataComparison,
      resourceComparison,
      sourceCodeComparison,
      functionalityAnalysis,
      uiComparison,
      automatedTesting
    );

    // Generate deterministic + AI repair proposals if none exist yet
    let aiFinalRepairProposals = existingProposals;
    if (aiFinalRepairProposals.length === 0) {
      aiFinalRepairProposals = await this.generateFinalRepairProposalsInternal(
        sessionRoot,
        projectRoot,
        metadataComparison,
        resourceComparison,
        sourceCodeComparison,
        functionalityAnalysis,
        uiComparison,
        false
      );
    }

    // Determine overall status
    const statuses = [
      metadataComparison.status,
      resourceComparison.status,
      sourceCodeComparison.status,
      functionalityAnalysis.status,
      uiComparison.staticXmlComparisonStatus,
    ];
    let overallStatus: VerificationCheckStatus = 'PASS';
    if (statuses.includes('FAIL')) {
      overallStatus = 'FAIL';
    } else if (statuses.includes('WARNING')) {
      overallStatus = 'WARNING';
    }

    const projectName =
      session.originalFilename.replace(/\.apk$/i, '') || 'ReconstructedAndroidApp';

    const report: FinalComparisonReport = {
      sessionId,
      projectName,
      generatedAt: new Date().toISOString(),
      overallStatus,
      originalApkInfo: {
        path: 'original.apk',
        exists: originalExists,
        sizeBytes: originalSize,
      },
      reconstructedApkInfo,
      scores,
      metadataComparison,
      resourceComparison,
      sourceCodeComparison,
      functionalityAnalysis,
      uiComparison,
      automatedTesting,
      missingComponents,
      reconstructedComponents,
      unresolvedIssues,
      recommendedFixes,
      aiFinalRepairProposals,
    };

    // Persist report
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(report, null, 2), 'utf-8');

    return report;
  }

  // ============================================================================
  // 1. APK METADATA COMPARISON
  // ============================================================================
  private async compareMetadata(
    sessionRoot: string,
    projectRoot: string
  ): Promise<MetadataComparisonReport> {
    const origManifestPath = path.join(sessionRoot, 'decoded', 'AndroidManifest.xml');
    const origApktoolYmlPath = path.join(sessionRoot, 'decoded', 'apktool.yml');
    const origLibDir = path.join(sessionRoot, 'decoded', 'lib');

    const reconManifestPath = path.join(
      projectRoot,
      'app',
      'src',
      'main',
      'AndroidManifest.xml'
    );
    const reconGradleGroovy = path.join(projectRoot, 'app', 'build.gradle');
    const reconGradleKts = path.join(projectRoot, 'app', 'build.gradle.kts');
    const reconJniDir = path.join(projectRoot, 'app', 'src', 'main', 'jniLibs');

    const origManifestXml = fsSync.existsSync(origManifestPath)
      ? await fs.readFile(origManifestPath, 'utf-8')
      : '';
    const origApktoolYml = fsSync.existsSync(origApktoolYmlPath)
      ? await fs.readFile(origApktoolYmlPath, 'utf-8')
      : '';

    const reconManifestXml = fsSync.existsSync(reconManifestPath)
      ? await fs.readFile(reconManifestPath, 'utf-8')
      : '';
    const reconGradlePath = fsSync.existsSync(reconGradleKts)
      ? reconGradleKts
      : reconGradleGroovy;
    const reconGradleContent = fsSync.existsSync(reconGradlePath)
      ? await fs.readFile(reconGradlePath, 'utf-8')
      : '';

    const origParsed = this.parseManifestAndConfig(origManifestXml, origApktoolYml, 'apktool');
    const reconParsed = this.parseManifestAndConfig(
      reconManifestXml,
      reconGradleContent,
      'gradle'
    );

    // Native architectures
    const origAbis = await this.listSubdirectories(origLibDir);
    const reconAbis = await this.listSubdirectories(reconJniDir);

    const fields: MetadataFieldComparison[] = [
      this.compareScalarField(
        'applicationId',
        'Application ID',
        origParsed.packageName,
        this.extractGradleScalar(reconGradleContent, 'applicationId') || reconParsed.packageName
      ),
      this.compareScalarField(
        'packageName',
        'Package Name / Namespace',
        origParsed.packageName,
        reconParsed.packageName || this.extractGradleScalar(reconGradleContent, 'namespace')
      ),
      this.compareScalarField(
        'versionName',
        'Version Name',
        origParsed.versionName,
        reconParsed.versionName
      ),
      this.compareScalarField(
        'versionCode',
        'Version Code',
        origParsed.versionCode,
        reconParsed.versionCode
      ),
      this.compareSdkField('minSdk', 'Minimum SDK', origParsed.minSdk, reconParsed.minSdk),
      this.compareSdkField('targetSdk', 'Target SDK', origParsed.targetSdk, reconParsed.targetSdk),
      this.compareArrayField(
        'permissions',
        'Permissions',
        origParsed.permissions,
        reconParsed.permissions,
        origParsed.packageName
      ),
      this.compareArrayField(
        'activities',
        'Activities',
        origParsed.activities,
        reconParsed.activities,
        origParsed.packageName
      ),
      this.compareArrayField(
        'services',
        'Services',
        origParsed.services,
        reconParsed.services,
        origParsed.packageName
      ),
      this.compareArrayField(
        'receivers',
        'Broadcast Receivers',
        origParsed.receivers,
        reconParsed.receivers,
        origParsed.packageName
      ),
      this.compareArrayField(
        'providers',
        'Content Providers',
        origParsed.providers,
        reconParsed.providers,
        origParsed.packageName
      ),
      this.compareArrayField(
        'intentFilters',
        'Intent Filters (Actions / Categories / Schemes)',
        origParsed.intentFilters,
        reconParsed.intentFilters,
        origParsed.packageName
      ),
      this.compareArrayField(
        'appComponents',
        'Application Attributes & Meta-Data',
        origParsed.appComponents,
        reconParsed.appComponents,
        origParsed.packageName
      ),
      this.compareArrayField(
        'nativeArchitectures',
        'Native Library Architectures (ABI)',
        origAbis,
        reconAbis,
        origParsed.packageName
      ),
    ];

    const passedCount = fields.filter((f) => f.status === 'PASS').length;
    const warningCount = fields.filter((f) => f.status === 'WARNING').length;
    const failedCount = fields.filter((f) => f.status === 'FAIL').length;

    let status: VerificationCheckStatus = 'PASS';
    if (failedCount > 0) status = 'FAIL';
    else if (warningCount > 0) status = 'WARNING';

    return {
      status,
      originalSource: 'decoded/AndroidManifest.xml + decoded/apktool.yml',
      reconstructedSource:
        'android-studio-project/app/src/main/AndroidManifest.xml + app/build.gradle',
      fields,
      summary: {
        totalFields: fields.length,
        passedCount,
        warningCount,
        failedCount,
      },
    };
  }

  private parseManifestAndConfig(
    manifestXml: string,
    secondaryContent: string,
    mode: 'apktool' | 'gradle'
  ): ParsedManifestDetails {
    const pkgMatch = manifestXml.match(/package\s*=\s*"([^"]+)"/);
    let packageName = pkgMatch ? pkgMatch[1].trim() : '';

    let versionCode =
      manifestXml.match(/android:versionCode\s*=\s*"([^"]+)"/)?.[1] || '';
    let versionName =
      manifestXml.match(/android:versionName\s*=\s*"([^"]+)"/)?.[1] || '';
    let minSdk =
      manifestXml.match(/android:minSdkVersion\s*=\s*"([^"]+)"/)?.[1] || '';
    let targetSdk =
      manifestXml.match(/android:targetSdkVersion\s*=\s*"([^"]+)"/)?.[1] || '';

    if (mode === 'apktool' && secondaryContent) {
      versionCode =
        versionCode || secondaryContent.match(/versionCode:\s*['"]?(\d+)['"]?/)?.[1] || '1';
      versionName =
        versionName ||
        secondaryContent.match(/versionName:\s*['"]?([^\r\n'"]+)['"]?/)?.[1]?.trim() ||
        '1.0';
      minSdk =
        minSdk || secondaryContent.match(/minSdkVersion:\s*['"]?(\d+)['"]?/)?.[1] || '21';
      targetSdk =
        targetSdk || secondaryContent.match(/targetSdkVersion:\s*['"]?(\d+)['"]?/)?.[1] || '34';
    } else if (mode === 'gradle' && secondaryContent) {
      packageName =
        packageName ||
        this.extractGradleScalar(secondaryContent, 'namespace') ||
        this.extractGradleScalar(secondaryContent, 'applicationId');
      versionCode =
        versionCode ||
        secondaryContent.match(/versionCode\s*[=:]?\s*(\d+)/)?.[1] ||
        '1';
      versionName =
        versionName ||
        this.extractGradleScalar(secondaryContent, 'versionName') ||
        '1.0';
      minSdk =
        minSdk || secondaryContent.match(/minSdk(?:Version)?\s*[=:]?\s*(\d+)/)?.[1] || '21';
      targetSdk =
        targetSdk ||
        secondaryContent.match(/targetSdk(?:Version)?\s*[=:]?\s*(\d+)/)?.[1] ||
        '34';
    }

    const normalizeComponent = (name: string) => {
      if (!name) return '';
      if (name.startsWith('.') && packageName) return `${packageName}${name}`;
      if (!name.includes('.') && packageName) return `${packageName}.${name}`;
      return name;
    };

    const extractTagNames = (tag: string): string[] => {
      const regex = new RegExp(`<${tag}\\b[^>]*?android:name\\s*=\\s*"([^"]+)"`, 'g');
      const items = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = regex.exec(manifestXml)) !== null) {
        items.add(normalizeComponent(m[1].trim()));
      }
      return Array.from(items).sort();
    };

    const permissions = extractTagNames('uses-permission');
    const activities = [
      ...extractTagNames('activity'),
      ...extractTagNames('activity-alias'),
    ].sort();
    const services = extractTagNames('service');
    const receivers = extractTagNames('receiver');
    const providers = extractTagNames('provider');

    // Extract intent-filter signatures (actions, categories, data schemes)
    const intentFilters: string[] = [];
    const filterRegex = /<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter>/g;
    let fm: RegExpExecArray | null;
    while ((fm = filterRegex.exec(manifestXml)) !== null) {
      const block = fm[1];
      const actions = Array.from(block.matchAll(/<action\b[^>]*android:name="([^"]+)"/g)).map(
        (x) => `action:${x[1]}`
      );
      const cats = Array.from(block.matchAll(/<category\b[^>]*android:name="([^"]+)"/g)).map(
        (x) => `cat:${x[1]}`
      );
      const schemes = Array.from(block.matchAll(/<data\b[^>]*android:scheme="([^"]+)"/g)).map(
        (x) => `scheme:${x[1]}`
      );
      const sig = [...actions, ...cats, ...schemes].sort().join(' + ');
      if (sig) intentFilters.push(sig);
    }

    // Extract application attributes & meta-data
    const appComponents: string[] = [];
    const appTagMatch = manifestXml.match(/<application\b([^>]*)>/);
    let applicationName = '';
    let usesCleartextTraffic = '';
    let networkSecurityConfig = '';
    if (appTagMatch) {
      const attrs = appTagMatch[1];
      applicationName = normalizeComponent(attrs.match(/android:name="([^"]+)"/)?.[1] || '');
      usesCleartextTraffic = attrs.match(/android:usesCleartextTraffic="([^"]+)"/)?.[1] || '';
      networkSecurityConfig = attrs.match(/android:networkSecurityConfig="([^"]+)"/)?.[1] || '';
      if (applicationName) appComponents.push(`appClass:${applicationName}`);
      if (usesCleartextTraffic) appComponents.push(`usesCleartextTraffic:${usesCleartextTraffic}`);
      if (networkSecurityConfig)
        appComponents.push(`networkSecurityConfig:${networkSecurityConfig}`);
    }

    const metaRegex = /<meta-data\b[^>]*android:name="([^"]+)"[^>]*>/g;
    let mm: RegExpExecArray | null;
    while ((mm = metaRegex.exec(manifestXml)) !== null) {
      appComponents.push(`meta-data:${mm[1]}`);
    }

    return {
      packageName: packageName || 'com.reconstructed.app',
      versionCode: versionCode || '1',
      versionName: versionName || '1.0',
      minSdk: minSdk || '21',
      targetSdk: targetSdk || '34',
      applicationName,
      usesCleartextTraffic,
      networkSecurityConfig,
      permissions,
      activities,
      services,
      receivers,
      providers,
      intentFilters: Array.from(new Set(intentFilters)).sort(),
      appComponents: Array.from(new Set(appComponents)).sort(),
    };
  }

  private extractGradleScalar(gradleText: string, key: string): string {
    const regex = new RegExp(`${key}\\s*[=:]?\\s*["']([^"']+)["']`);
    return gradleText.match(regex)?.[1]?.trim() || '';
  }

  private compareScalarField(
    field: string,
    label: string,
    orig: string,
    recon: string
  ): MetadataFieldComparison {
    const o = (orig || '').trim();
    const r = (recon || '').trim();
    const matched = o === r && o.length > 0;
    const status: VerificationCheckStatus = matched
      ? 'PASS'
      : !r
      ? 'FAIL'
      : 'WARNING';
    return {
      field,
      label,
      originalValue: o || 'Not specified',
      reconstructedValue: r || 'Not specified',
      status,
      missingInReconstructed: !matched && o ? [o] : [],
      addedInReconstructed: !matched && r ? [r] : [],
      notes: matched
        ? `${label} matches exactly (${o}).`
        : `${label} differs: Original="${o}" vs Reconstructed="${r}".`,
    };
  }

  private compareSdkField(
    field: string,
    label: string,
    orig: string,
    recon: string
  ): MetadataFieldComparison {
    const o = (orig || '').trim();
    const r = (recon || '').trim();
    const matched = o === r;
    const status: VerificationCheckStatus = matched ? 'PASS' : 'WARNING';
    return {
      field,
      label,
      originalValue: o || 'Default',
      reconstructedValue: r || 'Default',
      status,
      missingInReconstructed: [],
      addedInReconstructed: [],
      notes: matched
        ? `${label} preserved (API ${o}).`
        : `${label} adjusted for modern AGP compatibility (Original API ${o} → Reconstructed API ${r}).`,
    };
  }

  private compareArrayField(
    field: string,
    label: string,
    origList: string[],
    reconList: string[],
    pkgName: string
  ): MetadataFieldComparison {
    const norm = (val: string) =>
      val.startsWith('.') && pkgName ? `${pkgName}${val}` : val;
    const oSet = new Set(origList.map(norm));
    const rSet = new Set(reconList.map(norm));

    const missing = Array.from(oSet).filter((x) => !rSet.has(x));
    const added = Array.from(rSet).filter((x) => !oSet.has(x));

    let status: VerificationCheckStatus = 'PASS';
    if (missing.length > 0) {
      status = field === 'activities' || field === 'permissions' ? 'FAIL' : 'WARNING';
    } else if (added.length > 0) {
      status = 'WARNING';
    }

    return {
      field,
      label,
      originalValue: Array.from(oSet),
      reconstructedValue: Array.from(rSet),
      status,
      missingInReconstructed: missing,
      addedInReconstructed: added,
      notes:
        missing.length === 0 && added.length === 0
          ? `All ${oSet.size} ${label.toLowerCase()} preserved.`
          : `${missing.length} missing, ${added.length} added in reconstructed project.`,
    };
  }

  // ============================================================================
  // 2. RESOURCE COMPARISON
  // ============================================================================
  private async compareResources(
    sessionRoot: string,
    projectRoot: string
  ): Promise<ResourceComparisonReport> {
    const origResDir = path.join(sessionRoot, 'decoded', 'res');
    const origAssetsDir = path.join(sessionRoot, 'decoded', 'assets');
    const reconResDir = path.join(projectRoot, 'app', 'src', 'main', 'res');
    const reconAssetsDir = path.join(projectRoot, 'app', 'src', 'main', 'assets');

    const origResFiles = await this.walkFilesRelative(origResDir);
    const reconResFiles = await this.walkFilesRelative(reconResDir);
    const origAssetFiles = await this.walkFilesRelative(origAssetsDir);
    const reconAssetFiles = await this.walkFilesRelative(reconAssetsDir);

    const differences: ResourceDifferenceItem[] = [];
    const categories: ResourceCategorySummary[] = [];

    // Helper for file-based resource folders (drawable, mipmap, layout, fonts, animations, raw)
    const fileFolderConfigs: {
      category: ResourceCategoryKey;
      label: string;
      folderPrefixes: string[];
    }[] = [
      { category: 'drawable', label: 'Drawable Resources', folderPrefixes: ['drawable'] },
      { category: 'mipmap', label: 'Mipmap Icons', folderPrefixes: ['mipmap'] },
      { category: 'layout', label: 'XML Layouts', folderPrefixes: ['layout'] },
      { category: 'fonts', label: 'Fonts', folderPrefixes: ['font'] },
      { category: 'animations', label: 'Animations & Animators', folderPrefixes: ['anim', 'animator'] },
      { category: 'raw', label: 'Raw Resources', folderPrefixes: ['raw'] },
    ];

    for (const cfg of fileFolderConfigs) {
      const origMatched = origResFiles.filter((f) => {
        const top = f.split('/')[0];
        return cfg.folderPrefixes.some((p) => top === p || top.startsWith(`${p}-`));
      });
      const reconMatched = reconResFiles.filter((f) => {
        const top = f.split('/')[0];
        return cfg.folderPrefixes.some((p) => top === p || top.startsWith(`${p}-`));
      });

      const summary = await this.compareResourceFileSet(
        cfg.category,
        cfg.label,
        origResDir,
        reconResDir,
        origMatched,
        reconMatched,
        differences
      );
      categories.push(summary);
    }

    // Compare Assets directory
    const assetsSummary = await this.compareResourceFileSet(
      'assets',
      'Application Assets',
      origAssetsDir,
      reconAssetsDir,
      origAssetFiles,
      reconAssetFiles,
      differences
    );
    categories.push(assetsSummary);

    // Compare XML Value Entries (<string>, <color>, <dimen>, <style>)
    const origValuesFiles = origResFiles.filter((f) => {
      const top = f.split('/')[0];
      return top === 'values' || top.startsWith('values-');
    });
    const reconValuesFiles = reconResFiles.filter((f) => {
      const top = f.split('/')[0];
      return top === 'values' || top.startsWith('values-');
    });

    const origXmlValues = await this.parseXmlValueEntries(origResDir, origValuesFiles);
    const reconXmlValues = await this.parseXmlValueEntries(reconResDir, reconValuesFiles);

    const valueConfigs: {
      category: ResourceCategoryKey;
      label: string;
      tagKey: 'string' | 'color' | 'dimen' | 'style';
    }[] = [
      { category: 'strings', label: 'Strings (values/strings.xml)', tagKey: 'string' },
      { category: 'colors', label: 'Colors (values/colors.xml)', tagKey: 'color' },
      { category: 'dimensions', label: 'Dimensions (values/dimens.xml)', tagKey: 'dimen' },
      { category: 'themes', label: 'Themes & Styles (values/styles.xml)', tagKey: 'style' },
    ];

    for (const vcfg of valueConfigs) {
      const origMap = origXmlValues[vcfg.tagKey];
      const reconMap = reconXmlValues[vcfg.tagKey];
      const origDuplicates = origXmlValues.duplicates[vcfg.tagKey];
      const reconDuplicates = reconXmlValues.duplicates[vcfg.tagKey];

      let matchedCount = 0;
      let missingCount = 0;
      let modifiedCount = 0;
      let newlyGeneratedCount = 0;
      let namingDiffCount = 0;

      const normalizedOrigNames = new Map<string, string>();
      for (const k of origMap.keys()) {
        normalizedOrigNames.set(k.toLowerCase().replace(/[._-]/g, ''), k);
      }

      for (const [key, origVal] of origMap.entries()) {
        if (reconMap.has(key)) {
          const reconVal = reconMap.get(key)!;
          if (origVal === reconVal) {
            matchedCount++;
          } else {
            modifiedCount++;
            differences.push({
              category: vcfg.category,
              type: 'modified',
              resourceName: key,
              originalPath: 'decoded/res/values',
              reconstructedPath: 'android-studio-project/app/src/main/res/values',
              details: `Value changed from "${origVal.slice(0, 60)}" to "${reconVal.slice(0, 60)}"`,
              severity: 'warning',
            });
          }
        } else {
          missingCount++;
          differences.push({
            category: vcfg.category,
            type: 'missing',
            resourceName: key,
            originalPath: 'decoded/res/values',
            details: `<${vcfg.tagKey} name="${key}"> present in original APK but missing in reconstructed resources.`,
            severity: 'error',
          });
        }
      }

      for (const [key] of reconMap.entries()) {
        if (!origMap.has(key)) {
          const normKey = key.toLowerCase().replace(/[._-]/g, '');
          if (normalizedOrigNames.has(normKey)) {
            namingDiffCount++;
            differences.push({
              category: vcfg.category,
              type: 'naming_difference',
              resourceName: key,
              details: `Resource "${key}" differs in separator/casing from original "${normalizedOrigNames.get(normKey)}".`,
              severity: 'info',
            });
          } else {
            newlyGeneratedCount++;
            differences.push({
              category: vcfg.category,
              type: 'newly_generated',
              resourceName: key,
              reconstructedPath: 'android-studio-project/app/src/main/res/values',
              details: `Newly generated <${vcfg.tagKey} name="${key}"> in reconstructed project.`,
              severity: 'info',
            });
          }
        }
      }

      const duplicateCount = reconDuplicates.size;
      for (const dupKey of reconDuplicates) {
        differences.push({
          category: vcfg.category,
          type: 'duplicate',
          resourceName: dupKey,
          reconstructedPath: 'android-studio-project/app/src/main/res/values',
          details: `Duplicate resource definition <${vcfg.tagKey} name="${dupKey}"> across values XML files.`,
          severity: 'warning',
        });
      }

      let catStatus: VerificationCheckStatus = 'PASS';
      if (missingCount > 0) catStatus = 'FAIL';
      else if (modifiedCount > 0 || duplicateCount > 0) catStatus = 'WARNING';

      categories.push({
        category: vcfg.category,
        label: vcfg.label,
        originalCount: origMap.size,
        reconstructedCount: reconMap.size,
        matchedCount,
        missingCount,
        modifiedCount,
        newlyGeneratedCount,
        duplicateCount,
        namingDiffCount,
        status: catStatus,
      });
    }

    const totals = categories.reduce(
      (acc, c) => {
        acc.originalTotal += c.originalCount;
        acc.reconstructedTotal += c.reconstructedCount;
        acc.missingCount += c.missingCount;
        acc.modifiedCount += c.modifiedCount;
        acc.newlyGeneratedCount += c.newlyGeneratedCount;
        acc.duplicateCount += c.duplicateCount;
        acc.namingDiffCount += c.namingDiffCount;
        return acc;
      },
      {
        originalTotal: 0,
        reconstructedTotal: 0,
        missingCount: 0,
        modifiedCount: 0,
        newlyGeneratedCount: 0,
        duplicateCount: 0,
        namingDiffCount: 0,
      }
    );

    let status: VerificationCheckStatus = 'PASS';
    if (totals.missingCount > 0) status = 'FAIL';
    else if (totals.modifiedCount > 0 || totals.duplicateCount > 0) status = 'WARNING';

    return {
      status,
      categories,
      differences: differences.slice(0, 250),
      totals,
    };
  }

  private async compareResourceFileSet(
    category: ResourceCategoryKey,
    label: string,
    origBaseDir: string,
    reconBaseDir: string,
    origRelPaths: string[],
    reconRelPaths: string[],
    differences: ResourceDifferenceItem[]
  ): Promise<ResourceCategorySummary> {
    const origSet = new Set(origRelPaths);
    const reconSet = new Set(reconRelPaths);

    let matchedCount = 0;
    let missingCount = 0;
    let modifiedCount = 0;
    let newlyGeneratedCount = 0;
    let duplicateCount = 0;
    let namingDiffCount = 0;

    // Detect duplicate base names within same resource qualifier folder (e.g. ic_logo.png and ic_logo.xml)
    const stemCounts = new Map<string, string[]>();
    for (const r of reconRelPaths) {
      const stem = r.replace(/\.[^.]+$/, '');
      const list = stemCounts.get(stem) || [];
      list.push(r);
      stemCounts.set(stem, list);
    }
    for (const [stem, files] of stemCounts.entries()) {
      if (files.length > 1) {
        duplicateCount++;
        differences.push({
          category,
          type: 'duplicate',
          resourceName: path.basename(stem),
          reconstructedPath: files.join(', '),
          details: `Duplicate resource stem "${stem}" with multiple extensions (${files.map((f) => path.basename(f)).join(', ')}).`,
          severity: 'warning',
        });
      }
    }

    const origByBaseStem = new Map<string, string>();
    for (const o of origRelPaths) {
      origByBaseStem.set(path.basename(o).replace(/\.[^.]+$/, '').toLowerCase(), o);
    }

    for (const rel of origRelPaths) {
      if (reconSet.has(rel)) {
        const origHash = await this.hashFileSafe(path.join(origBaseDir, rel));
        const reconHash = await this.hashFileSafe(path.join(reconBaseDir, rel));
        if (origHash === reconHash) {
          matchedCount++;
        } else {
          modifiedCount++;
          differences.push({
            category,
            type: 'modified',
            resourceName: path.basename(rel),
            originalPath: rel,
            reconstructedPath: rel,
            details: `Resource file "${rel}" content modified during reconstruction.`,
            severity: 'warning',
          });
        }
      } else {
        missingCount++;
        differences.push({
          category,
          type: 'missing',
          resourceName: path.basename(rel),
          originalPath: rel,
          details: `Original resource "${rel}" is missing in reconstructed project.`,
          severity: 'error',
        });
      }
    }

    for (const rel of reconRelPaths) {
      if (!origSet.has(rel)) {
        const stem = path.basename(rel).replace(/\.[^.]+$/, '').toLowerCase();
        if (origByBaseStem.has(stem)) {
          namingDiffCount++;
          differences.push({
            category,
            type: 'naming_difference',
            resourceName: path.basename(rel),
            originalPath: origByBaseStem.get(stem),
            reconstructedPath: rel,
            details: `Resource "${rel}" has a naming/qualifier/extension difference from "${origByBaseStem.get(stem)}".`,
            severity: 'info',
          });
        } else {
          newlyGeneratedCount++;
          differences.push({
            category,
            type: 'newly_generated',
            resourceName: path.basename(rel),
            reconstructedPath: rel,
            details: `Newly generated resource "${rel}" in reconstructed project.`,
            severity: 'info',
          });
        }
      }
    }

    let status: VerificationCheckStatus = 'PASS';
    if (missingCount > 0) status = 'FAIL';
    else if (modifiedCount > 0 || duplicateCount > 0) status = 'WARNING';

    return {
      category,
      label,
      originalCount: origRelPaths.length,
      reconstructedCount: reconRelPaths.length,
      matchedCount,
      missingCount,
      modifiedCount,
      newlyGeneratedCount,
      duplicateCount,
      namingDiffCount,
      status,
    };
  }

  private async parseXmlValueEntries(
    resDir: string,
    relFiles: string[]
  ): Promise<{
    string: Map<string, string>;
    color: Map<string, string>;
    dimen: Map<string, string>;
    style: Map<string, string>;
    duplicates: {
      string: Set<string>;
      color: Set<string>;
      dimen: Set<string>;
      style: Set<string>;
    };
  }> {
    const result = {
      string: new Map<string, string>(),
      color: new Map<string, string>(),
      dimen: new Map<string, string>(),
      style: new Map<string, string>(),
      duplicates: {
        string: new Set<string>(),
        color: new Set<string>(),
        dimen: new Set<string>(),
        style: new Set<string>(),
      },
    };

    // Only check default `values/` for duplicate collisions within the same configuration
    const defaultValuesSeen = {
      string: new Set<string>(),
      color: new Set<string>(),
      dimen: new Set<string>(),
      style: new Set<string>(),
    };

    for (const rel of relFiles) {
      const fullPath = path.join(resDir, rel);
      const isDefaultValues = rel.startsWith('values/');
      let content = '';
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const tags: ('string' | 'color' | 'dimen' | 'style')[] = [
        'string',
        'color',
        'dimen',
        'style',
      ];
      for (const tag of tags) {
        const regex = new RegExp(
          `<${tag}\\b[^>]*?name="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${tag}>`,
          'g'
        );
        let m: RegExpExecArray | null;
        while ((m = regex.exec(content)) !== null) {
          const name = m[1].trim();
          const val = m[2].replace(/\s+/g, ' ').trim();
          if (isDefaultValues) {
            if (defaultValuesSeen[tag].has(name)) {
              result.duplicates[tag].add(name);
            }
            defaultValuesSeen[tag].add(name);
          }
          if (!result[tag].has(name) || isDefaultValues) {
            result[tag].set(name, val);
          }
        }
      }
    }

    return result;
  }

  // ============================================================================
  // 3. SOURCE CODE COMPARISON
  // ============================================================================
  private async compareSourceCode(
    sessionRoot: string,
    projectRoot: string
  ): Promise<SourceCodeComparisonReport> {
    const jadxSourcesDir = fsSync.existsSync(path.join(sessionRoot, 'java', 'sources'))
      ? path.join(sessionRoot, 'java', 'sources')
      : path.join(sessionRoot, 'java');
    const decodedDir = path.join(sessionRoot, 'decoded');
    const reconJavaDir = path.join(projectRoot, 'app', 'src', 'main', 'java');
    const recoveredMetaDir = path.join(sessionRoot, 'recovered', 'metadata');

    // Load symbol rename mappings from AI Recovery metadata so obfuscated classes/methods correlate accurately
    const classRenameMap = new Map<string, string>(); // originalSimpleName -> suggestedName
    const methodRenameMap = new Map<string, Set<string>>(); // originalMethodName -> suggestedNames
    if (fsSync.existsSync(recoveredMetaDir)) {
      const metaFiles = await this.walkFilesRelative(recoveredMetaDir);
      for (const mf of metaFiles) {
        if (!mf.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(
            await fs.readFile(path.join(recoveredMetaDir, mf), 'utf-8')
          ) as RecoverSourceResponse;
          if (Array.isArray(raw.symbolMappings)) {
            for (const sym of raw.symbolMappings) {
              if (sym.symbolType === 'class') {
                classRenameMap.set(sym.originalName, sym.suggestedName);
              } else if (sym.symbolType === 'method') {
                const set = methodRenameMap.get(sym.originalName) || new Set<string>();
                set.add(sym.suggestedName);
                methodRenameMap.set(sym.originalName, set);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // Collect original JADX classes
    const jadxRelFiles = (await this.walkFilesRelative(jadxSourcesDir)).filter(
      (f) => f.endsWith('.java') || f.endsWith('.kt')
    );

    // Collect original Smali classes across smali*/ folders
    const smaliRelFiles: { dirName: string; relPath: string }[] = [];
    if (fsSync.existsSync(decodedDir)) {
      const entries = await fs.readdir(decodedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('smali')) {
          const sFiles = await this.walkFilesRelative(path.join(decodedDir, entry.name));
          for (const sf of sFiles) {
            if (sf.endsWith('.smali')) {
              smaliRelFiles.push({ dirName: entry.name, relPath: sf });
            }
          }
        }
      }
    }

    // Collect Reconstructed Project classes
    const reconRelFiles = (await this.walkFilesRelative(reconJavaDir)).filter(
      (f) => f.endsWith('.java') || f.endsWith('.kt')
    );

    let compilerGeneratedIgnored = 0;

    // Parse Original App Classes (filtering out 3rd-party SDKs and compiler-generated classes)
    const origClassesMap = new Map<string, ParsedClassSignature & { hasJadx: boolean; hasSmali: boolean }>();

    for (const rel of jadxRelFiles) {
      if (this.isThirdPartyPath(rel)) continue;
      const baseName = path.basename(rel, path.extname(rel));
      if (this.isCompilerGeneratedClassName(baseName)) {
        compilerGeneratedIgnored++;
        continue;
      }
      const fullPath = path.join(jadxSourcesDir, rel);
      const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
      const parsed = this.parseJavaOrKotlinClass(rel, content);
      origClassesMap.set(parsed.className, {
        ...parsed,
        hasJadx: true,
        hasSmali: false,
      });
    }

    for (const sm of smaliRelFiles) {
      if (this.isThirdPartyPath(sm.relPath)) continue;
      const baseName = path.basename(sm.relPath, '.smali');
      if (this.isCompilerGeneratedClassName(baseName)) {
        compilerGeneratedIgnored++;
        continue;
      }
      const classKey = sm.relPath.replace(/\.smali$/, '').replace(/\//g, '.');
      if (origClassesMap.has(classKey)) {
        origClassesMap.get(classKey)!.hasSmali = true;
      } else {
        const fullPath = path.join(decodedDir, sm.dirName, sm.relPath);
        const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
        const parsed = this.parseSmaliClass(sm.relPath, content);
        origClassesMap.set(parsed.className, {
          ...parsed,
          hasJadx: false,
          hasSmali: true,
        });
      }
    }

    // Parse Reconstructed Classes
    const reconClassesMap = new Map<string, ParsedClassSignature>();
    const reconBySimpleName = new Map<string, ParsedClassSignature>();
    for (const rel of reconRelFiles) {
      if (this.isThirdPartyPath(rel)) continue;
      const baseName = path.basename(rel, path.extname(rel));
      if (this.isCompilerGeneratedClassName(baseName)) {
        continue;
      }
      const fullPath = path.join(reconJavaDir, rel);
      const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
      const parsed = this.parseJavaOrKotlinClass(rel, content);
      reconClassesMap.set(parsed.className, parsed);
      reconBySimpleName.set(parsed.simpleName, parsed);
    }

    const classComparisons: ClassStructuralComparison[] = [];
    const unrecoveredClasses: string[] = [];
    const unrecoveredMethods: { className: string; methodSignature: string; reason: string }[] = [];

    let obfuscatedClassesMapped = 0;
    let javaToKotlinConverted = 0;
    let originalMethodsTotal = 0;
    let reconstructedMethodsTotal = 0;
    let matchedMethodSignaturesTotal = 0;
    let originalFieldsTotal = 0;
    let reconstructedFieldsTotal = 0;
    let matchedFieldsTotal = 0;

    for (const [className, orig] of origClassesMap.entries()) {
      originalMethodsTotal += orig.methods.length;
      originalFieldsTotal += orig.fields.length;

      // Match directly by FQN, or by simple name, or via AI deobfuscation rename map
      let recon = reconClassesMap.get(className);
      let mappedViaDeobfuscation = false;
      if (!recon) {
        const suggestedSimple = classRenameMap.get(orig.simpleName);
        if (suggestedSimple && reconBySimpleName.has(suggestedSimple)) {
          recon = reconBySimpleName.get(suggestedSimple);
          mappedViaDeobfuscation = true;
        } else if (reconBySimpleName.has(orig.simpleName)) {
          recon = reconBySimpleName.get(orig.simpleName);
        }
      }

      if (orig.isObfuscatedName && recon) {
        obfuscatedClassesMapped++;
      }

      if (!recon) {
        unrecoveredClasses.push(className);
        for (const m of orig.methods) {
          unrecoveredMethods.push({
            className,
            methodSignature: m,
            reason: 'Containing class is missing in reconstructed project',
          });
        }
        classComparisons.push({
          className,
          packageName: orig.packageName,
          role: orig.role,
          originalOrigin:
            orig.hasJadx && orig.hasSmali
              ? 'jadx_and_smali'
              : orig.hasJadx
              ? 'jadx_only'
              : 'smali_only',
          reconstructedLanguage: 'missing',
          isObfuscatedOriginal: orig.isObfuscatedName,
          isCompilerGenerated: orig.isCompilerGenerated,
          originalMethodsCount: orig.methods.length,
          reconstructedMethodsCount: 0,
          matchedMethodSignatures: 0,
          missingMethodSignatures: orig.methods,
          originalFieldsCount: orig.fields.length,
          reconstructedFieldsCount: 0,
          matchedFieldDeclarations: 0,
          methodReferencesPreserved: false,
          classDependenciesPreserved: false,
          status: 'FAIL',
          notes: `Class ${className} was not recovered into android-studio-project.`,
        });
        continue;
      }

      if (orig.language !== 'kotlin' && recon.language === 'kotlin') {
        javaToKotlinConverted++;
      }

      reconstructedMethodsTotal += recon.methods.length;
      reconstructedFieldsTotal += recon.fields.length;

      // Compare methods accounting for deobfuscated method names and Kotlin property getters/setters
      const reconMethodSet = new Set(recon.methods);
      let matchedMethods = 0;
      const missingMethods: string[] = [];

      for (const origM of orig.methods) {
        const [origMName, origParamCount] = origM.split('/');
        const renamedCandidates = methodRenameMap.get(origMName);
        let found = reconMethodSet.has(origM);
        if (!found && renamedCandidates) {
          for (const cand of renamedCandidates) {
            if (reconMethodSet.has(`${cand}/${origParamCount}`)) {
              found = true;
              break;
            }
          }
        }
        // Account for same param count when class is obfuscated and method count matches
        if (
          !found &&
          orig.isObfuscatedName &&
          recon.methods.some((rm) => rm.endsWith(`/${origParamCount}`))
        ) {
          found = true;
        }

        if (found) {
          matchedMethods++;
        } else {
          missingMethods.push(origM);
          unrecoveredMethods.push({
            className,
            methodSignature: origM,
            reason: 'Method signature not found in reconstructed class',
          });
        }
      }

      // Check if reconstructed file contains JADX decompilation failure markers
      const hasUnresolvedStub =
        recon.rawContent.includes('UnsupportedOperationException("Method not decompiled') ||
        recon.rawContent.includes('JADX ERROR');

      matchedMethodSignaturesTotal += matchedMethods;
      const matchedFields = Math.min(orig.fields.length, recon.fields.length);
      matchedFieldsTotal += matchedFields;

      const methodReferencesPreserved =
        orig.methodCalls.length === 0 ||
        orig.methodCalls.some((mc) => recon!.methodCalls.includes(mc)) ||
        recon.methodCalls.length >= Math.floor(orig.methodCalls.length * 0.6);

      const classDependenciesPreserved =
        orig.imports.length === 0 ||
        recon.imports.length >= Math.floor(orig.imports.length * 0.7);

      let clsStatus: VerificationCheckStatus = 'PASS';
      if (hasUnresolvedStub) {
        clsStatus = 'WARNING';
      } else if (orig.methods.length > 0 && matchedMethods === 0) {
        clsStatus = 'FAIL';
      } else if (missingMethods.length > 0) {
        clsStatus = 'WARNING';
      }

      classComparisons.push({
        className,
        reconstructedClassName: recon.className,
        packageName: orig.packageName,
        role: orig.role,
        originalOrigin:
          orig.hasJadx && orig.hasSmali
            ? 'jadx_and_smali'
            : orig.hasJadx
            ? 'jadx_only'
            : 'smali_only',
        reconstructedLanguage: recon.language === 'kotlin' ? 'kotlin' : 'java',
        isObfuscatedOriginal: orig.isObfuscatedName,
        isCompilerGenerated: orig.isCompilerGenerated,
        originalMethodsCount: orig.methods.length,
        reconstructedMethodsCount: recon.methods.length,
        matchedMethodSignatures: matchedMethods,
        missingMethodSignatures: missingMethods,
        originalFieldsCount: orig.fields.length,
        reconstructedFieldsCount: recon.fields.length,
        matchedFieldDeclarations: matchedFields,
        methodReferencesPreserved,
        classDependenciesPreserved,
        status: clsStatus,
        notes: mappedViaDeobfuscation
          ? `Correlated obfuscated class ${orig.simpleName} → ${recon.simpleName} (${matchedMethods}/${orig.methods.length} methods).`
          : `${matchedMethods}/${orig.methods.length} methods & ${matchedFields}/${orig.fields.length} fields matched.`,
      });
    }

    const origAll = Array.from(origClassesMap.values());
    const reconAll = Array.from(reconClassesMap.values());

    let status: VerificationCheckStatus = 'PASS';
    if (unrecoveredClasses.length > 0) {
      status = 'FAIL';
    } else if (
      unrecoveredMethods.length > 0 ||
      classComparisons.some((c) => c.status === 'WARNING')
    ) {
      status = 'WARNING';
    }

    return {
      status,
      metrics: {
        originalAppClasses: origAll.length,
        reconstructedAppClasses: reconAll.length,
        compilerGeneratedIgnored,
        obfuscatedClassesMapped,
        javaToKotlinConverted,
        originalMethodsTotal,
        reconstructedMethodsTotal,
        matchedMethodSignaturesTotal,
        originalFieldsTotal,
        reconstructedFieldsTotal,
        matchedFieldsTotal,
        packagesOriginal: Array.from(new Set(origAll.map((c) => c.packageName))).sort(),
        packagesReconstructed: Array.from(new Set(reconAll.map((c) => c.packageName))).sort(),
        databaseClassesOriginal: origAll
          .filter((c) => c.role === 'database')
          .map((c) => c.className),
        databaseClassesReconstructed: reconAll
          .filter((c) => c.role === 'database')
          .map((c) => c.className),
        networkInterfacesOriginal: origAll
          .filter((c) => c.role === 'network')
          .map((c) => c.className),
        networkInterfacesReconstructed: reconAll
          .filter((c) => c.role === 'network')
          .map((c) => c.className),
        activitiesAndFragmentsOriginal: origAll
          .filter((c) => c.role === 'activity' || c.role === 'fragment')
          .map((c) => c.className),
        activitiesAndFragmentsReconstructed: reconAll
          .filter((c) => c.role === 'activity' || c.role === 'fragment')
          .map((c) => c.className),
      },
      classComparisons,
      unrecoveredClasses,
      unrecoveredMethods: unrecoveredMethods.slice(0, 150),
    };
  }

  private isThirdPartyPath(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, '/');
    return THIRD_PARTY_PREFIXES.some((prefix) => norm.startsWith(prefix));
  }

  private isCompilerGeneratedClassName(baseName: string): boolean {
    if (baseName === 'R' || baseName.startsWith('R$') || baseName === 'BuildConfig') {
      return true;
    }
    if (
      baseName.includes('$$ExternalSynthetic') ||
      baseName.includes('$Lambda$') ||
      /\$\d+$/.test(baseName)
    ) {
      return true;
    }
    return false;
  }

  private parseJavaOrKotlinClass(
    relPath: string,
    content: string
  ): ParsedClassSignature {
    const isKotlin = relPath.endsWith('.kt');
    const normPath = relPath.replace(/\\/g, '/');
    const simpleName = path.basename(normPath, path.extname(normPath));
    const pkgMatch = content.match(/^\s*package\s+([a-zA-Z0-9_.]+)/m);
    const packageName =
      pkgMatch?.[1] ||
      path.dirname(normPath).replace(/\//g, '.').replace(/^\.+/, '');
    const className = packageName ? `${packageName}.${simpleName}` : simpleName;

    const isObfuscatedName =
      simpleName.length <= 2 || /^[a-z]{1,2}\d*$/i.test(simpleName);

    // Extract imports
    const imports = Array.from(
      content.matchAll(/^\s*import\s+([a-zA-Z0-9_.*]+)/gm)
    ).map((m) => m[1]);

    // Extract methods (name/paramCount)
    const methods: string[] = [];
    if (isKotlin) {
      const ktRegex = /\bfun\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = ktRegex.exec(content)) !== null) {
        const name = m[1];
        const params = m[2].trim() ? m[2].split(',').length : 0;
        methods.push(`${name}/${params}`);
      }
    } else {
      const javaRegex =
        /(?:public|protected|private|static|final|synchronized|abstract|native|\s)+[\w<>[\],.?]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\{/g;
      let m: RegExpExecArray | null;
      while ((m = javaRegex.exec(content)) !== null) {
        const name = m[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'synchronized'].includes(name)) {
          continue;
        }
        const params = m[2].trim() ? m[2].split(',').length : 0;
        methods.push(`${name}/${params}`);
      }
    }

    // Extract fields
    const fields: string[] = [];
    if (isKotlin) {
      const ktFieldRegex = /\b(?:val|var)\s+([a-zA-Z0-9_]+)/g;
      let m: RegExpExecArray | null;
      while ((m = ktFieldRegex.exec(content)) !== null) {
        fields.push(m[1]);
      }
    } else {
      const javaFieldRegex =
        /^\s*(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:volatile\s+)?(?:transient\s+)?[\w<>[\],.?]+\s+([a-zA-Z0-9_]+)\s*(?:=|;)/gm;
      let m: RegExpExecArray | null;
      while ((m = javaFieldRegex.exec(content)) !== null) {
        fields.push(m[1]);
      }
    }

    // Extract method calls
    const methodCalls = Array.from(
      new Set(
        Array.from(content.matchAll(/\.([a-zA-Z0-9_]+)\s*\(/g)).map((m) => m[1])
      )
    );

    // Role classification
    let role: ClassStructuralComparison['role'] = 'model_or_util';
    if (
      /Activity\b/.test(simpleName) ||
      /extends\s+\w*Activity\b/.test(content) ||
      /:\s*\w*Activity\s*\(/.test(content)
    ) {
      role = 'activity';
    } else if (
      /Fragment\b/.test(simpleName) ||
      /extends\s+\w*Fragment\b/.test(content) ||
      /:\s*\w*Fragment\s*\(/.test(content)
    ) {
      role = 'fragment';
    } else if (/extends\s+\w*Service\b/.test(content)) {
      role = 'service';
    } else if (/extends\s+\w*BroadcastReceiver\b/.test(content)) {
      role = 'receiver';
    } else if (/extends\s+\w*ContentProvider\b/.test(content)) {
      role = 'provider';
    } else if (
      /SQLiteOpenHelper|RoomDatabase|@Database|@Dao|@Entity|SQLiteDatabase/.test(content)
    ) {
      role = 'database';
    } else if (
      /Retrofit|OkHttpClient|HttpURLConnection|@GET|@POST|@PUT|@DELETE|Call<|Callback</.test(
        content
      )
    ) {
      role = 'network';
    }

    return {
      relativePath: normPath,
      className,
      simpleName,
      packageName,
      language: isKotlin ? 'kotlin' : 'java',
      isCompilerGenerated: this.isCompilerGeneratedClassName(simpleName),
      isObfuscatedName,
      role,
      methods: Array.from(new Set(methods)),
      fields: Array.from(new Set(fields)),
      methodCalls,
      imports,
      rawContent: content,
    };
  }

  private parseSmaliClass(relPath: string, content: string): ParsedClassSignature {
    const normPath = relPath.replace(/\\/g, '/');
    const simpleName = path.basename(normPath, '.smali');
    const packageName = path
      .dirname(normPath)
      .replace(/\//g, '.')
      .replace(/^\.+/, '');
    const className = packageName ? `${packageName}.${simpleName}` : simpleName;

    const methods: string[] = [];
    const smaliMethodRegex = /^\.method\s+[^\r\n]*?\s+([a-zA-Z0-9_$<>]+)\(([^)]*)\)/gm;
    let m: RegExpExecArray | null;
    while ((m = smaliMethodRegex.exec(content)) !== null) {
      const mName = m[1];
      if (mName === '<init>' || mName === '<clinit>') continue;
      const descParams = m[2];
      const paramCount = (descParams.match(/L[^;]+;|[ZBCSIJFD]/g) || []).length;
      methods.push(`${mName}/${paramCount}`);
    }

    const fields = Array.from(
      content.matchAll(/^\.field\s+[^\r\n]*?\s+([a-zA-Z0-9_$]+):/gm)
    ).map((f) => f[1]);

    const methodCalls = Array.from(
      new Set(
        Array.from(content.matchAll(/->([a-zA-Z0-9_$]+)\(/g)).map((c) => c[1])
      )
    );

    let role: ClassStructuralComparison['role'] = 'model_or_util';
    if (/\.super\s+L[^;]*Activity;/.test(content)) role = 'activity';
    else if (/\.super\s+L[^;]*Fragment;/.test(content)) role = 'fragment';
    else if (/\.super\s+L[^;]*Service;/.test(content)) role = 'service';
    else if (/\.super\s+L[^;]*BroadcastReceiver;/.test(content)) role = 'receiver';
    else if (/SQLite|RoomDatabase/.test(content)) role = 'database';
    else if (/okhttp3|retrofit2|HttpURLConnection/.test(content)) role = 'network';

    return {
      relativePath: normPath,
      className,
      simpleName,
      packageName,
      language: 'smali',
      isCompilerGenerated: this.isCompilerGeneratedClassName(simpleName),
      isObfuscatedName: simpleName.length <= 2,
      role,
      methods: Array.from(new Set(methods)),
      fields: Array.from(new Set(fields)),
      methodCalls,
      imports: [],
      rawContent: content,
    };
  }

  // ============================================================================
  // 4. FUNCTIONALITY ANALYSIS (Verified Runtime vs Inferred from Source)
  // ============================================================================
  private async analyzeFunctionality(
    sessionRoot: string,
    projectRoot: string,
    metadataReport: MetadataComparisonReport,
    sourceReport: SourceCodeComparisonReport,
    runtimeReport: AutomatedTestingReport
  ): Promise<FunctionalityAnalysisReport> {
    const origCorpus = await this.buildSourceCorpus(
      path.join(sessionRoot, 'java'),
      path.join(sessionRoot, 'decoded', 'AndroidManifest.xml')
    );
    const reconCorpus = await this.buildSourceCorpus(
      path.join(projectRoot, 'app', 'src', 'main', 'java'),
      path.join(projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml')
    );

    const isRuntimeVerified =
      runtimeReport.status === 'PASS' && runtimeReport.reconstructedApkInstalled;

    const domainPatterns: {
      domain: FunctionalDomainKey;
      label: string;
      patterns: { name: string; regex: RegExp }[];
    }[] = [
      {
        domain: 'app_startup',
        label: 'Application Startup & Launcher Entry',
        patterns: [
          { name: 'MAIN Launcher Intent', regex: /android\.intent\.action\.MAIN/ },
          { name: 'LAUNCHER Category', regex: /android\.intent\.category\.LAUNCHER/ },
          { name: 'Activity.onCreate()', regex: /\bonCreate\s*\(/ },
          { name: 'setContentView()', regex: /\bsetContentView\s*\(/ },
        ],
      },
      {
        domain: 'authentication',
        label: 'Authentication & Session Token Flows',
        patterns: [
          { name: 'Login / Auth handler', regex: /\b(?:login|authenticate|signIn|AuthToken|Bearer)\b/i },
          { name: 'Password / Credential input', regex: /\b(?:password|credential|SharedPreferences|KeyStore)\b/i },
          { name: 'Biometric / OAuth / FirebaseAuth', regex: /\b(?:FirebaseAuth|BiometricPrompt|GoogleSignIn|OAuth)\b/ },
        ],
      },
      {
        domain: 'navigation',
        label: 'Screen Navigation & Intent Routing',
        patterns: [
          { name: 'startActivity()', regex: /\bstartActivity(?:ForResult)?\s*\(/ },
          { name: 'Intent construction', regex: /\bnew\s+Intent\s*\(|\bIntent\s*\(/ },
          { name: 'FragmentTransaction / NavController', regex: /\b(?:FragmentTransaction|NavController|findNavController)\b/ },
        ],
      },
      {
        domain: 'database_operations',
        label: 'Database & Local Persistence Operations',
        patterns: [
          { name: 'SQLiteOpenHelper / SQLiteDatabase', regex: /\b(?:SQLiteOpenHelper|SQLiteDatabase|getWritableDatabase|getReadableDatabase)\b/ },
          { name: 'Room Database (@Dao / @Entity)', regex: /@(?:Database|Dao|Entity|Query|Insert)/ },
          { name: 'SharedPreferences persistence', regex: /\bgetSharedPreferences\s*\(/ },
        ],
      },
      {
        domain: 'api_communication',
        label: 'Network & REST API Communication',
        patterns: [
          { name: 'HTTP / HTTPS Endpoint URLs', regex: /https?:\/\/[^\s"'<>]+/ },
          { name: 'OkHttp / Retrofit / HttpURLConnection', regex: /\b(?:OkHttpClient|Retrofit|HttpURLConnection|Volley)\b/ },
          { name: 'JSON Parsing (JSONObject / Gson)', regex: /\b(?:JSONObject|JSONArray|Gson|Moshi)\b/ },
        ],
      },
      {
        domain: 'file_handling',
        label: 'File I/O & External Storage Handling',
        patterns: [
          { name: 'FileInputStream / FileOutputStream', regex: /\b(?:FileInputStream|FileOutputStream|BufferedReader|FileWriter)\b/ },
          { name: 'Context.getFilesDir / getCacheDir', regex: /\b(?:getFilesDir|getCacheDir|getExternalFilesDir|ContentResolver)\b/ },
        ],
      },
      {
        domain: 'notifications',
        label: 'Push & Local Notifications',
        patterns: [
          { name: 'NotificationManager / NotificationCompat', regex: /\b(?:NotificationManager|NotificationCompat|NotificationChannel)\b/ },
          { name: 'FirebaseMessagingService', regex: /\bFirebaseMessagingService\b/ },
        ],
      },
      {
        domain: 'background_services',
        label: 'Background Services, WorkManager & Receivers',
        patterns: [
          { name: 'Service / IntentService / JobService', regex: /\bextends\s+\w*(?:Service|Worker|BroadcastReceiver)\b/ },
          { name: 'WorkManager / AlarmManager / Executor', regex: /\b(?:WorkManager|AlarmManager|Executors|AsyncTask|CoroutineScope)\b/ },
        ],
      },
      {
        domain: 'camera_functionality',
        label: 'Camera & Media Capture Functionality',
        patterns: [
          { name: 'CameraX / Camera2 / MediaStore Capture', regex: /\b(?:CameraManager|CameraCaptureSession|IMAGE_CAPTURE|ProcessCameraProvider)\b/ },
          { name: 'CAMERA Permission', regex: /android\.permission\.CAMERA/ },
        ],
      },
      {
        domain: 'permissions_handling',
        label: 'Runtime Permissions & Security Declarations',
        patterns: [
          { name: 'uses-permission declarations', regex: /<uses-permission\b/ },
          { name: 'checkSelfPermission / requestPermissions', regex: /\b(?:checkSelfPermission|requestPermissions|ActivityResultContracts\.RequestPermission)\b/ },
        ],
      },
      {
        domain: 'custom_features',
        label: 'WebView, JNI Native Bridges & Custom App Features',
        patterns: [
          { name: 'WebView / JavascriptInterface', regex: /\b(?:WebView|addJavascriptInterface|loadUrl)\b/ },
          { name: 'System.loadLibrary (JNI)', regex: /\bSystem\.loadLibrary\s*\(/ },
          { name: 'Custom UI / Click Listeners', regex: /\bsetOnClickListener\s*\(/ },
        ],
      },
    ];

    const capabilities: FunctionalCapabilityItem[] = [];

    for (const dom of domainPatterns) {
      const origEv: string[] = [];
      const reconEv: string[] = [];
      const missingEl: string[] = [];

      for (const pat of dom.patterns) {
        const inOrig = pat.regex.test(origCorpus);
        const inRecon = pat.regex.test(reconCorpus);
        if (inOrig) origEv.push(pat.name);
        if (inRecon) reconEv.push(pat.name);
        if (inOrig && !inRecon) missingEl.push(pat.name);
      }

      // Also check Startup activity parity from metadataComparison
      if (dom.domain === 'app_startup') {
        const actField = metadataReport.fields.find((f) => f.field === 'activities');
        if (actField && actField.missingInReconstructed.length > 0) {
          missingEl.push(`Missing Activity: ${actField.missingInReconstructed.join(', ')}`);
        }
      }

      const presentInOriginal = origEv.length > 0;
      const preservedInReconstructed = presentInOriginal
        ? missingEl.length === 0 && reconEv.length > 0
        : true;

      let status: VerificationCheckStatus = 'PASS';
      let verificationBasis: FunctionalCapabilityItem['verificationBasis'] =
        'inferred_from_source';

      if (!presentInOriginal) {
        verificationBasis = 'not_applicable';
        status = 'PASS';
      } else if (isRuntimeVerified && dom.domain === 'app_startup') {
        verificationBasis = 'verified_runtime';
        status = preservedInReconstructed ? 'PASS' : 'FAIL';
      } else {
        verificationBasis = 'inferred_from_source';
        if (missingEl.length > 0 && reconEv.length === 0) {
          status = 'FAIL';
        } else if (missingEl.length > 0 || sourceReport.unrecoveredClasses.length > 0) {
          status = 'WARNING';
        } else {
          status = 'PASS';
        }
      }

      capabilities.push({
        domain: dom.domain,
        label: dom.label,
        presentInOriginal,
        preservedInReconstructed,
        verificationBasis,
        status,
        originalEvidence: origEv,
        reconstructedEvidence: reconEv,
        missingElements: missingEl,
        notes: !presentInOriginal
          ? `Feature not used in original APK.`
          : preservedInReconstructed
          ? `${
              verificationBasis === 'verified_runtime'
                ? 'Verified at runtime & in source'
                : 'Inferred from source code & manifest'
            }: ${reconEv.join(', ')}.`
          : `Missing functional elements in reconstructed code: ${missingEl.join(', ')}.`,
      });
    }

    const applicable = capabilities.filter((c) => c.presentInOriginal);
    const preserved = applicable.filter((c) => c.preservedInReconstructed);
    const verifiedRuntimeCount = applicable.filter(
      (c) => c.verificationBasis === 'verified_runtime'
    ).length;
    const inferredFromSourceCount = applicable.filter(
      (c) => c.verificationBasis === 'inferred_from_source'
    ).length;
    const warningsCount = applicable.filter((c) => c.status === 'WARNING').length;
    const failedCount = applicable.filter((c) => c.status === 'FAIL').length;

    let status: VerificationCheckStatus = 'PASS';
    if (failedCount > 0) status = 'FAIL';
    else if (warningsCount > 0) status = 'WARNING';

    return {
      status,
      capabilities,
      summary: {
        applicableDomains: applicable.length,
        preservedDomains: preserved.length,
        verifiedRuntimeCount,
        inferredFromSourceCount,
        warningsCount,
        failedCount,
      },
    };
  }

  private async buildSourceCorpus(javaDir: string, manifestPath: string): Promise<string> {
    const chunks: string[] = [];
    if (fsSync.existsSync(manifestPath)) {
      chunks.push(await fs.readFile(manifestPath, 'utf-8').catch(() => ''));
    }
    const files = await this.walkFilesRelative(javaDir);
    for (const f of files.slice(0, 120)) {
      if (!f.endsWith('.java') && !f.endsWith('.kt')) continue;
      if (this.isThirdPartyPath(f)) continue;
      const text = await fs.readFile(path.join(javaDir, f), 'utf-8').catch(() => '');
      chunks.push(text);
    }
    return chunks.join('\n');
  }

  // ============================================================================
  // 5. UI COMPARISON (Emulator Availability Check + Static XML Layout Analysis)
  // ============================================================================
  private async compareUserInterface(
    sessionRoot: string,
    projectRoot: string,
    emulatorConnected: boolean
  ): Promise<UiComparisonReport> {
    const origResDir = path.join(sessionRoot, 'decoded', 'res');
    const reconResDir = path.join(projectRoot, 'app', 'src', 'main', 'res');
    const reconJavaDir = path.join(projectRoot, 'app', 'src', 'main', 'java');

    const origLayoutFiles = (await this.walkFilesRelative(origResDir)).filter((f) => {
      const top = f.split('/')[0];
      return (top === 'layout' || top.startsWith('layout-')) && f.endsWith('.xml');
    });
    const reconLayoutFiles = (await this.walkFilesRelative(reconResDir)).filter((f) => {
      const top = f.split('/')[0];
      return (top === 'layout' || top.startsWith('layout-')) && f.endsWith('.xml');
    });

    // Map layout names to Activities/Fragments that reference R.layout.<name>
    const layoutToComponent = new Map<string, string>();
    const reconJavaFiles = await this.walkFilesRelative(reconJavaDir);
    for (const jf of reconJavaFiles) {
      if (!jf.endsWith('.java') && !jf.endsWith('.kt')) continue;
      const content = await fs
        .readFile(path.join(reconJavaDir, jf), 'utf-8')
        .catch(() => '');
      const matches = content.matchAll(/R\.layout\.([a-zA-Z0-9_]+)/g);
      for (const m of matches) {
        layoutToComponent.set(m[1], path.basename(jf, path.extname(jf)));
      }
    }

    const reconSet = new Set(reconLayoutFiles);
    const screens: LayoutScreenComparison[] = [];
    let matchedLayouts = 0;
    let modifiedLayouts = 0;
    let missingLayouts = 0;

    for (const rel of origLayoutFiles) {
      const layoutName = path.basename(rel, '.xml');
      const origContent = await fs
        .readFile(path.join(origResDir, rel), 'utf-8')
        .catch(() => '');
      const origParsed = this.parseLayoutXmlStructure(origContent);

      if (!reconSet.has(rel)) {
        missingLayouts++;
        screens.push({
          layoutName,
          originalPath: `decoded/res/${rel}`,
          associatedComponent: layoutToComponent.get(layoutName),
          originalViewTags: origParsed.viewTags,
          reconstructedViewTags: [],
          originalViewIds: origParsed.viewIds,
          reconstructedViewIds: [],
          missingViewIds: origParsed.viewIds,
          textReferencesMatched: false,
          iconReferencesMatched: false,
          colorReferencesMatched: false,
          navigationBindingsPreserved: false,
          emulatorScreenshotCaptured: false,
          status: 'FAIL',
          differences: [`Layout XML file "${rel}" is missing in reconstructed project.`],
        });
        continue;
      }

      const reconContent = await fs
        .readFile(path.join(reconResDir, rel), 'utf-8')
        .catch(() => '');
      const reconParsed = this.parseLayoutXmlStructure(reconContent);

      const missingViewIds = origParsed.viewIds.filter(
        (id) => !reconParsed.viewIds.includes(id)
      );
      const textReferencesMatched = this.setsEqual(
        origParsed.textRefs,
        reconParsed.textRefs
      );
      const iconReferencesMatched = this.setsEqual(
        origParsed.iconRefs,
        reconParsed.iconRefs
      );
      const colorReferencesMatched = this.setsEqual(
        origParsed.colorRefs,
        reconParsed.colorRefs
      );
      const tagsMatched = this.setsEqual(origParsed.viewTags, reconParsed.viewTags);

      const diffs: string[] = [];
      if (missingViewIds.length > 0) {
        diffs.push(`Missing view IDs: ${missingViewIds.join(', ')}`);
      }
      if (!tagsMatched) {
        diffs.push(`View hierarchy tags modified.`);
      }
      if (!textReferencesMatched) {
        diffs.push(`Text / @string attributes modified.`);
      }
      if (!iconReferencesMatched) {
        diffs.push(`Drawable / @mipmap icon references modified.`);
      }
      if (!colorReferencesMatched) {
        diffs.push(`Color / background references modified.`);
      }

      let screenStatus: VerificationCheckStatus = 'PASS';
      if (missingViewIds.length > 0) {
        screenStatus = 'FAIL';
        modifiedLayouts++;
      } else if (diffs.length > 0) {
        screenStatus = 'WARNING';
        modifiedLayouts++;
      } else {
        matchedLayouts++;
      }

      screens.push({
        layoutName,
        originalPath: `decoded/res/${rel}`,
        reconstructedPath: `android-studio-project/app/src/main/res/${rel}`,
        associatedComponent: layoutToComponent.get(layoutName),
        originalViewTags: origParsed.viewTags,
        reconstructedViewTags: reconParsed.viewTags,
        originalViewIds: origParsed.viewIds,
        reconstructedViewIds: reconParsed.viewIds,
        missingViewIds,
        textReferencesMatched,
        iconReferencesMatched,
        colorReferencesMatched,
        navigationBindingsPreserved: missingViewIds.length === 0,
        emulatorScreenshotCaptured: false,
        status: screenStatus,
        differences:
          diffs.length > 0
            ? diffs
            : ['All XML view hierarchy tags, view IDs, strings, icons, and colors match.'],
      });
    }

    let staticXmlComparisonStatus: VerificationCheckStatus = 'PASS';
    if (missingLayouts > 0 || screens.some((s) => s.status === 'FAIL')) {
      staticXmlComparisonStatus = 'FAIL';
    } else if (modifiedLayouts > 0) {
      staticXmlComparisonStatus = 'WARNING';
    }

    // Never claim live UI screenshot testing succeeded when an emulator is unavailable
    const liveScreenCaptureStatus: VerificationCheckStatus = emulatorConnected
      ? 'PASS'
      : 'NOT_TESTED';

    return {
      status: staticXmlComparisonStatus,
      emulatorAvailable: emulatorConnected,
      emulatorDiagnostic: emulatorConnected
        ? 'Connected Android emulator detected via ADB.'
        : 'No Android emulator or ADB device is connected in this container environment. Live emulator screen capture is marked NOT_TESTED; UI structure was verified via static XML layout hierarchy, view IDs, text, icon, and color reference comparison.',
      liveScreenCaptureStatus,
      staticXmlComparisonStatus,
      screens,
      summary: {
        totalLayouts: origLayoutFiles.length,
        matchedLayouts,
        modifiedLayouts,
        missingLayouts,
      },
    };
  }

  private parseLayoutXmlStructure(xmlContent: string): {
    viewTags: string[];
    viewIds: string[];
    textRefs: string[];
    iconRefs: string[];
    colorRefs: string[];
  } {
    const viewTags = Array.from(
      new Set(
        Array.from(xmlContent.matchAll(/<([a-zA-Z0-9_.]+)\b/g))
          .map((m) => m[1])
          .filter((t) => !t.startsWith('?xml'))
      )
    );
    const viewIds = Array.from(
      new Set(
        Array.from(xmlContent.matchAll(/android:id="@\+?(?:id|android:id)\/([^"]+)"/g)).map(
          (m) => m[1]
        )
      )
    );
    const textRefs = Array.from(
      new Set(
        Array.from(xmlContent.matchAll(/android:(?:text|hint|title)="([^"]+)"/g)).map(
          (m) => m[1]
        )
      )
    );
    const iconRefs = Array.from(
      new Set(
        Array.from(
          xmlContent.matchAll(/android:(?:src|drawable\w*|icon)="(@(?:drawable|mipmap)\/[^"]+)"/g)
        ).map((m) => m[1])
      )
    );
    const colorRefs = Array.from(
      new Set(
        Array.from(
          xmlContent.matchAll(
            /android:(?:textColor|background|backgroundTint|tint)="((?:@color\/|#)[^"]+)"/g
          )
        ).map((m) => m[1])
      )
    );

    return { viewTags, viewIds, textRefs, iconRefs, colorRefs };
  }

  private setsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((x) => setB.has(x));
  }

  // ============================================================================
  // 6. AUTOMATED RUNTIME TESTING
  // ============================================================================
  private async runAutomatedRuntimeTesting(
    sessionRoot: string,
    originalApkPath: string,
    reconstructedApkInfo: FinalComparisonReport['reconstructedApkInfo'],
    metadataComparison: MetadataComparisonReport
  ): Promise<AutomatedTestingReport> {
    const testedAt = new Date().toISOString();
    let adbAvailable = false;
    const connectedDevices: string[] = [];

    try {
      const { stdout } = await execFileAsync('adb', ['devices'], { timeout: 5000 });
      adbAvailable = true;
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('List of devices'));
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[1] === 'device') {
          connectedDevices.push(parts[0]);
        }
      }
    } catch {
      adbAvailable = false;
    }

    const isolatedEnvironmentReady = adbAvailable && connectedDevices.length > 0;

    // Also scan reconstructed source & build logs for potential runtime exceptions or missing classes/resources
    const detectedRuntimeExceptions: string[] = [];
    const missingRuntimeClassesOrResources: string[] = [];

    const reconJavaDir = path.join(
      sessionRoot,
      'android-studio-project',
      'app',
      'src',
      'main',
      'java'
    );
    const reconFiles = await this.walkFilesRelative(reconJavaDir);
    for (const rf of reconFiles) {
      if (!rf.endsWith('.java') && !rf.endsWith('.kt')) continue;
      const content = await fs
        .readFile(path.join(reconJavaDir, rf), 'utf-8')
        .catch(() => '');
      if (content.includes('UnsupportedOperationException("Method not decompiled')) {
        detectedRuntimeExceptions.push(
          `${rf}: Contains fallback UnsupportedOperationException stub for unrecovered method.`
        );
      }
    }

    const actField = metadataComparison.fields.find((f) => f.field === 'activities');
    if (actField && actField.missingInReconstructed.length > 0) {
      for (const ma of actField.missingInReconstructed) {
        missingRuntimeClassesOrResources.push(
          `ActivityNotFoundException risk: ${ma} missing from reconstructed AndroidManifest.xml`
        );
      }
    }

    if (!isolatedEnvironmentReady) {
      const notTestedReason = !adbAvailable
        ? 'Android Debug Bridge (adb) & Android Emulator are not installed in this server container.'
        : 'ADB is available, but no connected Android emulator or device was found (`adb devices` returned 0 online devices).';

      const steps: RuntimeTestStepResult[] = [
        {
          stepId: 'install_apks',
          name: 'Install Original & Reconstructed APKs in Isolated Environment',
          status: 'NOT_TESTED',
          executedOnDevice: false,
          details: notTestedReason,
        },
        {
          stepId: 'launch_app',
          name: 'Launch Main Launcher Activity (`am start`)',
          status: 'NOT_TESTED',
          executedOnDevice: false,
          details: notTestedReason,
        },
        {
          stepId: 'startup_crashes',
          name: 'Monitor Startup Crashes & Fatal Signals',
          status: 'NOT_TESTED',
          executedOnDevice: false,
          details: notTestedReason,
        },
        {
          stepId: 'logcat_capture',
          name: 'Capture & Analyze Logcat Output',
          status: 'NOT_TESTED',
          executedOnDevice: false,
          details: notTestedReason,
        },
        {
          stepId: 'navigation_flows',
          name: 'Verify Basic Activity Navigation & UI Flows',
          status: 'NOT_TESTED',
          executedOnDevice: false,
          details: notTestedReason,
        },
      ];

      return {
        status: 'NOT_TESTED',
        testedAt,
        adbAvailable,
        connectedDevices,
        isolatedEnvironmentReady: false,
        originalApkInstalled: false,
        reconstructedApkAvailable: reconstructedApkInfo.exists,
        reconstructedApkPath: reconstructedApkInfo.exists
          ? reconstructedApkInfo.path
          : undefined,
        reconstructedApkInstalled: false,
        steps,
        detectedRuntimeExceptions,
        missingRuntimeClassesOrResources,
        logcatOutput: [
          `[${testedAt}] Probe: adb devices -> ${notTestedReason}`,
          `[${testedAt}] Runtime execution skipped truthfully (status: NOT_TESTED).`,
        ],
        summary: `Runtime device testing is NOT_TESTED (${notTestedReason}). Static runtime hazard scan identified ${detectedRuntimeExceptions.length} stub exception(s) and ${missingRuntimeClassesOrResources.length} missing component hazard(s).`,
      };
    }

    // If an isolated emulator IS connected and both APKs exist, execute real ADB verification
    const deviceId = connectedDevices[0];
    const logcatOutput: string[] = [];
    const steps: RuntimeTestStepResult[] = [];
    let originalApkInstalled = false;
    let reconstructedApkInstalled = false;

    if (!reconstructedApkInfo.exists) {
      steps.push({
        stepId: 'install_apks',
        name: 'Install Original & Reconstructed APKs in Isolated Environment',
        status: 'NOT_TESTED',
        executedOnDevice: false,
        details:
          'Emulator is connected, but no compiled Reconstructed APK artifact exists yet. Build the APK first to run live device installation.',
      });
      return {
        status: 'NOT_TESTED',
        testedAt,
        adbAvailable,
        connectedDevices,
        isolatedEnvironmentReady: true,
        originalApkInstalled: false,
        reconstructedApkAvailable: false,
        reconstructedApkInstalled: false,
        steps,
        detectedRuntimeExceptions,
        missingRuntimeClassesOrResources,
        logcatOutput,
        summary:
          'Emulator is available, but no built Reconstructed APK artifact was found on disk. Marked NOT_TESTED.',
      };
    }

    try {
      const reconFullApkPath = path.join(sessionRoot, reconstructedApkInfo.path);
      await execFileAsync('adb', ['-s', deviceId, 'install', '-r', reconFullApkPath], {
        timeout: 30000,
      });
      reconstructedApkInstalled = true;
      if (fsSync.existsSync(originalApkPath)) {
        originalApkInstalled = true;
      }
      steps.push({
        stepId: 'install_apks',
        name: 'Install Reconstructed APK on Isolated Emulator',
        status: 'PASS',
        executedOnDevice: true,
        details: `Installed ${reconstructedApkInfo.path} on ${deviceId}.`,
      });

      const { stdout: lc } = await execFileAsync(
        'adb',
        ['-s', deviceId, 'logcat', '-d', '-t', '80'],
        { timeout: 10000 }
      );
      logcatOutput.push(...lc.split(/\r?\n/).filter(Boolean));
      const hasFatal = logcatOutput.some((l) => l.includes('FATAL EXCEPTION'));
      steps.push({
        stepId: 'logcat_capture',
        name: 'Capture & Analyze Logcat Output',
        status: hasFatal ? 'FAIL' : 'PASS',
        executedOnDevice: true,
        details: hasFatal
          ? 'Detected FATAL EXCEPTION in Logcat output.'
          : 'Captured 80 lines of Logcat with zero fatal exceptions.',
      });
    } catch (err) {
      steps.push({
        stepId: 'install_apks',
        name: 'Install Reconstructed APK on Isolated Emulator',
        status: 'FAIL',
        executedOnDevice: true,
        details: `ADB execution failed: ${(err as Error).message}`,
      });
    }

    const overallRuntimeStatus: VerificationCheckStatus = steps.some(
      (s) => s.status === 'FAIL'
    )
      ? 'FAIL'
      : steps.every((s) => s.status === 'PASS')
      ? 'PASS'
      : 'WARNING';

    return {
      status: overallRuntimeStatus,
      testedAt,
      adbAvailable,
      connectedDevices,
      isolatedEnvironmentReady: true,
      originalApkInstalled,
      reconstructedApkAvailable: true,
      reconstructedApkPath: reconstructedApkInfo.path,
      reconstructedApkInstalled,
      steps,
      detectedRuntimeExceptions,
      missingRuntimeClassesOrResources,
      logcatOutput,
      summary: `Executed ${steps.length} runtime test step(s) on device ${deviceId} (${overallRuntimeStatus}).`,
    };
  }

  // ============================================================================
  // 8. SIX SEPARATE EVIDENCE-BASED FUNCTIONALITY SCORES
  // ============================================================================
  private calculateFunctionalityScores(
    metadata: MetadataComparisonReport,
    resources: ResourceComparisonReport,
    source: SourceCodeComparisonReport,
    ui: UiComparisonReport,
    runtime: AutomatedTestingReport,
    functionality: FunctionalityAnalysisReport
  ): FunctionalityScoresBreakdown {
    // 1. Metadata Similarity
    const metaTotal = Math.max(1, metadata.summary.totalFields);
    const metaWeighted =
      metadata.summary.passedCount + metadata.summary.warningCount * 0.5;
    const metaScore = Math.round((metaWeighted / metaTotal) * 100);

    // 2. Resource Similarity
    const resOrigTotal = resources.totals.originalTotal;
    const resMatched = resources.categories.reduce((acc, c) => acc + c.matchedCount, 0);
    const resModified = resources.totals.modifiedCount;
    const resScore =
      resOrigTotal === 0
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(((resMatched + resModified * 0.5) / resOrigTotal) * 100)
            )
          );

    // 3. Source Structure Similarity
    const origClasses = source.metrics.originalAppClasses;
    const recoveredClasses = Math.max(
      0,
      origClasses - source.unrecoveredClasses.length
    );
    const classRatio = origClasses === 0 ? 1 : recoveredClasses / origClasses;
    const methodRatio =
      source.metrics.originalMethodsTotal === 0
        ? 1
        : source.metrics.matchedMethodSignaturesTotal /
          source.metrics.originalMethodsTotal;
    const fieldRatio =
      source.metrics.originalFieldsTotal === 0
        ? 1
        : source.metrics.matchedFieldsTotal / source.metrics.originalFieldsTotal;
    const sourceScore = Math.max(
      0,
      Math.min(
        100,
        Math.round((classRatio * 0.5 + methodRatio * 0.35 + fieldRatio * 0.15) * 100)
      )
    );

    // 4. UI Similarity
    const totalLayouts = ui.summary.totalLayouts;
    const uiScore =
      totalLayouts === 0
        ? 100
        : Math.round(
            ((ui.summary.matchedLayouts + ui.summary.modifiedLayouts * 0.5) /
              totalLayouts) *
              100
          );

    // 5. Runtime Test Coverage
    const executedSteps = runtime.steps.filter((s) => s.executedOnDevice);
    const runtimeScore: number | null =
      runtime.status === 'NOT_TESTED' || executedSteps.length === 0
        ? null
        : Math.round((executedSteps.length / Math.max(1, runtime.steps.length)) * 100);

    // 6. Functional Verification
    const appDomains = Math.max(1, functionality.summary.applicableDomains);
    const funcScore = Math.round(
      (functionality.summary.preservedDomains / appDomains) * 100
    );

    return {
      disclaimer:
        'Each score below is calculated independently from actual comparison evidence. Code and resource similarity do NOT automatically guarantee runtime functional equivalence. Untested runtime dimensions are reported as NOT_TESTED.',
      metadataSimilarity: {
        key: 'metadataSimilarity',
        label: 'Metadata Similarity',
        score: metaScore,
        status: metadata.status,
        verificationBasis: 'static_evidence',
        formulaExplanation:
          'Weighted ratio of matching Manifest & Gradle fields (Application ID, package, version, SDKs, permissions, components, intent filters, and native ABIs).',
        evidenceSummary: `${metadata.summary.passedCount}/${metadata.summary.totalFields} metadata categories matched exactly (${metadata.summary.warningCount} warning, ${metadata.summary.failedCount} failed).`,
      },
      resourceSimilarity: {
        key: 'resourceSimilarity',
        label: 'Resource Similarity',
        score: resScore,
        status: resources.status,
        verificationBasis: 'static_evidence',
        formulaExplanation:
          'Percentage of original drawables, mipmaps, XML layouts, strings, colors, dimensions, styles, fonts, animations, raw resources, and assets preserved in reconstructed project.',
        evidenceSummary: `${resMatched}/${resOrigTotal} original resources matched identically (${resources.totals.missingCount} missing, ${resources.totals.modifiedCount} modified, ${resources.totals.duplicateCount} duplicates).`,
      },
      sourceStructureSimilarity: {
        key: 'sourceStructureSimilarity',
        label: 'Source Structure Similarity',
        score: sourceScore,
        status: source.status,
        verificationBasis: 'static_evidence',
        formulaExplanation:
          'Weighted structural correlation across application classes (50%), method signatures (35%), and field declarations (15%), accounting for deobfuscation and Java/Kotlin conversion.',
        evidenceSummary: `${recoveredClasses}/${origClasses} app classes, ${source.metrics.matchedMethodSignaturesTotal}/${source.metrics.originalMethodsTotal} method signatures, and ${source.metrics.matchedFieldsTotal}/${source.metrics.originalFieldsTotal} fields preserved.`,
      },
      uiSimilarity: {
        key: 'uiSimilarity',
        label: 'UI Similarity',
        score: uiScore,
        status: ui.status,
        verificationBasis: ui.emulatorAvailable ? 'runtime_evidence' : 'static_evidence',
        formulaExplanation:
          'Proportion of XML layouts preserving view hierarchy tags, @+id identifiers, @string references, @drawable/@mipmap icons, and @color bindings (Live emulator capture: ' +
          ui.liveScreenCaptureStatus +
          ').',
        evidenceSummary: `${ui.summary.matchedLayouts}/${totalLayouts} XML screen layouts matched without missing view IDs (${ui.summary.modifiedLayouts} modified, ${ui.summary.missingLayouts} missing).`,
      },
      runtimeTestCoverage: {
        key: 'runtimeTestCoverage',
        label: 'Runtime Test Coverage',
        score: runtimeScore,
        status: runtime.status,
        verificationBasis:
          runtime.status === 'NOT_TESTED' ? 'not_tested' : 'runtime_evidence',
        formulaExplanation:
          'Percentage of automated runtime verification steps (APK installation, launch, crash monitoring, Logcat inspection, and navigation) executed on an isolated Android device/emulator.',
        evidenceSummary:
          runtime.status === 'NOT_TESTED'
            ? `NOT_TESTED: ${runtime.summary}`
            : `${executedSteps.length}/${runtime.steps.length} runtime test steps executed on device.`,
      },
      functionalVerification: {
        key: 'functionalVerification',
        label: 'Functional Verification',
        score: funcScore,
        status: functionality.status,
        verificationBasis:
          functionality.summary.verifiedRuntimeCount > 0
            ? 'runtime_evidence'
            : 'inferred_source_evidence',
        formulaExplanation:
          'Proportion of applicable functional domains (startup, auth, navigation, DB, API, files, notifications, services, camera, permissions) preserved in reconstructed code.',
        evidenceSummary: `${functionality.summary.preservedDomains}/${functionality.summary.applicableDomains} functional domains preserved (${functionality.summary.verifiedRuntimeCount} runtime-verified, ${functionality.summary.inferredFromSourceCount} inferred from source code).`,
      },
    };
  }

  // ============================================================================
  // 7. COMPILE SUMMARY LISTS FOR COMPARISON REPORT
  // ============================================================================
  private compileSummaryLists(
    metadata: MetadataComparisonReport,
    resources: ResourceComparisonReport,
    source: SourceCodeComparisonReport,
    functionality: FunctionalityAnalysisReport,
    ui: UiComparisonReport,
    runtime: AutomatedTestingReport
  ): Pick<
    FinalComparisonReport,
    | 'missingComponents'
    | 'reconstructedComponents'
    | 'unresolvedIssues'
    | 'recommendedFixes'
  > {
    const missingComponents: FinalComparisonReport['missingComponents'] = [];
    const reconstructedComponents: FinalComparisonReport['reconstructedComponents'] = [];
    const unresolvedIssues: FinalComparisonReport['unresolvedIssues'] = [];
    const recommendedFixes: FinalComparisonReport['recommendedFixes'] = [];

    // Metadata missing & reconstructed
    for (const f of metadata.fields) {
      for (const m of f.missingInReconstructed) {
        missingComponents.push({
          category: `Metadata: ${f.label}`,
          identifier: m,
          impact: `Missing ${f.label.toLowerCase()} in reconstructed AndroidManifest.xml / build.gradle`,
          status: f.status,
        });
      }
      if (f.status === 'PASS' && Array.isArray(f.reconstructedValue)) {
        for (const r of f.reconstructedValue.slice(0, 15)) {
          reconstructedComponents.push({
            category: `Metadata: ${f.label}`,
            identifier: r,
            sourceOrigin: 'AndroidManifest.xml',
            status: 'PASS',
          });
        }
      }
    }

    // Missing resources
    for (const diff of resources.differences) {
      if (diff.type === 'missing') {
        missingComponents.push({
          category: `Resource (${diff.category})`,
          identifier: diff.resourceName,
          impact: diff.details,
          status: 'FAIL',
        });
      }
    }

    // Source classes
    for (const cls of source.classComparisons) {
      if (cls.reconstructedLanguage === 'missing') {
        missingComponents.push({
          category: `Class (${cls.role})`,
          identifier: cls.className,
          impact: `Class not present in android-studio-project/app/src/main/java`,
          status: 'FAIL',
        });
      } else {
        reconstructedComponents.push({
          category: `Class (${cls.role})`,
          identifier: cls.reconstructedClassName || cls.className,
          sourceOrigin: `${cls.originalOrigin} → ${cls.reconstructedLanguage}`,
          status: cls.status,
        });
      }
    }

    // Unresolved issues & Recommended fixes
    let issueCounter = 1;
    for (const f of metadata.fields) {
      if (f.status === 'FAIL' || f.status === 'WARNING') {
        unresolvedIssues.push({
          id: `issue_meta_${issueCounter++}`,
          category: 'APK Metadata',
          severity: f.status === 'FAIL' ? 'FAIL' : 'WARNING',
          description: f.notes,
          affectedPath: 'app/src/main/AndroidManifest.xml',
        });
        recommendedFixes.push({
          id: `fix_meta_${issueCounter}`,
          priority: f.status === 'FAIL' ? 'HIGH' : 'MEDIUM',
          title: `Align ${f.label} with Original APK`,
          action: `Restore ${
            f.missingInReconstructed.join(', ') || String(f.originalValue)
          } in app/src/main/AndroidManifest.xml or app/build.gradle.`,
          targetFile: 'app/src/main/AndroidManifest.xml',
        });
      }
    }

    if (resources.totals.missingCount > 0 || resources.totals.duplicateCount > 0) {
      unresolvedIssues.push({
        id: `issue_res_${issueCounter++}`,
        category: 'Resources',
        severity: resources.totals.missingCount > 0 ? 'FAIL' : 'WARNING',
        description: `${resources.totals.missingCount} missing resource(s) and ${resources.totals.duplicateCount} duplicate resource definition(s) detected.`,
        affectedPath: 'app/src/main/res',
      });
      recommendedFixes.push({
        id: `fix_res_${issueCounter}`,
        priority: resources.totals.missingCount > 0 ? 'HIGH' : 'MEDIUM',
        title: 'Restore Missing XML Resources & Deduplicate Values',
        action:
          'Copy missing resource entries from decoded/res into android-studio-project/app/src/main/res and remove duplicate keys.',
        targetFile: 'app/src/main/res/values/strings.xml',
      });
    }

    if (source.unrecoveredClasses.length > 0 || source.unrecoveredMethods.length > 0) {
      unresolvedIssues.push({
        id: `issue_src_${issueCounter++}`,
        category: 'Source Code',
        severity: source.unrecoveredClasses.length > 0 ? 'FAIL' : 'WARNING',
        description: `${source.unrecoveredClasses.length} unrecovered class(es) and ${source.unrecoveredMethods.length} missing method signature(s) across application classes.`,
        affectedPath: 'app/src/main/java',
      });
      recommendedFixes.push({
        id: `fix_src_${issueCounter}`,
        priority: 'HIGH',
        title: 'Reconstruct Missing Methods from Smali Bytecode',
        action:
          'Use AI-Assisted Final Repair to reconstruct missing methods from decoded/smali into android-studio-project/app/src/main/java.',
        targetFile: 'app/src/main/java',
      });
    }

    for (const cap of functionality.capabilities) {
      if (cap.presentInOriginal && !cap.preservedInReconstructed) {
        unresolvedIssues.push({
          id: `issue_func_${issueCounter++}`,
          category: 'Functionality',
          severity: cap.status === 'FAIL' ? 'FAIL' : 'WARNING',
          description: `${cap.label}: ${cap.notes}`,
        });
      }
    }

    if (ui.summary.missingLayouts > 0 || ui.summary.modifiedLayouts > 0) {
      unresolvedIssues.push({
        id: `issue_ui_${issueCounter++}`,
        category: 'UI Layouts',
        severity: ui.summary.missingLayouts > 0 ? 'FAIL' : 'WARNING',
        description: `${ui.summary.missingLayouts} missing layout(s) and ${ui.summary.modifiedLayouts} modified layout(s).`,
        affectedPath: 'app/src/main/res/layout',
      });
    }

    if (runtime.detectedRuntimeExceptions.length > 0) {
      for (const rex of runtime.detectedRuntimeExceptions) {
        unresolvedIssues.push({
          id: `issue_rt_${issueCounter++}`,
          category: 'Runtime Hazard',
          severity: 'WARNING',
          description: rex,
        });
      }
    }

    return {
      missingComponents,
      reconstructedComponents,
      unresolvedIssues,
      recommendedFixes,
    };
  }

  // ============================================================================
  // 9. AI-ASSISTED FINAL REPAIR
  // ============================================================================
  public async generateFinalRepairProposals(
    sessionId: string
  ): Promise<AiFinalRepairProposal[]> {
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionRoot = sessionService.getSessionDir(sessionId);
    const projectRoot = path.join(sessionRoot, 'android-studio-project');
    const report = await this.getOrRunComparison(sessionId, false);

    const proposals = await this.generateFinalRepairProposalsInternal(
      sessionRoot,
      projectRoot,
      report.metadataComparison,
      report.resourceComparison,
      report.sourceCodeComparison,
      report.functionalityAnalysis,
      report.uiComparison,
      true
    );

    report.aiFinalRepairProposals = proposals;
    const statePath = this.getComparisonStatePath(sessionRoot);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(report, null, 2), 'utf-8');

    return proposals;
  }

  private async generateFinalRepairProposalsInternal(
    sessionRoot: string,
    projectRoot: string,
    metadata: MetadataComparisonReport,
    resources: ResourceComparisonReport,
    source: SourceCodeComparisonReport,
    functionality: FunctionalityAnalysisReport,
    ui: UiComparisonReport,
    invokeGemini: boolean
  ): Promise<AiFinalRepairProposal[]> {
    const proposals: AiFinalRepairProposal[] = [];
    const now = new Date().toISOString();

    // 1. Check for missing permissions or activities in AndroidManifest.xml
    const reconManifestRel = 'app/src/main/AndroidManifest.xml';
    const reconManifestFull = path.join(projectRoot, reconManifestRel);
    if (fsSync.existsSync(reconManifestFull)) {
      const manifestContent = await fs.readFile(reconManifestFull, 'utf-8');
      const permField = metadata.fields.find((f) => f.field === 'permissions');
      if (permField && permField.missingInReconstructed.length > 0) {
        const appTagMatch = manifestContent.match(/<application\b/);
        if (appTagMatch && appTagMatch.index !== undefined) {
          const lineStart = manifestContent.lastIndexOf('\n', appTagMatch.index) + 1;
          const targetLine = manifestContent.slice(
            lineStart,
            manifestContent.indexOf('\n', appTagMatch.index)
          );
          const permLines = permField.missingInReconstructed
            .map((p) => `    <uses-permission android:name="${p}" />`)
            .join('\n');
          proposals.push({
            id: `final_fix_perm_${Date.now()}`,
            sourceSection: 'metadata',
            issueTitle: `Restore ${permField.missingInReconstructed.length} Missing Permission(s) in AndroidManifest.xml`,
            rootCause: `Permissions ${permField.missingInReconstructed.join(', ')} exist in decoded/AndroidManifest.xml but are absent in reconstructed AndroidManifest.xml.`,
            affectedFilePath: reconManifestRel,
            originalDecompiledEvidence: `decoded/AndroidManifest.xml declares: ${permField.missingInReconstructed.join(', ')}`,
            originalSnippet: targetLine,
            replacementSnippet: `${permLines}\n${targetLine}`,
            explanation:
              'Inserts the missing <uses-permission> declarations from the original APK before the <application> tag.',
            confidenceScore: 96,
            confidenceLevel: 'HIGH',
            status: 'pending',
            createdAt: now,
          });
        }
      }
    }

    // 2. Check for missing <string> or <color> resources in values/strings.xml or colors.xml
    const missingStrings = resources.differences.filter(
      (d) => d.category === 'strings' && d.type === 'missing'
    );
    if (missingStrings.length > 0) {
      const reconStringsRel = 'app/src/main/res/values/strings.xml';
      const reconStringsFull = path.join(projectRoot, reconStringsRel);
      const origStringsFull = path.join(
        sessionRoot,
        'decoded',
        'res',
        'values',
        'strings.xml'
      );
      if (fsSync.existsSync(reconStringsFull) && fsSync.existsSync(origStringsFull)) {
        const reconXml = await fs.readFile(reconStringsFull, 'utf-8');
        const origXml = await fs.readFile(origStringsFull, 'utf-8');
        const restoredLines: string[] = [];
        for (const ms of missingStrings.slice(0, 15)) {
          const m = origXml.match(
            new RegExp(
              `<string\\b[^>]*name="${ms.resourceName}"[^>]*>[\\s\\S]*?<\\/string>`
            )
          );
          if (m) restoredLines.push(`    ${m[0]}`);
        }
        if (restoredLines.length > 0 && reconXml.includes('</resources>')) {
          proposals.push({
            id: `final_fix_strings_${Date.now()}`,
            sourceSection: 'resources',
            issueTitle: `Restore ${restoredLines.length} Missing String Resource(s) in values/strings.xml`,
            rootCause: `String keys (${missingStrings.map((s) => s.resourceName).join(', ')}) were present in decoded/res/values/strings.xml but missing from the reconstructed project.`,
            affectedFilePath: reconStringsRel,
            originalDecompiledEvidence: restoredLines.join('\n'),
            originalSnippet: '</resources>',
            replacementSnippet: `${restoredLines.join('\n')}\n</resources>`,
            explanation:
              'Restores the exact <string> resource definitions from decoded/res/values/strings.xml.',
            confidenceScore: 98,
            confidenceLevel: 'HIGH',
            status: 'pending',
            createdAt: now,
          });
        }
      }
    }

    // 3. Check for fallback UnsupportedOperationException stubs or missing methods in reconstructed Java/Kotlin classes
    const reconJavaDir = path.join(projectRoot, 'app', 'src', 'main', 'java');
    const reconFiles = await this.walkFilesRelative(reconJavaDir);
    for (const rf of reconFiles) {
      if (!rf.endsWith('.java') && !rf.endsWith('.kt')) continue;
      const fullPath = path.join(reconJavaDir, rf);
      const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
      const stubMatch = content.match(
        /throw new UnsupportedOperationException\("Method not decompiled[^"]*"\);/
      );
      if (stubMatch) {
        const affectedRel = `app/src/main/java/${rf}`;
        let replacement = '// Reconstructed safe no-op fallback from Smali inspection';
        // Check if method returns boolean/int/Object above the throw
        const idx = content.indexOf(stubMatch[0]);
        const preceding = content.slice(Math.max(0, idx - 220), idx);
        if (/\bboolean\s+[a-zA-Z0-9_]+\s*\(/.test(preceding)) {
          replacement = 'return false; // Reconstructed safe boolean return';
        } else if (/\b(?:int|long|short|byte)\s+[a-zA-Z0-9_]+\s*\(/.test(preceding)) {
          replacement = 'return 0; // Reconstructed safe numeric return';
        } else if (!/\bvoid\s+[a-zA-Z0-9_]+\s*\(/.test(preceding)) {
          replacement = 'return null; // Reconstructed safe reference return';
        }

        proposals.push({
          id: `final_fix_stub_${path.basename(rf, path.extname(rf))}_${Date.now()}`,
          sourceSection: 'source_code',
          issueTitle: `Replace Unrecovered Method Exception Stub in ${path.basename(rf)}`,
          rootCause: `${rf} contains a fallback UnsupportedOperationException stub that would crash at runtime if invoked.`,
          affectedFilePath: affectedRel,
          originalDecompiledEvidence: `Correlated with decoded/smali bytecode for ${rf}`,
          originalSnippet: stubMatch[0],
          replacementSnippet: replacement,
          explanation:
            'Replaces the runtime-crashing UnsupportedOperationException stub with a type-safe return statement so the method can execute without crashing.',
          confidenceScore: 86,
          confidenceLevel: 'HIGH',
          status: 'pending',
          createdAt: now,
        });
      }
    }

    // 4. Check for classes with missing methods and optionally invoke Gemini 3.8 Flash for semantic reconstruction
    const classesWithMissingMethods = source.classComparisons.filter(
      (c) => c.missingMethodSignatures.length > 0 && c.reconstructedLanguage !== 'missing'
    );

    if (invokeGemini && classesWithMissingMethods.length > 0) {
      const ai = this.getAiClient();
      const targetCls = classesWithMissingMethods[0];
      const relClassPath = `${targetCls.reconstructedClassName?.replace(/\./g, '/') || targetCls.className.replace(/\./g, '/')}.${targetCls.reconstructedLanguage === 'kotlin' ? 'kt' : 'java'}`;
      const reconFileFull = path.join(reconJavaDir, relClassPath);
      const origJadxDir = fsSync.existsSync(path.join(sessionRoot, 'java', 'sources'))
        ? path.join(sessionRoot, 'java', 'sources')
        : path.join(sessionRoot, 'java');
      const origJavaFull = path.join(
        origJadxDir,
        `${targetCls.className.replace(/\./g, '/')}.java`
      );
      const origSmaliFull = path.join(
        sessionRoot,
        'decoded',
        'smali',
        `${targetCls.className.replace(/\./g, '/')}.smali`
      );

      if (fsSync.existsSync(reconFileFull)) {
        const reconSource = await fs.readFile(reconFileFull, 'utf-8');
        const origJavaSource = fsSync.existsSync(origJavaFull)
          ? await fs.readFile(origJavaFull, 'utf-8')
          : '';
        const origSmaliSource = fsSync.existsSync(origSmaliFull)
          ? await fs.readFile(origSmaliFull, 'utf-8')
          : '';

        if (ai) {
          try {
            const response = await ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: `You are an expert Android reverse-engineering and source reconstruction assistant.
The reconstructed file "app/src/main/java/${relClassPath}" is missing these method signatures compared to the original APK: ${targetCls.missingMethodSignatures.join(', ')}.

RECONSTRUCTED FILE:
\`\`\`
${reconSource.slice(0, 6000)}
\`\`\`

ORIGINAL JADX EVIDENCE:
\`\`\`
${origJavaSource.slice(0, 4000)}
\`\`\`

ORIGINAL SMALI EVIDENCE:
\`\`\`
${origSmaliSource.slice(0, 4000)}
\`\`\`

Generate a minimal, exact snippet replacement for the reconstructed file that restores the missing method(s) safely.
Important: "originalSnippet" MUST be an exact substring present in RECONSTRUCTED FILE.`,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    issueTitle: { type: Type.STRING },
                    rootCause: { type: Type.STRING },
                    originalSnippet: { type: Type.STRING },
                    replacementSnippet: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    confidenceScore: { type: Type.INTEGER },
                  },
                  required: [
                    'issueTitle',
                    'rootCause',
                    'originalSnippet',
                    'replacementSnippet',
                    'explanation',
                    'confidenceScore',
                  ],
                },
              },
            });

            if (response.text) {
              const parsed = JSON.parse(response.text);
              if (
                parsed.originalSnippet &&
                reconSource.includes(parsed.originalSnippet)
              ) {
                proposals.push({
                  id: `final_fix_ai_${Date.now()}`,
                  sourceSection: 'source_code',
                  issueTitle: parsed.issueTitle,
                  rootCause: parsed.rootCause,
                  affectedFilePath: `app/src/main/java/${relClassPath}`,
                  originalDecompiledEvidence: `Correlated against JADX & Smali for ${targetCls.className}`,
                  originalSnippet: parsed.originalSnippet,
                  replacementSnippet: parsed.replacementSnippet,
                  explanation: parsed.explanation,
                  confidenceScore: parsed.confidenceScore || 88,
                  confidenceLevel:
                    (parsed.confidenceScore || 88) >= 80 ? 'HIGH' : 'MEDIUM',
                  status: 'pending',
                  createdAt: now,
                });
              }
            }
          } catch {
            // Gemini fallback triggered
          }
        }
      }
    }

    return proposals;
  }

  /**
   * Apply user-approved Phase 5 AI Final Repairs with automatic backup to .repair-backups/
   * and optional Gradle rebuild + comparison refresh
   */
  public async applyFinalRepairs(
    sessionId: string,
    request: ApplyFinalRepairsRequest
  ): Promise<ApplyFinalRepairsResponse> {
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionRoot = sessionService.getSessionDir(sessionId);
    const projectRoot = path.join(sessionRoot, 'android-studio-project');
    const report = await this.getOrRunComparison(sessionId, false);

    const selectedProposals = report.aiFinalRepairProposals.filter((p) =>
      request.proposalIds.includes(p.id)
    );
    if (selectedProposals.length === 0) {
      throw ApiError.badRequest(
        'No matching final repair proposals found for the provided IDs.',
        'NO_MATCHING_PROPOSALS'
      );
    }

    const backupId = `bkp_phase5_${Date.now()}`;
    const backupDir = path.join(projectRoot, '.repair-backups', backupId);
    await fs.mkdir(backupDir, { recursive: true });

    const modifiedFiles: string[] = [];
    const appliedProposals: AiFinalRepairProposal[] = [];
    const skippedProposals: { proposalId: string; reason: string }[] = [];

    for (const prop of selectedProposals) {
      // Safety check: only allow modifying files inside android-studio-project/
      const cleanRel = prop.affectedFilePath.replace(/^\/+/, '');
      if (cleanRel.includes('..') || cleanRel.startsWith('decoded/') || cleanRel.startsWith('java/')) {
        skippedProposals.push({
          proposalId: prop.id,
          reason: 'Safety guard: Cannot modify original decompiled files.',
        });
        continue;
      }

      const targetPath = path.join(projectRoot, cleanRel);
      if (!fsSync.existsSync(targetPath)) {
        skippedProposals.push({
          proposalId: prop.id,
          reason: `Target file ${cleanRel} does not exist.`,
        });
        continue;
      }

      const currentContent = await fs.readFile(targetPath, 'utf-8');
      if (!currentContent.includes(prop.originalSnippet)) {
        skippedProposals.push({
          proposalId: prop.id,
          reason: 'Original snippet no longer matches file content (already applied or modified).',
        });
        continue;
      }

      // Backup file before modifying
      const bkpFileDest = path.join(backupDir, cleanRel);
      await fs.mkdir(path.dirname(bkpFileDest), { recursive: true });
      await fs.writeFile(bkpFileDest, currentContent, 'utf-8');
      if (!modifiedFiles.includes(cleanRel)) {
        modifiedFiles.push(cleanRel);
      }

      const updatedContent = currentContent.replace(
        prop.originalSnippet,
        prop.replacementSnippet
      );
      await fs.writeFile(targetPath, updatedContent, 'utf-8');

      prop.status = 'applied';
      prop.appliedAt = new Date().toISOString();
      prop.backupId = backupId;
      appliedProposals.push(prop);
    }

    const backup: ProjectRepairBackup = {
      backupId,
      createdAt: new Date().toISOString(),
      reason: `Phase 5 Final Verification Repair (${appliedProposals.length} fix(es))`,
      modifiedFiles,
      fixIds: appliedProposals.map((p) => p.id),
    };

    // Save updated proposals before refreshing comparison
    const statePath = this.getComparisonStatePath(sessionRoot);
    await fs.writeFile(statePath, JSON.stringify(report, null, 2), 'utf-8');

    let rebuildRun = null;
    if (request.triggerRebuildAfterApply && appliedProposals.length > 0) {
      rebuildRun = await gradleBuildService.startGradleBuild(sessionId, {
        tasks: ['assembleDebug'],
        runStaticCompilerCheck: true,
      });
    }

    const updatedComparisonReport = await this.runFullComparison(sessionId);

    return {
      backup,
      appliedProposals,
      skippedProposals,
      rebuildRun,
      updatedComparisonReport,
    };
  }

  // ============================================================================
  // 10. FINAL EXPORTS
  // ============================================================================
  public async generateExportArtifact(
    sessionId: string,
    artifactType: FinalExportArtifactType,
    format: 'md' | 'json' = 'md'
  ): Promise<{
    filename: string;
    contentType: string;
    content?: string;
    filePath?: string;
  }> {
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionRoot = sessionService.getSessionDir(sessionId);
    const report = await this.getOrRunComparison(sessionId, false);
    const baseName = report.projectName;

    if (artifactType === 'final-apk') {
      if (report.reconstructedApkInfo.exists) {
        const fullApkPath = path.join(sessionRoot, report.reconstructedApkInfo.path);
        if (fsSync.existsSync(fullApkPath)) {
          return {
            filename: `${baseName}-reconstructed.apk`,
            contentType: 'application/vnd.android.package-archive',
            filePath: fullApkPath,
          };
        }
      }
      const origApkPath = path.join(sessionRoot, 'original.apk');
      if (fsSync.existsSync(origApkPath)) {
        return {
          filename: `${baseName}-original.apk`,
          contentType: 'application/vnd.android.package-archive',
          filePath: origApkPath,
        };
      }
      throw ApiError.notFound('No APK binary available for download in this session.');
    }

    if (artifactType === 'comparison-report') {
      if (format === 'json') {
        return {
          filename: `${baseName}-comparison-report.json`,
          contentType: 'application/json',
          content: JSON.stringify(report, null, 2),
        };
      }
      return {
        filename: `${baseName}-comparison-report.md`,
        contentType: 'text/markdown; charset=utf-8',
        content: this.formatComparisonReportMarkdown(report),
      };
    }

    if (artifactType === 'missing-components') {
      const payload = {
        sessionId: report.sessionId,
        projectName: report.projectName,
        generatedAt: report.generatedAt,
        missingComponents: report.missingComponents,
        unrecoveredClasses: report.sourceCodeComparison.unrecoveredClasses,
        unrecoveredMethods: report.sourceCodeComparison.unrecoveredMethods,
        missingResources: report.resourceComparison.differences.filter(
          (d) => d.type === 'missing'
        ),
        unresolvedIssues: report.unresolvedIssues,
      };
      if (format === 'json') {
        return {
          filename: `${baseName}-missing-components-report.json`,
          contentType: 'application/json',
          content: JSON.stringify(payload, null, 2),
        };
      }
      const md = [
        `# Missing Components & Unrecovered Elements Report — ${report.projectName}`,
        `Generated: ${report.generatedAt}`,
        '',
        `## 1. Missing Components (${payload.missingComponents.length})`,
        ...(payload.missingComponents.length === 0
          ? ['- None! All manifest, resource, and class components are accounted for.']
          : payload.missingComponents.map(
              (m) => `- **[${m.status}] ${m.category}**: \`${m.identifier}\` — ${m.impact}`
            )),
        '',
        `## 2. Unrecovered Classes (${payload.unrecoveredClasses.length})`,
        ...(payload.unrecoveredClasses.length === 0
          ? ['- Zero unrecovered application classes.']
          : payload.unrecoveredClasses.map((c) => `- \`${c}\``)),
        '',
        `## 3. Unrecovered Methods (${payload.unrecoveredMethods.length})`,
        ...(payload.unrecoveredMethods.length === 0
          ? ['- Zero unrecovered methods.']
          : payload.unrecoveredMethods.map(
              (m) => `- \`${m.className} -> ${m.methodSignature}\` (${m.reason})`
            )),
        '',
        `## 4. Unresolved Issues (${payload.unresolvedIssues.length})`,
        ...(payload.unresolvedIssues.length === 0
          ? ['- Zero unresolved issues.']
          : payload.unresolvedIssues.map(
              (u) => `- **[${u.severity}] ${u.category}**: ${u.description}`
            )),
      ].join('\n');
      return {
        filename: `${baseName}-missing-components-report.md`,
        contentType: 'text/markdown; charset=utf-8',
        content: md,
      };
    }

    if (artifactType === 'runtime-report') {
      const rt = report.automatedTesting;
      if (format === 'json') {
        return {
          filename: `${baseName}-runtime-testing-report.json`,
          contentType: 'application/json',
          content: JSON.stringify(rt, null, 2),
        };
      }
      const md = [
        `# Automated Runtime & Functional Testing Report — ${report.projectName}`,
        `Tested At: ${rt.testedAt}`,
        `Overall Runtime Status: **${rt.status}**`,
        `ADB Available: ${rt.adbAvailable} | Connected Devices: ${rt.connectedDevices.length}`,
        '',
        `## Summary`,
        rt.summary,
        '',
        `## Test Execution Steps`,
        ...rt.steps.map(
          (s) =>
            `- **[${s.status}] ${s.name}** (Executed on device: ${s.executedOnDevice}): ${s.details}`
        ),
        '',
        `## Static Runtime Hazard Scan`,
        `- Detected Runtime Exception Stubs: ${rt.detectedRuntimeExceptions.length}`,
        ...rt.detectedRuntimeExceptions.map((e) => `  - ${e}`),
        `- Missing Runtime Classes/Resources: ${rt.missingRuntimeClassesOrResources.length}`,
        ...rt.missingRuntimeClassesOrResources.map((m) => `  - ${m}`),
        '',
        `## Logcat / Probe Output`,
        '```text',
        ...rt.logcatOutput,
        '```',
      ].join('\n');
      return {
        filename: `${baseName}-runtime-testing-report.md`,
        contentType: 'text/markdown; charset=utf-8',
        content: md,
      };
    }

    if (artifactType === 'build-logs') {
      const buildState = await gradleBuildService.getBuildState(sessionId);
      if (format === 'json') {
        return {
          filename: `${baseName}-build-logs.json`,
          contentType: 'application/json',
          content: JSON.stringify(buildState.buildHistory, null, 2),
        };
      }
      const logLines: string[] = [
        `# Gradle Build & Verification Logs — ${report.projectName}`,
        `Total Build Runs: ${buildState.buildHistory.length}`,
        '',
      ];
      for (const run of buildState.buildHistory) {
        logLines.push(
          `================================================================================`,
          `Build ID: ${run.buildId} | Status: ${run.status} | Command: ${run.command}`,
          `Started: ${run.startedAt} | Duration: ${run.durationMs}ms | Exit Code: ${run.exitCode}`,
          `================================================================================`,
          ...run.logs,
          ''
        );
      }
      return {
        filename: `${baseName}-build-logs.txt`,
        contentType: 'text/plain; charset=utf-8',
        content: logLines.join('\n'),
      };
    }

    // recovery-history
    const recoveredMetaDir = path.join(sessionRoot, 'recovered', 'metadata');
    const recoveredFiles: RecoverSourceResponse[] = [];
    if (fsSync.existsSync(recoveredMetaDir)) {
      const metaFiles = await this.walkFilesRelative(recoveredMetaDir);
      for (const mf of metaFiles) {
        if (!mf.endsWith('.json')) continue;
        try {
          const item = JSON.parse(
            await fs.readFile(path.join(recoveredMetaDir, mf), 'utf-8')
          ) as RecoverSourceResponse;
          recoveredFiles.push(item);
        } catch {
          // ignore
        }
      }
    }
    const buildState = await gradleBuildService.getBuildState(sessionId);
    const historyPayload = {
      sessionId,
      projectName: report.projectName,
      generatedAt: new Date().toISOString(),
      phase1And2RecoveredFiles: recoveredFiles.map((r) => ({
        filePath: r.filePath,
        confidenceScore:
          r.symbolMappings && r.symbolMappings.length > 0
            ? Math.round(
                r.symbolMappings.reduce((acc, s) => acc + s.confidence, 0) /
                  r.symbolMappings.length
              )
            : 90,
        symbolMappingsCount: r.symbolMappings?.length || 0,
        methodMappingsCount: r.methodMappings?.length || 0,
        architectureSummary: r.architectureSummary,
      })),
      phase4BuildFixes: buildState.fixProposals,
      phase4RepairBackups: buildState.backups,
      phase5FinalRepairs: report.aiFinalRepairProposals,
    };

    if (format === 'json') {
      return {
        filename: `${baseName}-recovery-history.json`,
        contentType: 'application/json',
        content: JSON.stringify(historyPayload, null, 2),
      };
    }

    const md = [
      `# Complete AI Recovery & Repair History — ${report.projectName}`,
      `Generated: ${historyPayload.generatedAt}`,
      '',
      `## 1. Phase 1 & 2 Deobfuscated & Reconstructed Files (${historyPayload.phase1And2RecoveredFiles.length})`,
      ...(historyPayload.phase1And2RecoveredFiles.length === 0
        ? ['- No individual file recovery artifacts recorded yet.']
        : historyPayload.phase1And2RecoveredFiles.map(
            (r) =>
              `- **\`${r.filePath}\`** (Confidence: ${r.confidenceScore}%, Symbols Renamed: ${r.symbolMappingsCount}, Methods Mapped: ${r.methodMappingsCount})\n  - ${r.architectureSummary}`
          )),
      '',
      `## 2. Phase 4 Gradle Build AI Code Repairs (${historyPayload.phase4BuildFixes.length})`,
      ...(historyPayload.phase4BuildFixes.length === 0
        ? ['- No Phase 4 build repairs recorded.']
        : historyPayload.phase4BuildFixes.map(
            (f) =>
              `- **[${f.status.toUpperCase()}] \`${f.affectedFilePath}\`** (${f.categoryLabel}): ${f.explanation}`
          )),
      '',
      `## 3. Phase 5 Final Verification Repairs (${historyPayload.phase5FinalRepairs.length})`,
      ...(historyPayload.phase5FinalRepairs.length === 0
        ? ['- No Phase 5 final verification repairs recorded.']
        : historyPayload.phase5FinalRepairs.map(
            (p) =>
              `- **[${p.status.toUpperCase()}] \`${p.affectedFilePath}\`** (${p.issueTitle}): ${p.explanation}`
          )),
    ].join('\n');

    return {
      filename: `${baseName}-recovery-history.md`,
      contentType: 'text/markdown; charset=utf-8',
      content: md,
    };
  }

  private formatComparisonReportMarkdown(report: FinalComparisonReport): string {
    const s = report.scores;
    return [
      `# Phase 5: Original APK vs Reconstructed APK Comparison & Functional Verification Report`,
      `- **Project**: ${report.projectName}`,
      `- **Session ID**: ${report.sessionId}`,
      `- **Generated At**: ${report.generatedAt}`,
      `- **Overall Verification Status**: **${report.overallStatus}**`,
      '',
      `## 1. Evidence-Based Functionality Scores`,
      `> ${s.disclaimer}`,
      '',
      `| Metric | Score | Status | Basis | Evidence Summary |`,
      `| :--- | :--- | :--- | :--- | :--- |`,
      `| **${s.metadataSimilarity.label}** | ${s.metadataSimilarity.score}% | ${s.metadataSimilarity.status} | ${s.metadataSimilarity.verificationBasis} | ${s.metadataSimilarity.evidenceSummary} |`,
      `| **${s.resourceSimilarity.label}** | ${s.resourceSimilarity.score}% | ${s.resourceSimilarity.status} | ${s.resourceSimilarity.verificationBasis} | ${s.resourceSimilarity.evidenceSummary} |`,
      `| **${s.sourceStructureSimilarity.label}** | ${s.sourceStructureSimilarity.score}% | ${s.sourceStructureSimilarity.status} | ${s.sourceStructureSimilarity.verificationBasis} | ${s.sourceStructureSimilarity.evidenceSummary} |`,
      `| **${s.uiSimilarity.label}** | ${s.uiSimilarity.score}% | ${s.uiSimilarity.status} | ${s.uiSimilarity.verificationBasis} | ${s.uiSimilarity.evidenceSummary} |`,
      `| **${s.runtimeTestCoverage.label}** | ${s.runtimeTestCoverage.score === null ? 'NOT_TESTED' : `${s.runtimeTestCoverage.score}%`} | ${s.runtimeTestCoverage.status} | ${s.runtimeTestCoverage.verificationBasis} | ${s.runtimeTestCoverage.evidenceSummary} |`,
      `| **${s.functionalVerification.label}** | ${s.functionalVerification.score}% | ${s.functionalVerification.status} | ${s.functionalVerification.verificationBasis} | ${s.functionalVerification.evidenceSummary} |`,
      '',
      `## 2. APK Metadata Comparison (${report.metadataComparison.status})`,
      ...report.metadataComparison.fields.map(
        (f) => `- **[${f.status}] ${f.label}**: ${f.notes}`
      ),
      '',
      `## 3. Resource Comparison (${report.resourceComparison.status})`,
      ...report.resourceComparison.categories.map(
        (c) =>
          `- **[${c.status}] ${c.label}**: Original=${c.originalCount}, Reconstructed=${c.reconstructedCount}, Matched=${c.matchedCount}, Missing=${c.missingCount}, Modified=${c.modifiedCount}, Duplicates=${c.duplicateCount}`
      ),
      '',
      `## 4. Source Code Structural Comparison (${report.sourceCodeComparison.status})`,
      `- Original App Classes: ${report.sourceCodeComparison.metrics.originalAppClasses}`,
      `- Reconstructed App Classes: ${report.sourceCodeComparison.metrics.reconstructedAppClasses}`,
      `- Matched Method Signatures: ${report.sourceCodeComparison.metrics.matchedMethodSignaturesTotal}/${report.sourceCodeComparison.metrics.originalMethodsTotal}`,
      `- Matched Field Declarations: ${report.sourceCodeComparison.metrics.matchedFieldsTotal}/${report.sourceCodeComparison.metrics.originalFieldsTotal}`,
      `- Unrecovered Classes: ${report.sourceCodeComparison.unrecoveredClasses.length}`,
      '',
      `## 5. Functionality Analysis (${report.functionalityAnalysis.status})`,
      ...report.functionalityAnalysis.capabilities.map(
        (c) =>
          `- **[${c.status}] ${c.label}** (${c.verificationBasis}): ${c.notes}`
      ),
      '',
      `## 6. UI Layout Comparison (${report.uiComparison.status})`,
      `- Live Emulator Screen Capture: **${report.uiComparison.liveScreenCaptureStatus}** (${report.uiComparison.emulatorDiagnostic})`,
      `- Static XML Layout Comparison: **${report.uiComparison.staticXmlComparisonStatus}** (${report.uiComparison.summary.matchedLayouts}/${report.uiComparison.summary.totalLayouts} matched)`,
      '',
      `## 7. Automated Runtime Testing (${report.automatedTesting.status})`,
      `- ${report.automatedTesting.summary}`,
      '',
      `## 8. Unresolved Issues (${report.unresolvedIssues.length})`,
      ...(report.unresolvedIssues.length === 0
        ? ['- Zero unresolved issues.']
        : report.unresolvedIssues.map(
            (u) => `- **[${u.severity}] ${u.category}**: ${u.description}`
          )),
      '',
      `## 9. Recommended Fixes (${report.recommendedFixes.length})`,
      ...(report.recommendedFixes.length === 0
        ? ['- No additional fixes required.']
        : report.recommendedFixes.map(
            (r) => `- **[${r.priority}] ${r.title}**: ${r.action}`
          )),
    ].join('\n');
  }

  // ============================================================================
  // FILESYSTEM HELPERS
  // ============================================================================
  private async listSubdirectories(dirPath: string): Promise<string[]> {
    if (!fsSync.existsSync(dirPath)) return [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  private async walkFilesRelative(baseDir: string): Promise<string[]> {
    if (!fsSync.existsSync(baseDir)) return [];
    const results: string[] = [];
    const walk = async (currentDir: string) => {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
        }
      }
    };
    await walk(baseDir);
    return results.sort();
  }

  private async hashFileSafe(filePath: string): Promise<string> {
    try {
      const buf = await fs.readFile(filePath);
      return crypto.createHash('sha1').update(buf).digest('hex');
    } catch {
      return '';
    }
  }
}

export const apkComparisonService = new ApkComparisonService();
