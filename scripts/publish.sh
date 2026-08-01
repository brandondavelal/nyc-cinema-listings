#!/bin/bash
set -e

NODE_BIN="/Users/brandon/.nvm/versions/node/v24.15.0/bin/node"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_DIR"

echo "[$(date)] Starting publish run"

"$NODE_BIN" src/build-data.js

git add docs/data.json

if git diff --cached --quiet; then
  echo "[$(date)] No changes to publish"
else
  git commit -m "Update listings $(date +%F)"
  git push origin main
  echo "[$(date)] Published"
fi
