# JIT-DESIGN — F3: optimización del backend Wasm (Rama A)

**Checkpoint de diseño (type=decision).** Este documento fija la estrategia de F3 antes de
implementar. Base: `docs/AUDIT-JIT.md`. Todo referenciado a `jpd002/Play-` @ `b720576` y su
submódulo `Play--CodeGen` @ `a5009f7`.

## 1. Modelo actual (lo que hay que batir)

Bucle de ejecución (steady-state), `Source/GenericMipsExecutor.h:59`:
```cpp
while (nHasException == 0) {
    address = nPC & mask;
    block = m_blockLookup.FindBlockAt(address);  // lookup C++ (BlockLookupTwoWay)
    block->Execute();                            // llama la instancia wasm del bloque
}
```
- **1 módulo WebAssembly por bloque**, compilado **síncrono**: `BasicBlock::Compile()`
  (`Source/BasicBlock.cpp:101`) → `CMemoryFunction(bytes)` → en emscripten
  `new WebAssembly.Module` + `new WebAssembly.Instance` (`deps/CodeGen/src/MemoryFunction.cpp:76,51`),
  registrado en una `WebAssembly.Table` vía `addFunction`.
- **Sin chaining**: `CCodeGen_Wasm::SupportsExternalJumps()==false`
  (`Jitter_CodeGen_Wasm.cpp:358`); `BasicBlock::LinkBlock` (parcheo de código) desactivado en
  emscripten (`BasicBlock.cpp:400`, wasm es inmutable). ⇒ cada transición de bloque vuelve al
  bucle C++.
- SIMD: el backend MD ya emite `v128` (`Jitter_CodeGen_Wasm_Md.cpp`); F2 activó `-msimd128`.

Dos costes dominantes: **(A)** el round-trip C++↔wasm por bloque, **(B)** el `new WebAssembly.Module`
síncrono uno-por-bloque (arranque y re-JIT).

## 2. Palancas (orden por retorno) y diseño concreto

### Lever 1 — JIT-04: Batching de compilación  *(primero: menor riesgo, gran win de arranque)*
**Idea:** desacoplar "generar el cuerpo del bloque" de "instanciar el módulo". Acumular N
cuerpos en un solo `CWasmModuleBuilder` → **un** `new WebAssembly.Module` con N funciones
exportadas, todas registradas en la tabla de una vez.
**Dónde:**
- `deps/CodeGen/src/MemoryFunction.cpp` (emscripten): API para "añadir función a un módulo
  pendiente" + "flush" (instanciar el lote).
- `Source/BasicBlock.cpp:Compile` + `Source/GenericMipsExecutor.h` (`FindBlockStartingAt`,
  `PartitionFunction`): al descubrir una función/región, compilar sus bloques en lote en vez
  de uno a uno.
**Medición:** coste de `WebAssembly.Module` por lote vs por bloque (exponer `jitCompileMs` en
`__ps2web_metrics`). **Fallback:** si el batching complica la invalidación, batch solo en el
descubrimiento inicial de función (no en re-JIT).

### Lever 2 — JIT-02: Chaining de bloques sin SMC  *(el win de estado estacionario; núcleo de F3)*
**Restricción:** no se puede parchear wasm ⇒ el chaining nativo (LinkBlock) no aplica. Se
reproduce vía la **`WebAssembly.Table`** (ya existe para el dispatch).
**Diseño (incremental, dos niveles):**
- **2a — Bucle de dispatch residente en wasm.** Una función wasm "trampolín" mantiene el
  `while(nHasException==0)`: lee `nPC` de memoria compartida, hace `call_indirect` sobre la
  tabla usando un índice obtenido de un **mapa PC→tableIndex** (residente en memoria lineal,
  poblado por C++ al registrar cada bloque), ejecuta el bloque (que actualiza `nPC`), y
  reitera **sin volver a C++**. Solo sale a C++ en excepción/quota. Elimina el coste (A) en
  hot loops.
- **2b — Sucesor directo cuando el destino es estático.** Para branches con destino conocido
  en compilación, emitir al final del bloque un `call_indirect` directo al índice del sucesor
  (equivalente por-tabla del LinkBlock nativo), evitando incluso el lookup del mapa.
