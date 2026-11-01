#!/usr/bin/env bash
set -Eeuo pipefail

echo "Stopping Android Reverse Engineering Dashboard services..."

BACKEND_PID_FILE=".pids/backend.pid"
FRONTEND_PID_FILE=".pids/frontend.pid"

stop_recorded_process() {
  local pid_file="$1"
  local service_name="$2"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null || echo "")

    if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
      if kill -0 "$pid" 2>/dev/null; then
        echo "Sending SIGTERM to $service_name (PID: $pid)..."
        kill "$pid" 2>/dev/null || true

        # Wait up to 5 seconds for graceful shutdown
        local waited=0
        while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 5 ]]; do
          sleep 1
          waited=$((waited + 1))
        done

        if kill -0 "$pid" 2>/dev/null; then
          echo "$service_name (PID: $pid) did not shut down gracefully. Sending SIGKILL..."
          kill -9 "$pid" 2>/dev/null || true
        fi
        echo "$service_name stopped."
      else
        echo "$service_name (PID: $pid) is not running."
      fi
    fi
    rm -f "$pid_file"
  else
    echo "No PID file found for $service_name."
  fi
}

stop_recorded_process "$BACKEND_PID_FILE" "Backend API"
stop_recorded_process "$FRONTEND_PID_FILE" "Frontend Vite"

echo "Stop script finished successfully."
