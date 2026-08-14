#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/tests/fixtures/parity"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$SRC" "$TMP/py"
cp -R "$SRC" "$TMP/node"

PYTHONPATH="$ROOT/python" python3 -m watermark_cleaner.cli fix "$TMP/py" --no-backup --quiet >/dev/null
node "$ROOT/node/bin/watermark-cleaner.js" fix "$TMP/node" --no-backup --quiet >/dev/null

if ! diff -r "$TMP/py" "$TMP/node"; then
  echo "parity check failed: python and node produced different output"
  exit 1
fi

py_exit=0
node_exit=0
PYTHONPATH="$ROOT/python" python3 -m watermark_cleaner.cli check "$TMP/py" --quiet >/dev/null || py_exit=$?
node "$ROOT/node/bin/watermark-cleaner.js" check "$TMP/node" --quiet >/dev/null || node_exit=$?

if [ "$py_exit" != "$node_exit" ]; then
  echo "parity check failed: exit codes differ (python=$py_exit node=$node_exit)"
  exit 1
fi

canonical() {
  python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, indent=1))"
}

PYTHONPATH="$ROOT/python" python3 -m watermark_cleaner.cli check "$TMP/py" --json | sed "s|$TMP/py|<dir>|g" | canonical > "$TMP/py.json" || true
node "$ROOT/node/bin/watermark-cleaner.js" check "$TMP/node" --json | sed "s|$TMP/node|<dir>|g" | canonical > "$TMP/node.json" || true

if ! diff "$TMP/py.json" "$TMP/node.json"; then
  echo "parity check failed: json reports differ"
  exit 1
fi

echo "parity ok: identical output, json reports and exit codes"
