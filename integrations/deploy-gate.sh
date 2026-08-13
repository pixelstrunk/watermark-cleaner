#!/usr/bin/env bash
set -euo pipefail

CONTENT_DIR="${WMC_CONTENT_DIR:-content}"

if ! command -v wmc >/dev/null 2>&1; then
  echo "wmc not found. install it or remove this gate."
  exit 1
fi

echo "wmc: cleaning mechanical artifacts and image metadata"
wmc fix "$CONTENT_DIR" --no-voice

echo "wmc: mechanical clean done"
