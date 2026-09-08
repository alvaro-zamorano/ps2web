# PS2WEB — QA report + plan de pruebas (2026-09-08)

> Auditoría completa del repo + QA en vivo sobre producción (https://dist-ivory-phi-37.vercel.app,
> commit `5d5aa85`, bundle `main.09e9e675.js`) con DBZ Budokai Tenkaichi 3 en combate real.
> Máquina: Apple M2 (8 cores), Chrome, WebGL2 vía ANGLE Metal. Complementa `PROFILE-DBZ.md` (§11 añade
> el bisect) y `HANDOFF-DBZ-FLUID.md`.

## 0. TL;DR

1. **El bisect `setGsDiag` invalida las dos vías del plan.** Sin `glDrawArrays` (diag 1) la velocidad
   no cambia (54,1 → 54,8 %); sin render pass entero (diag 2) sube solo a 61,7 %. **El hilo GS sigue al
   ~90 % sin dibujar nada** (`gsBusy` 861 → 942 → 913 ms/s). Ni WebGPU ni batching de draws atacan el
   cuello real. Ver §2.
2. **Hay un techo de ~65 % que no es ni EE ni GS**: en pantalla de resultados (25 draws/f, `gsBusy`
   105 ms/s, `eeIdle` 96 %) la velocidad es 64,5 %. Algo fuera de EE-exec y GS limita el frame: candidatos
   en §2.3 (I/O de disco desde OPFS, pacing del EmuThread, IOP/SPU2). Hoy no hay métrica que lo separe.
3. **Arquitectura GL**: el contexto WebGL se crea en el hilo principal (`ui_js/Main.cpp: initVm`) y el GS
   lo usa desde su pthread con `-sOFFSCREEN_FRAMEBUFFER=1` (`ui_js/CMakeLists.txt`) → **todas las llamadas
   GL del GS van proxied al hilo principal**. Cualquier plan de rendimiento del GS debe empezar por aquí.
4. **La cifra base cambió**: en Chrome/M2 DBZ va a **28–32 fps (47–54 %) con render completo**, no al
   13 % de julio (aquellas medidas eran en Firefox). El objetivo "≥30 fps" está en el borde ya sin frameskip.
   Hay que fijar navegador y máquina de referencia en el protocolo.
5. **Bugs confirmados en vivo**: (a) el contador "f/s" de la UI muestra 0–12 mientras las métricas dan
   28–50 (doble `clearStats()`: `App.tsx` y `ps2web_metrics.ts`); (b) tarjeta de DBZ "sin datos del
   tracker" aunque el catálogo lo tiene (el matcher solo mira el nombre del fichero); (c) glitches de
   textura (bloques de ruido) en escenarios y personajes — coherente con `alphaAsIndex` nunca aplicado
   (patch 13, hallazgo). Los menús 2D se ven perfectos.
6. **El CI no protege lo que importa**: sin gate de fps (una regresión 56→5 fps pasa verde), golden
   opcional si falta el json, `deploy` no depende de `harness`, kill-switches sin test, `traps` sin assert.
   Plan priorizado en §4.

## 1. Estado verificado en vivo (QA funcional)

