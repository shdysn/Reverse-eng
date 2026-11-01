# Android Reverse Engineering Dashboard

> **⚠️ AUTHORIZED USE ONLY NOTICE**  
> This application is strictly intended for:
> - Android APK packages owned by the user
> - Authorized security assessments and penetration tests
> - Application security education and academic research
> - Malware analysis conducted in an isolated, sandboxed environment
> - Legitimate Android software development and debugging
>
> Any unauthorized reverse engineering, tampering, distribution, or interception of intellectual property without explicit permission from the application copyright holder or owner is strictly prohibited.

---

## Overview

**Android Reverse Engineering Dashboard** is a full-stack, IDE-inspired web application designed to analyze, inspect, modify, and rebuild Android applications in an isolated sandbox. Featuring a Visual Studio Code-inspired dark UI, the dashboard orchestrates standard external Android utilities (`apktool`, `jadx`, `zipalign`, `apksigner`) with security-hardened TypeScript backend execution, chunked streaming uploads, Monaco-powered multi-tab code editing, and an automated `AndroidManifest.xml` security scanner.

---

## Screens & Main Features

- **Chunked APK Upload Modal**: Drag-and-drop file uploader supporting large APK packages up to 1 GiB streamed in 8 MiB chunks with progress tracking, ZIP Slip protection, and decompression ratio validation.
- **IDE File Explorer**: Monospace tree view displaying disassembled Smali (`decoded/smali/`), resources (`decoded/res/`), `AndroidManifest.xml`, assets, and decompiled Java source code (`java/`).
- **Monaco Code Editor**: Multi-tab code editor with custom syntax highlighting for `.smali` bytecode, syntax tokenization for XML/Java/JSON, find & replace, code folding, word wrap, and keyboard shortcuts (`Ctrl+S` / `Cmd+S`).
- **Manifest Security Scanner**: Automated audit of `AndroidManifest.xml` targeting:
  - Dangerous runtime permissions (location, camera, microphone, SMS, contacts, etc.)
  - Exported components (activities, activity-aliases, services, broadcast receivers, content providers) and protecting permission enforcement
  - Application security flags (`android:debuggable`, `android:allowBackup`, `android:usesCleartextTraffic`, `requestLegacyExternalStorage`, `sharedUserId`)
  - Network security configuration detection
- **Secure Rebuild & Test-Signing Pipeline**: Reassembles modified Smali/resources (`apktool b`), performs 4-byte page alignment (`zipalign`), signs with a disposable development key (`apksigner sign`), and verifies the cryptographic signature before providing an authenticated download link.
- **Responsive Mobile Drawers**: Adaptive touch-friendly layout allowing explorer and security scanner inspection on tablets and mobile devices.

---

## Technology Stack

### Frontend
- **React 19** & **TypeScript**
- **Vite** bundler
- **Tailwind CSS**
- **Monaco Editor** (`@monaco-editor/react`)
- **Lucide React** icons
- **Native Fetch API** with `AbortController` cancellation

### Backend
- **Node.js 20+** & **Express.js**
- **TypeScript** with native modules
- **Multer** for chunked multipart upload processing
- **fast-xml-parser** for namespace-aware Android manifest analysis
- **Zod** schema validation
- **Helmet** HTTP security headers
- **CORS** middleware
- **Express Rate Limit**
- **Native child_process.spawn** for shell-free, secure CLI execution

### External Android CLI Tools
- **OpenJDK / Java 17+**
- **keytool**
- **apktool**
- **JADX**
- **zipalign**
- **apksigner**

---

## Architecture Overview

