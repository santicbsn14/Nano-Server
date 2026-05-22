// verificar-migracion.js
import { createClient } from '@sanity/client'
import 'dotenv/config'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  useCdn: false,
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
})

// 1. Productos SIN categoría asignada
const sinCategoria = await client.fetch(
  `*[_type == "producto" && !defined(categoria)]{ _id, nombre }`
)

// 2. Productos que aún tienen categoría como string (no referencia)
const comoString = await client.fetch(
  `*[_type == "producto" && string::startsWith(categoria, "")]{ _id, nombre, categoria }`
)

// 3. Productos apuntando a drafts
const apuntanDraft = await client.fetch(
  `*[_type == "producto" && string::startsWith(categoria._ref, "drafts.")]{ _id, nombre, "ref": categoria._ref }`
)

// 4. Total de productos migrados correctamente
const migrados = await client.fetch(
  `count(*[_type == "producto" && defined(categoria._ref) && !string::startsWith(categoria._ref, "drafts.")])`
)

// 5. Total general
const total = await client.fetch(`count(*[_type == "producto"])`)

console.log('══════════════════════════════════════')
console.log(`Total productos:        ${total}`)
console.log(`Migrados correctamente: ${migrados}`)
console.log(`Sin categoría:          ${sinCategoria.length}`)
console.log(`Apuntando a draft:      ${apuntanDraft.length}`)
console.log('══════════════════════════════════════')

if (apuntanDraft.length > 0) {
  console.log('\n⚠️  Productos apuntando a drafts:')
  apuntanDraft.forEach(p => console.log(`  - ${p.nombre} → ${p.ref}`))
}

if (sinCategoria.length > 0) {
  console.log('\n⚠️  Productos sin categoría:')
  sinCategoria.forEach(p => console.log(`  - ${p.nombre} (${p._id})`))
}

if (migrados === total) {
  console.log('\n✅ Etapa 2 completada. Todos los productos están migrados.')
} else {
  console.log(`\n⚠️  Faltan ${total - migrados} productos por migrar.`)
}