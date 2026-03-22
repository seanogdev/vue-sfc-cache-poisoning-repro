import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fillersDir = resolve(__dirname, 'src/fillers')
mkdirSync(fillersDir, { recursive: true })

const COUNT = 510

for (let i = 1; i <= COUNT; i++) {
  const padded = String(i).padStart(3, '0')
  const content = `<template>
  <div class="filler-${i}">{{ msg }}</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const msg = ref('Filler ${i}')
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

console.log(`Generated ${COUNT} filler .vue files in src/fillers/`)
