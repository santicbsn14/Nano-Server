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
  const limpio = String(valor).replace(/\./g, '').replace(',', '.')
  const numero = parseFloat(limpio)
  return isNaN(numero) ? null : numero
}

// ── Endpoint: guardar pedido ───────────────────────────────────────
app.post('/pedido', async (req, res) => {
  const { nombre, ciudad, direccion,fecha_retiro,turno, envio, aclaracion, items, total } = req.body

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
      fecha_retiro,
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

// ── Endpoint: actualizar precios ───────────────────────────────────
app.post('/actualizar', upload.single('excel'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo.' })
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const hoja = workbook.Sheets[workbook.SheetNames[0]]
    const filas = xlsx.utils.sheet_to_json(hoja)

    let actualizados = 0
    let noEncontrados = 0
    let sinPrecio = 0
    let errores = 0
    const noEncontradosList = []

    for (const fila of filas) {
      const idSistema = String(fila['id']).trim()
      const precioRaw = fila['MAYORISTA (FINAL)']
      const nombreProducto = fila['Producto']?.trim() ?? '—'

      if (!idSistema || idSistema === 'undefined') continue

      const precio = limpiarPrecio(precioRaw)
      if (precio === null) {
        sinPrecio++
        continue
      }

      let producto
      try {
        const idNum = Number(idSistema)
        producto = await client.fetch(
          `*[_type == "producto" && idSistema == $idSistema][0]{ _id, nombre }`,
          { idSistema: idNum }
        )
      } catch (err) {
        errores++
        continue
      }

      if (!producto) {
        noEncontradosList.push(`[${idSistema}] ${nombreProducto}`)
        noEncontrados++
        continue
      }

      try {
        await client.patch(producto._id).set({ precio }).commit()
        actualizados++
      } catch (err) {
        errores++
      }
    }

    res.json({
      ok: true,
      resumen: { actualizados, noEncontrados, sinPrecio, errores, noEncontradosList },
    })
  } catch (err) {
    res.status(500).json({ error: `Error procesando el archivo: ${err.message}` })
  }
})

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
