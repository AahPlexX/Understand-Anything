#!/usr/bin/env bash
# openrouter/start-proxy.sh
# One-command startup for the understand-anything OpenRouter proxy.
# Requires Node.js 18+ (native fetch support).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.openrouter"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env.openrouter not found at $ENV_FILE"
  echo ""
  echo "Create it by copying the example:"
  echo "  cp .env.openrouter.example .env.openrouter"
  echo "  # Then edit it and add your real OpenRouter API key"
  echo ""
  echo "Get a free API key at: https://openrouter.ai/keys"
  exit 1
fi

# Validate Node.js version (18+ required for native fetch)
NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [[ "$NODE_VERSION" -lt 18 ]]; then
  echo "ERROR: Node.js 18+ required (found v$NODE_VERSION)"
  echo "Install from: https://nodejs.org"
  exit 1
fi

# Load env vars
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "Starting understand-anything OpenRouter proxy..."
echo "API key: ${OPENROUTER_API_KEY:0:12}..."
echo ""

exec node "$SCRIPT_DIR/proxy.mjs"
