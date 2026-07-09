# Fixtures homebrew (LEG-02 / TST-01)

Solo homebrew open-source con licencia libre archivada. CERO ROM/BIOS.

## cube (src/cube/)
Sample gráfico del **ps2sdk** (ps2dev): cubo 3D rotando (EE + math3d + GS via draw3d).
Licencia: **Academic Free License v2.0** — ver `src/cube/LICENSE`.
Origen: `ee/draw/samples/cube` de github.com/ps2dev/ps2sdk. (c) 2005 Naomi Peori.
Se compila a `cube.elf` en CI con la imagen `ps2dev/ps2dev` (job `fixtures`).

Ejercita: pipeline EE→GS, genera frames GS medibles por `getFrames()` → fps/emuSpeedPct.
