# PS2WEB — PLAN PARA HACER DBZ BUDOKAI TENKAICHI 3 FLUIDO (brief para Opus 4.8)

> Eres el agente ejecutor. Lee ENTERO `docs/HANDOFF.md`, `docs/JIT-04-BATCHING.md` y este
> documento antes de tocar código. Estado actual: DBZ BT3 (SLUS-21678) **arranca y se juega**
> gracias al batching por regiones (JIT-04 v2) — muere en purei.org por OOM, aquí no. Pero va a
> **~6 fps / 10% de velocidad** y con glitches gráficos. Objetivo de este plan: **fluido**.

## 0. Honestidad sobre la palabra "infalible"

**No se puede garantizar el RESULTADO.** DBZ BT3 es de los juegos más exigentes de PS2 (DVD, 3D
pesado, mucha VU y muchos efectos de GS). El build wasm corre al ~10% de la velocidad real: llegar
a "fluido" (objetivo realista **30 fps ≈ 50%**, stretch 60 fps) es un salto de **5–10x**. Ningún
plan honesto promete eso de antemano.

**Lo que SÍ es infalible es el MÉTODO**, y es la única forma de no quemar semanas de CI a ciegas:

1. **Medir primero** el reparto exacto del frame (EE / VU / GS / sincronización). Sin esto,
   cualquier optimización es una apuesta. Toda esta sesión lo demostró: adivinar cuesta ciclos;
   leer los datos los ahorra.
2. **Atacar el cuello medido**, no el supuesto.
3. **Verificar con gate** cada mejora (cube golden + juego real + `assert_speedup`).
4. **Criterio de STOP claro**: el plan dirá con datos si "fluido" es alcanzable o si se ha tocado
   el techo real del emulador en navegador — y en ese caso lo declara sin maquillar.

Resultado garantizado: **o DBZ BT3 llega a jugable, o sabremos exactamente por qué no y dónde está
el muro.** Eso es lo infalible.

---

## 1. Arquitectura real (verificada en el código, no supuesta)

Play! reparte el trabajo en **hilos** (emscripten pthreads, pool 8, `crossOriginIsolated`):

| Subsistema | Qué hace | Estado JIT | ¿Batcheado? | ¿Block linking? |
|---|---|---|---|---|
| **EE** (MIPS R5900) | CPU principal, lógica del juego | JIT→wasm, `CEeExecutor` | **SÍ** (JIT-04 v2, regiones, ~13–16x) | **NO** (`#if !defined(__EMSCRIPTEN__)`) |
| **VU1** (vector unit) | geometría/skinning 3D — **pesadísimo en un juego de lucha** | JIT→wasm, `CVuExecutor` | **NO** — su `PartitionFunction` NO pasa por mi batcher (crea 1 módulo/bloque) | **NO** |
| **GS** (GPU) | rasteriza vía **WebGL2** (`GSH_OpenGLJs`) | — | — | corre en **hilo propio** con `CMailBox`; el EE **se bloquea** en `SendGSCall(waitForCompletion)` / `Finish()` si el GS no da abasto |
| IOP | I/O, sonido | JIT | no relevante | — |

**Las tres claves del rendimiento, todas confirmadas leyendo el código pinneado:**

1. **Block linking DESACTIVADO en wasm.** `CBasicBlock::LinkBlock`/`JumpToDynamic` están dentro de
   `#if !defined(AOT_ENABLED) && !defined(__EMSCRIPTEN__)`. Consecuencia: **cada transición entre
   bloques vuelve al bucle de dispatch en C++** (`FindBlockAt`→`Execute`). En la partida de Alvaro:
   **~1.870 millones de dispatches**, ~195.000 por frame. A ~1,16 M dispatches/s medidos → el
   dispatch por sí solo explica buena parte de los 167 ms/frame. **Este es el cuello del EE.**
2. **La VU1 no está batcheada ni linkada.** En un juego de lucha 3D la VU1 es carga mayor. Hoy
   paga 1 módulo por bloque y cruza a C++ en cada transición, igual que el EE antes del batching.
3. **El GS puede ser contrapresión.** Si el hilo de GS (WebGL2) no rasteriza a tiempo, el EE
   **espera**. Un cuello de GS se manifiesta como **EE ocioso alto**, no como EE saturado.

