# State

## Current Phase
F1 (en curso). W1 auditoría JIT COMPLETA → Rama A (codegen-wasm ya existe). Pendiente W2 métricas, W3 harness+fixtures, W4 baseline.

## Completed
- 2026-07-09: `.gsd/` scaffolding desde §5 + master plan en docs/.
- 2026-07-09: F0 discuss cerrado → entorno de build = GitHub Actions; repo overlay sobre
  upstream pinneado (fork de Play! diferido a F2). Ver .gsd/CONTEXT.md.
- 2026-07-09: F0 execute — build.sh, serve.py, LEGAL.md, BUILDING.md, README, workflow CI,
  smoke Playwright, UPSTREAM.lock, .emsdk-version escritos y pusheados a Wcoach24/ps2web.

- 2026-07-09: F1 W1 — auditoría JIT (docs/AUDIT-JIT.md). Veredicto: build emscripten = codegen-wasm (recompiler-only, sin intérprete). Backend Wasm completo con MD/v128.

## Decisions Log
- 2026-07-08: D1..D12 bloqueadas (docs/PS2WEB-MASTER-PLAN.md §1).
- 2026-07-09: Build env = CI (no local/sandbox). Repo = overlay; CI clona Play! @ UPSTREAM.lock.
- 2026-07-09: emsdk 4.0.1; presets wasm-ninja / wasm-ninja-release (verificado en upstream build-js.yaml).
- 2026-07-09: Ruta de artefactos real = build_cmake/build/wasm-ninja/Source/ui_js/Release/ (corrige master plan §2).
- 2026-07-09: Smoke de F0 = COOP/COEP + wasm válido; boot de ELF diferido a F1 (necesita métricas+fixtures).

- 2026-07-09: **F3 = Rama A** (optimizar backend Wasm, NO escribir uno nuevo). Palancas: (1) batching de compilación JIT-04, (2) chaining de bloques vía WebAssembly.Table sin SMC (habilita JIT-02; hoy SupportsExternalJumps=false y block-linking desactivado en emscripten), (3) SIMD -msimd128 sobre el MD backend ya existente (JIT-03 en gran parte hecho). Checkpoint formal al cerrar F1.

## Known Issues
- Sandbox de sesión: sin toolchain y 3.8 GB RAM → no compila; git no opera sobre la carpeta
  montada (permisos .git). Mitigado: build en CI, git en clon local + PAT.
- Riesgos abiertos de F0 (a validar con el run): build js de upstream verde en el commit
  pinneado; CRA `npm run build` bajo CI=true; que el frontend exponga /Play.wasm en la raíz.

## Upstream
- jpd002/Play- @ b72057621e55608e0b10f14ee9e54d56fd6cc99c (UPSTREAM.lock)
