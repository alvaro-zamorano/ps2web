# PROFILE-DBZ — Fase 0 del PLAN-DBZ-FLUID (reparto del frame + veredicto)

> Salida OBLIGATORIA de la Fase 0. Mide el reparto exacto del frame de DBZ BT3 (SLUS-21678) para
> decidir con datos qué cuello atacar. **VEREDICTO: GS-BOUND** (ver §5). Medido en gameplay real por
> Alvaro sobre el build instrumentado (patch 11) desplegado en dist-ivory-phi-37.vercel.app.

---

## 1. Qué se instrumentó (patch `11-profile-fase0.patch`, read-only, `#ifdef __EMSCRIPTEN__`)

Contadores `steady_clock` acumulativos; ninguno toca EE RAM → gate del cube (`stateHashAtN=3049433245`) inmune.

| Métrica | Getter | Qué mide | Dónde |
|---|---|---|---|
| `eeIdlePct` | `getEeIdlePct()` | % EE ocioso (idle/total ticks) | StatsManager ← CPS2VM |
| `drawCallsPerFrame` | `getDrawCalls()`/frames | draw calls por frame = carga GS | CStatsManager |
| `framePctEe` | `getEeExecMs()` | % hilo EE en `ExecuteCpu` (dispatch+exec) | CPS2VM::UpdateEe |
| `framePctVu` | `getVuExecMs()` | % hilo EE en VU0+VU1 | CPS2VM::UpdateEe |
| `framePctGsStall` | `getGsStallMs()` | % hilo EE **bloqueado** esperando al GS | CGSHandler::SendGSCall |
| `gsLoadPct` | `getGsBusyMs`/`getGsWaitMs` | % hilo GS rasterizando vs ocioso | CGSHandler::ThreadProc |
| `vuBlocks` | `getVuBlocks()` | bloques VU en fresco (= módulos VU) | CVuExecutor::BlockFactory |

## 2. Protocolo de medición

CI valida golden con cube/vu1 (automático). La medida real de DBZ la aporta Alvaro pegando
`window.__ps2web_metrics` en combate real (≥30 s tras warmup). El ISO no está en CI.

## 3. RESULTADOS (gameplay real, combate — 2026-07-18)

| muestra | fps | emuSpeed% | eeIdle% | framePctEe | framePctVu | framePctGsStall | gsLoad% | drawCalls/f | vuBlocks |
|---|---|---|---|---|---|---|---|---|---|
| combate 1 | 8.0 | 13.3 | **87.1** | 22.1 | **0.5** | **77.3** | **97.3** | **1197** | 91 |

Crudos por segundo (deltas): `eeExecMsS`=218, `vuExecMsS`=5, `gsStallMsS`=**763**, `gsBusyMsS`=**1000**, `gsWaitMsS`=28.
Salud del batching: jitBlocks 38757 / modulesCreated 2655 (14.6/módulo), moduleBytes 25.6MB **sin OOM**,
`staleReverts`=1, `execMismatches`/`badIndices`/`badInstances`=0, golden del cube intacto.

## 4. Lectura

- El **hilo del GS está al 100%** (`gsBusyMsS`=1000 ms de cada 1000). Es el recurso saturado.
- El **hilo del EE pasa el 77% de su tiempo atribuible BLOQUEADO** esperando al GS (`gsStallMsS`=763 ms/s),
  y globalmente está **87% ocioso**. El EE tiene capacidad de sobra; no es el límite.
- La **VU es despreciable** (0.5%, 5 ms/s; solo 91 bloques). La hipótesis "lucha 3D ⇒ VU pesada" NO se cumple
  en este juego con este renderer.
- **1197 draw calls/frame** es altísimo: es lo que satura al GS. Sumado a los warnings por-frame del backend
  WebGL (`No texture bound`, `Invalid enum TEXTURE_SWIZZLE_R`), apunta a mucho trabajo de GS redundante/no batcheado.

## 5. VEREDICTO — GS-BOUND → rama **FASE 1C**

| Señal | Del árbol de decisión | Medido | ¿Cumple? |
|---|---|---|---|
| EE ocioso alto | sí | **87.1%** | ✅ |
| `framePctGsStall` alto | sí | **77.3%** | ✅ |
| `gsLoadPct` ~100% | sí | **97.3%** | ✅ |
| draw calls altos | sí | **1197/f** | ✅ |

**Cuello #1 = GS (rasterizado WebGL2).** Descartadas por datos: **1A** (EE dispatch/2c — el EE está 87%
ocioso, acelerarlo no da fps) y **1B** (VU — 0.5%). El plan lo predijo: "atacar el cuello medido, no el
supuesto". El loop residente 2c, hero asumido del proyecto, **no habría movido la aguja en DBZ**.