**Profiling ya disponible (solo hay que exponerlo a JS):**
- `CPS2VM::CPU_UTILISATION_INFO { eeTotalTicks, eeIdleTicks, iopTotalTicks, iopIdleTicks }` →
  **% de EE ocioso**. EE ocioso alto ⇒ el cuello NO es el EE (es GS/VU/sync). EE ocioso ~0 ⇒ EE-bound.
- `CStatsManager::GetDrawCalls()` → draw calls por frame = carga de GS.

---

## 2. FASE 0 — PROFILE (obligatoria, ~1 ciclo CI, CERO optimización aquí)

**No se escribe ni una línea de optimización hasta cerrar esta fase.** Instrumentar y exponer a
`window.__ps2web_metrics` (patrón idéntico a los contadores JIT-04 ya existentes):

1. **EE ocioso %**: exponer `getEeIdlePct()` desde `GetCpuUtilisationInfo()` (eeIdle/eeTotal).
2. **Draw calls/frame**: exponer `getDrawCalls()` (ya existe en StatsManager).
3. **Reparto de tiempo de frame** (lo más importante). Instrumentar con `emscripten_get_now()`
   acumuladores por-hilo:
   - `eeExecNs` — tiempo en `CEeExecutor::Execute` (ejecución de bloques EE).
   - `vuExecNs` — tiempo en `CVuExecutor::Execute` (VU1).
   - `gsBusyNs` / `gsWaitNs` — en `CGSHandler::ThreadProc`: tiempo rasterizando vs esperando el
     mailbox. Y en el lado EE, `gsStallNs` = tiempo bloqueado en `SendGSCall(waitForCompletion)`.
   - `jitCompileMs` — ya existe; separar warmup de estado estacionario (muestrear tras 30 s).
4. **VU sin batchear, cuantificar**: contador `vuModulesCreated` / `vuJitBlocks` (¿cuántos módulos
   solo por la VU?).

**Método de medida:** un run headless de DBZ BT3 no es reproducible en CI (necesita el ISO de
Alvaro). Así que Fase 0 se valida en dos patas:
- CI con cube/vu1 (regresión + que la instrumentación no rompe el golden 3049433245).
- **Alvaro** pega `window.__ps2web_metrics` de DBZ BT3 en gameplay (como ha hecho). Esa es la medida
  real. El plan debe pedírsela explícitamente.

**Salida OBLIGATORIA: `docs/PROFILE-DBZ.md`** con el reparto del frame y el **árbol de decisión**:

| Señal medida | Cuello | Rama a ejecutar |
|---|---|---|
| EE ocioso ~0, `eeExecNs` domina, dispatches altísimos | **EE dispatch** | FASE 1A (linking/tail-calls, luego 2c) |
| `vuExecNs` domina | **VU1** | FASE 1B (batch VU + optimizar VU) |
| EE ocioso alto + `gsStallNs`/`gsBusyNs` altos + draw calls altos | **GS** | FASE 1C (frameskip → GS opts → WebGPU) |
| Nada >40%, todo repartido | muerte por mil cortes | 1A+1B+1C en serie, esperar sumas |

**Gate Fase 0:** cube golden intacto; instrumentación read-only; Alvaro confirma reparto.

---

## 3. FASE 1A — EE: eliminar el cruce C++↔wasm (la apuesta mayor)

Solo si Fase 0 dice EE-bound. **Dos técnicas, en orden de relación valor/riesgo:**

### 1A.1 — Tail-calls intra-módulo (LA JOYA, habilitada por el batching)

**Idea central:** hoy cada bloque es una función wasm que **retorna a C++**, que busca el siguiente
y lo llama. Pero con el batching, **los bloques de una región ya viven como funciones en el MISMO
módulo wasm**. Un bloque que termina saltando a un sucesor que está **en el mismo módulo** puede
llamarlo **directamente con `return_call` (tail-call de wasm)** — encadenando bloques sin volver a
C++ ni siquiera al bucle de dispatch. Esto es el objetivo del 2c, pero **más tratable**, porque las
regiones ya co-ubican los bloques relacionados (fall-through + destinos de salto) y sus índices
dentro del módulo se conocen al materializar la región.

- Los tail-calls de wasm (`return_call`/`return_call_indirect`) están **estandarizados y soportados**
  en Chrome/Firefox modernos (2024+). El comentario "not widely supported" en `Emit_ExternJmp` del
  codegen pinneado ya está obsoleto — **verificar soporte en el runtime objetivo y detrás de un flag**.
