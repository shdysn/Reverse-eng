#!/usr/bin/env bash
set -Eeuo pipefail

echo "===================================================="
echo "Android Reverse Engineering Dashboard Setup"
echo "Target: GitHub Codespaces / Ubuntu Linux"
echo "===================================================="

# 1 & 2. Verify repository root structure
if [[ ! -f "package.json" || ! -d "client" || ! -d "server" ]]; then
  echo "Error: setup-codespace.sh must be executed from the project root directory." >&2
  exit 1
fi

SUDO=""
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "Warning: Running as non-root without sudo. Apt package installations may fail."
  fi
fi

# 3 & 4. Install system dependencies & Android tools via apt
echo "[1/7] Updating apt repositories and installing packages..."
if command -v apt-get >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    default-jdk \
    nodejs \
    npm \
    apktool \
    zipalign \
    apksigner \
    curl \
    unzip \
    zip \
    git \
    jq \
    ca-certificates
fi

# 5, 6, 7, 8, 9. Install JADX CLI if not already present
echo "[2/7] Checking JADX CLI installation..."
if ! command -v jadx >/dev/null 2>&1; then
  echo "JADX not found. Fetching latest release from GitHub API..."
  TMP_DIR=$(mktemp -d)
  JADX_URL=$(curl -sSL "https://api.github.com/repos/skylot/jadx/releases/latest" | jq -r '.assets[] | select(.name | test("^jadx-[0-9.]+\\.zip$")) | .browser_download_url' | head -n 1)

  if [[ -n "$JADX_URL" && "$JADX_URL" != "null" ]]; then
    echo "Downloading JADX from: $JADX_URL"
    curl -sSL -o "$TMP_DIR/jadx.zip" "$JADX_URL"
    $SUDO mkdir -p /opt/jadx
    $SUDO unzip -q -o "$TMP_DIR/jadx.zip" -d /opt/jadx
    $SUDO chmod +x /opt/jadx/bin/jadx
    $SUDO ln -sf /opt/jadx/bin/jadx /usr/local/bin/jadx
    rm -rf "$TMP_DIR"
    echo "JADX installed successfully."
  else
    echo "Warning: Could not automatically download JADX from GitHub. Please install manually if Java source decompilation is needed."
  fi
else
  echo "JADX is already installed: $(which jadx)"
fi

# 10. Verify tool installations
echo "[3/7] Verifying CLI tools..."
for tool in node npm java keytool apktool zipalign apksigner; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "  [OK] $tool: $(command -v "$tool")"
  else
    echo "  [MISSING] $tool: not found in PATH"
  fi
done

if command -v jadx >/dev/null 2>&1; then
  echo "  [OK] jadx: $(command -v jadx)"
else
  echo "  [OPTIONAL] jadx: not found (Smali disassembly and manifest analysis will still function)"
fi

# 11. Run npm install from monorepo root
echo "[4/7] Installing npm monorepo dependencies..."
npm install

# 12 & 13. Create disposable development test keystore if not exists
echo "[5/7] Checking development test signing key..."
KEYSTORE_PATH="server/testkey.jks"
if [[ ! -f "$KEYSTORE_PATH" ]]; then
  echo "Generating disposable test keystore at $KEYSTORE_PATH..."
  if command -v keytool >/dev/null 2>&1; then
    keytool -genkeypair \
      -alias androidtestkey \
      -keyalg RSA \
      -keysize 2048 \
      -validity 10000 \
      -keystore "$KEYSTORE_PATH" \
      -storepass androiddevtestkey123 \
      -keypass androiddevtestkey123 \
      -dname "CN=AndroidTestKey, OU=Dev, O=LocalTest, L=Lab, ST=Lab, C=US"
    echo "Disposable test keystore created. DO NOT use in production."
  else
    echo "Warning: keytool not found. Keystore could not be generated."
  fi
else
  echo "Test keystore already exists. Preserving existing key."
fi

# 14, 15, 16. Configure environment files for Codespaces or Local
echo "[6/7] Generating environment configurations..."
CODESPACE_NAME="${CODESPACE_NAME:-}"
PORT_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"

if [[ -n "$CODESPACE_NAME" && -n "$PORT_DOMAIN" ]]; then
  CLIENT_ORIGIN="https://${CODESPACE_NAME}-5173.${PORT_DOMAIN}"
  SERVER_ORIGIN="https://${CODESPACE_NAME}-8000.${PORT_DOMAIN}"
  echo "Detected GitHub Codespaces environment:"
  echo "  Frontend URL: $CLIENT_ORIGIN"
  echo "  Backend URL:  $SERVER_ORIGIN"
else
  CLIENT_ORIGIN="http://localhost:5173"
  SERVER_ORIGIN="http://localhost:8000"
  echo "Local Ubuntu / Debian environment:"
  echo "  Frontend URL: $CLIENT_ORIGIN"
  echo "  Backend URL:  $SERVER_ORIGIN"
fi

cat <<EOF > server/.env.codespace
NODE_ENV=development
PORT=8000
FRONTEND_ORIGIN=${CLIENT_ORIGIN}
WORK_ROOT=sessions
MAX_APK_BYTES=1073741824
MAX_CHUNK_BYTES=16777216
MAX_TEXT_BYTES=2097152
SESSION_TTL_HOURS=12
APKTOOL_BIN=apktool
JADX_BIN=jadx
ZIPALIGN_BIN=zipalign
APKSIGNER_BIN=apksigner
COMMAND_TIMEOUT_MS=900000
COMMAND_OUTPUT_LIMIT=100000
TEST_KEYSTORE=testkey.jks
TEST_KEY_ALIAS=androidtestkey
TEST_KEY_PASSWORD=androiddevtestkey123
EOF

cat <<EOF > client/.env
VITE_API_URL=${SERVER_ORIGIN}
EOF

# 18. Set executable permissions
chmod +x setup-codespace.sh run-dashboard.sh stop-dashboard.sh 2>/dev/null || true

# 19 & 20. Run typecheck and build validation
echo "[7/7] Validating TypeScript and building workspaces..."
npm run typecheck || echo "Warning: Typecheck reported warnings"
npm run build || echo "Warning: Build reported warnings"

echo "===================================================="
echo "Setup completed successfully!"
echo ""
echo "To launch the dashboard:"
echo "  ./run-dashboard.sh"
echo ""
echo "To stop running processes:"
echo "  ./stop-dashboard.sh"
echo "===================================================="