**Requiere tocar** `CCodeGen_Wasm` (hoy `SupportsExternalJumps=false`) y el generador de fin
de bloque (`BasicBlock.cpp` epílogos, los `JumpToDynamic`/trampolines desactivados).
**Correctness:** el modelo de excepción/quota (`nHasException`, `cycleQuota`) debe respetarse
exactamente — el bucle wasm comprueba las mismas condiciones que el C++. Frame-hash del harness
es la verdad.

### Lever 3 — JIT-03: SIMD en hot paths  *(gran parte ya hecho)*
Con `-msimd128` (F2), el backend MD ya usa `v128`. Trabajo restante: perfilar VU1/MMI y
asegurar que no queda op de 128 bits escalarizada en los hot paths; extender `Jitter_CodeGen_Wasm_Md.cpp`
donde falte. Verificación: frame-hash idéntico (sin regresión) + speedup en `vu1`.

## 3. Orden de implementación (corrección primero, innegociable)
1. `docs/JIT-DESIGN.md` (este doc) — checkpoint.
2. Instrumentar `jitCompileMs`/`blockCount` en métricas para cuantificar (A) y (B).
3. **Lever 1 (batching)** con harness completo tras cada sub-hito; frame-hash == baseline.
4. **Lever 2a (dispatch residente)**; luego **2b (sucesor directo)**. Cada sub-hito: harness.
5. **Lever 3 (SIMD hot paths)**.
6. Benchmark final vs referencia F2 en `vu1` (CPU/VU-bound): `tools/assert_speedup.js` ≥ 2x (JIT-02).

## 4. Medición del speedup
Fixture de referencia = **vu1** (CPU/VU-bound; el cubo topa a ~60fps y no deja margen). La
referencia pre-F3 es `bench/results/vu1.json` sobre el build **F2** (threads+SIMD+mem fija).
`tools/assert_speedup.js vu1-f2.json vu1-f3.json --min 2.0` debe salir 0. La corrección se
valida con `simdHashMatchesBaseline`/frame-hash en TODOS los fixtures.

## 5. Fork de Play! (gate de la implementación)
Lever 1/2 tocan **`deps/CodeGen`** (submódulo `Play--CodeGen`) y `Source/BasicBlock.cpp`:
muchos ficheros C++ con iteración. Aquí el modelo overlay/sed deja de ser cómodo. **F3 W2
(implementación) requiere forkear `jpd002/Play-` (+ submódulo) en `Wcoach24/`**, con ramas por
sub-hito y commits limpios rebasables (D10). El diseño (W1, este doc) no lo necesita.

## 6. Riesgos y fallbacks (del plan §9)
- Coste de `WebAssembly.Module` sigue dominando pese al batching → compilar el lote en un
  **worker aparte** (patrón v86) para no parar la emulación.
- El dispatch residente en wasm rompe el modelo de quota/excepción → mantener 2a detrás de un
  flag y comparar frame-hash exhaustivo antes de activarlo por defecto.
- Si Lever 2 no llega a 2x → fallback escalonado del plan: (a) solo batching + SIMD ya suben;
  (b) documentar honestamente JIT-02 parcial en STATE.md. **Nunca sacrificar corrección.**

## 7. Decisión
**F3 = Rama A, tres palancas, en el orden 1→2→3, corrección-primero.** La implementación (W2+)
arranca tras: (i) OK humano a este diseño, (ii) fork de Play! creado. La referencia de speedup
es `vu1` sobre el build F2.

---
## Actualización basada en datos (W2.1, run 29076688849) — reordenación
La instrumentación (ver `docs/BENCH-F3.md`) muestra que el **JIT-compile no domina el estado
estacionario** (~0.13 ms/bloque, ~130-150 ms/run, casi todo en warmup) y que **vu1 corre a
80.9%** de realtime. Por tanto:
- **Se prioriza la Palanca 2 (chaining por WebAssembly.Table)** — es donde vive el ≥2x, porque
  el coste dominante es el round-trip de dispatch por bloque, no la compilación.
- La Palanca 1 (batching) se mantiene pero con expectativa honesta: win de arranque y de juegos
  reales (decenas de miles de bloques), no de estos micro-fixtures. Menor prioridad de fps.
- Orden efectivo: **W2.2 = Palanca 2 sobre vu1** → W2.3 batching → W2.4 SIMD hot paths.
