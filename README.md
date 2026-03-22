# Vue SFC Cache Poisoning — Minimal Reproduction

`vitest related` with multiple projects can silently corrupt Vue component rendering. Components inside `v-if` or `v-for` become `undefined` at runtime, producing "Invalid vnode type" errors.

The bug isn't in vitest. It's in `@vue/compiler-sfc` and `@vitejs/plugin-vue`.

## Quick Start

```bash
npm install
node generate-fillers.mjs   # creates 510 filler .vue files to overflow LRU(500)
npx vitest run
```

Three vitest tests prove the bug. All pass by asserting the broken behaviour.

## What's Happening

Three bugs interact across `@vue/compiler-sfc` and `@vitejs/plugin-vue`. None cause issues alone. Together they corrupt the compiled output of any Vue SFC that uses `v-if` or `v-for` on imported components.

### 1. Shared mutable descriptors

`compiler.parse()` has an LRU(500) cache. It returns the **same object** to every caller. Two Vite servers in the same process get the same descriptor for the same `.vue` file.

### 2. `compileTemplate` mutates the AST in place

SSR `compileTemplate()` transforms the AST destructively. Elements with `v-if` (type=1, ELEMENT) become IfNodes (type=9). Expression contents get `$setup.`/`$props.` prefixes. The original AST structure is gone.

### 3. Template analysis cache desyncs from parse cache

`templateAnalysisCache` is a separate LRU(500) keyed by the template content string. It determines which imports appear in `__returned__` and which don't.

The two caches evict at different rates because plugin-vue's `resolveScript()` checks a WeakMap first. On a WeakMap HIT, `compileScript` is skipped entirely, so `templateAnalysisCache` isn't refreshed. But `createDescriptor()` always calls `compiler.parse()`, refreshing the parse cache.

After enough `.vue` files are processed (~500), the template analysis entry gets evicted while the parse cache still holds the mutated descriptor. The next `compileScript` call re-walks the mutated AST and misses components inside IfNodes because the walker only recurses into type=1 (ELEMENT) nodes.

## How `vitest related` Triggers This

When you run `vitest related` with multiple projects, vitest calls `getTestDependencies` for all specs via `Promise.all`. Each project has its own Vite server, but they all share the same `@vue/compiler-sfc` module-level caches.

1. **Project A** SSR-transforms `Target.vue` — populates both caches, then `compileTemplate` mutates the AST
2. **Project A** processes hundreds of `.vue` dependency files — LRU caches start filling
3. **Project B** SSR-transforms `Target.vue` — parseCache refreshed (HIT), but `ssrCache` WeakMap HIT means `compileScript` is skipped, so `templateAnalysisCache` is **not** refreshed
4. More files processed — `templateAnalysisCache` evicts `Target.vue` (>500 entries), parseCache retains it
5. **Project B** client-transforms `Target.vue` — parseCache returns the mutated descriptor, `templateAnalysisCache` misses, walker skips IfNodes — `ChildA` and `ChildB` missing from `__returned__`

The component renders with `undefined` children. Vue warns "Invalid vnode type".

## Tests

| Test | What it proves |
|------|----------------|
| `compileTemplate mutates shared AST` | Direct compiler API call. SSR `compileTemplate` turns `v-if` elements into IfNodes. Subsequent client `compileScript` on the same descriptor misses those components. |
| `full pipeline` | Two Vite servers, 510 filler files. Reproduces the parseCache/templateAnalysisCache desync end-to-end. |
| `control` | Fresh descriptor without AST mutation. `compileScript` correctly includes all components. |

The first test proves the mechanism. The second test proves it happens through actual Vite server transforms, not just direct API calls. The third test confirms correct behaviour without the bug.

## Where This Should Be Fixed

- **`@vue/compiler-sfc`**: `resolveTemplateAnalysisResult` should handle IfNode (type=9), ForNode (type=11) and other transformed node types. Or `compileTemplate` should stop mutating the input AST. Or `parse()` should return fresh objects instead of cached references.
- **`@vitejs/plugin-vue`**: `clientCache` and `ssrCache` WeakMaps are module-level variables, shared across all plugin instances. They should be per-instance.
