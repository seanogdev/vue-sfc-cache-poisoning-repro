import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as compiler from 'vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname)

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.log(`  ❌ ${message}`); failed++ }
}

// ── Test 1: compileTemplate mutates the AST, compileScript misses v-if components ──

console.log('\nTest 1: compileTemplate mutates shared AST\n')

const source = readFileSync(resolve(root, 'src/Target.vue'), 'utf-8')
const { descriptor } = compiler.parse(source, { filename: 'Target.vue' })
const ast = descriptor.template.ast
const div = ast.children.find(c => c.type === 1)

assert(
  div.children.every(c => c.type === 1),
  'Before: ChildA and ChildB are ELEMENT nodes (type=1)'
)

compiler.compileTemplate({
  source: descriptor.template.content,
  ast: descriptor.template.ast,
  filename: 'Target.vue',
  id: 'data-v-test',
  ssr: true,
  compilerOptions: { prefixIdentifiers: true },
})

assert(
  div.children.every(c => c.type === 9),
  'After SSR compileTemplate: ChildA and ChildB are IfNodes (type=9)'
)

const script = compiler.compileScript(descriptor, {
  id: 'data-v-test',
  inlineTemplate: false,
  templateOptions: { compilerOptions: { prefixIdentifiers: true } },
})

const returned = script.content.match(/__returned__\s*=\s*\{([^}]*)\}/)?.[1] || ''

assert(
  !returned.includes('ChildA') && !returned.includes('ChildB'),
  `__returned__ = {${returned.trim()}} — ChildA and ChildB missing`
)

// ── Test 2: two Vite servers + LRU overflow reproduces the desync ──

console.log('\nTest 2: Vite server pipeline with LRU eviction\n')

const server1 = await createServer({
  root, configFile: false, plugins: [vue()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true }, logLevel: 'silent',
})

const server2 = await createServer({
  root, configFile: false, plugins: [vue()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true }, logLevel: 'silent',
})

// Server 1 SSR-transforms Target.vue (populates caches, mutates AST)
await server1.environments.ssr.transformRequest('/src/Target.vue')

// First batch of fillers
for (let i = 1; i <= 250; i++) {
  await server1.environments.ssr.transformRequest(`/src/fillers/Filler${String(i).padStart(3, '0')}.vue`)
}

// Server 2 SSR-transforms Target.vue
// parseCache refreshed, ssrCache HIT → templateAnalysisCache NOT refreshed
await server2.environments.ssr.transformRequest('/src/Target.vue')

// Remaining fillers → templateAnalysisCache evicts, parseCache retains
for (let i = 251; i <= 510; i++) {
  await server1.environments.ssr.transformRequest(`/src/fillers/Filler${String(i).padStart(3, '0')}.vue`)
}

// Server 2 client transform → parseCache returns mutated descriptor
const result = await server2.transformRequest('/src/Target.vue')
const code = result?.code || ''
const pipelineReturned = code.match(/__returned__\s*=\s*\{([^}]*)\}/)?.[1] || ''

assert(
  !pipelineReturned.includes('ChildA') && !pipelineReturned.includes('ChildB'),
  `__returned__ = {${pipelineReturned.trim()}} — ChildA and ChildB missing`
)

await server1.close()
await server2.close()

// ── Results ──

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nSome assertions failed — the bug may have been fixed upstream')
  process.exit(1)
}
console.log('\nBug confirmed.')
process.exit(0)