```
android-re-dashboard/
├── .devcontainer/
│   └── devcontainer.json          # Codespaces container configuration
├── .github/
│   └── workflows/
│       └── build.yml              # GitHub Actions CI workflow
├── .vscode/
│   └── settings.json              # VS Code workspace settings
├── client/                        # React Frontend Workspace
│   ├── src/
│   │   ├── components/            # UI components (FileTree, Editor, Scanner, etc.)
│   │   ├── hooks/                 # Custom hooks (useSession, useEditorTabs, useApkUpload)
│   │   ├── services/              # Centralized API service
│   │   ├── types/                 # Frontend interfaces
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/                        # Express Backend Workspace
│   ├── src/
│   │   ├── config/env.ts          # Zod-validated environment config
│   │   ├── middleware/            # Error handler, rate limit, session validator
│   │   ├── routes/                # Health, upload, session, scan, rebuild routes
│   │   ├── services/              # Command, session, file, apk, manifest, rebuild
│   │   ├── types/index.ts
│   │   ├── utils/safePath.ts      # Containment & traversal validation
│   │   ├── app.ts                 # Express app builder
│   │   └── index.ts               # Standalone server entrypoint
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── shared/                        # Shared API Types Workspace
│   ├── api-types.ts
│   └── package.json
├── server.ts                      # Full-stack unified server entrypoint
├── setup-codespace.sh             # Codespace / Ubuntu installer script
├── run-dashboard.sh               # Safe daemon startup script
├── stop-dashboard.sh              # Recorded PID shutdown script
├── .gitignore
├── package.json
└── README.md
```

---

## Quickstart

### 1. Google AI Studio Preview
In Google AI Studio, the application runs a unified full-stack server on port 3000. The frontend preview and API endpoints are fully active. Because cloud preview sandboxes do not include binary installations of `apktool` and `jadx`, the dashboard's health status indicates:
`Preview Mode (CLI Tools Missing)`.

To perform full decompilation and re-signing, export or push the repository to GitHub and launch it in **GitHub Codespaces** or a local Ubuntu environment.

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial Android reverse engineering dashboard"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

### 3. Open in GitHub Codespaces
1. Open your repository on GitHub.
2. Click **Code** -> **Codespaces** -> **Create codespace on main**.
3. Codespaces automatically provisions the container specified in `.devcontainer/devcontainer.json` and executes `setup-codespace.sh`.
4. Start the dashboard:
   ```bash
   ./run-dashboard.sh
   ```

### 4. Local Ubuntu / Debian Setup
```bash
# Make scripts executable
chmod +x setup-codespace.sh run-dashboard.sh stop-dashboard.sh

# Run setup (installs JDK, apktool, jadx, zipalign, apksigner, and dependencies)
./setup-codespace.sh

# Start backend (port 8000) and frontend (port 5173)
./run-dashboard.sh

# To terminate cleanly:
./stop-dashboard.sh
```

---

## Port Allocation
- **Frontend Port**: `5173` (Vite dev server)
- **Backend Port**: `8000` (Express API)
- **AI Studio Preview**: `3000` (Unified server mounting Vite middlewares)

*Note: In Codespaces, ports 5173 and 8000 should remain set to **Private**.*

---

## Environment Variables

