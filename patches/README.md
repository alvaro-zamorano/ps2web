# patches/ — cambios de F3 al código de Play! (modelo sin fork de GitHub)

El token disponible no puede crear/forkear repos (solo push a repos existentes de Wcoach24),
así que en vez del objeto-fork de GitHub usamos una **serie de patches** que consigue lo que
pide el plan (D10): diffs limpios, revisables y rebasables sobre el commit pinneado de upstream.

## Estructura
- `patches/*.patch`         → se aplican al árbol principal de Play! (`Source/…`, CMake, etc.)
- `patches/codegen/*.patch` → se aplican al submódulo `deps/CodeGen` (Play--CodeGen)

## Cómo se aplican (CI, tras el checkout de Play- @ UPSTREAM.lock)
```
for p in patches/*.patch;         do git -C Play-            apply --index "$p"; done
for p in patches/codegen/*.patch; do git -C Play-/deps/CodeGen apply --index "$p"; done
```
Orden alfabético (prefijo NN-). Cada patch = un sub-hito con nombre claro.

## Generar un patch (flujo de desarrollo)
En un clon de Play- @ UPSTREAM.lock: editar → `git diff > /ruta/ps2web/patches/NN-desc.patch`
(para CodeGen, hacer el diff dentro de `deps/CodeGen`).

## Migración a fork real (si algún día hay token con permiso)
`git apply` cada patch sobre un fork Wcoach24/Play- y convertirlos en commits; el orden y los
nombres ya reflejan el historial deseado. Nada aquí se pierde.

## Estado
- 01-jit-instrumentation.patch — mide jitCompileMs/jitBlocks (getJitMs/getJitBlocks exportados; contadores atómicos en BasicBlock::Compile). F3 W2.1.
- 02-dispatch-counter.patch — cuenta dispatches de bloque en el bucle Execute (getDispatches); harness reporta dispatchesPerSec = objetivo de la Palanca 2 (chaining).
- 03-chainmap-w22a.patch — W2.2a: mapa PC→tableIndex en Compile (getChainMapEntries). Foundation del chaining; SIN cambio de ejecución (frame-hash idéntico). Valida getCode()=índice de tabla.
- 04-state-hash.patch — getStateHash() (hash determinista de EE base RAM). Reemplaza el frameHash de canvas (roto: dominado por lecturas en blanco + no-determinista) como gate de corrección del JIT. Read-only.
- 05-frame-anchored-hash.patch — getStateHashAtN(): captura el hash de EE RAM EXACTAMENTE en el frame 180 (dentro del callback de frame), + getTotalFrames(). Sonda determinista: 2 runs del mismo commit deben dar el mismo valor si la emulación es determinista bajo threads.
- 06-chaintable-linear.patch — W2.2b.1: mapa PC→índice en array plano de memoria lineal (hash abierto), indexable por wasm. Sin cambio de ejecución. getChainTableMismatches() debe ser 0 (coincide con el mapa de referencia). Prerrequisito del dispatchLoop.

## Lección (2026-07-10): CRLF en patches
Algunos ficheros de Play! usan CRLF (p.ej. Source/BasicBlock.h). Editar en modo texto con
python convierte CRLF→LF y reescribe el fichero entero (diff gigante, patch frágil). Editar
esos ficheros en modo BINARIO preservando `\r\n`. Verificar con `git diff --numstat` (líneas
cambiadas deben ser pocas, no ~todo el fichero).

- 07-per-executor-map.patch — W2.2b.2a: mapa PC→índice POR-EXECUTOR (miembro de CGenericMipsExecutor) + invalidación en DeleteBlock/Reset + accesor CBasicBlock::GetWasmTableIndex. SIN fast-path (no cambia ejecución). Gate: cube golden intacto + execMismatches==0. Todo #ifdef __EMSCRIPTEN__.
