# Context — Phase F5: OPFS e I/O

## Locked Decisions
- **DiskStore = OPFS** (`navigator.storage.getDirectory()` → `/games/`). Import por
  `FileSystemWritableFileStream` (main thread) en W1. Formato: cualquiera (ELF/ISO/CHD) como bytes.
- **W1 (IO-01)**: importar → persistir en OPFS → listar librería → recargar → sigue → bootear
  desde OPFS. Overlay frontend (ps2web_diskstore.ts + hooks en window.__ps2web). E2E Playwright.
- **W2 (IO-02)**: camino de lectura del disco vía `FileSystemSyncAccessHandle` desde el worker
  (reemplaza el fichero-en-memoria) + verificar CHD (libchdr) en wasm. Diferido (toca el worker/core).
- **W3 (IO-03/04)**: memcards OPFS `/memcards/` + save states `/states/` export/import.

## Gate
E2E: import fixture → `page.reload()` → sigue listado en OPFS → bootea → `fps>0`. Corre en el
job harness de CI (headless chromium, contexto seguro localhost + crossOriginIsolated).

## Notas
- OPFS requiere contexto seguro; localhost lo es. crossOriginIsolated ya activo (COOP/COEP).
- La UI de librería (grid, carátula placeholder) es F6 (UX). F5 W1 expone la API + persistencia;
  el harness la valida por window.__ps2web.diskStore.
