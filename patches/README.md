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
- 09-module-metrics.patch — **Sprint 2 / JIT-04 paso 1 (instrumentación)**: expone getModulesCreated/getInstancesCreated/getModuleBytes. Read-only, no cambia ejecución. Pareja obligatoria de `codegen/01-module-counter.patch` (allí viven los contadores). Da el **baseline de code-space**: hoy ≈1 módulo wasm por bloque MIPS → `blocksPerModule ≈ 1`. El batching debe subir `blocksPerModule` ≥10 (modulesCreated ≥10x menos) con cube golden intacto. **Generado sobre la serie 01–07** (no sobre el 08, que NO se aplica — ver abajo).
- 10-batch-repoint.patch — JIT-04 batching v2 (compilación por regiones + re-apuntado + SMC verify-at-first-execute). Es el que hace que DBZ BT3 arranque (derrota el OOM de code-space). Kill-switch `setBatchMode(0..3)`, default 2.
- 11-profile-fase0.patch — **PLAN-DBZ-FLUID Fase 0 (PROFILE)**: instrumentación read-only del reparto del frame. Expone getEeIdlePct/getDrawCalls (via StatsManager; conecta el `OnNewFrame` de la VM que el build JS nunca conectó), getEeExecMs/getVuExecMs (reparto EE vs VU en `UpdateEe`), getGsBusyMs/getGsWaitMs (hilo GS en `ThreadProc`) + getGsStallMs (EE bloqueado en `SendGSCall` waitForCompletion), y getVuBlocks (bloques VU en fresco = módulos VU; la VU no batchea). Todo `steady_clock` acumulativo, `#ifdef __EMSCRIPTEN__`, **sin tocar EE RAM → cube golden inmune**. Solo árbol principal (NO CodeGen). Generado sobre la serie 01–10. Salida: `docs/PROFILE-DBZ.md`.
- 12-frameskip.patch — **PLAN-DBZ-FLUID Fase 1C paso 1 (frameskip)**: `setGsFrameskip(n)` (kill-switch runtime, default 0=off). n>0 renderiza 1 de cada n+1 frames; en `CGSH_OpenGL::DoRenderPass` (el punto que hace `glDrawArrays` ~1200 veces/frame) hace early-return en los frames omitidos, dejando el `m_validGlState` intacto; la decisión se toma al final de `FlipImpl`. El present/composite se sigue haciendo (re-muestra el último frame, no congela). Baja el trabajo del hilo GS (saturado al 100% en DBZ) → el EE deja de bloquearse (medido 87% ocioso, 77% en gsStall). **Presentación-only: no toca EE RAM → cube golden inmune** (además el fixture corre con n=0). Solo árbol principal (NO CodeGen). Generado sobre la serie 01–11. Prueba: `PlayModule.setGsFrameskip(2)` / `__ps2web.setFrameskip(3)`.
- 13-gl-callcost.patch — **PLAN-DBZ-FLUID Fase 1C.2 (coste por draw call + bisect de diagnóstico)**. Dos partes, ambas `#ifdef __EMSCRIPTEN__`, sin tocar EE RAM (cube golden inmune):
  1. **Quita dos errores GL por draw call** en `DoRenderPass` (~1200 draws/frame en DBZ, hilo GS al 100%): (a) `glTexParameteri` sobre el handle 0 → WebGL lo rechaza con `No texture bound to TEXTURE_2D`; ahora sólo se aplican los parámetros si hay textura ligada. (b) `GL_TEXTURE_SWIZZLE_R` **no existe en WebGL2** (`Invalid enum value`) → la llamada SIEMPRE falló, así que quitarla es behaviour-preserving en wasm. También en `FlipImpl`. ⚠️ Implicación de corrección: `alphaAsIndex` (paletas IDTEX) nunca se aplicó en navegador — candidato a explicar glitches de texturas; arreglarlo va en el shader y es tarea aparte.
  2. **`setGsDiag(n)`** — bisect en runtime (default 0, sólo diagnóstico) para decidir con datos la siguiente inversión grande: `0`=normal, `1`=hace todo el setup de estado + `glBufferData` pero **salta `glDrawArrays`** (aísla el coste de rasterizar), `2`=salta el render pass entero. `gsBusyMsS(0)−gsBusyMsS(1)` = tiempo rasterizando; `gsBusyMsS(1)−gsBusyMsS(2)` = tiempo en estado/upload (lo que atacaría el batching). Distingue **fill-rate-bound** (→ WebGPU/resolución) de **call-overhead-bound** (→ batching + state cache).

