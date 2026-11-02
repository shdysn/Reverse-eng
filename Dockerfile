# Production Dockerfile for Android Reverse Engineering Dashboard
FROM node:20-bookworm

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=3000

# Install OpenJDK, apktool, zipalign, apksigner, and utilities
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      default-jdk \
      apktool \
      zipalign \
      apksigner \
      curl \
      unzip \
      zip \
      jq \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install JADX CLI
RUN JADX_VERSION="1.5.0" && \
    mkdir -p /opt/jadx && \
    curl -sSL "https://github.com/skylot/jadx/releases/download/v${JADX_VERSION}/jadx-${JADX_VERSION}.zip" -o /tmp/jadx.zip && \
    unzip -q /tmp/jadx.zip -d /opt/jadx && \
    chmod +x /opt/jadx/bin/jadx && \
    ln -sf /opt/jadx/bin/jadx /usr/local/bin/jadx && \
    rm -f /tmp/jadx.zip

WORKDIR /app

# Copy dependency specifications first for efficient caching
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install dependencies across all monorepo workspaces (including devDependencies required for build)
RUN npm install --include=dev

# Copy application source code
COPY . .

# Generate disposable test keystore for APK signing if not present
RUN if [ ! -f server/testkey.jks ]; then \
      keytool -genkeypair \
        -alias androidtestkey \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -keystore server/testkey.jks \
        -storepass androiddevtestkey123 \
        -keypass androiddevtestkey123 \
        -dname "CN=AndroidTestKey, OU=Dev, O=CloudLab, L=Lab, ST=Lab, C=US"; \
    fi

# Build client and server workspaces
RUN npm run build

# Create session directory with proper permissions
RUN mkdir -p server/sessions .logs .pids

EXPOSE 3000

# Start unified production server
CMD ["npx", "tsx", "server.ts"]
