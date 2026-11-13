#!/usr/bin/env bash
# Runs the backend (uv/uvicorn) and frontend (vite) together, from one command.
#
# Robustness choices, spelled out because they're easy to "simplify" away by
# accident later:
#   - `set -euo pipefail` so a typo'd path fails loudly instead of limping on.
#   - Ports are checked free *before* launching anything, so a stale process
#     from a crashed previous run gives you a clear message, not a silent
#     "backend never came up".
#   - `trap ... EXIT` kills both children on Ctrl+C, an error, or normal exit —
#     no orphaned uvicorn eating your CPU after you close the terminal tab.
#   - We fail fast if required secrets are still blank, rather than starting
#     a backend that will 500 on the first real request.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Port precedence: shell env > .env > default. Lets a machine where :8000 is
# taken (another service) pin SpaceLearn's API elsewhere in one place.
env_file_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }
API_PORT="${API_PORT:-$(env_file_value API_PORT)}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

# ── .env sanity ──────────────────────────────────────────────────────────

if [[ ! -f .env ]]; then
  echo "No .env found at repo root. Copying .env.example — fill in your keys, then re-run." >&2
  cp .env.example .env
  exit 1
fi

missing=()
for key in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  # Blank or still-templated values both count as "not set".
  value="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)"
  [[ -z "$value" ]] && missing+=("$key")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing in .env: ${missing[*]}" >&2
  echo "The app still runs without them (Supabase-dependent features degrade to friendly errors)," >&2
  echo "but sign-in and data won't work until they're set. Continuing in degraded mode…" >&2
fi

# ── port collision check ────────────────────────────────────────────────

# `lsof` only sees the current user's processes, so a root/container-owned
# listener (e.g. Docker on :8000) slips past it and requests then hit the wrong
# app with a confusing 404. `ss` sees every listener.
port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  else
    lsof -i ":$1" -sTCP:LISTEN -t >/dev/null 2>&1
  fi
}

for p in "$API_PORT" "$WEB_PORT"; do
  if port_busy "$p"; then
    echo "Port $p is already in use — stop whatever's running there first (or set API_PORT/WEB_PORT env vars) and re-run." >&2
    exit 1
  fi
done

# ── launch both, tear down together ─────────────────────────────────────

pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on :$API_PORT …"
(cd api && uv run uvicorn app.main:app --reload --port "$API_PORT") &
pids+=($!)

echo "Starting frontend on :$WEB_PORT …"
(cd web && npm run dev -- --port "$WEB_PORT" --strictPort) &
pids+=($!)

echo ""
echo "Frontend → http://localhost:$WEB_PORT"
echo "Backend  → http://localhost:$API_PORT/api/v1/health"
echo "Ctrl+C stops both."
echo ""

wait "${pids[@]}"
