# GS: texturas de DBZ BT3 en combate — PSMT8H sobre framebuffer indexado con el canal equivocado (patch 17)

> 2026-10-05. Medido en el Mac de referencia (Apple M2, Chrome), producción `main.ebd1ad7c.js` /
> `Play.wasm` sha1 `93b997e7…` (serie 01–16). Complementa `PROFILE-DBZ.md` y `QA-PLAN.md` (bug 5c).

## Síntoma
En combate (Dragon History → Saiyan Saga → Goku vs Raditz) toda la escena 3D lleva encima una capa
de **bloques rectangulares semitransparentes** (verdes sobre la hierba, blancos/azules sobre el
cielo, también sobre los personajes) y a ratos un rectángulo azul sólido. Los menús 2D y las
cinemáticas 3D se ven limpios. El HUD se dibuja encima, limpio. El patrón **no se mueve con la
cámara**.

## Método (sin desplegar nada)
`tools/webgl-probe.js` en la consola de producción cargada con `?gsproxy=1` (el contexto WebGL vive
en el hilo principal, así que se pueden envolver los métodos de `WebGL2RenderingContext`). Graba los
draws de un frame (FBO, programa, texturas en las unidades 0/1, blend, colorMask) y permite saltar
draws por predicado para bisecar en vivo.

1. Saltar todos los draws aditivos sobre el framebuffer principal → imagen limpia (y sin glow).
2. Acotando: el ruido lo pinta un draw **sin textura** con `blendFunc(DST_ALPHA, ONE)` → suma color
   ponderado por el **alfa del framebuffer**. El ruido está en ese alfa.
3. El alfa lo escribe antes una cadena de pasadas `colorMask(0,0,0,1)` que leen un framebuffer
   (textura RGBA8 que es render target) **como textura indexada IDX8 con CLUT** (unidad 1 = paleta
   256×1). Es el caso `alphaAsIndex` de `SearchTextureFramebuffer`: TEX0 = PSMT8H apuntando a un
   framebuffer PSMCT32 → el índice de 8 bits es el **alfa** de cada píxel.
4. Volcado de esa textura (`readPixels`): su RGB es basura antigua (llegó a contener un fotograma del
   vídeo de intro), su alfa es lo que el juego calculó. Como esas pasadas solo escriben alfa, el RGB
   nunca se refresca → el ruido es estático en pantalla.

## Causa
Upstream implementa `alphaAsIndex` con `glTexParameteri(GL_TEXTURE_SWIZZLE_R, GL_ALPHA)` y el shader
lee `.r`. **WebGL2 no tiene `TEXTURE_SWIZZLE_*`**: la llamada siempre fallaba con `Invalid enum`
(patch 13 la quitó por coste, ya señalando este riesgo). En el navegador el shader indexaba la paleta
con el **rojo** (basura) en vez del alfa.

## Arreglo (patch 17)
- `FRAGMENTPARAMS.padding2` → `alphaAsIndex` (mismo tamaño 0x40; en el bloque std140 `float
  g_alphaAsIndex` cae en el offset 60, justo tras `vec3 g_fogColor`).
- `SetupTexture`: `m_fragmentParams.alphaAsIndex = texInfo.alphaAsIndex ? 1 : 0` (los params ya se
  invalidan al final de la función).
- Shader: `float ps2webIndex(vec4 s) { return (g_alphaAsIndex != 0.0) ? s.a : s.r; }` en los 5 sitios
  que leen el índice (IDX4/IDX8, con y sin filtrado bilineal manual). Con el flag a 0 es idéntico a
  antes. Sin variantes de shader nuevas (no se toca `SHADERCAPS`).

## Validación
| Prueba | Resultado |
|---|---|
| A/B en vivo, mismo combate, mismo frame (hot-fix del shader desde `webgl-probe.js`, `__gl.alphaFix` on/off/on) | ruido presente solo con el fix desactivado; con el fix: cel-shading, contornos y glow correctos |
| Compila (emsdk 4.0.1, preset wasm-ninja + simd) | OK |
| La serie 01–17 aplica limpia sobre `UPSTREAM.lock` con el bucle del CI | OK, ficheros resultantes idénticos a los compilados |
| cube golden (harness local, fixture original del Mac `cube.elf` sha1 `974e20b3…`) | 3049433245 en 5 de 6 runs |
| Misma prueba con la build **de producción** (sin patch 17) | 3049433245 en 3 de 5 runs; el resto 545571455 |
| Consola al arrancar el cube (base vs 17) | 0 errores en ambos; render idéntico salvo la rotación |

## Hallazgos colaterales (abiertos)
1. **El golden es bimodal en este entorno** (2 cores, SwiftShader): `stateHashAtN` sale 3049433245 o
   545571455 con el mismo wasm y el mismo ELF. Es preexistente (le pasa a la build de producción).
   Hipótesis: el EE del cube depende del ritmo del hilo GS en torno al frame 180; con más cores (CI)
   saldría casi siempre el valor golden. Hasta arreglarlo: ante un rojo del golden, re-run antes de concluir.
2. **Deriva del fixture**: el job `fixtures` compila `cube.elf` con `ps2dev/ps2dev:latest`. La imagen
   actual (digest `sha256:06ace705…`) genera otro binario (sha1 `bc1082f9…`, 174644 bytes) cuyo
   hash en el frame 180 no es el golden (y además varía entre runs). Previsiblemente el CI se pondrá rojo
   por esto aunque el código no cambie.
   Arreglo: fijar la imagen por digest o versionar los ELF de `tests/fixtures` (ambos tocan
   `.github/workflows/build.yml`).
3. `SetRenderingContext` compara `SHADERCAPS` como `uint32` aunque usa 35 bits: cambios solo en
   `alphaFailMethod` (bit alto) o `alphaTestDepthTest*_DepthFetch` no cambian de shader. Bug upstream;
   candidato a patch aparte con su propia validación.
