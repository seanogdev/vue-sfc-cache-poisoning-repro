import { expect, test } from 'vitest'
import { hello } from '../src/source'

// A-chain head: FillerA001 → FillerA002 → ... → FillerA450 → Target.vue
// This long chain fills the LRU(500) caches past capacity, evicting
// Target.vue's templateAnalysisCache entry.
import '../src/fillers/FillerA001.vue'

test('source module works', () => {
  expect(hello()).toBe('hello')
})
