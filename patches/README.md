# patches/ — cambios de F3 al código de Play! (modelo sin fork de GitHub)

El token disponible no puede crear/forkear repos (solo push a repos existentes de Wcoach24),
así que en vez del objeto-fork de GitHub usamos una **serie de patches** que consigue lo que
pide el plan (D10): diffs limpios, revisables y rebasables sobre el commit pinneado de upstream.

## Estructura
- `patches/*.patch`         → se aplican al árbol principal de Play! (`Source/…`, CMake, etc.)
- `patches/codegen/*.patch` → se aplican al submódulo `deps/CodeGen` (Play--CodeGen)

## Cómo se aplican (CI, tras el checkout de Play- @ UPSTREAM.lock)
```
for p in patches/*.patch;         do git -C Play-            apply --index "$p"; done
for p in patches/codegen/*.patch; do git -C Play-/deps/CodeGen apply --index "$p"; done
```
Orden alfabético (prefijo NN-). Cada patch = un sub-hito con nombre claro.

## Generar un patch (flujo de desarrollo)
En un clon de Play- @ UPSTREAM.lock: editar → `git diff > /ruta/ps2web/patches/NN-desc.patch`
(para CodeGen, hacer el diff dentro de `deps/CodeGen`).

## Migración a fork real (si algún día hay token con permiso)
`git apply` cada patch sobre un fork Wcoach24/Play- y convertirlos en commits; el orden y los
nombres ya reflejan el historial deseado. Nada aquí se pierde.

## Estado
- (vacío) — F3 W2 (batching, JIT-04) deja aquí su primer patch.
