# PS2WEB

**Tu PS2, en tu navegador. Tus juegos nunca salen de tu equipo.**

Emulador de PlayStation 2 en el navegador — fork *upstream-friendly* de
[Play!](https://github.com/jpd002/Play-) con threads (SharedArrayBuffer), SIMD,
recompilación JIT-a-wasm, render WebGPU y almacenamiento persistente OPFS.
100% client-side, zero-install, **BYOR**.

> Estado: **F0 — toolchain y build reproducible** (ver `.gsd/ROADMAP.md`).

## Cómo está organizado
- `.gsd/` — spec stack (gsd-cowork): PROJECT, REQUIREMENTS, ROADMAP, STATE, CONTEXT, PLAN.
- `docs/` — plan maestro y documentos de fase.
- `tools/` — `build.sh` (build reproducible) y `serve.py` (servidor COOP/COEP).
- `.github/workflows/build.yml` — build wasm en la nube (emsdk pinneado).
- `tests/` — smoke test Playwright y fixtures homebrew (con licencia).

## Legal
Ver [LEGAL.md](./LEGAL.md). No se distribuye ni aloja ninguna ROM/BIOS. El BIOS HLE de
Play! hace innecesario cualquier BIOS de Sony.

## Build
Ver [BUILDING.md](./BUILDING.md).

## Handoff / estado
Ver [docs/HANDOFF.md](./docs/HANDOFF.md) — estado honesto del proyecto y direcciones para retomarlo.
