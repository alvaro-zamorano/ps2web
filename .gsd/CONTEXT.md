# Context — Phase F0: Toolchain y build reproducible

## Locked Decisions (FINAL para F0/F1; no relitigar)

### Entorno de build = GitHub Actions (CI)
**Decisión**: el build wasm real corre en GitHub Actions, no en local ni en el sandbox.
**Rationale**: el sandbox de la sesión no tiene toolchain (cmake/ninja/emsdk) y solo 3.8 GB
RAM; no puede compilar Play!. El usuario eligió CI (build reproducible en la nube).
**Alternativas rechazadas**: build en el Mac del usuario (más rápido pero menos reproducible);
build en sandbox (imposible por recursos).

### Modelo de repo = overlay sobre upstream pinneado
**Decisión**: `Wcoach24/ps2web` es un repo *overlay* (spec + tools + CI + tests). El CI
clona `jpd002/Play-` en el commit de `UPSTREAM.lock` y compila desde ahí. NO se vendoriza
Play! ni se hace fork todavía.
**Rationale**: en F0/F1 no editamos el código de Play!, solo lo construimos. Mantiene el
repo ligero y 100% rebasable sobre upstream (D10).
**Fork de Play! diferido a F2**: el primer cambio real de código fuente (F2: threads/SIMD)
requerirá forkear `jpd002/Play-` o mantener patches en `patches/`. Decisión a confirmar en
F2 discuss (checkpoint humano).

### Recipe de build (verificado contra upstream, NO inventado)
- emsdk **4.0.1** (`.emsdk-version`), vía `emscripten-core/setup-emsdk@v16`.
- Configure: `emcmake cmake --preset wasm-ninja`
- Build: `cmake --build --preset wasm-ninja-release`
- Artefactos: `build_cmake/build/wasm-ninja/Source/ui_js/Release/{Play.js,Play.wasm}`
- Frontend: CRA en `js/play_browser`; copiar Play.js→src, Play.{js,wasm}→public, `npm run build`.
- Node 20.17; ninja vía apt.
- (Corrección al master plan §2: la ruta de artefactos real usa presets + build_cmake/, no build/Source/ui_js/.)

### Alcance del smoke de F0
**Decisión**: el smoke de F0 verifica (a) `crossOriginIsolated === true` bajo servidor
COOP/COEP y (b) que `Play.wasm` es un módulo WebAssembly válido y no trivial.
**Rationale**: el "boot de un ELF homebrew con canvas no-negro" del master plan requiere el
contrato `window.__ps2web_metrics` y fixtures con licencia, que son entregables de F1. No se
adelantan a F0. F0 prueba que el pipeline produce un artefacto desplegable y aislado.

## Implementation Notes
- Git del sandbox NO puede operar sobre la carpeta montada (Desktop) — permisos de `.git`.
  Todo el trabajo git se hace en un clon local del sandbox y se pushea con el PAT del usuario.
  Los ficheros se espejan a Desktop/ps2web para visibilidad (solo lectura de git allí).
- COOP `same-origin` + COEP `require-corp` en TODAS las rutas (serve.py y hosting F8).
- CERO ROM/BIOS (LEG-01); fixtures solo homebrew OSS con licencia (LEG-02).

---
# Context — Phase F1 (añadido)

### Modelo de cambios al código de Play! = overlay por copia (no fork aún, no git-apply)
**Decisión**: los cambios de F1 al frontend (contrato de métricas, hook de boot headless)
viven en `overlay/js/play_browser/src/` y el CI los COPIA sobre el árbol de Play! antes de
compilar (`cp -r overlay/... Play-/...`). Robusto y rebasable; evita diffs frágiles y aplaza
el fork real a F2 (primer cambio de C++/core).
**Alternativas**: git-apply de patches (frágil ante cambios de upstream); fork completo ya
(innecesario mientras solo tocamos ficheros frontend que sobreescribimos enteros).

### Fixtures (TST-01/LEG-02)
Fixture homebrew = sample `cube` del ps2sdk (AFL v2.0), fuente vendorizada en
`tests/fixtures/src/cube/` con su `LICENSE`. Se compila a `cube.elf` en CI con la imagen
`ps2dev/ps2dev` (job `fixtures`). CERO ROM/BIOS.

### Baseline = rig CI headless (swiftshader)
El baseline es una referencia RELATIVA en CI (WebGL software). El objetivo T1 (60 fps desktop)
se mide a mano. F3 mide speedup contra el baseline CI, no contra T1.