| Check | Resultado |
|---|---|
| `crossOriginIsolated`, SAB, 8 cores, WebGL2 | ✅ |
| Bundle = deploy 1C.2 (`main.09e9e675.js`), sin deploys posteriores; HEAD repo = `5d5aa85` | ✅ |
| Bindings `setBatchMode/getBatchMode/setGsFrameskip/getGsFrameskip/setGsDiag/getGsDiag/getEeIdlePct/getDrawCalls` | ✅ todos `function` |
| Defaults runtime: batch 2 · frameskip 0 · diag 0 | ✅ |
| `window.__ps2web` API: ready, diskStore, setFrameskip, setGsDiag, importAndSave, bootElfFromOpfs, bootElfFromUrl | ✅ |
| `__ps2web_metrics`: 45 claves, incluye `gsFrameskip`, `gsDiag` | ✅ |
| OPFS: ISO 2,98 GB persistido, listado, boot desde biblioteca | ✅ arranca al selector de idioma en ~20 s |
| Teclado (Enter=START, Z=CROSS, X=CIRCLE, flechas) sobre `#outputCanvas` (tabindex −1: requiere foco/click) | ✅ vía eventos; ⚠️ sin foco visible ni ayuda de controles en UI |
| Memory card: crear save + "Save successful" | ✅ (no se prueba persistencia entre sesiones) |
| Menús, Dragon History, carga de combate (Goku vs Raditz) | ✅ render 2D correcto |
| Integridad tras 26.700 frames: `execMismatches` 0 · `chainTableMismatches` 0 · `badInstances` 0 · `batchBadIndices` 0 · `regionFallbacks` 0 · `staleReverts` 1 · `jitBlocks` 55.560 en 4.325 módulos (12,85 b/m, 33,5 MB) | ✅ sin OOM |
| Consola: 0 errores/warnings GL tras patch 13 (antes: `No texture bound` ×N, `TEXTURE_SWIZZLE_R`) | ✅ |
| Catálogo: búsqueda por `SLUS-21678`, `SLUS_216.78`, `tenkaichi 3`, `Budokai` | ✅ |
| Tarjeta biblioteca → datos del tracker | ❌ "sin datos" para `DBZ BT 3.iso` |
| Contador f/s de la UI | ❌ 0–12 f/s vs 28–50 reales |
| Texturas 3D en combate | ❌ bloques de ruido (IDTEX/alphaAsIndex) |

## 2. Medidas de rendimiento (combate real, 12 muestras de 1 s por modo)

### 2.1 Bisect GS (`setGsFrameskip(0)`, `setGsDiag(n)`)

| modo | emuSpeed | fps | draws/f | gsBusy ms/s | gsStall ms/s | gsWait ms/s | eeExec ms/s | eeIdle |
|---|---|---|---|---|---|---|---|---|
| 0 normal | 54,1 % | 32,4 | 1051 | 861 | 319 | 138 | 490 | 83,9 % |
| 1 sin `glDrawArrays` | 54,8 % | 32,8 | 1126 | 942 | 414 | 56 | 449 | 85,6 % |
| 2 sin render pass | 61,7 % | 37,0 | 0 | 913 | 300 | 87 | 561 | 83,1 % |

Lectura: `gsBusy(0)−gsBusy(1)` ≈ 0 → rasterizar no cuesta. `gsBusy(1)−gsBusy(2)` ≈ 0 → el setup/upload
del render pass tampoco. El ~90 % de ocupación del GS está **fuera de `DoRenderPass`**: proceso de registros
y kicks de vértices, `ProcessHostToLocalTransfer` (subidas de textura/CLUT a VRAM emulada y su conversión),
`FlipImpl`, o el coste del proxy GL al hilo principal (llamadas síncronas que bloquean el GS).
Veredicto para el plan: **la vía 1C.3 (batching de draws) y F4 (WebGPU) quedan descartadas como siguiente
inversión**; primero hay que bisecar el GS *fuera* del render pass.

### 2.2 Fuera de combate (pantalla de resultados)

| | emuSpeed | fps | draws/f | gsBusy | eeIdle | gsStall |
|---|---|---|---|---|---|---|
| frameskip 0 | 64,5 % | 38,7 | 25 | 105 | 95,9 % | 0,2 |
| frameskip 2 | 65,1 % | 39,0 | 8 | 107 | 95,9 % | 0,7 |

GS casi parado, EE casi parado, y aun así 65 %. El frameskip ya no aporta nada aquí (en julio daba 4x
sobre un 13 % en Firefox). Menú de idioma al arrancar: 82,7 % / 49,6 fps. El techo no es constante →
depende de la escena pero no de EE-exec ni de GS.

### 2.3 Hipótesis a instrumentar (en orden de probabilidad)

1. **I/O de disco**: el ISO de 3 GB se lee de OPFS a través del FS de emscripten desde el hilo de emulación;
   cada lectura CDVD síncrona bloquea al EE (aparece como "EE idle"). Pantallas de resultados/carga leen
   mucho. Métrica a añadir: lecturas CDVD/s y ms/s bloqueado en lectura.
2. **Pacing del `EmuThread`** (`CPS2VM`): sleeps/yields con resolución gruesa en worker, o espera de
   vblank. Métrica: ms/s del hilo EE en sleep/wait distintos de `gsStall`.
3. **IOP / SPU2 / OpenAL proxy**: el IOP corre en el mismo hilo que el EE; el audio va a `CSH_OpenAL`
   (proxy). Métrica: `iopExecMsS`, `spuMsS`.
