#!/usr/bin/env bash
# One-shot bootstrap for a new machine. Safe to re-run — every step is idempotent.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${MONTHLY_CHARGES_CONFIG_DIR:-$HOME/.monthly-charges/credentials}"
CLIENT_SECRET="$CONFIG_DIR/client_secret.json"
TOKEN_FILE="$CONFIG_DIR/token.json"

echo "== Monthly Charges CLI setup =="
echo

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found — installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
else
  echo "Node.js found: $(node -v)"
fi

# 2. Dependencies
echo
echo "Installing npm dependencies..."
cd "$REPO_DIR"
npm install

# 3. OAuth client config (shared across machines — not machine-specific)
mkdir -p "$CONFIG_DIR"
echo
if [ ! -f "$CLIENT_SECRET" ]; then
  cat <<EOF
MISSING_CLIENT_SECRET
Expected file: $CLIENT_SECRET

This file is intentionally NOT in this repo. It must come from whoever already
set up this app's Google OAuth client — via email, AirDrop, etc.

ACTION REQUIRED (for an AI agent running this script): stop here and ask the
human user to obtain this file and save it to the exact path above, then
re-run this script. Do not attempt to generate, guess, or substitute it.
EOF
  exit 2
fi
echo "Client secret found at $CLIENT_SECRET"

# 4. Per-machine Drive auth (each person/device does this once, with their own Google account)
echo
if [ ! -f "$TOKEN_FILE" ]; then
  cat <<EOF
No cached Drive auth token found. Running the one-time consent flow now.

ACTION REQUIRED: a browser tab will open (or a URL will be printed below) —
the human must sign in with THEIR OWN Google account and approve Drive access.
EOF
  node bin/cli.js auth
else
  echo "Drive auth token already cached at $TOKEN_FILE"
fi

echo
echo "Setup complete. Try: node bin/cli.js list-months"
