# AUDIT-JIT — Auditoría de la arquitectura de recompilación (F1 W1)

**Fecha:** 2026-07-09
**Alcance auditado:** `jpd002/Play-` @ `b720576` (UPSTREAM.lock) y su submódulo
`jpd002/Play--CodeGen` @ `a5009f7` (deps/CodeGen).
**Método:** lectura directa del código fuente (sin compilar). Todas las afirmaciones llevan
`fichero:línea`.

---

## Veredicto

**Backend en build emscripten: codegen-wasm.**

El build de emscripten **genera WebAssembly en runtime** (JIT-a-wasm), NO usa intérprete.
De hecho **Play! no tiene intérprete**: es un diseño *recompiler-only*. Por tanto el
proyecto está en **Rama A** del master plan (§F3): *ya existe codegen-wasm; el trabajo es
perfilar y optimizar*, no escribir un backend desde cero.

Evidencia primaria — selección de backend por plataforma:
`deps/CodeGen/src/Jitter_CodeGenFactory.cpp:80-82`
```cpp
#elif defined(__EMSCRIPTEN__)
    return new Jitter::CCodeGen_Wasm();
```

---

## Backends del Jitter existentes

| Backend | Ficheros | Uso |
|---|---|---|
| x86-32 / x86-64 | `Jitter_CodeGen_x86*.cpp` | Windows/Linux/macOS Intel |
| AArch32 / AArch64 | `Jitter_CodeGen_AArch*.cpp` | Android/iOS/ARM |
| **Wasm** | `Jitter_CodeGen_Wasm.cpp`, `_Wasm_64.cpp`, `_Wasm_Fpu.cpp`, `_Wasm_Md.cpp`, `WasmModuleBuilder.cpp`, `WasmDefs.h` | **emscripten (nuestro target)** |

El backend Wasm está completo y estructurado igual que los nativos (ALU, 64-bit, FPU y
**Md** = operaciones vectoriales de 128 bits).

---

## Modelo de ejecución en wasm (cómo funciona hoy)

1. **Un módulo WebAssembly por bloque básico.** Cada `CBasicBlock` compila su propia
   `CMemoryFunction` con los bytes del módulo:
   `Source/BasicBlock.cpp:101` → `m_function = CMemoryFunction(stream.GetBuffer(), stream.GetSize());`

2. **Compilación e instanciación SÍNCRONAS por bloque** (`MEMFUNC_USE_WASM`,
   `deps/CodeGen/src/MemoryFunction.cpp:31-33`):
   - `MemoryFunction.cpp:76` → `let module = new WebAssembly.Module(moduleBytes);`  *(compila, síncrono)*
   - `MemoryFunction.cpp:51` → `let moduleInstance = new WebAssembly.Instance(module, {...})`
   - se registra como puntero de función invocable vía `addFunction`.
   El bloque se ejecuta con `CMemoryFunction::operator()(context)` (`MemoryFunction.cpp:195`).

3. **Dispatch por tabla + funciones externas importadas.** El codegen crea una
   `WebAssembly.Table` compartida y registra los helpers del runtime como funciones wasm:
   `deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp:183` → `Module.codeGenImportTable = new WebAssembly.Table({...})`;
   `:191` → `convertJsFunctionToWasm(fct, fctSig)`. Es exactamente el patrón v86
   (memoria compartida importada + tabla de funcref).

4. **El bucle de dispatch vive en C++.** El ejecutor es `CMipsExecutor::Execute(int)`
   (`Source/MipsExecutor.h:10`): busca el bloque para el PC actual y lo invoca. Cada
   transición entre bloques vuelve a C++.

---

## Capacidades declaradas del backend Wasm (limitaciones clave)

`deps/CodeGen/src/Jitter_CodeGen_Wasm.cpp`:
- `SupportsExternalJumps() = false` (`:358`) → **no puede saltar directamente a otro bloque**;
  toda transición retorna al dispatcher C++.
- `GetAvailableRegisterCount() = 0` (`:338`) y `GetAvailableMdRegisterCount() = 0` (`:343`)
  → no hay banco de registros físicos; todos los símbolos van a *locals*/memoria lineal
  (wasm es máquina de pila; el register-alloc real lo hace el motor, p.ej. Liftoff/TurboFan).
- `Has128BitsCallOperands() = false` (`:348`), `CanHold128BitsReturnValueInRegisters() = false`
  → los valores de 128 bits se pasan por memoria.
- `GetPointerSize() = 4` → **wasm32** (no MEMORY64). Coherente con D5 (INITIAL 1 GB / MAX 2 GB < 4 GB).

## Features desactivadas en emscripten (los guards `#if !defined(__EMSCRIPTEN__)`)

