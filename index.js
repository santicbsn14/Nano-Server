import express from 'express'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@sanity/client'
import * as xlsx from 'xlsx'
import cors from 'cors'
import 'dotenv/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = 3001

// ── CORS ────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json())

// ── Sanity ─────────────────────────────────────────────────────────
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET || 'production',
  useCdn: false,
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
})

// ── Multer ──────────────────────────────────────────────────────────
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true)
    } else {
      cb(new Error('Solo se aceptan archivos Excel (.xlsx o .xls)'))
    }
  },
})

// ── Servir la interfaz ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')))

// ── Función para limpiar precio ────────────────────────────────────
function limpiarPrecio(valor) {
  if (!valor) return null
  if (typeof valor === 'number') return Math.round(valor)
  const limpio = String(valor).replace(/\./g, '').replace(',', '.')
  const numero = parseFloat(limpio)
  return isNaN(numero) ? null : Math.round(numero)
}

// ── Endpoint: guardar pedido ───────────────────────────────────────
app.post('/pedido', async (req, res) => {
  const { nombre, telefono, ciudad, direccion, fecha_retiro, turno, envio, aclaracion, items, total } = req.body

  if (!nombre || !items || items.length === 0) {
    return res.status(400).json({ error: 'Datos del pedido incompletos.' })
  }

  try {
    const numeroPedido = Math.random().toString(36).substring(2, 10).toUpperCase()

    const pedido = await client.create({
      _type: 'pedido',
      numeroPedido,
      fecha: new Date().toISOString(),
      nombre,
      telefono: telefono ?? '',
      ciudad,
      direccion,
      fecha_retiro: fecha_retiro ?? '',
      turno,
      envio,
      aclaracion: aclaracion ?? '',
      items: items.map((i) => ({
        _key: Math.random().toString(36).substring(2, 9),
        nombre: i.nombre,
        talle: i.talle ?? '',
        tallesCombo: (i.tallesCombo ?? []).map((t) => ({
          _key: Math.random().toString(36).substring(2, 9),
          producto: t.producto,
          talle: t.talle,
        })),
        productosInternos: (i.productosInternos ?? []).map((p) => ({
          _key: Math.random().toString(36).substring(2, 9),
          nombre: p.nombre,
          descripcionCorta: p.descripcionCorta ?? '',
        })),
        presentacion: i.presentacion ?? '',
        descripcion: i.descripcion ?? '',
        precio: i.precio,
        cantidad: i.cantidad,
      })),
      total,
    })

    res.json({ ok: true, numeroPedido, pedidoId: pedido._id })
  } catch (err) {
    console.error('Error guardando pedido:', err)
    res.status(500).json({ error: 'No se pudo guardar el pedido.' })
  }
})

// ── Endpoint: obtener pedido por ID ───────────────────────────────
app.get('/pedido/:id', async (req, res) => {
  const { id } = req.params
  try {
    const pedido = await client.fetch(
      `*[_type == "pedido" && _id == $id][0]{
        _id,
        numeroPedido,
        fecha,
        nombre,
        telefono,
        ciudad,
        direccion,
        fecha_retiro,
        turno,
        envio,
        aclaracion,
        items,
        total
      }`,
      { id }
    )
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' })
    res.json(pedido)
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo el pedido.' })
  }
})

// ── Endpoint: pedidos por rango de fechas ──────────────────────
app.get('/pedidos', async (req, res) => {
  const { desde, hasta } = req.query

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan parámetros desde y hasta' })
  }

  try {
    const pedidos = await client.fetch(
      `*[_type == "pedido" && fecha >= $desde && fecha <= $hasta] | order(fecha desc) {
        _id,
        numeroPedido,
        fecha,
        nombre,
        telefono,
        ciudad,
        direccion,
        fecha_retiro,
        turno,
        envio,
        aclaracion,
        items,
        total
      }`,
      {
        desde: `${desde}T00:00:00.000Z`,
        hasta: `${hasta}T23:59:59.999Z`,
      }
    )
    res.json({ ok: true, pedidos })
  } catch (err) {
    console.error('Error obteniendo pedidos:', err)
    res.status(500).json({ error: 'Error obteniendo pedidos.' })
  }
})

// ── Helpers del actualizador: transacción por lote + reintentos ────
const MAX_INTENTOS = 5
const PAUSA_ENTRE_LOTES_MS = 300
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function commitLoteConReintentos(lote, nroLote) {
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const tx = client.transaction()
      for (const p of lote) tx.patch(p._id, { set: { precio: p.precio } })
      await tx.commit()
      return
    } catch (err) {
      const esRateLimit = err.statusCode === 429 || /rate limit/i.test(err.message ?? '')
      if (!esRateLimit || intento === MAX_INTENTOS) throw err
      const espera = 1000 * 2 ** (intento - 1) // 1s, 2s, 4s, 8s
      console.warn(`Lote ${nroLote}: rate limit, reintento ${intento}/${MAX_INTENTOS - 1} en ${espera}ms`)
      await esperar(espera)
    }
  }
}

