# BASELINE — referencia de rendimiento (F1 W4) — INMUTABLE

Generado por el job `harness` (run 29036375421, 2026-07-09).
Fuente de verdad versionada: `bench/results/baseline.json`.

## Números baseline

| fixture | avgFps | min–max fps | avgEmuSpeedPct | p95 msPerFrame | rig |
|---------|-------:|-------------|---------------:|---------------:|-----|
| cube    | **56.8** | 56 – 57.94 | **94.8 %** | **17.86 ms** | ci-headless-swiftshader |

- Muestreo: 20 s tras 6 s de warmup (JIT). `cube.elf` = 174 900 bytes (ps2sdk, AFL v2.0).
- upstream: `b72057621e55608e0b10f14ee9e54d56fd6cc99c`.
- `frameHash` = 3820964002, **estable** en las 20 muestras (usable para regresión). Su
  sensibilidad al contenido está sin verificar (toDataURL sobre WebGL sin
  preserveDrawingBuffer puede ser constante); el hashing robusto a nivel GS se difiere a F3/F4.

## Interpretación
El cubo homebrew corre a ~**95 % de velocidad realtime** ya en CI/swiftshader (WebGL software,
runner GitHub). Es un fixture ligero: sirve como suelo de referencia, no como techo de estrés.

## Rig e uso (IMPORTANTE)
`rig = ci-headless-swiftshader` → referencia **RELATIVA**. F3 (JIT-02) debe demostrar **≥2x**
speedup contra estos números en un fixture CPU-bound, medido en este mismo rig. NO es el
objetivo T1 ("60 fps en desktop medio"), que se mide a mano en el equipo de la persona.

## Nota para F3
Un cubo a 95% deja poco margen de mejora medible. Antes de F3 conviene añadir un fixture
**CPU/VU-bound** (p.ej. `ee/draw/samples/vu1` del ps2sdk, o un homebrew de estrés) que corra
por debajo de 100% aquí, para que el speedup del JIT sea observable. Anotado como entrada de F3.

> Este documento es INMUTABLE. Toda mejora de F3 se mide contra él (`tools/assert_speedup.js`).
