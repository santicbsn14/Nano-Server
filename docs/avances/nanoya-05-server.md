# Avance — Brief 05 NanoYA: canal en pedidos + actualizador con precio al público

Rama: `feature/nanoya-server` (desde `develop` adelantado a `origin/main`). Sin PR ni merge a `main`.
Fecha: 2026-11-20. Todas las pruebas contra Sanity `staging`; nada escrito en `production`.

## Qué se hizo

**Paso 0 — ramas.** `git fetch` → `develop` adelantado por fast-forward a `origin/main` (`cd069d7`, incluye `b185d28`) y pusheado (`9d829a4..cd069d7`). `feature/nanoya-server` creada desde ahí.

**1. `POST /pedido` acepta `canal`.**
- `canal` opcional en el body. Si viene y no es `'mayorista'` ni `'minorista'` → 400 `canal inválido` con log `[pedido] rechazado canal inválido`.
- Siempre se guarda `canal: canal === 'minorista' ? 'minorista' : 'mayorista'` (sin `canal` → `'mayorista'`).
- `canal` sumado al log `[pedido] recibido`. Idempotencia, `numeroPedido`, `_key`, resto de logs y errores: sin cambios.

**2. `canal` en las lecturas.**
- `GET /pedido/:id` y `GET /pedidos` proyectan `"canal": coalesce(canal, "mayorista")`.
- `GET /pedidos` y `GET /productos/mas-vendidos` aceptan `?canal=`: `minorista` → `canal == "minorista"`; `mayorista` → `(!defined(canal) || canal == "mayorista")`; sin `canal`, vacío o `todos` → sin filtro; otro valor → 400 `canal inválido`.
- El fragmento GROQ sale de un mapa fijo (`FILTROS_CANAL`) a través de `filtroCanal()`; lo que viene en la URL solo se usa como clave del mapa y nunca se concatena.

**3. Actualizador (`POST /actualizar`).**
- Detecta `conColumnaFinal` leyendo la **fila de encabezados de la hoja** (`sheet_to_json` con `header: 1` acotado a la primera fila del rango), no la primera fila de datos.
- `MAYORISTA (FINAL)` → `precio`; `Final` → `precioMinorista`. Se lee por nombre de encabezado.
- Cada precio se valida por separado con `limpiarPrecio()`. Si falta uno, se escribe solo el otro; si faltan los dos, la fila se saltea.
- Un solo patch por producto (`set` con los campos válidos). `commitLoteConReintentos()` ahora hace `tx.patch(p._id, { set: p.set })`. Lote de 100, 5 intentos con backoff 1/2/4/8 s por rate limit y pausa de 300 ms entre lotes: **sin cambios**.
- Si el público es menor al mayorista, el producto igual se actualiza y se agrega a `publicoMenorList` (`[id] Producto — público $X / mayorista $Y`).
- Resumen: se mantienen todas las claves que había y se suman `conColumnaFinal`, `sinPrecioMinorista`, `sinPrecioMinoristaList`, `publicoMenor` y `publicoMenorList`.
- Excel viejo (sin `Final`): no toca `precioMinorista` y no cuenta "sin precio al público".

**5. Pantalla (`public/index.html`).**
- La stat "Sin precio válido" pasa a llamarse "Sin precio mayorista".
- Si `conColumnaFinal`: stats "⚠ Sin precio al público" (amarillo) y "⚠ Precio al público menor al mayorista" (naranja), cada una con su lista de detalle.
- Si no: línea gris "Este archivo no trae la columna Final: no se actualizaron los precios de NanoYA."

## Archivos

- `index.js` (modificado)
- `public/index.html` (modificado)
- `docs/avances/nanoya-05-server.md` (nuevo)

## Decisiones

- **`?canal=` vacío** se trata como "sin canal" (sin filtro). Si `canal` viene repetido en la URL (llega como array) → 400.
- **Orden de los contadores de precio:** igual que antes, `sinPrecio` y `sinPrecioMinorista` se cuentan **antes** de buscar el producto en el catálogo (o sea, incluyen filas del sistema que no están en el catálogo, como hacía `sinPrecio`).
- **`noEncontrados` con el Excel nuevo:** una fila sin mayorista pero con público ahora sigue hasta la búsqueda en el catálogo, así que si no está cuenta como "no encontrada" (antes se cortaba en "sin precio"). Con el Excel de prueba son 42 filas: 6.659 con el nuevo contra 6.617 con el de dos columnas. Con el Excel viejo los números son iguales a los de antes.
- **`publicoMenor`** solo cuenta productos que están en el catálogo (se evalúa después de la búsqueda), porque el aviso es para revisar precios que efectivamente se escriben.
- En el filtro de canal se usa `Object.prototype.hasOwnProperty.call` en vez de `Object.hasOwn` para no depender de la versión de Node en Render.

