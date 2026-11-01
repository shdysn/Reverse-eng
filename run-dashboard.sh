#!/usr/bin/env bash
set -Eeuo pipefail

# Ensure running from repository root
if [[ ! -f "package.json" || ! -d "client" || ! -d "server" ]]; then
  echo "Error: run-dashboard.sh must be executed from the project root directory." >&2
  exit 1
fi

mkdir -p .logs .pids

# Stop stale processes recorded in this project's PID files
if [[ -f "./stop-dashboard.sh" ]]; then
  ./stop-dashboard.sh >/dev/null 2>&1 || true
fi

# Load Codespaces environment if available
if [[ -f "server/.env.codespace" ]]; then
  export $(grep -v '^#' server/.env.codespace | xargs)
fi

echo "===================================================="
echo "Starting Android Reverse Engineering Dashboard"
echo "Authorized Use Only"
echo "===================================================="

BACKEND_PID_FILE=".pids/backend.pid"
FRONTEND_PID_FILE=".pids/frontend.pid"

cleanup() {
  echo ""
  echo "Stopping services..."
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    PID=$(cat "$BACKEND_PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    PID=$(cat "$FRONTEND_PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi
  echo "All recorded project processes stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM

# Start Backend on Port 8000
echo "Starting Backend API on port 8000..."
(
  cd server && npx tsx watch src/index.ts
) > .logs/backend.log 2>&1 &
echo $! > "$BACKEND_PID_FILE"

# Wait for backend health endpoint
echo "Waiting for Backend to become healthy..."
MAX_RETRIES=30
RETRY_COUNT=0
HEALTHY=false

while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if curl -s http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [[ "$HEALTHY" = true ]]; then
  echo "Backend API is online and responding."
else
  echo "Warning: Backend took longer than expected to respond. Check .logs/backend.log."
fi

# Start Frontend on Port 5173
echo "Starting Frontend Vite dev server on port 5173..."
(
  cd client && npx vite --port 5173 --host 0.0.0.0
) > .logs/frontend.log 2>&1 &
echo $! > "$FRONTEND_PID_FILE"

# Determine URLs for display
CODESPACE_NAME="${CODESPACE_NAME:-}"
PORT_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"

if [[ -n "$CODESPACE_NAME" && -n "$PORT_DOMAIN" ]]; then
  FRONTEND_URL="https://${CODESPACE_NAME}-5173.${PORT_DOMAIN}"
  BACKEND_URL="https://${CODESPACE_NAME}-8000.${PORT_DOMAIN}"
else
  FRONTEND_URL="http://localhost:5173"
  BACKEND_URL="http://localhost:8000"
fi

echo "===================================================="
echo "Dashboard is ready!"
echo ""
echo "  Frontend URL: $FRONTEND_URL"
echo "  Backend API:  $BACKEND_URL/api/health"
echo ""
echo "Logs:"
echo "  Frontend log: .logs/frontend.log"
echo "  Backend log:  .logs/backend.log"
echo ""
echo "Press Ctrl+C to safely shut down both services."
echo "===================================================="

# Keep running in foreground and wait for processes
wait