4. **Proxy GL**: medir cuántas llamadas GL síncronas hace el GS por frame (glGetError, glFinish,
   glReadPixels, uniform lookups) y su latencia; alternativa: crear el contexto en el hilo GS con
   `-sOFFSCREENCANVAS_SUPPORT` / `OffscreenCanvas.transferControlToOffscreen()` (elimina el proxy).

## 3. Auditoría del repo (resumen; detalle en el informe del subagente)

**Se verifica hoy en CI** (`.github/workflows/build.yml`, `tests/harness/bench.spec.js`): fixtures
compilan (vu1 best-effort), licencias, patches aplican, emitter gate (`tools/wasm-emitter-check`),
`Play.wasm` existe, smoke (COOP/COEP + wasm válido), emulador vivo, `chainTableMismatches==0`,
`execMismatches==0`, **golden `stateHashAtN==3049433245` solo si existe `bench/results/cube-golden.json`**,
`threadsOk`, batching sano si `jitBlocks>200`, OPFS e2e, code-space e2e.

**No se verifica**: fps/p95 contra `baseline.json` (se escribe, nunca se compara); `traps` de consola;
frameskip y `setGsDiag` en ningún modo; `setBatchMode` 1 y 3; `vu1` gateado; UI más allá del flujo OPFS
(búsqueda, badges, borrado, `serialFromFilename`); import >2 GB / chunking de 64 MB; ningún juego
comercial; `tsc --noEmit`/lint del overlay (un error de tipos se descubre a los 25 min de build);
coherencia `.emsdk-version` ↔ workflow; pin del submódulo CodeGen; `deploy` no depende de `harness`
(`needs: build`) y con `VERCEL_TOKEN` ausente hace `exit 0` (verde sin desplegar).

**Riesgos de código detectados**: sondeo de métricas en `try{}catch{}` vacíos (un binding ausente
degrada en silencio a 0); `computeFrameHash()` con `toDataURL` cada segundo (no determinista, coste);
colisión de nombres en OPFS (`file.name` como clave); UI acoplada a texto `/Jugar/` en tests; doble
`clearStats()` (bug visible); `Desktop/ps2web` no es repo git y contiene `test-roms/*.iso` (ignorado
por `.gitignore`, pero riesgo con `git add -f`).

## 4. Plan de pruebas priorizado

### P0 — CI, barato, cierra agujeros reales (1 PR)
| # | Test | Dónde | Cómo |
|---|---|---|---|
| 1 | Gate de fps: `avgFps ≥ baseline.avgFps×0.85`, `p95MsPerFrame ≤ baseline×1.2` (cube y vu1) | `bench.spec.js` | comparar contra `bench/results/baseline.json` (ya se genera) |
| 2 | Golden obligatorio: fallar si no existe `cube-golden.json` | `bench.spec.js:171` | quitar el `if (existsSync)` |
| 3 | `traps` → assert: 0 `RuntimeError|abort|unreachable` durante el run | `bench.spec.js:123-129` | `expect(traps).toEqual([])` |
| 4 | Kill-switches: tras boot del cube, `setGsFrameskip(2)`→getter=2 y `stateHashAtN` = golden; `setGsDiag(1)`,`(2)`→getter refleja y `fps>0`; `setBatchMode(1)`,`(3)`→`badInstances==0`; volver a defaults y golden intacto | nuevo `tests/harness/switches.spec.js` | mismo harness, 4 sub-runs de 200 frames |
| 5 | Bindings presentes: `strings Play.wasm` contiene `setGsDiag`, `setGsFrameskip`, `setBatchMode`, `getEeIdlePct`, `getDrawCalls` | job build | `grep -c` tras el build; falla si 0 |
| 6 | `tsc --noEmit` + eslint del overlay como job previo (segundos) | nuevo job `overlay-check` | `npm ci && npx tsc --noEmit` sobre `Play-/js/play_browser` con overlay aplicado |
| 7 | `deploy` `needs: [build, harness]` y falla si falta `VERCEL_TOKEN` en `main` | `build.yml:236,254` | quitar el `exit 0` |

