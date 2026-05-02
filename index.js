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
  dataset: 'production',
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
  // Si ya es número, redondearlo directamente
  if (typeof valor === 'number') return Math.round(valor)
  // Si es string con formato argentino (3.093,30)
  const limpio = String(valor).replace(/\./g, '').replace(',', '.')
  const numero = parseFloat(limpio)
  return isNaN(numero) ? null : Math.round(numero)
}

// ── Endpoint: guardar pedido ───────────────────────────────────────
app.post('/pedido', async (req, res) => {
  const { nombre, ciudad, direccion, fecha_retiro, turno, envio, aclaracion, items, total } = req.body

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
      `*[_type == "pedido" && _id == $id][0]`,
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

// ── Endpoint: actualizar precios (OPTIMIZADO) ──────────────────────
app.post('/actualizar', upload.single('excel'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' })
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const hoja = workbook.Sheets[workbook.SheetNames[0]]
    const filas = xlsx.utils.sheet_to_json(hoja)

    // ── 1. Traer TODOS los productos de Sanity de una sola vez ──
    console.log('Trayendo todos los productos de Sanity...')
    const productosDB = await client.fetch(
      `*[_type == "producto"]{ _id, idSistema, nombre }`
    )

    // Crear un mapa idSistema → { _id, nombre } para búsqueda O(1)
    const mapaProductos = {}
    for (const p of productosDB) {
      if (p.idSistema != null) {
        mapaProductos[String(p.idSistema)] = { _id: p._id, nombre: p.nombre }
      }
    }
    console.log(`${productosDB.length} productos cargados en memoria`)

    // ── 2. Preparar los patches ──
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

    // ── 3. Aplicar patches en lotes de 50 ──
    const LOTE = 50
    console.log(`Aplicando ${patches.length} actualizaciones en lotes de ${LOTE}...`)

    for (let i = 0; i < patches.length; i += LOTE) {
      const lote = patches.slice(i, i + LOTE)
      try {
        await Promise.all(
          lote.map((p) => client.patch(p._id).set({ precio: p.precio }).commit())
        )
        actualizados += lote.length
        console.log(`Lote ${Math.floor(i / LOTE) + 1} completado — ${actualizados}/${patches.length}`)
      } catch (err) {
        errores += lote.length
        console.error(`Error en lote ${Math.floor(i / LOTE) + 1}:`, err.message)
      }
    }

    console.log('Actualización completada!')

    res.json({
      ok: true,
      resumen: { actualizados, noEncontrados, sinPrecio, errores, noEncontradosList, sinPrecioList,},
    })
  } catch (err) {
    res.status(500).json({ error: `Error procesando el archivo: ${err.message}` })
  }
})
// ── Endpoint: buscar productos ─────────────────────────────────
app.get('/productos/buscar', async (req, res) => {
  const { q } = req.query
  try {
    const filtro = q && q.trim()
      ? `_type == "producto" && (nombre match $q || descripcion match $q)`
      : `_type == "producto"`
    
    const productos = await client.fetch(
      `*[${filtro}] | order(nombre asc) [0...100] { _id, nombre, descripcion, talle, categoria, enStock, precio }`,
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
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})