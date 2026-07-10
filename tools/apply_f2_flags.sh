#!/usr/bin/env bash
# F2 build-flag changes over the pinned Play! tree.
#   D3: pthread pool 2 -> 8
#   D5 (REVISADO 2026-07-10): fixed 1GB memory causaba OOM en juegos comerciales (que SÍ corren:
#       renderizaban intro+menú y morían por memoria). La evidencia gana al plan (regla #4):
#       se MANTIENE -sALLOW_MEMORY_GROWTH (comportamiento upstream, corre comerciales) y se añade
#       -sMAXIMUM_MEMORY=2GB de techo. (SIMD -msimd128 sigue como flag global en el configure.)
set -euo pipefail
ROOT="${1:-.}"
f="$ROOT/Source/ui_js/CMakeLists.txt"
test -f "$f" || { echo "not found: $f"; exit 1; }

# D3: bigger pthread pool
sed -i 's/-sPTHREAD_POOL_SIZE=2/-sPTHREAD_POOL_SIZE=8/' "$f"

# D5-revisado: mantener ALLOW_MEMORY_GROWTH (upstream) + añadir MAXIMUM_MEMORY=2GB para juegos grandes.
if ! grep -q 'MAXIMUM_MEMORY' "$f"; then
  sed -i 's#target_link_options(Play PRIVATE "-sALLOW_MEMORY_GROWTH")#target_link_options(Play PRIVATE "-sALLOW_MEMORY_GROWTH")\ntarget_link_options(Play PRIVATE "-sMAXIMUM_MEMORY=2147483648")#' "$f"
fi

grep -q -- '-sPTHREAD_POOL_SIZE=8'   "$f" || { echo "FAIL: pool size not applied"; exit 1; }
grep -q -- '-sALLOW_MEMORY_GROWTH'   "$f" || { echo "FAIL: memory growth missing (needed for real games)"; exit 1; }
grep -q -- '-sMAXIMUM_MEMORY=2147483648' "$f" || { echo "FAIL: maximum memory not applied"; exit 1; }
grep -q -- '-sALLOW_TABLE_GROWTH'    "$f" || { echo "FAIL: table growth (JIT) missing!"; exit 1; }

echo "F2 flags OK (D5 revisado = growth + 2GB max):"; grep -nE 'PTHREAD_POOL_SIZE|ALLOW_MEMORY_GROWTH|MAXIMUM_MEMORY|ALLOW_TABLE_GROWTH' "$f"
