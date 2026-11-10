# Avance — Fix pedidos no registrados · FASE A (nano-server)

## Qué se hizo
- `POST /pedido` acepta un campo opcional `idPedido` para hacer el alta idempotente:
  - Validación con `/^[a-zA-Z0-9-]{8,64}$/` (además debe ser string). Si no cumple → 400 `{ error: 'idPedido inválido' }`.
  - `_id` = `pedido-${idPedido}`.
  - `numeroPedido` = primeros 8 caracteres de `idPedido` sin guiones, en mayúsculas (estable entre reintentos).
  - Alta con `client.createIfNotExists`. Si el doc ya existía (reintento de un pedido que sí se guardó) responde OK con el mismo `pedidoId` y `numeroPedido`, sin crear otro documento ni modificar el original.
- Sin `idPedido` el comportamiento es el de siempre (`client.create`, `numeroPedido` random) → compatible con el front que está hoy en producción.
- Respuesta igual en ambos casos: `{ ok: true, numeroPedido, pedidoId }`.
- Logs con prefijo `[pedido]` para buscar en Render: `recibido`, `guardado`, `ya existía (reintento)`, `rechazado` (400) y `ERROR` (mensaje, status y detalle de Sanity).
- `CLAUDE.md` pasa a estar versionado y documenta la idempotencia, el prefijo de logs y `SANITY_DATASET`.

## Archivos creados / modificados
- `index.js` — solo el handler de `POST /pedido`.
- `CLAUDE.md` — nuevo en el repo (antes estaba untracked) + sección de patrones actualizada.
- `docs/avances/fix-pedidos-no-registrados-A-server.md` — este archivo.

## Decisiones tomadas durante la implementación
- Los campos del documento se arman en un único objeto `datosPedido` que usan las dos ramas (con y sin `idPedido`), para no duplicar el mapeo de items/`_key`. Se verificó que el documento resultante tiene exactamente los mismos campos en ambos casos.
- Para distinguir "guardado" de "ya existía" se usa `createIfNotExists(..., { returnDocuments: false })` y se lee `results[0].operation` (`'create'` vs. no-op). No hace una lectura extra a Sanity.
- `idPedido: null` se trata igual que ausente (flujo viejo). Un `idPedido` que no sea string (ej. número) → 400, para no romper en `.replace`.
- En un reintento, el documento conserva la `fecha` del primer alta.
- Se creó la rama `develop` en nano-server (no existía) desde `main`, y de ahí `fix/pedido-idempotente`.

## Desvíos respecto al brief
- El punto 1 (dataset configurable con `SANITY_DATASET`) ya estaba implementado en `main` (commit `94e25f5`); no hubo que tocarlo.
- La rama salió de un `develop` creado en esta tarea, porque el repo no tenía `develop`.

## Pendientes / problemas encontrados
- El log `[pedido] ERROR` no se probó forzando una falla real de Sanity (el código está, no se vio correr).
- `CLAUDE.md` todavía dice que el front tiene `SERVER_URL` hardcodeado; según el brief de la FASE B ahora usa `VITE_SERVER_URL`. Queda para corregir en otra tarea.
- Al mergear a `main`, verificar en el dashboard de Render que el deploy coincide con el último commit (el auto-deploy del plan free a veces no se dispara).
- FASE B (nano-web: reintentos + paso de error) pendiente hasta confirmar que el server está Live en producción.

## Cómo probarlo
1. En `.env` local tener `SANITY_DATASET=staging` (o lanzar `SANITY_DATASET=staging node index.js`). Nunca probar contra production.
2. Levantar el server: `npm run dev` (puerto 3001).
3. Casos:
   - POST `/pedido` sin `idPedido` → crea pedido con `_id` random.
   - POST con `"idPedido": "test-abc12345"` → crea `pedido-test-abc12345`, `numeroPedido` `TESTABC1`.
   - Repetir el mismo POST → misma respuesta, el log dice `ya existía (reintento)` y en staging hay un solo documento.
   - `"idPedido": "abc$%"` o `"corto"` o un número → 400 `idPedido inválido`.
   - GET `/pedido/pedido-test-abc12345` → devuelve el pedido.
4. Borrar de staging los pedidos de prueba al terminar.

Resultado de la verificación hecha (20/10/2026, staging): los 8 chequeos OK (alta sin/con id, reintento sin duplicado, 400 en inválidos, GET, conteo en staging, mismos campos con/sin id, limpieza).
