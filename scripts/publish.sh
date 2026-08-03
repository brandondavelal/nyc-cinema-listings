#!/bin/bash
set -e

NODE_BIN="/Users/brandon/.nvm/versions/node/v24.15.0/bin/node"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$HOME/Library/Application Support/CinemaNY"
STATE_FILE="$STATE_DIR/last-success"
STALE_SECONDS=$((24 * 60 * 60))

cd "$REPO_DIR"

if [ "$1" = "--if-stale" ]; then
  if [ -f "$STATE_FILE" ]; then
    last=$(cat "$STATE_FILE")
    now=$(date +%s)
    age=$((now - last))
    if [ "$age" -lt "$STALE_SECONDS" ]; then
      echo "[$(date)] Last success was ${age}s ago (<24h); skipping login catch-up run"
      exit 0
    fi
  fi
  echo "[$(date)] Last success is stale or missing; running login catch-up"
fi

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

mkdir -p "$STATE_DIR"
date +%s > "$STATE_FILE"