### P1 — corrección + cobertura de producto
| # | Test / arreglo | Cómo |
|---|---|---|
| 8 | Bug doble `clearStats()`: un solo consumidor (métricas) y la UI lee `__ps2web_metrics.fps`; test e2e que compara UI vs métrica (±10 %) | `App.tsx`, `ps2web_metrics.ts`; `tests/e2e/ui.spec.js` |
| 9 | Unit tests puros (Node) de `canonSerial`/`serialFromFilename`/`searchGames`: `SLUS_216.78`, `SLUS-21678`, `slus21678`, nombres sin serial | `tests/unit/compat.test.mjs` |
| 10 | Matcher por serial real: leer `SYSTEM.CNF` del ISO al importar (ISO9660, primeros MB) y guardar serial en OPFS metadata → badge correcto para `DBZ BT 3.iso` | `ps2web_diskstore.ts` + test con ISO sintético |
| 11 | E2E biblioteca: importar 2 ficheros (incl. nombre duplicado → debe avisar), buscar, borrar con `confirm` stub, badge verificado | `tests/e2e/library.spec.js` |
| 12 | Flakiness: `retries: 1` en las 3 configs + assert explícito "módulo arrancó" antes de evaluar métricas (separa setup de gate) | `playwright.config.js`, `bench.spec.js` |
| 13 | Métricas nuevas para §2.3: `cdvdReadsS`, `cdvdBlockMsS`, `eeSleepMsS`, `iopExecMsS`, `glSyncCallsPerFrame` | patch 14 (instrumentación, default on, coste ~0) |
| 14 | `setGsDiag(3)`: saltar también `ProcessHostToLocalTransfer` (memcpy + invalidación de caché) y `setGsDiag(4)`: GS drena mensajes sin procesarlos (suelo del hilo) → completa el bisect fuera del render pass | patch 14 |

### P2 — robustez e infra
| # | Test | Cómo |
|---|---|---|
| 15 | Import grande: fichero sintético ≥ 200 MB (y uno >2 GB nightly) para el chunking de 64 MB y el límite de `FileSystemWritableFileStream` | e2e con `Blob` generado |
| 16 | Pin de `deps/CodeGen` en `UPSTREAM-CODEGEN.lock` + step que compara con el submódulo; `ps2dev/ps2dev` por digest; `.emsdk-version` == versión del workflow | `build.yml` |
| 17 | `vu1` fatal en build y con gate propio de fps cuando esté estable | `build.yml:22,205` |
| 18 | Test de memory card: crear save, recargar página, el juego ofrece "Continue" | manual con ISO (checklist) |
| 19 | Matriz de navegadores: Chrome, Firefox, Safari (SAB/COOP) — smoke + cube en los tres, con `browserName` en `bench/results` | Playwright projects |

### Protocolo manual con ISO real (checklist de release, no automatizable sin licencia)
Máquina y navegador de referencia fijos (hoy: M2 + Chrome). Cmd+Shift+R y comprobar hash de `main.js`.
DBZ BT3: boot → combate Dragon History "Saiyan Saga" (Goku vs Raditz) ≥ 30 s tras "Fight!". Registrar
`copy(JSON.stringify(window.__ps2web_metrics,null,2))` en: normal, `setGsDiag(1)`, `(2)`, `setGsFrameskip(2)`.
Criterios: `execMismatches==chainTableMismatches==badInstances==0`, `staleReverts ≥ 1`, 0 errores GL en
consola, emuSpeed ≥ el de la release anterior −5 puntos, captura de imagen para comparar glitches.
Añadir 2–3 juegos ligeros de la Tanda 1 (Budokai 1 SLUS-20591, Disgaea SLUS-20666) para medir "jugable"
fuera del peor caso.

## 5. Automatización propuesta
- `tests/harness/switches.spec.js` (P0-4) y el gate de fps (P0-1) entran en el job `harness` existente
  (+~3 min); el job `overlay-check` (P0-6) corre en paralelo a `build`.
- Script `tools/qa-live.mjs` (Playwright, local, con ISO en OPFS): reproduce §2 de forma desatendida —
  boot, secuencia de teclas hasta el combate (Enter ×6, Z, →, Z, Z, Z, →×3, Z, Z, Z×8, Enter), espera
  `drawCallsPerFrame > 500`, ejecuta bisect + frameskip, vuelca JSON a `bench/results/dbz-<fecha>.json`.
  Es exactamente lo que se hizo a mano en esta sesión; convertirlo en script evita repetirlo.