## 6. Plan de la rama 1C (orden por valor/riesgo)

1. **Frameskip** (frontend/overlay, riesgo bajo, además diagnóstico): desacoplar el ritmo del EE del
   render, saltar el dibujado de N de cada N+1 frames. Kill-switch `setGsFrameskip(n)`. Si sube la
   velocidad de emulación, confirma el cuello de GS de forma independiente. **Primer paso.**
2. **Optimización del backend WebGL** (`GSH_OpenGLJs`): cache de estado GL (evitar bind/texParameter
   redundantes — arreglar el `TEXTURE_SWIZZLE_R`), batch de draw calls (bajar de ~1200/frame), cache de
   texturas. Ataca la causa (1197 draws/f).
3. **WebGPU (F4)**: reescribir el backend GS. El proyecto más grande; solo si 1+2 no bastan. Medir antes.

## 7. STOP honesto

Si tras el frameskip + opts de WebGL la mejora real en DBZ es <1.3x y el reparto no muestra un cuello #2
claro, se declara el techo del rasterizado en navegador con datos. Objetivo: 30 fps ≈ 50% (5x sobre 8 fps).

## 8. Nota de método

Una sola muestra ya es concluyente por lo extremo del reparto (EE 87% ocioso, GS 100%). Más muestras en
escenas con más efectos solo reforzarían el veredicto (más draws ⇒ más GS-bound). Esto mide; no acelera:
Fase 0 evitó quemar semanas de CI en 2c, que no era el cuello.

## 9. FASE 1C paso 1 — FRAMESKIP (patch 12): VALIDADO (2026-07-20)

`setGsFrameskip(n)` (default 0=off). n>0 renderiza 1 de cada n+1 frames: `CGSH_OpenGL::DoRenderPass`
(el punto que hace `glDrawArrays` ~1197 veces/frame) hace early-return en frames omitidos; decisión
latcheada al final de `FlipImpl`. Presentación-only: no toca EE RAM.

| | base (n=0) | **frameskip n=2** |
|---|---|---|
| emuSpeedPct | 13.3% | **53.3%** (≈4x) |
| fps (frames emulados/s) | 8.0 | **31.9** |
| gsStallMsS | 763 | 557 |
| gsBusyMsS | 1000 | **997 (GS SIGUE saturado)** |
| drawCalls/f | 1197 | 388 (1 de 3 dibuja) |
| eeIdlePct | 87.1 | 82.2 |

**Objetivo del plan (30 fps ≈ 50%) ALCANZADO: 53% de velocidad de emulación.** GS-bound reconfirmado
(saltar draws cuadruplicó la velocidad). **Gate OK: cube golden intacto** (harness verde; el rojo del
primer run fue flaky de setup, no el golden — el frameskip es default-off y el harness del cube nunca
lo activa). Caveat honesto: `gsBusy` sigue ~997 incluso con n=2 → el GS sigue siendo el muro; el
frameskip cambia frames dibujados por velocidad (render ~10 fps visual), no reduce el coste del GS.

## 10. Siguiente — FASE 1C paso 2 (mantiene render completo)

Reducir el coste real del GS para velocidad Y render full: (a) arreglar warnings por-frame
`No texture bound` / `Invalid enum TEXTURE_SWIZZLE_R`; (b) cache de estado GL más agresivo en
`DoRenderPass` (bind/texParameter redundantes); (c) **batch de draw calls** (bajar de ~1197/f). Si
1C.2 no basta → WebGPU (F4). Pendiente además: muestra n=3 para el techo del frameskip.

## 11. FASE 1C.2 — BISECT setGsDiag (2026-09-08, Chrome/M2, combate Goku vs Raditz)

| modo | emuSpeed | fps | draws/f | gsBusy ms/s | gsStall ms/s |
|---|---|---|---|---|---|
| 0 normal | 54,1 % | 32,4 | 1051 | 861 | 319 |
| 1 sin glDrawArrays | 54,8 % | 32,8 | 1126 | 942 | 414 |
| 2 sin render pass | 61,7 % | 37,0 | 0 | 913 | 300 |

