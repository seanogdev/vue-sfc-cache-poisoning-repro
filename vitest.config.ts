import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Reproduces vitest#9855: Vue SFC cache poisoning across projects.
//
// Three projects run getTestDependencies concurrently via Promise.all:
//
// 1. browser (chromium): discovers Target.vue immediately → first SSR transform,
//    populates compiler-sfc caches (parseCache + templateAnalysisCache), mutates AST
//
// 2. app-mid (jsdom): 100-filler chain → Target.vue → reaches Target.vue at the
//    MIDPOINT of filler processing (~200 total entries). compiler.parse() refreshes
//    parseCache (HIT), but ssrCache WeakMap HIT skips compileScript → templateAnalysisCache
//    NOT refreshed
//
// 3. app (jsdom): 450-filler chain → Target.vue → fills remaining entries past LRU(500)
//    capacity, evicting Target.vue from templateAnalysisCache while parseCache retains it
//
// Browser test execution → client transform → parseCache HIT (mutated descriptor) →
// templateAnalysisCache MISS → re-walks mutated AST → ChildA/ChildB excluded → BUG
//
// Run: pnpm test (vitest related src/Target.vue --run)
export default defineConfig({
  test: {
    testTimeout: 60000,
    projects: [
      {
        plugins: [vue()],
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          include: ['tests/browser.test.ts'],
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'app-mid',
          environment: 'jsdom',
          include: ['tests/app-mid.test.ts'],
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['tests/app.test.ts'],
        },
      },
    ],
  },
})
