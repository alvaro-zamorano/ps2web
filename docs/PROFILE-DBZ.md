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