## Desvíos respecto al brief

- **Texto de ayuda de la pantalla:** no se cambió. El subtítulo actual ("Subí el Excel con los precios actualizados…") no dice qué columnas tiene que tener el Excel, y el brief pedía cambiarlo solo en ese caso. Si querés el texto nuevo igual, es una línea.
- **Verificación del actualizador:** además de los 3 productos que pedía el brief, se compararon los 1.101 productos de staging contra lo que se espera del Excel (con un script de solo lectura fuera del repo).
- **Excel de casos:** se probó además con un Excel chico armado a mano (fuera del repo) para cubrir "solo público", "solo mayorista", "público menor" y "ninguno". Después se volvió a correr el Excel completo para dejar staging como estaba.

## Pendientes / problemas

- **`idSistema` duplicado en staging (viene de antes, no es de este cambio):** 1932 y 5541 tienen dos docs `producto` cada uno. El actualizador se queda con uno por id (`mapaProductos`), así que el otro no se actualiza nunca. Uno de ellos tiene `precio = 6164345`, que es claramente un dato roto:
  - 1932: `00e9a0be-0485-4536-81fc-25d66d8a2711` (precio 6164345, sin actualizar) y `4361a2a5-c773-4e75-b384-75060e351c29` (sí se actualiza).
  - 5541: `8ca0c9a3-6cc5-420b-8416-fc5b368dc3c7` (precio 3379, sin actualizar) y `e767d823-4409-46f5-aaba-1cfe98461be7` (sí se actualiza).
  - Conviene revisar si pasa lo mismo en production y limpiar los duplicados (otro brief).
- Con el Excel de ejemplo real no hubo ningún producto con público menor al mayorista ni sin `Final`. Esos caminos se probaron con el Excel de casos.
- Con el Excel de dos columnas, las listas muestran `[id] —` porque ese archivo no trae `Producto`. Es el comportamiento de siempre.
- Merge a `main` (= deploy en Render): queda para después de la revisión, con confirmación de Santiago. No hacerlo el jueves ~17 h, y verificar en el dashboard de Render que el deploy coincida con el commit.

## Cómo probarlo

Levantar contra staging: `SANITY_DATASET=staging node index.js` (dotenv no pisa la variable del shell, así que el dataset efectivo es `staging`).

### Línea base
Antes de los cambios, con el `index.js` viejo levantado contra staging, se guardaron `/pedidos` y `/productos/mas-vendidos` con `desde=2020-01-01&hasta=2030-12-31`: 982 pedidos y 829 filas de ranking.

### Pedidos (curl a localhost:3001)

| Caso | Resultado |
|---|---|
| Sin `canal` (`idPedido=test-nanoya05-sincanal`) | 200; doc con `canal: "mayorista"` |
| `canal: "minorista"`, `envio: "uber"` (`test-nanoya05-minorista`) | 200; doc con `canal: "minorista"`, `envio: "uber"` |
| `canal: "cualquiera"` | 400 `{"error":"canal inválido"}`, log `[pedido] rechazado canal inválido` |
| Mismo `idPedido` que el minorista otra vez | 200 con el mismo `pedidoId`; log `[pedido] ya existía (reintento)`; no hay doc duplicado |
| `canal: "mayorista"` explícito (`test-nanoya05-mayorista`) | 200; doc con `canal: "mayorista"` |

`GET /pedido/:id` devuelve `canal` (`mayorista` / `minorista`).

Lecturas con los 3 pedidos de prueba cargados (rango 2020-01-01 → 2030-12-31):

| Consulta | `/pedidos` | `/productos/mas-vendidos` |
|---|---|---|
| sin `canal` | 200, 985 (984 mayorista + 1 minorista) | 200, totalPedidos 985 |
| `canal=todos` | 200, 985 | 200, 985 |
| `canal=mayorista` | 200, 984 (incluye los 982 viejos sin campo `canal`) | 200, 984 |
| `canal=minorista` | 200, 1 | 200, 1 |
| `canal=xx` | 400 `canal inválido` | 400 `canal inválido` |
| `canal=minorista&canal=mayorista` | 400 | 400 |

