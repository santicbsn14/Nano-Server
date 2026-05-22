// migrar-categorias.js
import { createClient } from '@sanity/client'
import 'dotenv/config'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  useCdn: false,
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
})

async function migrar() {
  // ── 1. Traer todas las categorías y armar mapa slug → _id ──
  console.log('Trayendo categorías...')
  const categorias = await client.fetch(
    `*[_type == "categoria"]{ _id, "slug": slug.current }`
  )

  if (categorias.length === 0) {
    console.error('❌ No se encontraron categorías. ¿Las creaste en el Studio?')
    process.exit(1)
  }

  const mapaCategorias = {}
  for (const cat of categorias) {
    mapaCategorias[cat.slug] = cat._id
  }

  console.log(`✅ ${categorias.length} categorías cargadas:`)
  console.log(mapaCategorias)

  // ── 2. Traer todos los productos con su categoría actual (string) ──
  console.log('\nTrayendo productos...')
  const productos = await client.fetch(
    `*[_type == "producto"]{ _id, nombre, categoria }`
  )
  console.log(`✅ ${productos.length} productos encontrados`)

  // ── 3. Clasificar productos ──
  const aMigrar = []
  const sinCategoria = []
  const categoriaNoEncontrada = []

  for (const producto of productos) {
    const catActual = producto.categoria

    // Ya es una referencia (migrado previamente), saltear
    if (catActual && typeof catActual === 'object' && catActual._ref) {
      continue
    }

    if (!catActual) {
      sinCategoria.push(producto)
      continue
    }

    const categoriaId = mapaCategorias[catActual]
    if (!categoriaId) {
      categoriaNoEncontrada.push({ ...producto, categoriaString: catActual })
      continue
    }

    aMigrar.push({ _id: producto._id, categoriaId })
  }

  // ── 4. Reporte antes de migrar ──
  console.log(`\n📋 Resumen previo:`)
  console.log(`   A migrar:               ${aMigrar.length}`)
  console.log(`   Sin categoría:          ${sinCategoria.length}`)
  console.log(`   Categoría no mapeada:   ${categoriaNoEncontrada.length}`)

  if (categoriaNoEncontrada.length > 0) {
    console.log('\n⚠️  Productos con categoría no mapeada (revisar slugs):')
    for (const p of categoriaNoEncontrada) {
      console.log(`   [${p._id}] ${p.nombre} → "${p.categoriaString}"`)
    }
  }

  if (aMigrar.length === 0) {
    console.log('\n✅ Nada para migrar. Todo ya está actualizado.')
    return
  }

  // ── 5. Parchear en lotes de 50 ──
  const LOTE = 50
  let migrados = 0
  let errores = 0

  console.log(`\nMigrando ${aMigrar.length} productos en lotes de ${LOTE}...`)

  for (let i = 0; i < aMigrar.length; i += LOTE) {
    const lote = aMigrar.slice(i, i + LOTE)
    try {
      await Promise.all(
        lote.map((p) =>
          client.patch(p._id).set({
            categoria: {
              _type: 'reference',
              _ref: p.categoriaId,
            },
          }).commit()
        )
      )
      migrados += lote.length
      console.log(`   Lote ${Math.floor(i / LOTE) + 1} OK — ${migrados}/${aMigrar.length}`)
    } catch (err) {
      errores += lote.length
      console.error(`   ❌ Error en lote ${Math.floor(i / LOTE) + 1}:`, err.message)
    }
  }

  // ── 6. Resultado final ──
  console.log('\n══════════════════════════════')
  console.log(`✅ Migrados:  ${migrados}`)
  console.log(`❌ Errores:   ${errores}`)
  if (sinCategoria.length > 0)
    console.log(`⚠️  Sin cat:   ${sinCategoria.length} (quedan sin tocar)`)
  if (categoriaNoEncontrada.length > 0)
    console.log(`⚠️  No mapeados: ${categoriaNoEncontrada.length} (quedan sin tocar)`)
  console.log('══════════════════════════════')
}

migrar().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})