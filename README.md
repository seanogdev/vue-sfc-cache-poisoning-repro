# Vue SFC Cache Poisoning — Reproduction

Reproduction for a bug in `@vue/compiler-sfc` where `compileTemplate` mutates a shared cached AST, causing `compileScript` to silently drop components from `__returned__` when the `templateAnalysisCache` is evicted.

Components inside `v-if` or `v-for` become `undefined` at runtime.

## Run

```bash
npm install
node generate-fillers.mjs
node test.mjs
```

## Root Cause

`resolveTemplateAnalysisResult` only walks `node.type === 1` (ELEMENT). After `compileTemplate` transforms the AST, `v-if` elements become IfNodes (type=9) which the walker skips. When the `templateAnalysisCache` LRU(500) evicts and the analysis re-runs on the mutated AST, it misses those components.

The AST is shared because `compiler.parse()` returns cached descriptor objects. Multiple Vite servers in the same process (e.g. vitest with multiple projects) all get the same mutable object.
