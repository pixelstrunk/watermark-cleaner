#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/rules"
PY_DEST="$ROOT/python/wmc/rules_data"
NODE_DEST="$ROOT/node/rules_data"

mkdir -p "$PY_DEST" "$NODE_DEST"

for f in "$SRC"/*.json; do
  python3 -c "import json,sys; json.load(open('$f'))"
  cp "$f" "$PY_DEST/"
  cp "$f" "$NODE_DEST/"
done

echo "rules synced to python and node packages"
