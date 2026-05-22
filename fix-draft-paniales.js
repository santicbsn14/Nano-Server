// fix-draft-paniales.js
import { createClient } from '@sanity/client'
import 'dotenv/config'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  useCdn: false,
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
})

// Buscar todos los productos que referencian el draft
const productos = await client.fetch(
  `*[_type == "producto" && categoria._ref == "drafts.a2f70853-8613-4df6-ae29-b6066c8bc174"]{ _id, nombre }`
)

console.log(`Productos apuntando al draft: ${productos.length}`)
productos.forEach(p => console.log(`  - ${p.nombre} (${p._id})`))

if (productos.length > 0) {
  await Promise.all(
    productos.map(p =>
      client.patch(p._id).set({
        categoria: {
          _type: 'reference',
          _ref: 'a2f70853-8613-4df6-ae29-b6066c8bc174', // sin el prefijo drafts.
        }
      }).commit()
    )
  )
  console.log('✅ Productos actualizados al ID publicado')
}