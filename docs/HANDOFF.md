# PS2WEB — HANDOFF (2026-07-10)

Documento para retomar el proyecto en un hilo nuevo y buscar soluciones. Estado **honesto**, no
optimista. Léelo entero antes de tocar nada.

---

## 0. TL;DR honesto (lo primero)
- **Lo que hay:** un fork reproducible de **Play!.js** (emulador PS2 en navegador) desplegado en
  **https://dist-ivory-phi-37.vercel.app**, con CI que compila el wasm y despliega solo.
- **Verdad incómoda:** para el usuario final **NO supera a lo que ya existe gratis en
  https://playjs.purei.org**. Mismo emulador; los mismos juegos se cuelgan en el mismo sitio
  (probado: un comercial se colgó en el mismo punto en ambos → es límite de **compatibilidad de
  Play! upstream**, no algo que rompimos).
- **La mejora estrella del plan (JIT ≥2x) NO se consiguió.** Se midió, diseñó e instrumentó, pero
  la implementación real (bucle de dispatch residente en wasm) se difirió por profunda/incierta.
- **Valor real producido:** infraestructura reusable (CI reproducible, gate de corrección
  determinista, harness de medición, instrumentación) + un **mapa con evidencia** de dónde está el
  techo de rendimiento y qué haría falta para romperlo. Es research que de-riesga un intento
  futuro, no una mejora de producto entregada.

## 1. Qué está vivo / dónde
- **App pública:** https://dist-ivory-phi-37.vercel.app (COOP/COEP OK → crossOriginIsolated=true).
- **Repo:** github.com/Wcoach24/ps2web (overlay + patches + CI + docs). Es un repo *overlay*: el CI
  clona `jpd002/Play-` @ `UPSTREAM.lock` (b72057621e556…), aplica `patches/` + copia `overlay/`,
  compila con emsdk 4.0.1 (presets `wasm-ninja`) y despliega `dist/` a Vercel (job `deploy`,
  secret `VERCEL_TOKEN`).
- **Deploy:** cada push a `main` → rebuild (~30 min) + redeploy automático. Proyecto Vercel se
  llama `dist` (cosmético, renombrable).
- **NO hay fork de GitHub de Play!**: el token no puede crear/forkear repos → se usa `patches/`.

## 2. Fases (estado real)
- **F0** ✅ build wasm reproducible en CI.
- **F1** ✅ auditoría (docs/AUDIT-JIT.md), harness (tests/harness), fixtures homebrew (cube, vu1),
  baseline (docs/BASELINE.md), contrato métricas (overlay/…/ps2web_metrics.ts).
- **F2** ✅ (con matiz) threads pool 8 + `-msimd128`. **Ganancia de fps medida ≈ 0** (threads ya
  estaban activos upstream; SIMD del codegen ya existía). La parte de memoria fija (D5) fue una
  **regresión** revertida (ver §4).
- **F3 (JIT)** ⚠️ PARCIAL/honesto. Diseño + instrumentación + gate + medición hechos; el **≥2x NO
  alcanzado**. Ver §3 (es el corazón del handoff).
- **F5 W1** ✅ persistencia OPFS (import→reload→persiste→bootea), **sin UI** (solo
  `window.__ps2web.diskStore` por consola). F5 W2 (lectura por FileSystemSyncAccessHandle + CHD) NO
  hecho.
- **F8** ✅ shipped (URL pública, COOP/COEP).
- **F4 (WebGPU)** y **F6 (UX/librería UI)** NO empezados.

## 3. EL PROBLEMA CENTRAL (rendimiento del JIT) — para el hilo nuevo
Play!.js recompila cada bloque MIPS a **un módulo WebAssembly propio** (`new WebAssembly.Module` +
`Instance` por bloque, `addFunction` a la tabla indirecta). El bucle de ejecución está en C++:
`while(nHasException==0){ FindBlockAt(nPC); block->Execute(); }` — **cada transición de bloque cruza
la frontera C++↔wasm**. Medido: **vu1 hace ~1.85 M dispatches/seg**.

**Medición concluyente (docs/BENCH-F3.md):**
- El JIT-compile NO domina el estado estacionario (~0.13 ms/bloque, casi todo en warmup).
- Las optimizaciones del **lado C++** (mapa per-executor + fast-path que salta FindBlockAt)
  **NO aportan fps** (vu1 −2.9%, dentro de ruido). → **el cuello es el cruce C++↔wasm por bloque.**
- **El ≥2x solo puede venir de W2.2b.2c**: un **bucle de dispatch RESIDENTE EN WASM** que hace
  `call_indirect` entre bloques sin volver a C++. Requiere **emitir wasm a mano** (via
  `CWasmModuleBuilder`) importando `__indirect_function_table` (la tabla de bloques) + la memoria
  compartida, replicando el modelo de excepción/quota.

**Incógnitas duras de 2c (lo que hay que resolver en el hilo nuevo):**
1. ¿`CWasmModuleBuilder` puede emitir `loop`+`call_indirect`+imports de tabla 0? (leer
   `deps/CodeGen/src/WasmModuleBuilder.cpp` y `Jitter_CodeGen_Wasm.cpp`).
2. ¿Se puede instanciar un módulo que importe `__indirect_function_table` (emscripten `wasmTable`)
   + `wasmMemory`? (el glue actual en `MemoryFunction.cpp` importa `codeGenImportTable`, otra tabla).
3. Mapa PC→índice ya existe en memoria lineal (patch 06/07, per-executor) — reusable por el loop.
4. Correctness: respetar `nHasException`/`cycleQuota` exactamente; invalidación de bloques (SMC)
   y **reciclaje de bloques** (riesgo de entradas stale — el gate de cube podría NO cubrirlo).

