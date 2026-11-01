import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type {
  ManifestScanData,
  ManifestScannerSummary,
  SecurityFinding,
  ComponentFinding,
  FindingSeverity,
} from '../types/index.js';
import { sessionService } from './session.service.js';

const DANGEROUS_PERMISSIONS = new Set([
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.CAMERA',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.GET_ACCOUNTS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_PHONE_STATE',
  'android.permission.READ_PHONE_NUMBERS',
  'android.permission.CALL_PHONE',
  'android.permission.ANSWER_PHONE_CALLS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.ADD_VOICEMAIL',
  'android.permission.USE_SIP',
  'android.permission.PROCESS_OUTGOING_CALLS',
  'android.permission.BODY_SENSORS',
  'android.permission.BODY_SENSORS_BACKGROUND',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.SEND_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_WAP_PUSH',
  'android.permission.RECEIVE_MMS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_ADVERTISE',
]);

export class ManifestService {
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
  });

  public async scanManifest(sessionId: string): Promise<ManifestScanData> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const manifestPath = path.join(sessionDir, 'decoded', 'AndroidManifest.xml');

    const summary: ManifestScannerSummary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
    };

    const dangerousPermissions: SecurityFinding[] = [];
    const exportedComponents: ComponentFinding[] = [];
    const applicationFlags: Record<string, boolean | string | number> = {};
    const warnings: SecurityFinding[] = [];
    const generalFindings: SecurityFinding[] = [];

    const recordSeverity = (sev: FindingSeverity) => {
      summary[sev]++;
    };

    let xmlContent: string;
    try {
      xmlContent = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      const finding: SecurityFinding = {
        id: 'WARN-NO-MANIFEST',
        title: 'AndroidManifest.xml Not Found',
        category: 'manifest',
        severity: 'high',
        description: 'Decoded AndroidManifest.xml could not be located in decoded/ directory.',
        evidence: manifestPath,
        recommendation: 'Ensure apktool completed decoding successfully.',
      };
      warnings.push(finding);
      recordSeverity('high');
      return {
        sessionId,
        scannedAt: new Date().toISOString(),
        summary,
        dangerousPermissions,
        exportedComponents,
        applicationFlags,
        warnings,
        generalFindings,
      };
    }

    let parsedXml: Record<string, unknown>;
    try {
      parsedXml = this.parser.parse(xmlContent);
    } catch (parseErr) {
      const finding: SecurityFinding = {
        id: 'CRIT-PARSE-FAIL',
        title: 'Manifest XML Parsing Failed',
        category: 'manifest',
        severity: 'critical',
        description: `Failed to parse AndroidManifest.xml: ${(parseErr as Error).message}`,
        evidence: xmlContent.slice(0, 300),
        recommendation: 'Verify XML syntax and encoding inside the decoded manifest.',
      };
      warnings.push(finding);
      recordSeverity('critical');
      return {
        sessionId,
        scannedAt: new Date().toISOString(),
        summary,
        dangerousPermissions,
        exportedComponents,
        applicationFlags,
        warnings,
        generalFindings,
      };
    }

    const manifestObj = (parsedXml.manifest || parsedXml) as Record<string, unknown>;

    // 1. Shared User ID check
    const sharedUserId = this.getAttr(manifestObj, 'sharedUserId');
    if (sharedUserId) {
      applicationFlags.sharedUserId = String(sharedUserId);
      const sev: FindingSeverity = 'medium';
      const f: SecurityFinding = {
        id: 'FLAG-SHARED-UID',
        title: 'Shared User ID Defined',
        category: 'flag',
        severity: sev,
        description: `Application specifies android:sharedUserId="${sharedUserId}". Shared user IDs share system sandboxes with other applications.`,
        evidence: `android:sharedUserId="${sharedUserId}"`,
        recommendation: 'Avoid android:sharedUserId as it is deprecated in API 29+ and can lead to unintended sandbox sharing.',
      };
      generalFindings.push(f);
      recordSeverity(sev);
    }

    // 2. Scan Permissions
    const rawPermissions = this.normalizeArray(manifestObj['uses-permission']);
    for (const perm of rawPermissions) {
      const permName = this.getAttr(perm, 'name');
      if (typeof permName === 'string') {
        if (DANGEROUS_PERMISSIONS.has(permName)) {
          const sev: FindingSeverity = 'medium';
          const finding: SecurityFinding = {
            id: `PERM-${permName.replace(/[^a-zA-Z0-9]/g, '_')}`,
            title: `Dangerous Permission: ${permName.replace('android.permission.', '')}`,
            category: 'permission',
            severity: sev,
            description: `Application requests runtime dangerous permission: ${permName}. Requires user runtime grant and careful auditing.`,
            evidence: `<uses-permission android:name="${permName}" />`,
            recommendation: 'Review necessity of this permission according to least-privilege principle.',
          };
          dangerousPermissions.push(finding);
          recordSeverity(sev);
        }
      }
    }

    // 3. Application Element & Flags
    const appElement = manifestObj.application as Record<string, unknown> | undefined;
    if (!appElement) {
      const f: SecurityFinding = {
        id: 'WARN-NO-APP-ELEMENT',
        title: 'Missing <application> Element',
        category: 'manifest',
        severity: 'high',
        description: 'No <application> tag was found in AndroidManifest.xml.',
        evidence: 'Root manifest tag contains no application child.',
        recommendation: 'Ensure valid application declaration in AndroidManifest.xml.',
      };
      warnings.push(f);
      recordSeverity('high');
      return {
        sessionId,
        scannedAt: new Date().toISOString(),
        summary,
        dangerousPermissions,
        exportedComponents,
        applicationFlags,
        warnings,
        generalFindings,
      };
    }

    // Flag: android:debuggable
    const debuggable = this.getAttr(appElement, 'debuggable');
    if (debuggable === 'true' || debuggable === true) {
      applicationFlags.debuggable = true;
      const sev: FindingSeverity = 'critical';
      generalFindings.push({
        id: 'FLAG-DEBUGGABLE',
        title: 'Application is Debuggable (android:debuggable="true")',
        category: 'flag',
        severity: sev,
        description: 'The application enables debugging. Anyone with adb access can attach debuggers, extract data, or execute code in app context.',
        evidence: 'android:debuggable="true"',
        recommendation: 'Ensure android:debuggable is false or omitted in release builds.',
      });
      recordSeverity(sev);
    } else {
      applicationFlags.debuggable = false;
    }

    // Flag: android:allowBackup
    const allowBackup = this.getAttr(appElement, 'allowBackup');
    if (allowBackup === 'true' || allowBackup === true || allowBackup === undefined) {
      const isExplicit = allowBackup !== undefined;
      applicationFlags.allowBackup = true;
      const sev: FindingSeverity = 'medium';
      generalFindings.push({
        id: 'FLAG-ALLOW-BACKUP',
        title: isExplicit ? 'Application Backup Enabled' : 'Application Backup Enabled by Default',
        category: 'flag',
        severity: sev,
        description: isExplicit
          ? 'android:allowBackup="true" allows ADB backups of private application data unless restricted.'
          : 'android:allowBackup defaults to true when omitted, potentially exposing private app data to adb backup.',
        evidence: isExplicit ? 'android:allowBackup="true"' : 'android:allowBackup omitted (defaults true)',
        recommendation: 'Set android:allowBackup="false" if application stores sensitive credentials or keys, or define a BackupAgent.',
      });
      recordSeverity(sev);
    } else {
      applicationFlags.allowBackup = false;
    }

    // Flag: android:usesCleartextTraffic
    const cleartext = this.getAttr(appElement, 'usesCleartextTraffic');
    if (cleartext === 'true' || cleartext === true) {
      applicationFlags.usesCleartextTraffic = true;
      const sev: FindingSeverity = 'high';
      generalFindings.push({
        id: 'FLAG-CLEARTEXT',
        title: 'Cleartext HTTP Traffic Allowed',
        category: 'network',
        severity: sev,
        description: 'android:usesCleartextTraffic="true" allows unencrypted HTTP network communication, vulnerable to eavesdropping and MITM.',
        evidence: 'android:usesCleartextTraffic="true"',
        recommendation: 'Enforce HTTPS for all endpoints and use a res/xml/network_security_config.xml.',
      });
      recordSeverity(sev);
    } else {
      applicationFlags.usesCleartextTraffic = false;
    }

    // Flag: networkSecurityConfig
    const netConfig = this.getAttr(appElement, 'networkSecurityConfig');
    if (netConfig) {
      applicationFlags.networkSecurityConfig = String(netConfig);
      generalFindings.push({
        id: 'INFO-NET-CONFIG',
        title: 'Network Security Config Present',
        category: 'network',
        severity: 'informational',
        description: `Custom network security configuration referenced: ${netConfig}.`,
        evidence: `android:networkSecurityConfig="${netConfig}"`,
        recommendation: 'Inspect referenced XML file to verify certificate pinning and cleartext traffic policies.',
      });
      recordSeverity('informational');
    }

    // Flag: requestLegacyExternalStorage
    const legacyStorage = this.getAttr(appElement, 'requestLegacyExternalStorage');
    if (legacyStorage === 'true' || legacyStorage === true) {
      applicationFlags.requestLegacyExternalStorage = true;
      const sev: FindingSeverity = 'medium';
      generalFindings.push({
        id: 'FLAG-LEGACY-STORAGE',
        title: 'Legacy External Storage Requested',
        category: 'storage',
        severity: sev,
        description: 'android:requestLegacyExternalStorage="true" opts out of scoped storage isolation on Android 10+.',
        evidence: 'android:requestLegacyExternalStorage="true"',
        recommendation: 'Migrate to Android Scoped Storage model.',
      });
      recordSeverity(sev);
    }

    // 4. Scan Components: Activities, Activity-Aliases, Services, Receivers, Providers
    const scanComponentList = (
      rawList: unknown,
      type: 'activity' | 'activity-alias' | 'service' | 'receiver' | 'provider'
    ) => {
      const items = this.normalizeArray(rawList);
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const compObj = item as Record<string, unknown>;
        const name = String(this.getAttr(compObj, 'name') || 'UnnamedComponent');
        const exportedRaw = this.getAttr(compObj, 'exported');
        const permission = this.getAttr(compObj, 'permission');
        const hasIntentFilter = Boolean(compObj['intent-filter']);

        // Android export logic:
        // If explicit exported attribute is set: use it
        // If omitted: if intent-filter exists, defaults to true on pre-API 31, false on API 31+
        let isExported = false;
        if (exportedRaw === 'true' || exportedRaw === true) {
          isExported = true;
        } else if (exportedRaw === 'false' || exportedRaw === false) {
          isExported = false;
        } else if (hasIntentFilter) {
          isExported = true; // Review required: intent filter without explicit exported flag
        }

        if (isExported) {
          const hasProtection = Boolean(permission);
          let severity: FindingSeverity = 'low';
          let explanation = `Component is exported and can be launched by third-party apps or system.`;
          let recommendation = 'Ensure inputs and incoming intents are strictly validated.';

          if (!hasProtection) {
            // Unprotected exported component
            if (type === 'provider') {
              severity = 'high';
              explanation = 'Content provider is exported with no protecting permission. May expose local database queries or file access.';
              recommendation = 'Add android:permission, android:readPermission, or set android:exported="false".';
            } else if (type === 'service') {
              severity = 'high';
              explanation = 'Service is exported without permission. Any app on device can start or bind to this service.';
              recommendation = 'Protect service with a custom permission or set android:exported="false".';
            } else if (type === 'receiver') {
              severity = 'medium';
              explanation = 'Broadcast receiver is exported without permission. Can receive spoofed broadcast intents.';
              recommendation = 'Protect with permission or verify broadcast sender UID.';
            } else {
              // Activity
              severity = 'medium';
              explanation = 'Activity is exported without permission. Can be invoked directly via explicit Intent.';
              recommendation = 'Ensure activity does not perform sensitive actions without authorization checks.';
            }
          } else {
            // Protected with permission
            explanation += ` Protected by permission: ${permission}.`;
            severity = 'informational';
          }

          if (exportedRaw === undefined && hasIntentFilter) {
            explanation += ' [Warning: android:exported was omitted despite having an intent-filter.]';
          }

          exportedComponents.push({
            type,
            name,
            exported: isExported,
            permission: permission ? String(permission) : undefined,
            hasIntentFilter,
            severity,
            explanation,
            recommendation,
          });
          recordSeverity(severity);
        }
      }
    };

    scanComponentList(appElement.activity, 'activity');
    scanComponentList(appElement['activity-alias'], 'activity-alias');
    scanComponentList(appElement.service, 'service');
    scanComponentList(appElement.receiver, 'receiver');
    scanComponentList(appElement.provider, 'provider');

    return {
      sessionId,
      scannedAt: new Date().toISOString(),
      summary,
      dangerousPermissions,
      exportedComponents,
      applicationFlags,
      warnings,
      generalFindings,
    };
  }

  private normalizeArray(val: unknown): unknown[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
  }

  private getAttr(obj: unknown, attrName: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    const record = obj as Record<string, unknown>;
    return (
      record[`@_android:${attrName}`] ??
      record[`@_${attrName}`] ??
      record[`android:${attrName}`] ??
      record[attrName]
    );
  }
}

export const manifestService = new ManifestService();
