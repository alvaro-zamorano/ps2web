# PS2WEB

**Your PS2, in your browser. Your games never leave your machine.**

PlayStation 2 emulator in the browser — an *upstream-friendly* fork of
[Play!](https://github.com/jpd002/Play-) with threads (SharedArrayBuffer), SIMD,
JIT-to-wasm recompilation, WebGPU rendering and persistent OPFS storage.
100% client-side, zero-install, **BYOR** (bring your own ROMs).

> Status: **F0 — toolchain and reproducible build** (see `.gsd/ROADMAP.md`).

## Repository layout
- `.gsd/` — spec stack (gsd-cowork): PROJECT, REQUIREMENTS, ROADMAP, STATE, CONTEXT, PLAN.
- `docs/` — master plan and phase documents.
- `tools/` — `build.sh` (reproducible build) and `serve.py` (COOP/COEP server).
- `.github/workflows/build.yml` — cloud wasm build (pinned emsdk).
- `tests/` — Playwright smoke test and licensed homebrew fixtures.

## Legal
See [LEGAL.md](./LEGAL.md). No ROM/BIOS is distributed or hosted. Play!'s HLE BIOS
makes any Sony BIOS unnecessary.

## Build
See [BUILDING.md](./BUILDING.md).

## Handoff / status
See [docs/HANDOFF.md](./docs/HANDOFF.md) — honest project status and directions to pick it back up.
