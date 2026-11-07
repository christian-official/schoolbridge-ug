#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# This is an isolated preview database. Never point this preview at school data.
export SCHOOLBRIDGE_DATABASE_URL="${SCHOOLBRIDGE_DATABASE_URL:-sqlite:///./schoolbridge_preview.db}"

# Use a temporary signing key unless the preview environment supplies one.
# Tokens will be invalidated when the preview container restarts.
if [[ -z "${SCHOOLBRIDGE_SECRET_KEY:-}" ]]; then
  export SCHOOLBRIDGE_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
fi

if ! curl --silent --fail http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
  nohup python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 \
    > /tmp/schoolbridge-api.log 2>&1 &
fi

if ! curl --silent --fail http://127.0.0.1:5173 >/dev/null 2>&1; then
  nohup npm --prefix frontend run dev -- --host 0.0.0.0 --port 5173 --strictPort \
    > /tmp/schoolbridge-frontend.log 2>&1 &
fi

echo "SchoolBridge preview services are starting."
echo "Frontend: port 5173 | API health: port 8001/api/health"
echo "Logs: /tmp/schoolbridge-frontend.log and /tmp/schoolbridge-api.log"
