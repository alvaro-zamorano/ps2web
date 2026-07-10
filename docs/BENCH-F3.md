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