**Pedidos de prueba borrados de staging:** `pedido-test-nanoya05-sincanal`, `pedido-test-nanoya05-minorista`, `pedido-test-nanoya05-mayorista` (después del borrado, `count` = 0).

Después de borrarlos, la respuesta **sin `canal`** comparada con la línea base: `/pedidos` es idéntica (una vez sacado el campo `canal` agregado, que en los 982 vale `"mayorista"`) y `/productos/mas-vendidos` es idéntica byte a byte.

### Actualizador

Excel de ejemplo: `listado_productos - 2026-10-30T160225.829.xlsx` (Descargas, fuera del repo, no commiteado). Hoja `precios`, 7.758 filas, con los 11 encabezados del brief. Staging tiene 1.101 productos, ninguno tenía `precioMinorista` antes.

**Excel nuevo** (~27 s, 11 lotes de 100, sin rate limit):
```
actualizados: 1098, noEncontrados: 6659, sinPrecio: 42, errores: 0,
noEncontradosList: [6659], sinPrecioList: [42],
conColumnaFinal: true, sinPrecioMinorista: 0, sinPrecioMinoristaList: [],
publicoMenor: 0, publicoMenorList: []
```
- Verificación completa: 1.099 / 1.101 productos de staging coinciden con lo esperado. Los 2 que no coinciden son los duplicados de `idSistema` de "Pendientes". El restante (`55464646888 Bolson maquillaje`) no está en el Excel y no se tocó.
- 3 productos verificados en staging (`precio` = `MAYORISTA (FINAL)` redondeado, `precioMinorista` = `Final` redondeado):
  - `[4485] TOA HUMEDAS UPA LALA X 100U`: Excel 1898.006 / 2480 → staging `precio 1898`, `precioMinorista 2480`
  - `[608] CIEL MAGIC DESODORANTE AEROSOL 186 ML.`: Excel 4520.6896 / 5510 → `precio 4521`, `precioMinorista 5510`
  - `[1266] Chupete Anatómico de Silicona Minnie Medium COD 9005`: Excel 4123.6543 / 5030 → `precio 4124`, `precioMinorista 5030`

**Excel de dos columnas** (`id`, `MAYORISTA (FINAL)`, generado desde el mismo archivo en una carpeta temporal fuera del repo, 7.757 filas):
```
actualizados: 1098, noEncontrados: 6617, sinPrecio: 42, errores: 0,
conColumnaFinal: false, sinPrecioMinorista: 0, publicoMenor: 0
```
`precioMinorista` no cambió en ningún producto (se comparó contra el estado posterior al Excel nuevo). La pantalla muestra la línea gris de "no trae la columna Final".

**Excel de casos** (4 filas armadas a mano):
```
actualizados: 3, sinPrecio: 2 ([608] solo público, [4485999] ninguno),
sinPrecioMinorista: 2 ([1266] solo mayorista, [4485999] ninguno),
publicoMenor: 1 ([4485] … — público $1000 / mayorista $1898)
```
El 608 recibió solo `precioMinorista` (su `precio` quedó en 4521), el 1266 solo `precio` (su `precioMinorista` quedó en 5030) y la fila sin ningún precio se salteó. Después se volvió a correr el Excel completo y staging quedó igual que después de la primera pasada (4485 con `precioMinorista = 2480` otra vez).

**Pantalla:** se probó con Chrome headless subiendo los Excel desde `http://localhost:3001/`. Se ven las stats nuevas, los colores, las listas y la línea gris.

## Producción (brief 05b, 2026-11-24)

### Frenos chequeados (16:24, martes — no es jueves ~17 h)
1. `origin/feature/nanoya-server` existe; último commit `1d89e0d feat(nanoya): canal en pedidos y actualizador con precio al público`. ✅
2. `git diff --stat origin/main...origin/feature/nanoya-server`: solo `docs/avances/nanoya-05-server.md`, `index.js`, `public/index.html`. ✅
3. `git diff --stat origin/develop origin/main`: vacío (y sin commits de diferencia en ninguno de los dos sentidos). ✅
4. `node --check index.js` en `feature/nanoya-server`: OK. ✅
5. `gh auth status`: sesión activa; `main` sin protección de rama, permiso ADMIN. ✅