1. **Block linking / chaining — DESACTIVADO.**
   `Source/BasicBlock.cpp:400` `CBasicBlock::LinkBlock` está bajo
   `#if !defined(AOT_ENABLED) && !defined(__EMSCRIPTEN__)` y **parchea los bytes del código
   generado** (`BeginModify()/EndModify()`, `BasicBlock.cpp:411-413`) para saltar directo al
   siguiente bloque. wasm es **inmutable** tras instanciar → imposible parchear → en wasm NO
   hay encadenamiento de bloques. También se omite el `JumpToDynamic(...Trampoline)`
   (`BasicBlock.cpp:305, 320`). **Consecuencia:** round-trip al dispatcher C++ en CADA
   transición de bloque. Es el hot path #1 de estado estacionario.

2. **Protección de memoria para SMC — NO-OP.**
   `Source/ee/EeExecutor.cpp:260-261`: `SetMemoryProtected` no hace nada en emscripten
   (no hay `mprotect`/page-fault en wasm). La detección de código automodificable por
   fallo de página no existe; la invalidación de bloques recompilados se hace por otras vías
   (tracking software). Nota de corrección/compatibilidad para juegos con SMC intensivo.

---

## Estado de SIMD (relevante a JIT-03)

**SIMD ya se emite parcialmente.** El builder de módulos soporta locals `v128`
(`deps/CodeGen/include/WasmModuleBuilder.h` → `FUNCTION::localV128Count`) y existe un backend
MD dedicado (`deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp`) para las operaciones vectoriales
de 128 bits (MMI del EE, VU). Es decir: **el codegen de 128 bits para wasm ya existe**; falta
(a) compilar con `-msimd128` (F2) para que esos `v128` sean SIMD hardware y (b) verificar
cobertura en los hot paths de VU/MMI. Esto rebaja mucho el coste esperado de JIT-03 respecto
a lo que asumía el master plan.

---

## Hot paths (dónde está el tiempo, para perfilar en F1 W3/W4)

1. **Transición entre bloques** (sin chaining) → dispatcher C++ + lookup + `call_indirect`
   por bloque. Steady-state.
2. **Compilación síncrona por bloque** (`new WebAssembly.Module` uno a uno) → coste de JIT
   en primer encuentro y tras invalidación. Startup y zonas con mucho código nuevo.
3. **VU1 micro / VU0 macro (COP2)** y **MMI de 128 bits** → carga de cómputo pesada; camino MD/v128.

---

## Recomendación para F3 (Rama A) — palancas concretas

Ordenadas por retorno esperado; cada una se mide contra `docs/BASELINE.md` (F1 W4):

- **JIT-04 — Batching de compilación.** Coalescer varios bloques básicos en UN
  `WebAssembly.Module` para amortizar el `new WebAssembly.Module` síncrono (hoy 1 por bloque).
  Opcional: compilar en un worker aparte (patrón v86). *Mayor win de arranque/re-JIT.*
- **Encadenamiento de bloques sin SMC (nuevo, habilita JIT-02).** Como no se puede parchear
  wasm, implementar chaining vía la `WebAssembly.Table`: que un bloque devuelva el id del
  siguiente y un trampolín/bucle residente en wasm haga `call_indirect` sin volver a C++.
  Requiere tocar `CCodeGen_Wasm` (hoy `SupportsExternalJumps()=false`). *Mayor win de estado
  estacionario; es el núcleo de ingeniería de F3.*
- **JIT-03 — SIMD.** Activar `-msimd128` (F2) y extender la cobertura v128 del backend MD a
  cualquier op de MMI/VU aún escalarizada. *Gran parte ya está hecha.*

### Corrección (innegociable, D-plan §7.2)
- La corrección depende 100% del codegen (no hay intérprete de referencia). El frame-hash del
  harness (F1 W3) es la verdad. Cualquier cambio de codegen se valida contra baseline.
- Semántica FP de PS2 (clamping no-NaN/Inf, redondeo): ya la implementa Play!
  (`Source/FpUtils.cpp`, con rama `!__EMSCRIPTEN__` en `:13` — revisar el camino wasm en F3).
- Invalidación de SMC sin protección de página: verificar que no introduce regresiones al
  cambiar el modelo de compilación/chaining.

---

## Decisión que habilita esta auditoría (checkpoint de fin de F1)
**F3 = Rama A.** No se escribe backend nuevo; se optimiza el backend Wasm existente
(batching + chaining-por-tabla + SIMD). El fork de Play! (diferido a F2) sigue siendo
necesario porque estas tres palancas tocan `deps/CodeGen` y `Source/BasicBlock.cpp`.
