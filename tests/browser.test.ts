import { expect, test } from 'vitest'
import { createApp } from 'vue'
import Target from '../src/Target.vue'

// Browser project — renders Target.vue in chromium.
//
// During getTestDependencies, this project's Vite server SSR-transforms
// Target.vue FIRST (short dep graph, completes before filler chains).
// This populates compiler-sfc caches and mutates the AST via compileTemplate.
//
// During test execution, the browser requests Target.vue via a CLIENT transform
// from Vite's dev server. If the caches are desynced (parseCache retains the
// mutated descriptor while templateAnalysisCache is evicted), compileScript
// re-walks the mutated AST and misses ChildA/ChildB inside IfNodes (type=9).
test('Target renders child components with v-if', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const app = createApp(Target, { show: true })
  app.mount(container)

  // These fail when cache poisoning is active — ChildA/ChildB are undefined
  expect(container.querySelector('.child-a')).toBeTruthy()
  expect(container.querySelector('.child-b')).toBeTruthy()

  app.unmount()
  container.remove()
})