### Desvío: la URL del server en producción
La URL del brief y de `CLAUDE.md` (`https://nano-server-h25x.onrender.com`) **ya no existe**: responde 404 en todas las rutas (incluida `/`) con el header `x-render-routing: no-server`, o sea que Render no tiene ningún servicio en ese hostname. La instancia real es **`https://nano-server-avac.onrender.com`**: es la que usa nano-web en `main` (`SERVER_URL` con fallback, commit `50200eb` "fallback a nueva instancia Render"). Antes de mergear confirmé que `avac` sirve exactamente el `public/index.html` de `origin/main` (comparación byte a byte). Todas las verificaciones de abajo son contra `avac`.

### Línea base (antes del merge, 16:25)
- `/pedidos?desde=2026-11-24&hasta=2026-11-24` → 200, 1 pedido, ninguno con `canal`.
- `/pedidos?desde=2026-11-22&hasta=2026-11-24` → 200, 12 pedidos, ninguno con `canal`.
- `...&canal=xx` → 200 (el código viejo ignora el parámetro).

### PRs y merge
- PR #3 `feature/nanoya-server` → `develop`, merge común → `30a5477`.
- PR #4 `develop` → `main`, merge común → **`39fd782`** (`39fd782381e66b1422c956b39a59fd29a797d878`), 16:26:21.

### Deploy de Render: NO se deployó
Sondeo cada 1 minuto, de 16:26 a 16:36 (11 intentos), con `/pedidos?desde=2026-11-22&hasta=2026-11-24`: **siempre 200, 12 pedidos, ninguno con `canal`**. A los 16:36:
- `...&canal=xx` → **200** (tendría que dar 400 `canal inválido`): sigue el código viejo.
- `...&canal=mayorista` → 200.
- El `/` en vivo sigue siendo el `index.html` de antes del merge.

El server nunca dejó de responder 200, así que **no se revirtió** (según el brief, sin revert ni reintento). `main` y `develop` quedan en `39fd782` / `30a5477` con el cambio mergeado, pero en Render sigue corriendo el commit anterior.

**Acción para Santiago:** entrar al dashboard de Render, al servicio **`nano-server-avac`**, y hacer "Manual Deploy" del último commit de `main` (`39fd782`). Después, verificar:
- `/pedidos?desde=…&hasta=…` → 200 y los pedidos traen `"canal"`;
- `...&canal=xx` → 400 `canal inválido`;
- `...&canal=mayorista` → 200.

### Chequeo de `idSistema` duplicados en production (solo lectura)
`node -e` con `@sanity/client`, `dataset: 'production'` fijo y solo `client.fetch`: `*[_type == "producto" && defined(idSistema)]{ _id, idSistema, nombre, precio, enStock }`. 1.341 docs (136 de ellos `drafts.`), 1.338 `idSistema` distintos, **3 repetidos** (ninguno es un par draft/publicado):

| idSistema | `_id` | nombre | precio | enStock |
|---|---|---|---|---|
| 1932 | `00e9a0be-0485-4536-81fc-25d66d8a2711` | AC PLUSBELLE KIDS 700ML FUERZA NATURAL | 6164345 | false |
| 1932 | `4361a2a5-c773-4e75-b384-75060e351c29` | AC PLUSBELLE KIDS 700ML FUERZA NATURAL | 7559 | true |
| 5162 | `7e950338-1b6c-4847-948c-05a2c1bcdc3e` | ORAL B KIDS MICKEY X2 EXTRA SUAVE | 5197 | false |
| 5162 | `e849bdae-3149-4408-ab66-119977774e40` | ORAL B X2 LIMPIEZA PROFUNDA SUAVE | 6939 | false |
| 5541 | `8ca0c9a3-6cc5-420b-8416-fc5b368dc3c7` | CAROCUORE CUORE DESODORANTE 123ML | 3379 | true |
| 5541 | `e767d823-4409-46f5-aaba-1cfe98461be7` | CARO CUORE AMORE DESODORANTE 123ML | 4241 | true |

Notas: en 1932, uno de los docs tiene precio 6.164.345 (parece un dato corrupto; está sin stock). En 5162 y 5541 son **productos distintos** con el mismo `idSistema`, no copias del mismo producto. No se borró ni editó nada; la limpieza va en otro brief.

### Pendientes
- Manual Deploy en Render (arriba). Hasta que se haga, producción no tiene `canal` ni el actualizador nuevo.
- `CLAUDE.md` sigue con la URL vieja `nano-server-h25x`; conviene corregirla a `nano-server-avac` (no se tocó, queda fuera del alcance de este brief).
