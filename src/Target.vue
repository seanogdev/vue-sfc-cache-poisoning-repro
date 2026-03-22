<template>
  <div class="target">
    <ChildA v-if="show" />
    <ChildB v-if="show" />
  </div>
</template>
<script lang="ts">
import { hello } from './source'
export const meta = { name: 'Target', greeting: hello() }
</script>
<script setup lang="ts">
import ChildA from './ChildA.vue'
import ChildB from './ChildB.vue'

const props = defineProps<{ show: boolean }>()
</script>