### patches/codegen/ (se aplican al submódulo deps/CodeGen)
- 01-module-counter.patch — contadores atómicos `g_ps2webModulesCreated` / `g_ps2webInstancesCreated` / `g_ps2webModuleBytes` en `src/MemoryFunction.cpp` (cada `new WebAssembly.Module` + cada `Instance`/addFunction). Definidos aquí, `extern` en Source/ui_js/Main.cpp (patch 09). Es la evidencia que cuantifica el `failed to allocate executable memory for module` de los juegos grandes (PLAN-RESCATE Fase 0 clase A / Fase 2).

### patches/experiments/ (NO se aplican — fuera del glob `patches/*.patch`)
- 08-fastpath-dispatch.patch — W2.2b.2b: fast-path que despacha por el mapa per-executor saltando FindBlockAt + el Execute virtual. **MEDIDO: no aporta fps (vu1 −2.9%, dentro de ruido)** → es la evidencia de que el cuello es el cruce C++↔wasm y no el lookup (docs/BENCH-F3.md), y por eso el ≥2x exige el loop residente (docs/SPIKE-2C.md). Se conserva como evidencia pero **queda fuera de la serie aplicada**: cambia la ejecución sin dar beneficio, o sea riesgo gratis.

## Lección (2026-07-12): la serie aplicada es la que está EN EL REPO
El CI falló al aplicar el 09 porque se generó encima del 08, que existía solo en el disco local
y nunca se commiteó (la serie canónica es 01–07). **Regla: generar cualquier patch nuevo contra
la serie trackeada en el repo (`git ls-files patches/`), no contra el árbol local.** Mismo error
de clase que `bench/compat.json` (referenciado por el workflow pero sin commitear).

- 14-gs-owned-context.patch — **PLAN-DBZ-FLUID Fase 1C.3: el hilo GS es DUEÑO del contexto WebGL (OffscreenCanvas)**. Diagnóstico (docs/PROFILE-DBZ.md §11): con `setGsDiag(2)` (cero draws) el hilo GS seguía ~90 % ocupado. Causa: con `-sOFFSCREEN_FRAMEBUFFER` el contexto vivía en el hilo principal y TODA llamada GL del pthread GS iba proxied; `glTexImage2D/glTexSubImage2D` ≥256 KB, `glGenTextures`, `glDeleteTextures`, `glReadPixels` son round-trips SÍNCRONOS (bloquean el GS hasta que main los sirve) y el resto aloca+postea. Cambios: (1) `-sOFFSCREENCANVAS_SUPPORT=1` + export `_initVmPhase2` (viven en `tools/apply_f2_flags.sh`, no en el patch: `git apply --index` rechaza un fichero que el paso de flags ya modificó); el canvas se transfiere main→EE (`CPS2VM::Initialize`, pthread con `emscripten_pthread_attr_settransferredcanvases("#outputCanvas")`) y EE→GS (`CGSHandler` ctor, selector `"outputCanvas"` sin `#` porque dentro de un pthread se busca por id), y `CGSH_OpenGLJs::InitializeImpl` crea el contexto EN el hilo GS → todas las gl* son llamadas directas. (2) OffscreenCanvas solo presenta cuando el worker vuelve a su event loop, así que el `ThreadProc` bloqueante se sustituye por `Ps2webDrain` (tarea en el event loop del worker GS; procesa el mailbox hasta vaciarlo o hasta un flip, entonces cede para que el navegador presente y se re-encola por proxy a sí mismo) + `Ps2webKick` (el emisor, tras cada push del `CMailBox`, encola como máximo una tarea pendiente vía `emscripten_proxy_async`). Hook `CMailBox::SetKick`. El hilo se mantiene vivo con `emscripten_exit_with_live_runtime()` (`emscripten_unwind_to_js_event_loop` solo NO basta en un pthread: el contador keepalive es 0 y el hilo muere). (3) `initVm` en dos fases: la creación del GS desde el EE con canvas es un `spawnThread` asíncrono vía main, así que main no puede bloquear esperando al EE; la fase 2 (pad/sonido/callbacks, que sí bloquea) la lanza el overlay (`PlayModule.ts`) desde el event loop de JS al ver `getVmInitState()==1` (bloquear DENTRO de una tarea proxied deadlockea: el spin del futex de main no sirve más llamadas proxied por la guarda de recursión, y cualquier printf/fd del EE es una syscall proxied síncrona). Escape hatch A/B en el mismo build: `?gsproxy=1` → ruta antigua. Verificado en sandbox (Chromium headless + SwiftShader): cube renderiza, **golden `stateHashAtN=3049433245` intacto**, 0 errores, en ambos modos. Lecciones de emscripten 4.0.1 que costaron ciclos: `emscripten_set_immediate` no funciona en workers (su polyfill hace `postMessage(id,"*")` → "Overload resolution failed"); TODAS las syscalls (fd_read/fd_write/…) desde pthreads son proxied síncronas a main → **las lecturas del ISO (CDVD) desde el EE también** — candidato principal al techo del 65 % (docs/QA-PLAN.md §2.3), siguiente patch.
