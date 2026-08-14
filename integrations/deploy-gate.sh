#!/usr/bin/env bash
set -euo pipefail

CONTENT_DIR="${WATERMARK_CLEANER_CONTENT_DIR:-content}"

if ! command -v watermark-cleaner >/dev/null 2>&1; then
  echo "watermark-cleaner not found. install it or remove this gate."
  exit 1
fi

echo "watermark-cleaner: cleaning mechanical artifacts and image metadata"
watermark-cleaner fix "$CONTENT_DIR" --no-voice

echo "watermark-cleaner: mechanical clean done"
