# Pañalera Nano Mayorista — nano-server (Node/Express)

## ⚠️ Reglas de trabajo — NO NEGOCIABLES

Este backend escribe DIRECTO contra Sanity `production` — es el
punto más sensible de los tres repos. Seguí esto siempre:

- NUNCA toques `main` directo. Creá una rama nueva desde `develop`.
- NUNCA hagas commit/push a `main` sin confirmación explícita
  humana, paso a paso.
- Antes de tocar `.env`: confirmá que está en `.gitignore` de ESTE
  repo — no asumas que porque otro repo del proyecto lo tiene,
  este también (ya pasó lo contrario una vez con nano-studio).
- El dataset se controla con `process.env.SANITY_DATASET`, fallback
  a `'production'`. Cualquier cambio acá NUNCA debe alterar el
  comportamiento cuando la variable no está seteada (como en Render
  hoy) — el fallback es la red de seguridad.
- No asumas el contenido de un archivo — leelo del repo real antes
  de generar un reemplazo.
- Alcance quirúrgico: tocá solo lo que pide el brief de la tarea.
- Deploy real ocurre automáticamente en Render al mergear a `main`
  — no hay paso de deploy manual, así que el merge a `main` ES el
  deploy. Tratalo con el mismo cuidado que un `sanity deploy`.
- No mergees a `main` en horario de alto tráfico del cliente
  (jueves ~17hs Argentina).
- Si tenés dudas sobre si algo puede afectar producción, PARÁ Y
  PREGUNTÁ.

## Sobre este repo

- Node.js + Express, deploy en Render (auto-deploy desde `main`)
- Sanity como DB de escritura — `SANITY_PROJECT_ID`, `SANITY_TOKEN`,
  `SANITY_DATASET` (con fallback a production) en `.env`
- `SERVER_URL` en el frontend está hardcodeado al Render real
  (`https://nano-server-h25x.onrender.com`) — no hay staging del
  lado del frontend todavía; probar cambios de este repo se hace
  con curl/Postman directo contra `localhost`, no a través del sitio.

## Patrones establecidos (para no re-inventarlos)

- El endpoint `POST /pedido` regenera `_key` para cada elemento de
  arrays anidados (`tallesCombo`, `productosInternos`) del lado del
  backend, sin reutilizar el `_key` que pueda haber mandado el
  frontend — el backend es la fuente de verdad final para los keys.
- `POST /pedido` es idempotente si el body trae `idPedido` (opcional,
  validado con `/^[a-zA-Z0-9-]{8,64}$/`, si no → 400 `idPedido inválido`):
  `_id = pedido-${idPedido}`, `numeroPedido` = primeros 8 caracteres de
  `idPedido` sin guiones en mayúsculas (estable entre reintentos), y se
  guarda con `createIfNotExists`. Un reintento de un pedido ya guardado
  responde OK con el mismo `pedidoId`/`numeroPedido` sin crear otro doc
  (ni pisar el original). Sin `idPedido` → `client.create` con
  numeroPedido random (compatibilidad con fronts viejos).
- Logs de pedidos con prefijo `[pedido]` (buscar así en Render):
  `recibido`, `guardado`, `ya existía (reintento)`, `rechazado` (400) y
  `ERROR` (con mensaje, status y detalle de Sanity).
- `SANITY_DATASET`: para probar local contra staging, setear
  `SANITY_DATASET=staging` en `.env` o al lanzar
  (`SANITY_DATASET=staging node index.js`). En Render NO se setea →
  production. Nunca generar pedidos de prueba en production.
- `SANITY_TOKEN` se lee de env var, nunca hardcodeado en código (a
  diferencia de un script viejo en nano-studio que sí lo tiene así
  — deuda técnica anotada en el CLAUDE.md de ese repo).

## Qué NO hacer

- No re-decidir el shape de un campo si ya viene definido en el
  brief.
- No tocar el `SERVER_URL` hardcodeado del frontend como parte de
  una tarea de este repo — es un cambio de otro alcance.
- No mergear a `main` sin las confirmaciones explícitas del
  protocolo de arriba — ese merge dispara el deploy real.


- ⚠️ El auto-deploy de Render (plan free) no siempre se dispara solo
  con el push a main — verificar SIEMPRE en el dashboard de Render
  que el deploy más reciente coincide con el último commit antes de
  dar por buena una feature que toca este repo. Un merge exitoso en
  git NO garantiza que el código esté corriendo en producción.