// ── Endpoint: actualizar precios (OPTIMIZADO) ──────────────────────
app.post('/actualizar', upload.single('excel'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' })
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const hoja = workbook.Sheets[workbook.SheetNames[0]]
    const filas = xlsx.utils.sheet_to_json(hoja)

    console.log('Trayendo todos los productos de Sanity...')
    const productosDB = await client.fetch(
      `*[_type == "producto"]{ _id, idSistema, nombre }`
    )

    const mapaProductos = {}
    for (const p of productosDB) {
      if (p.idSistema != null) {
        mapaProductos[String(p.idSistema)] = { _id: p._id, nombre: p.nombre }
      }
    }
    console.log(`${productosDB.length} productos cargados en memoria`)

    let actualizados = 0
    let noEncontrados = 0
    let sinPrecio = 0
    let errores = 0
    const noEncontradosList = []
    const sinPrecioList = []
    const patches = []

    for (const fila of filas) {
      const idSistema = String(fila['id']).trim()
      const precioRaw = fila['MAYORISTA (FINAL)']
      const nombreProducto = fila['Producto']?.trim() ?? '—'

      if (!idSistema || idSistema === 'undefined') continue

      const precio = limpiarPrecio(precioRaw)
      if (precio === null) {
        sinPrecio++
        sinPrecioList.push(`[${idSistema}] ${nombreProducto}`)
        continue
      }

      const producto = mapaProductos[idSistema]
      if (!producto) {
        noEncontradosList.push(`[${idSistema}] ${nombreProducto}`)
        noEncontrados++
        continue
      }

      patches.push({ _id: producto._id, precio })
    }

    // Cada lote va en UNA transacción (1 request a Sanity), en serie y con
    // reintentos. Antes eran 50 requests en paralelo por lote → rate limit.
    const LOTE = 100
    console.log(`Aplicando ${patches.length} actualizaciones en lotes de ${LOTE}...`)

    for (let i = 0; i < patches.length; i += LOTE) {
      const lote = patches.slice(i, i + LOTE)
      const nroLote = Math.floor(i / LOTE) + 1
      try {
        await commitLoteConReintentos(lote, nroLote)
        actualizados += lote.length
        console.log(`Lote ${nroLote} completado — ${actualizados}/${patches.length}`)
      } catch (err) {
        errores += lote.length
        console.error(`Error en lote ${nroLote}:`, err.message)
      }
      await esperar(PAUSA_ENTRE_LOTES_MS)
    }

    console.log('Actualización completada!')

    res.json({
      ok: true,
      resumen: { actualizados, noEncontrados, sinPrecio, errores, noEncontradosList, sinPrecioList },
    })
  } catch (err) {
    res.status(500).json({ error: `Error procesando el archivo: ${err.message}` })
  }
})

// ── Endpoint: buscar productos ─────────────────────────────────
app.get('/productos/buscar', async (req, res) => {
  const { q, offset = 0 } = req.query
  const inicio = Number(offset)
  try {
    const filtro = q && q.trim()
      ? `_type == "producto" && (nombre match $q || descripcion match $q)`
      : `_type == "producto"`

    const productos = await client.fetch(
      `*[${filtro}] | order(nombre asc) [${inicio}...${inicio + 100}] { _id, nombre, descripcion, talle, categoria, enStock, precio }`,
      q ? { q: `*${q}*` } : {}
    )
    res.json({ ok: true, productos })
  } catch (err) {
    res.status(500).json({ error: 'Error buscando productos.' })
  }
})

// ── Endpoint: actualizar stock ─────────────────────────────────
app.patch('/producto/:id/stock', async (req, res) => {
  const { id } = req.params
  const { enStock } = req.body
  try {
    await client.patch(id).set({ enStock }).commit()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando stock.' })
  }
})

// ── Endpoint: login ────────────────────────────────────────────────
app.post('/login', (req, res) => {
  const { clave } = req.body
  if (clave === process.env.ADMIN_PASSWORD) {
    res.json({ ok: true })
  } else {
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta' })
  }
})

// ── Endpoint: productos más vendidos por rango de fechas ───────────
app.get('/productos/mas-vendidos', async (req, res) => {
  const { desde, hasta } = req.query

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan parámetros desde y hasta' })
  }

  try {
    // Traemos nombre, talle, cantidad y precio de cada item
    const pedidos = await client.fetch(
      `*[_type == "pedido" && fecha >= $desde && fecha <= $hasta]{
        "items": items[]{ nombre, talle, cantidad, precio }
      }`,
      {
        desde: `${desde}T00:00:00.000Z`,
        hasta: `${hasta}T23:59:59.999Z`,
      }
    )

    // Agrupar por nombre + talle — el frontend decide si colapsar por nombre
    const mapa = new Map()
    for (const pedido of pedidos) {
      for (const item of (pedido.items ?? [])) {
        const nombre = item.nombre?.trim() ?? '—'
        const talle = item.talle?.trim() ?? ''
        const key = `${nombre}__${talle}`

        if (mapa.has(key)) {
          const existente = mapa.get(key)
          existente.unidades += item.cantidad ?? 0
          existente.total += (item.precio ?? 0) * (item.cantidad ?? 0)
          existente.apariciones += 1
        } else {
          mapa.set(key, {
            nombre,
            talle,
            unidades: item.cantidad ?? 0,
            total: (item.precio ?? 0) * (item.cantidad ?? 0),
            apariciones: 1,
          })
        }
      }
    }

    // Devolver siempre desglosado por talle — el frontend agrupa si hace falta
    const ranking = Array.from(mapa.values())
      .sort((a, b) => b.unidades - a.unidades)

    res.json({ ok: true, ranking, totalPedidos: pedidos.length })
  } catch (err) {
    console.error('Error calculando más vendidos:', err)
    res.status(500).json({ error: 'Error calculando más vendidos.' })
  }
})

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})