- **Alcance incremental y seguro:** un bloque cuyo sucesor está DENTRO de su módulo de región →
  `return_call` directo. Sucesor fuera del módulo → fallback al dispatch de C++ actual (como hoy).
  Empezar solo con fall-through intra-región (el caso más común y más seguro).
- **Correctness:** respeta el modelo de excepción/quota igual que hoy (comprobar `nHasException`/
  `cycleQuota` antes del tail-call, o dejar que el bloque siguiente lo compruebe en su prólogo). El
  gate del cube golden lo protege; añadir gate de un juego con SMC (DBZ) porque los tail-calls
  cambian el flujo real de ejecución.
- **Riesgo:** requiere emitir `return_call` en el codegen wasm (`Jitter_CodeGen_Wasm`) con el índice
  de función intra-módulo — que hoy NO se conoce en `Emit_Jmp` (se resuelve al materializar la
  región). Diseño: el emisor de bloque marca los saltos "resolubles"; el materializador de región
  parchea el índice de función destino antes de `WriteModule`. Bounded pero es codegen real.

**Por qué esto puede dar mucho más que 2c:** elimina el cruce para TODAS las transiciones
intra-región (la mayoría en código de bucle/hot path), no solo mueve el bucle a wasm. Es la unión
natural de "batching" (co-ubicar bloques) con "velocidad" (que se llamen directos).

### 1A.2 — JIT-2c: bucle de dispatch residente en wasm (fallback / complemento)

Para las transiciones ENTRE módulos (sucesor fuera de la región). Veredicto GO en `docs/SPIKE-2C.md`
con prototipo funcional. ~2x sobre el dispatch entre-módulos. Se combina con 1A.1: intra-módulo por
tail-call, entre-módulos por el loop residente. Ejecutar solo si 1A.1 no basta y Fase 0 confirma que
el dispatch entre-módulos sigue siendo cuello.

**Gate 1A:** cube golden intacto + `assert_speedup` (mediana ≥3 runs) ≥1,5x en vu1 + Alvaro confirma
subida de fps real en DBZ. `execMismatches`/`chainTableMismatches` = 0. `staleReverts` sano.

---

## 4. FASE 1B — VU1: batchear y encadenar la unidad vectorial

Solo si Fase 0 dice VU-bound (probable en un juego de lucha 3D).

1. **Extender la compilación por regiones a `CVuExecutor`.** Hoy su `PartitionFunction` (VuExecutor.cpp)
   crea 1 módulo por bloque y NO llama a `Ps2webPartitionRegion`. Portar el mismo patrón: regiones
   de bloques VU en un módulo, verificación especulativa incluida (la VU también tiene programas que
   se recargan → misma disciplina de checksum que JIT-04 v2). Reduce módulos y warmup de la VU.
2. **Tail-calls intra-módulo en la VU** (1A.1 aplicado a bloques VU): las cadenas de microprograma
   VU1 son muy hot y muy encadenadas → gran candidato.
3. **Micro-optimización del codegen VU** (solo si tras 1+2 sigue siendo cuello): revisar
   `Jitter_CodeGen_Wasm_Md` (SIMD 128) para las ops vectoriales VU. Ya hay `-msimd128`; verificar que
   las MAC/clamp de la VU usan SIMD y no escalares.

**Gate 1B:** VU no tiene golden determinista (es async — BENCH-F3). Gatear con: cube golden intacto,
`assert_speedup` en vu1 (que ES el fixture VU), y validación de Alvaro en DBZ (imagen correcta).

---

## 5. FASE 1C — GS: si el cuello es el rasterizado

Solo si Fase 0 dice GS-bound (EE ocioso alto + gsStall alto + draw calls altos).

1. **Frameskip (ad-hoc, frontend/overlay, NO Play! core, riesgo bajo):** desacoplar el ritmo del EE
   del render. Saltar el dibujado de N de cada N+1 frames dejando el EE corriendo → si el GS es el
   cuello, la velocidad de emulación sube. Kill-switch runtime `setGsFrameskip(n)` (patrón
   `setBatchMode`). Es además diagnóstico: si con frameskip suben los fps, confirma cuello de GS.