**Veredicto:** rasterizar ≈ 0; el render pass entero ≈ 7 puntos. El hilo GS sigue ~90 % ocupado sin
dibujar → el coste está FUERA de `DoRenderPass` (registros/kicks, `ProcessHostToLocalTransfer`,
`FlipImpl` o el proxy GL al hilo principal: el contexto se crea en main y el GS lo usa desde su pthread
con `-sOFFSCREEN_FRAMEBUFFER=1`). **Ni WebGPU (F4) ni batching de draws (1C.3) son la siguiente
inversión.** Además hay un techo ~65 % con GS y EE casi parados (pantalla de resultados: 25 draws/f,
gsBusy 105, eeIdle 96 %, speed 64,5 %) → sospecha I/O CDVD desde OPFS / pacing del EmuThread / IOP-SPU2.
Nota: base en Chrome/M2 = 47–54 % con render completo (las medidas de julio, 13 %, eran Firefox).
Plan de pruebas y siguientes métricas (`setGsDiag(3/4)`, cdvd/iop/sleep): `docs/QA-PLAN.md`.

## 12. FASE 1C.3/1C.4 — patches 14 y 15 (2026-09-08, tarde)

**Causa del "GS ocupado sin dibujar" (§11): el proxy de GL.** Con `-sOFFSCREEN_FRAMEBUFFER` el contexto WebGL
vivía en el hilo principal; cada gl* del pthread GS iba proxied, y `glTexImage2D/glTexSubImage2D` ≥256 KB,
`glGenTextures`, `glDeleteTextures`, `glReadPixels` son round-trips SÍNCRONOS. **Patch 14**: el GS es dueño del
canvas (OffscreenCanvas) y crea su contexto; el hilo vive en su event loop (`Ps2webDrain`/`Ps2webKick`) porque
OffscreenCanvas solo presenta al ceder; `initVm` en dos fases. A/B: `?gsproxy=1`.

**Causa del "techo 65 % con EE y GS parados" (QA-PLAN §2.2): dos cosas.**
1. Cada lectura de sector del ISO era un proxy síncrono a main + sondeo (`isDone`) con más proxies + `usleep`.
   **Patch 15**: IO worker con `FileReaderSync` y bloque de control en memoria wasm (futex), read-ahead 256 KB.
   A/B: `?discproxy=1`.
2. **Artefacto de métrica**: `fps`/`emuSpeedPct` cuentan flips del GS ÷ 60. DBZ BT3 PAL presenta 25 flips/s en
   menús → "42 %" cuando la VM va a 50 vblanks/s = **100 %**. Nueva métrica `vmSpeedPct` (vblanks/s ÷ CRT).
   Además `limiterMsS`: en el menú el limitador duerme ~600 ms/s = 60 % de CPU libre en el hilo EE.
   Limitador reescrito con deadline absoluto (el upstream no descontaba los despertares tardíos).

Sandbox (Chromium headless + SwiftShader, 4 vCPU): cube 36 fps (GS propio) vs 27 (proxy), golden intacto;
DBZ menú `vmSpeed 100 %`, `iop` 60–90 ms/s, `spu` 25–30, `ee` 100–500, `disc` 0 tras el arranque.
CI (c58814f): build + smoke + harness (golden) verdes; `deploy` falla por `VERCEL_TOKEN` caducado.
**Pendiente: medir combate en el Mac** (gsBusy/gsStall/vmSpeedPct con y sin `?gsproxy=1`). Si el GS sigue
saturado ya sin proxy → ahora sí toca estado/batching de draws (§10); si no → siguiente muro.

## 13. RESULTADO (2026-09-09, Mac M2/Chrome, producción con patches 14+15+16)

| escena | vmSpeedPct | flips/s | draws/f | gsBusy ms/s | gsStall | EE libre (limiter ms/s) |
|---|---|---|---|---|---|---|
| menú idioma | 100 | 50 | 8 | 27 | 0 | 674 |
| Dragon History (cinemática 3D) | 100 | 46 | 552 | 182 | 0 | 444 |
| **combate Goku vs Raditz (20 s)** | **100,0 (mín 99,9)** | **50** | **1134** | 359 | **0** | 298 |
| combate sin limitador (capacidad) | 131 | 61 | 1075 | 456 | 1 | 8 |

Con 14+15 pero el limitador de 2 frames: 88 % (deadline) / 95,5 % (upstream) → patch 16 (ventana 10 frames).
Ayer mismo, misma máquina y escena: 54 % (32 flips/s, gsBusy 861, gsStall 319). Julio: 13 %.
**DBZ BT3 es jugable a velocidad completa en Chrome/M2.** Pendiente de calidad: texturas IDTEX
(glitches en escenarios/personajes en combate; los menús y cinemáticas se ven bien), memory card
no persistente entre recargas, badge del tracker por serial.
