import { expect, test } from 'vitest'
import { hello } from '../src/source'

// B-chain head: FillerB001 → FillerB002 → ... → FillerB100 → Target.vue
// This shorter chain reaches Target.vue at the MIDPOINT of A-chain processing.
// The midpoint compiler.parse() call refreshes parseCache for the mutated
// descriptor, but ssrCache HIT skips compileScript → templateAnalysisCache
// is NOT refreshed. This creates the cache desync.
import '../src/fillers/FillerB001.vue'

test('source module works (mid)', () => {
  expect(hello()).toBe('hello')
})
