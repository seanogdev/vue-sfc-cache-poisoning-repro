import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fillersDir = resolve(__dirname, 'src/fillers')
const testsDir = resolve(__dirname, 'tests')
mkdirSync(fillersDir, { recursive: true })
mkdirSync(testsDir, { recursive: true })

const COUNT = 510

// Generate filler .vue files
// The last filler imports Target.vue — this forces Target.vue to be processed
// AFTER all fillers in the dependency chain, so the parse cache is refreshed
// late while the templateAnalysisCache has already been evicted.
for (let i = 1; i <= COUNT; i++) {
  const padded = String(i).padStart(3, '0')
  const importLine = i === COUNT
    ? `import Target from '../Target.vue'\nconst _target = Target\n`
    : ''
  const content = `<template>
  <div class="filler-${i}">{{ msg }}</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
${importLine}const msg = ref('Filler ${i}')
</script>
`
  writeFileSync(resolve(fillersDir, `Filler${padded}.vue`), content)
}

// Barrel file
const exports = []
for (let i = 1; i <= COUNT; i++) {
  const padded = String(i).padStart(3, '0')
  exports.push(`export { default as Filler${padded} } from './Filler${padded}.vue'`)
}
writeFileSync(resolve(fillersDir, 'index.ts'), exports.join('\n') + '\n')

// App test — imports Target.vue directly (processed early, populates ssrCache)
writeFileSync(resolve(testsDir, 'app.test.ts'), `import { expect, test } from 'vitest'
import { hello } from '../src/source'
import Target from '../src/Target.vue'

test('source works', () => {
  expect(hello()).toBe('hello')
  expect(Target).toBeTruthy()
})
`)

// Browser test — imports fillers barrel so Target.vue is discovered AFTER 510 fillers
writeFileSync(resolve(testsDir, 'browser.test.ts'), `import { expect, test } from 'vitest'
import { createApp } from 'vue'
import { hello } from '../src/source'
import '../src/fillers'
import Target from '../src/Target.vue'

test('Target renders child components with v-if', () => {
  expect(hello()).toBe('hello')

  const container = document.createElement('div')
  document.body.appendChild(container)

  const app = createApp(Target, { show: true })
  app.mount(container)

  // When cache poisoning occurs, ChildA and ChildB are undefined
  // in __returned__, so they don't render at all
  expect(container.querySelector('.child-a')).toBeTruthy()
  expect(container.querySelector('.child-b')).toBeTruthy()

  app.unmount()
  container.remove()
})
`)

console.log(`Generated ${COUNT} filler .vue files (last one imports Target.vue)`)
console.log('Generated app.test.ts and browser.test.ts')
