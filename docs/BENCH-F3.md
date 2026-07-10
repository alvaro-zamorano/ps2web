# BENCH-F3 — mediciones de F3 (log vivo)

Rig: `ci-headless-swiftshader`. Referencia de speedup = **vu1** sobre el build F2.

## W2.1 — instrumentación del JIT (build F2 + patch 01), run 29076688849

| fixture | avgFps | emu% | jitBlocks | jitCompileMs (run) | ms/bloque |
|---------|-------:|-----:|----------:|-------------------:|----------:|
| cube    | 56.2   | 93.8 | 1034      | 131.0              | 0.127     |
| vu1     | 48.5   | 80.9 | 1099      | 151.9              | 0.138     |

## Análisis (reordena la estrategia de F3)

1. **vu1 = fixture con margen** (80.9% realtime). Es el objetivo del ≥2x (JIT-02).
2. **El JIT-compile NO domina el estado estacionario.** ~0.13 ms/bloque `new WebAssembly.Module`
   síncrono, pero ~130-150 ms totales concentrados en el warmup (los ~1000 bloques se compilan
   una vez al inicio; en los 20s muestreados apenas hay compilación nueva). El fps muestreado no
   está limitado por el JIT.
   → **La Palanca 1 (batching) da poco fps en estos micro-fixtures** (su valor real es suavizar
   el arranque y, sobre todo, juegos reales con decenas de miles de bloques donde el JIT recurre
   al alcanzar código nuevo — nuestros fixtures lo infra-representan).
3. **El coste dominante es el round-trip de dispatch por bloque** (bucle C++ `FindBlockAt` +
   `block->Execute()` en cada transición, sin chaining). → **La Palanca 2 (chaining por
   WebAssembly.Table) es donde vive el ≥2x.**

## Reordenación (criterio basado en datos)
- **Prioridad ahora: Palanca 2** (chaining sin SMC) sobre el fixture vu1.
- Palanca 1 (batching): se mantiene en el plan pero con expectativa honesta — win de arranque y
  de juegos reales, no de estos micro-benchmarks. Se hará, con menor prioridad de fps.
- Palanca 3 (SIMD hot paths): ya parcialmente activa (F2); perfilar tras Palanca 2.

## Caveat de fixtures
cube/vu1 tienen ~1000 bloques (huella de código minúscula). Un juego comercial tiene un orden
de magnitud más → el coste de JIT-compile y el de dispatch escalan distinto. Los números de aquí
son válidos como referencia RELATIVA en CI; el impacto en juegos reales lo mide la persona a mano.

## W2.2-prep — dispatch rate (build F2 + patches 01+02), run 29078672713

| fixture | avgFps | emu% | dispatchesPerSec | disp/frame | ns/disp (wall) |
|---------|-------:|-----:|-----------------:|-----------:|---------------:|
| cube    | 56.35  | 94.0 | 156,916          | 2,785      | 6,373          |
| vu1     | 53.15  | 88.7 | 1,849,478        | 34,797     | 541            |

**Target de la Palanca 2:** vu1 ejecuta ~1.85 M dispatches/seg. Cada dispatch = 1 iteración del
bucle C++ `Execute` (`FindBlockAt` + call a wasm + return). El chaining elimina el round-trip
quedándose en wasm entre bloques.

**Ruido del rig:** vu1 osciló 80.9%→88.7% entre runs (variabilidad del runner GitHub). ⇒ para
declarar speedup hay que superar ~±10%; el objetivo 2x (JIT-02) es detectable, mejoras <5%
(p.ej. batching en micro-fixtures) NO lo son. Para medir F3 conviene promediar ≥3 runs o subir
la duración del bench.

## W2.2a (run 29082763588) + hallazgo crítico del gate de corrección
- chainMapEntries: cube 1031 (jitBlocks 1034), vu1 1096 (1099). Diff=3 = recompilaciones (mapa por PC único). Mapa OK.
- **frameHash NO es un gate válido:** cube=3820964002 constante (canvas en blanco: WebGL sin preserveDrawingBuffer); vu1 varía DENTRO del run (4 hashes distintos en 20 muestras) → capta contenido de forma no-determinista. No sirve para validar el JIT.
- **Acción:** patch 04 añade getStateHash() = hash determinista de EE RAM (todo el estado de CPU). Cualquier divergencia del JIT lo cambia. Se valida su reproducibilidad antes de usarlo como gate de W2.2b.

## Determinismo del gate (2 runs del mismo commit c826599) — RESUELTO
- **cube: stateHashAtN IGUAL** en ambos runs (3049433245) → DETERMINISTA.
- **vu1: stateHashAtN DIFIERE** (3746839380 vs 2500197388) → NO determinista.
- Causa: vu1 ejercita el **VU1** (microcódigo) que corre asíncrono en un worker (confirma la
  arquitectura de la auditoría). El timing EE↔VU1 varía entre runs → estado a frame fijo cambia.
  cube usa math3d sobre EE/VU0-macro (síncrono) → determinista.

### Política de gates de F3 (a partir de aquí)
- **Corrección = cube.stateHashAtN** (golden 3049433245 en bench/results/cube-golden.json;
  el harness lo asierta en duro). El chaining cambia el dispatch, no el cómputo → cube ejerce
  todo el dispatch del EE → si el chaining corrompe, cube cambia. Gate válido y automático.
- **Speedup = vu1 fps mediana** (assert_speedup, mediana de ≥3 runs; el no-determinismo de vu1
  no afecta la media de fps).
- vu1.stateHashAtN NO se usa como gate (async VU1). La corrección de VU1 se valida por cube +
  test visual/manual de la persona (T2).

## W2.2b.2b — fast-path C++ (patch 08): MEDICIÓN CONCLUYENTE
Comparación mismo pipeline, build sin fast-path (2a, run 29094944160) vs con fast-path (2b, run 29098912259):
| fixture | avgFps sin | avgFps con | Δ |
|---------|-----------:|-----------:|---:|
| cube    | 56.35 | 56.45 | +0.2% |
| vu1     | 53.25 | 51.70 | −2.9% |
dispatchesPerSec idéntico (~1.85M vu1). Corrección OK (cube golden intacto, fast/exec Mismatches=0).

**Conclusión (evidencia, no hipótesis):** saltarse `FindBlockAt` + el virtual `Execute` NO aporta
fps. El coste dominante del dispatch es el **cruce C++↔wasm por bloque**, no el lookup. Las
optimizaciones del lado C++ (2a/2b) están AGOTADAS. El ≥2x (JIT-02) requiere **eliminar la
frontera**: W2.2b.2c = bucle de dispatch **residente en wasm** (`call_indirect` sin volver a C++),
que exige emitir wasm a mano importando `__indirect_function_table`. Es la parte más profunda e
incierta (¿lo soporta CWasmModuleBuilder? ¿se puede importar la tabla indirecta?).

**Recomendación:** el fast-path (patch 08) no aporta → conviene desactivarlo/revertirlo para no
cambiar la ejecución sin beneficio. Decisión de endgame de F3 pendiente (ver STATE): atacar 2c
(deep, incierto) vs fallback del plan §9 (F2 ya subió con threads+SIMD; documentar JIT-02 parcial;
avanzar F4/F5 que dan producto).
