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
  <div class="filler-${i}">Filler ${i}</div>
</template>
<script setup lang="ts">
const id = ${i}
</script>
`
  writeFileSync(resolve(fillersDir, `Filler${padded}.vue`), content)
}

console.log(`Generated ${COUNT} filler .vue files in src/fillers/`)
