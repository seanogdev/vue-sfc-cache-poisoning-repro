import { resolve } from 'pathe'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as compiler from 'vue/compiler-sfc'
import { readFileSync } from 'node:fs'

/**
 * Reproduction for Vue SFC cache poisoning bug
 * https://github.com/vitest-dev/vitest/issues/9855
 *
 * Root cause: three interacting bugs in @vue/compiler-sfc and @vitejs/plugin-vue.
 *
 * 1. compiler.parse() returns cached descriptor objects via an LRU(500) cache.
 *    The same mutable object is shared across all Vite servers in the process.
 *
 * 2. compileTemplate() mutates descriptor.template.ast in place. v-if elements
 *    (type=1) become IfNodes (type=9), and expression contents get $setup./$props.
 *    prefixes.
 *
 * 3. templateAnalysisCache in compiler-sfc is a separate LRU(500) keyed by
 *    template content string. When evicted, resolveTemplateAnalysisResult()
 *    re-walks the MUTATED AST. The walker only recurses into type=1 (ELEMENT)
 *    nodes, so it misses components inside v-if/v-for (now type=9/type=11).
 *    This causes compileScript to exclude them from __returned__.
 *
 * The parse cache and templateAnalysisCache desync because:
 * - plugin-vue's resolveScript() checks a WeakMap cache (ssrCache) first
 * - On a WeakMap HIT, compileScript is skipped, so templateAnalysisCache is NOT refreshed
 * - But createDescriptor() always calls compiler.parse(), so parseCache IS refreshed
 * - Result: parseCache retains the mutated descriptor while templateAnalysisCache evicts
 *
 * In vitest, `getTestDependencies` does SSR transforms for ALL projects via
 * `Promise.all`. With 500+ .vue files across multiple project dependency graphs,
 * the LRU evicts the target component's analysis while the parse cache retains
 * the mutated descriptor. The subsequent client compileScript produces broken __returned__.
 */
describe('vue sfc cache poisoning across vite servers', () => {
  const fixtureRoot = resolve(import.meta.dirname, '.')

  it('compileTemplate mutates shared AST, causing compileScript to miss v-if components', () => {
    // Proves the core mechanism: SSR compileTemplate mutates the AST, then
    // client compileScript on the same descriptor misses v-if'd components.
    const targetSource = readFileSync(resolve(fixtureRoot, 'src/Target.vue'), 'utf-8')

    const { descriptor } = compiler.parse(targetSource, { filename: 'Target.vue' })
    const ast = descriptor.template!.ast!

    // Before: ChildA and ChildB are ELEMENT nodes (type=1)
    const divNode = ast.children.find((c: any) => c.type === 1) as any
    expect(divNode.children.map((c: any) => c.type)).toEqual([1, 1])
    expect(divNode.children.map((c: any) => c.tag)).toEqual(['ChildA', 'ChildB'])

    // SSR compileTemplate MUTATES the AST: v-if elements become IfNodes (type=9)
    compiler.compileTemplate({
      source: descriptor.template!.content,
      ast: descriptor.template!.ast,
      filename: 'Target.vue',
      id: 'data-v-test',
      ssr: true,
      compilerOptions: { prefixIdentifiers: true },
    })

    // AST is now mutated
    expect((ast as any).transformed).toBe(true)
    expect(divNode.children.map((c: any) => c.type)).toEqual([9, 9])

    // Client compileScript on the MUTATED descriptor misses ChildA and ChildB
    const clientScript = compiler.compileScript(descriptor, {
      id: 'data-v-test',
      inlineTemplate: false,
      templateOptions: { compilerOptions: { prefixIdentifiers: true } },
    })

    // BUG: __returned__ = { meta, props } — ChildA and ChildB are MISSING
    const returnMatch = clientScript.content.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''
    expect(returnedContent).not.toContain('ChildA')
    expect(returnedContent).not.toContain('ChildB')
    expect(returnedContent).toContain('meta')
    expect(returnedContent).toContain('props')
  })

  it('full pipeline: SSR transform + LRU eviction + client transform via Vite servers', async () => {
    // Reproduces the desync between parseCache and templateAnalysisCache
    // using actual Vite servers — the same code path as vitest's getTestDependencies.
    const server1 = await createServer({
      root: fixtureRoot,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server1.close())

    const server2 = await createServer({
      root: fixtureRoot,
      configFile: false,
      plugins: [vue()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    })
    onTestFinished(() => server2.close())

    // Step 1: Server 1 SSR-transforms Target.vue
    // Populates parseCache + templateAnalysisCache + ssrCache WeakMap.
    // compileTemplate then mutates descriptor.template.ast.
    await server1.environments.ssr.transformRequest('/src/Target.vue')

    // Step 2: First batch of fillers — start filling the LRU caches
    for (let i = 1; i <= 250; i++) {
      const padded = String(i).padStart(3, '0')
      await server1.environments.ssr.transformRequest(`/src/fillers/Filler${padded}.vue`)
    }

    // Step 3: Server 2 SSR-transforms Target.vue
    // parseCache HIT (refreshes entry). ssrCache WeakMap HIT from step 1,
    // so compileScript is skipped and templateAnalysisCache is NOT refreshed.
    await server2.environments.ssr.transformRequest('/src/Target.vue')

    // Step 4: Remaining fillers — evicts templateAnalysisCache but not parseCache
    // (Target.vue's parseCache was refreshed in step 3, only ~260 entries ago)
    for (let i = 251; i <= 510; i++) {
      const padded = String(i).padStart(3, '0')
      await server1.environments.ssr.transformRequest(`/src/fillers/Filler${padded}.vue`)
    }

    // Step 5: Server 2 client-transforms Target.vue
    // parseCache HIT returns the mutated descriptor. clientCache MISS triggers
    // compileScript. templateAnalysisCache MISS (evicted in step 4) causes
    // re-walk of the mutated AST. IfNodes (type=9) are skipped by the walker.
    const clientResult = await server2.transformRequest('/src/Target.vue')
    expect(clientResult).toBeTruthy()
    const code = clientResult!.code

    const returnMatch = code.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''

    // BUG: ChildA and ChildB are missing from __returned__
    expect(returnedContent).not.toContain('ChildA')
    expect(returnedContent).not.toContain('ChildB')
  })

  it('works correctly without AST mutation (control)', () => {
    // Different template content to avoid templateAnalysisCache contamination
    const targetSource = readFileSync(resolve(fixtureRoot, 'src/TargetControl.vue'), 'utf-8')
    const { descriptor } = compiler.parse(targetSource, { filename: 'TargetControl.vue' })

    const clientScript = compiler.compileScript(descriptor, {
      id: 'data-v-control',
      inlineTemplate: false,
      templateOptions: { compilerOptions: { prefixIdentifiers: true } },
    })

    const returnMatch = clientScript.content.match(/__returned__\s*=\s*\{([^}]*)\}/)
    const returnedContent = returnMatch?.[1] || ''
    expect(returnedContent).toContain('ChildA')
    expect(returnedContent).toContain('ChildB')
  })
})
