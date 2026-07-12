#!/usr/bin/env bash
# JIT-04 fast gate: compile the REAL CWasmModuleBuilder (with our patches applied) against a
# minimal CStream stub, emit N=1/2/32 modules, and validate + instantiate them in Node.
# Catches wasm binary-format regressions in ~20s instead of after a ~25 min emscripten build.
# Usage: tools/wasm-emitter-check/run.sh <path-to-CodeGen>   (e.g. Play-/deps/CodeGen)
set -euo pipefail
CODEGEN="${1:?usage: run.sh <path-to-CodeGen>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
echo "[emitter-check] CodeGen: $CODEGEN"
g++ -std=c++17 -I "$HERE/stub" -I "$CODEGEN/include" \
    "$HERE/main.cpp" "$CODEGEN/src/WasmModuleBuilder.cpp" -o "$WORK/emit"
cd "$WORK"
"$WORK/emit" 1
"$WORK/emit" 2
"$WORK/emit" 32
node "$HERE/check.mjs"
echo "[emitter-check] OK — emitter produces valid, instantiable modules for N=1/2/32"
