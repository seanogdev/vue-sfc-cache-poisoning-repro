import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as compiler from 'vue/compiler-sfc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname)

// Regression test for https://github.com/vitest-dev/vitest/issues/9855
//
// Root cause: three interacting bugs in @vue/compiler-sfc and @vitejs/plugin-vue:
//
// 1. compiler.parse() returns cached descriptor objects via an LRU(500) cache —
//    the same mutable object is shared across all Vite servers in the process.
//
// 2. compileTemplate() mutates descriptor.template.ast in place — v-if elements
//    (type=1) become IfNodes (type=9).
//
// 3. templateAnalysisCache is a separate LRU(500). When evicted,
//    resolveTemplateAnalysisResult() re-walks the MUTATED AST. The walker only
//    handles type=1 (ELEMENT), so components inside v-if/v-for are missed →
//    excluded from __returned__ → undefined at runtime.

describe('vue sfc cache poisoning across vite servers', () => {
  it('compileTemplate mutates shared AST, causing compileScript to miss v-if components', () => {
    const targetSource = readFileSync(resolve(root, 'src/Target.vue'), 'utf-8')
    const { descriptor } = compiler.parse(targetSource, { filename: 'Target.vue' })
    const ast = descriptor.template!.ast!

    // Original AST: ChildA and ChildB are ELEMENT nodes (type=1)
    const divNode = ast.children.find((c: any) => c.type === 1) as any
    expect(divNode.children.every((c: any) => c.type === 1)).toBe(true)

    // SSR compileTemplate MUTATES the AST: v-if elements become IfNodes (type=9)
    compiler.compileTemplate({
      source: descriptor.template!.content,
      ast: descriptor.template!.ast,
      filename: 'Target.vue',
      id: 'data-v-test',
      ssr: true,
      compilerOptions: { prefixIdentifiers: true },
    })

    expect(divNode.children.every((c: any) => c.type === 9)).toBe(true)

    // Client compileScript on the MUTATED descriptor misses ChildA/ChildB
    const clientScript = compiler.compileScript(descriptor, {
      id: 'data-v-test',
      inlineTemplate: false,
      templateOptions: { compilerOptions: { prefixIdentifiers: true } },
    })

    const returnMatch = clientScript.content.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''
    expect(returnedContent).not.toContain('ChildA')
    expect(returnedContent).not.toContain('ChildB')
  })

  it('redundant SSR transforms across servers cause cache desync (the vitest bug)', async () => {
    // Simulates what getTestDependencies does WITHOUT the transformCache fix.
    // Two Vite servers share compiler-sfc's module-level caches.
    // The redundant SSR transform on server2 refreshes parseCache but NOT
    // templateAnalysisCache, causing them to desync after LRU eviction.

    const server1 = await createServer({
      root,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server1.close())

    const server2 = await createServer({
      root,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server2.close())

    // Step 1: Server 1 SSR-transforms Target.vue
    // Populates parseCache, templateAnalysisCache, ssrCache WeakMap
    // compileTemplate mutates the AST
    await server1.environments.ssr.transformRequest('/src/Target.vue')

    // Step 2: First batch of fillers — start filling LRU caches
    for (let i = 1; i <= 250; i++) {
      const padded = String(i).padStart(3, '0')
      await server1.environments.ssr.transformRequest(`/src/fillers/Filler${padded}.vue`)
    }

    // Step 3: Server 2 SSR-transforms Target.vue
    // parseCache HIT → refreshed (keeps Target.vue alive)
    // ssrCache WeakMap HIT → compileScript skipped → templateAnalysisCache NOT refreshed
    await server2.environments.ssr.transformRequest('/src/Target.vue')

    // Step 4: Remaining fillers evict templateAnalysisCache for Target.vue
    // parseCache still retains it (only ~260 entries since step 3 < 500)
    for (let i = 251; i <= 510; i++) {
      const padded = String(i).padStart(3, '0')
      await server1.environments.ssr.transformRequest(`/src/fillers/Filler${padded}.vue`)
    }

    // Step 5: Server 2 client-transforms Target.vue
    // parseCache HIT → returns MUTATED descriptor
    // clientCache MISS → compileScript → templateAnalysisCache MISS (evicted)
    // → re-walks mutated AST → misses ChildA/ChildB inside IfNodes
    const clientResult = await server2.transformRequest('/src/Target.vue')
    expect(clientResult).toBeTruthy()

    const returnMatch = clientResult!.code.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''
    expect(returnedContent).not.toContain('ChildA')
    expect(returnedContent).not.toContain('ChildB')
  })

  it('deduplicating SSR transforms prevents the bug (the transformCache fix)', async () => {
    // Same setup but server 2 SKIPS the redundant SSR transform for Target.vue.
    // This simulates vitest's transformCache: when project B encounters a file
    // already transformed by project A, it reuses the cached dep list and skips
    // transformRequest entirely. Without the redundant parse() call, both caches
    // evict together → client transform gets a fresh descriptor with clean AST.

    const server1 = await createServer({
      root,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server1.close())

    const server2 = await createServer({
      root,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server2.close())

    // Step 1: Server 1 SSR-transforms Target.vue (same as bug test)
    await server1.environments.ssr.transformRequest('/src/Target.vue')

    // Step 2: ALL 510 fillers on server1 — no server2 SSR transform for Target.vue!
    // Both parseCache and templateAnalysisCache evict Target.vue together
    // (no desync since parseCache wasn't refreshed by a redundant server2 transform)
    for (let i = 1; i <= 510; i++) {
      const padded = String(i).padStart(3, '0')
      await server1.environments.ssr.transformRequest(`/src/fillers/Filler${padded}.vue`)
    }

    // Step 3: Server 2 client-transforms Target.vue
    // Both caches MISS → fresh descriptor with clean AST → correct analysis
    const clientResult = await server2.transformRequest('/src/Target.vue')
    expect(clientResult).toBeTruthy()

    const returnMatch = clientResult!.code.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''
    expect(returnedContent).toContain('ChildA')
    expect(returnedContent).toContain('ChildB')
  })
})