**Segundo problema, para juegos GRANDES:** `failed to allocate executable memory for module` =
*code-space* del navegador agotado por **decenas de miles de módulos wasm** (1 por bloque). Eso lo
mitiga el **batching (F3 Palanca 1 / JIT-04)**: N bloques en 1 módulo. NO hecho.

## 4. Bugs/regresiones aprendidas (no repetir)
- **D5 (memoria fija 1GB) = regresión.** Validado solo con homebrew diminuto; un comercial hace
  **OOM** (`out of memory` en el worker). Revertido a `ALLOW_MEMORY_GROWTH` + `MAXIMUM_MEMORY=2GB`
  (commit 99f1d2a, `tools/apply_f2_flags.sh`). **Lección: validar SIEMPRE con un juego real, no solo
  micro-fixtures.** (Ojo: como el juego también se cuelga en purei, este fix no lo rescata; solo
  quita una regresión nuestra.)
- **frameHash de canvas NO es gate de corrección** (blank-dominated + no-determinista). Gate real =
  `getStateHash()` de EE RAM anclado a frame fijo (**solo determinista sin VU1**; vu1 es async).
- **CRLF:** algunos ficheros de Play! (p.ej. `Source/BasicBlock.h`) usan CRLF → editarlos en modo
  texto los reescribe enteros. Editar en binario. Verificar con `git diff --numstat`.
- **git add -A tras renombrar un patch** subió un duplicado 05 que rompió CI. Usar `git rm`.

## 5. Activos reusables (lo que SÍ vale)
- `patches/01..07` sobre Play! pinneado (instrumentación JIT, contador de dispatch, mapa
  PC→índice global y **per-executor** con invalidación, state-hash determinista, frame-anchored).
  Aplican limpios en secuencia. El mapa per-executor (07) es la base para el loop de 2c.
- `overlay/js/play_browser/src/`: `ps2web_metrics.ts` (contrato window.__ps2web_metrics + hooks de
  boot), `ps2web_diskstore.ts` (OPFS), `PlayModule.ts` modificado.
- `tools/assert_speedup.js` (mediana de N runs + gate de frameHash) — el DoD de rendimiento.
- `tools/apply_f2_flags.sh` (flags de build), `tools/serve.py` (COOP/COEP).
- Harness Playwright (`tests/harness/bench.spec.js`) + E2E OPFS (`tests/e2e/opfs.spec.js`).
- **Gate de corrección:** `bench/results/cube-golden.json` (cube.stateHashAtN=3049433245) asertado
  en duro en el harness. Cualquier cambio del JIT que corrompa el EE → cube falla solo.
- Docs: `docs/AUDIT-JIT.md`, `docs/JIT-DESIGN.md` (plan completo de 2c), `docs/BENCH-F3.md`
  (todas las mediciones), `docs/BASELINE.md`, `docs/PS2WEB-MASTER-PLAN.md`.

## 6. Direcciones a explorar en el hilo nuevo (rankeadas, con honestidad)
1. **¿Merece la pena?** Pregunta previa. Si el objetivo es *usar* un emulador PS2 web, purei.org ya
   existe. Solo tiene sentido seguir si el objetivo es **superarlo en algo concreto**: velocidad
   (2c), render (WebGPU), o compatibilidad/UX. Decidir esto ANTES de gastar más.
2. **JIT-02 2c (la apuesta de rendimiento):** el bucle residente en wasm. Alta incertidumbre (§3).
   Empezar por un *spike* de 1 día: ¿puede CWasmModuleBuilder emitir el loop + importar la tabla
   indirecta? Si NO → hay que extender el codegen (mucho) o cambiar de enfoque.
3. **Compatibilidad de juegos (el problema REAL del usuario):** los juegos se cuelgan (techo ~60% de
   Play! + subset navegador). Esto es terreno de **Play! upstream** — mejorarlo es trabajo de
   emulación por-juego, enorme y probablemente fuera de alcance. Alternativa realista: **contribuir
   fixes upstream** o gestionar expectativas (curar una lista de "juegos que sí van en navegador").
4. **F4 WebGPU:** render más rápido/mejor que WebGL2. Independiente del JIT. Diferenciador visible
   si el cuello en juegos reales resulta ser el GS (medir primero).
5. **Batching (JIT-04):** arreglaría el OOM de *code-space* en juegos grandes (decenas de miles de
   módulos → pocos). Menor riesgo que 2c; win de arranque + habilita juegos grandes.
6. **F6 (UX/librería UI) + F5 W2 (streaming OPFS):** hacen que se sienta producto (la persistencia
   ya funciona pero es invisible). Bajo riesgo, valor de producto, no de rendimiento.

## 7. Cómo trabajar aquí (gotchas del entorno)
- **Build solo en CI** (el sandbox no tiene toolchain ni RAM). Cada iteración ~30 min.
- **git NO opera sobre la carpeta montada** (Desktop) desde el sandbox → clonar en `/tmp` y pushear
  con el PAT; espejar ficheros a Desktop con `cp`.
- **PAT** (lo da el usuario): solo push a repos existentes de Wcoach24; NO puede forkear/crear repos.
  No guardar el token en memoria ni en disco.
- **Verificar CI** leyendo run/jobs por API (status es público; logs y artefactos necesitan token).
- **Correctness primero**: nunca declarar speedup sin `assert_speedup` (mediana ≥3 runs) + cube
  golden intacto + **validación manual de un juego real (T2)**.
