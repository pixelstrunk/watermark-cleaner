#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/tests/fixtures/parity"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$SRC" "$TMP/py"
cp -R "$SRC" "$TMP/node"

PYTHONPATH="$ROOT/python" python3 -m wmc.cli fix "$TMP/py" --no-backup --quiet >/dev/null
node "$ROOT/node/bin/wmc.js" fix "$TMP/node" --no-backup --quiet >/dev/null

if ! diff -r "$TMP/py" "$TMP/node"; then
  echo "parity check failed: python and node produced different output"
  exit 1
fi

py_exit=0
node_exit=0
PYTHONPATH="$ROOT/python" python3 -m wmc.cli check "$TMP/py" --quiet >/dev/null || py_exit=$?
node "$ROOT/node/bin/wmc.js" check "$TMP/node" --quiet >/dev/null || node_exit=$?

if [ "$py_exit" != "$node_exit" ]; then
  echo "parity check failed: exit codes differ (python=$py_exit node=$node_exit)"
  exit 1
fi

echo "parity ok: identical output and exit codes"
