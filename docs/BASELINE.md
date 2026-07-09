# BASELINE — referencia de rendimiento (F1 W4)

**Estado:** metodología fijada; los números se rellenan desde el primer run verde del job
`harness` (artefacto `bench-results` → `bench/results/baseline.json`).

## Qué mide
El job `harness` (Playwright headless en CI) arranca el emulador (build wasm de F0/F2 con el
overlay de métricas), bootea el fixture homebrew `cube.elf` (ps2sdk, AFL v2.0), calienta
`BENCH_WARMUP=6 s` (compilación JIT de bloques calientes) y muestrea
`window.__ps2web_metrics` durante `BENCH_SECONDS=20 s`.

Métricas del contrato OBS-01: `fps`, `emuSpeedPct` (vs 59.94 NTSC), `msPerFrame`, `frameHash`.

## Rig (IMPORTANTE)
`rig = ci-headless-swiftshader`. Es una **referencia RELATIVA**: WebGL2 por software
(SwiftShader) y CPU de runner GitHub. Sirve para medir el **speedup de F3 contra esta misma
base** (JIT-02 exige ≥2x vs estos números). NO es el objetivo T1 ("60 fps en desktop medio"),
que mide la persona a mano en su equipo y se anota aparte.

## Números baseline (rellenar desde bench/results/baseline.json)

| fixture | avgFps | avgEmuSpeedPct | p95 msPerFrame | rig |
|---------|--------|----------------|----------------|-----|
| cube    | _pendiente 1er run verde_ | _ | _ | ci-headless-swiftshader |

> Una vez copiados los números aquí desde el primer run verde, este documento es INMUTABLE:
> toda mejora de F3 se mide contra él (`tools/assert_speedup.js`, F3).

## Reproducir
`bench/results/baseline.json` (artefacto CI) contiene `samples[]`, `avgFps`, `p95MsPerFrame`,
`avgEmuSpeedPct`, `frameHashes[]` y el commit `upstream`.