2. **Optimización del backend WebGL (`GSH_OpenGLJs`):** cache de estado GL (evitar redundant
   `glBindTexture`/`texParameter` — de hecho hay `Invalid enum TEXTURE_SWIZZLE_R` en el log de DBZ =
   llamada GL redundante/errónea que además puede costar), batch de draw calls, cache de texturas
   (`GsTextureCache`). Arreglar el `TEXTURE_SWIZZLE_R` de paso (quita un error por-frame y quizá
   glitches).
3. **F4 / WebGPU (grande, solo si 1+2 no bastan):** reescribir el backend GS sobre WebGPU (existe
   `GSH_Vulkan` en el árbol como referencia de arquitectura moderna). Es el proyecto más grande;
   diferenciador visible pero caro. Medir que el GS es el cuello ANTES de meterse.

**Gate 1C:** el frameskip no debe alterar el estado del EE (solo se salta presentación) → cube golden
intacto. Validación visual de Alvaro (¿sube fps sin romper el juego?).

---

## 6. Los glitches gráficos (problema separado de la velocidad)

Las texturas rotas que ve Alvaro son **corrección del GS**, no velocidad. Candidatos, por orden:
- El `Invalid enum value TEXTURE_SWIZZLE_R` (backend WebGL2): concreto y acotado, arreglar en 1C.2.
- Bugs de emulación GS por-juego: terreno **upstream** — reportar issue, NO perseguir por-juego
  salvo que sea trivial. Un glitch visual no bloquea "jugable"; la velocidad sí.

---

## 7. Gates transversales (sin excepción, heredados del proyecto)

- **Corrección EE:** `bench/results/cube-golden.json` = `stateHashAtN 3049433245` intacto tras
  CUALQUIER cambio.
- **Corrección especulativa/SMC:** `staleReverts` sano, `execMismatches`/`chainTableMismatches` = 0.
- **Rendimiento:** nada se declara sin `tools/assert_speedup.js` (mediana ≥3 runs).
- **Realidad:** toda fase cierra con validación de Alvaro en DBZ BT3 real (fps + imagen). Ningún
  fixture homebrew basta (lección D5).
- **Gate rápido de wasm:** `tools/wasm-emitter-check/run.sh` (emisor + linkado) sigue en el CI.
- **Entorno (HANDOFF §7):** build solo en CI; git NO opera sobre el mount (clonar en /tmp, PAT que da
  Alvaro, espejar con cp); ficheros CRLF (`Source/BasicBlock.h`) editar en binario; verificar la
  serie de patches aplicando el bucle EXACTO del workflow sobre los SHAs pinneados antes de pushear;
  generar patches contra lo TRACKEADO en el repo (`git ls-files`), no contra el árbol local.
- **Cuidado con el dedup:** `CopyFunctionFrom`→`CreateInstance` ha causado 3 bugs; cualquier cambio en
  cómo un bloque obtiene su función DEBE revisar ese path.

## 8. Orden de ejecución y presupuesto

1. **Fase 0 (profile)** — 1 ciclo CI + medición de Alvaro. **Innegociable ir primero.**
2. Según el árbol de decisión, la rama dominante (1A / 1B / 1C).
3. Re-medir tras cada mejora; el cuello se mueve. Repetir hasta objetivo o STOP.
4. **Checkpoint con Alvaro** tras Fase 0 con el reparto, antes de comprometer la rama grande.

**Objetivo:** 30 fps ≈ 50% (jugable). Stretch: 60 fps. **STOP honesto:** si tras atacar el cuello #1
la mejora real en DBZ es <1,3x y el reparto no muestra un cuello #2 claro, se declara el techo del
emulador en navegador con datos y se decide si merece seguir.

## 9. Dependencias de Alvaro
- PAT de push al inicio de cada bloque (no persistir).
- **Medición de DBZ BT3**: `window.__ps2web_metrics` en gameplay tras Fase 0, y validación fps+imagen
  tras cada fase. Es la única medida real (el ISO no está en CI).
- Decisión de rama tras el checkpoint de Fase 0.
- OK para la rama grande (1A.1 tail-calls / 1C.3 WebGPU) antes de ejecutarla.

## 10. Definición de éxito
DBZ BT3 a ≥30 fps jugable en `dist-ivory-phi-37.vercel.app` con el gate del cube intacto y la imagen
correcta (o glitches menores documentados como upstream) — contrastado contra purei.org, donde muere
por OOM. **O**, si no se alcanza, un `docs/PROFILE-DBZ.md` que prueba con datos dónde está el techo y
qué haría falta (hardware/navegador/técnica) para romperlo.
