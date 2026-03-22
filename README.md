# Vue SFC Cache Poisoning — Reproduction

Reproduction for [vitest#9855](https://github.com/vitest-dev/vitest/issues/9855): `vitest related` with multiple projects corrupts Vue SFC compilation. Components inside `v-if`/`v-for` silently become `undefined` at runtime ("Invalid vnode type" errors).

## Quick Start

```bash
npm install
node generate-fillers.mjs
npx vitest run
```

## Tests

**Test 1** — Proves the core mechanism: `compileTemplate` mutates the shared cached AST, and `compileScript` on the mutated descriptor misses components inside `v-if` (IfNodes, type=9).

**Test 2** — Simulates what vitest's `getTestDependencies` does **without** the `transformCache` fix. Two Vite servers share `@vue/compiler-sfc`'s module-level caches. A redundant SSR transform on server 2 refreshes `parseCache` but not `templateAnalysisCache`, causing them to desync after LRU(500) eviction. The client transform then gets a mutated descriptor and misses `ChildA`/`ChildB`.

**Test 3** — Simulates `getTestDependencies` **with** the `transformCache` fix. Server 2 skips the redundant SSR transform (as the `transformCache` would deduplicate it). Both caches evict together → client transform gets a fresh descriptor → correct analysis.

## Root Cause

`resolveTemplateAnalysisResult` only walks `node.type === 1` (ELEMENT). After `compileTemplate` transforms the AST, `v-if` elements become IfNodes (type=9) which the walker skips. When the `templateAnalysisCache` LRU(500) evicts and the analysis re-runs on the mutated AST, it misses those components.

The AST is shared because `compiler.parse()` returns cached descriptor objects. Multiple Vite servers in the same process (e.g. vitest with multiple projects) all get the same mutable object.

The cache desync happens because plugin-vue's `resolveScript()` uses a WeakMap keyed by descriptor. When server 2 encounters a descriptor already in the WeakMap (from server 1's transform), it skips `compileScript` — so `templateAnalysisCache` is not refreshed — but `createDescriptor()` still calls `compiler.parse()` which refreshes `parseCache`. After 500+ fillers, `templateAnalysisCache` evicts while `parseCache` retains the mutated descriptor.
