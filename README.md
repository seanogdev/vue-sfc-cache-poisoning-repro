# Vue SFC Cache Poisoning — Minimal Reproduction

Reproduction for [vitest#9855](https://github.com/vitest-dev/vitest/issues/9855): `vitest related` with multiple projects corrupts Vue SFC compilation. Components inside `v-if`/`v-for` silently become `undefined` at runtime ("Invalid vnode type" errors).

## Reproduce

```bash
pnpm install
pnpm test          # runs: vitest related src/Target.vue --run
```

**Expected on vitest 4.1.0** (without the fix): browser test **fails** — `ChildA` and `ChildB` are `undefined` and don't render.

> **Note:** The bug only triggers via `vitest related` (which calls `getTestDependencies` across all projects). Running `vitest run` directly would pass because it skips the multi-project dependency resolution that causes the cache poisoning.

## How It Works

Three vitest projects run `getTestDependencies` concurrently via `Promise.all`. Each project's Vite server does SSR transforms that share `@vue/compiler-sfc`'s module-level LRU(500) caches (`parseCache` and `templateAnalysisCache`).

### The three projects

| Project | Environment | Test file | Dep chain |
|---------|------------|-----------|-----------|
| **browser** | chromium (playwright) | `browser.test.ts` | Imports `Target.vue` directly |
| **app-mid** | jsdom | `app-mid.test.ts` | 100-filler chain → `Target.vue` |
| **app** | jsdom | `app.test.ts` | 450-filler chain → `Target.vue` |

### The cache poisoning timeline

1. **browser** project SSR-transforms `Target.vue` first (tiny dep graph, completes quickly). This populates both LRU caches and `compileTemplate` **mutates the shared AST** — `v-if` elements (type=1) become IfNodes (type=9).

2. **app-mid** project processes 100 fillers sequentially, then reaches `Target.vue`. `compiler.parse()` returns the cached mutated descriptor (**parseCache refreshed**). `ssrCache` WeakMap HIT from step 1 → `compileScript` skipped → **templateAnalysisCache NOT refreshed**.

3. **app** project continues processing 450 fillers. Combined with app-mid's 100 fillers, that's 550 entries — pushing `templateAnalysisCache` past its LRU(500) capacity. **Target.vue's template analysis is evicted**, but `parseCache` retains the mutated descriptor (only ~350 entries since the midpoint refresh in step 2).

4. Browser test runs in chromium → Vite serves a **client transform** of `Target.vue` → `parseCache` HIT returns the mutated descriptor → `templateAnalysisCache` MISS → `resolveTemplateAnalysisResult` re-walks the mutated AST → the walker only handles `type=1` (ELEMENT), so it **misses ChildA/ChildB** inside IfNodes (type=9) → excluded from `__returned__` → `undefined` at runtime.

## Root Cause

The bug is in `@vue/compiler-sfc` and `@vitejs/plugin-vue`, not in vitest:

- **compiler-sfc**: `compiler.parse()` returns cached mutable descriptor objects via an LRU(500) cache. `compileTemplate()` mutates the AST in place. `resolveTemplateAnalysisResult()` only walks `node.type === 1` (ELEMENT), missing components inside IfNodes/ForNodes.

- **plugin-vue**: `ssrCache`/`clientCache` WeakMaps are module-level (shared across all Vite servers in the process). When a second server encounters the same descriptor, the WeakMap HIT skips `compileScript`, preventing `templateAnalysisCache` from being refreshed.

The [vitest fix](https://github.com/vitest-dev/vitest/pull/9936) adds a `transformCache` to `getTestDependencies` that deduplicates SSR transforms across projects, preventing the redundant `compiler.parse()` calls that cause the `parseCache`/`templateAnalysisCache` desync.
