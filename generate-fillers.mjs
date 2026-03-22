import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fillersDir = resolve(__dirname, 'src/fillers')
rmSync(fillersDir, { recursive: true, force: true })
mkdirSync(fillersDir, { recursive: true })

const A_COUNT = 450
const B_COUNT = 100

// A-chain: FillerA001 → FillerA002 → ... → FillerA450 → Target.vue
// Processed by the `app` project. This is the long chain that fills the
// LRU(500) caches past capacity, evicting Target.vue's templateAnalysisCache entry.
for (let i = 1; i <= A_COUNT; i++) {
  const padded = String(i).padStart(3, '0')
  let nextImport
  if (i < A_COUNT) {
    const nextPadded = String(i + 1).padStart(3, '0')
    nextImport = `import './FillerA${nextPadded}.vue'`
  } else {
    nextImport = `import '../Target.vue'`
  }
  writeFileSync(resolve(fillersDir, `FillerA${padded}.vue`), `<template>
  <div class="filler-a-${i}">{{ msg }}</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
${nextImport}
const msg = ref('Filler A${i}')
</script>
`)
}

// B-chain: FillerB001 → FillerB002 → ... → FillerB100 → Target.vue
// Processed by the `app-mid` project. This shorter chain reaches Target.vue
// at the MIDPOINT of A-chain processing (~200 total entries in LRU caches).
// This creates the critical parseCache refresh WITHOUT refreshing
// templateAnalysisCache (because ssrCache WeakMap HIT skips compileScript).
for (let i = 1; i <= B_COUNT; i++) {
  const padded = String(i).padStart(3, '0')
  let nextImport
  if (i < B_COUNT) {
    const nextPadded = String(i + 1).padStart(3, '0')
    nextImport = `import './FillerB${nextPadded}.vue'`
  } else {
    nextImport = `import '../Target.vue'`
  }
  writeFileSync(resolve(fillersDir, `FillerB${padded}.vue`), `<template>
  <div class="filler-b-${i}">{{ msg }}</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
${nextImport}
const msg = ref('Filler B${i}')
</script>
`)
}

console.log(`Generated ${A_COUNT} A-chain + ${B_COUNT} B-chain = ${A_COUNT + B_COUNT} filler .vue files`)