### Server Configuration (`server/.env` / `server/.env.codespace`)
| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`) |
| `PORT` | `8000` | Port for the Express backend |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `WORK_ROOT` | `sessions` | Session storage directory |
| `MAX_APK_BYTES` | `1073741824` | Maximum allowable APK size (1 GiB) |
| `MAX_CHUNK_BYTES` | `16777216` | Maximum chunk size (16 MiB) |
| `MAX_TEXT_BYTES` | `2097152` | Maximum text file size for editor (2 MiB) |
| `SESSION_TTL_HOURS` | `12` | Session retention period before automated cleanup |
| `APKTOOL_BIN` | `apktool` | Path or name of apktool executable |
| `JADX_BIN` | `jadx` | Path or name of JADX executable |
| `ZIPALIGN_BIN` | `zipalign` | Path or name of zipalign executable |
| `APKSIGNER_BIN` | `apksigner` | Path or name of apksigner executable |
| `COMMAND_TIMEOUT_MS`| `900000` | Maximum CLI execution timeout (15 min) |
| `COMMAND_OUTPUT_LIMIT`| `100000`| Maximum captured stdout/stderr bytes |
| `TEST_KEYSTORE` | `testkey.jks` | Path to disposable development test keystore |
| `TEST_KEY_ALIAS` | `androidtestkey` | Disposable test key alias |
| `TEST_KEY_PASSWORD` | `androiddevtestkey123` | Disposable test key password |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check & tool availability audit |
| `POST`| `/api/uploads/init` | Initialize chunked session |
| `PUT` | `/api/uploads/:sessionId/chunks/:chunkIndex` | Stream binary chunk |
| `POST`| `/api/uploads/:sessionId/complete` | Assemble chunks & run decompilation pipeline |
| `GET` | `/api/sessions/:sessionId` | Retrieve session metadata |
| `GET` | `/api/sessions/:sessionId/tree` | Fetch recursive file tree |
| `GET` | `/api/sessions/:sessionId/file?path=...` | Read UTF-8 source file |
| `PUT` | `/api/sessions/:sessionId/file?path=...` | Save edited source file atomically |
| `POST`| `/api/sessions/:sessionId/scan` | Rescan `decoded/AndroidManifest.xml` |
| `POST`| `/api/sessions/:sessionId/rebuild` | Execute rebuild, align, sign & verify |
| `GET` | `/api/sessions/:sessionId/download` | Download verified signed APK package |
| `DELETE`| `/api/sessions/:sessionId` | Delete session and wipe temporary files |

---

## Security Architecture

1. **Child Process Execution**:
   - Strictly uses `child_process.spawn` with `shell: false`.
   - Never uses `child_process.exec` or string concatenation.
   - Arguments are passed as validated array elements.
   - Secrets and passwords in CLI command outputs are masked before logging.
2. **Filesystem Containment (`safePath`)**:
   - Validates that every file operation resolves strictly within the session root.
   - Enforces `path.relative` boundaries and rejects null bytes, traversal tokens (`..`), and unsafe symbolic links.
   - Only `decoded/` and `java/` are writable. `input.apk`, `build/`, `chunks/`, and session metadata are strictly read-only.
3. **Container & Zip Slip Protection**:
   - Pre-validation parses ZIP headers before any external tool is invoked.
   - Rejects archives containing entries starting with `/`, `\`, or traversal sequences.
4. **Disposable Development Keystore**:
   - Generates a sandboxed 2048-bit RSA test key for local verification only.
   - Never requests or accepts production signing certificates.

---

## Manifest Scanner Limitations

Static manifest scanning provides automated visibility into declared Android permissions and exported components, but:
- It **does not prove runtime exploitability**.
- An exported component may implement programmatic caller verification (e.g., `Binder.getCallingUid()` or signature checks).
- An omitted `android:exported` flag behaves differently across API levels (pre-API 31 vs API 31+).
- Manual verification in source code or a dynamic lab is always required.

---

## Troubleshooting

- **`apktool: not found` or `java: not found`**:
  Ensure you have run `./setup-codespace.sh`. In Ubuntu/Debian:
  `sudo apt-get install default-jdk apktool zipalign apksigner`
- **JADX not found or partial failure**:
  JADX is optional for re-engineering. Smali and resources produced by `apktool` are sufficient for editing and rebuilding. If JADX is desired, `./setup-codespace.sh` downloads the latest release from GitHub to `/opt/jadx`.
- **`Test keystore missing`**:
  Generate the disposable key:
  ```bash
  keytool -genkeypair -alias androidtestkey -keyalg RSA -keysize 2048 -validity 10000 -keystore server/testkey.jks -storepass androiddevtestkey123 -keypass androiddevtestkey123 -dname "CN=AndroidTestKey, OU=Dev, O=LocalTest, L=Lab, ST=Lab, C=US"
  ```
- **File cannot be opened (Binary file)**:
  Compiled `.dex`, `.arsc`, `.so`, and `.png` files cannot be edited as text. Inspect decompiled Smali files in `decoded/smali/` instead.
- **`EACCES` Permission Denied on shell scripts**:
  Run:
  `chmod +x setup-codespace.sh run-dashboard.sh stop-dashboard.sh`
- **Port already in use**:
  Use `./stop-dashboard.sh` to terminate any lingering processes recorded in `.pids/`.

---

## Production Hardening Notice

This dashboard is designed for sandboxed local analysis and educational security auditing. If deploying in a shared multi-tenant environment, the backend must be further hardened with:
- Authenticated user sessions & Role-Based Access Control (RBAC)
- Ephemeral rootless Docker containers / Firecracker microVMs per session
- Strict cgroup memory, CPU, and process limits
- Quota-enforced storage mounts
- Antivirus / ClamAV scanning on uploaded APKs
- Private isolated network namespaces
